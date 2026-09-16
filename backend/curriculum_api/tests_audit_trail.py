"""The curriculum audit trail: who changed what, and from what to what.

Driven through the real endpoints and the real write helpers rather than by
calling the recorder directly, because the thing worth proving is not that
``versioning`` can write a row -- it is that an ordinary save through an
ordinary view leaves a truthful record behind it.

Every test here guards a failure that is silent. An audit trail that quietly
misses a create, credits a save to the wrong person, reports fields nobody
touched, or loses what a delete destroyed does not look broken; it looks like
history. These are the assertions that tell the difference.

A revision is recorded when the transaction that produced it commits, so each
test says where the save it describes ends -- that is what ``committed`` and
``request`` are for. ``TestCase`` never commits on its own.
"""

from curriculum_api import versioning, views
from curriculum_api.tests import CurriculumPersistenceHarness


class AuditHarness(CurriculumPersistenceHarness):
    """A curriculum with history switched on, and the ways to read it back."""

    def setUp(self):
        super().setUp()
        versioning.reset_availability()
        self.assertTrue(versioning.provision_history_tables())
        with self.connection_cursor() as cursor:
            cursor.execute(f'delete from {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'delete from {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.set_actor(None)
        versioning.discard_context()
        versioning.discard_pending()

    def tearDown(self):
        versioning.set_actor(None)
        versioning.discard_context()
        versioning.discard_pending()
        super().tearDown()

    def connection_cursor(self):
        from django.db import connection
        return connection.cursor()

    def sign_in(self, name='Ayman Badewi', email='ayman.badewi@kentbusinesscollege.com'):
        class Account:
            pass

        account = Account()
        account.email = email
        account.display_name = name
        versioning.set_actor(account)
        return account

    def committed(self, write):
        """Run one write and let the history it produced land, as a request does."""
        with self.captureOnCommitCallbacks(execute=True):
            return write()

    def request(self, method, path, body=None, **extra):
        """One HTTP call, ended the way a served request ends."""
        with self.captureOnCommitCallbacks(execute=True):
            if method == 'GET':
                return self.client.get(path, **extra)
            if method == 'DELETE':
                return self.client.delete(path, **extra)
            return self.post_json(path, body or {}, method=method, **extra) if hasattr(self, 'post_json') else None

    def revisions(self, entity_type=None, entity_id=None):
        where, params = ['1 = 1'], []
        if entity_type:
            where.append('entity_type = %s')
            params.append(entity_type)
        if entity_id:
            where.append('entity_id = %s')
            params.append(entity_id)
        return views.fetch_all(
            'select entity_type, entity_id, revision_no, action, title, module_catalogue_id, '
            'parent_id, snapshot, changed_fields, actor_name, actor_email, reason, '
            'actor_type, triggered_by_email, triggered_by_name, source, metadata '
            f'from {versioning.qualified(versioning.REVISIONS_TABLE)} '
            f'where {" and ".join(where)} order by id',
            params,
        )

    def changed_fields(self, revision):
        return {
            change['field']: (change.get('from'), change.get('to'))
            for change in versioning.as_list(revision['changed_fields'])
        }

    def snapshot(self, revision):
        return versioning.as_dict(revision['snapshot'])


class ComponentAuditTests(AuditHarness):
    """The record type that moves most, and the one the Module Builder rewrites."""

    def save_component(self, **overrides):
        payload = {
            'id': 'COMP-A', 'module_catalogue_id': 'MOD-A', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Quiz 1', 'expected_otjh': 0.5, 'display_order': 6,
            'settings_json': views.json_db_value({'version': '0.1', 'contentStatus': 'Draft'}),
        }
        payload.update(overrides)
        return self.committed(
            lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], payload)
        )

    def test_create_records_who_what_and_where(self):
        self.sign_in()
        self.save_component()
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['action'], 'created')
        self.assertEqual(rows[0]['actor_name'], 'Ayman Badewi')
        # Where it was created, not just that it was.
        self.assertEqual(rows[0]['module_catalogue_id'], 'MOD-A')
        self.assertEqual(rows[0]['parent_id'], 'WEEK-1')
        # A create has no "before"; the snapshot IS the after.
        self.assertEqual(self.snapshot(rows[0])['title'], 'Quiz 1')
        self.assertEqual(self.changed_fields(rows[0]), {})

    def test_update_records_only_the_fields_that_moved(self):
        self.sign_in()
        self.save_component()
        self.save_component(title='Final Knowledge Check', expected_otjh=0.75)
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]['action'], 'updated')
        changes = self.changed_fields(rows[1])
        # Exactly the two fields that changed. A diff that also reported `type`
        # or `display_order` would make every entry untrustworthy.
        self.assertEqual(set(changes), {'title', 'expected_otjh'})
        self.assertEqual(changes['title'], ('Quiz 1', 'Final Knowledge Check'))

    def test_a_save_that_changes_nothing_records_nothing(self):
        self.sign_in()
        self.save_component()
        self.save_component()
        self.save_component()
        self.assertEqual(len(self.revisions('component', 'COMP-A')), 1)

    def test_a_move_is_recorded_as_a_move(self):
        self.sign_in()
        self.save_component()
        self.save_component(week_id='WEEK-5', display_order=2)
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(rows[-1]['action'], 'moved')
        changes = self.changed_fields(rows[-1])
        self.assertEqual(changes['week_id'], ('WEEK-1', 'WEEK-5'))
        # The parent it moved to is what the row is indexed by afterwards.
        self.assertEqual(rows[-1]['parent_id'], 'WEEK-5')

    def test_a_reorder_is_recorded_as_a_reorder(self):
        self.sign_in()
        self.save_component()
        self.save_component(display_order=2)
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(rows[-1]['action'], 'reordered')
        self.assertEqual(self.changed_fields(rows[-1])['display_order'], ('6', '2'))

    def test_content_changes_are_read_inside_the_settings_blob(self):
        self.sign_in()
        self.save_component()
        self.save_component(settings_json=views.json_db_value({
            'version': '0.1', 'contentStatus': 'Draft', 'readingContent': 'New body',
        }))
        changes = self.changed_fields(self.revisions('component', 'COMP-A')[-1])
        # "settings_json changed" would be the least useful thing this could say.
        self.assertIn('settings.readingContent', changes)

    def test_archive_keeps_what_the_record_held(self):
        self.sign_in()
        self.save_component()
        self.committed(lambda: views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-A'], deleted_by='component-delete',
        ))
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(rows[-1]['action'], 'archived')
        # The content survives the withdrawal, which is the point.
        self.assertEqual(self.snapshot(rows[-1])['title'], 'Quiz 1')
        self.assertIn('component-delete', rows[-1]['reason'])

    def test_hard_delete_keeps_a_snapshot_of_what_was_destroyed(self):
        self.sign_in()
        self.save_component()
        self.committed(lambda: views.authoring_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-A'],
        ))
        rows = self.revisions('component', 'COMP-A')
        self.assertEqual(rows[-1]['action'], 'deleted')
        snapshot = self.snapshot(rows[-1])
        # Everything a reader would need, after the row itself has gone.
        self.assertEqual(snapshot['title'], 'Quiz 1')
        self.assertEqual(snapshot['module_catalogue_id'], 'MOD-A')
        self.assertEqual(snapshot['week_id'], 'WEEK-1')
        self.assertEqual(snapshot['display_order'], 6)
        # And the row really is gone, so the snapshot is the only copy.
        self.assertEqual(
            views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-A']),
            [],
        )


class SaveCycleNoiseTests(AuditHarness):
    """The rule the whole feature stands on: a save records edits, not mechanics.

    ``save_module_authoring_structure`` withdraws every week and component in a
    module and writes them all straight back. Recorded touch by touch, that
    produced an archived/restored pair per child per save -- 1.13 million of the
    1.15 million rows on the live database, with 598 real edits underneath them.
    """

    def component(self, **overrides):
        payload = {
            'id': 'COMP-N', 'module_catalogue_id': 'MOD-N', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Reading', 'display_order': 0,
        }
        payload.update(overrides)
        return payload

    def test_withdraw_and_rewrite_unchanged_records_nothing(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        before = len(self.revisions('component', 'COMP-N'))

        # Exactly what a module save does to a component nobody touched.
        def save_cycle():
            views.authoring_soft_delete(
                views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', ['MOD-N'],
                deleted_by='module-save',
            )
            views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component())

        self.committed(save_cycle)
        self.assertEqual(len(self.revisions('component', 'COMP-N')), before)

    def test_withdraw_and_rewrite_with_an_edit_records_the_edit(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))

        def save_cycle():
            views.authoring_soft_delete(
                views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', ['MOD-N'],
                deleted_by='module-save',
            )
            views.authoring_upsert(
                views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component(title='Reading (revised)'))

        self.committed(save_cycle)
        rows = self.revisions('component', 'COMP-N')
        self.assertEqual(len(rows), 2)
        # One entry, saying what the author actually did -- not an archive, a
        # restore, and the edit buried between them.
        self.assertEqual(rows[-1]['action'], 'updated')
        self.assertEqual(set(self.changed_fields(rows[-1])), {'title'})

    def test_a_genuine_archive_is_still_recorded(self):
        """The guard against over-correcting: real withdrawals must survive.

        A save-cycle archive and a real one look identical at the moment they are
        written. Only where the row ENDS UP tells them apart, which is why the
        decision waits for the commit.
        """
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        self.committed(lambda: views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-N'], deleted_by='component-delete'))
        self.assertEqual(self.revisions('component', 'COMP-N')[-1]['action'], 'archived')

    def test_a_rolled_back_save_records_nothing(self):
        """Requirement: data and history commit together or not at all."""
        from django.db import transaction

        self.sign_in()

        class Rollback(Exception):
            pass

        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    views.authoring_upsert(
                        views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component(id='COMP-FAIL'))
                    raise Rollback()
            except Rollback:
                pass
        # The mutation did not happen, so neither did the history of it.
        self.assertEqual(self.revisions('component', 'COMP-FAIL'), [])


class AutoSaveTests(AuditHarness):
    """Auto-save is a source, never an action, and never a keystroke."""

    def save(self, title, source):
        payload = {
            'id': 'COMP-AS', 'module_catalogue_id': 'MOD-AS', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': title, 'display_order': 0,
        }
        with versioning.source(source):
            return self.committed(
                lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], payload))

    def test_the_action_is_the_edit_and_auto_save_is_only_the_source(self):
        self.sign_in()
        self.save('Marketing', 'manual')
        self.save('Marketing basics', 'auto-save')
        rows = self.revisions('component', 'COMP-AS')
        # The business event is the edit. How it arrived is a separate column,
        # and 'auto-save' never becomes an action of its own.
        self.assertEqual(rows[-1]['action'], 'updated')
        self.assertEqual(rows[-1]['source'], 'auto-save')
        self.assertEqual(rows[0]['source'], 'manual')
        # Still the person's edit, however it was sent.
        self.assertEqual(rows[-1]['actor_type'], versioning.ACTOR_USER)
        self.assertEqual(rows[-1]['actor_name'], 'Ayman Badewi')

    def test_repeated_auto_saves_of_settled_text_record_one_entry_each(self):
        """No per-keystroke noise: an auto-save that re-sends the same text is
        a save that changed nothing, and a save that changed nothing is not an
        event."""
        self.sign_in()
        self.save('Marketing', 'auto-save')
        for _ in range(5):
            self.save('Marketing', 'auto-save')
        self.assertEqual(len(self.revisions('component', 'COMP-AS')), 1)

    def test_a_client_cannot_invent_a_source(self):
        self.sign_in()
        with versioning.source('manual'):
            pass
        # Only the labels the backend recognises are accepted off the wire.
        request = type('R', (), {'headers': {'X-Curriculum-Save-Source': 'totally-made-up'}})()
        self.assertEqual(versioning.request_source(request), '')
        request = type('R', (), {'headers': {'X-Curriculum-Save-Source': 'auto-save'}})()
        self.assertEqual(versioning.request_source(request), 'auto-save')


class ActorTests(AuditHarness):
    """Who did it, and when nobody did."""

    def component(self, title='Reading'):
        return {
            'id': 'COMP-ACT', 'module_catalogue_id': 'MOD-ACT', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': title, 'display_order': 0,
        }

    def test_the_actor_is_the_signed_in_account(self):
        self.sign_in(name='Rachel Myers', email='rachel@kentbusinesscollege.com')
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        row = self.revisions('component', 'COMP-ACT')[0]
        self.assertEqual(row['actor_name'], 'Rachel Myers')
        self.assertEqual(row['actor_email'], 'rachel@kentbusinesscollege.com')

    def test_a_write_with_no_account_is_the_system_not_a_person(self):
        versioning.set_actor(None)
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        row = self.revisions('component', 'COMP-ACT')[0]
        # Named as the system rather than left to look like an unnamed person,
        # and given no email, because inventing one would put a real mailbox
        # against a change nobody made.
        self.assertEqual(row['actor_type'], versioning.ACTOR_SYSTEM)
        self.assertEqual(row['actor_name'], 'System')
        self.assertEqual(row['actor_email'], '')
        # Nothing triggered it: there is no person to name, and guessing one is
        # exactly the fabrication this trail must never commit.
        self.assertEqual(row['triggered_by_email'], '')

    def test_the_actor_cannot_leak_between_requests(self):
        """A thread is reused; a leaked actor credits one person's save to another."""
        self.sign_in(name='Rachel Myers')
        versioning.set_actor(None)
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], self.component()))
        row = self.revisions('component', 'COMP-ACT')[0]
        self.assertNotEqual(row['actor_name'], 'Rachel Myers')
        self.assertEqual(row['actor_email'], '')
        self.assertEqual(row['actor_type'], versioning.ACTOR_SYSTEM)


class WiderCoverageTests(AuditHarness):
    """The record types that were not versioned at all before."""

    def test_programme_create_is_recorded_through_the_real_endpoint(self):
        # Signed in here and then deliberately NOT expected to be the actor: the
        # request carries no session, and `ActorMiddleware` resolves the actor
        # from the request on the way in. That it overrides whatever this test
        # set is the guarantee -- the actor comes from the authenticated session
        # and from nowhere else.
        self.sign_in()
        response = self.committed(lambda: self.post_json('/curriculum_api/curriculum/programmes/', {
            'name': 'Marketing Level 4', 'programId': 'PROG-AUD', 'standard': 'Marketing',
            'level': '4', 'owner': 'Someone Else',
        }))
        self.assertIn(response.status_code, (200, 201), response.content)
        rows = self.revisions('programme')
        self.assertTrue(rows, 'creating a programme recorded nothing')
        self.assertEqual(rows[0]['action'], 'created')
        self.assertEqual(self.snapshot(rows[0])['name'], 'Marketing Level 4')
        # An unauthenticated write is the system, and a name in the request body
        # is content -- never the actor.
        self.assertEqual(rows[0]['actor_type'], versioning.ACTOR_SYSTEM)
        self.assertEqual(rows[0]['actor_email'], '')
        self.assertNotEqual(rows[0]['actor_name'], 'Someone Else')
        self.assertEqual(self.snapshot(rows[0])['owner'], 'Someone Else')

    def test_a_record_that_predates_history_is_not_reported_as_created(self):
        """Requirement: do not fabricate an origin for an existing record."""
        from datetime import datetime, timedelta

        self.sign_in()
        old = datetime.utcnow() - timedelta(days=400)
        self.committed(lambda: views.authoring_upsert(views.GROUPS_TABLE, ['group_id'], {
            'group_id': 'GRP-OLD', 'group_name': 'Long-standing group',
            'created_at': old, 'updated_at': datetime.utcnow(),
        }))
        rows = self.revisions('group', 'GRP-OLD')
        self.assertEqual(rows[0]['action'], 'recorded')
        # And no author is invented for it either.
        self.assertEqual(rows[0]['actor_name'], 'Ayman Badewi')  # who touched it now
        self.assertEqual(self.snapshot(rows[0])['group_name'], 'Long-standing group')

    def test_group_coach_change_records_before_and_after(self):
        """Coach belongs to the GROUP. Tutor belongs to the MODULE."""
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(views.GROUPS_TABLE, ['group_id'], {
            'group_id': 'GRP-AUD', 'group_name': 'Group A', 'cohort_id': 'COH-AUD',
            'cohort_name': 'September 2026', 'programme_id': 'PROG-AUD',
            'programme_name': 'Marketing Level 4', 'coach_name': 'Coach A',
        }))
        self.committed(lambda: views.update_group_fields('GRP-AUD', {'coach_name': 'Coach B'}))
        rows = self.revisions('group', 'GRP-AUD')
        self.assertEqual(rows[-1]['action'], 'updated')
        self.assertEqual(self.changed_fields(rows[-1])['coach_name'], ('Coach A', 'Coach B'))
        # The group carries a coach and no tutor; nothing here invents one.
        self.assertNotIn('tutor_name', self.snapshot(rows[-1]))

    def test_module_tutor_change_records_before_and_after(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': 'MOD-TUT', 'title': 'PPC', 'programme_id': 'PROG-AUD',
                'programme_name': 'Marketing Level 4', 'tutor_name': 'Ahmed Lotfi',
            }))
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': 'MOD-TUT', 'title': 'PPC', 'tutor_name': 'Mohamed Ali',
            }))
        rows = self.revisions('module', 'MOD-TUT')
        self.assertEqual(self.changed_fields(rows[-1])['tutor_name'], ('Ahmed Lotfi', 'Mohamed Ali'))

    def test_ksb_mapping_add_and_remove_are_recorded(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_KSB_MAPPINGS_TABLE, ['id'], {
                'id': 'KSBMAP-AUD', 'module_catalogue_id': 'MOD-AUD', 'week_id': 'WEEK-1',
                'component_id': 'COMP-AUD', 'ksb_code': 'K2', 'ksb_id': 'K2',
                'classification': 'main',
            }))
        rows = self.revisions('ksb_mapping', 'KSBMAP-AUD')
        self.assertEqual(rows[0]['action'], 'created')
        self.assertEqual(rows[0]['title'], 'K2')
        self.assertEqual(rows[0]['parent_id'], 'COMP-AUD')

        self.committed(lambda: views.authoring_soft_delete(
            views.AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', ['KSBMAP-AUD'],
            deleted_by='ksb-mapping-delete'))
        self.assertEqual(self.revisions('ksb_mapping', 'KSBMAP-AUD')[-1]['action'], 'archived')


class ParentContextTests(AuditHarness):
    """Where the record lived when it changed, as it was named at the time."""

    def test_a_component_records_the_ancestry_above_it(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': 'MOD-CTX', 'title': 'PPC',
                'programme_id': 'PROG-CTX', 'programme_name': 'Marketing Level 4',
                'cohort_id': 'COH-CTX', 'cohort_name': 'September 2026',
                'group_id': 'GRP-CTX', 'group_name': 'Group A',
            }))
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-CTX', 'module_catalogue_id': 'MOD-CTX', 'week_id': 'WEEK-CTX',
            'type': 'quiz', 'title': 'Quiz 1', 'display_order': 0,
        }))
        context = self.snapshot(self.revisions('component', 'COMP-CTX')[0])[versioning.CONTEXT_KEY]
        self.assertEqual(context['programme_name'], 'Marketing Level 4')
        self.assertEqual(context['cohort_name'], 'September 2026')
        self.assertEqual(context['group_name'], 'Group A')
        self.assertEqual(context['module_name'], 'PPC')
        self.assertEqual(context['week_id'], 'WEEK-CTX')

    def test_renaming_a_parent_does_not_look_like_editing_the_child(self):
        """Ancestry is context, not content. A component must not report itself
        edited because the programme above it was renamed."""
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': 'MOD-REN', 'title': 'PPC',
                'programme_id': 'PROG-REN', 'programme_name': 'Old name',
            }))
        component = {
            'id': 'COMP-REN', 'module_catalogue_id': 'MOD-REN', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Quiz 1', 'display_order': 0,
        }
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], component))
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                'module_catalogue_id': 'MOD-REN', 'title': 'PPC', 'programme_name': 'New name',
            }))
        before = len(self.revisions('component', 'COMP-REN'))
        self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], component))
        self.assertEqual(len(self.revisions('component', 'COMP-REN')), before)


class AuditTrailEndpointTests(AuditHarness):
    """What the Audit Logs page is handed."""

    def trail(self, query=''):
        response = self.client.get(f'/curriculum_api/curriculum/quality/audit-trail/{query}')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_the_trail_reports_who_and_what_moved(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-UI', 'module_catalogue_id': 'MOD-UI', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Quiz 1', 'display_order': 0,
        }))
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-UI', 'module_catalogue_id': 'MOD-UI', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Final Quiz', 'display_order': 0,
        }))
        payload = self.trail()
        self.assertTrue(payload['authorRecorded'])
        self.assertEqual(payload['source'], 'revisions')
        event = next(item for item in payload['events'] if item['action'] == 'updated')
        self.assertEqual(event['actorName'], 'Ayman Badewi')
        self.assertEqual(event['entityLabel'], 'Component')
        # Human-readable, not the internal event name.
        self.assertEqual(event['actionLabel'], 'Edited')
        change = next(item for item in event['changes'] if item['field'] == 'title')
        self.assertEqual((change['before'], change['after']), ('Quiz 1', 'Final Quiz'))
        self.assertEqual(change['label'], 'Title')

    def test_a_delete_event_still_carries_what_was_deleted(self):
        self.sign_in()
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-DEL', 'module_catalogue_id': 'MOD-DEL', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': 'Doomed', 'display_order': 3,
        }))
        self.committed(lambda: views.authoring_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-DEL']))
        event = next(
            item for item in self.trail()['events']
            if item['action'] == 'deleted' and item['entityId'] == 'COMP-DEL'
        )
        self.assertEqual(event['snapshot']['title'], 'Doomed')
        self.assertEqual(event['actionLabel'], 'Deleted')

    def test_the_actor_filter_narrows_to_one_person(self):
        self.sign_in(name='Rachel Myers', email='rachel@kentbusinesscollege.com')
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-R', 'module_catalogue_id': 'MOD-F', 'week_id': 'W', 'type': 'quiz',
            'title': 'Rachel', 'display_order': 0,
        }))
        self.sign_in(name='Ayman Badewi', email='ayman@kentbusinesscollege.com')
        self.committed(lambda: views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-B', 'module_catalogue_id': 'MOD-F', 'week_id': 'W', 'type': 'quiz',
            'title': 'Ayman', 'display_order': 0,
        }))
        payload = self.trail('?actor=rachel@kentbusinesscollege.com')
        ids = {event['entityId'] for event in payload['events']}
        self.assertEqual(ids, {'COMP-R'})
        self.assertIn('rachel@kentbusinesscollege.com', [person['email'] for person in payload['actors']])

    def test_the_trail_still_answers_when_history_is_switched_off(self):
        """The older derived reading is the fallback, and says what it is."""
        with self.connection_cursor() as cursor:
            cursor.execute(f'drop table {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'drop table {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.reset_availability()
        payload = self.trail()
        self.assertFalse(payload['authorRecorded'])
        self.assertEqual(payload['source'], 'timestamps')


class SafetyTests(AuditHarness):
    """History is worth less than the content it describes."""

    def test_saving_still_works_with_history_switched_off(self):
        with self.connection_cursor() as cursor:
            cursor.execute(f'drop table {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'drop table {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.reset_availability()
        saved = self.committed(lambda: views.authoring_upsert(
            views.AUTHORING_COMPONENTS_TABLE, ['id'], {
                'id': 'COMP-OFF', 'module_catalogue_id': 'MOD-OFF', 'week_id': 'W',
                'type': 'reading', 'title': 'Written with history off', 'display_order': 0,
            }))
        self.assertEqual(saved['title'], 'Written with history off')

    def test_no_credential_columns_are_ever_snapshotted(self):
        """The snapshot is an allowlist, so a secret cannot arrive by accident."""
        forbidden = ('password', 'token', 'secret', 'api_key', 'cookie', 'credential')
        for entity_type, columns in versioning.SNAPSHOT_COLUMNS.items():
            for column in columns:
                for word in forbidden:
                    self.assertNotIn(
                        word, column.lower(),
                        f'{entity_type}.{column} looks like a credential',
                    )

    def test_a_join_url_is_not_stored_in_history(self):
        """A meeting's join link is the capability to enter it, not a fact about it."""
        columns = versioning.SNAPSHOT_COLUMNS['live_session']
        self.assertNotIn('join_url', columns)
        self.assertNotIn('web_link', columns)
        self.assertNotIn('meeting_options_url', columns)
        # Its identity is still traceable, which the Teams invariants require.
        self.assertIn('graph_event_id', columns)
