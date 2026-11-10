"""DB-free contracts for the canonical Free Course authoring projection."""
from contextlib import nullcontext
from copy import deepcopy
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import free_course_authoring as authoring


def course_row(**changes):
    value = {
        "id": "FREE-1", "course_name": "Course", "description": "Description",
        "cover_image_url": "/cover.png", "display_order": 2,
        "course_type": "short", "is_for_sale": False,
        "price": Decimal("10.00"), "currency": "GBP",
        "week_count": 2, "component_count": 2, "total_otjh": Decimal("1.50"),
    }
    value.update(changes)
    return value


def week_row(identifier="FW-1", **changes):
    value = {
        "id": identifier, "course_id": "FREE-1", "display_order": 0,
        "week_number": 1, "title": "Week", "summary": "Summary",
        "learning_outcomes": "Outcomes", "status": "active",
        "holiday_note_enabled": False, "holiday_note": "",
        "legacy_copied_from_week_id": None,
    }
    value.update(changes)
    return value


def component_row(identifier="FC-1", **changes):
    value = {
        "id": identifier, "free_module_id": "FW-1", "programme_id": "FREE-COURSES",
        "type": "quiz", "title": "Activity", "description": "",
        "expected_otjh": Decimal("0.50"), "points": 2,
        "reflection_required": False, "workplace_evidence_required": False,
        "tutor_validation_required": False, "display_order": 0,
        "settings_json": {},
    }
    value.update(changes)
    return value


class RevisionContractTests(SimpleTestCase):
    def test_catalogue_revision_ignores_sql_order_and_irrelevant_columns(self):
        rows = [
            course_row(id="FREE-2", display_order=1, updated_at="one"),
            course_row(id="FREE-1", display_order=0, updated_at="two"),
        ]
        changed_timestamps = [dict(row, updated_at="different", created_at="later") for row in reversed(rows)]
        self.assertEqual(
            authoring.catalogue_revision(rows),
            authoring.catalogue_revision(changed_timestamps),
        )
        self.assertRegex(authoring.catalogue_revision(rows), r"^fccv1:[0-9a-f]{64}$")

    def test_catalogue_revision_changes_for_membership_or_order(self):
        rows = [course_row(id="FREE-1", display_order=0)]
        self.assertNotEqual(
            authoring.catalogue_revision(rows),
            authoring.catalogue_revision([course_row(id="FREE-1", display_order=1)]),
        )
        self.assertNotEqual(
            authoring.catalogue_revision(rows),
            authoring.catalogue_revision(rows + [course_row(id="FREE-2", display_order=2)]),
        )

    def test_course_revision_is_independent_of_row_and_object_key_order(self):
        course = course_row(updated_at="ignored")
        weeks = [week_row("FW-2", display_order=1), week_row("FW-1", display_order=0)]
        components = [
            component_row("FC-2", free_module_id="FW-2", settings_json={"b": 2, "a": {"y": 2, "x": 1}}),
            component_row("FC-1", settings_json={"linkedQuizId": "Q-1"}),
        ]
        quizzes = [
            {"id": "Q-2", "free_course_week_id": "FW-2", "status": "draft", "week_id": None},
            {"id": "Q-1", "free_course_week_id": "FW-1", "status": "published", "week_id": None},
        ]
        links = [
            {
                "id": 9, "quiz_id": "Q-2", "free_course_week_id": "FW-2",
                "free_course_id": "FREE-1", "module_catalogue_id": None, "week_id": None,
            },
            {
                "id": 8, "quiz_id": "Q-1", "free_course_week_id": "FW-1",
                "free_course_id": "FREE-1", "module_catalogue_id": None, "week_id": None,
            },
        ]
        first = authoring.course_revision(course, weeks, components, quizzes, links)
        reordered_components = [deepcopy(row) for row in reversed(components)]
        next(row for row in reordered_components if row["id"] == "FC-2")["settings_json"] = {
            "a": {"x": 1, "y": 2}, "b": 2,
        }
        second = authoring.course_revision(
            dict(reversed(list(course.items()))),
            list(reversed(weeks)), reordered_components,
            list(reversed(quizzes)), list(reversed(links)),
        )
        self.assertEqual(first, second)
        self.assertRegex(first, r"^fcv1:[0-9a-f]{64}$")

    def test_course_revision_excludes_timestamps_but_includes_content(self):
        course = course_row(created_at="before", updated_at="before")
        week = week_row(updated_at="before")
        component = component_row(updated_at="before")
        baseline = authoring.course_revision(course, [week], [component], [], [])
        self.assertEqual(
            baseline,
            authoring.course_revision(
                dict(course, created_at="after", updated_at="after"),
                [dict(week, updated_at="after")],
                [dict(component, updated_at="after")], [], [],
            ),
        )
        self.assertNotEqual(
            baseline,
            authoring.course_revision(course, [dict(week, title="Changed")], [component], [], []),
        )

    def test_decimal_and_json_normalization_is_stable(self):
        first = {"price": Decimal("10.00"), "settings": {"z": 1, "a": [2, 3]}}
        second = {"settings": {"a": [2, 3], "z": 1}, "price": Decimal("10")}
        self.assertEqual(authoring.canonical_json_bytes(first), authoring.canonical_json_bytes(second))


class AuthoringDocumentTests(SimpleTestCase):
    def _document(self, components, quizzes=(), links=(), weeks=None):
        weeks = weeks if weeks is not None else [week_row()]
        with mock.patch.object(authoring.schema_gate, "require_tables"), \
             mock.patch.object(authoring, "_read_snapshot", return_value=nullcontext()), \
             mock.patch.object(authoring.free_course_catalogue, "courses", return_value=[course_row()]), \
             mock.patch.object(authoring.free_course_catalogue, "weeks", return_value=weeks), \
             mock.patch.object(authoring.free_course_catalogue, "components", return_value=components), \
             mock.patch.object(authoring, "_quiz_rows", return_value=list(quizzes)), \
             mock.patch.object(authoring, "_quiz_link_rows", return_value=list(links)):
            return authoring.course_document("FREE-1")

    def test_staff_document_returns_inactive_weeks_and_no_legacy_week_id_alias(self):
        result = self._document([], weeks=[
            week_row("FW-1", status="active"),
            week_row("FW-2", status="inactive", display_order=1,
                     legacy_copied_from_week_id="NORMAL-9"),
        ])
        self.assertEqual([row["status"] for row in result["weeks"]], ["active", "inactive"])
        self.assertEqual(result["weeks"][1]["freeCourseWeekId"], "FW-2")
        self.assertEqual(result["weeks"][1]["legacyCopiedFromWeekId"], "NORMAL-9")
        self.assertNotIn("weekId", result["weeks"][1])

    def test_all_110_legacy_references_remain_settings_and_are_classified(self):
        components = []
        quizzes = []
        for index in range(110):
            quiz_id = f"LEGACY-{index}"
            components.append(component_row(
                f"FC-{index}", display_order=index,
                settings_json={"linkedQuizId": quiz_id, "preserved": index},
            ))
            quizzes.append({
                "id": quiz_id, "free_course_week_id": None,
                "week_id": f"NORMAL-{index}",
                "status": "trash" if index < 6 else "published",
            })
        result = self._document(components, quizzes=quizzes)
        references = [row["quizReference"] for row in result["weeks"][0]["components"]]
        self.assertEqual(result["integrity"]["legacyQuizReferenceCount"], 110)
        self.assertEqual(sum(ref["classification"] == "trashed" for ref in references), 6)
        self.assertTrue(all(ref["ownerClassification"] == "legacy-normal-owner" for ref in references))
        self.assertEqual(
            {row["settings"]["linkedQuizId"] for row in result["weeks"][0]["components"]},
            {f"LEGACY-{index}" for index in range(110)},
        )

    def test_duplicate_canonical_links_are_blocking(self):
        component = component_row(settings_json={"linkedQuizId": "Q-1"})
        quiz = {"id": "Q-1", "free_course_week_id": "FW-1", "week_id": None, "status": "published"}
        link = {
            "quiz_id": "Q-1", "free_course_week_id": "FW-1",
            "free_course_id": "FREE-1", "module_catalogue_id": None, "week_id": None,
        }
        result = self._document([component], [quiz], [dict(link, id=1), dict(link, id=2)])
        reference = result["weeks"][0]["components"][0]["quizReference"]
        self.assertEqual(reference["classification"], "duplicate-canonical-link")
        self.assertEqual(result["integrity"]["status"], "blocked")
        self.assertIn("duplicate_canonical_quiz_link", {issue["code"] for issue in result["integrity"]["issues"]})

    def test_exact_canonical_owner_is_classified_without_issue(self):
        component = component_row(settings_json={"linkedQuizId": "Q-1"})
        quiz = {"id": "Q-1", "free_course_week_id": "FW-1", "week_id": None, "status": "published"}
        link = {
            "id": 1, "quiz_id": "Q-1", "free_course_week_id": "FW-1",
            "free_course_id": "FREE-1", "module_catalogue_id": None, "week_id": None,
        }
        result = self._document([component], [quiz], [link])
        self.assertEqual(result["integrity"]["status"], "ok")
        self.assertEqual(
            result["weeks"][0]["components"][0]["quizReference"]["classification"],
            "canonical",
        )

    def test_canonical_quiz_with_normal_week_owner_is_blocking(self):
        component = component_row(settings_json={"linkedQuizId": "Q-1"})
        quiz = {
            "id": "Q-1", "free_course_week_id": "FW-1",
            "week_id": "NORMAL-WEEK", "status": "published",
        }
        link = {
            "id": 1, "quiz_id": "Q-1", "free_course_week_id": "FW-1",
            "free_course_id": "FREE-1", "module_catalogue_id": None, "week_id": None,
        }
        result = self._document([component], [quiz], [link])
        self.assertEqual(result["integrity"]["status"], "blocked")
        self.assertIn(
            "canonical_quiz_has_normal_week_owner",
            {issue["code"] for issue in result["integrity"]["issues"]},
        )

    def test_owner_mismatch_is_blocking(self):
        component = component_row(settings_json={"linkedQuizId": "Q-1"})
        quiz = {"id": "Q-1", "free_course_week_id": "FW-OTHER", "week_id": None, "status": "published"}
        result = self._document([component], [quiz], [])
        self.assertEqual(
            result["weeks"][0]["components"][0]["quizReference"]["classification"],
            "owner-mismatch",
        )
        self.assertEqual(result["integrity"]["status"], "blocked")

    def test_component_cross_course_owner_is_blocking(self):
        result = self._document([component_row(programme_id="NORMAL-CURRICULUM")])
        self.assertEqual(result["integrity"]["status"], "blocked")
        self.assertIn(
            "free_component_programme_marker_mismatch",
            {issue["code"] for issue in result["integrity"]["issues"]},
        )

    def test_missing_course_raises_specific_not_found(self):
        with mock.patch.object(authoring.schema_gate, "require_tables"), \
             mock.patch.object(authoring, "_read_snapshot", return_value=nullcontext()), \
             mock.patch.object(authoring.free_course_catalogue, "courses", return_value=[]):
            with self.assertRaises(authoring.FreeCourseNotFound):
                authoring.course_document("FREE-404")

    def test_course_id_validation_rejects_blank_control_and_oversized_values(self):
        for value in ("", "  ", "bad\x00id", "x" * 129):
            with self.subTest(value=repr(value)):
                with self.assertRaises(authoring.InvalidFreeCourseId):
                    authoring.normalize_course_id(value)

    def test_quiz_link_bulk_read_excludes_normal_module_links(self):
        cursor = mock.MagicMock()
        cursor.description = []
        cursor.fetchall.return_value = []
        database = mock.MagicMock(vendor="postgresql")
        database.cursor.return_value.__enter__.return_value = cursor
        with mock.patch.object(authoring, "connection", database):
            authoring._quiz_link_rows("FREE-1", {"NORMAL-Q-1"})
        sql = cursor.execute.call_args.args[0].lower()
        self.assertIn('"free_course_id" = %s', sql)
        self.assertIn('"free_course_week_id" is not null', sql)
        self.assertNotIn('module_catalogue_id" is not null', sql)
