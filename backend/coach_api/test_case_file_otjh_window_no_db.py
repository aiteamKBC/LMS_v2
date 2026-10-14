"""Case File contract-window regression without Django, database or network."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from coach_api.selectors.otjh import learner_programme_window


class CaseFileOtjhWindowTests(unittest.TestCase):
    def test_source_window_matches_dashboard_without_contract_reads_for_each_learner_type(self):
        root = Path(__file__).resolve().parent
        tree = ast.parse((root / 'views.py').read_text(encoding='utf-8-sig'))
        shell = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == 'serialize_case_file_shell')
        # Inject the actual pure serializer instead of importing Django views.
        shell.body = [node for node in shell.body if not isinstance(node, ast.ImportFrom)]
        serializer_tree = ast.parse((root / 'serializers/learner_profile.py').read_text(encoding='utf-8-sig'))
        schedule = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'caseload_schedule_values')
        loader = Mock(return_value={9001: {'program_start_date': '2025-10-01', 'planned_end_date': '2027-02-01'}})
        namespace = {
            'SimpleNamespace': SimpleNamespace, 'load_contracts_bulk': loader,
            'learner_programme_window': learner_programme_window,
            'DatabaseError': RuntimeError, 'logger': Mock(),
            'clean_text': lambda value: str(value or '').strip(),
            'format_date': lambda value: value,
            'student_activity_available': lambda value: bool(value),
            'format_coach_rag_value': lambda value: value,
            'caseload_profile_start_date': lambda row: row._caseload_source.learner_start_date,
        }
        for node in (serializer_tree, ast.Module(body=[schedule, shell], type_ignores=[])):
            exec(compile(node, '<case-file-test>', 'exec'), namespace)
        for kind in ('commercial', 'apprenticeship'):
            source = SimpleNamespace(aptem_id=9001, learner_type=kind,
                                     learner_start_date='2025-10-28', learner_end_date='2027-02-01')
            profile = SimpleNamespace(id=1, enrolment_id=2, end_date=None)
            payload = namespace['serialize_case_file_shell'](profile, source)
            self.assertEqual(payload['profile']['otjhProgrammeStartDate'], '2025-10-28')
            self.assertEqual(payload['profile']['otjhProgrammeEndDate'], '2027-02-01')
            self.assertEqual(payload['profile']['startDate'], '2025-10-28')
            self.assertIsNone(payload['profile']['plannedEndDate'])
            loader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
