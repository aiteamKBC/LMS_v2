"""Free Course progress after the data migration (unknown completion dates).

The migrated store holds completions whose original date could not be verified
(``completed_at`` NULL). A row is a completion whatever its date; these tests pin
that, and that reading or recording completions never rewrites a date or
touches programme progress, OTJH, KSBs or the training plan.
"""
import json
from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import free_courses_view as view

LEARNER = SimpleNamespace(pk=497, enrolment_id=134, learner_type="commercial")


def inner(fn):
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


def two_courses(activity_count=24):
    courses = {
        "FREE-GDPR": {"id": "FREE-GDPR", "course_name": "GDPR"},
        "FREE-SRA": {"id": "FREE-SRA", "course_name": "Suicidal Risk Awareness Course"},
    }
    weeks = [
        {"id": "W-GDPR", "course_id": "FREE-GDPR"},
        {"id": "W-SRA", "course_id": "FREE-SRA"},
    ]
    components = [
        {"id": f"{prefix}-{number}", "free_module_id": week, "type": "reading", "display_order": number}
        for prefix, week in (("GDPR", "W-GDPR"), ("SRA", "W-SRA"))
        for number in range(activity_count)
    ]
    return courses, weeks, components


class UnknownDateProgressReadTests(SimpleTestCase):
    def summary(self, completed):
        with patch.object(view, "_resolve_source", return_value=(LEARNER, None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-GDPR", "FREE-SRA"]), \
             patch.object(view, "_scoped_rows", return_value=two_courses()), \
             patch.object(view, "_completed_refs", return_value=completed):
            response = inner(view.free_courses)(RequestFactory().get("/"), "commercial", 134)
        self.assertEqual(response.status_code, 200)
        return {card["freeCourseId"]: card for card in json.loads(response.content)["freeCourses"]}

    def test_partial_progress_is_six_of_twenty_four_per_course(self):
        completed = {("FREE-GDPR", f"GDPR-{n}") for n in range(6)} | {("FREE-SRA", f"SRA-{n}") for n in range(6)}
        cards = self.summary(completed)
        for course_id in ("FREE-GDPR", "FREE-SRA"):
            self.assertEqual(cards[course_id]["activityCount"], 24)
            self.assertEqual(cards[course_id]["completedActivities"], 6)
            self.assertEqual(cards[course_id]["progressPercentage"], 25)

    def test_completion_counts_only_against_its_own_course_and_existing_components(self):
        completed = {
            ("FREE-GDPR", "GDPR-0"),
            # Recorded against the other course: not a GDPR completion.
            ("FREE-SRA", "GDPR-1"),
            # A component that is no longer in the course.
            ("FREE-GDPR", "GDPR-REMOVED"),
        }
        cards = self.summary(completed)
        self.assertEqual(cards["FREE-GDPR"]["completedActivities"], 1)
        self.assertEqual(cards["FREE-SRA"]["completedActivities"], 0)
        self.assertEqual(cards["FREE-GDPR"]["progressPercentage"], 4)

    def test_no_course_shows_complete_from_partial_progress(self):
        cards = self.summary({("FREE-GDPR", f"GDPR-{n}") for n in range(23)})
        self.assertEqual(cards["FREE-GDPR"]["progressPercentage"], 96)
        self.assertEqual(cards["FREE-SRA"]["progressPercentage"], 0)


class CompletionWriteTests(SimpleTestCase):
    def complete(self, objects, component_id="GDPR-3"):
        request = RequestFactory().post("/", data=json.dumps({"componentId": component_id}),
                                        content_type="application/json")
        with patch.object(view, "_resolve_source", return_value=(LEARNER, None)), \
             patch.object(view, "assigned_course_ids", return_value=["FREE-GDPR", "FREE-SRA"]), \
             patch.object(view, "_scoped_rows", return_value=two_courses()), \
             patch.object(view.LearnerFreeCourseProgress, "objects", objects), \
             patch("learner_api.models.LearnerProgressEntry.objects") as programme_progress, \
             patch("learner_api.progress_cache.bump_learners") as bump:
            response = inner(view.complete_free_course_activity)(request, "commercial", 134)
        programme_progress.assert_not_called()
        self.assertEqual(programme_progress.mock_calls, [])
        bump.assert_not_called()
        return response

    def test_new_completion_stores_now(self):
        now = datetime(2026, 11, 11, 12, 0, tzinfo=dt_timezone.utc)
        objects = Mock()
        objects.get_or_create.return_value = (SimpleNamespace(), True)
        with patch.object(view.timezone, "now", return_value=now):
            response = self.complete(objects)
        self.assertEqual(response.status_code, 200)
        objects.get_or_create.assert_called_once_with(
            learner_id=497, component_ref="GDPR-3",
            defaults={"free_course_ref": "FREE-GDPR", "completed_at": now},
        )

    def test_repeat_completion_is_idempotent_and_keeps_the_existing_date(self):
        # The existing row may carry a verified date or none at all (NULL);
        # either way a repeat only looks it up and never rewrites it.
        for existing_date in (datetime(2026, 9, 23, tzinfo=dt_timezone.utc), None):
            with self.subTest(existing_date=existing_date):
                existing = SimpleNamespace(completed_at=existing_date)
                objects = Mock()
                objects.get_or_create.return_value = (existing, False)
                first = self.complete(objects)
                second = self.complete(objects)
                self.assertEqual((first.status_code, second.status_code), (200, 200))
                self.assertEqual(json.loads(second.content), {"componentId": "GDPR-3", "completed": True})
                self.assertEqual(existing.completed_at, existing_date)
                self.assertEqual({call[0] for call in objects.mock_calls}, {"get_or_create"})
