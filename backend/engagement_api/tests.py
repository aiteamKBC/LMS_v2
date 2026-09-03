"""Tests for the engagement points economy: authorisation, wallet math, the
claim state machine, and the progress -> points award mapping.

Nothing here reaches the database — same rationale as
``login.tests_api_gate``: every unit under test reads only
``authenticate_request(request)``'s return value plus whatever ORM managers
are mocked out, so a stub account/queryset proves the logic without any
dependency on the unmanaged, cross-schema tables these apps sit on. Real
concurrency behaviour (the advisory-lock claim path, two claims racing one
reward) is exercised by the "End-to-end smoke" steps in the build plan
instead, since that needs real rows against the live Engagement schema.
"""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import hooks, permissions, services, views


def _account(*, role="learner", subject_type="learner", subject_id=61, display_name="Daniel Walsh", email="daniel@kbc.test"):
    """A stand-in LoginAccount — these helpers read only these five attributes."""
    return SimpleNamespace(role=role, subject_type=subject_type, subject_id=subject_id, display_name=display_name, email=email)


def _patched(account):
    """Patch authenticate_request as it's imported into permissions.py."""
    return mock.patch.object(permissions, "authenticate_request", return_value=account)


class RequireStaffTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_unauthenticated_is_401(self):
        with _patched(None):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response.status_code, 401)

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)

    def test_staff_passes_through(self):
        with _patched(_account(role="staff")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response, "ok")

    def test_admin_passes_through(self):
        with _patched(_account(role="admin")):
            view = permissions.require_staff(lambda request: "ok")
            response = view(self.factory.get("/"))
        self.assertEqual(response, "ok")


class RequireLearnerIdentityTests(SimpleTestCase):
    """The core fix for the impersonation bug: identity is always session-derived."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_gets_own_session_id_never_a_client_supplied_one(self):
        request = self.factory.post("/", data={"learnerId": "999999", "learnerName": "Someone Else"}, content_type="application/json")
        with _patched(_account(role="learner", subject_type="learner", subject_id=61, display_name="Daniel Walsh")):
            learner_id, learner_name, error = permissions.require_learner_identity(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_cannot_use_a_learner_self_endpoint(self):
        with _patched(_account(role="staff", subject_type="staff")):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)

    def test_employer_cannot_use_a_learner_self_endpoint(self):
        with _patched(_account(role="employer", subject_type="employer")):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)

    def test_unauthenticated_is_401(self):
        with _patched(None):
            learner_id, learner_name, error = permissions.require_learner_identity(self.factory.post("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 401)


class LearnerReadScopeTests(SimpleTestCase):
    """A GET's ?learnerId must never let one learner read another's data."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_is_scoped_to_self_even_with_a_different_query_param(self):
        request = self.factory.get("/?learnerId=999999")
        with _patched(_account(role="learner", subject_id=61)):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")

    def test_learner_omitting_the_param_still_gets_only_self_never_everyone(self):
        request = self.factory.get("/")
        with _patched(_account(role="learner", subject_id=61)):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")  # not None — None would mean "everyone" for staff

    def test_staff_omitting_the_param_sees_everyone(self):
        request = self.factory.get("/")
        with _patched(_account(role="staff")):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertIsNone(learner_id)  # None -> the view applies no filter

    def test_staff_may_scope_to_a_named_learner(self):
        request = self.factory.get("/?learnerId=61")
        with _patched(_account(role="staff")):
            learner_id, error = permissions.learner_read_scope(request)
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")

    def test_unauthenticated_is_401(self):
        with _patched(None):
            learner_id, error = permissions.learner_read_scope(self.factory.get("/"))
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 401)


class RequireSelfOrStaffTests(SimpleTestCase):
    """A learner probing another learner's record id must get 404, not 403."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_owning_learner_passes(self):
        with _patched(_account(role="learner", subject_id=61)):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="61")
        self.assertIsNone(error)

    def test_non_owning_learner_gets_404_not_403(self):
        with _patched(_account(role="learner", subject_id=61)):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="999999")
        self.assertEqual(error.status_code, 404)

    def test_staff_may_view_any_learners_record(self):
        with _patched(_account(role="staff")):
            error = permissions.require_self_or_staff(self.factory.get("/"), owner_learner_id="999999")
        self.assertIsNone(error)


class LearnerTargetIdentityTests(SimpleTestCase):
    """Flash-card flip: staff may target a chosen learner; a learner never can."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_is_always_self_even_if_payload_names_someone_else(self):
        with _patched(_account(role="learner", subject_id=61, display_name="Daniel Walsh")):
            learner_id, learner_name, error = permissions.learner_target_identity(
                self.factory.post("/"), {"learnerId": "999999", "learnerName": "Someone Else"},
            )
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_may_target_a_named_learner(self):
        with _patched(_account(role="staff")):
            learner_id, learner_name, error = permissions.learner_target_identity(
                self.factory.post("/"), {"learnerId": "61", "learnerName": "Daniel Walsh"},
            )
        self.assertIsNone(error)
        self.assertEqual(learner_id, "61")
        self.assertEqual(learner_name, "Daniel Walsh")

    def test_staff_without_a_target_gets_400(self):
        with _patched(_account(role="staff")):
            learner_id, learner_name, error = permissions.learner_target_identity(self.factory.post("/"), {})
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 400)

    def test_employer_is_forbidden(self):
        with _patched(_account(role="employer", subject_type="employer")):
            learner_id, learner_name, error = permissions.learner_target_identity(self.factory.post("/"), {})
        self.assertIsNone(learner_id)
        self.assertEqual(error.status_code, 403)


class StaffErrorTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_staff_gets_no_error(self):
        with _patched(_account(role="staff")):
            self.assertIsNone(permissions.staff_error(self.factory.post("/")))

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            self.assertEqual(permissions.staff_error(self.factory.post("/")).status_code, 403)

    def test_unauthenticated_is_401(self):
        with _patched(None):
            self.assertEqual(permissions.staff_error(self.factory.post("/")).status_code, 401)


class IsStaffTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_staff_and_admin_are_staff(self):
        for role in ("staff", "admin"):
            with _patched(_account(role=role)):
                self.assertTrue(permissions.is_staff(self.factory.get("/")))

    def test_learner_and_unauthenticated_are_not_staff(self):
        with _patched(_account(role="learner")):
            self.assertFalse(permissions.is_staff(self.factory.get("/")))
        with _patched(None):
            self.assertFalse(permissions.is_staff(self.factory.get("/")))


class ActorNameTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_falls_back_to_email_when_display_name_is_blank(self):
        with _patched(_account(display_name=None, email="daniel@kbc.test")):
            self.assertEqual(permissions.actor_name(self.factory.post("/")), "daniel@kbc.test")

    def test_none_when_unauthenticated(self):
        with _patched(None):
            self.assertIsNone(permissions.actor_name(self.factory.post("/")))


class GrantPointsTests(SimpleTestCase):
    """services.grant_points — the single entry point every points-worthy
    event goes through, so its clamping and de-dup rules are the whole
    integrity backstop for the wallet."""

    def _rule(self, points=10):
        return SimpleNamespace(points=points)

    def test_negative_points_clamped_to_zero_for_hook_source(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("some_rule", "61", "Daniel", points=-50, source_type="hook")
        self.assertEqual(mock_create.call_args.kwargs["points"], 0)

    def test_negative_points_kept_for_explicit_adjustment(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("adj_rule", "61", "Daniel", points=-50, source_type="adjustment")
        self.assertEqual(mock_create.call_args.kwargs["points"], -50)

    def test_rule_points_used_when_points_not_given(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule(points=25)), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points("some_rule", "61", "Daniel")
        self.assertEqual(mock_create.call_args.kwargs["points"], 25)

    def test_existing_event_reference_short_circuits_create(self):
        existing = SimpleNamespace(id=1)
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = existing
            result = services.grant_points("some_rule", "61", "Daniel", event_reference="quiz:1:learner:61")
        self.assertIs(result, existing)
        mock_create.assert_not_called()

    def test_provenance_fields_pass_through_to_create(self):
        with mock.patch("engagement_api.models.PointsRule.objects.get", return_value=self._rule()), \
             mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.PointsGrant.objects.create") as mock_create:
            mock_filter.return_value.first.return_value = None
            services.grant_points(
                "manual_rule", "61", "Daniel", points=15,
                awarded_by="Rewan", source_type="manual", source_id="42", reason="Great effort",
            )
        kwargs = mock_create.call_args.kwargs
        self.assertEqual(kwargs["awarded_by"], "Rewan")
        self.assertEqual(kwargs["source_type"], "manual")
        self.assertEqual(kwargs["source_id"], "42")
        self.assertEqual(kwargs["reason"], "Great effort")


class PointsSummaryTests(SimpleTestCase):
    """services.points_summary — the one authoritative balance formula."""

    def test_balance_is_earned_minus_committed(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": 100}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": 30}
            result = services.points_summary("61")
        self.assertEqual(result, {"learnerId": "61", "earned": 100, "committed": 30, "balance": 70})

    def test_rejected_claims_are_excluded_from_committed(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": 50}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": 0}
            services.points_summary("61")
        # exclude(status='rejected') is what keeps a rejected claim's points
        # in the spendable balance — assert the formula actually calls it.
        mock_claims.return_value.exclude.assert_called_once_with(status="rejected")

    def test_no_grants_or_claims_defaults_to_zero_not_none(self):
        with mock.patch("engagement_api.models.PointsGrant.objects.filter") as mock_grants, \
             mock.patch("engagement_api.models.VoucherClaim.objects.filter") as mock_claims:
            mock_grants.return_value.aggregate.return_value = {"total": None}
            mock_claims.return_value.exclude.return_value.aggregate.return_value = {"total": None}
            result = services.points_summary("999")
        self.assertEqual(result, {"learnerId": "999", "earned": 0, "committed": 0, "balance": 0})


class ClaimStateMachineTests(SimpleTestCase):
    """The pure transition table voucher_claim_detail enforces — a claim
    only ever moves forward, and only 'fulfilled' is terminal."""

    def test_pending_may_move_to_approved_or_rejected(self):
        self.assertEqual(views._CLAIM_TRANSITIONS["pending"], {"approved", "rejected"})

    def test_approved_may_move_to_fulfilled_or_rejected(self):
        self.assertEqual(views._CLAIM_TRANSITIONS["approved"], {"fulfilled", "rejected"})

    def test_fulfilled_and_rejected_are_terminal(self):
        self.assertNotIn("fulfilled", views._CLAIM_TRANSITIONS)
        self.assertNotIn("rejected", views._CLAIM_TRANSITIONS)


class VoucherClaimDetailTransitionTests(SimpleTestCase):
    """Exercises the real voucher_claim_detail view with a mocked queryset —
    the state-machine guard and the idempotent-fulfilment guard are exactly
    the kind of off-by-one that's cheap to break silently."""

    def setUp(self):
        self.factory = RequestFactory()

    def _claim(self, status):
        reward = SimpleNamespace(id=7, name="Costa Voucher", total_claimed=0, save=mock.MagicMock())
        return SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", reward=reward, reward_id=7,
            points=50, requested_at=datetime.now(timezone.utc), status=status,
            reviewed_by=None, reviewed_at=None, delivery_type="digital", delivery_method="Email",
            delivery_detail=None, delivery_instructions=None, save=mock.MagicMock(),
        )

    def _patch_get(self, claim):
        # The view does .objects.select_related('reward').get(pk=pk) — mock
        # the select_related() call, not .get() directly, so the chain resolves.
        patcher = mock.patch("engagement_api.models.VoucherClaim.objects.select_related")
        mocked = patcher.start()
        mocked.return_value.get.return_value = claim
        self.addCleanup(patcher.stop)

    def test_illegal_transition_returns_409(self):
        claim = self._claim("rejected")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="staff")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(claim.status, "rejected")  # unchanged

    def test_pending_to_approved_records_reviewer_from_session(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="staff", display_name="Rewan Yasser")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.status, "approved")
        self.assertEqual(claim.reviewed_by, "Rewan Yasser")

    def test_repeated_fulfilled_patch_does_not_reincrement_total_claimed(self):
        claim = self._claim("fulfilled")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "fulfilled"}), content_type="application/json")
        with _patched(_account(role="staff")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(claim.reward.total_claimed, 0)
        claim.reward.save.assert_not_called()

    def test_learner_cannot_patch_a_claim(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(_account(role="learner")):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(claim.status, "pending")  # unchanged

    def test_unauthenticated_is_401(self):
        claim = self._claim("pending")
        self._patch_get(claim)
        request = self.factory.patch("/", data=json.dumps({"status": "approved"}), content_type="application/json")
        with _patched(None):
            response = views.voucher_claim_detail(request, pk=1)
        self.assertEqual(response.status_code, 401)


class AwardForProgressTests(SimpleTestCase):
    """hooks.award_for_progress — the source -> rule mapping every quiz/
    video/component completion is scored against. Never touches the DB:
    grant_points itself is mocked out at the module it's imported from."""

    def _patched_grant(self):
        return mock.patch("engagement_api.services.grant_points")

    def test_first_attempt_passed_quiz_awards_quiz_passed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})
        mock_grant.assert_called_once_with(
            "quiz_passed", "61", "Daniel",
            event_reference="quiz:9:learner:61", source_type="hook", source_id="9",
        )

    def test_first_attempt_failed_quiz_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": False, "quizId": 9})
        mock_grant.assert_not_called()

    def test_second_attempt_never_awards_even_if_passed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 2, "passed": True, "quizId": 9})
        mock_grant.assert_not_called()

    def test_video_first_watch_awards_recorded_session_attended(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "video", "attempt": 1, "componentId": 5})
        mock_grant.assert_called_once_with(
            "recorded_session_attended", "61", "Daniel",
            event_reference="video:5:learner:61", source_type="hook", source_id="5",
        )

    def test_reading_component_awards_pdf_viewed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "reading", "componentId": 3})
        mock_grant.assert_called_once_with(
            "pdf_viewed", "61", "Daniel",
            event_reference="component:3:learner:61", source_type="hook", source_id="3",
        )

    def test_powerpoint_component_awards_powerpoint_viewed(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "powerpoint", "componentId": 4})
        mock_grant.assert_called_once_with(
            "powerpoint_viewed", "61", "Daniel",
            event_reference="component:4:learner:61", source_type="hook", source_id="4",
        )

    def test_podcast_component_awards_podcast_attended(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "podcast", "componentId": 6})
        mock_grant.assert_called_once_with(
            "podcast_attended", "61", "Daniel",
            event_reference="component:6:learner:61", source_type="hook", source_id="6",
        )

    def test_component_type_not_in_map_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress("61", "Daniel", {"kind": "component", "attempt": 1, "componentType": "reflection", "componentId": 1})
        mock_grant.assert_not_called()

    def test_none_learner_id_awards_nothing(self):
        with self._patched_grant() as mock_grant:
            hooks.award_for_progress(None, "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})
        mock_grant.assert_not_called()

    def test_missing_active_rule_is_swallowed_not_raised(self):
        with mock.patch("engagement_api.services.grant_points", side_effect=services.PointsRule.DoesNotExist):
            # Must not raise — a dropped grant can never surface as a progress-save failure.
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})

    def test_unexpected_error_is_swallowed_not_raised(self):
        with mock.patch("engagement_api.services.grant_points", side_effect=RuntimeError("db down")):
            hooks.award_for_progress("61", "Daniel", {"kind": "quiz", "attempt": 1, "passed": True, "quizId": 9})


class ComputeEngagementScoreTests(SimpleTestCase):
    """services.compute_engagement_score — 30/30/20/20 weighted composite of
    attendance/KSB/OTJH/quiz. A missing signal (None) must not zero the
    learner out — the weight redistributes across whatever data exists."""

    def test_all_signals_present(self):
        # (90*.3 + 80*.3 + 70*.2 + 60*.2) / 1.0 = 51+14+12 = 77
        self.assertEqual(services.compute_engagement_score(90, 80, 70, 60), 77)

    def test_missing_signal_redistributes_weight_not_zeroes_it(self):
        # No quiz data: (90*.3 + 80*.3 + 70*.2) / 0.8 = (27+24+14)/0.8 = 81.25 -> 81
        self.assertEqual(services.compute_engagement_score(90, 80, 70, None), 81)

    def test_only_one_signal_present(self):
        self.assertEqual(services.compute_engagement_score(None, None, None, 88), 88)

    def test_no_signals_present_returns_none(self):
        self.assertIsNone(services.compute_engagement_score(None, None, None, None))

    def test_all_zero_is_a_real_score_not_none(self):
        self.assertEqual(services.compute_engagement_score(0, 0, 0, 0), 0)


class ClubMembersViewTests(SimpleTestCase):
    """Staff-assigned club membership — learners never join themselves."""

    def setUp(self):
        self.factory = RequestFactory()

    def _club(self):
        return SimpleNamespace(id=1)

    def test_learner_cannot_assign_a_member(self):
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), _patched(_account(role="learner")):
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 403)

    def test_assigning_an_existing_active_member_is_idempotent(self):
        existing = SimpleNamespace(
            id=5, learner_id="61", learner_name="Daniel Walsh", assigned_by="Rewan",
            assigned_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), \
             mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.ClubMembership.objects.create") as mock_create, \
             _patched(_account(role="staff")):
            mock_filter.return_value.first.return_value = existing
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 200)
        mock_create.assert_not_called()

    def test_staff_may_assign_a_new_member(self):
        created = SimpleNamespace(
            id=6, learner_id="61", learner_name="Daniel Walsh", assigned_by="Rewan Yasser",
            assigned_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
        )
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh"}), content_type="application/json")
        with mock.patch("engagement_api.models.Club.objects.get", return_value=self._club()), \
             mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, \
             mock.patch("engagement_api.models.ClubMembership.objects.create", return_value=created) as mock_create, \
             _patched(_account(role="staff", display_name="Rewan Yasser")):
            mock_filter.return_value.first.return_value = None
            response = views.club_members_collection(request, club_id=1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["assigned_by"], "Rewan Yasser")

    def test_removing_a_membership_soft_deletes(self):
        request = self.factory.delete("/")
        with mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, _patched(_account(role="staff")):
            mock_filter.return_value.update.return_value = 1
            response = views.club_member_detail(request, club_id=1, learner_id="61")
        self.assertEqual(response.status_code, 200)
        mock_filter.return_value.update.assert_called_once_with(status="removed")

    def test_removing_a_nonexistent_membership_is_404(self):
        request = self.factory.delete("/")
        with mock.patch("engagement_api.models.ClubMembership.objects.filter") as mock_filter, _patched(_account(role="staff")):
            mock_filter.return_value.update.return_value = 0
            response = views.club_member_detail(request, club_id=1, learner_id="999")
        self.assertEqual(response.status_code, 404)


class AttendanceInterventionViewTests(SimpleTestCase):
    """The attendance-risk page's "Take Action" endpoint."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_learner_cannot_log_an_intervention(self):
        request = self.factory.post("/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel", "action": "Call"}), content_type="application/json")
        with _patched(_account(role="learner")):
            response = views.attendance_interventions_collection(request)
        self.assertEqual(response.status_code, 403)

    def test_staff_logs_an_intervention_with_session_actor(self):
        created = SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", action="Called learner", employer_notified=True,
            intervention_date=None, created_by="Rewan Yasser", created_at=datetime(2026, 8, 31, tzinfo=timezone.utc),
            resolved=False, resolved_at=None,
        )
        request = self.factory.post(
            "/", data=json.dumps({"learnerId": "61", "learnerName": "Daniel Walsh", "action": "Called learner", "employerNotified": True}),
            content_type="application/json",
        )
        with mock.patch("engagement_api.models.AttendanceIntervention.objects.create", return_value=created) as mock_create, \
             _patched(_account(role="staff", display_name="Rewan Yasser")):
            response = views.attendance_interventions_collection(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["created_by"], "Rewan Yasser")

    def test_resolving_sets_resolved_at(self):
        intervention = SimpleNamespace(
            id=1, learner_id="61", learner_name="Daniel Walsh", action="Called learner", employer_notified=False,
            intervention_date=None, created_by="Rewan", created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
            resolved=False, resolved_at=None, save=mock.MagicMock(),
        )
        request = self.factory.patch("/", data=json.dumps({"resolved": True}), content_type="application/json")
        with mock.patch("engagement_api.models.AttendanceIntervention.objects.get", return_value=intervention), _patched(_account(role="staff")):
            response = views.attendance_intervention_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(intervention.resolved)
        self.assertIsNotNone(intervention.resolved_at)


class ComputeMessageResponseRatesTests(SimpleTestCase):
    """The identity bridge (Created_users <-> Learner.learners via email) and
    the 24h reply-pairing math — the hardest part of the analytics build."""

    def test_learner_who_replies_within_24h_scores_100(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        reply_time = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 501, "email": "daniel@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9001, "learner_id": 501}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9001, "sender_type": "coach", "created_at": coach_msg_time},
                {"conversation_id": 9001, "sender_type": "learner", "created_at": reply_time},
            ]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {"61": 100})

    def test_learner_who_never_replies_scores_zero_not_absent(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 62, "email": "amir@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 502, "email": "amir@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9002, "learner_id": 502}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9002, "sender_type": "coach", "created_at": coach_msg_time},
            ]
            rates = services.compute_message_response_rates(["62"])
        self.assertEqual(rates, {"62": 0})

    def test_reply_outside_24h_does_not_count(self):
        coach_msg_time = datetime(2026, 8, 1, 9, 0, tzinfo=timezone.utc)
        late_reply = datetime(2026, 8, 3, 9, 0, tzinfo=timezone.utc)  # 48h later
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners, \
             mock.patch("chat.models.Conversation.objects.filter") as mock_conversations, \
             mock.patch("chat.models.Message.objects.filter") as mock_messages:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 501, "email": "daniel@kbc.test"}]
            mock_conversations.return_value.values.return_value = [{"id": 9001, "learner_id": 501}]
            mock_messages.return_value.order_by.return_value.values.return_value = [
                {"conversation_id": 9001, "sender_type": "coach", "created_at": coach_msg_time},
                {"conversation_id": 9001, "sender_type": "learner", "created_at": late_reply},
            ]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {"61": 0})

    def test_no_matching_email_between_engagement_and_chat_returns_empty(self):
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter") as mock_users, \
             mock.patch("chat.models.ChatLearner.objects.all") as mock_chat_learners:
            mock_users.return_value.values.return_value = [{"id": 61, "email": "daniel@kbc.test"}]
            mock_chat_learners.return_value.values.return_value = [{"id": 999, "email": "someone-else@kbc.test"}]
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {})

    def test_empty_learner_list_returns_empty_without_querying(self):
        self.assertEqual(services.compute_message_response_rates([]), {})

    def test_any_failure_is_swallowed_and_returns_empty(self):
        with mock.patch("learner_api.models.EnrolmentUser.objects.filter", side_effect=RuntimeError("db down")):
            rates = services.compute_message_response_rates(["61"])
        self.assertEqual(rates, {})


class RewardDigitalOnlyTests(SimpleTestCase):
    """No physical vouchers — a reward is always digital, regardless of what
    a client sends, and it isn't editable after creation."""

    def setUp(self):
        self.factory = RequestFactory()

    def _reward(self, **overrides):
        defaults = dict(
            id=1, name="Costa Voucher", description="A £5 voucher", points=100, category="Food",
            delivery_type="digital", stock=10, total_claimed=0, image="", popular=False, active=True,
            save=mock.MagicMock(),
        )
        defaults.update(overrides)
        return SimpleNamespace(**defaults)

    def test_create_ignores_a_client_supplied_delivery_type(self):
        request = self.factory.post(
            "/", data=json.dumps({"name": "Costa Voucher", "points": 100, "deliveryType": "physical"}),
            content_type="application/json",
        )
        with mock.patch("engagement_api.models.Reward.objects.create", return_value=self._reward()) as mock_create, \
             _patched(_account(role="staff")):
            response = views.rewards_collection(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(mock_create.call_args.kwargs["delivery_type"], "digital")

    def test_create_does_not_require_a_delivery_type_in_the_payload(self):
        request = self.factory.post("/", data=json.dumps({"name": "Costa Voucher", "points": 100}), content_type="application/json")
        with mock.patch("engagement_api.models.Reward.objects.create", return_value=self._reward()), _patched(_account(role="staff")):
            response = views.rewards_collection(request)
        self.assertEqual(response.status_code, 201)

    def test_patch_cannot_change_delivery_type(self):
        reward = self._reward()
        request = self.factory.patch("/", data=json.dumps({"deliveryType": "physical"}), content_type="application/json")
        with mock.patch("engagement_api.models.Reward.objects.get", return_value=reward), _patched(_account(role="staff")):
            response = views.reward_detail(request, pk=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(reward.delivery_type, "digital")  # unchanged


class LearnerAnalyticsCacheTests(SimpleTestCase):
    """The endpoint measured at several seconds per call on a real roster —
    Django's ConditionalGetMiddleware answering a repeat with 304 does NOT
    save that cost (the view still runs to build the ETag first), so this
    caches server-side instead. Guards the cache actually short-circuits the
    expensive path, and that it's scoped per programme/cohort filter."""

    def setUp(self):
        self.factory = RequestFactory()
        from django.core.cache import cache
        cache.clear()
        self.addCleanup(cache.clear)

    def test_cache_hit_skips_the_roster_fetch_entirely(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles") as mock_fetch, \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = [{"id": "61", "name": "Daniel Walsh"}]
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learners"], [{"id": "61", "name": "Daniel Walsh"}])
        mock_fetch.assert_not_called()

    def test_cache_miss_computes_and_stores_for_next_time(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles", return_value=[]) as mock_fetch, \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = None
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 200)
        mock_fetch.assert_called_once()
        mock_cache.set.assert_called_once_with(mock.ANY, [], views.CACHE_TTL_SECONDS)

    def test_cache_key_is_scoped_per_programme_and_cohort(self):
        with mock.patch("engagement_api.views.cache") as mock_cache, \
             mock.patch("coach_api.views.fetch_all_learner_profiles", return_value=[]), \
             _patched(_account(role="staff")):
            mock_cache.get.return_value = None
            views.learner_analytics(self.factory.get("/?programme=MSN&cohort=Sept+2025"))
        cache_key = mock_cache.get.call_args[0][0]
        self.assertIn("MSN", cache_key)
        self.assertIn("Sept 2025", cache_key)

    def test_learner_cannot_read_analytics(self):
        with _patched(_account(role="learner")):
            response = views.learner_analytics(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)


class StatsOverviewAuthTests(SimpleTestCase):
    """stats_overview is staff-only — same gate as every other staff
    mutation/report, checked before any ORM aggregate runs."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_unauthenticated_is_401(self):
        with _patched(None):
            response = views.stats_overview(self.factory.get("/"))
        self.assertEqual(response.status_code, 401)

    def test_learner_is_403(self):
        with _patched(_account(role="learner")):
            response = views.stats_overview(self.factory.get("/"))
        self.assertEqual(response.status_code, 403)

    def test_non_get_is_405(self):
        with _patched(_account(role="staff")):
            response = views.stats_overview(self.factory.post("/"))
        self.assertEqual(response.status_code, 405)
