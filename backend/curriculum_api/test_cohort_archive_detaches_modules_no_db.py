"""Archiving a cohort leaves no module on it. Run directly with Python; no Django, DB or network.

A module can name a cohort through one of its groups or directly, with no
group at all. Archiving the cohort must detach both, so the module comes back
unassigned and has to be given a new cohort and group from the module drawer.
Teams meetings are not touched by the archive.
"""
import ast
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parent


class Response(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status


def cohort_detail(namespace):
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'curriculum_cohort_detail')
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace['curriculum_cohort_detail']


class CohortArchiveDetachesModulesTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        groups = [{'group_id': 'GROUP-1', 'cohort_id': 'COHORT-1'}]
        self.ns = {
            'clean_str': lambda value: str(value or '').strip(),
            'resolve_cohort_row': lambda identifier: {'cohort_id': 'COHORT-1', 'programme_id': 'PROG-1'},
            'request_wants_permanent_delete': lambda request: False,
            'authoring_fetch_all': lambda table, where, params: groups if table == 'groups' else [],
            'unassign_authoring_modules_from_group': lambda group_id: self.calls.append(('unassign', group_id)),
            'authoring_soft_delete': lambda table, *args, **kwargs: self.calls.append(('archive', table)),
            'update_authoring_rows': lambda table, where, params, values: self.calls.append(('update', table, where, params, values)),
            'log_curriculum_decision': Mock(),
            'invalidate_curriculum_cache': Mock(),
            'json_error': lambda message, status=400, **extra: Response({'error': message}, status),
            'JsonResponse': Response,
            'GROUPS_TABLE': 'groups',
            'COHORT_AUTHORING_DETAILS_TABLE': 'cohorts',
            'AUTHORING_MODULES_TABLE': 'modules',
        }

    def archive(self):
        request = Mock(method='DELETE')
        return cohort_detail(self.ns)(request, 'COHORT-1')

    def test_a_module_named_directly_by_the_cohort_is_detached(self):
        response = self.archive()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['deleted'], True)
        self.assertIn(('update', 'modules', 'cohort_id = %s', ['COHORT-1'], {
            'cohort_id': None, 'cohort_name': '', 'group_id': None, 'group_name': '',
        }), self.calls)

    def test_group_modules_are_still_detached_and_the_cohort_archived_last(self):
        self.archive()
        kinds = [call[:2] for call in self.calls]
        self.assertEqual(kinds, [('unassign', 'GROUP-1'), ('archive', 'groups'), ('update', 'modules'), ('archive', 'cohorts')])

    def test_the_archive_reaches_no_teams_call(self):
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'curriculum_cohort_detail')
        delete_branch = next(n for n in ast.walk(node) if isinstance(n, ast.If) and "'DELETE'" in ast.unparse(n.test))
        source = ast.unparse(delete_branch)
        for forbidden in ('microsoft_graph_request', 'send_cancellation', 'live_session'):
            self.assertNotIn(forbidden, source)


if __name__ == '__main__':
    unittest.main()
