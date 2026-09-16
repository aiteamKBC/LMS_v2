"""Auto-save safety for the Module Builder's structure endpoint.

The Module Builder writes the WHOLE structure back on every save: the PATCH
soft-deletes every week, component and KSB mapping the module owns and re-writes
what the payload carries. Two things follow, and both are tested here.

A read that is allowed to be stale is not a stale screen, it is the next save
writing pre-edit weeks over the stored ones -- so the workspace's no-cache read
has to reach the database.

And a payload built from one version of the module must not be allowed to land
on another. Auto-save makes that ordinary rather than exotic: a second tab, or a
colleague, now saves while a first tab is still holding a copy it read minutes
ago. The revision check is what refuses that write instead of performing it.
"""
import json

from django.core.cache import cache

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


STRUCTURE_URL = '/curriculum_api/curriculum/modules/%s/structure/'


class ModuleStructureRevisionTests(CurriculumPersistenceHarness):
    """The optimistic-concurrency guard on the full-structure write."""

    def setUp(self):
        super().setUp()
        # Django's cache is a process-local LocMemCache here and survives the
        # per-test transaction rollback, while the shared epoch its keys are
        # built from does not -- so without this, test two is served test one's
        # cached structure under a re-used generation number.
        cache.clear()
        self.module_id = 'MOD-AUTOSAVE-REVISION'
        views.save_module_authoring_structure(self.module_id, {
            'title': 'Marketing',
            'programmeName': 'Marketing Manager',
            'weeksNumber': 1,
            'weekStructure': [{
                'id': 'WEEK-REV-1',
                'weekNumber': 1,
                'title': 'Week one',
                'components': [
                    {'id': 'COMP-REV-1', 'type': 'reading', 'title': 'Opening reading', 'settings': {}},
                ],
            }],
        })

    def read_structure(self):
        """Read the module the way the Module Builder reads it: no-cache."""
        response = self.client.get(
            STRUCTURE_URL % self.module_id, HTTP_CACHE_CONTROL='no-cache',
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def save_structure(self, module, **extra):
        return self.client.patch(
            STRUCTURE_URL % self.module_id,
            data=json.dumps({**module, **extra}),
            content_type='application/json',
        )

    def stored_component_titles(self):
        rows = views.active_component_rows(views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [self.module_id],
        ))
        return sorted(str(row.get('title') or '') for row in rows)

    def test_the_structure_read_names_the_revision_it_was_built_from(self):
        # Without this the client has nothing to send back, and every save is a
        # last-write-wins replacement of the whole module.
        module = self.read_structure()
        self.assertTrue(module['structureRevision'])
        self.assertEqual(module['structureRevision'], views.module_structure_revision(self.module_id))

    def test_a_save_carrying_the_current_revision_is_accepted(self):
        module = self.read_structure()
        module['weekStructure'][0]['components'][0]['title'] = 'Opening reading, revised'

        response = self.save_structure(module, expectedRevision=module['structureRevision'])

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.stored_component_titles(), ['Opening reading, revised'])
        # And the reply arms the next save, so a workspace that stays open does
        # not have to re-read the module between edits to keep saving.
        self.assertEqual(response.json()['structureRevision'], views.module_structure_revision(self.module_id))

    def test_a_save_carrying_a_superseded_revision_is_refused(self):
        stale = self.read_structure()
        newer = self.read_structure()
        newer['weekStructure'][0]['title'] = 'Week one, renamed'
        self.assertEqual(
            self.save_structure(newer, expectedRevision=newer['structureRevision']).status_code,
            200,
        )

        stale['weekStructure'][0]['title'] = 'Week one, from the stale tab'
        response = self.save_structure(stale, expectedRevision=stale['structureRevision'])

        self.assertEqual(response.status_code, 409, response.content)
        body = response.json()
        self.assertTrue(body['conflict'])
        self.assertEqual(body['expectedRevision'], stale['structureRevision'])
        self.assertNotEqual(body['currentRevision'], stale['structureRevision'])
        self.assertIn('changed after you opened it', body['error'])

    def test_the_refused_save_leaves_the_newer_structure_exactly_as_it_was(self):
        # The point of the refusal. A 409 that had already written half the
        # payload would be worse than no check at all.
        stale = self.read_structure()
        newer = self.read_structure()
        newer['weekStructure'][0]['components'].append({
            'id': 'COMP-REV-2', 'type': 'reading', 'title': 'Added by the other tab', 'settings': {},
        })
        self.assertEqual(
            self.save_structure(newer, expectedRevision=newer['structureRevision']).status_code,
            200,
        )
        revision_after_the_accepted_save = views.module_structure_revision(self.module_id)

        # The stale tab still holds the one-component module it read first.
        stale['weekStructure'][0]['components'][0]['title'] = 'Renamed by the stale tab'
        response = self.save_structure(stale, expectedRevision=stale['structureRevision'])

        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.stored_component_titles(), ['Added by the other tab', 'Opening reading'])
        self.assertEqual(views.module_structure_revision(self.module_id), revision_after_the_accepted_save)
        # The refusal carries the current structure, so the tab can show what it
        # is about to lose rather than only being told to reload.
        self.assertEqual(len(response.json()['module']['weekStructure'][0]['components']), 2)

    def test_two_tabs_holding_the_same_revision_cannot_both_pass_the_check(self):
        # Requirement M, end to end: both tabs open revision N, both edit, and
        # the second one to arrive is refused rather than overwriting the first.
        tab_a = self.read_structure()
        tab_b = self.read_structure()
        self.assertEqual(tab_a['structureRevision'], tab_b['structureRevision'])

        tab_a['weekStructure'][0]['title'] = 'Saved by tab A'
        self.assertEqual(
            self.save_structure(tab_a, expectedRevision=tab_a['structureRevision']).status_code,
            200,
        )

        tab_b['weekStructure'][0]['title'] = 'Saved by tab B'
        self.assertEqual(
            self.save_structure(tab_b, expectedRevision=tab_b['structureRevision']).status_code,
            409,
        )

        stored = views.get_authoring_structure_payload(self.module_id)
        self.assertEqual(stored['weekStructure'][0]['title'], 'Saved by tab A')

    def test_consecutive_saves_keep_working_without_re_reading_the_module(self):
        # The auto-save loop: edit, save, edit, save, with the workspace never
        # going back to the structure endpoint. Each reply has to arm the next
        # save, or the second edit in a session would always conflict with the
        # first one's own write.
        module = self.read_structure()
        revision = module['structureRevision']
        for title in ('First edit', 'Second edit', 'Third edit'):
            module['weekStructure'][0]['title'] = title
            response = self.save_structure(module, expectedRevision=revision)
            self.assertEqual(response.status_code, 200, response.content)
            revision = response.json()['structureRevision']

        stored = views.get_authoring_structure_payload(self.module_id)
        self.assertEqual(stored['weekStructure'][0]['title'], 'Third edit')

    def test_a_save_that_rewrites_the_same_content_leaves_the_revision_alone(self):
        # Two tabs that agree have nothing to conflict about. A fingerprint that
        # moved on every write, changed content or not, would make one tab's
        # harmless re-save refuse the other tab's real edit.
        module = self.read_structure()
        settled = self.save_structure(module, expectedRevision=module['structureRevision']).json()

        response = self.save_structure(module, expectedRevision=settled['structureRevision'])

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['structureRevision'], settled['structureRevision'])

    def test_a_caller_that_sends_no_revision_still_saves(self):
        # The programme tree save, the wizard, the Excel import and a module's
        # very first save all write here without ever having read a revision.
        module = self.read_structure()
        module['weekStructure'][0]['title'] = 'Written without a revision'

        self.assertEqual(self.save_structure(module).status_code, 200)

        stored = views.get_authoring_structure_payload(self.module_id)
        self.assertEqual(stored['weekStructure'][0]['title'], 'Written without a revision')

    def test_the_revision_moves_for_a_write_that_never_touched_this_endpoint(self):
        # The fingerprint is taken from the stored rows, not from a counter this
        # endpoint increments, so a component deleted through its own route is
        # still a reason to refuse a structure payload built before it.
        before = views.module_structure_revision(self.module_id)
        response = self.client.delete(
            '/curriculum_api/curriculum/modules/%s/components/COMP-REV-1/' % self.module_id,
        )
        self.assertEqual(response.status_code, 200, response.content)

        self.assertNotEqual(views.module_structure_revision(self.module_id), before)

    def test_a_conflict_writes_nothing_and_moves_no_cache_generation(self):
        # A refused save must not read as a curriculum write: bumping the shared
        # epoch would retire every worker's cached payload across the estate for
        # a request that changed nothing.
        stale = self.read_structure()
        newer = self.read_structure()
        newer['weekStructure'][0]['title'] = 'Moved on'
        self.save_structure(newer, expectedRevision=newer['structureRevision'])

        epoch_before = views.read_shared_curriculum_epoch_row()
        response = self.save_structure(stale, expectedRevision=stale['structureRevision'])

        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(views.read_shared_curriculum_epoch_row(), epoch_before)

    def test_an_accepted_save_moves_the_shared_cache_generation_once(self):
        module = self.read_structure()
        module['weekStructure'][0]['title'] = 'Worth invalidating'
        epoch_before = views.read_shared_curriculum_epoch_row()

        self.assertEqual(
            self.save_structure(module, expectedRevision=module['structureRevision']).status_code,
            200,
        )

        # One save, one generation -- the write helpers invalidate per written
        # row and the request scope collapses that into a single bump.
        self.assertEqual(views.read_shared_curriculum_epoch_row(), epoch_before + 1)


class ModuleStructureFreshReadTests(CurriculumPersistenceHarness):
    """The Module Builder's no-cache read has to reach the database."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.module_id = 'MOD-AUTOSAVE-FRESH'
        views.save_module_authoring_structure(self.module_id, {
            'title': 'Cached module',
            'weeksNumber': 1,
            'weekStructure': [{'id': 'WEEK-FRESH-1', 'weekNumber': 1, 'title': 'As it was cached'}],
        })

    def week_title(self, headers=None):
        response = self.client.get(STRUCTURE_URL % self.module_id, **(headers or {}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['weekStructure'][0]['title']

    def rename_the_week_behind_the_cache(self, title):
        """Write the row the way another worker would: without invalidating here.

        The bug this guards was exactly this shape -- the database moved, this
        process's cache did not, and the endpoint served the cache anyway.
        """
        views.authoring_bulk_upsert(views.AUTHORING_WEEKS_TABLE, ['id'], [{
            'id': 'WEEK-FRESH-1',
            'module_catalogue_id': self.module_id,
            'week_number': 1,
            'title': title,
        }])

    def test_a_no_cache_read_returns_what_the_database_holds_now(self):
        self.assertEqual(self.week_title(), 'As it was cached')
        self.rename_the_week_behind_the_cache('As it is stored')

        self.assertEqual(
            self.week_title({'HTTP_CACHE_CONTROL': 'no-cache'}),
            'As it is stored',
        )
        # And the ?skipCache= form the curriculum client actually sends.
        response = self.client.get((STRUCTURE_URL % self.module_id) + '?skipCache=true')
        self.assertEqual(response.json()['weekStructure'][0]['title'], 'As it is stored')

    def test_a_cached_read_carries_the_cached_revision_so_its_save_is_refused(self):
        # The protection that matters even when a caller does read stale: the
        # revision travels with the payload it describes, so a save built from a
        # cached copy cannot pass the check.
        cached = self.client.get(STRUCTURE_URL % self.module_id).json()
        self.rename_the_week_behind_the_cache('Authored elsewhere')

        response = self.client.patch(
            STRUCTURE_URL % self.module_id,
            data=json.dumps({**cached, 'expectedRevision': cached['structureRevision']}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 409, response.content)
        stored = views.get_authoring_structure_payload(self.module_id)
        self.assertEqual(stored['weekStructure'][0]['title'], 'Authored elsewhere')
