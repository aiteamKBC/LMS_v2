"""Stdlib-only tests for selectors/curriculum_catalogue.py; no Django or database.

Run: python -I -B backend/learner_api/test_curriculum_catalogue_no_db.py
"""
import importlib.util
from pathlib import Path
import unittest

_spec = importlib.util.spec_from_file_location(
    'curriculum_catalogue', Path(__file__).resolve().parent / 'selectors' / 'curriculum_catalogue.py')
catalogue = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(catalogue)


def row(learner, module, week=None, component=None, *, mref=None, mtitle='', wref=None, wtitle='',
        cref=None, ctitle=''):
    return {'learner_id': learner, 'module_row': module, 'module_ref': mref, 'module_title': mtitle,
            'week_row': week, 'week_ref': wref, 'week_title': wtitle,
            'component_row': component, 'component_ref': cref, 'component_title': ctitle}


class FakeQuery:
    def __init__(self, plan=(), ksb=()):
        self.plan, self.ksb, self.calls = list(plan), list(ksb), []

    def __call__(self, sql, params):
        self.calls.append((sql, params))
        return self.plan if sql == catalogue.PLAN_SQL else self.ksb


class AssignedCurriculumTests(unittest.TestCase):
    def test_builds_training_plan_shape_in_database_order(self):
        query = FakeQuery(plan=[
            row(7, 1, 10, 100, mref='M1', mtitle='Module 1', wref='W1', wtitle='Week 1', cref='C1', ctitle='Quiz'),
            row(7, 1, 10, 101, mref='M1', mtitle='Module 1', wref='W1', wtitle='Week 1', cref='C2', ctitle='Video'),
            row(7, 1, 11, None, mref='M1', mtitle='Module 1', wref='W2', wtitle='Week 2'),
            row(7, 2, None, None, mref=None, mtitle='Title-only legacy'),
        ], ksb=[{'learner_id': 7, 'profile_version_id': 42}])
        self.assertEqual(catalogue.assigned_curriculum(7, query=query), {
            'modules': [
                {'moduleId': 'M1', 'moduleTitle': 'Module 1', 'weeks': [
                    {'weekId': 'W1', 'weekTitle': 'Week 1', 'components': [
                        {'componentId': 'C1', 'componentTitle': 'Quiz'},
                        {'componentId': 'C2', 'componentTitle': 'Video'}]},
                    {'weekId': 'W2', 'weekTitle': 'Week 2', 'components': []}]},
                # Orphan/title-only entries (D10) are kept, not resolved by title.
                {'moduleId': None, 'moduleTitle': 'Title-only legacy', 'weeks': []}],
            'ksbProfileVersionId': 42})

    def test_exactly_two_queries_with_bound_ids_and_order_clause(self):
        query = FakeQuery()
        catalogue.assigned_curricula([3, 9, 3], query=query)
        self.assertEqual([params for _, params in query.calls], [[[3, 9]], [[3, 9]]])
        self.assertIn('ORDER BY m.learner_id, m.position, m.id, w.position, w.id, c.position, c.id',
                      catalogue.PLAN_SQL)
        for sql, _ in query.calls:
            self.assertNotIn('curriculum.', sql)
            self.assertNotIn('enrolment.', sql)
            self.assertNotIn('login.', sql)

    def test_learners_are_isolated_and_absent_plans_are_empty(self):
        query = FakeQuery(plan=[row(3, 1, mref='A'), row(9, 2, mref='B')],
                          ksb=[{'learner_id': 9, 'profile_version_id': 5}])
        result = catalogue.assigned_curricula([3, 9, 12], query=query)
        self.assertEqual([m['moduleId'] for m in result[3]['modules']], ['A'])
        self.assertEqual([m['moduleId'] for m in result[9]['modules']], ['B'])
        self.assertEqual(result[12], {'modules': [], 'ksbProfileVersionId': None})
        self.assertIsNone(result[3]['ksbProfileVersionId'])

    def test_empty_input_issues_no_query(self):
        query = FakeQuery()
        self.assertEqual(catalogue.assigned_curricula([], query=query), {})
        self.assertEqual(query.calls, [])

    def test_rejects_non_canonical_ids_before_querying(self):
        for bad in (True, 0, -1, '7', 7.0, None):
            with self.subTest(bad=bad):
                query = FakeQuery()
                with self.assertRaises(ValueError):
                    catalogue.assigned_curricula([bad], query=query)
                self.assertEqual(query.calls, [])

    def test_database_errors_propagate_without_fallback(self):
        def failing(sql, params):
            raise RuntimeError('database down')
        with self.assertRaisesRegex(RuntimeError, 'database down'):
            catalogue.assigned_curriculum(7, query=failing)


if __name__ == '__main__':
    unittest.main()
