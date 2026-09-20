"""Execute the real pilot functions with database/storage dependencies replaced."""
import ast
from contextlib import contextmanager
from datetime import date
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


def functions(path, namespace):
    tree = ast.parse(Path(path).read_text(encoding='utf-8-sig'))
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    for node in tree.body:
        node.decorator_list = []
    exec(compile(tree, str(path), 'exec'), namespace)
    return SimpleNamespace(**namespace)


class HistoricalLogsTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).parent
        self.learner = {'id': 7, 'aptem_id': 42, 'programme': 'Programme',
                        '_profile': {'coach_email': 'aryan.harikumar@kentbusinesscollege.com'}}
        self.repo = SimpleNamespace(CUTOFF='2026-08', query=Mock(),
            report_profile=Mock(return_value={'start_date': date(2026, 1, 15)}),
            month_rows=Mock(return_value=[]))
        old = functions(root.parent / 'old_otjh/service.py', {})
        self.old = SimpleNamespace(normalize=lambda value: str(value or '').strip().lower(),
            ServiceError=RuntimeError, _state=old._state, digest=Mock(return_value='digest'),
            summary=Mock(return_value={'read_only': True, 'months': [
                {'month': '2026-01', 'actual_hours': 3, 'not_accepted_hours': 2,
                 'training_plan_target': 999, 'student_signature': {'saved': True}}]}))
        self.targets = Mock(return_value={'2026-01': {'planned': 25}})
        self.ns = dict(date=date, repo=self.repo, old=self.old,
                       PILOT_COACH='aryan.harikumar@kentbusinesscollege.com',
                       selected_contract=lambda rows: rows[0] if rows else None,
                       read_contract=Mock(return_value={'2026-01': {'planned': 25}}),
                       contract_extract_metadata=lambda value: None,
                       time=SimpleNamespace(time=lambda: 0))
        self.history = functions(root / 'monthly_log_history.py', self.ns)

    def test_midmonth_start_and_empty_months(self):
        self.ns['contract_targets'] = self.targets
        result = self.history.summary(self.learner)['months']
        self.assertEqual([r['month'] for r in result], [f'2026-{m:02}' for m in range(1, 9)])
        self.assertEqual(result[0]['training_plan_target'], 25)
        self.assertEqual(result[0]['actual_hours'], 3)
        self.assertEqual(result[0]['not_accepted_hours'], 2)
        self.assertEqual(result[0]['student_signature'], {'saved': True})
        self.assertEqual(result[1]['actual_hours'], 0)
        self.assertFalse(result[1]['is_required'])
        self.repo.report_profile.assert_called_once_with(self.learner)

    def test_all_aptem_linked_learners_regardless_of_coach(self):
        self.assertTrue(self.history.enabled(self.learner))
        self.assertTrue(self.history.enabled({**self.learner, '_profile': None,
                                              'coach_email': self.ns['PILOT_COACH']}))
        self.assertTrue(self.history.enabled({**self.learner, '_profile': {'coach_email': 'other@example.test'}}))
        self.assertFalse(self.history.enabled({**self.learner, 'aptem_id': None}))

    def test_contract_query_is_scoped_and_signed(self):
        self.repo.query.return_value = [{'azure_path': 'synthetic.pdf', 'fetched_at': 'v1',
                                        'training_plan_planned_hours': 999}]
        self.history.contract_targets(self.learner)
        sql, args = self.repo.query.call_args.args
        self.assertEqual(args, [42, 'Programme', 'Programme'])
        self.assertIn('fully_signed_date IS NOT NULL', sql)
        self.assertIn('a.deleted_at IS NULL', sql)
        self.history.contract_targets({**self.learner, 'aptem_id': 84, 'programme': 'Other'})
        self.assertEqual(self.repo.query.call_args.args[1], [84, 'Other', 'Other'])

    def test_missing_contract_does_not_use_stale_target(self):
        self.repo.query.return_value = []
        with self.assertRaises(RuntimeError):
            self.history.contract_targets(self.learner)

    def test_date_window_rolls_across_year_and_excludes_prestart(self):
        self.assertEqual(self.history.reporting_months('2025-12-19')[0], '2025-12')
        self.assertEqual(self.history.reporting_months('2026-09-01'), [])

    def test_september_detail_does_not_read_audit_totals_or_contract(self):
        history = SimpleNamespace(enabled=Mock(), detail=Mock())
        sources = SimpleNamespace(monthly_target=Mock(return_value=5))
        ns = dict(history=history, sources=sources, old_repo=self.repo)
        logs = functions(Path(__file__).parent / 'monthly_logs.py', ns)
        ns.update(valid_month=Mock(), require_closed_month=Mock(), signatures=Mock(return_value=[]),
                  current_months=Mock(return_value={'2026-09': []}),
                  month_state=Mock(return_value={'actual_hours': 2}))
        result = logs.detail_data(self.learner, '2026-09')
        self.assertEqual(result['actual_hours'], 2)
        history.enabled.assert_not_called()
        history.detail.assert_not_called()
        sources.monthly_target.assert_called_once_with(self.learner, '2026-09')

    def test_later_audit_month_query_is_scoped(self):
        self.repo.ROWS = 'audit_rows'
        self.repo.query.return_value = [{'month': '2026-09'}, {'month': '2026-10'}]
        self.repo.month_rows.side_effect = [[{'id': 1}], [{'id': 2}]]
        result = self.history.later_rows(self.learner, '2026-10')
        self.assertEqual(list(result), ['2026-09', '2026-10'])
        self.assertEqual(self.repo.query.call_args.args[1], [42, '2026-08', '2026-10'])
        self.assertEqual(self.repo.month_rows.call_args_list[0].args, (self.learner, '2026-09'))
        self.assertEqual(self.history.later_rows({'id': 9}, '2026-10'), {})

    def test_merge_preserves_lms_and_audit_ksbs_without_duplicate_hours(self):
        lms = [{'id': 1, 'source_ref': 'progress:7', 'actual_hours': 2, 'ksb_codes': ['K1']}]
        audit = [{'id': 2, 'source_ref': 'progress:7', 'actual_hours': 2, 'ksb_codes': ['S2']},
                 {'id': 3, 'source_ref': 'la:4:5', 'actual_hours': 3, 'ksb_codes': ['K3', 'B1']}]
        result = self.history.merge_rows(lms, audit)
        self.assertEqual(len(result), 2)
        self.assertEqual(sum(r['actual_hours'] for r in result), 5)
        self.assertEqual(result[0]['ksb_codes'], ['S2'])
        self.assertEqual(result[1]['ksb_codes'], ['K3', 'B1'])
        self.assertEqual(result[1]['_audit_row_id'], 3)
        self.assertEqual(lms[0]['ksb_codes'], ['K1'])
        self.assertNotEqual(result[1]['id'], 3)

    def test_explicit_empty_audit_ksbs_are_not_invented(self):
        result = self.history.merge_rows([{'id': 1, 'source_ref': 'same', 'ksb_codes': ['K1']}],
                                         [{'id': 2, 'source_ref': 'same', 'ksb_codes': []}])
        self.assertEqual(result[0]['ksb_codes'], [])

    def test_current_grouping_includes_audit_only_month_and_keeps_lms(self):
        from collections import defaultdict
        audit = {'id': 4, 'source_ref': 'la:1:2', 'activity_date': date(2026, 9, 5),
                 'actual_hours': 2, 'ksb_codes': ['K1'], 'documents': []}
        lms = {'id': 8, 'source_ref': 'progress:8', 'activity_date': '2026-10-01', 'actual_hours': 1}
        history = SimpleNamespace(enabled=lambda learner: True,
            later_rows=Mock(return_value={'2026-09': [audit]}), merge_rows=self.history.merge_rows)
        ns = dict(defaultdict=defaultdict, history=history, old_repo=self.repo,
                  timezone=SimpleNamespace(localdate=lambda: date(2026, 10, 20)),
                  sources=SimpleNamespace(activity_rows=lambda learner: [lms]),
                  public_detail=lambda learner, data: data)
        logs = functions(Path(__file__).parent / 'monthly_logs.py', ns)
        result = logs.current_months(self.learner, include_open=True)
        self.assertEqual(set(result), {'2026-09', '2026-10'})
        self.assertEqual(result['2026-09'][0]['ksb_codes'], ['K1'])
        self.assertEqual(result['2026-10'], [lms])

    def test_later_document_gate_checks_learner_and_month_without_expanding_signing(self):
        source = Path(__file__).parent.parent / 'old_otjh/views.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        tree.body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'require_document_month']
        service = SimpleNamespace(readable_transition=Mock(return_value={}),
                                  require_month=Mock(side_effect=RuntimeError('not authorized')))
        self.repo.ROWS = 'audit_rows'
        self.repo.query.return_value = [{'id': 1}]
        ns = dict(repo=self.repo, service=service)
        exec(compile(tree, str(source), 'exec'), ns)
        from unittest.mock import patch
        with patch('django.utils.timezone.localdate', return_value=date(2026, 10, 20)):
            ns['require_document_month'](self.learner, '2026-09')
            self.assertEqual(self.repo.query.call_args.args[1], [42, '2026-09'])
            service.require_month.assert_not_called()
            self.repo.query.return_value = []
            with self.assertRaises(RuntimeError):
                ns['require_document_month']({**self.learner, 'aptem_id': 84}, '2026-09')
            self.assertEqual(self.repo.query.call_args.args[1], [84, '2026-09'])
            for month in ('2026-08', '2026-11', 'invalid'):
                with self.assertRaises(RuntimeError):
                    ns['require_document_month'](self.learner, month)


if __name__ == '__main__':
    unittest.main()
