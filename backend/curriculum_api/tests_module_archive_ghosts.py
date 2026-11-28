"""How a running module came to hold a second, archived set of weeks.

On 21 Sep 2026 two AI in Marketing modules were duplicated, archived a minute
later, and duplicated again that afternoon. The second create matched the
archived copy by title and group and reused its id; the Builder's follow-up
save sent ``isProgrammeDeleted: false`` and cleared the archive on the module
row alone. The 17 weeks and 297 components archived with it kept their stamp,
so learners saw the old set first and a Restore would have revived it.

Pinned here, against the real tables (PostgreSQL only):

1. a create never adopts an archived module's id;
2. a save that claims an archived module is live is refused, untouched;
3. a Restore, and the archive view, take only the rows that archive stamped.
"""
import json
from datetime import datetime, timedelta
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import connection
from django.test import Client, SimpleTestCase, TestCase

from . import views

IS_POSTGRES = settings.DATABASES.get('default', {}).get('ENGINE', '').endswith('postgresql')

# The create endpoint matches an existing module on title AND programme, cohort
# and group (identity_values_match_context), so the scope is always sent -- the
# incident's duplicate carried all four.
PROGRAMME = {
    'programmeId': 'PROG-GHOST-TEST', 'programmeName': 'Archive Ghost Test Programme',
    'cohortId': 'COHORT-GHOST-TEST', 'cohortName': 'Ghost Test Cohort',
    'groupId': 'GROUP-GHOST-TEST', 'groupName': 'Ghost Test Group',
}


def week(week_id, number, title, component_ids=()):
    return {
        'id': week_id,
        'weekNumber': number,
        'title': title,
        'components': [
            {'id': component_id, 'type': 'reading', 'title': f'{title} reading', 'settings': {}}
            for component_id in component_ids
        ],
    }


@skipUnless(IS_POSTGRES, 'needs the PostgreSQL curriculum schema')
class ModuleArchiveGhostTests(TestCase):
    databases = {'default', 'enrolment'}

    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self.client = Client()
        # Groups and modules hold a foreign key to their programme.
        with connection.cursor() as cursor:
            cursor.execute(
                "insert into curriculum.programmes (programme_id, name, color, status, created_at, updated_at) "
                "values (%s, %s, '', 'active', now(), now()) on conflict (programme_id) do nothing",
                [PROGRAMME['programmeId'], PROGRAMME['programmeName']],
            )
        # Every save also runs the tree-wide parent-link repair. On a copy of
        # production that repair trips over unrelated rows (it detaches a group
        # by writing programme_id = '', which the foreign key refuses), and it
        # is not what these tests are about.
        repair = patch.object(views, 'repair_curriculum_parent_links', lambda *args, **kwargs: None)
        repair.start()
        self.addCleanup(repair.stop)
        # login.middleware releases the connection after every request. Inside
        # a TestCase that connection is the test's open transaction, so the
        # release would drop it -- the same reason Django's test client
        # disconnects close_old_connections from request_finished.
        release = patch('login.middleware.close_old_connections', lambda: None)
        release.start()
        self.addCleanup(release.stop)

    # ------------------------------------------------------------- helpers

    def _save(self, module_id, title, weeks, **extra):
        return views.save_module_authoring_structure(module_id, {
            **PROGRAMME, 'title': title, 'weeksNumber': len(weeks), 'weekStructure': weeks, **extra,
        })

    def _module_row(self, module_id):
        rows = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
        return rows[0] if rows else {}

    def _rows(self, table, module_id):
        return views.authoring_fetch_all(table, 'module_catalogue_id = %s', [module_id])

    def _live_ids(self, table, module_id):
        return sorted(str(row['id']) for row in self._rows(table, module_id) if not row.get('deleted_at'))

    def _plant_earlier_archive(self, module_id):
        """Rows exactly as the 21 Sep archive left them: stamped, a day older."""
        earlier = datetime.utcnow() - timedelta(days=1)
        views.insert_row(views.AUTHORING_WEEKS_TABLE, {
            'id': f'{module_id}-OLD-W1', 'module_catalogue_id': module_id, 'week_number': 1,
            'display_order': 0, 'title': 'Event MasterClass', 'deleted_at': earlier,
            'deleted_by': 'module-delete', 'deleted_via_parent': module_id, 'is_programme_deleted': True,
        })
        views.insert_row(views.AUTHORING_COMPONENTS_TABLE, {
            'id': f'{module_id}-OLD-C1', 'module_catalogue_id': module_id, 'week_id': f'{module_id}-OLD-W1',
            'type': 'reading', 'title': 'Old reading', 'display_order': 0, 'deleted_at': earlier,
            'deleted_by': 'module-delete', 'deleted_via_parent': module_id, 'is_programme_deleted': True,
        })

    # ------------------------------------------------- 1. create never adopts

    def test_create_does_not_reuse_an_archived_modules_id(self):
        archived_id = 'MOD-GHOST-CREATE-ARCHIVED'
        self._save(archived_id, 'Ghost Create Copy', [week('WEEK-GC-1', 1, 'One', ['COMP-GC-1'])])
        views.delete_module_authoring_structure(archived_id)
        before = {row['id']: row['deleted_at'] for row in self._rows(views.AUTHORING_WEEKS_TABLE, archived_id)}

        response = self.client.post(
            '/curriculum_api/curriculum/modules/',
            data=json.dumps({**PROGRAMME, 'moduleType': 'authoring', 'title': 'Ghost Create Copy', 'weeks': 2}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201, response.content)
        created_id = response.json()['moduleCatalogueId']
        self.assertNotEqual(created_id, archived_id)
        self.assertIsNotNone(self._module_row(archived_id).get('deleted_at'))
        self.assertEqual(
            {row['id']: row['deleted_at'] for row in self._rows(views.AUTHORING_WEEKS_TABLE, archived_id)},
            before,
        )

    def test_create_still_returns_the_live_module_it_matches(self):
        live_id = 'MOD-GHOST-CREATE-LIVE'
        self._save(live_id, 'Ghost Create Live', [week('WEEK-GL-1', 1, 'One')])

        response = self.client.post(
            '/curriculum_api/curriculum/modules/',
            data=json.dumps({**PROGRAMME, 'moduleType': 'authoring', 'title': 'Ghost Create Live',
                             'weekStructure': [week('WEEK-GL-1', 1, 'One')]}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['moduleCatalogueId'], live_id)

    # ------------------------------------- 2. a stale "live" save is refused

    def test_saving_an_archived_module_as_live_is_refused_and_changes_nothing(self):
        module_id = 'MOD-GHOST-STALE-SAVE'
        self._save(module_id, 'Stale Save', [week('WEEK-SS-1', 1, 'One', ['COMP-SS-1'])])
        views.delete_module_authoring_structure(module_id)
        weeks_before = {row['id']: (row['deleted_at'], row['deleted_via_parent'])
                        for row in self._rows(views.AUTHORING_WEEKS_TABLE, module_id)}

        with self.assertRaises(views.ModuleAuthoringValidationError) as raised:
            self._save(module_id, 'Stale Save', [week('WEEK-SS-NEW', 1, 'Rebuilt', ['COMP-SS-NEW'])],
                       isProgrammeDeleted=False)

        self.assertEqual(raised.exception.errors[0]['message'], views.MODULE_ARCHIVED_SAVE_REFUSED)
        self.assertIsNotNone(self._module_row(module_id).get('deleted_at'))
        self.assertEqual(
            {row['id']: (row['deleted_at'], row['deleted_via_parent'])
             for row in self._rows(views.AUTHORING_WEEKS_TABLE, module_id)},
            weeks_before,
        )
        self.assertEqual(self._live_ids(views.AUTHORING_COMPONENTS_TABLE, module_id), [])

    def test_structure_endpoint_answers_a_stale_live_save_with_400(self):
        module_id = 'MOD-GHOST-STALE-PATCH'
        self._save(module_id, 'Stale Patch', [week('WEEK-SP-1', 1, 'One')])
        views.delete_module_authoring_structure(module_id)

        response = self.client.patch(
            f'/curriculum_api/curriculum/modules/{module_id}/structure/',
            data=json.dumps({**PROGRAMME, 'title': 'Stale Patch', 'isProgrammeDeleted': False,
                             'weekStructure': [week('WEEK-SP-NEW', 1, 'Rebuilt')]}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('Restore it from View archive', response.content.decode())
        self.assertIsNotNone(self._module_row(module_id).get('deleted_at'))

    # ------------------------------ 3. restore takes only its own archive

    def test_restore_brings_back_the_archive_and_never_an_earlier_one(self):
        module_id = 'MOD-GHOST-RESTORE'
        self._save(module_id, 'Ghost Restore', [
            week('WEEK-GR-1', 1, 'Introduction', ['COMP-GR-1']),
            week('WEEK-GR-2', 2, 'Data', ['COMP-GR-2']),
        ])
        self._plant_earlier_archive(module_id)
        views.delete_module_authoring_structure(module_id)

        archive_view = self.client.get(f'/curriculum_api/curriculum/modules/{module_id}/archived-structure/')
        self.assertEqual(archive_view.status_code, 200, archive_view.content)
        self.assertNotIn('Event MasterClass', archive_view.content.decode())
        self.assertIn('Introduction', archive_view.content.decode())

        response = self.client.post(f'/curriculum_api/curriculum/modules/{module_id}/restore/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['details'], {'weeks': 2, 'components': 2})
        self.assertIsNone(self._module_row(module_id).get('deleted_at'))
        self.assertEqual(self._live_ids(views.AUTHORING_WEEKS_TABLE, module_id), ['WEEK-GR-1', 'WEEK-GR-2'])
        self.assertEqual(self._live_ids(views.AUTHORING_COMPONENTS_TABLE, module_id), ['COMP-GR-1', 'COMP-GR-2'])
        old = {row['id']: row for row in self._rows(views.AUTHORING_WEEKS_TABLE, module_id)}[f'{module_id}-OLD-W1']
        self.assertIsNotNone(old['deleted_at'])
        self.assertEqual(old['deleted_via_parent'], module_id)

    def test_archive_then_restore_round_trips_a_clean_module(self):
        module_id = 'MOD-GHOST-ROUNDTRIP'
        self._save(module_id, 'Round Trip', [
            week('WEEK-RT-1', 1, 'One', ['COMP-RT-1', 'COMP-RT-2']),
            week('WEEK-RT-2', 2, 'Two', ['COMP-RT-3']),
        ])
        live_weeks = self._live_ids(views.AUTHORING_WEEKS_TABLE, module_id)
        live_components = self._live_ids(views.AUTHORING_COMPONENTS_TABLE, module_id)
        views.delete_module_authoring_structure(module_id)
        self.assertEqual(self._live_ids(views.AUTHORING_WEEKS_TABLE, module_id), [])

        response = self.client.post(f'/curriculum_api/curriculum/modules/{module_id}/restore/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._live_ids(views.AUTHORING_WEEKS_TABLE, module_id), live_weeks)
        self.assertEqual(self._live_ids(views.AUTHORING_COMPONENTS_TABLE, module_id), live_components)


class ArchiveWindowTests(SimpleTestCase):
    """The pure part of the rule: no database rows needed."""

    def test_row_outside_the_archive_moment_is_not_part_of_it(self):
        archived = datetime(2026, 10, 1, 10, 0, 0)
        bounds = views.module_archive_event_bounds({'deleted_at': archived})
        stamped = {'deleted_at': archived - timedelta(seconds=2), 'deleted_via_parent': 'MOD-1',
                   'is_programme_deleted': True}
        stale = {**stamped, 'deleted_at': archived - timedelta(days=10)}
        markers = {'MOD-1'}

        self.assertTrue(views.row_in_module_archive(stamped, markers, bounds))
        self.assertFalse(views.row_in_module_archive(stale, markers, bounds))
        # Without bounds the marker alone decides, as before.
        self.assertTrue(views.row_in_module_archive(stale, markers))

    def test_a_module_without_a_stamp_has_no_window(self):
        self.assertIsNone(views.module_archive_event_bounds({'deleted_at': None}))
        self.assertIsNone(views.module_archive_event_bounds({}))
