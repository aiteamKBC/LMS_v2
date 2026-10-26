"""Cross-domain learner identity characterization for F05-F07-I7-B4A.

These tests deliberately describe the current contracts, including resolver
disagreements.  They use synthetic identifiers and prohibit database access.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.selectors.dashboard.marking import dashboard_marking_projection
from coach_api.services.dashboard.context import CoachDashboardContext
from coach_api.dashboard_view import coach_dashboard
from learner_api import evidence, reflection_submissions
from learner_api import marking_tally
from learner_api.identity import learner_profile_for_source
from learner_api.selectors.identity import profile_for_enrolment
from progress_reviews_api.review_pack import _resolve_profile
from progress_reviews_api.views import pack as progress_review_pack


class IdentityReviewRequired(Exception):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.code = code
        self.status = status


class ScriptedCursor:
    """Minimal cursor whose result is selected by execute order."""

    def __init__(self, results):
        self.results = list(results)
        self.executions = []
        self.current = None

    def execute(self, sql, params=None):
        self.executions.append((sql, params))
        self.current = self.results[len(self.executions) - 1]

    def fetchall(self):
        return list(self.current.get("all", []))

    def fetchone(self):
        return self.current.get("one")


class CursorContext:
    def __init__(self, cursor):
        self.cursor_value = cursor

    def __enter__(self):
        return self.cursor_value

    def __exit__(self, exc_type, exc, traceback):
        return False


class NoDatabaseIdentityCharacterizationTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.owner = {
            "id": 901,
            "enrolment_id": 42,
            "aptem_id": 7001,
            "email": "learner@example.test",
            "account_record_id": 42,
            "account_email": "LEARNER@example.test",
            "account_aptem_id": "007001",
        }

    def test_canonical_selector_uses_explicit_bridge_not_equal_numeric_ids(self):
        query = Mock(return_value=[self.owner])
        self.assertIs(
            profile_for_enrolment(42, query=query, error_type=IdentityReviewRequired),
            self.owner,
        )
        sql, params = query.call_args.args
        self.assertIn("WHERE l.enrolment_id=%s", sql)
        self.assertNotIn("WHERE l.id=%s", sql)
        self.assertEqual(params, [42])
        self.assertEqual(query.call_count, 1)

        # A profile PK that merely equals the enrolment ID is not a match.
        query.reset_mock(return_value=True)
        query.return_value = []
        self.assertIsNone(
            profile_for_enrolment(901, query=query, error_type=IdentityReviewRequired)
        )
        self.assertEqual(query.call_count, 1)

    def test_canonical_selector_missing_and_ambiguous_outcomes_are_distinct(self):
        query = Mock(return_value=[])
        self.assertIsNone(
            profile_for_enrolment(42, query=query, error_type=IdentityReviewRequired)
        )

        query.return_value = [self.owner, {**self.owner, "id": 902}]
        with self.assertRaises(IdentityReviewRequired) as raised:
            profile_for_enrolment(42, query=query, error_type=IdentityReviewRequired)
        self.assertEqual(
            (raised.exception.code, raised.exception.status),
            ("identity_review_required", 409),
        )

    def test_canonical_selector_rejects_email_and_aptem_mismatches(self):
        for changes in (
            {"account_email": "different@example.test"},
            {"account_aptem_id": "9999"},
        ):
            with self.subTest(changes=changes):
                query = Mock(return_value=[{**self.owner, **changes}])
                with self.assertRaises(IdentityReviewRequired) as raised:
                    profile_for_enrolment(
                        42, query=query, error_type=IdentityReviewRequired
                    )
                self.assertEqual(raised.exception.status, 409)

    def test_reflection_supports_one_unlinked_case_insensitive_email_match(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [{"account_record_id": 42, "account_email": "Legacy@Example.test",
                       "account_aptem_id": None}]},
            {"all": [{"profile_id": 901, "profile_match_count": 1,
                       "account_email_match_count": 1}]},
        ])
        self.assertEqual(
            reflection_submissions._learner_profile_ids_for_source(cursor, 42),
            ["901"],
        )
        self.assertEqual(len(cursor.executions), 3)
        fallback_sql, fallback_params = cursor.executions[2]
        self.assertIn("lower(l.email) = lower(%s)", fallback_sql)
        self.assertIn("account_email_match_count", fallback_sql)
        self.assertEqual(
            fallback_params,
            ["Legacy@Example.test", "Legacy@Example.test"],
        )

    def test_reflection_fails_closed_for_ambiguous_legacy_profiles(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [{"account_record_id": 42, "account_email": "shared@example.test",
                       "account_aptem_id": None}]},
            {"all": [
                {"profile_id": 901, "profile_match_count": 2,
                 "account_email_match_count": 1},
                {"profile_id": 902, "profile_match_count": 2,
                 "account_email_match_count": 1},
            ]},
        ])
        self.assertEqual(
            reflection_submissions._learner_profile_ids_for_source(cursor, 42),
            [],
        )

    def test_reflection_current_no_email_fallback_allows_equal_unlinked_pk(self):
        cursor = ScriptedCursor([
            {"all": []},
            {"all": [{"account_record_id": 42, "account_email": None,
                       "account_aptem_id": None}]},
            {"all": [{"profile_id": 42, "profile_aptem_id": None,
                       "explicit_bridge_conflict": False,
                       "primary_email_owner_conflict": False,
                       "aptem_owner_conflict": False}]},
        ])
        self.assertEqual(
            reflection_submissions._learner_profile_ids_for_source(cursor, 42),
            ["42"],
        )
        fallback_sql, _params = cursor.executions[2]
        self.assertIn("l.id = %s", fallback_sql)
        self.assertIn("l.enrolment_id is null", fallback_sql.lower())

    def test_reflection_now_fails_closed_for_explicit_duplicate_profile_links(self):
        candidates = []
        for profile_id in (901, 902):
            candidates.append({
                "requested_enrolment_id": 42,
                "requested_position": 1,
                "account_match_count": 1,
                "id": profile_id,
                "enrolment_id": 42,
                "account_record_id": 42,
            })
        cursor = ScriptedCursor([{"all": candidates}])
        self.assertEqual(
            reflection_submissions._learner_profile_ids_for_source(cursor, 42),
            [],
        )

    def test_evidence_and_reflection_share_the_same_profile_lineage_resolver(self):
        cursor = object()
        with patch.object(
            reflection_submissions,
            "_learner_profile_ids_for_source",
            return_value=["901"],
        ) as resolve:
            self.assertEqual(evidence._learner_profile_ids_for_source(cursor, 42), ["901"])
        resolve.assert_called_once_with(cursor, 42)

    def test_legacy_orm_resolver_does_not_validate_linked_email_or_aptem(self):
        source = SimpleNamespace(
            pk=42,
            email="account@example.test",
            aptem_id="7001",
        )
        profile = SimpleNamespace(
            id=901,
            enrolment_id=42,
            email="different@example.test",
            aptem_id=9999,
        )
        with patch("learner_api.identity.LearnerProfile.objects") as profiles:
            profiles.filter.return_value.first.return_value = profile
            self.assertIs(learner_profile_for_source(source), profile)
        profiles.filter.assert_called_once_with(enrolment_id=42)

    def test_progress_review_delegates_to_b4d_read_only_adapter(self):
        source = SimpleNamespace(pk=42, email="legacy@example.test")
        profile = SimpleNamespace(id=901, enrolment_id=None)
        with patch(
            "progress_reviews_api.identity.review_profile_for_source",
            return_value=profile,
        ) as resolve:
            self.assertIs(_resolve_profile(source, 42), profile)
        resolve.assert_called_once_with(source, source_pk=42)

    def test_evidence_marking_adds_only_collision_safe_linked_profile_ids(self):
        cursor = ScriptedCursor([{"all": []}])
        self.assertEqual(evidence._marking_learner_ids(cursor, 42), ["42"])
        sql, params = cursor.executions[0]
        self.assertIn("l.enrolment_id = %s", sql)
        self.assertIn("other.id = l.id", sql)
        self.assertEqual(params, [42, 42])

        cursor = ScriptedCursor([{"all": [("901",)]}])
        self.assertEqual(evidence._marking_learner_ids(cursor, 42), ["42", "901"])

    def test_coach_marking_is_batched_and_drops_rows_outside_caseload_bridge(self):
        submitted = datetime(2026, 1, 5, 10, tzinfo=timezone.utc)
        cursor = ScriptedCursor([{
            "all": [
                ("42", "Owned Learner", 2, submitted, submitted),
                ("43", "Other Learner", 7, submitted, submitted),
            ]
        }])
        connection = Mock()
        connection.cursor.return_value = CursorContext(cursor)
        profile = SimpleNamespace(
            id=901,
            enrolment_id=42,
            full_name="Owned Learner",
            programme="Programme",
            group_name="Group A",
        )
        context = CoachDashboardContext(
            owner_email="coach@example.test",
            today=submitted.date(),
            rows=[profile],
        )
        with patch(
            "coach_api.selectors.dashboard.marking.connections",
            {"enrolment": connection},
        ):
            result = dashboard_marking_projection(context)

        self.assertEqual(len(cursor.executions), 1)
        self.assertEqual(cursor.executions[0][1], [["42"]])
        self.assertEqual(result["summary"], {"pendingItems": 2})
        self.assertEqual([item["learnerId"] for item in result["items"]], ["901"])

    def test_post_decision_tally_uses_only_the_canonical_enrolment_bridge(self):
        cursor = ScriptedCursor([{"all": [{
            "requested_enrolment_id": 42,
            "requested_position": 1,
            "account_match_count": 1,
            "id": 901,
            "enrolment_id": 42,
            "aptem_id": 7001,
            "learner_type": "commercial",
            "email": "learner@example.test",
            "account_record_id": 42,
            "account_email": "LEARNER@example.test",
            "account_aptem_id": "007001",
        }]}])
        connection = Mock()
        connection.cursor.return_value = CursorContext(cursor)
        with patch(
            "learner_api.marking_tally.connections",
            {"enrolment": connection},
        ), patch(
            "learner_api.marking_tally.refresh_tally",
            return_value={"accepted_assignments": 1},
        ) as refresh:
            result = marking_tally.refresh_tally_for_submission("commercial", "42")

        sql, params = cursor.executions[0]
        self.assertIn("l.enrolment_id=accounts.account_record_id", sql.lower())
        self.assertNotIn("id::text = %s or enrolment_id::text = %s", sql.lower())
        self.assertNotIn("order by id limit 1", sql.lower())
        self.assertEqual([int(value) for value in params[0]], [42])
        refresh.assert_called_once_with(901)
        self.assertEqual(result, {"accepted_assignments": 1})


class IdentityAuthorizationCharacterizationTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role="learner", subject_id=41)

    def test_other_learner_evidence_reflection_and_review_pack_are_hidden(self):
        cases = (
            (
                evidence.list_evidence,
                self.factory.get("/learner/evidence/commercial/42/"),
                (),
                {"kind": "commercial", "pk": 42},
            ),
            (
                reflection_submissions.get_reflection_submission,
                self.factory.get(
                    "/learner/reflections/",
                    {"learnerId": "42", "learnerKind": "commercial"},
                ),
                (),
                {},
            ),
            (
                progress_review_pack,
                self.factory.get("/progress-reviews/42/pack/"),
                (),
                {"learner_id": 42},
            ),
        )
        for view, request, args, kwargs in cases:
            with self.subTest(view=view.__name__), \
                 patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}), \
                 patch("login.permissions.authenticate_request", return_value=self.account):
                response = view(request, *args, **kwargs)
            self.assertEqual(response.status_code, 404)
            self.assertJSONEqual(response.content, {"error": "Not found."})

    def test_learner_account_cannot_enter_coach_dashboard_boundary(self):
        request = self.factory.get("/coach/dashboard/")
        request.login_account = SimpleNamespace(
            role="learner",
            subject_type="learner",
            subject_id=41,
        )
        # The outer require_access guard normally installs login_account. Calling
        # the scoped wrapper directly keeps this characterization database-free.
        response = coach_dashboard.__wrapped__(request)
        self.assertEqual(response.status_code, 403)
        self.assertJSONEqual(
            response.content,
            {
                "error": "Coach access is required.",
                "code": "forbidden",
                "requiredRole": ["coach"],
            },
        )

