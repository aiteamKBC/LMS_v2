from copy import deepcopy
from unittest import TestCase
from unittest.mock import Mock

from learner_api.learner_plan_scope import read_scope, scoped_plan


class LearnerPlanScopeTests(TestCase):
    def test_parent_identity_preserves_complete_module_and_empty_weeks(self):
        plan = [{'moduleId': 'M1', 'weeks': [
            {'weekId': 'W1', 'components': [{'componentId': 'A'}, {'componentId': 'B'}]},
            {'weekId': 'W2', 'components': []}]},
            {'moduleId': 'M2', 'weeks': [{'weekId': 'W1', 'components': [{'componentId': 'A'}]}]}]
        before = deepcopy(plan)
        result = scoped_plan(plan, [('M1', 'W1', 'A'), ('M1', 'W1', 'B'), ('M1', 'W2', None)])
        self.assertEqual(result, [plan[0]])
        self.assertEqual(plan, before)

    def test_inactive_descendants_do_not_hide_assigned_parent(self):
        plan = [{'moduleId': 'M1', 'weeks': [{'weekId': 'W1', 'components': [{'componentId': 'A'}]}]}]
        self.assertEqual(scoped_plan(plan, [('M1', None, None)]), [{'moduleId': 'M1', 'weeks': []}])
        self.assertEqual(scoped_plan(plan, []), [])

    def test_active_uses_existing_status_rules_at_each_level_all_does_not(self):
        cursor = Mock()
        cursor.fetchall.return_value = []
        for active in (True, False):
            read_scope(cursor, 123, active_only=active)
            sql, params = cursor.execute.call_args.args
            self.assertEqual(params, [123])
            self.assertEqual(sql.count("<> 'inactive'"), 3 if active else 0)
            self.assertIn('w.module_catalogue_id=m.module_catalogue_id', sql)
            self.assertIn('c.week_id=w.id', sql)
            self.assertIn('pc.plan_week_id=pw.id', sql)
            self.assertNotIn('old_lms', sql)
