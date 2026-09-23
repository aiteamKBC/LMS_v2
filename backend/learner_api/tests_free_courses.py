"""Free courses assigned to a learner from the Learning Plan modal.

The feature stores free courses as a *pure assignment record*: no hours, no KSBs,
no progress, kept in their own ``Created_users."Free_courses"`` column and
read/written by ``learner_api.learning_plan``. These tests pin the normaliser
that guarantees the stored shape — it drops anything a client tries to smuggle in
(hours, KSBs, unknown keys), dedupes, and rejects a non-list.

DB-free (``SimpleTestCase``) so they run anywhere, including a plain
``manage.py test learner_api.tests_free_courses``.
"""
from django.test import SimpleTestCase

from .free_courses_view import _activity
from .mappers import ValidationError, _normalize_free_courses


class NormalizeFreeCoursesTests(SimpleTestCase):
    def test_none_and_empty_become_empty_list(self):
        self.assertEqual(_normalize_free_courses(None), [])
        self.assertEqual(_normalize_free_courses([]), [])

    def test_non_list_rejected(self):
        with self.assertRaises(ValidationError):
            _normalize_free_courses({"freeCourseId": "FREECOURSE-1"})

    def test_keeps_only_id_name_addedat_and_nothing_else(self):
        # A client that tries to smuggle hours/KSBs onto the record gets them
        # dropped: only the three assignment fields survive.
        out = _normalize_free_courses([
            {
                "freeCourseId": "FREECOURSE-1",
                "courseName": "First aid",
                "addedAt": "2026-09-20T10:00:00Z",
                "expectedOtjh": 99,
                "ksbs": ["K1"],
            },
        ])
        self.assertEqual(out, [
            {"freeCourseId": "FREECOURSE-1", "courseName": "First aid", "addedAt": "2026-09-20T10:00:00Z"},
        ])

    def test_drops_idless_and_non_dict_entries(self):
        out = _normalize_free_courses([
            {"courseName": "no id"},
            "not a dict",
            {"freeCourseId": "FREECOURSE-2", "courseName": "Kept"},
        ])
        self.assertEqual([f["freeCourseId"] for f in out], ["FREECOURSE-2"])

    def test_deduplicates_by_free_course_id_keeping_first(self):
        out = _normalize_free_courses([
            {"freeCourseId": "FREECOURSE-3", "courseName": "First"},
            {"freeCourseId": "FREECOURSE-3", "courseName": "Duplicate"},
        ])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["courseName"], "First")


class FreeCourseActivityMapperTests(SimpleTestCase):
    """`_activity` maps an authored component to the learner viewer shape and
    carries NO hours/KSB/progress fields (free courses have none by design)."""

    def test_reading_maps_content_html_and_no_progress_fields(self):
        out = _activity({
            "id": "FREECOMP-1",
            "title": "Intro reading",
            "type": "reading",
            "description": "Read this",
            "settings": {"readingContent": "<p>Hello</p>", "expectedOtjh": 5, "downloadAllowed": True},
        })
        self.assertEqual(out["componentId"], "FREECOMP-1")
        self.assertEqual(out["contentHtml"], "<p>Hello</p>")
        self.assertTrue(out["downloadAllowed"])
        # Nothing hours/KSB/progress leaks through.
        for banned in ("expectedOtjh", "ksbMappings", "completed", "planned"):
            self.assertNotIn(banned, out)

    def test_video_url_resolved_from_settings(self):
        out = _activity({
            "id": "FREECOMP-2",
            "title": "Watch",
            "type": "video",
            "settings": {"videoUrl": "https://youtu.be/abc123"},
        })
        self.assertEqual(out["videoUrl"], "https://youtu.be/abc123")

    def test_missing_or_bad_settings_is_safe(self):
        out = _activity({"id": "FREECOMP-3", "title": "Bare", "type": "reading", "settings": None})
        self.assertIsNone(out["contentHtml"])
        self.assertIsNone(out["videoUrl"])
        self.assertFalse(out["downloadAllowed"])
