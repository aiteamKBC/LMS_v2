"""Journal aggregation against a fresh in-memory SQLite DB; no Django/network."""
import sqlite3
import ast
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api import journal_sources as sources


class JournalSourceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.db.executescript('''
            CREATE TABLE Learner.learner_journal_rows (
              id INTEGER, canonical_learner_id INTEGER, source_id INTEGER,
              progress_id INTEGER, month TEXT, planned_hours REAL, deleted_at TEXT);
            CREATE TABLE Learner.learner_activity_sources (
              id INTEGER, learner_id INTEGER, canonical_progress_id INTEGER, deleted_at TEXT);
            CREATE TABLE Learner.learner_progress_entries (
              id INTEGER, learner_id INTEGER, deleted_at TEXT);
            INSERT INTO Learner.learner_progress_entries VALUES (10,1,NULL),(20,2,NULL),(30,1,'deleted');
            INSERT INTO Learner.learner_activity_sources VALUES
              (100,1,10,NULL),(101,1,10,NULL),(200,2,20,NULL),(300,1,30,NULL),(400,1,10,'deleted');
            INSERT INTO Learner.learner_journal_rows VALUES
              (1,1,100,10,'2026-01',2,NULL),
              (2,1,101,10,'2026-02',3,NULL),
              (3,2,200,20,'2026-01',99,NULL),
              (4,1,200,20,'2026-01',99,NULL),
              (5,1,100,10,'2026-01',99,'deleted'),
              (6,1,300,30,'2026-01',99,NULL),
              (7,1,400,10,'2026-01',99,NULL),
              (8,1,100,10,'2026-03',0,NULL);
        ''')

    def query(self, sql, params):
        cursor = self.db.execute(sql.replace('%s', '?'), params)
        return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]

    def test_month_targets_keep_zero_and_exclude_deleted_or_cross_learner_links(self):
        self.assertEqual(sources.monthly_targets(1, self.query),
                         {'2026-01': 2, '2026-02': 3, '2026-03': 0})
        self.assertEqual(sources.monthly_targets(2, self.query), {'2026-01': 99})
        self.assertEqual(sources.monthly_targets(999, self.query), {})

    def test_same_progress_can_have_planned_rows_in_different_months(self):
        self.assertEqual(sources.planned_by_progress(1, self.query), {10: 5})

    def test_allocated_actual_is_not_multiplied_by_journal_or_source_count(self):
        records = [{'accepted': True, 'actual_seconds': 999999, 'journal_routes': [1, 2, 3],
                    'parts': [{'reporting_month': '2026-01', 'actual_seconds': 3600},
                              {'reporting_month': '2026-02', 'actual_seconds': 1800}]},
                   {'accepted': False, 'activity_status': 'Submitted',
                    'parts': [{'reporting_month': '2026-01', 'actual_seconds': 900}]},
                   {'accepted': False, 'activity_status': 'Rejected',
                    'parts': [{'reporting_month': '2026-01', 'actual_seconds': 7200}]}]
        result = sources.monthly_hours(records, {'2026-01': 2}, lambda r: r['parts'])
        self.assertEqual(result['2026-01']['actual'], 1)
        self.assertEqual(result['2026-01']['submitted'], .25)
        self.assertEqual(result['2026-02']['actual'], .5)
        self.assertEqual(result['2026-02']['planned'], 0)
        self.assertTrue(result['2026-01']['includesHistorical'])

    def test_request_source_isolated_from_coach_and_restored_after_errors(self):
        @sources.learner_journal_view
        def view(request):
            return sources.table('manual_learner_activities')

        def request(role, **params):
            return SimpleNamespace(login_account=SimpleNamespace(role=role), GET=params)

        for role in ('learner', 'admin', 'staff'):
            self.assertEqual(view(request(role)), '"Learner".learner_journal_rows')
        self.assertEqual(view(request('learner', perspective='coach')), '"Learner".learner_journal_rows')
        for req in (request('coach'), request('admin', viewAsCoach='coach@example.invalid'),
                    request('admin', perspective='coach')):
            self.assertEqual(view(req), 'structured_manual_activities.manual_learner_activities')
        self.assertFalse(sources.enabled())

    def test_retained_journal_routing_preserves_coach_and_nonjournal_tables(self):
        sql = '''SELECT * FROM structured_manual_activities.manual_learner_activities j
          JOIN "structured_manual_activities"."manual_activity_documents" d ON d.manual_activity_id=j.id
          JOIN "Audit".monthly_audit_signoffs s ON s.month=j.month'''
        self.assertEqual(sources.retained_journal_sql(sql), sql)
        token = sources._current.set(True)
        try:
            migrated = sources.retained_journal_sql(sql)
            self.assertIn('"Learner".learner_journal_rows', migrated)
            self.assertIn('"Learner".manual_activity_documents', migrated)
            self.assertIn('"Audit".monthly_audit_signoffs', migrated)
        finally:
            sources._current.reset(token)

    def test_home_card_uses_supplied_canonical_metrics_for_every_source(self):
        from datetime import date
        tree = ast.parse((Path(__file__).parent / 'home_progress.py').read_text())
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name in {'read_home_progress', 'apply_canonical_home_metrics'}]
        connection = MagicMock()
        scope = {'__package__': 'learner_api', 'journal_sources': sources,
            'connections': {'enrolment': connection}, 'rows': lambda cursor: [],
            '_group_dates': lambda source: (date(2026, 1, 1), None, None),
            'student_activity_available': lambda _: False,
            'canonical_learning': SimpleNamespace(metrics=lambda _: None),
            'lecture_register': lambda source, **kwargs: [], 'SUBMITTED': {'submitted'},
            'summarise_home': lambda *args: {'otjh': {'actual': 999, 'planned': 999}, 'activities': {'total': 7}}}
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'home_progress.py', 'exec'), scope)
        canonical = SimpleNamespace(enabled=lambda _: True, entries=lambda _: [
            {'accepted': True, 'actual_seconds': 7200},
            {'accepted': False, 'activity_status': 'Submitted', 'actual_seconds': 1800}],
            targets=lambda _: {'2026-01': 3, '2026-02': 2},
            programme_planned_hours=lambda _: 20,
            recorded_seconds=lambda row: row['actual_seconds'])
        args = (SimpleNamespace(pk=1, aptem_id=None), 'commercial', [], [], [], [], date(2026, 1, 31))
        self.assertEqual(scope['read_home_progress'](*args)['otjh']['actual'], 999)
        metrics = {'otjh': {'actual': 8, 'planned': 10},
                   'programme': {'completed': 3, 'total': 7, 'status': 'ready'}}
        coach = scope['read_home_progress'](*args, canonical_metrics=metrics)
        self.assertEqual(coach['otjh']['actual'], 8)
        self.assertEqual(coach['otjh']['planned'], 10)
        token = sources._current.set(True)
        try:
            with patch.dict(sys.modules, {'learner_api.canonical_learning': canonical}):
                import learner_api
                with patch.object(learner_api, 'canonical_learning', canonical, create=True):
                    result = scope['read_home_progress'](*args, canonical_metrics=metrics)
            self.assertEqual(result['otjh'], {'actual': 8, 'planned': 10,
                'percent': 80, 'missingPlannedActivities': 0})
            self.assertEqual(result['activities'], {'completed': 3, 'total': 7})
        finally:
            sources._current.reset(token)

    def test_shared_metrics_use_supplied_targets_and_preserve_source_empty_semantics(self):
        tree = ast.parse((Path(__file__).parent / 'canonical_learning.py').read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == 'metrics_from_records')
        scope = {'recorded_seconds': lambda row: row['actual_seconds']}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'canonical_learning.py', 'exec'), scope)
        metrics = scope['metrics_from_records']
        records = [{'accepted': True, 'actual_seconds': 3600}]
        self.assertEqual(metrics(records, {'2026-01': 2, '2026-02': 3})['otjh']['planned'], 5)
        self.assertIsNone(metrics(records, {})['otjh']['planned'])
        token = sources._current.set(True)
        try:
            self.assertEqual(metrics(records, {})['otjh']['planned'], 0)
            self.assertEqual(metrics(records, {'2026-01': 2})['otjh']['actual'], 1)
        finally:
            sources._current.reset(token)

    def test_nested_source_scope_is_restored_even_on_failure(self):
        @sources.learner_journal_view
        def view(request):
            return sources.table('manual_learner_activities')

        @sources.learner_journal_view
        def failing(request):
            self.assertTrue(sources.enabled())
            self.assertEqual(view(SimpleNamespace(login_account=SimpleNamespace(role='coach'), GET={})),
                             'structured_manual_activities.manual_learner_activities')
            self.assertTrue(sources.enabled())
            raise ValueError('expected')

        with self.assertRaises(ValueError):
            failing(SimpleNamespace(login_account=SimpleNamespace(role='learner'), GET={}))
        self.assertFalse(sources.enabled())


if __name__ == '__main__':
    unittest.main()
