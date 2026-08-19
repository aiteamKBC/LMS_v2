"""Plan-builder unit tests: pure helpers + request validation.

Run with the sqlite test mode (no Neon access needed):

    DJANGO_USE_SQLITE=true python manage.py test manual_audit_api

Everything here exercises logic that runs BEFORE any database cursor is
opened (validators return 400 first), plus the pure date/name helpers the
projection depends on.
"""

import datetime
import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from .common import normalize_lms_category
from .ledger_views import _merge_title_key, merge_reading_quiz_rows
from .match_ledger_views import _normalise_levy_status, _skill_radar_score_values, _skill_radar_snapshot_entries, _skill_radar_text_category, _validate_overlay_activity, learner_hours
from .plan_pickers import picker_attendance_modules, picker_group_activities
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


class SkillsRadarScoreTests(SimpleTestCase):
    def test_uses_each_characteristics_source_maximum(self):
        self.assertEqual(_skill_radar_score_values(2, "2", "5"), (2, 5))
        self.assertEqual(_skill_radar_score_values(4, "4", "8"), (4, 8))

    def test_falls_back_for_legacy_score_rows(self):
        self.assertEqual(_skill_radar_score_values(3, None, None), (3, 8))

    def test_builds_concise_category_from_ksb_text(self):
        self.assertEqual(
            _skill_radar_text_category("I can use appropriate technologies to deliver marketing outcomes"),
            "Marketing technology",
        )

    def test_normalises_retained_withdrawn_learner_snapshot(self):
        result = _skill_radar_snapshot_entries([
            ("Skills", "S3", "Deliver marketing materials", "Consistently – confident"),
        ])

        self.assertEqual(result[0]["skill_score"], 5)
        self.assertEqual(result[0]["maximum"], 8)


class EmployerLevyStatusTests(SimpleTestCase):
    def test_normalises_levy_and_non_levy_values(self):
        self.assertEqual(_normalise_levy_status("Levy"), "Levy")
        self.assertEqual(_normalise_levy_status("Non-Levy"), "Non-Levy")


def _post(view, path, payload, method="post", **kwargs):
    factory = RequestFactory()
    request = getattr(factory, method)(path, data=json.dumps(payload), content_type="application/json")
    return view(request, **kwargs)


class ProgrammeKeyTests(SimpleTestCase):
    """Similar programme-name variants must cluster into one key."""

    def test_pcp_variants_share_one_key(self):
        from .plan_tables import programme_key
        variants = [
            "Project Controls Professional Level 6 - Feb 2026",
            "Level 6 Project Controls Professional PCP - May 25",
            "Project Controls Professional Level 6 (Onboarding Stage)",
            "Level 6 Project Controls Professional Oct.25",
            "NEW Level 6 Project Controls Professional PCP July 25",
            "Project Controls Professional Level 6 Onboarding v1.1",
            "Level 6 Project Controls Professional",
        ]
        keys = {programme_key(v) for v in variants}
        self.assertEqual(len(keys), 1, keys)

    def test_different_programmes_stay_apart(self):
        from .plan_tables import programme_key
        self.assertNotEqual(
            programme_key("Marketing Executive Level 4 - June 2026"),
            programme_key("Marketing Manager Level 6 - June 2026"),
        )
        self.assertNotEqual(
            programme_key("Level 4 Marketing Executive"),
            programme_key("Level 4 Market Research Executive"),
        )

    def test_display_strips_cohort_noise(self):
        from .plan_tables import clean_programme_display
        self.assertEqual(
            clean_programme_display("Project Controls Professional Level 6 - Feb 2026"),
            "Project Controls Professional Level 6",
        )


class AssignmentNameKeyTests(SimpleTestCase):
    def test_trailing_space_and_symbols_collapse(self):
        self.assertEqual(
            assignment_name_key("AI 1:AI Foundations & Data - Assignment "),
            assignment_name_key("ai 1: ai foundations   data — assignment"),
        )

    def test_empty_name_is_stable(self):
        self.assertEqual(assignment_name_key(None), "unnamed")
        self.assertEqual(assignment_name_key("  ***  "), "unnamed")


class LmsCategoryTests(SimpleTestCase):
    def test_ppt_mislabeled_as_video_uses_learning_material_category(self):
        self.assertEqual(
            normalize_lms_category(
                "video",
                "P2-PPT-Using Personas and Insight Gap Analysis to Identify Pain Points.",
            ),
            "reading+quiz",
        )
        self.assertEqual(
            normalize_lms_category("video", "PowerPoint - Root Cause Analysis"),
            "reading+quiz",
        )

    def test_real_video_stays_video(self):
        self.assertEqual(
            normalize_lms_category("video", "VID 2-Using Personas and Insight Gap Analysis"),
            "video",
        )

    def test_ppt_letters_inside_another_word_do_not_trigger(self):
        self.assertEqual(normalize_lms_category("video", "AppTools walkthrough"), "video")


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

    def test_lms_ppt_cannot_be_saved_as_video(self):
        parsed = _validate_activity_input({
            "category": "video",
            "title": "P3-PPT-Root Cause Analysis",
            "material_ref": "lms:119858",
            "month_index": 2,
        })
        self.assertEqual(parsed["category"], "reading+quiz")

    def test_manual_video_with_ppt_in_title_keeps_the_chosen_category(self):
        parsed = _validate_activity_input({
            "category": "video",
            "title": "How to present a PPT",
            "month_index": 2,
        })
        self.assertEqual(parsed["category"], "video")

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

    def test_attendance_modules_requires_kbc_config(self):
        request = RequestFactory().get("/plan/pickers/attendance-modules")
        with mock.patch.dict("os.environ", {"KBCDATABASE": ""}):
            response = picker_attendance_modules(request)
        self.assertEqual(response.status_code, 503)
        self.assertIn("KBCDATABASE", json.loads(response.content)["error"])

    def test_group_activities_requires_group(self):
        request = RequestFactory().get("/plan/pickers/group-activities")
        response = picker_group_activities(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("group_id", json.loads(response.content)["error"])

    def test_group_activities_rejects_unknown_type(self):
        request = RequestFactory().get("/plan/pickers/group-activities", {"group_id": "1", "type": "webinar"})
        response = picker_group_activities(request)
        self.assertEqual(response.status_code, 400)
        self.assertIn("type", json.loads(response.content)["error"])


def _half(activity_id, category, title, *, actual=0.0, month="2026-03", group=2, learner=10, **extra):
    row = {
        "activity_id": activity_id, "source_activity_id": int(activity_id.split(":")[-1]),
        "learner_id": learner, "group_id": group, "month": month,
        "category": category, "activity": title, "actual": actual,
        "planned": 0.0, "mapped_seconds": None, "hours_mapped": actual > 0,
        "completed": False, "created_at": None,
    }
    row.update(extra)
    return row


class ReadingQuizMergeTests(SimpleTestCase):
    def test_title_key_ignores_punctuation_and_marker_words(self):
        self.assertEqual(_merge_title_key("Study Skills — Quiz"), _merge_title_key("study skills"))
        self.assertEqual(_merge_title_key("Reading: Study Skills!"), _merge_title_key("Study   Skills"))
        self.assertEqual(_merge_title_key(None), "")

    def test_title_key_matches_real_catalogue_prefixes(self):
        # Live catalogue patterns: Q-numbered quizzes vs "Additional Reading:".
        self.assertEqual(_merge_title_key("Q2-What is Project?"), _merge_title_key("Additional Reading: What is Project?"))
        self.assertEqual(_merge_title_key("Q2: Organisation Structure"), _merge_title_key("Organisation Structure"))
        # Content numbering (P1-PPT...) is NOT a marker — different stems stay apart.
        self.assertNotEqual(_merge_title_key("P1-PPT-Course Overview"), _merge_title_key("P2-PPT-Course Overview"))

    def test_matched_pair_becomes_one_bundle_with_summed_hours(self):
        items = [
            _half("la:2:11", "reading", "Study Skills (Reading)", actual=1.5, reading_viewed=True),
            _half("la:2:12", "quiz", "Study Skills — Quiz", actual=0.5, quiz_attempted=True, quiz_passed=True),
        ]
        merged = merge_reading_quiz_rows(items)
        self.assertEqual(len(merged), 1)
        row = merged[0]
        self.assertEqual(row["category"], "reading+quiz")
        self.assertEqual(row["activity_id"], "la:2:11")  # reading half keeps identity
        self.assertEqual(row["actual"], 2.0)             # summed, never double-counted
        self.assertTrue(row["quiz_passed"])
        self.assertEqual(row["merged_source_activity_ids"], [11, 12])

    def test_singletons_and_other_months_stay_untouched(self):
        items = [
            _half("la:2:11", "reading", "Study Skills", actual=1.0),
            _half("la:2:12", "quiz", "Study Skills", month="2026-04"),
            _half("la:2:13", "video", "Study Skills"),
        ]
        merged = merge_reading_quiz_rows(items)
        self.assertEqual(len(merged), 3)
        self.assertEqual({row["category"] for row in merged}, {"reading", "quiz", "video"})

    def test_quiz_listed_before_reading_still_merges(self):
        # Regression: list order is arbitrary — a quiz half that appears FIRST
        # must not slip into the output before its reading partner claims it.
        items = [
            _half("la:2:12", "quiz", "Q2-What is Project?", actual=0.25),
            _half("la:2:11", "reading", "Additional Reading: What is Project?", actual=1.0),
        ]
        merged = merge_reading_quiz_rows(items)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["category"], "reading+quiz")
        self.assertEqual(merged[0]["actual"], 1.25)

    def test_overlay_touched_rows_are_never_merged(self):
        items = [
            _half("la:2:11", "reading", "Study Skills"),
            _half("la:2:12", "quiz", "Study Skills"),
        ]
        merged = merge_reading_quiz_rows(items, protected_ids=frozenset({"la:2:12"}))
        self.assertEqual(len(merged), 2)


class OverlayCategoryTests(SimpleTestCase):
    BASE = {"date": "2026-03-04", "activity": "Row", "planned": 1, "actual": 1}

    def _validate(self, category, **kwargs):
        return _validate_overlay_activity(
            {**self.BASE, "category": category},
            aptem_id=1, learner_name="L", activity_id="la:2:11", **kwargs,
        )

    def test_new_rows_stay_strict(self):
        with self.assertRaises(ValueError):
            self._validate("reading")

    def test_mirror_edits_keep_their_source_category(self):
        payload = self._validate("reading", allow_any_category=True)
        self.assertEqual(payload["category"], "reading")
        payload = self._validate("Activity", allow_any_category=True)
        self.assertEqual(payload["category"], "activity")

    def test_garbage_categories_still_rejected(self):
        with self.assertRaises(ValueError):
            self._validate("", allow_any_category=True)
        with self.assertRaises(ValueError):
            self._validate("x" * 60, allow_any_category=True)


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
