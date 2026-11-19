from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .identity import (
    LearnerIdentity,
    LearnerIdentityError,
    identity_for_run,
    identity_from_enrolment_id,
    identity_from_profile_id,
)


def _query_result(model, profiles):
    queryset = MagicMock()
    queryset.__getitem__.return_value = profiles
    model.objects.filter.return_value = queryset


class LearnerIdentityTests(SimpleTestCase):
    @patch("learner_api.models.EnrolmentUser")
    @patch("learner_api.models.LearnerProfile")
    def test_legacy_id_resolves_only_through_enrolment_relationship(self, profile_model, source_model):
        profile = SimpleNamespace(pk=501, enrolment_id=42)
        source = SimpleNamespace(pk=42, learner_type="commercial")
        _query_result(profile_model, [profile])
        source_model.all_learners.get.return_value = source

        identity = identity_from_enrolment_id(42)

        profile_model.objects.filter.assert_called_once_with(enrolment_id=42)
        source_model.all_learners.get.assert_called_once_with(pk=42)
        self.assertEqual((identity.profile_id, identity.enrolment_id), (501, 42))
        self.assertEqual(identity.learner_kind, "commercial")

    @patch("learner_api.models.EnrolmentUser")
    @patch("learner_api.models.LearnerProfile")
    def test_numeric_profile_collision_is_not_a_fallback(self, profile_model, source_model):
        _query_result(profile_model, [])

        with self.assertRaises(LearnerIdentityError):
            identity_from_enrolment_id(501)

        profile_model.objects.filter.assert_called_once_with(enrolment_id=501)
        source_model.all_learners.get.assert_not_called()

    @patch("learner_api.models.EnrolmentUser")
    @patch("learner_api.models.LearnerProfile")
    def test_duplicate_relationship_fails_closed(self, profile_model, source_model):
        _query_result(
            profile_model,
            [SimpleNamespace(pk=501, enrolment_id=42), SimpleNamespace(pk=777, enrolment_id=42)],
        )

        with self.assertRaises(LearnerIdentityError):
            identity_from_enrolment_id(42)

        source_model.all_learners.get.assert_not_called()

    @patch("learner_api.models.EnrolmentUser")
    @patch("learner_api.models.LearnerProfile")
    def test_canonical_resolution_validates_the_linked_source(self, profile_model, source_model):
        profile = SimpleNamespace(pk=501, enrolment_id=42)
        source = SimpleNamespace(pk=42, learner_type="apprenticeship")
        _query_result(profile_model, [profile])
        source_model.all_learners.get.return_value = source

        identity = identity_from_profile_id(501)

        profile_model.objects.filter.assert_called_once_with(pk=501)
        self.assertEqual(identity.enrolment_id, 42)

    @patch("progress_reviews_api.identity.identity_from_profile_id")
    def test_run_identity_resolves_its_canonical_learner_id(self, resolve):
        resolve.return_value = LearnerIdentity(501, 42, "apprenticeship", object(), object())

        identity = identity_for_run({"learner_id": 501})

        resolve.assert_called_once_with(501)
        self.assertEqual(identity.enrolment_id, 42)

    @patch("progress_reviews_api.identity.identity_from_profile_id")
    def test_run_identity_does_not_fall_back_to_removed_profile_column(self, resolve):
        with self.assertRaises(LearnerIdentityError):
            identity_for_run({"learner_profile_id": 501})

        resolve.assert_not_called()


class CanonicalPermissionCollisionTests(SimpleTestCase):
    @patch("progress_reviews_api.permissions.authenticate_request")
    @patch("progress_reviews_api.permissions.auth_gate_enabled", return_value=True)
    @patch("progress_reviews_api.permissions.identity_from_enrolment_id")
    def test_actor_canonical_id_matching_target_legacy_number_does_not_authorize(
        self, resolve, _auth_enabled, authenticate,
    ):
        from django.test import RequestFactory

        from .permissions import canonical_learner_self_only

        # Target: legacy 10 -> canonical 200. Actor: legacy 20 -> canonical 10.
        # A mixed-space comparison would incorrectly see 10 == 10 and allow.
        target = LearnerIdentity(200, 10, "apprenticeship", object(), object())
        actor = LearnerIdentity(10, 20, "apprenticeship", object(), object())
        resolve.side_effect = lambda value: target if int(value) == 10 else actor
        authenticate.return_value = SimpleNamespace(role="learner", subject_id=20)

        @canonical_learner_self_only(kwarg="learner_id")
        def protected(_request, learner_id):
            return MagicMock(status_code=200)

        response = protected(RequestFactory().get("/"), learner_id=10)

        self.assertEqual(response.status_code, 404)

