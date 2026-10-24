"""Typed canonical identity and batch resolver tests for I7-B4B."""

from dataclasses import FrozenInstanceError
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from learner_api import canonical_learning
from learner_api.selectors.identity import (
    AccountId,
    AptemLearnerId,
    CanonicalLearnerIdentity,
    EnrolmentId,
    IdentityResolution,
    LearnerProfileId,
    ResolutionStatus,
    profile_for_enrolment,
    resolve_many_for_enrolments,
)


class IdentityError(Exception):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.code = code
        self.status = status


def owner(requested_id, profile_id, **changes):
    row = {
        "requested_enrolment_id": requested_id,
        "requested_position": 1,
        "account_match_count": 1,
        "id": profile_id,
        "enrolment_id": requested_id,
        "aptem_id": 7001,
        "learner_type": "apprenticeship",
        "email": "learner@example.test",
        "account_record_id": requested_id,
        "account_email": "learner@example.test",
        "account_aptem_id": "007001",
        "programme": "Synthetic programme",
    }
    row.update(changes)
    return row


class TypedIdentityContractTests(SimpleTestCase):
    databases = set()

    def test_identity_domains_are_distinct_and_value_object_is_frozen(self):
        self.assertIsNot(AccountId, EnrolmentId)
        self.assertIsNot(EnrolmentId, LearnerProfileId)
        self.assertIsNot(LearnerProfileId, AptemLearnerId)

        identity = CanonicalLearnerIdentity(
            enrolment_id=EnrolmentId(42),
            profile_id=LearnerProfileId(901),
            aptem_id=AptemLearnerId("7001"),
            learner_kind="apprenticeship",
        )
        self.assertIsNone(identity.account_id)
        with self.assertRaises(FrozenInstanceError):
            identity.profile_id = LearnerProfileId(42)

    def test_resolution_outcome_is_frozen_and_legacy_status_is_reserved(self):
        result = IdentityResolution(
            status=ResolutionStatus.MISSING,
            requested_enrolment_id=EnrolmentId(42),
        )
        self.assertFalse(result.resolved)
        self.assertEqual(ResolutionStatus.LEGACY_RESOLVED.value, "legacy_resolved")
        with self.assertRaises(FrozenInstanceError):
            result.status = ResolutionStatus.RESOLVED


class BatchIdentityResolverTests(SimpleTestCase):
    databases = set()

    def test_batch_is_one_query_deduplicated_and_deterministically_ordered(self):
        query = Mock(return_value=[
            owner(7, 700, requested_position=2, email="second@example.test",
                  account_email="SECOND@example.test", aptem_id=8,
                  account_aptem_id="0008"),
            owner(42, 901, requested_position=1),
        ])

        result = resolve_many_for_enrolments([42, 7, 42], query=query)

        self.assertEqual(query.call_count, 1)
        sql, params = query.call_args.args
        self.assertEqual(params, [[42, 7]])
        self.assertEqual(list(result), [42, 7])
        self.assertEqual(result[42].status, ResolutionStatus.RESOLVED)
        self.assertEqual(result[42].identity.profile_id, 901)
        self.assertEqual(result[7].identity.aptem_id, "8")
        self.assertNotIn("requested_position", result[42].profile)
        self.assertNotIn("account_match_count", result[42].profile)
        self.assertIn("WITH requested", sql)
        self.assertIn('l.enrolment_id=accounts.account_record_id', sql)

    def test_empty_batch_does_not_query(self):
        query = Mock(side_effect=AssertionError("empty input must not query"))
        self.assertEqual(resolve_many_for_enrolments([], query=query), {})
        self.assertEqual(resolve_many_for_enrolments(None, query=query), {})
        query.assert_not_called()

    def test_missing_account_and_missing_profile_are_independent_missing_results(self):
        query = Mock(return_value=[
            owner(10, None, account_match_count=0, account_record_id=None,
                  enrolment_id=None, aptem_id=None, email=None,
                  account_email=None, account_aptem_id=None),
            owner(11, None, account_match_count=1, enrolment_id=None,
                  aptem_id=None, email=None),
        ])
        result = resolve_many_for_enrolments([10, 11, 12], query=query)
        self.assertEqual(
            [result[value].status for value in (10, 11, 12)],
            [ResolutionStatus.MISSING] * 3,
        )

    def test_duplicate_profiles_and_duplicate_accounts_are_ambiguous(self):
        query = Mock(return_value=[
            owner(12, 1201),
            owner(12, 1202),
            owner(13, 1301, account_match_count=2),
        ])
        result = resolve_many_for_enrolments([12, 13], query=query)
        self.assertEqual(result[12].status, ResolutionStatus.AMBIGUOUS)
        self.assertEqual(result[13].status, ResolutionStatus.AMBIGUOUS)
        self.assertIsNone(result[12].identity)
        self.assertIsNone(result[13].profile)

    def test_casefolded_email_and_leading_zero_aptem_are_resolved(self):
        query = Mock(return_value=[owner(
            42,
            901,
            email="  STRAßE@example.test ",
            account_email="strasse@example.test",
            aptem_id="0007001",
            account_aptem_id=" 007001 ",
        )])
        result = resolve_many_for_enrolments([42], query=query)[42]
        self.assertEqual(result.status, ResolutionStatus.RESOLVED)
        self.assertEqual(result.identity.aptem_id, "7001")

    def test_email_and_aptem_mismatch_are_reported_without_public_details(self):
        for changes in (
            {"account_email": "other@example.test"},
            {"account_aptem_id": "9999"},
        ):
            with self.subTest(changes=changes):
                query = Mock(return_value=[owner(42, 901, **changes)])
                result = resolve_many_for_enrolments([42], query=query)[42]
                self.assertEqual(result.status, ResolutionStatus.MISMATCH)
                self.assertIsNone(result.identity)
                self.assertIsNone(result.profile)
                self.assertFalse(hasattr(result, "candidate_count"))

    def test_equal_numeric_ids_do_not_bridge_independent_namespaces(self):
        query = Mock(return_value=[
            owner(42, 901),
            owner(901, None, account_match_count=0, account_record_id=None,
                  enrolment_id=None, aptem_id=None, email=None,
                  account_email=None, account_aptem_id=None),
        ])
        result = resolve_many_for_enrolments([42, 901], query=query)
        self.assertEqual(result[42].identity.profile_id, 901)
        self.assertEqual(result[901].status, ResolutionStatus.MISSING)
        sql = query.call_args.args[0]
        self.assertNotIn("l.id=", sql.replace(" ", ""))

    def test_batch_sql_is_parameterized_read_only_and_has_no_legacy_fallback(self):
        query = Mock(return_value=[])
        resolve_many_for_enrolments([42], query=query)
        sql, params = query.call_args.args
        normalized = " ".join(sql.lower().split())
        self.assertEqual(params, [[42]])
        self.assertTrue(normalized.startswith("with requested"))
        for forbidden in (" insert ", " update ", " delete ", " create ",
                          " alter ", " drop ", " lower(email)", "secondary_email"):
            self.assertNotIn(forbidden, f" {normalized} ")


class SingleSelectorCompatibilityTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.owner = owner(42, 901)
        for field in ("requested_enrolment_id", "requested_position", "account_match_count"):
            self.owner.pop(field)

    def test_existing_wrapper_keeps_identity_shape_query_count_and_error_contract(self):
        query = Mock(return_value=[self.owner])
        self.assertIs(
            profile_for_enrolment(42, query=query, error_type=IdentityError),
            self.owner,
        )
        self.assertEqual(query.call_count, 1)

        query.return_value = [self.owner, dict(self.owner)]
        with self.assertRaises(IdentityError) as raised:
            profile_for_enrolment(42, query=query, error_type=IdentityError)
        self.assertEqual(
            (str(raised.exception), raised.exception.code, raised.exception.status),
            (
                "The consolidated learner identity needs review.",
                "identity_review_required",
                409,
            ),
        )

    def test_canonical_learning_profile_remains_a_one_query_compatibility_wrapper(self):
        query = Mock(return_value=[self.owner])
        with patch.object(canonical_learning, "query", query):
            result = canonical_learning.profile(42)
        self.assertIs(result, self.owner)
        self.assertEqual(query.call_count, 1)

