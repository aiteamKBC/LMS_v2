"""Slice 03c: Learner Detail exposes officialPlannedHours from a verified profile only.

Database and network are prohibited. The linked-profile lookup, the identity
resolver's ORM calls and every read around the hours snapshot are mocked. These
tests prove the builder and view contract; they do not prove real PostgreSQL
values, real resolution against data, or an HTTP session end to end.
"""
import json
from contextlib import ExitStack
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import identity
from . import learner_detail as reader
from .test_planned_hours_protection_no_db import RecordingProfile, live_snapshot_inputs

PK = 7
LEGACY_KEYS = ("plannedHours", "completedHours", "targetHours", "progressHours", "progressVariance",
               "otjhStatus", "totalExpectedOtjh", "currentModule", "currentWeek", "componentsTargetToDate")


def verified_profile(planned_hours, *, profile_id=41, enrolment_id=PK):
    profile = RecordingProfile(planned_hours)
    profile.id = profile.pk = profile_id
    profile.enrolment_id = enrolment_id
    return profile


def model_for(source):
    return type("Model", (), {"all_learners": type("M", (), {"get": staticmethod(lambda **kw: source)}),
                              "DoesNotExist": LookupError})


class Harness:
    """Mocks every collaborator of build_learner_detail except the official field."""

    def __init__(self, test, profile, linked, *, resolve=None):
        self.test, self.profile, self.linked, self.resolve = test, profile, linked, resolve

    def __enter__(self):
        self.stack = stack = ExitStack()

        def mock(name, **kwargs):
            return stack.enter_context(patch.object(reader, name, **kwargs))

        self.writes = [mock(name) for name in ("advance_learner", "hydrate_source_training_plan")]
        mock("effective_training_plan", return_value=[])
        self.lookup = mock("_linked_profile_ids", return_value=self.linked)
        if self.resolve is None:
            self.resolver = mock("_active_profile_for_source", return_value=self.profile)
        mock("to_learner_detail", side_effect=lambda *args: {
            "id": str(PK), "modules": ["Module"], "week": [], "components": [], "componentProgress": []})
        mock("access_gate", return_value={})
        mock("learning_access", return_value={})
        mock("_apply_cohort_schedule")
        components = [{"componentId": "C1", "module": "Module", "week": "Week 1",
                       "component": "Reading", "expectedOtjh": 200}]
        mock("_resolve_from_master", return_value=(["Module"], [], components))
        mock("_apply_programme_assignment_template", side_effect=lambda rows, programme: rows)
        mock("_annotate_otjh", side_effect=lambda rows: (rows, 200))
        mock("_append_week_quizzes", side_effect=lambda weeks, rows, **kwargs: (weeks, rows))
        mock("retain_quiz_progress")
        live_snapshot_inputs(stack, review_planned=40.0)
        stack.enter_context(patch("learner_api.teams_attendance.annotate_attendance_completion",
                                  side_effect=lambda rows, profile: rows))
        stack.enter_context(patch("learner_api.replacement_learning.annotate_replacement_learning",
                                  side_effect=lambda rows, pk: rows))
        stack.enter_context(patch("learner_api.live_session_progress.read_live_credits", return_value=[]))
        stack.enter_context(patch("learner_api.live_session_progress.supplement_component_progress",
                                  side_effect=lambda rows, credits: rows))
        # Any other official-hours source must never be consulted.
        self.forbidden = [stack.enter_context(patch(target)) for target in (
            "learner_api.canonical_learning.profile", "learner_api.official_hours.query",
            "learner_api.official_hours.official_planned_hours_for_enrolments")]
        return self

    def __exit__(self, *exc):
        return self.stack.__exit__(*exc)

    def build(self, **options):
        return reader.build_learner_detail(SimpleNamespace(pk=PK, email="learner@example.test"), PK, **options)

    def view(self, kind="commercial", content="summary", account=None):
        source = SimpleNamespace(pk=PK, email="learner@example.test")
        params = {"content": content} if content else {}
        request = RequestFactory().get(f"/learner_api/learner-detail/{kind}/{PK}/", params)
        with patch.dict(reader.SOURCE_MODELS, {kind: model_for(source)}), \
                patch("login.permissions._auth_gate_enabled", return_value=True), \
                patch("login.permissions.session_unreadable", return_value=False), \
                patch("login.permissions.authenticate_request", return_value=account):
            return reader.learner_detail(request, kind=kind, pk=PK)


def official(payload):
    return payload["officialPlannedHours"]


class OfficialValueTests(SimpleTestCase):
    """Requirements 1-4: the 03a normalisation of learners.planned_hours."""

    def test_official_values_normalise_through_the_03a_policy(self):
        cases = [(Decimal("288"), 288.0), (Decimal("288.00"), 288.0), (Decimal("0"), 0.0), (Decimal("-0"), 0.0),
                 (None, None), (Decimal("-1"), None), (Decimal("NaN"), None), (Decimal("Infinity"), None),
                 ("not-a-number", None), (True, None)]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                profile = verified_profile(raw)
                with Harness(self, profile, (41,)) as h:
                    payload = h.build(compact=True)
                self.assertIn("officialPlannedHours", payload)
                self.assertEqual(official(payload), expected)
                if expected is not None:
                    self.assertIs(type(official(payload)), float)
                self.assertEqual(json.loads(json.dumps(payload))["officialPlannedHours"], expected)

    def test_no_fallback_to_derived_review_or_historical_totals(self):
        profile = verified_profile(None)
        profile.Planned_hours = "576"          # a historical-looking attribute is never read
        with Harness(self, profile, (41,)) as h:
            payload = h.build(compact=True)
        self.assertIsNone(official(payload))
        self.assertEqual(payload["plannedHours"], reader.fmt_hours(240.0))   # legacy plan + review
        self.assertEqual(payload["totalExpectedOtjh"], 200)
        for other in h.forbidden:
            other.assert_not_called()


class VerifiedIdentityTests(SimpleTestCase):
    """Requirements 5-7: only a profile linked before this request publishes the value."""

    def outcome(self, profile, linked, **options):
        with Harness(self, profile, linked) as h:
            return official(h.build(**options))

    def test_single_pre_linked_profile_that_was_resolved_is_verified(self):
        self.assertEqual(self.outcome(verified_profile(Decimal("288")), (41,), compact=True), 288.0)

    def test_missing_or_mismatched_links_give_null(self):
        cases = {
            "no profile linked before the request": (verified_profile(Decimal("288")), ()),
            "a different profile is the linked one": (verified_profile(Decimal("288")), (99,)),
            "resolved profile names another enrolment": (verified_profile(Decimal("288"), enrolment_id=8), (41,)),
            "resolved profile has no enrolment link": (verified_profile(Decimal("288"), enrolment_id=None), (41,)),
            "no profile resolved": (None, (41,)),
        }
        for label, (profile, linked) in cases.items():
            with self.subTest(label):
                self.assertIsNone(self.outcome(profile, linked, compact=True))

    def test_ambiguous_duplicate_links_fail_safe_instead_of_choosing_one(self):
        for linked in ((41, 42), (42, 41)):
            with self.subTest(linked=linked):
                self.assertIsNone(self.outcome(verified_profile(Decimal("288")), linked, compact=True))

    def test_numeric_id_fallback_cannot_expose_official_hours(self):
        # The resolver's pk fallback returns an unlinked profile whose id equals the enrolment id.
        profile = verified_profile(Decimal("288"), profile_id=PK, enrolment_id=None)
        self.assertIsNone(self.outcome(profile, (), compact=True))

    def test_email_match_healed_during_this_request_cannot_expose_official_hours(self):
        """The real resolver links an email-matched profile in memory before it returns,
        so enrolment_id == pk afterwards. The pre-resolution lookup still says unlinked."""
        legacy = verified_profile(Decimal("288"), profile_id=55, enrolment_id=None)
        profiles = MagicMock()
        profiles.filter.side_effect = [MagicMock(first=MagicMock(return_value=None)),     # FK lookup
                                       MagicMock(first=MagicMock(return_value=legacy))]   # email lookup
        twins = MagicMock()
        twins.filter.return_value.exclude.return_value.values_list.return_value.__getitem__.return_value = []
        with Harness(self, legacy, (), resolve=True) as h, \
                patch.object(identity.LearnerProfile, "objects", profiles), \
                patch.object(identity.EnrolmentUser, "all_learners", twins), \
                patch.object(reader, "prefetch_related_objects"):
            payload = h.build(compact=True)
        self.assertEqual(legacy.enrolment_id, PK)          # existing heal behaviour, unchanged here
        self.assertIsNone(official(payload))
        # The only enrolment_id write is the resolver's existing heal; this slice adds none.
        self.assertEqual([fields for fields in legacy.saves if "enrolment_id" in fields], [["enrolment_id"]])

    def test_every_builder_variant_carries_the_key(self):
        variants = {"default": {}, "summary": {"compact": True},
                    "quiz": {"compact": True, "read_only": True, "quiz_view": True},
                    "read_only": {"compact": True, "read_only": True}}
        for label, options in variants.items():
            with self.subTest(label):
                self.assertEqual(self.outcome(verified_profile(Decimal("288")), (41,), **options), 288.0)
                self.assertIsNone(self.outcome(verified_profile(Decimal("288")), (), **options))


class ViewCompatibilityTests(SimpleTestCase):
    """Requirements 8, 9 and 13: both kinds, staff preview, unchanged gate."""

    learner = SimpleNamespace(role="learner", subject_id=PK, subject_type="learner", is_active=True)
    staff = SimpleNamespace(role="staff", subject_id=900, subject_type="staff", is_active=True)

    def test_both_kinds_and_staff_preview_get_the_same_value(self):
        for kind in ("commercial", "apprenticeship"):
            for account in (self.learner, self.staff):
                with self.subTest(kind=kind, role=account.role):
                    with Harness(self, verified_profile(Decimal("288")), (41,)) as h:
                        response = h.view(kind=kind, account=account)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(official(json.loads(response.content)), 288.0)

    def test_gate_is_unchanged_for_other_learners_unauthenticated_and_employers(self):
        other = SimpleNamespace(role="learner", subject_id=PK + 1, subject_type="learner", is_active=True)
        employer = SimpleNamespace(role="employer", subject_id=3, subject_type="employer", is_active=True)
        for account, status in ((other, 404), (None, 401), (employer, 403)):
            with self.subTest(role=getattr(account, "role", None)):
                with Harness(self, verified_profile(Decimal("288")), (41,)) as h:
                    response = h.view(account=account)
                self.assertEqual(response.status_code, status)
                self.assertNotIn(b"officialPlannedHours", response.content)
                h.lookup.assert_not_called()

    def test_activity_view_carries_the_key_without_snapshot_work(self):
        component = {"componentId": "C1", "module": "Module", "week": "Week 1", "component": "Reading",
                     "expectedOtjh": 200, "contentHtml": "<p>x</p>"}
        with Harness(self, verified_profile(Decimal("288")), (41,)) as h, \
                patch.object(reader, "_resolve_from_master", return_value=(["Module"], [], [component])), \
                patch.object(reader, "_activity_module_components", side_effect=lambda rows, cid: rows), \
                patch.object(reader, "persist_live_otjh_snapshot") as persist:
            request = RequestFactory().get("/x/", {"content": "activity", "component_id": "C1"})
            with patch.dict(reader.SOURCE_MODELS, {"commercial": model_for(SimpleNamespace(pk=PK))}):
                response = reader.learner_detail.__wrapped__(request, "commercial", PK)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(official(json.loads(response.content)), 288.0)
        persist.assert_not_called()


class LegacyAndSideEffectTests(SimpleTestCase):
    """Requirements 10-12 and 14."""

    def test_legacy_fields_are_byte_identical_with_and_without_a_verified_link(self):
        payloads = []
        for linked in ((41,), ()):
            with Harness(self, verified_profile(Decimal("288")), linked) as h:
                payloads.append(h.build(compact=True))
        verified, unverified = payloads
        for key in LEGACY_KEYS:
            self.assertIn(key, verified)
            self.assertEqual(verified[key], unverified[key], key)
        self.assertEqual(verified["plannedHours"], reader.fmt_hours(240.0))
        self.assertIsInstance(verified["plannedHours"], str)
        strip = lambda p: {k: v for k, v in p.items() if k != "officialPlannedHours"}
        self.assertEqual(strip(verified), strip(unverified))

    def test_one_bounded_lookup_and_no_other_identity_or_official_reads(self):
        with Harness(self, verified_profile(Decimal("288")), (41,)) as h:
            h.build(compact=True)
        h.lookup.assert_called_once_with(PK)
        h.resolver.assert_called_once_with(SimpleNamespace(pk=PK, email="learner@example.test"), PK)
        for other in h.forbidden:
            other.assert_not_called()

    def test_lookup_query_is_one_indexed_filter_capped_at_two_rows(self):
        objects = MagicMock()
        sliced = objects.filter.return_value.values_list.return_value.__getitem__
        sliced.return_value = [41]
        with patch.object(reader.LearnerProfile, "objects", objects):
            self.assertEqual(reader._linked_profile_ids(PK), (41,))
        objects.filter.assert_called_once_with(enrolment_id=PK)
        objects.filter.return_value.values_list.assert_called_once_with("pk", flat=True)
        sliced.assert_called_once_with(slice(None, 2, None))

    def test_official_field_adds_no_writes(self):
        for linked in ((41,), ()):
            with self.subTest(linked=linked):
                profile = verified_profile(Decimal("288"))
                with Harness(self, profile, linked) as h:
                    h.build(compact=True)
                # Only the pre-existing snapshot columns; never planned_hours or enrolment_id.
                self.assertTrue(profile.saved_fields <= {"completed_hours", "target_hours", "progress_hours",
                                                         "progress_variance", "otjh_status"})
                self.assertEqual(profile.planned_hours, Decimal("288"))

    def test_the_selector_itself_is_pure(self):
        profile = SimpleNamespace(pk=41, enrolment_id=PK, planned_hours=Decimal("288"),
                                  save=MagicMock(side_effect=AssertionError("no write")))
        self.assertEqual(reader._official_planned_hours(profile, (41,), PK), 288.0)
        self.assertIsNone(reader._official_planned_hours(profile, (41, 42), PK))
        profile.save.assert_not_called()

    def test_slice_01_protection_holds_across_repeated_loads(self):
        profile = verified_profile(Decimal("288"))
        with Harness(self, profile, (41,)) as h:
            for _ in range(3):
                payload = h.build(compact=True)
        self.assertEqual(official(payload), 288.0)
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)
        self.assertEqual(len(profile.saves), 1)
