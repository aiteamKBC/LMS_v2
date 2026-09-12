"""Directory reads must stay small and never run learner progression."""
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import views
from .directory import DIRECTORY_FIELDS
from .mappers import to_list_row
from .models import EnrolmentUser


def directory_learner(pk=1, has_plan=False, learner_type="commercial"):
    data = {
        "id": pk, "uuid": UUID(int=pk), "username": "Test learner",
        "type": "User", "email": "learner@example.test", "group": "Group A",
        "status": "FullUser", "programme_status": "Delivery", "programme": "Marketing",
        "cohort": "September", "organization": "REF-1", "learner_type": learner_type,
    }
    loaded_fields = [
        field.attname
        for field in EnrolmentUser._meta.concrete_fields
        if field.attname in DIRECTORY_FIELDS
    ]
    learner = EnrolmentUser.from_db(
        "enrolment", loaded_fields, [data[key] for key in loaded_fields]
    )
    learner._directory_has_learning_plan = has_plan
    return learner


class DirectoryRowTests(SimpleTestCase):
    def test_serializing_a_directory_never_fetches_deferred_documents(self):
        learners = [directory_learner(pk, bool(pk % 2)) for pk in range(1, 370)]
        with patch.object(EnrolmentUser, "refresh_from_db", side_effect=AssertionError("Deferred field fetched")):
            rows = [to_list_row(learner) for learner in learners]
        self.assertEqual(len(rows), 369)
        self.assertEqual(rows[0]["hasLearningPlan"], True)
        self.assertEqual(rows[1]["hasLearningPlan"], False)
        self.assertEqual(rows[0]["programmeStatus"], "Delivery")
        self.assertTrue(all({"learning_plan", "training_plan"} <= learner.get_deferred_fields() for learner in learners))

    def test_full_learner_responses_keep_the_existing_plan_rules(self):
        for learning_plan, training_plan, expected in (
            (None, None, False), ([], {}, False), ("", False, False),
            ([{"moduleTitle": "Marketing"}], None, True),
            (None, [{"moduleTitle": "Marketing"}], True),
        ):
            with self.subTest(learning_plan=learning_plan, training_plan=training_plan):
                learner = directory_learner()
                del learner._directory_has_learning_plan
                learner.learning_plan = learning_plan
                learner.training_plan = training_plan
                self.assertEqual(to_list_row(learner)["hasLearningPlan"], expected)

    def test_legacy_null_kind_keeps_apprenticeship_routing(self):
        row = to_list_row(directory_learner(learner_type=None))
        self.assertEqual(row["source"], "apprenticeship")
        self.assertEqual(row["learnerType"], "apprenticeship")
        self.assertEqual(row["name"], "Test learner")
        self.assertEqual(row["cohort"], "September")
        self.assertTrue(row["subscriptionVerified"])


class LearnerDirectoryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_get_preserves_rows_and_account_flags_without_advancing_statuses(self):
        learners = [directory_learner(1, True), directory_learner(2, False)]

        def accounts(rows, subject_type):
            self.assertEqual(subject_type, "learner")
            for row in rows:
                row.update(hasAccount=True, hasSignedIn=False)

        with patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff")), \
             patch.object(views, "learner_directory_queryset", return_value=learners) as listing, \
             patch.object(views, "advance_learner") as advance, \
             patch.object(views, "_annotate_account_state", side_effect=accounts) as annotate:
            response = views.enrolment_users(self.factory.get("/learner_api/enrolment-users/"))
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertEqual(data["count"], 2)
        self.assertEqual([row["programmeStatus"] for row in data["results"]], ["Delivery", "Delivery"])
        self.assertTrue(data["results"][0]["hasAccount"])
        self.assertFalse(data["results"][0]["hasSignedIn"])
        listing.assert_called_once_with("")
        annotate.assert_called_once()
        advance.assert_not_called()

    def test_kind_filter_is_passed_through(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind), \
                 patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff")), \
                 patch.object(views, "learner_directory_queryset", return_value=[]) as listing, \
                 patch.object(views, "_annotate_account_state"):
                response = views.enrolment_users(self.factory.get("/learner_api/enrolment-users/", {"learnerType": kind}))
                self.assertEqual(response.status_code, 200)
                listing.assert_called_once_with(kind)

    def test_invalid_kind_and_learner_accounts_cannot_query_the_directory(self):
        for role, query, status in (("staff", {"learnerType": "unknown"}, 400), ("learner", {}, 403)):
            with self.subTest(role=role), \
                 patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role=role)), \
                 patch.object(views, "learner_directory_queryset") as listing:
                response = views.enrolment_users(self.factory.get("/learner_api/enrolment-users/", query))
                self.assertEqual(response.status_code, status)
                listing.assert_not_called()

    def test_database_failure_is_reported_instead_of_an_empty_directory(self):
        with patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff")), \
             patch.object(views, "learner_directory_queryset", side_effect=DatabaseError("unavailable")):
            response = views.enrolment_users(self.factory.get("/learner_api/enrolment-users/"))
        self.assertEqual(response.status_code, 502)
        self.assertIn("unavailable", json.loads(response.content)["error"])
