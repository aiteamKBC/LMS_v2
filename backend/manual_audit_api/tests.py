"""Plan-builder unit tests: pure helpers + request validation.

Run with the sqlite test mode (no Neon access needed):

    DJANGO_USE_SQLITE=true python manage.py test manual_audit_api

Everything here exercises logic that runs BEFORE any database cursor is
opened (validators return 400 first), plus the pure date/name helpers the
projection depends on.
"""

import datetime
import json

from django.test import RequestFactory, SimpleTestCase

from .match_ledger_views import learner_hours
from .plan_projection import _resolve_date, suppress_claimed_mirror_rows
from .plan_tables import assignment_name_key
from .plan_views import (
    _hours,
    _validate_activity_input,
    _validate_progress_patch,
    plan_activities,
    plan_group_months,
    plan_progress,
)


def _post(view, path, payload, method="post", **kwargs):
    factory = RequestFactory()
    request = getattr(factory, method)(path, data=json.dumps(payload), content_type="application/json")
    return view(request, **kwargs)


class AssignmentNameKeyTests(SimpleTestCase):
    def test_trailing_space_and_symbols_collapse(self):
        self.assertEqual(
            assignment_name_key("AI 1:AI Foundations & Data - Assignment "),
            assignment_name_key("ai 1: ai foundations   data — assignment"),
        )

    def test_empty_name_is_stable(self):
        self.assertEqual(assignment_name_key(None), "unnamed")
        self.assertEqual(assignment_name_key("  ***  "), "unnamed")


class ValidatorTests(SimpleTestCase):
    def test_hours_rejects_nan_and_range(self):
        with self.assertRaises(ValueError):
            _hours("nan", "planned_hours")
        with self.assertRaises(ValueError):
            _hours(51, "planned_hours")
        self.assertEqual(_hours("2.5", "planned_hours"), 2.5)
        self.assertIsNone(_hours("", "planned_hours"))

    def test_activity_input_requires_known_category(self):
        with self.assertRaises(ValueError):
            _validate_activity_input({"category": "webinar", "title": "x", "month_index": 1})
        parsed = _validate_activity_input({
            "category": "Reading+Quiz".lower(), "title": "  T  ", "month_index": 2,
            "week_slot": 4, "planned_hours": "1.5",
        })
        self.assertEqual(parsed["title"], "T")
        self.assertEqual(parsed["week_slot"], 4)
        self.assertEqual(parsed["planned_hours"], 1.5)

    def test_progress_patch_validation(self):
        with self.assertRaises(ValueError):
            _validate_progress_patch({"status": "done"})
        with self.assertRaises(ValueError):
            _validate_progress_patch({"actual_hours": float("inf")})
        with self.assertRaises(ValueError):
            _validate_progress_patch({
                "timestamp_from": "2026-09-01T10:00:00Z",
                "timestamp_to": "2026-09-01T09:00:00Z",
            })
        patch = _validate_progress_patch({"status": "completed", "actual_hours": 2, "rejected": False})
        self.assertEqual(patch["status"], "completed")
        self.assertEqual(patch["actual_hours"], 2.0)


class ViewValidationTests(SimpleTestCase):
    """400s that fire before any DB cursor is opened."""

    def test_plan_activities_requires_group(self):
        response = _post(plan_activities, "/plan/activities", {"activities": [{}]})
        self.assertEqual(response.status_code, 400)

    def test_plan_activities_rejects_bad_category(self):
        response = _post(plan_activities, "/plan/activities", {
            "group_id": 1,
            "activities": [{"category": "webinar", "title": "x", "month_index": 1}],
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", json.loads(response.content)["error"])

    def test_plan_activities_rejects_nan_hours(self):
        response = _post(plan_activities, "/plan/activities", {
            "group_id": 1,
            "activities": [{"category": "video", "title": "x", "month_index": 1, "planned_hours": "nan"}],
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("finite", json.loads(response.content)["error"])

    def test_plan_progress_requires_uuid(self):
        response = _post(plan_progress, "/plan/progress", {"aptem_id": 1, "activity_key": "nope", "patch": {}})
        self.assertEqual(response.status_code, 400)

    def test_plan_months_rejects_bad_month(self):
        response = _post(plan_group_months, "/plan/groups/1/months", {
            "months": [{"month_index": 1, "calendar_month": "2026-13"}],
        }, method="put", group_id=1)
        self.assertEqual(response.status_code, 400)

    def test_learner_hours_rejects_nan(self):
        response = _post(learner_hours, "/match-ledger/learner-hours", {
            "aptem_id": 1, "planned_hours": "nan",
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn("finite", json.loads(response.content)["error"])

    def test_learner_hours_rejects_non_dict_body(self):
        response = _post(learner_hours, "/match-ledger/learner-hours", [1, 2])
        self.assertEqual(response.status_code, 400)


class ProjectionHelperTests(SimpleTestCase):
    def test_resolve_date_precedence(self):
        member = datetime.date(2026, 9, 20)
        planned = datetime.date(2026, 9, 10)
        anchor = datetime.date(2026, 9, 7)
        self.assertEqual(_resolve_date(member, planned, anchor, "2026-09", 3), member)
        self.assertEqual(_resolve_date(None, planned, anchor, "2026-09", 3), planned)
        # anchor + (week-1) * 7 days
        self.assertEqual(_resolve_date(None, None, anchor, "2026-09", 3), datetime.date(2026, 9, 21))
        # calendar month 1st + weeks when nothing else is set
        self.assertEqual(_resolve_date(None, None, None, "2026-09", 2), datetime.date(2026, 9, 8))
        self.assertIsNone(_resolve_date(None, None, None, "not-a-month", 1))

    def test_suppress_claimed_mirror_rows(self):
        claims = {"lms_ids": {61142}, "sessions": {("g2-ray", "2026-02-06")}}
        items = [
            {"source": "Manual_audit", "activity_id": "la:1:61142", "source_activity_id": 61142},
            {"source": "Manual_audit", "activity_id": "la:1:999", "source_activity_id": 999},
            {"source": "Manual_audit", "activity_id": "att:6441_2026-02-06_g2",
             "group_name": "G2 Ray", "date": "2026-02-06"},
            {"source": "Manual_audit", "activity_id": "plan:abc", "source_activity_id": "abc"},
        ]
        kept, dropped = suppress_claimed_mirror_rows(items, claims)
        kept_ids = [item["activity_id"] for item in kept]
        self.assertNotIn("la:1:61142", kept_ids)      # claimed material suppressed
        self.assertIn("la:1:999", kept_ids)           # unclaimed mirror row kept
        self.assertNotIn("att:6441_2026-02-06_g2", kept_ids)  # claimed session suppressed
        self.assertIn("plan:abc", kept_ids)           # plan rows never suppressed
        # Dropped ids travel to the client so overlay merges skip them.
        self.assertEqual(sorted(dropped), ["att:6441_2026-02-06_g2", "la:1:61142"])
