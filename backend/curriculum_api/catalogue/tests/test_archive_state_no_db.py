"""Archive state on the normalised schema: status + provenance read from history."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import archive_state
from curriculum_api.versioning import snapshot_archived

T0 = datetime(2026, 10, 2, 23, 48, tzinfo=timezone.utc)
LOOKUPS = {'modules': {'MOD-1': {'programme_id': 'PROG-1'}}}


class StatusTests(SimpleTestCase):
    def test_inactive_and_legacy_archived_read_as_archived(self):
        self.assertTrue(archive_state.row_inactive({'status': 'inactive'}))
        self.assertTrue(archive_state.row_inactive({'status': 'Archived'}))
        self.assertFalse(archive_state.row_inactive({'status': 'planned'}))
        self.assertFalse(archive_state.row_inactive({}))

    def test_sql_predicates_name_the_alias(self):
        self.assertEqual(archive_state.live_sql('m'), "m.\"status\" not in ('inactive', 'archived')")
        self.assertEqual(archive_state.inactive_sql(), "\"status\" in ('inactive', 'archived')")

    def test_archived_is_written_as_inactive_on_lifecycle_tables_only(self):
        self.assertEqual(archive_state.normalise_write('cohorts', {'status': 'archived'}), {'status': 'inactive'})
        self.assertEqual(archive_state.normalise_write('cohorts', {'status': 'planned'}), {'status': 'planned'})
        self.assertEqual(archive_state.normalise_write('week_templates', {'status': 'archived'}), {'status': 'archived'})


class ProvenanceTests(SimpleTestCase):
    def annotate(self, table, rows, archives):
        with patch.object(archive_state, '_latest_archives', return_value=archives), \
                patch('curriculum_api.curriculum_names.lookups', return_value=LOOKUPS), \
                patch.object(archive_state, 'connection') as connection:
            connection.vendor = 'postgresql'
            return archive_state.annotate(table, rows)

    def test_recorded_parent_wins(self):
        row = {'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'status': 'inactive'}
        self.annotate('weeks', [row], {'WEEK-1': (T0, 'week-delete', 'MOD-9')})
        self.assertEqual(row['deleted_via_parent'], 'MOD-9')
        self.assertEqual(row['deleted_by'], 'week-delete')
        self.assertEqual(row['deleted_at'], T0)

    def test_legacy_cascade_reason_names_the_parent(self):
        week = {'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'status': 'inactive'}
        self.annotate('weeks', [week], {'WEEK-1': (T0, 'module-delete', '')})
        self.assertEqual(week['deleted_via_parent'], 'MOD-1')
        component = {'id': 'COMP-1', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1', 'status': 'inactive'}
        self.annotate('components', [component], {'COMP-1': (T0, 'programme-delete', '')})
        self.assertEqual(component['deleted_via_parent'], 'PROG-1')

    def test_standalone_and_ambiguous_archives_have_no_parent(self):
        module = {'module_catalogue_id': 'MOD-1', 'programme_id': 'PROG-1', 'status': 'inactive'}
        self.annotate('modules', [module], {'MOD-1': (T0, 'module-delete', '')})
        self.assertIsNone(module['deleted_via_parent'])
        group = {'group_id': 'G-1', 'cohort_id': 'C-1', 'programme_id': 'PROG-1', 'status': 'inactive'}
        self.annotate('groups', [group], {'G-1': (T0, 'programme-tree-save', '')})
        self.assertIsNone(group['deleted_via_parent'])

    def test_live_rows_carry_no_archive_facts(self):
        row = {'id': 'WEEK-2', 'status': 'active', 'deleted_at': 'stale'}
        self.annotate('weeks', [row], {})
        self.assertIsNone(row['deleted_at'])
        self.assertIsNone(row['deleted_via_parent'])

    def test_restore_takes_only_rows_archived_with_the_parent_in_the_same_moment(self):
        rows = [
            {'id': 'W-with', 'module_catalogue_id': 'MOD-1', 'status': 'inactive'},
            {'id': 'W-own', 'module_catalogue_id': 'MOD-1', 'status': 'inactive'},
            {'id': 'W-earlier', 'module_catalogue_id': 'MOD-1', 'status': 'inactive'},
        ]
        archives = {
            'W-with': (T0, 'module-delete', ''),
            'W-own': (T0, 'week-delete', ''),
            'W-earlier': (T0 - timedelta(days=3), 'module-delete', ''),
        }
        with patch.object(archive_state, '_latest_archives', return_value=archives), \
                patch('curriculum_api.curriculum_names.lookups', return_value=LOOKUPS), \
                patch.object(archive_state, 'connection') as connection:
            connection.vendor = 'postgresql'
            chosen = archive_state.archived_with('weeks', 'MOD-1', rows, archive_state.event_bounds(T0))
        self.assertEqual([row['id'] for row in chosen], ['W-with'])


class HistoryActionTests(SimpleTestCase):
    def test_status_snapshots_record_archives_on_lifecycle_types(self):
        self.assertTrue(snapshot_archived({'status': 'inactive', 'deleted_at': None}, 'module'))
        self.assertFalse(snapshot_archived({'status': 'inactive'}, 'week_template'))
        self.assertTrue(snapshot_archived({'deleted_at': '2026-01-01'}, 'week_template'))
        self.assertFalse(snapshot_archived({'status': 'active', 'deleted_at': None}, 'component'))
