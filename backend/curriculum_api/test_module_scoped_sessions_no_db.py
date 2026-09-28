"""Run directly with Python. One module's sessions, read fresh; real builders, in-memory rows, no Django."""
import ast
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

NAMES = {'clean_str', 'module_scoped_sessions', 'curriculum_sessions', 'build_sessions_from_authoring_modules',
         'cohort_selected_holidays_by_id', 'detail_is_archived'}


class ModuleScopedSessionTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.modules = [
            {'module_catalogue_id': 'MOD-1', 'title': 'Data Foundations', 'status': 'published', 'cohort_id': 'COH-1',
             'group_id': 'GRP-1', 'session_start_time': '13:00', 'session_end_time': '15:00'},
            {'module_catalogue_id': 'MOD-2', 'title': 'Other module', 'status': 'published', 'cohort_id': 'COH-1',
             'group_id': 'GRP-1', 'session_start_time': '08:00', 'session_end_time': '10:00'},
        ]
        self.cohorts = [{'cohort_id': 'COH-1', 'start_date': '2026-09-01', 'excluded': ['HOL-UNTICKED'], 'status': 'active'}]
        self.groups = [{'group_id': 'GRP-1', 'session_start_time': '09:30', 'session_end_time': '11:30', 'status': 'active'}]
        self.holidays = [{'id': 'HOL-TICKED', 'date': '2026-09-16'}, {'id': 'HOL-UNTICKED', 'date': '2026-09-23'}]
        self.links = {
            'MOD-1': [{'date': day, 'weekId': f'W{i}', 'componentId': f'C{i}', 'startTime': '', 'durationMinutes': None}
                      for i, day in enumerate(['2026-09-09', '2026-09-16', '2026-09-23', ''])],
            'MOD-2': [{'date': '2026-09-10', 'weekId': 'W9', 'componentId': 'C9'}],
        }
        self.reads = []
        self.overview = Mock(return_value={'sessions': [
            {'moduleCatalogueId': 'LEGACY-1', 'moduleId': 'LEGACY-1', 'title': 'legacy'},
            {'moduleCatalogueId': 'MOD-9', 'moduleId': 'MOD-9', 'title': 'other'},
        ]})
        self.n = dict(
            date=date, SimpleNamespace=SimpleNamespace, require_GET=lambda view: view,
            AUTHORING_MODULES_TABLE='modules', COHORT_AUTHORING_DETAILS_TABLE='cohorts', GROUPS_TABLE='groups',
            authoring_fetch_all=self.fetch, get_holiday_rows_safe=lambda: self.holidays,
            programme_deleted_row=lambda row: bool((row or {}).get('deleted')),
            serialize_cohort_authoring_detail=lambda row, _holidays: {
                'cohortId': row['cohort_id'], 'startDate': row['start_date'], 'excludedHolidayIds': row['excluded'],
                'status': row['status'], 'deleted': row.get('deleted')},
            serialize_group_authoring_detail=lambda row: {
                'startTime': row['session_start_time'], 'endTime': row['session_end_time'], 'status': row['status']},
            scheduling_holidays_from=lambda rows, _start, excluded: [row for row in rows if row['id'] not in (excluded or [])],
            holiday_date_set=lambda rows: {date.fromisoformat(row['date']) for row in rows},
            authoring_session_links_by_catalogue=lambda ids: {key: self.links.get(key, []) for key in ids},
            module_live_session_clock=lambda module, _start, _duration, booked=False, session_date='', group_row=None: (
                (group_row or {}).get('session_start_time') or '00:00', (group_row or {}).get('session_end_time') or '00:00', 120),
            parse_date=lambda value: date.fromisoformat(value) if value else None,
            parse_json_value=lambda value, default: value or default, format_date=lambda value: value or '',
            slugify=lambda value: str(value).lower().replace(' ', '-'),
            curriculum_results_response=lambda results, request=None: {'results': results},
            curriculum_collection_response=lambda payload, key: {'results': payload[key], 'overview': True},
            get_cached_payload=self.overview,
            curriculum_visibility=lambda request: 'all' if request.GET.get('visibility') == 'all' else 'operational',
        )
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
        self.assertEqual({node.name for node in nodes}, NAMES)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'scoped-sessions', 'exec'), self.n)

    def fetch(self, table, where='', values=(), *args, **kwargs):
        self.reads.append((table, list(values)))
        rows = {'modules': self.modules, 'cohorts': self.cohorts, 'groups': self.groups}[table]
        column = where.split(' = ')[0]
        return [row for row in rows if row.get(column) == values[0]]

    def get(self, **query):
        return self.n['curriculum_sessions'](SimpleNamespace(GET=query))

    def test_matches_what_the_overview_lists_for_the_module(self):
        # What the overview builds for every module, from the whole curriculum's inputs.
        everything = self.n['build_sessions_from_authoring_modules'](
            self.modules,
            self.n['cohort_selected_holidays_by_id']([{'id': 'COH-1', 'startDate': '2026-09-01', 'excludedHolidayIds': ['HOL-UNTICKED']}], self.holidays),
            groups_by_id={'GRP-1': {'session_start_time': '09:30', 'session_end_time': '11:30'}},
        )
        expected = [session for session in everything if session['moduleCatalogueId'] == 'MOD-1']
        self.assertEqual(self.get(module_catalogue_id='MOD-1')['results'], expected)

    def test_dates_clock_and_holidays_come_from_the_modules_own_rows(self):
        sessions = self.get(module_catalogue_id='MOD-1')['results']
        # The undated component is a gap, never a date of our choosing.
        self.assertEqual([item['date'] for item in sessions], ['2026-09-09', '2026-09-16', '2026-09-23'])
        self.assertEqual({item['startTime'] for item in sessions}, {'09:30'})
        self.assertEqual([item['skippedHolidays'] for item in sessions], [[], ['2026-09-16'], []])
        self.assertEqual([item['componentId'] for item in sessions], ['C0', 'C1', 'C2'])
        # Only this module's rows were read, and never the cached overview.
        self.overview.assert_not_called()
        for table, values in self.reads:
            self.assertIn(values[0], {'MOD-1', 'COH-1', 'GRP-1'}, table)

    def test_archived_group_takes_the_clock_the_overview_rebuilds_it_with(self):
        self.groups[0]['status'] = 'archived'
        sessions = self.get(module_catalogue_id='MOD-1')['results']
        self.assertEqual({item['startTime'] for item in sessions}, {'13:00'})

    def test_archived_cohort_warns_about_no_holiday(self):
        self.cohorts[0]['status'] = 'archived'
        self.assertEqual([item['skippedHolidays'] for item in self.get(module_catalogue_id='MOD-1')['results']], [[], [], []])

    def test_deleted_programme_module_delivers_nothing(self):
        self.modules[0]['deleted'] = True
        self.assertEqual(self.get(module_catalogue_id='MOD-1')['results'], [])

    def test_non_authoring_module_and_archive_view_are_answered_by_the_overview(self):
        self.assertEqual(self.get(module_catalogue_id='LEGACY-1')['results'], [self.overview.return_value['sessions'][0]])
        self.assertEqual(self.get(module_catalogue_id='MOD-1', visibility='all')['results'], [])
        self.assertTrue(self.get()['overview'])


if __name__ == '__main__':
    unittest.main()
