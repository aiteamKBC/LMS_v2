"""Current Curriculum children use canonical status visibility.

Only ``inactive`` is hidden. NULL, blank and future status values retain their
existing visibility, while historical projections keep their own lineage rules.
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
    'learner_api/overview_week.py': 3,
    'learner_api/mobile.py': 2,
    'learner_api/learner_detail.py': 5,
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

CHILD_READER_PATHS = {
    'learner_api/training_plan_dashboard.py': 2,
    'learner_api/overview_week.py': 3,
    'learner_api/mobile.py': 2,
    'learner_api/learner_detail.py': 8,  # +2: the shared ksb_mappings read (content_cache); catalogue_facts path uses pre-filtered master_components
    'learner_api/builder_activity_dates.py': 1,
    'learner_api/curriculum.py': 1,
    'learner_api/dashboard_header.py': 1,
    'learner_api/dashboard_metrics.py': 2,  # ksb_mappings subquery uses component_ksb_mappings_sql() -> current_status_sql (equivalent rule)
    'learner_api/dashboard_training.py': 1,
    'learner_api/module_shift.py': 2,
    'learner_api/training_plan_document.py': 1,
    'learner_api/active_users.py': 1,
    'learner_api/live_session_progress.py': 2,
    'learner_api/student_activity_data.py': 2,
    'coach_api/overview_modules.py': 1,
    'coach_api/otjh_ksb.py': 1,
    'coach_api/learning_plan_projection.py': 1,
    'coach_api/weekly_learning.py': 1,  # ksb_mappings subquery uses component_ksb_codes_sql() -> current_status_sql (equivalent rule)
}

# The old rule: any parent stamp kept a deleted week visible.
LEAKY_WEEK_RULE = re.compile(
    r"(?:\b(?:w|c|k|component|mapping)\.deleted_at IS NULL\W+OR COALESCE\((?:w|c|k|component|mapping)\.deleted_via_parent"
    r"|FROM curriculum\.(?:weeks|components|ksb_mappings)\b[^;]{0,200}?deleted_at IS NULL OR COALESCE\(deleted_via_parent)",
    re.IGNORECASE | re.DOTALL,
)


class VisibleWeekSqlTests(SimpleTestCase):
    def test_week_rule_is_the_child_rule(self):
        self.assertEqual(visible_week_sql('w'), visible_child_sql('w'))

    def test_every_status_column_is_qualified_by_the_callers_alias(self):
        sql = visible_week_sql('w')
        for column in ('status',):
            for match in re.finditer(rf'(?<![\w.]){column}\b', sql):
                self.fail(f'unqualified {column} at {match.start()}: {sql}')
        self.assertEqual(sql, "(lower(btrim(coalesce(w.status, ''))) <> 'inactive')")

    def test_only_inactive_is_interpreted_as_hidden(self):
        sql = visible_week_sql('weeks')
        self.assertEqual(sql, "(lower(btrim(coalesce(weeks.status, ''))) <> 'inactive')")
        for removed in ('curriculum.modules', 'archived_module', 'deleted_at', 'deleted_via_parent', "interval '5 minutes'", ' OR '):
            self.assertNotIn(removed, sql)


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
        connection = ScriptedConnection(cursor)
        connection.vendor = 'sqlite'
        cursor.db = connection
        weeks = [{'module': 'Module 1', 'week': 'Week 1', 'moduleId': 'MOD-1', 'weekId': 'WEEK-1'}]
        with patch.object(detail, 'connections', {'enrolment': connection}):
            detail._resolve_from_master(['Module 1'], weeks, [])
        week_query = cursor.queries[1]
        self.assertIn('FROM curriculum.weeks', week_query)
        self.assertIn(visible_week_sql('weeks'), week_query)
        # Components go through the same rule, and attach only to a week
        # returned above, so a hidden week takes its components with it.
        self.assertIn(visible_child_sql('components'), cursor.queries[2])
