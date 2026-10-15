"""Deleted curriculum weeks never reach a learner unless they are an archived
module's own history.

Regression: a module deleted and later restored kept the weeks of that earlier
deletion stamped ``deleted_via_parent=<module id>``. Every learner/coach read
treated any parent stamp as "archived with its module", so the stale set
(Event MasterClass, then every title one week late) outranked the live weeks
the Module Builder shows. The components and KSB mappings archived with those
weeks carried the same stamp, so the same rule covers them.
"""
import re
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

from . import learner_detail as detail
from .tests import ScriptedConnection, ScriptedCursor

BACKEND = Path(__file__).resolve().parent.parent

# Every learner/coach read of curriculum.weeks that filters deleted weeks, with
# the number of week queries it runs through the shared rule.
READER_PATHS = {
    'learner_api/training_plan_dashboard.py': 1,
    'learner_api/overview_week.py': 2,
    'learner_api/mobile.py': 2,
    'learner_api/learner_detail.py': 4,
    'learner_api/builder_activity_dates.py': 1,
    'learner_api/personal_learning_reads.py': 1,
    'learner_api/training_plan_targets.py': 1,
    'learner_api/curriculum.py': 1,
    'learner_api/module_shift.py': 1,
    'learner_api/training_plan_document.py': 1,
    'learner_api/active_users.py': 1,
    'coach_api/overview_modules.py': 1,
    'coach_api/otjh_ksb.py': 1,
    'coach_api/learning_plan_projection.py': 2,
    'coach_api/weekly_learning.py': 1,
}

# Every learner/coach read of curriculum.components / ksb_mappings that filters
# deleted rows, with the number of predicates it builds from the shared rule.
CHILD_READER_PATHS = {
    'learner_api/training_plan_dashboard.py': 1,
    'learner_api/overview_week.py': 3,
    'learner_api/mobile.py': 2,
    'learner_api/learner_detail.py': 5,
    'learner_api/builder_activity_dates.py': 1,
    'learner_api/curriculum.py': 1,
    'learner_api/module_shift.py': 2,
    'learner_api/training_plan_document.py': 1,
    'learner_api/active_users.py': 1,
    'learner_api/assignment_settings.py': 1,
    'learner_api/dashboard_metrics.py': 4,
    'learner_api/student_activity_data.py': 2,
    'coach_api/overview_modules.py': 1,
    'coach_api/otjh_ksb.py': 1,
    'coach_api/learning_plan_projection.py': 1,
    'coach_api/monthly_focus.py': 2,
    'coach_api/weekly_learning.py': 2,
}

# The old rule: any parent stamp kept a deleted week, component or mapping visible.
LEAKY_WEEK_RULE = re.compile(
    r"(?:\b(?:w|c|k|component|mapping)\.deleted_at IS NULL\W+OR COALESCE\((?:w|c|k|component|mapping)\.deleted_via_parent"
    r"|FROM curriculum\.(?:weeks|components|ksb_mappings)\b[^;]{0,200}?deleted_at IS NULL OR COALESCE\(deleted_via_parent)",
    re.IGNORECASE | re.DOTALL,
)


class VisibleWeekSqlTests(SimpleTestCase):
    def test_week_rule_is_the_child_rule(self):
        self.assertEqual(visible_week_sql('w'), visible_child_sql('w'))

    def test_every_week_column_is_qualified_by_the_callers_alias(self):
        sql = visible_week_sql('w')
        # An unqualified column inside the EXISTS would bind to the module row.
        for column in ('deleted_at', 'deleted_via_parent', 'module_catalogue_id'):
            for match in re.finditer(rf'(?<![\w.]){column}\b', sql):
                self.fail(f'unqualified {column} at {match.start()}: {sql}')
        self.assertTrue(sql.startswith('(w.deleted_at IS NULL OR EXISTS ('))

    def test_archived_history_needs_the_modules_own_stamp_and_moment(self):
        sql = visible_week_sql('weeks')
        self.assertIn('archived_module.deleted_at IS NOT NULL', sql)
        self.assertIn(
            'weeks.deleted_via_parent IN (archived_module.module_catalogue_id, archived_module.deleted_via_parent)', sql)
        self.assertIn("weeks.deleted_at BETWEEN archived_module.deleted_at - interval '5 minutes' "
                      "AND archived_module.deleted_at + interval '5 minutes'", sql)


class WeekReaderPathTests(SimpleTestCase):
    def test_every_reader_uses_the_shared_rule(self):
        for path, count in READER_PATHS.items():
            with self.subTest(path=path):
                source = (BACKEND / path).read_text(encoding='utf-8')
                self.assertRegex(source, r'from curriculum_api\.week_visibility import [^\n]*\bvisible_week_sql\b')
                self.assertEqual(len(re.findall(r'visible_week_sql\(', source)), count)

    def test_every_component_and_mapping_reader_uses_the_shared_rule(self):
        for path, count in CHILD_READER_PATHS.items():
            with self.subTest(path=path):
                source = (BACKEND / path).read_text(encoding='utf-8')
                self.assertRegex(source, r'from curriculum_api\.week_visibility import [^\n]*\bvisible_child_sql\b')
                self.assertEqual(len(re.findall(r'visible_child_sql\(', source)), count)

    def test_no_learner_or_coach_read_keeps_the_leaky_week_rule(self):
        offenders = []
        for app in ('learner_api', 'coach_api'):
            for path in (BACKEND / app).rglob('*.py'):
                if path.name.startswith('test') or 'migrations' in path.parts:
                    continue
                if LEAKY_WEEK_RULE.search(path.read_text(encoding='utf-8')):
                    offenders.append(str(path.relative_to(BACKEND)))
        self.assertEqual(offenders, [])

    def test_live_resolution_reads_weeks_through_the_shared_rule(self):
        cursor = ScriptedCursor([[('MOD-1', 'Module 1')], [], []])
        weeks = [{'module': 'Module 1', 'week': 'Week 1', 'moduleId': 'MOD-1', 'weekId': 'WEEK-1'}]
        with patch.object(detail, 'connections', {'enrolment': ScriptedConnection(cursor)}):
            detail._resolve_from_master(['Module 1'], weeks, [])
        week_query = cursor.queries[1]
        self.assertIn('FROM curriculum.weeks', week_query)
        self.assertIn(visible_week_sql('weeks'), week_query)
        # Components go through the same rule, and attach only to a week
        # returned above, so a hidden week takes its components with it.
        self.assertIn(visible_child_sql('components'), cursor.queries[2])
