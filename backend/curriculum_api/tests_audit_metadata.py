"""Audit metadata as structured data: actor kind, trigger, source, metadata.

Phase 1 recorded who saved and what changed. This is about the questions that
needed columns rather than a parsed string:

* was that a person, or the system acting because of a person?
* how did the save arrive -- a person pressing Save, an auto-save, an import?
* what did an upload actually attach?

The rule underneath all of it: the log describes the write, and it never invents
an answer it does not have. A system action with no person behind it has no
trigger, and says so, rather than borrowing whoever was nearby.

Historic rows keep the older tagged-``reason`` encoding and must stay readable,
so the legacy path is tested here too -- there are 1.15M of those rows and none
of them is going to be rewritten.
"""

import json

from django.db import connection, transaction

from curriculum_api import quality, versioning, views
from curriculum_api.tests_audit_trail import AuditHarness


class AuditContextTests(AuditHarness):
    """The context API: what it carries, and what it refuses to carry."""

    def component(self, **overrides):
        payload = {
            'id': 'COMP-CTX', 'module_catalogue_id': 'MOD-CTX', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Reading', 'display_order': 0,
        }
        payload.update(overrides)
        return payload

    def save(self, **overrides):
        return self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component(**overrides)))

    def latest(self):
        return self.revisions('component', 'COMP-CTX')[-1]

    def test_a_person_editing_is_the_actor_with_nothing_triggering_them(self):
        self.sign_in(name='Rachel Myers', email='rachel@kentbusinesscollege.com')
        self.save()
        row = self.latest()
        self.assertEqual(row['actor_type'], versioning.ACTOR_USER)
        self.assertEqual(row['actor_name'], 'Rachel Myers')
        self.assertEqual(row['triggered_by_email'], '')

    def test_a_system_action_inside_a_request_names_the_person_who_triggered_it(self):
        """The distinction Phase 2 exists for.

        The person did something; the system did something else as a result.
        Recording it as their edit would say they typed a field they never saw.
        """
        account = self.sign_in(name='Ayman Badewi', email='ayman@kentbusinesscollege.com')
        with versioning.audit_context(
            actor_type=versioning.ACTOR_SYSTEM,
            triggered_by=account,
            source='recalculation',
            metadata={'recalculated_from': 'programme_rename'},
        ):
            self.save(title='Reading (renamed by cascade)')
        row = self.latest()
        self.assertEqual(row['actor_type'], versioning.ACTOR_SYSTEM)
        self.assertEqual(row['actor_name'], 'System')
        # No email for the system: a real mailbox against a change nobody made
        # is exactly the fabrication this log must not commit.
        self.assertEqual(row['actor_email'], '')
        self.assertEqual(row['triggered_by_email'], 'ayman@kentbusinesscollege.com')
        self.assertEqual(row['triggered_by_name'], 'Ayman Badewi')
        self.assertEqual(row['source'], 'recalculation')

    def test_a_background_job_has_no_trigger_at_all(self):
        with versioning.audit_context(actor_type=versioning.ACTOR_JOB, source='scheduled-job'):
            self.save()
        row = self.latest()
        self.assertEqual(row['actor_type'], versioning.ACTOR_JOB)
        self.assertEqual(row['actor_name'], 'System')
        # Nothing to name, so nothing is named.
        self.assertEqual(row['triggered_by_email'], '')
        self.assertEqual(row['triggered_by_name'], '')

    def test_the_signed_in_person_becomes_the_trigger_without_being_declared(self):
        """A fact about the request, not an inference: they were signed in."""
        self.sign_in(name='Hana Amer', email='hana@kentbusinesscollege.com')
        with versioning.audit_context(actor_type=versioning.ACTOR_SYSTEM, source='recalculation'):
            self.save()
        self.assertEqual(self.latest()['triggered_by_email'], 'hana@kentbusinesscollege.com')

    def test_nested_contexts_restore_exactly_what_was_there(self):
        self.sign_in()
        with versioning.audit_context(source='manual', metadata={'note': 'outer'}):
            self.assertEqual(versioning.current_source(), 'manual')
            with versioning.audit_context(source='import', metadata={'import_type': 'inner'}):
                self.assertEqual(versioning.current_source(), 'import')
                merged = versioning.current_context()['metadata']
                # The inner block adds to the outer one rather than erasing it.
                self.assertEqual(merged['note'], 'outer')
                self.assertEqual(merged['import_type'], 'inner')
            self.assertEqual(versioning.current_source(), 'manual')
            self.assertEqual(versioning.current_context()['metadata'], {'note': 'outer'})
        self.assertEqual(versioning.current_source(), '')
        self.assertEqual(versioning.current_context(), {})

    def test_an_inner_context_does_not_lose_the_person_the_request_belongs_to(self):
        self.sign_in(name='Rachel Myers', email='rachel@kentbusinesscollege.com')
        with versioning.audit_context(source='import'):
            self.save()
        row = self.latest()
        self.assertEqual(row['source'], 'import')
        self.assertEqual(row['actor_name'], 'Rachel Myers')
        self.assertEqual(row['actor_type'], versioning.ACTOR_USER)

    def test_an_unknown_actor_type_is_refused_rather_than_stored(self):
        self.sign_in()
        with self.assertLogs('curriculum_api.versioning', level='WARNING'):
            with versioning.audit_context(actor_type='wizard-king'):
                self.save()
        self.assertEqual(self.latest()['actor_type'], versioning.ACTOR_USER)

    def test_an_unknown_source_is_refused_rather_than_stored(self):
        self.sign_in()
        with self.assertLogs('curriculum_api.versioning', level='WARNING'):
            with versioning.audit_context(source='whatever-the-client-said'):
                self.save()
        self.assertEqual(self.latest()['source'], '')

    def test_a_declared_action_names_the_business_event(self):
        """"Edited" is true of a cascade but useless: the question a reader
        brings to the row is why a record they never opened changed."""
        self.sign_in()
        self.save()
        with versioning.audit_context(
            actor_type=versioning.ACTOR_SYSTEM, source='recalculation', action='recalculated',
        ):
            self.save(title='Carried down by the system')
        row = self.latest()
        self.assertEqual(row['action'], 'recalculated')
        self.assertEqual(row['actor_type'], versioning.ACTOR_SYSTEM)

    def test_a_declared_action_cannot_talk_over_a_create(self):
        """A create is a fact about the row, not something a caller may rename."""
        self.sign_in()
        with versioning.audit_context(action='recalculated', source='recalculation'):
            self.save()
        self.assertEqual(self.latest()['action'], 'created')

    def test_a_declared_action_cannot_talk_over_an_archive(self):
        """A caller may name a business event; it may not hide a withdrawal."""
        self.sign_in()
        self.save()
        with versioning.audit_context(action='file_replaced', source='upload'):
            self.committed(lambda: views.authoring_soft_delete(
                views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-CTX'], deleted_by='component-delete'))
        self.assertEqual(self.latest()['action'], 'archived')

    def test_the_context_does_not_survive_into_the_next_request(self):
        self.sign_in()
        with versioning.audit_context(actor_type=versioning.ACTOR_SYSTEM, source='recalculation'):
            pass
        self.save()
        row = self.latest()
        self.assertEqual(row['actor_type'], versioning.ACTOR_USER)
        self.assertEqual(row['source'], '')


class TransactionTests(AuditHarness):
    """History becomes durable with the write it describes, or not at all."""

    def component(self):
        return {
            'id': 'COMP-TX', 'module_catalogue_id': 'MOD-TX', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Reading', 'display_order': 0,
        }

    def test_a_rolled_back_write_records_nothing(self):
        self.sign_in()
        try:
            with transaction.atomic():
                views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component())
                raise RuntimeError('the save failed after the row was written')
        except RuntimeError:
            pass
        # No on_commit callback ran, so there is nothing claiming this happened.
        self.assertEqual(self.revisions('component', 'COMP-TX'), [])

    def test_a_rolled_back_context_does_not_leak_into_the_next_write(self):
        """The context is cleared on the way into a request precisely because a
        block whose transaction blew up may never have reached its __exit__."""
        self.sign_in()
        try:
            with transaction.atomic():
                with versioning.audit_context(actor_type=versioning.ACTOR_JOB, source='scheduled-job'):
                    views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component())
                    raise RuntimeError('boom')
        except RuntimeError:
            pass
        versioning.discard_pending()
        versioning.discard_context()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        row = self.revisions('component', 'COMP-TX')[-1]
        self.assertEqual(row['actor_type'], versioning.ACTOR_USER)
        self.assertEqual(row['source'], '')

    def test_the_context_is_captured_at_write_time_not_at_flush_time(self):
        """The flush waits for the commit, which happens after the block has
        closed. Reading the context then would lose it entirely."""
        self.sign_in()
        with self.captureOnCommitCallbacks(execute=True):
            with versioning.audit_context(source='import', metadata={'import_type': 'late-flush'}):
                views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component())
            # Block closed; the revision has not been written yet.
            self.assertEqual(versioning.current_source(), '')
        row = self.revisions('component', 'COMP-TX')[-1]
        self.assertEqual(row['source'], 'import')
        self.assertEqual(versioning.as_dict(row['metadata'])['import_type'], 'late-flush')


class MetadataSafetyTests(AuditHarness):
    """Metadata is descriptive context. It is never content, and never a secret."""

    def test_only_allowlisted_keys_are_kept(self):
        kept = versioning.safe_metadata({
            'file_name': 'week-4-reading.pdf',
            'password': 'hunter2',
            'access_token': 'eyJhbGciOi',
            'authorization': 'Bearer abc',
            'session_id': 'abc123',
            'api_key': 'sk-live-xyz',
        })
        self.assertEqual(kept, {'file_name': 'week-4-reading.pdf'})

    def test_a_url_loses_its_query_string(self):
        """A SAS token, a signature and a session all live in a query string,
        and an append-only column is the last place one should land."""
        kept = versioning.safe_metadata({
            'file_name': 'https://store.blob.core.windows.net/x/a.pdf?sv=2024&sig=SECRETSIGNATURE',
        })
        self.assertNotIn('sig', kept['file_name'])
        self.assertNotIn('SECRETSIGNATURE', kept['file_name'])
        self.assertTrue(kept['file_name'].endswith('a.pdf'))

    def test_a_value_is_bounded(self):
        kept = versioning.safe_metadata({'note': 'x' * 5000})
        self.assertLessEqual(len(kept['note']), versioning.METADATA_VALUE_LIMIT)

    def test_an_oversized_document_is_refused_whole(self):
        oversized = versioning.safe_metadata({key: 'y' * 190 for key in versioning.METADATA_KEYS})
        self.assertEqual(oversized, {'note': 'metadata omitted: too large'})

    def test_a_non_dict_is_simply_nothing(self):
        self.assertEqual(versioning.safe_metadata('file_name=secret'), {})
        self.assertEqual(versioning.safe_metadata(None), {})

    def test_no_recorded_metadata_column_ever_holds_a_credential_word(self):
        """A sweep rather than a specific case: whatever a caller passes, none of
        these words can reach the column."""
        self.sign_in()
        with versioning.audit_context(metadata={
            'file_name': 'notes.pdf', 'token': 'abc', 'secret': 'def', 'cookie': 'ghi',
        }):
            self.committed(lambda: views.authoring_upsert(
                views.AUTHORING_COMPONENTS_TABLE, ['id'], {
                    'id': 'COMP-META', 'module_catalogue_id': 'MOD-META', 'week_id': 'W',
                    'type': 'reading', 'title': 'Reading', 'display_order': 0,
                }))
        stored = json.dumps(self.revisions('component', 'COMP-META')[-1]['metadata']).lower()
        for word in ('token', 'secret', 'cookie', 'password', 'bearer'):
            self.assertNotIn(word, stored)


class FileEventTests(AuditHarness):
    """Attaching a file is an event a reader asks about by name."""

    def seed_component(self, settings=None):
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-FILE', 'module_catalogue_id': 'MOD-FILE', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Reading material', 'display_order': 0,
            'settings_json': views.json_db_value(settings or {}),
        }))

    def upload(self, file_name, size=1048576, content_type='application/pdf'):
        """A component saved carrying an attached file.

        This is the write the upload actually produces: the endpoint stores the
        file and hands its details back, and the browser saves them onto the
        component. So the component save is where the event is, and the event is
        read off what the component ends up holding.

        The URL is included exactly as the real settings carry it -- signature
        and all -- because the point of the test below is that it does not
        survive into the log.
        """
        return self.seed_component({
            'uploadedFileName': file_name,
            'uploadedFileUrl': f'/curriculum_api/curriculum/uploads/MOD-FILE/COMP-FILE/{file_name}?sig=SECRETSIG',
            'uploadedFileSize': size,
            'uploadedFileContentType': content_type,
            'uploadSource': 'Device upload',
        })

    def latest(self):
        return self.revisions('component', 'COMP-FILE')[-1]

    def test_the_first_attachment_is_an_upload(self):
        self.sign_in()
        self.seed_component()
        self.upload('week-4-reading.pdf')
        row = self.latest()
        self.assertEqual(row['action'], 'file_uploaded')
        metadata = versioning.as_dict(row['metadata'])
        self.assertEqual(metadata['file_name'], 'week-4-reading.pdf')
        self.assertEqual(metadata['file_type'], 'application/pdf')
        self.assertEqual(metadata['file_size'], 1048576)

    def test_attaching_over_an_existing_file_is_a_replacement(self):
        self.sign_in()
        self.seed_component()
        self.upload('week-4-reading.pdf')
        self.upload('week-4-reading-v2.pdf')
        row = self.latest()
        self.assertEqual(row['action'], 'file_replaced')
        metadata = versioning.as_dict(row['metadata'])
        self.assertEqual(metadata['file_name'], 'week-4-reading-v2.pdf')
        # What it replaced, which is the question a replacement raises.
        self.assertEqual(metadata['previous_file_name'], 'week-4-reading.pdf')

    def test_clearing_the_attachment_is_a_removal(self):
        """Derived from the row itself: the name it carried is gone."""
        self.sign_in()
        self.seed_component()
        self.upload('week-4-reading.pdf')
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-FILE', 'module_catalogue_id': 'MOD-FILE', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Reading material', 'display_order': 0,
            'settings_json': views.json_db_value({'uploadedFileName': '', 'uploadedFileUrl': ''}),
        }))
        self.assertEqual(self.latest()['action'], 'file_removed')

    def test_no_signed_url_reaches_the_log(self):
        """The upload URL carries a signature; the trail keeps the file's name.

        Checked across the whole revision -- metadata, snapshot and diff -- not
        just the column this test happens to be about.
        """
        self.sign_in()
        self.seed_component()
        self.upload('week-4-reading.pdf')
        whole_row = json.dumps(self.latest(), default=str)
        self.assertNotIn('SECRETSIG', whole_row)
        self.assertNotIn('sig=', whole_row)

    def test_no_file_content_reaches_the_log(self):
        self.sign_in()
        self.seed_component()
        self.upload('week-4-reading.pdf')
        metadata = versioning.as_dict(self.latest()['metadata'])
        # Name, type and size describe the file. Nothing here is the file.
        self.assertEqual(set(metadata), {'file_name', 'file_type', 'file_size'})


class LegacyCompatibilityTests(AuditHarness):
    """1.15M rows were written before these columns existed. They still read."""

    def insert_legacy(self, reason, actor_name='Farah Amer', actor_email='farah@kentbusinesscollege.com'):
        with connection.cursor() as cursor:
            cursor.execute(
                f'insert into {versioning.qualified(versioning.REVISIONS_TABLE)} '
                '(entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, title, '
                'version_label, content_status, snapshot, changed_fields, actor_email, actor_name, reason) '
                'values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                ['component', 'COMP-LEGACY', 1, 'updated', 'MOD-LEGACY', 'WEEK-1', 'Old component',
                 '', '', json.dumps({'id': 'COMP-LEGACY', 'title': 'Old component'}), '[]',
                 actor_email, actor_name, reason],
            )
        return views.fetch_all(
            'select * from ' + versioning.qualified(versioning.REVISIONS_TABLE) +
            ' where entity_id = %s', ['COMP-LEGACY'])[0]

    def test_the_old_tagged_reason_is_still_parsed(self):
        row = self.insert_legacy('component-delete; source=auto-save; actor=system')
        handler, kind, source, trigger_email, _ = quality.revision_attribution(row)
        self.assertEqual(handler, 'component-delete')
        self.assertEqual(kind, versioning.ACTOR_SYSTEM)
        self.assertEqual(source, 'auto-save')
        self.assertEqual(trigger_email, '')

    def test_an_old_trigger_tag_is_still_parsed(self):
        row = self.insert_legacy('module-save; source=recalculation; actor=system; by=ayman@kbc.com')
        _, kind, source, trigger_email, trigger_name = quality.revision_attribution(row)
        self.assertEqual(kind, versioning.ACTOR_SYSTEM)
        self.assertEqual(source, 'recalculation')
        self.assertEqual(trigger_email, 'ayman@kbc.com')
        # No name was ever stored, so the email stands in rather than a blank.
        self.assertEqual(trigger_name, 'ayman@kbc.com')

    def test_a_row_with_no_tags_at_all_reads_as_a_person(self):
        """The oldest rows. They were written by the signed-in account the
        middleware supplied, which is what the data supports -- and nothing is
        invented beyond that."""
        row = self.insert_legacy('')
        handler, kind, source, trigger_email, _ = quality.revision_attribution(row)
        self.assertEqual(handler, '')
        self.assertEqual(kind, versioning.ACTOR_USER)
        self.assertEqual(source, '')
        self.assertEqual(trigger_email, '')

    def test_a_structured_column_wins_over_a_stale_tag(self):
        """Both present is not a state the writer produces, but it is exactly
        what a row written either side of the migration could look like, so the
        precedence has to be stated rather than assumed."""
        row = self.insert_legacy('component-save; source=auto-save; actor=system')
        row['actor_type'] = versioning.ACTOR_USER
        row['source'] = 'manual'
        row['triggered_by_email'] = ''
        _, kind, source, _, _ = quality.revision_attribution(row)
        self.assertEqual(kind, versioning.ACTOR_USER)
        self.assertEqual(source, 'manual')

    def test_new_rows_no_longer_tag_the_reason_column(self):
        """The handler code, and nothing else, once there are columns for the rest."""
        self.sign_in()
        with versioning.audit_context(source='auto-save'):
            self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
                'id': 'COMP-CLEAN', 'module_catalogue_id': 'MOD-CLEAN', 'week_id': 'W',
                'type': 'reading', 'title': 'Reading', 'display_order': 0,
            }))
        row = self.revisions('component', 'COMP-CLEAN')[-1]
        self.assertNotIn('source=', row['reason'])
        self.assertNotIn('actor=', row['reason'])
        self.assertEqual(row['source'], 'auto-save')


class RecalculationTests(AuditHarness):
    """A cascade is the system's work, done because of somebody's edit."""

    def test_renaming_a_programme_runs_its_cascade_as_the_system(self):
        """Renaming a programme rewrites `programme_name` on every cohort, group
        and module under it. One person renamed one record; recording it as their
        edit to each child would say they opened forty modules and retyped a
        field. The person stays on as what caused it, which is the true half.

        Asserted through the context the cascade establishes rather than through
        a recorded revision, because the write helper it uses re-reads its own
        rows with the clause it just made false, and on SQLite -- which has no
        `returning *` here -- that re-read comes back empty. On Postgres the
        revisions are written; see the note in the Phase 2 report.
        """
        account = self.sign_in(name='Ayman Badewi', email='ayman@kentbusinesscollege.com')
        seen = {}

        def capture(programme_id, programme_name):
            context = versioning.current_context()
            seen.update({
                'actor_type': versioning.actor_type(),
                'source': versioning.current_source(),
                'metadata': dict(context.get('metadata') or {}),
                'actor': versioning.attribute(
                    versioning.actor_type(), versioning.current_actor(), context.get('triggered_by')),
            })

        original = views._propagate_programme_name_rows
        views._propagate_programme_name_rows = capture
        try:
            views.propagate_programme_name('PROG-RENAME', 'New programme name')
        finally:
            views._propagate_programme_name_rows = original

        self.assertEqual(seen['actor_type'], versioning.ACTOR_SYSTEM)
        self.assertEqual(seen['source'], 'recalculation')
        self.assertEqual(seen['metadata']['recalculated_from'], 'programme_rename')
        actor, triggered_by = seen['actor']
        self.assertEqual(actor['name'], 'System')
        self.assertEqual(actor['email'], '')
        self.assertEqual(triggered_by['email'], account.email)

    def test_the_cascade_does_not_relabel_the_rename_itself(self):
        """The programme the person actually renamed is still their edit."""
        self.sign_in(name='Ayman Badewi', email='ayman@kentbusinesscollege.com')
        views.propagate_programme_name('PROG-NONE', 'Whatever')
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-AFTER', 'module_catalogue_id': 'MOD-AFTER', 'week_id': 'W',
            'type': 'reading', 'title': 'Reading', 'display_order': 0,
        }))
        row = self.revisions('component', 'COMP-AFTER')[-1]
        self.assertEqual(row['actor_type'], versioning.ACTOR_USER)
        self.assertEqual(row['actor_name'], 'Ayman Badewi')
        self.assertEqual(row['source'], '')
