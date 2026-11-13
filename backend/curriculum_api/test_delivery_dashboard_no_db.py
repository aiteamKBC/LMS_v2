"""Standalone: real projection/caller/auth code, memory rows, no app/DB startup."""
import ast
import copy
import functools
import json
import sys
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8', DATABASES={
        'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}})
from django.http import JsonResponse
from django.views.decorators.http import require_GET


def functions(path, namespace, names=None, assignments=False):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if (isinstance(node, ast.FunctionDef) and (names is None or node.name in names))
             or (assignments and isinstance(node, ast.Assign))]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class DashboardReadTests(unittest.TestCase):
    def setUp(self):
        block = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        block.start(); self.addCleanup(block.stop)
        root = Path(__file__).parent
        self.account = SimpleNamespace(role='staff', accesses={'curriculum'})
        auth = dict(functools=functools, JsonResponse=JsonResponse,
            authenticate_request=lambda _request: self.account,
            session_unreadable=lambda _request: False, _accesses_of=lambda account: account.accesses)
        functions(root.parent / 'login' / 'permissions.py', auth,
                  {'require_access', '_unauthenticated', '_forbidden', '_unavailable'})
        self.modules = [
            dict(module_catalogue_id='M1', title='One', group_id='G1', cohort_id='C1', tutor_name='TBC', status='draft'),
            dict(module_catalogue_id='M2', title='Two', group_id='G1', cohort_id='C1', status='published'),
            dict(module_catalogue_id='UNUSED', title='Unused', status='draft'),
            dict(module_catalogue_id='ARCHIVED', title='Archived', group_id='G1', cohort_id='C1', status='archived'),
            dict(module_catalogue_id='DELETED', title='Deleted', group_id='G1', cohort_id='C1', deleted_at='2026-01-01'),
        ]
        self.group_rows = [dict(group_id='G1', cohort_id='C1', coach_name='', session_start_time='09:30', session_end_time='11:30')]
        self.cohort_rows = [dict(cohort_id='C1', status='active')]
        self.reads = []
        self.holidays = [{'id': 'holiday', 'date': '2026-11-16'}]
        self.generated = [dict(id='s1', type='Live Session', date='2026-11-17', startTime='09:30',
                               title='One', status='scheduled', moduleCatalogueId='M1', moduleId='M1', privateContent='excluded')]
        self.views = SimpleNamespace(
            AUTHORING_MODULES_TABLE='modules', GROUPS_TABLE='groups', COHORT_AUTHORING_DETAILS_TABLE='cohorts',
            AUTHORING_WEEKS_TABLE='weeks', AUTHORING_COMPONENTS_TABLE='components', LIVE_SESSION_TYPE_SQL="type = 'live_session'",
            MODULE_INDEX_EXCLUDED_COLUMNS=('ksb_remap_report',), GROUP_ROWS_ORDER='group_name', COHORT_ROWS_ORDER='cohort_name',
            curriculum_read_scope=nullcontext, authoring_fetch_all=self.fetch,
            clean_str=lambda value: str(value or '').strip(),
            serialize_group_authoring_detail=lambda row: row,
            serialize_cohort_authoring_detail=lambda row, holidays: row,
            # Existing relationship builder supplies resolved clocks and membership.
            build_cohorts_and_groups=Mock(return_value=([
                {'id': 'C1', 'status': 'active', 'learnerDetails': 'excluded'}],
                [{'id': 'G1', 'cohortId': 'C1', 'coach': '', 'moduleIds': ['M1', 'M2'], 'startTime': '09:30', 'endTime': '11:30'}])),
            authoring_modules_as_training_rows=Mock(return_value=[
                {'id': row['module_catalogue_id'], 'operational': row.get('status') != 'archived' and not row.get('deleted_at')}
                for row in self.modules if row.get('group_id')]),
            is_operational_training_row=lambda row: row['operational'],
            module_authoring_row_is_archived=lambda row: row.get('status') == 'archived' or bool(row.get('deleted_at')),
            programme_deleted_row=lambda row: bool(row.get('deleted_at')),
            get_holiday_rows=lambda: self.holidays,
            cohort_selected_holidays_by_id=Mock(return_value={'C1': self.holidays}),
            build_sessions_from_authoring_modules=Mock(return_value=self.generated),
            request_bypasses_curriculum_cache=lambda request: False,
            cached_curriculum_value=lambda key, factory, **kwargs: factory(),
        )
        class ReadError(Exception): pass
        self.ReadError = ReadError
        self.n = dict(views=self.views, JsonResponse=JsonResponse, DatabaseError=ReadError,
                      require_GET=require_GET, require_access=auth['require_access'])
        functions(root / 'delivery_dashboard.py', self.n, assignments=True)

    def fetch(self, table, *args, **kwargs):
        self.reads.append((table, kwargs))
        if table == 'components':
            self.assertIn("type = 'live_session'", args[0])
        return copy.deepcopy({'modules': self.modules, 'groups': self.group_rows, 'cohorts': self.cohort_rows, 'weeks': [], 'components': []}[table])

    def request(self, name='overview', method='GET'):
        return self.n[name](SimpleNamespace(method=method, path='/curriculum/delivery-dashboard/'))

    def test_summary_has_no_full_overview_learner_or_content_work_and_keeps_allocations(self):
        before = copy.deepcopy(self.modules)
        result = json.loads(self.request().content)
        self.assertEqual([row['id'] for row in result['modules']], ['M1', 'M2'])
        self.assertEqual(result['modules'][0]['groupId'], 'G1')
        self.assertEqual(result['groups'][0]['moduleIds'], ['M1', 'M2'])
        self.assertEqual(result['cohorts'], [{'id': 'C1', 'status': 'active'}])
        self.assertNotIn('privateContent', json.dumps(result))
        self.assertEqual([table for table, _ in self.reads], ['modules', 'groups', 'cohorts'])
        self.assertTrue(all(not options['ensure_tables'] for _, options in self.reads))
        self.views.build_cohorts_and_groups.assert_called_once()
        self.assertFalse(self.views.build_cohorts_and_groups.call_args.kwargs['include_learner_counts'])
        self.views.build_sessions_from_authoring_modules.assert_not_called()
        self.assertEqual(before, self.modules)

    def test_query_count_stays_bounded_with_a_large_catalogue(self):
        self.modules *= 500
        self.request()
        self.assertEqual(len(self.reads), 3)
        self.assertIn('columns', self.reads[0][1])

    def test_dates_are_the_existing_builders_exact_result_not_an_occurrence_or_week_guess(self):
        result = json.loads(self.request('sessions').content)
        self.assertEqual(result['sessions'][0]['date'], self.generated[0]['date'])
        self.assertEqual(result['sessions'][0]['startTime'], '09:30')
        self.assertNotIn('privateContent', result['sessions'][0])
        self.views.build_sessions_from_authoring_modules.assert_called_once()
        args, kwargs = self.views.build_sessions_from_authoring_modules.call_args
        self.assertNotIn('DELETED', [row['module_catalogue_id'] for row in args[0]])
        self.assertEqual(args[1], {'C1': self.holidays})
        self.assertEqual(kwargs['groups_by_id'], {'G1': {'session_start_time': '09:30', 'session_end_time': '11:30'}})
        self.assertEqual(len(self.reads), 5)

    def test_live_component_read_failure_does_not_become_zero_sessions(self):
        original = self.views.authoring_fetch_all
        self.views.authoring_fetch_all = Mock(side_effect=lambda table, *args, **kwargs:
            (_ for _ in ()).throw(self.ReadError('synthetic component failure')) if table == 'components' else original(table, *args, **kwargs))
        self.assertEqual(self.request('sessions').status_code, 503)
        self.views.build_sessions_from_authoring_modules.assert_not_called()

    def test_read_failures_are_503_and_are_not_fabricated_empty_success(self):
        self.views.authoring_fetch_all = Mock(side_effect=self.ReadError('synthetic failure'))
        result = self.request()
        self.assertEqual(result.status_code, 503)
        self.assertIn('error', json.loads(result.content))

    def test_new_endpoints_require_curriculum_access_and_reject_writes(self):
        for name in ['overview', 'sessions']:
            self.account = None
            self.assertEqual(self.request(name).status_code, 401)
            for role, accesses in [('learner', {'curriculum'}), ('employer', {'curriculum'}), ('staff', {'enrolment'}), ('staff', set())]:
                self.account = SimpleNamespace(role=role, accesses=accesses)
                self.assertEqual(self.request(name).status_code, 403)
            self.account = SimpleNamespace(role='staff', accesses={'curriculum'})
            self.assertEqual(self.request(name, 'POST').status_code, 405)
            self.assertEqual(self.request(name).status_code, 200)

    def test_cache_uses_separate_small_keys_and_never_forces_a_refresh_implicitly(self):
        self.views.cached_curriculum_value = Mock(side_effect=lambda key, factory, **kwargs: factory())
        self.request(); self.request('sessions')
        calls = self.views.cached_curriculum_value.call_args_list
        self.assertEqual([call.args[0] for call in calls], ['delivery-dashboard:v1:overview', 'delivery-dashboard:v1:sessions'])
        self.assertTrue(all(call.kwargs == {'force': False, 'ttl': 30} for call in calls))


if __name__ == '__main__':
    unittest.main()
