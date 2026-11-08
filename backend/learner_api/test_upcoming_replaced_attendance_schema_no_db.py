"""Canonical-schema regression for Upcoming's replaced-attendance SQL."""
import re
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from . import training_plan_dashboard as dashboard
from .replaced_teams_attendance import REPLACED_ATTENDANCE_LATERAL_SQL


REMOVED_TARGET_COLUMNS = re.compile(
    r"\b(?:target_c|target_w)\.(?:deleted_at|deleted_by|deleted_via_parent|is_programme_deleted)\b"
)


class UpcomingReplacedAttendanceSchemaTests(SimpleTestCase):
    def test_target_aliases_are_canonical_components_and_weeks(self):
        sql = REPLACED_ATTENDANCE_LATERAL_SQL
        self.assertIn("FROM curriculum.components target_c", sql)
        self.assertIn("LEFT JOIN curriculum.weeks target_w", sql)
        self.assertEqual(REMOVED_TARGET_COLUMNS.findall(sql), [])
        self.assertNotIn("curriculum.ksb_mappings", sql)

    def test_current_target_rows_hide_only_explicit_inactive_status(self):
        sql = REPLACED_ATTENDANCE_LATERAL_SQL
        self.assertIn(f"AND {visible_child_sql('target_c')}", sql)
        self.assertIn(f"AND (target_w.id IS NULL OR {visible_week_sql('target_w')})", sql)
        for alias in ("target_c", "target_w"):
            self.assertIn(f"lower(btrim(coalesce({alias}.status, ''))) <> 'inactive'", sql)
        # No parent-module status predicate is added to this attendance lookup;
        # its existing occurrence/report population and historical scope remain.
        self.assertNotIn("curriculum.modules", sql)
        self.assertIn("lower(btrim(source_s.status)) NOT IN", sql)
        self.assertIn("lower(btrim(source_o.status)) NOT IN", sql)

    def test_upcoming_session_query_embeds_the_fixed_lateral_without_duplication_changes(self):
        cursor = MagicMock()
        with patch.object(dashboard, "rows", return_value=[]):
            dashboard._plan_session_rows(cursor, "learner@example.test", ["MOD-1"])
        sql = cursor.execute.call_args.args[0]
        self.assertIn(REPLACED_ATTENDANCE_LATERAL_SQL, sql)
        self.assertEqual(sql.count("LEFT JOIN LATERAL ("), 1)
        self.assertIn("HAVING count(DISTINCT candidate.occurrence_id)=1", sql)
        self.assertEqual(REMOVED_TARGET_COLUMNS.findall(sql), [])
