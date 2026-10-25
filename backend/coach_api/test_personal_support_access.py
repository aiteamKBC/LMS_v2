"""Learner-first PSP initialization with synthetic storage and mocked source reads."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from . import personal_support_access as endpoint
from .migrated_reviews import render_sections
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .review_sources import ReviewIdentityConflict
from .test_migrated_template_sync import field, form


class PersonalSupportAccessTests(TestCase):
    def setUp(self):
        self.key = "imported-review:synthetic-psp-open"
        self.owner = "coach@example.invalid"
        self.account = SimpleNamespace(role="learner", subject_id=71)
        self.learner = SimpleNamespace(pk=71, aptem_id="501", learner_type="apprenticeship")
        self.profile = SimpleNamespace(pk=17, id=17, enrolment_id=71, aptem_id=501, coach_email=self.owner)
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PSP",
            name="Personal Support Plan", is_active=True,
            definition_json=form(field("goal", 13, mandatory=True, respondentRoles=["participant"])))
        self.source = {"canInitialize": True, "readOnly": True, "source": "aptem", "sourceStatus": "not-scheduled",
            "migratedProgrammeKey": None, "historicalReview": {"id": 7001, "type": "Personal Support Plan", "status": "not-scheduled"},
            "instance": {"id": self.key, "learnerId": 17}, "template": {"reviewTypeCode": "aptem_psp"}}
        for target, kwargs in (
            ("coach_api.personal_support_access.authenticate_request", {"side_effect": lambda _: self.account}),
            ("coach_api.personal_support_access.EnrolmentUser.all_learners.filter", {}),
            ("coach_api.personal_support_access.review_profile_for_source", {"side_effect": lambda _: self.profile}),
            ("coach_api.personal_support_form.initial_answers", {"return_value": {"goal": "Imported goal"}}),
            ("coach_api.views._imported_review_definition", {"side_effect": self.definition}),
        ):
            patcher = patch(target, **kwargs)
            mock = patcher.start()
            self.addCleanup(patcher.stop)
            if target.endswith("all_learners.filter"):
                self.enrolments = mock
                mock.return_value.first.return_value = self.learner

    def definition(self, owner, key):
        result = deepcopy(self.source)
        overlay = ImportedReviewInstance.objects.filter(owner_email=owner, event_key=key).first()
        if overlay:
            result.update(migratedForm=True, canInitialize=False,
                readOnly=overlay.status not in {"not-scheduled", "scheduled", "in-progress"})
            result["instance"]["status"] = overlay.status
            result["sections"], _ = render_sections(overlay.template_snapshot, overlay.answers)
        return result

    def request(self, *, query="", csrf=False, method="post", key=None):
        request = getattr(RequestFactory(), method)("/prepare" + query, "{}", content_type="application/json") if method == "post" else RequestFactory().get("/prepare")
        request._dont_enforce_csrf_checks = not csrf
        return endpoint.prepare_learner_personal_support(request, key or self.key)

    def test_learner_first_open_uses_global_template_for_both_learner_types_and_active_statuses(self):
        for kind in ("commercial", "apprenticeship"):
            for status in ("not-scheduled", "scheduled", "in-progress"):
                with self.subTest(kind=kind, status=status):
                    ImportedReviewInstance.objects.all().delete()
                    self.learner.learner_type = kind
                    self.source["sourceStatus"] = self.source["historicalReview"]["status"] = status
                    response = self.request()
                    self.assertEqual(response.status_code, 200, response.content)
                    overlay = ImportedReviewInstance.objects.get()
                    self.assertEqual((overlay.learner_id, overlay.owner_email, overlay.status), (17, self.owner, status))
                    self.assertEqual(overlay.migrated_template_id, self.template.pk)
                    self.assertEqual(overlay.answers, {"goal": "Imported goal"})
                    body = json.loads(response.content)
                    self.assertTrue(body["migratedForm"])
                    self.assertFalse(body["readOnly"])
                    self.assertNotIn("historicalReview", body)
                    self.assertEqual(body["sections"][0]["fields"][0]["answer"], "Imported goal")
        self.enrolments.assert_called_with(pk=71)
        self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_repeated_open_reuses_form_preserving_answers_and_completed_state(self):
        self.assertEqual(self.request().status_code, 200)
        overlay = ImportedReviewInstance.objects.get()
        overlay.answers = {"goal": "Learner's saved goal"}
        overlay.status = "completed"
        overlay.save()
        snapshot = deepcopy(overlay.template_snapshot)
        self.template.is_active = False
        self.template.save()
        response = self.request()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(json.loads(response.content)["readOnly"])
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        overlay.refresh_from_db()
        self.assertEqual((overlay.answers, overlay.template_snapshot, overlay.status),
                         ({"goal": "Learner's saved goal"}, snapshot, "completed"))

    def test_other_roles_preview_unauthenticated_and_csrf_requests_cannot_initialize(self):
        for role in ("employer", "staff", "admin"):
            self.account.role = role
            self.assertEqual(self.request().status_code, 403)
        self.account.role = "learner"
        for query in ("?viewAsLearner=17", "?viewAsCoach=coach"):
            self.assertEqual(self.request(query=query).status_code, 403)
        self.assertEqual(self.request(csrf=True).status_code, 403)
        self.assertEqual(self.request(method="get").status_code, 405)
        self.account = None
        self.assertEqual(self.request().status_code, 401)
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_foreign_learner_source_history_and_wrong_review_family_are_rejected(self):
        for changes in ({"type": "Monthly Coaching Meeting"}, {"type": "Progress Review"},
                        {"status": "completed"}, {"completedDate": "2026-10-01"}):
            previous = deepcopy(self.source["historicalReview"])
            self.source["historicalReview"].update(changes)
            self.assertEqual(self.request().status_code, 404)
            self.source["historicalReview"] = previous
        self.source["instance"]["learnerId"] = 999
        self.assertEqual(self.request().status_code, 404)
        self.assertEqual(self.request(key="native-review:1").status_code, 404)
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_unavailable_template_or_noneditable_source_does_not_create_form(self):
        for status in ("cancelled", "archived", "awaiting-signature"):
            self.source["sourceStatus"] = status
            self.assertEqual(self.request().status_code, 409)
        self.source["sourceStatus"] = "not-scheduled"
        self.template.is_active = False
        self.template.save()
        self.assertEqual(self.request().status_code, 409)
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_identity_conflict_missing_coach_and_foreign_overlay_fail_closed(self):
        with patch.object(endpoint, "review_profile_for_source", side_effect=ReviewIdentityConflict("conflict")):
            self.assertEqual(self.request().status_code, 409)
        self.profile.aptem_id = 999
        self.assertEqual(self.request().status_code, 404)
        self.profile.aptem_id = 501
        self.profile.coach_email = ""
        self.assertEqual(self.request().status_code, 409)
        self.profile.coach_email = self.owner
        self.assertFalse(ImportedReviewInstance.objects.exists())
        other = ImportedReviewInstance.objects.create(owner_email="other@example.invalid", learner_id=999,
            event_key=self.key, source_review_id=9001, answers={"original": "retained"})
        self.assertEqual(self.request().status_code, 409)
        other.refresh_from_db()
        self.assertEqual(other.answers, {"original": "retained"})
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        # A conflicting source association also fails closed when its old
        # event key and learner differ from the requested review.
        other.event_key, other.source_review_id = "imported-review:other", 7001
        other.save()
        self.assertEqual(self.request().status_code, 409)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)

    def test_response_failure_rolls_back_initialization(self):
        with patch.object(endpoint, "_party_definition", return_value=None):
            self.assertEqual(self.request().status_code, 409)
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_existing_party_get_does_not_prepare_an_uninitialized_review(self):
        from . import migrated_completion_views
        with patch.object(migrated_completion_views, "authenticate_request", return_value=self.account):
            response = migrated_completion_views.migrated_review_party_detail(RequestFactory().get("/"), self.key)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(ImportedReviewInstance.objects.exists())
