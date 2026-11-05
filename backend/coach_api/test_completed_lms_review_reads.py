"""Completed LMS forms with completed source rows: reads only, no DB/network."""
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from . import migrated_completion_views as api
from . import migrated_reopening_views as reopening
from .test_migrated_pdf_parity import AT, sample_review


class CompletedLmsReviewReadTests(SimpleTestCase):
    def setUp(self):
        self.overlay = sample_review("PR")
        self.account = SimpleNamespace(role="learner", subject_id=71)
        self.profile = SimpleNamespace(pk=17, id=17, enrolment_id=71, learner_type="commercial",
                                      full_name="Sample learner", email="learner@example.invalid", programme="Sample programme")
        self.learner = SimpleNamespace(pk=71, employer_id=81)
        lookup = self.mock("coach_api.migrated_completion_views.ImportedReviewInstance.objects")
        lookup.filter.return_value.first.side_effect = lambda: self.overlay
        lookup.select_for_update.return_value.filter.return_value.first.side_effect = lambda: self.overlay
        self.mock("coach_api.migrated_completion_views.LearnerProfile.objects.filter").return_value.first.return_value = self.profile
        self.mock("coach_api.review_sources.enrolment_for_review_profile", return_value=self.learner)
        connections = self.mock("coach_api.migrated_completion_views.connections")
        self.mock("coach_api.views.get_learner_db_alias", return_value="default")
        self.cursor = connections["default"].cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = ("Completed", AT)
        self.mock("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network request"))

    def mock(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def test_linked_participants_can_read_but_cannot_use_mutation_gate(self):
        for family in ("MCM", "PR", "PR_SKILLS_RADAR"):
            self.overlay = sample_review(family)
            for kind in ("commercial", "apprenticeship"):
                self.profile.learner_type = kind
                for role, subject in (("learner", 71), ("employer", 81)):
                    with self.subTest(family=family, kind=kind, role=role):
                        account = SimpleNamespace(role=role, subject_id=subject)
                        self.assertIs(api._party_overlay(self.overlay.event_key, account, allow_completed_source=True), self.overlay)
                        self.assertIsNone(api._party_overlay(self.overlay.event_key, account))
                        self.cursor.execute.assert_called_with(
                            'SELECT status, completed_date FROM "Learner".reviews WHERE id = %s AND learner_id = %s',
                            [self.overlay.source_review_id, self.overlay.learner_id])

    def test_unrelated_accounts_and_missing_source_cannot_read(self):
        for role in ("learner", "employer", "staff"):
            self.assertIsNone(api._party_overlay(self.overlay.event_key,
                SimpleNamespace(role=role, subject_id=999), allow_completed_source=True))
        self.cursor.fetchone.return_value = None
        self.assertIsNone(api._party_overlay(self.overlay.event_key, self.account, allow_completed_source=True))

    def test_unfinished_overlay_cannot_override_completed_source(self):
        for status in ("scheduled", "in-progress", "awaiting-signature"):
            self.overlay.status = status
            self.assertIsNone(api._party_overlay(self.overlay.event_key, self.account, allow_completed_source=True))
        self.overlay.status = "completed"
        self.overlay.completed_at = None
        self.assertIsNone(api._party_overlay(self.overlay.event_key, self.account, allow_completed_source=True))

    def test_detail_and_pdf_read_endpoints_retain_the_completed_source_exception(self):
        self.mock("coach_api.migrated_completion_views.authenticate_request", return_value=self.account)
        self.mock("coach_api.migrated_completion_views._party_definition", return_value={"readOnly": True, "migratedForm": True})
        request = RequestFactory().get("/")
        self.assertEqual(api.migrated_review_party_detail(request, self.overlay.event_key).status_code, 200)
        self.mock("coach_api.migrated_completion_views.transaction.atomic", side_effect=lambda: nullcontext())
        self.mock("coach_api.migrated_completion_views._completed_pdf_response", return_value=HttpResponse(b"%PDF-saved"))
        self.assertEqual(api.migrated_review_party_pdf(request, self.overlay.event_key).content, b"%PDF-saved")

    def test_pdf_context_uses_completed_source_only_with_a_completed_lms_form(self):
        self.mock("coach_api.migrated_completion_views.booking_for_overlay", return_value=None)
        self.cursor.fetchone.return_value = ("2026-10-04", "Progress Review", "Completed", AT)
        self.assertEqual(api._pdf_context(self.overlay)["source_family"], "PR")
        self.overlay.completed_at = None
        with self.assertRaisesRegex(ValueError, "association is unavailable"):
            api._pdf_context(self.overlay)

    def test_unavailable_definition_does_not_enable_coach_reopening(self):
        self.mock("coach_api.migrated_reopening_views._coach_review", return_value=(
            self.overlay.owner_email, {"migratedForm": True, "canReopen": False}))
        locked = self.mock("coach_api.migrated_reopening_views._locked_overlay")
        request = RequestFactory().post("/", {"reasonCode": "correction-required"}, content_type="application/json")
        response = unwrap(reopening.reopen_review)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 404)
        locked.assert_not_called()
