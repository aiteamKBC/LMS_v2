"""Directory reads must stay small and never run learner progression."""
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import views
from .directory import DIRECTORY_FIELDS, learner_directory_queryset, to_directory_row
from .mappers import to_list_row
from .models import EnrolmentUser


def directory_learner(pk=1, has_plan=False, learner_type="commercial"):
    data = {
        "id": pk, "uuid": UUID(int=pk), "username": "Test learner",
        "type": "User", "email": "learner@example.test",
        "status": "FullUser", "programme_status": "Delivery",
        "programme_id": "P1", "cohort_id": "C1", "group_id": "G1",
        "organization": "REF-1", "learner_type": learner_type,
        "case_owner": "Example Owner",
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
    learner._directory_programme = 'Marketing'
    learner._directory_cohort = 'September'
    learner._directory_group = 'Group A'
    return learner


class DirectoryRowTests(SimpleTestCase):
    def test_projection_compiles_using_only_real_fields_and_created_user_ids(self):
        for name in DIRECTORY_FIELDS:
            self.assertTrue(EnrolmentUser._meta.get_field(name).concrete)
        for kind in ('', 'commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                query = learner_directory_queryset(kind)
                sql, _ = query.query.get_compiler(using='enrolment').as_sql()
                self.assertIn('FROM "enrolment"."Created_users"', sql)
                self.assertNotIn('"Learner"', sql)
                self.assertNotIn('Aptem_users', sql)
                for key in ('programme_id', 'cohort_id', 'group_id'):
                    self.assertIn(f'"enrolment"."Created_users".{key}', sql)
                for legacy in ('Programme', 'Cohort', 'Group'):
                    self.assertNotIn(f'."{legacy}"', sql)
                self.assertEqual(query.query.order_by, ('id',))
                self.assertFalse(query.query.distinct)

    def test_directory_labels_never_call_the_shared_learner_relationship_reader(self):
        learner = directory_learner(pk=42)
        with patch('learner_api.models._learner_placement_names',
                   side_effect=AssertionError('Directory must not read Learner placement')):
            row = to_directory_row(learner)
        self.assertEqual((row['id'], row['programme'], row['cohort'], row['group']),
                         ('42', 'Marketing', 'September', 'Group A'))

    def test_missing_relationship_labels_keep_the_created_user_and_empty_string_contract(self):
        for name, response_key in (('programme', 'programme'), ('cohort', 'cohort'), ('group', 'group')):
            with self.subTest(relationship=name):
                learner = directory_learner(pk=42)
                setattr(learner, f'_directory_{name}', None)
                row = to_directory_row(learner)
                self.assertEqual(row['id'], '42')
                self.assertEqual(row[response_key], '')

    def test_statuses_are_separate_created_user_values_without_external_overrides(self):
        learner = directory_learner()
        learner.status = 'Invited'
        learner.programme_status = 'Delivery'
        learner._aptem_programme_status = 'Withdrawn'
        row = to_directory_row(learner)
        self.assertEqual(row['subscriptionStatus'], 'Invited')
        self.assertFalse(row['subscriptionVerified'])
        self.assertEqual(row['programmeStatus'], 'Delivery')
        self.assertEqual(EnrolmentUser._meta.get_field('status').column, ' Status')
        self.assertEqual(EnrolmentUser._meta.get_field('programme_status').column, 'Programme_status')

    def test_all_created_user_types_and_duplicate_emails_keep_distinct_identities(self):
        from .constants import TYPE_CHOICES
        rows = []
        for pk, user_type in enumerate(TYPE_CHOICES, start=1):
            learner = directory_learner(pk=pk)
            learner.type = user_type
            rows.append(to_directory_row(learner))
        self.assertEqual([row['type'] for row in rows], list(TYPE_CHOICES))
        self.assertEqual(len({row['id'] for row in rows}), len(TYPE_CHOICES))
        self.assertEqual(len({row['email'] for row in rows}), 1)
        for row in rows:
            self.assertIsInstance(row['id'], str)
            self.assertIsInstance(row['programme'], str)
            self.assertIsInstance(row['subscriptionVerified'], bool)
            self.assertIsInstance(row['hasLearningPlan'], bool)

    def test_serializing_a_directory_never_fetches_deferred_documents(self):
        learners = [directory_learner(pk, bool(pk % 2)) for pk in range(1, 370)]
        with patch.object(EnrolmentUser, "refresh_from_db", side_effect=AssertionError("Deferred field fetched")):
            rows = [to_directory_row(learner) for learner in learners]
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
                # This separate shared-mapper contract retains its existing
                # Login/Learner property behaviour, outside directory ownership.
                learner._placement_names = ('Marketing', 'September', 'Group A')
                learner._aptem_programme_status = None
                self.assertEqual(to_list_row(learner)["hasLearningPlan"], expected)

    def test_the_case_owner_reaches_the_row_without_a_deferred_fetch(self):
        """The Case owner filter builds its options from these values, so the
        column has to be in the projection as well as the payload."""
        self.assertIn("case_owner", DIRECTORY_FIELDS)
        learner = directory_learner()
        with patch.object(EnrolmentUser, "refresh_from_db",
                          side_effect=AssertionError("Deferred field fetched")):
            self.assertEqual(to_directory_row(learner)["caseOwner"], "Example Owner")

    def test_a_row_with_no_case_owner_reports_an_empty_string(self):
        """Staff and employer rows have none. '' keeps them out of the filter's
        option list rather than offering a blank entry."""
        learner = directory_learner()
        learner.case_owner = None
        self.assertEqual(to_directory_row(learner)["caseOwner"], "")

    def test_legacy_null_kind_keeps_apprenticeship_routing(self):
        row = to_directory_row(directory_learner(learner_type=None))
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
        self.assertEqual(json.loads(response.content)["error"],
                         "Unable to load the users directory. Please try again.")

    def test_account_state_lookup_is_one_batch_for_many_distinct_created_ids(self):
        rows = [to_directory_row(directory_learner(pk)) for pk in range(1, 370)]
        with patch('django.db.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [(1, True), (2, False)]
            views._annotate_account_state(rows, 'learner')
        cursor.execute.assert_called_once()
        _, params = cursor.execute.call_args.args
        self.assertEqual(params, ['learner', list(range(1, 370))])
        self.assertTrue(rows[0]['hasSignedIn'])
        self.assertTrue(rows[1]['hasAccount'])
        self.assertFalse(rows[1]['hasSignedIn'])
        self.assertFalse(rows[2]['hasAccount'])
