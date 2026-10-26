"""Database-free canonical identity and request-reuse tests for I7-B4D."""

import inspect
import json
import os
from contextlib import ExitStack
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import Client, SimpleTestCase, override_settings

from learner_api.selectors.identity import ResolutionStatus
from learner_api.selectors.lineage_identity import LineageMatchBasis
from progress_reviews_api import identity as review_identity
from progress_reviews_api.identity import resolve_review_profile
from progress_reviews_api.period import build_review_period
from progress_reviews_api.review_pack import build_review_pack
from progress_reviews_api.tests_review_pack import _mock_source
from progress_reviews_api.views import _programme_window


def _source(**changes):
    values = {
        "pk": 42,
        "id": 42,
        "email": "learner@example.test",
        "aptem_id": "007001",
        "learner_type": "apprenticeship",
        "start_date": date(2025, 1, 1),
        "end_date": date(2026, 6, 30),
    }
    values.update(changes)
    return SimpleNamespace(**values)


def _profile(**changes):
    values = {
        "pk": 901,
        "id": 901,
        "enrolment_id": 42,
        "email": "LEARNER@example.test",
        "aptem_id": 7001,
        "learner_type": "apprenticeship",
        "start_date": date(2025, 1, 1),
        "end_date": date(2026, 6, 30),
        "save": Mock(),
    }
    values.update(changes)
    return SimpleNamespace(**values)


def _slice(items):
    queryset = MagicMock()
    queryset.__getitem__.return_value = list(items)
    return queryset


class ReviewIdentityAdapterTests(SimpleTestCase):
    databases = set()

    def _model_managers(self, profile_manager=None, account_manager=None):
        from learner_api.models import EnrolmentUser, LearnerProfile

        stack = ExitStack()
        profile_manager = profile_manager or MagicMock()
        account_manager = account_manager or MagicMock()
        stack.enter_context(patch.object(LearnerProfile, "objects", profile_manager))
        stack.enter_context(patch.object(EnrolmentUser, "all_learners", account_manager))
        return stack, profile_manager, account_manager

    def test_unique_explicit_bridge_uses_b4b_validation_in_one_profile_read(self):
        profile = _profile()
        manager = MagicMock()
        manager.filter.return_value = _slice([profile])
        stack, manager, accounts = self._model_managers(manager)

        with stack:
            result = resolve_review_profile(_source(), 42)

        self.assertEqual(result.status, ResolutionStatus.RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.EXPLICIT_BRIDGE)
        self.assertIs(result.profile, profile)
        manager.filter.assert_called_once_with(enrolment_id=42)
        accounts.filter.assert_not_called()

    def test_missing_and_duplicate_explicit_profiles_fail_deterministically(self):
        for profiles, expected in (([], ResolutionStatus.MISSING),
                                   ([_profile(), _profile(pk=902, id=902)], ResolutionStatus.AMBIGUOUS)):
            with self.subTest(expected=expected):
                manager = MagicMock()
                manager.filter.side_effect = [_slice(profiles), _slice([])]
                stack, _profiles, accounts = self._model_managers(manager)
                with stack:
                    result = resolve_review_profile(_source(email=""), 42)
                self.assertEqual(result.status, expected)
                self.assertIsNone(result.profile)
                if profiles:
                    self.assertEqual(manager.filter.call_count, 1)
                    accounts.filter.assert_not_called()

    def test_explicit_email_and_aptem_mismatches_do_not_fall_through(self):
        for change in ({"email": "other@example.test"}, {"aptem_id": 9999}):
            with self.subTest(change=change):
                manager = MagicMock()
                manager.filter.return_value = _slice([_profile(**change)])
                stack, manager, accounts = self._model_managers(manager)
                with stack:
                    result = resolve_review_profile(_source(), 42)
                self.assertEqual(result.status, ResolutionStatus.MISMATCH)
                self.assertIsNone(result.profile)
                self.assertEqual(manager.filter.call_count, 1)
                accounts.filter.assert_not_called()

    def test_unique_primary_email_is_legacy_only_and_never_heals(self):
        profile = _profile(pk=777, id=777, enrolment_id=None)
        profiles = MagicMock()
        profiles.filter.side_effect = [_slice([]), _slice([profile])]
        owners = MagicMock()
        owner_values = _slice([42])
        owners.filter.return_value.values_list.return_value = owner_values
        stack, profiles, owners = self._model_managers(profiles, owners)

        with stack:
            result = resolve_review_profile(_source(), 42)

        self.assertEqual(result.status, ResolutionStatus.LEGACY_RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.LEGACY_UNIQUE_PRIMARY_EMAIL)
        self.assertIs(result.profile, profile)
        self.assertIsNone(profile.enrolment_id)
        profile.save.assert_not_called()
        self.assertEqual(profiles.filter.call_count, 2)
        self.assertEqual(owners.filter.call_count, 1)

    def test_legacy_email_requires_unique_account_and_profile(self):
        cases = (([42, 43], [_profile(enrolment_id=None)], ResolutionStatus.AMBIGUOUS),
                 ([42], [_profile(enrolment_id=None), _profile(pk=902, id=902, enrolment_id=None)],
                  ResolutionStatus.AMBIGUOUS))
        for owner_ids, candidates, expected in cases:
            with self.subTest(owner_ids=owner_ids, candidates=len(candidates)):
                profiles = MagicMock()
                profiles.filter.side_effect = [_slice([]), _slice(candidates)]
                owners = MagicMock()
                owners.filter.return_value.values_list.return_value = _slice(owner_ids)
                stack, _profiles, _owners = self._model_managers(profiles, owners)
                with stack:
                    result = resolve_review_profile(_source(), 42)
                self.assertEqual(result.status, expected)
                self.assertIsNone(result.profile)

    def test_no_email_equal_pk_is_legacy_only_when_collision_free(self):
        profile = _profile(pk=42, id=42, enrolment_id=None, email="historical@example.test")
        profiles = MagicMock()
        profiles.filter.side_effect = [_slice([]), _slice([profile])]
        owners = MagicMock()
        owners.filter.return_value.exclude.return_value.exists.return_value = False
        owners.exclude.return_value.annotate.return_value.filter.return_value.exists.return_value = False
        stack, _profiles, _owners = self._model_managers(profiles, owners)

        with stack:
            result = resolve_review_profile(_source(email=""), 42)

        self.assertEqual(result.status, ResolutionStatus.LEGACY_RESOLVED)
        self.assertEqual(result.match_basis, LineageMatchBasis.LEGACY_NO_EMAIL_EQUAL_PROFILE_PK)
        self.assertIs(result.profile, profile)
        profile.save.assert_not_called()
        self.assertEqual(profiles.filter.call_count, 2)
        self.assertEqual(owners.filter.call_count, 1)
        self.assertEqual(owners.exclude.call_count, 1)

    def test_no_email_equal_pk_rejects_numeric_ownership_and_aptem_collisions(self):
        for collision in ("email", "aptem"):
            with self.subTest(collision=collision):
                profile = _profile(pk=42, id=42, enrolment_id=None, email="owner@example.test")
                profiles = MagicMock()
                profiles.filter.side_effect = [_slice([]), _slice([profile])]
                owners = MagicMock()
                owners.filter.return_value.exclude.return_value.exists.return_value = collision == "email"
                owners.exclude.return_value.annotate.return_value.filter.return_value.exists.return_value = collision == "aptem"
                stack, _profiles, _owners = self._model_managers(profiles, owners)
                with stack:
                    result = resolve_review_profile(_source(email=""), 42)
                self.assertEqual(result.status, ResolutionStatus.AMBIGUOUS)
                self.assertIsNone(result.profile)

    def test_no_email_equal_pk_rejects_aptem_mismatch(self):
        profiles = MagicMock()
        profiles.filter.side_effect = [
            _slice([]),
            _slice([_profile(pk=42, id=42, enrolment_id=None, aptem_id=9999)]),
        ]
        owners = MagicMock()
        owners.filter.return_value.exclude.return_value.exists.return_value = False
        stack, _profiles, _owners = self._model_managers(profiles, owners)
        with stack:
            result = resolve_review_profile(_source(email=""), 42)
        self.assertEqual(result.status, ResolutionStatus.MISMATCH)
        self.assertIsNone(result.profile)

    def test_invalid_or_cross_source_id_does_not_query(self):
        for source_pk in ("not-an-id", 0, 43):
            with self.subTest(source_pk=source_pk):
                stack, profiles, accounts = self._model_managers()
                with stack:
                    result = resolve_review_profile(_source(), source_pk)
                self.assertEqual(result.status, ResolutionStatus.MISSING)
                profiles.filter.assert_not_called()
                accounts.filter.assert_not_called()

    def test_adapter_source_contains_no_identity_mutation_api(self):
        source = inspect.getsource(review_identity)
        self.assertNotIn(".save(", source)
        self.assertNotIn(".update(", source)
        self.assertNotIn("UPDATE ", source.upper())


class RequestReuseTests(SimpleTestCase):
    databases = set()

    def test_learner_detail_accepts_pre_resolved_profile_without_legacy_lookup(self):
        from learner_api.learner_detail import _active_profile_for_source

        profile = _profile()
        with patch("learner_api.learner_detail.learner_profile_for_source") as legacy, \
             patch("learner_api.learner_detail.prefetch_related_objects") as prefetch:
            resolved = _active_profile_for_source(
                _source(),
                42,
                resolved_profile=profile,
            )
        self.assertIs(resolved, profile)
        legacy.assert_not_called()
        prefetch.assert_called_once()

    def test_learner_detail_default_keeps_existing_resolver_contract(self):
        from learner_api.learner_detail import _active_profile_for_source

        source = _source()
        profile = _profile()
        with patch(
            "learner_api.learner_detail.learner_profile_for_source",
            return_value=profile,
        ) as legacy, patch("learner_api.learner_detail.prefetch_related_objects"):
            resolved = _active_profile_for_source(source, 42)
        self.assertIs(resolved, profile)
        legacy.assert_called_once_with(source, 42)

    @patch("progress_reviews_api.review_pack._build_evidence_sections", return_value=([], [], []))
    @patch("progress_reviews_api.review_pack._build_attendance_section")
    @patch("learner_api.dashboard_metrics.read_metrics", return_value=None)
    @patch("learner_api.learner_detail.build_learner_detail")
    @patch("progress_reviews_api.review_pack._resolve_profile")
    @patch("progress_reviews_api.review_pack._resolve_learner")
    def test_pack_reuses_supplied_identity_and_preserves_missing_profile_warning(
        self,
        resolve_learner,
        resolve_profile,
        build_detail,
        _metrics,
        attendance,
        _evidence,
    ):
        source = _mock_source()
        build_detail.return_value = {
            "components": [], "ksbs": [], "quizAttempts": [],
            "videoProgress": [], "componentProgress": [],
        }
        attendance.return_value = {
            "attendance_percentage": "Not available", "monthly_summary": [],
            "missed_sessions": "Not available", "catch_ups_completed": "Not available",
            "catch_ups_needed": "Not available", "engagement_notes": "Not available",
        }

        result = build_review_pack(
            42,
            build_review_period(date(2026, 3, 26), review_number=1),
            source=source,
            profile=None,
        )

        resolve_learner.assert_not_called()
        resolve_profile.assert_not_called()
        build_detail.assert_called_once_with(source, 42, resolved_profile=None)
        self.assertTrue(any("no active LearnerProfile" in warning for warning in result["source_warnings"]))


@override_settings(ROOT_URLCONF="config.urls")
class EndpointIdentityBoundaryTests(SimpleTestCase):
    databases = set()

    def setUp(self):
        self.client = Client()

    def test_programme_window_uses_two_bounded_direct_identity_reads(self):
        from learner_api.models import EnrolmentUser, LearnerProfile

        source = _source()
        profile = _profile()
        source_manager = MagicMock()
        source_manager.get.return_value = source
        profile_manager = MagicMock()
        profile_manager.filter.return_value = _slice([profile])

        with patch.object(EnrolmentUser, "all_learners", source_manager), \
             patch.object(LearnerProfile, "objects", profile_manager):
            start, end, kind, resolved_source, resolved_profile = _programme_window(42)

        self.assertEqual((start, end, kind), (date(2025, 1, 1), date(2026, 6, 30), "apprenticeship"))
        self.assertIs(resolved_source, source)
        self.assertIs(resolved_profile, profile)
        source_manager.get.assert_called_once_with(pk=42)
        profile_manager.filter.assert_called_once_with(enrolment_id=42)

    @patch("progress_reviews_api.views._programme_window")
    @patch("login.permissions.authenticate_request")
    def test_authorization_rejects_cross_learner_before_identity_resolution(self, authenticate, window):
        authenticate.return_value = SimpleNamespace(
            role="learner", subject_type="learner", subject_id=7,
        )
        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}):
            response = self.client.get("/progress_reviews_api/42/pack/")
        self.assertEqual(response.status_code, 404)
        window.assert_not_called()

    @patch("progress_reviews_api.views.build_review_pack")
    @patch("progress_reviews_api.views._programme_window")
    def test_pack_response_and_request_scoped_identity_reuse_are_compatible(self, window, build):
        source = _source(programme="Programme")
        profile = _profile()
        window.return_value = (
            date(2025, 1, 1), date(2026, 6, 30), "apprenticeship", source, profile,
        )
        expected = {"learner": {"learner_id": "42"}, "source_warnings": []}
        build.return_value = expected
        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "0"}), \
             patch("progress_reviews_api.views._curriculum_programme_id", return_value=None):
            response = self.client.get("/progress_reviews_api/42/pack/?review_date=2026-03-26")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), expected)
        self.assertIs(build.call_args.kwargs["source"], source)
        self.assertIs(build.call_args.kwargs["profile"], profile)
