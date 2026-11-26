"""Server-enforced concurrency for the authoring records a drawer holds open.

The Module Builder's structure PATCH has had an ``expectedRevision`` guard for a
while (``tests_module_autosave``). The four drawers and the Week Builder did not:
each one sends back every field it renders, so whichever save landed second put
the other editor's work back to what it was, and nothing anywhere said so.

Their only protection was that a poll usually reached the second editor first.
That makes correctness a property of timing, which is another way of saying it
is not a property at all -- two people saving within the polling window still
lost one of the two edits. These tests are written as that race rather than as
an API contract: each one starts two editors on the same revision and saves
twice with no read in between.

What SQLite can and cannot show is worth stating plainly. It runs the check and
the refusal exactly as production does, so everything below is real. It cannot
exercise Postgres row-level locking, because a SQLite write transaction takes
the whole database -- so the ``select ... for update`` in ``lock_record_row``
is covered by inspection and by the structure endpoint it was copied from, not
by these tests. See the handover notes.
"""
import json
from unittest import mock

from django.core.cache import cache

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


class RecordConcurrencyHarness(CurriculumPersistenceHarness):
    """One programme, cohort, group and module, and two editors on each."""

    def setUp(self):
        super().setUp()
        # The process-local cache survives the per-test rollback while the epoch
        # its keys are built from does not, so without this a later test is
        # served an earlier one's payload. Same reason tests_module_autosave
        # clears it.
        cache.clear()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

    def patch_with(self, path, payload, revision):
        """A save from an editor holding ``revision``."""
        return self.client.patch(
            path,
            data=json.dumps({**payload, 'expectedRevision': revision}),
            content_type='application/json',
        )

    def assertConflict(self, response, expected_revision):
        """A refusal that names both versions and wrote nothing."""
        self.assertEqual(response.status_code, 409, response.content)
        body = response.json()
        self.assertTrue(body['conflict'])
        self.assertEqual(body['expectedRevision'], expected_revision)
        self.assertNotEqual(body['currentRevision'], expected_revision)
        self.assertTrue(body['currentRevision'])
        return body


class CohortRecordConcurrencyTests(RecordConcurrencyHarness):
    URL = '/curriculum_api/curriculum/cohorts/COHORT-DATA-1/'

    def revision(self):
        return views.cohort_record_revision('COHORT-DATA-1')

    def stored(self):
        return self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')

    # A. Different fields, same starting revision.
    def test_a_stale_save_of_another_field_is_refused_then_succeeds_on_rebase(self):
        shared = self.revision()

        first = self.patch_with(self.URL, {'name': 'A renamed it'}, shared)
        self.assertEqual(first.status_code, 200, first.content)

        # B never polled. Their save carries the colour they changed AND the old
        # name they read, which is precisely what used to undo A's rename.
        refused = self.patch_with(self.URL, {'name': 'September 2026', 'color': '#111111'}, shared)
        body = self.assertConflict(refused, shared)
        self.assertEqual(self.stored()['cohort_name'], 'A renamed it')

        # The stored record travels with the refusal, so B rebases without a
        # second call: they keep their colour and take A's name.
        self.assertEqual(body['cohort']['name'], 'A renamed it')
        retry = self.patch_with(
            self.URL,
            {'name': body['cohort']['name'], 'color': '#111111'},
            body['currentRevision'],
        )
        self.assertEqual(retry.status_code, 200, retry.content)

        row = self.stored()
        self.assertEqual(row['cohort_name'], 'A renamed it')
        self.assertEqual(row['color'], '#111111')

    # B. Same field.
    def test_the_same_field_from_both_editors_still_refuses_the_stale_one(self):
        shared = self.revision()
        self.patch_with(self.URL, {'name': 'A renamed it'}, shared)

        refused = self.patch_with(self.URL, {'name': 'B renamed it'}, shared)
        body = self.assertConflict(refused, shared)
        # Nothing of A's was overwritten, and B is handed A's value to show.
        self.assertEqual(self.stored()['cohort_name'], 'A renamed it')
        self.assertEqual(body['cohort']['name'], 'A renamed it')

        # The policy is unchanged by any of this: the editor who is present
        # keeps their own value, and it lands because the retry is current.
        retry = self.patch_with(self.URL, {'name': 'B renamed it'}, body['currentRevision'])
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(self.stored()['cohort_name'], 'B renamed it')

    # C. Near-simultaneous saves, with no poll between them.
    def test_two_saves_from_one_revision_cannot_both_land(self):
        shared = self.revision()

        outcomes = [
            self.patch_with(self.URL, {'name': 'A renamed it'}, shared).status_code,
            self.patch_with(self.URL, {'name': 'B renamed it'}, shared).status_code,
        ]

        # Exactly one stale write detected -- not "usually", and not "if a poll
        # happened to arrive". Nothing polled here at all.
        self.assertEqual(sorted(outcomes), [200, 409])

    # D. A third write during the rebase.
    def test_a_write_landing_during_the_retry_is_refused_again_not_looped(self):
        shared = self.revision()
        self.patch_with(self.URL, {'name': 'A renamed it'}, shared)
        second = self.assertConflict(
            self.patch_with(self.URL, {'color': '#111111'}, shared), shared,
        )

        # C saves while B is rebasing, so B's retry is stale in turn.
        self.patch_with(self.URL, {'name': 'C renamed it'}, second['currentRevision'])
        third = self.assertConflict(
            self.patch_with(self.URL, {'color': '#111111'}, second['currentRevision']),
            second['currentRevision'],
        )

        # Each refusal carries a different current revision, so a client
        # retrying is always moving forward rather than round a loop.
        self.assertNotEqual(third['currentRevision'], second['currentRevision'])
        retry = self.patch_with(self.URL, {'color': '#111111'}, third['currentRevision'])
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(self.stored()['cohort_name'], 'C renamed it')

    # E. Existing behaviour.
    def test_a_save_that_sends_no_revision_is_not_checked(self):
        # Every unguarded caller depends on this: the tree save, the wizard, the
        # Excel import. They never read a token and must keep working.
        self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        response = self.patch_json(self.URL, {'name': 'Unguarded'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.stored()['cohort_name'], 'Unguarded')

    def test_the_revision_moves_only_when_the_record_does(self):
        before = self.revision()
        # A save that changes nothing about the row still bumps updated_at, and
        # a token built on a timestamp would have changed here -- refusing the
        # next save for no reason anybody could see.
        self.patch_json(self.URL, {'name': 'September 2026'})
        self.assertEqual(self.revision(), before)

        self.patch_json(self.URL, {'name': 'Moved'})
        self.assertNotEqual(self.revision(), before)

    def test_an_accepted_save_hands_back_the_revision_it_produced(self):
        response = self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        self.assertEqual(response.json()['revision'], self.revision())
        # And that token is immediately usable, so a second save from the same
        # editor does not need a read in between.
        again = self.patch_with(self.URL, {'color': '#222222'}, response.json()['revision'])
        self.assertEqual(again.status_code, 200, again.content)

    def test_a_revision_for_a_record_that_is_not_stored_is_empty(self):
        self.assertEqual(views.cohort_record_revision('COHORT-NOT-STORED'), '')


class GroupRecordConcurrencyTests(RecordConcurrencyHarness):
    URL = '/curriculum_api/curriculum/groups/GROUP-DATA-1/'

    def revision(self):
        return views.group_record_revision('GROUP-DATA-1')

    def stored(self):
        return self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')

    def test_a_stale_save_cannot_put_back_the_delivery_slot(self):
        shared = self.revision()

        moved = self.patch_with(self.URL, {'weekDays': 'Thursday'}, shared)
        self.assertEqual(moved.status_code, 200, moved.content)

        # B renames the group and carries the Monday they read with it. This is
        # the case that mattered most: the slot is what the Teams calendar is
        # built from, so undoing it silently moves real meetings.
        refused = self.patch_with(self.URL, {'name': 'B renamed it', 'weekDays': 'Monday'}, shared)
        body = self.assertConflict(refused, shared)
        self.assertEqual(self.stored()['session_week_day'], 'Thursday')
        self.assertEqual(body['group']['weekDays'], 'Thursday')

        retry = self.patch_with(
            self.URL,
            {'name': 'B renamed it', 'weekDays': body['group']['weekDays']},
            body['currentRevision'],
        )
        self.assertEqual(retry.status_code, 200, retry.content)
        row = self.stored()
        self.assertEqual(row['group_name'], 'B renamed it')
        self.assertEqual(row['session_week_day'], 'Thursday')

    def test_two_saves_from_one_revision_cannot_both_land(self):
        shared = self.revision()
        outcomes = [
            self.patch_with(self.URL, {'name': 'A renamed it'}, shared).status_code,
            self.patch_with(self.URL, {'name': 'B renamed it'}, shared).status_code,
        ]
        self.assertEqual(sorted(outcomes), [200, 409])

    def test_a_save_that_sends_no_revision_is_not_checked(self):
        self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        response = self.patch_json(self.URL, {'name': 'Unguarded'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_accepted_save_hands_back_the_revision_it_produced(self):
        response = self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['revision'], self.revision())

    def test_the_modules_the_slot_cascades_onto_are_left_out_of_the_token(self):
        # The group's modules inherit its slot, so folding them in would report
        # a module's own edit as a change to the group -- and refuse a group
        # save nobody had raced.
        before = self.revision()
        views.update_authoring_rows(
            views.AUTHORING_MODULES_TABLE, 'group_id = %s', ['GROUP-DATA-1'], {'title': 'Retitled by hand'},
        )
        self.assertEqual(self.revision(), before)


class ProgrammeRecordConcurrencyTests(RecordConcurrencyHarness):
    URL = '/curriculum_api/curriculum/programmes/PROG-DATA/'

    def setUp(self):
        super().setUp()
        # Only the RESPONSE is stubbed, never the guard or the write. A
        # successful programme PATCH answers with `first_programme_response`,
        # which rebuilds the whole curriculum payload and reads assigned-learner
        # counts across the `enrolment` alias -- long-standing behaviour that
        # has nothing to do with concurrency, and that the sqlite runner cannot
        # serve (the alias is a mirror of the same file, and the second
        # connection hits "database schema is locked"). Everything these tests
        # assert on -- the revision, the refusal, the stored row -- is read
        # back from the database, not from this stub.
        patcher = mock.patch.object(
            views, 'first_programme_response', side_effect=lambda *ids: {'id': 'PROG-DATA'},
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def revision(self):
        return views.programme_record_revision('PROG-DATA')

    def stored(self):
        return views.programme_config_by_identifier('PROG-DATA')

    def test_a_stale_save_is_refused_then_succeeds_on_rebase(self):
        shared = self.revision()

        first = self.patch_with(self.URL, {'description': 'A wrote this'}, shared)
        self.assertEqual(first.status_code, 200, first.content)

        refused = self.patch_with(self.URL, {'color': '#123456', 'description': ''}, shared)
        body = self.assertConflict(refused, shared)
        self.assertEqual(self.stored()['description'], 'A wrote this')
        self.assertEqual(body['programme']['description'], 'A wrote this')

        retry = self.patch_with(
            self.URL,
            {'color': '#123456', 'description': body['programme']['description']},
            body['currentRevision'],
        )
        self.assertEqual(retry.status_code, 200, retry.content)
        row = self.stored()
        self.assertEqual(row['description'], 'A wrote this')
        self.assertEqual(row['color'], '#123456')

    def test_two_saves_from_one_revision_cannot_both_land(self):
        shared = self.revision()
        outcomes = [
            self.patch_with(self.URL, {'description': 'A wrote this'}, shared).status_code,
            self.patch_with(self.URL, {'description': 'B wrote this'}, shared).status_code,
        ]
        self.assertEqual(sorted(outcomes), [200, 409])

    def test_a_save_that_sends_no_revision_is_not_checked(self):
        self.patch_with(self.URL, {'description': 'A wrote this'}, self.revision())
        response = self.patch_json(self.URL, {'description': 'Unguarded'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_accepted_save_hands_back_the_revision_it_produced(self):
        response = self.patch_with(self.URL, {'description': 'A wrote this'}, self.revision())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['revision'], self.revision())

    def test_the_child_rename_cascade_is_left_out_of_the_token(self):
        # Renaming a programme writes programme_name onto every cohort, group
        # and module under it. Those are copies of this row, not edits to it.
        before = self.revision()
        views.propagate_programme_name('PROG-DATA', 'Carried down')
        self.assertEqual(self.revision(), before)


class ModuleDrawerConcurrencyTests(RecordConcurrencyHarness):
    URL = '/curriculum_api/curriculum/modules/MOD-DATA-1/'

    def revision(self):
        return views.module_record_revision('MOD-DATA-1')

    def stored(self):
        return self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')

    def test_the_drawer_shares_the_builder_token(self):
        # Not a token of its own: the drawer writes through the same helper the
        # Module Builder's structure PATCH uses, so a Builder save has to make a
        # drawer copy stale and the other way round.
        self.assertEqual(
            views.module_record_revision('MOD-DATA-1'),
            views.module_structure_revision('MOD-DATA-1'),
        )

    def test_a_stale_save_is_refused_then_succeeds_on_rebase(self):
        shared = self.revision()

        first = self.patch_with(self.URL, {'name': 'A renamed it'}, shared)
        self.assertEqual(first.status_code, 200, first.content)

        refused = self.patch_with(self.URL, {'name': 'Module One', 'tutor': 'Tutor Two'}, shared)
        body = self.assertConflict(refused, shared)
        self.assertEqual(self.stored()['title'], 'A renamed it')
        self.assertEqual(body['module']['title'], 'A renamed it')

        retry = self.patch_with(
            self.URL,
            {'name': body['module']['title'], 'tutor': 'Tutor Two'},
            body['currentRevision'],
        )
        self.assertEqual(retry.status_code, 200, retry.content)
        row = self.stored()
        self.assertEqual(row['title'], 'A renamed it')
        self.assertEqual(row['tutor_name'], 'Tutor Two')

    def test_two_saves_from_one_revision_cannot_both_land(self):
        shared = self.revision()
        outcomes = [
            self.patch_with(self.URL, {'name': 'A renamed it'}, shared).status_code,
            self.patch_with(self.URL, {'name': 'B renamed it'}, shared).status_code,
        ]
        self.assertEqual(sorted(outcomes), [200, 409])

    def test_a_save_that_sends_no_revision_is_not_checked(self):
        self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        response = self.patch_json(self.URL, {'name': 'Unguarded'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_accepted_save_hands_back_the_revision_it_produced(self):
        response = self.patch_with(self.URL, {'name': 'A renamed it'}, self.revision())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['revision'], self.revision())

    def test_a_builder_structure_save_makes_an_open_drawer_stale(self):
        drawer_held = self.revision()
        structure = self.client.get(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/structure/'
        ).json()
        saved = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/structure/',
            data=json.dumps({**structure, 'title': 'Saved in the Builder'}),
            content_type='application/json',
        )
        self.assertEqual(saved.status_code, 200, saved.content)

        refused = self.patch_with(self.URL, {'name': 'Saved in the drawer'}, drawer_held)
        self.assertConflict(refused, drawer_held)


class WeekTemplateConcurrencyTests(RecordConcurrencyHarness):
    """The component list is the whole risk: a PATCH replaces it wholesale."""

    def setUp(self):
        super().setUp()
        created = self.post_json('/curriculum_api/curriculum/week-templates/', {
            'courseType': 'paid',
            'title': 'Week one',
            'components': [self.component('C1', 'Reading task')],
        })
        self.assertEqual(created.status_code, 200, created.content)
        self.template_id = created.json()['weekTemplate']['id']
        self.url = f'/curriculum_api/curriculum/week-templates/{self.template_id}/'

    def component(self, component_id, title):
        return {'id': component_id, 'type': 'reading', 'title': title, 'expectedOtjh': 1}

    def revision(self):
        return views.week_template_revision(self.template_id)

    def components(self):
        return [
            row['title']
            for row in views.get_week_template_component_rows(self.template_id)
        ]

    def test_a_create_hands_back_a_usable_revision(self):
        created = self.client.get(self.url).json()['weekTemplate']
        self.assertEqual(created['revision'], self.revision())

    def test_a_stale_save_cannot_replace_the_other_editor_components(self):
        shared = self.revision()

        first = self.patch_with(
            self.url,
            {'components': [self.component('C1', 'Reading task'), self.component('A-NEW', 'A added this')]},
            shared,
        )
        self.assertEqual(first.status_code, 200, first.content)

        # B saves the one-component list they loaded. Before the guard this
        # deleted A's component and reinserted only B's copy.
        refused = self.patch_with(
            self.url,
            {'components': [self.component('C1', 'Reading task'), self.component('B-NEW', 'B added this')]},
            shared,
        )
        body = self.assertConflict(refused, shared)
        self.assertIn('A added this', self.components())

        # The stored template travels with the refusal, components and all, so
        # B rebases onto it without a second call.
        stored_ids = [item['id'] for item in body['weekTemplate']['components']]
        self.assertEqual(stored_ids, ['C1', 'A-NEW'])
        retry = self.patch_with(
            self.url,
            {'components': [
                *[self.component(item['id'], item['title']) for item in body['weekTemplate']['components']],
                self.component('B-NEW', 'B added this'),
            ]},
            body['currentRevision'],
        )
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(self.components(), ['Reading task', 'A added this', 'B added this'])

    def test_two_saves_from_one_revision_cannot_both_land(self):
        shared = self.revision()
        outcomes = [
            self.patch_with(self.url, {'title': 'A renamed it'}, shared).status_code,
            self.patch_with(self.url, {'title': 'B renamed it'}, shared).status_code,
        ]
        self.assertEqual(sorted(outcomes), [200, 409])

    def test_a_component_edit_moves_the_token(self):
        # The header row alone would not: total_otjh and component_count are
        # unchanged by a retitle, so a token covering only the template row
        # would let a colleague's rewritten component list be replaced.
        before = self.revision()
        self.patch_json(self.url, {'components': [self.component('C1', 'Retitled')]})
        self.assertNotEqual(self.revision(), before)

    def test_a_save_that_sends_no_revision_is_not_checked(self):
        self.patch_with(self.url, {'title': 'A renamed it'}, self.revision())
        response = self.patch_json(self.url, {'title': 'Unguarded'})
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_accepted_save_hands_back_the_revision_it_produced(self):
        response = self.patch_with(self.url, {'title': 'A renamed it'}, self.revision())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['weekTemplate']['revision'], self.revision())


class RecordRevisionEndpointTests(RecordConcurrencyHarness):
    """Where a drawer gets its first token from."""

    URL = '/curriculum_api/curriculum/revisions/'

    def test_it_answers_several_records_of_several_kinds_at_once(self):
        response = self.client.get(
            self.URL, {'cohort': 'COHORT-DATA-1', 'group': 'GROUP-DATA-1', 'programme': 'PROG-DATA'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        revisions = response.json()['revisions']
        self.assertEqual(revisions['cohort']['COHORT-DATA-1'], views.cohort_record_revision('COHORT-DATA-1'))
        self.assertEqual(revisions['group']['GROUP-DATA-1'], views.group_record_revision('GROUP-DATA-1'))
        self.assertEqual(revisions['programme']['PROG-DATA'], views.programme_record_revision('PROG-DATA'))

    def test_a_kind_nobody_asked_about_is_left_out(self):
        response = self.client.get(self.URL, {'cohort': 'COHORT-DATA-1'})
        self.assertEqual(set(response.json()['revisions']), {'cohort'})

    def test_a_record_that_cannot_be_read_is_answered_with_an_empty_token(self):
        # Answered rather than omitted, so a caller can tell "unreadable" from
        # "not asked for". A drawer holding '' sends no token and saves
        # unguarded, which is what it did before any of this existed.
        response = self.client.get(self.URL, {'cohort': 'COHORT-NOT-STORED'})
        self.assertEqual(response.json()['revisions']['cohort']['COHORT-NOT-STORED'], '')

    def test_the_token_it_hands_out_is_the_one_the_save_checks(self):
        held = self.client.get(self.URL, {'cohort': 'COHORT-DATA-1'}).json()
        revision = held['revisions']['cohort']['COHORT-DATA-1']
        response = self.patch_with(
            '/curriculum_api/curriculum/cohorts/COHORT-DATA-1/', {'name': 'Renamed'}, revision,
        )
        self.assertEqual(response.status_code, 200, response.content)
