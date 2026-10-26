import json
from datetime import datetime, timezone

from django.test import SimpleTestCase

from coach_api.monthly_reports import _list_row_to_summary, _summary_row
from coach_api.views import (
    indexed_monthly_events_for_learner,
    index_monthly_events,
    monthly_event_matches_learner,
    serialize_marking_submission,
)
from learner_api.monthly_reports import _row_to_report


class CoachMonthlyReportProjectionTests(SimpleTestCase):
    databases = set()

    def test_lean_row_preserves_existing_list_contract(self):
        stamp = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
        snapshot = [{"title": "Activity"}, {"title": "Quiz"}]
        full_row = (
            "00000000-0000-0000-0000-000000000001", "apprenticeship", "42",
            "Example Learner", "Programme", "2026-10", "October 2026",
            "submitted", snapshot, {"totalEvents": 2}, [{"id": "file-1"}],
            "What I learned", stamp, stamp, [{"code": "K1"}],
            "data:image/png;base64,signature", "Example Learner", stamp,
        )
        lean_row = (
            *full_row[:8], full_row[9], full_row[10], full_row[11], full_row[12],
            full_row[13], full_row[14], True, full_row[16], full_row[17], len(snapshot),
        )

        self.assertEqual(_list_row_to_summary(lean_row), _summary_row(_row_to_report(full_row)))


class MarkingListProjectionTests(SimpleTestCase):
    databases = set()

    def test_projected_submission_json_preserves_serialized_list_item(self):
        stamp = datetime(2026, 10, 2, 9, 30, tzinfo=timezone.utc)
        history = [{
            "status": "rejected", "submittedAt": stamp.isoformat(),
            "reviewedAt": stamp.isoformat(), "reviewedBy": "Coach",
            "coachFeedback": "Revise", "content": {"assignmentAnswer": "First"},
        }]
        full_submission = {
            "assignmentAttemptHistory": history,
            "assignmentAnswer": "Current",
            "learningReflection": "Current reflection",
            "monthlyAssignment": {"large": "x" * 10000},
        }
        projected = {
            "assignmentAttemptHistory": history,
            "assignmentAnswer": "Current",
            "learningReflection": "Current reflection",
        }
        base = {
            "id": "00000000-0000-0000-0000-000000000002",
            "learner_kind": "apprenticeship", "learner_id": "42",
            "learner_name": "Example Learner", "programme_name": "Programme",
            "activity_type": "assignment", "activity_id": "A1",
            "activity_title": "Assignment", "module_title": "Module",
            "week_title": "Week", "planned_otjh": "2", "status": "rejected",
            "learning_reflection": "Current reflection", "ksb_codes": ["K1"],
            "ksb_weights": {}, "ksb_explanations": {}, "confidence_before": {},
            "confidence_after": {}, "application_type": "", "application_text": "",
            "evidence_files": [], "evidence_consent_confirmed": True,
            "selected_benefits": [], "benefit_explanation": "",
            "actual_time_hours": "2", "completed_during_paid_hours": "yes",
            "date_completed": None, "otjh_confirmed": True,
            "signed_declaration": True, "quality_score": 100,
            "coach_feedback": "Revise", "reviewed_by": "Coach",
            "reviewed_at": stamp, "submitted_at": stamp,
        }

        before = serialize_marking_submission({**base, "full_submission": full_submission}, now=stamp)
        after = serialize_marking_submission({**base, "full_submission": projected}, now=stamp)

        self.assertEqual(after, before)
        self.assertLess(len(json.dumps(projected)), len(json.dumps(full_submission)))


class MonthlyEventIndexTests(SimpleTestCase):
    databases = set()

    def test_index_preserves_identity_fallback_deduplication_and_order(self):
        events = [
            {"id": "first", "learnerId": "7", "email": "same@example.test"},
            {"id": "other", "learnerId": "8", "email": "other@example.test"},
            {"id": "email-fallback", "learnerId": "999", "email": "same@example.test"},
            {"id": "unscoped"},
        ]
        learners = [
            {"id": "7", "email": "same@example.test"},
            {"id": "8", "email": "other@example.test"},
        ]
        event_index = index_monthly_events(events)

        for learner in learners:
            expected = [event for event in events if monthly_event_matches_learner(event, learner)]
            self.assertEqual(indexed_monthly_events_for_learner(event_index, learner), expected)

