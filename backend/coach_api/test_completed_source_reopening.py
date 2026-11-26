"""Completed-source correction cycles with real LMS rows and synthetic identities."""
from copy import deepcopy
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connections
from django.test import RequestFactory, TestCase
from django.utils import timezone

from . import migrated_completion_views as signing, migrated_reopening_views as reopening, views
from . import personal_support_access
from .migrated_completion import ensure_document
from .migrated_reviews import has_lms_completion_history
from .migrated_summary_binding import answer_version
from .migrated_templates import snapshot_for
from .models import ImportedReviewInstance, MigratedReviewRevision, MigratedReviewSignature, MigratedReviewTemplate
from .test_migrated_pdf_parity import CONTEXT
from .tests_migrated_completion import PNG


FAMILIES = {"MCM": "Monthly Coaching Meeting", "PR": "Progress Review",
            "PR_SKILLS_RADAR": "Progress Review (+ Skills Radar)", "PSP": "Personal Support Plan"}


class CompletedSourceReopeningTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.owner = "coach@example.invalid"
        self.account = SimpleNamespace(pk=1, role="staff", email=self.owner, display_name="Assigned coach")
        self.profile = SimpleNamespace(pk=17, id=17, enrolment_id=71, aptem_id=501,
            learner_type="commercial", coach_email=self.owner, programme_id=None, programme="",
            full_name="Synthetic learner", email="learner@example.invalid",
            _caseload_source=SimpleNamespace(aptem_id=501))
        self.learner = SimpleNamespace(pk=71, employer_id=81, aptem_id="501", learner_type="commercial")
        self.patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[self.profile])
        self.patch("coach_api.views.authenticated_coach_email", return_value=self.owner)
        self.patch("coach_api.migrated_completion_views.authenticated_coach_email", return_value=self.owner)
        self.patch("coach_api.views.get_learner_db_alias", return_value="enrolment")
        self.patch("coach_api.views._sections_by_review", return_value={})
        self.patch("coach_api.views.lock_learner_calendar")
        self.patch("coach_api.views.curriculum_review_instances.progress_review_rag_history", return_value=[])
        self.patch("coach_api.migrated_completion_views.LearnerProfile.objects.filter").return_value.first.return_value = self.profile
        self.patch("coach_api.review_sources.enrolment_for_review_profile", return_value=self.learner)
        self.patch("coach_api.review_sources.booking_for_overlay", return_value=None)
        self.patch("coach_api.migrated_completion_views.booking_for_overlay", return_value=None)
        self.patch("coach_api.migrated_reopening_views.booking_for_overlay", return_value=None)
        self.patch("learner_api.booking_calendar.booking_calendar_payload", return_value={})
        self.patch("coach_api.personal_support_booking.booking_state", return_value=(None, {}))
        cursor = self.enterContext(patch.object(connections["enrolment"], "cursor"))
        self.cursor = cursor.return_value.__enter__.return_value
        self.cursor.description = [(name,) for name in ("id", "learner_id", "aptem_review_id", "review_name",
            "review_type", "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
            "status", "review_data", "extraction_status", "last_error")]
        self.patch("requests.sessions.Session.request", side_effect=AssertionError("No live network"))
        self.patch("coach_api.migrated_otjh.record_completion", side_effect=AssertionError("No duplicate hours"))

    def patch(self, target, **kwargs):
        return self.enterContext(patch(target, **kwargs))

    def review(self, family, *, psp_signatures=False):
        roles = ([] if family == "PSP" else ["advisor", "participant"]
                 + (["employer"] if family.startswith("PR") else []))
        if psp_signatures:
            roles = ["advisor", "participant", "employer"]
        rules = {role: role in roles for role in ("advisor", "participant", "employer")}
        MigratedReviewTemplate.objects.filter(review_family=family).update(is_active=False)
        template = MigratedReviewTemplate.objects.create(scope="GLOBAL", is_active=True, name=f"Synthetic {family}",
            review_family=family, definition_json={"signatures": rules,
                "otjh": {"expectedHours": 2, "countsTowardsOtjh": True}, "sections": [{"key": "discussion",
                "title": "Discussion", "fields": [{"key": "answer", "title": "Agreed action", "aptemType": 13,
                    "mandatory": True, "respondentRoles": ["participant"]}]}]})
        completed = timezone.now()
        review = ImportedReviewInstance.objects.create(event_key=f"imported-review:source-{template.pk}",
            source_review_id=1000 + template.pk, owner_email=self.owner, learner_id=17,
            migrated_template=template, template_snapshot=snapshot_for(template),
            status="completed", completed_at=completed, answers={"answer": "Original agreed action"},
            signature_requirements=rules, meeting_intelligence={"otjhCredit": {"hours": 1}, "unrelated": "retain"})
        for role in roles:
            MigratedReviewSignature.objects.create(overlay=review, role=role, signer_account_id=1,
                signer_email=f"{role}@example.invalid", signer_name=f"Original {role}", signed_at=completed, signature=PNG)
        self.cursor.fetchall.return_value = [(review.source_review_id, 17, review.event_key.split(":", 1)[1],
            FAMILIES[family], FAMILIES[family], "Synthetic coach", "Synthetic learner", None, completed,
            "Completed", {"sections": []}, "partial", None)]
        self.cursor.fetchone.return_value = ("Completed", completed)
        return review, roles

    def request(self, payload, account=None):
        request = self.factory.post("/", json.dumps(payload), content_type="application/json")
        request.login_account = account or self.account
        request._dont_enforce_csrf_checks = True
        return request

    def definition(self, review):
        return views._imported_review_definition(self.owner, review.event_key)

    def test_all_families_reopen_save_resign_complete_and_preserve_archive(self):
        for family, configured in [(name, False) for name in FAMILIES] + [("PSP", True)]:
            with self.subTest(family=family, configured=configured):
                review, roles = self.review(family, psp_signatures=configured)
                original = deepcopy((review.answers, review.meeting_intelligence))
                old_pdf = bytes(ensure_document(review, **CONTEXT).pdf_bytes)
                self.assertTrue(self.definition(review)["canReopen"])
                response = unwrap(reopening.reopen_review)(self.request({"reasonCode": "incorrect-answer",
                    "note": "Correct the agreed action", "answerVersion": answer_version(review)}), review.event_key)
                self.assertEqual(response.status_code, 200, response.content)
                review.refresh_from_db()
                self.assertEqual(review.status, "in-progress")
                self.assertIsNone(review.completed_at)
                self.assertFalse(review.migrated_signatures.exists())
                archived = review.archived_revisions.get()
                self.assertEqual(bytes(archived.pdf_bytes), old_pdf)
                self.assertEqual(archived.snapshot["answers"], original[0])
                self.assertEqual(len(archived.snapshot["signatures"]), len(roles))
                detail = self.definition(review)
                self.assertTrue(detail["migratedForm"])
                self.assertFalse(detail["readOnly"])
                self.assertEqual(detail["localStatus"], "in-progress")
                self.assertTrue(has_lms_completion_history(review))
                response = unwrap(views.coach_review_instance_answers)(self.request({
                    "answers": {"answer": "Corrected agreed action"}, "answerVersion": answer_version(review)}), review.event_key)
                self.assertEqual(response.status_code, 200, response.content)
                review.refresh_from_db()
                if family != "PSP":
                    response = unwrap(signing.migrated_review_submit)(self.request({
                        "answerVersion": answer_version(review)}), review.event_key)
                    self.assertEqual(response.status_code, 200, response.content)
                    review.refresh_from_db()
                for role in roles:
                    account = SimpleNamespace(pk=2, role="staff" if role == "advisor" else "learner" if role == "participant" else "employer",
                        email=self.owner, display_name="Current signer", subject_id=81 if role == "employer" else 71)
                    self.assertEqual(review.status, "awaiting-signature")
                    endpoint = unwrap(signing.migrated_review_coach_sign) if role == "advisor" else signing.migrated_review_party_sign
                    with patch.object(signing, "authenticate_request", return_value=account):
                        stale = endpoint(self.request({"signature": PNG, "reviewRevision": 0}, account), review.event_key)
                        self.assertEqual(stale.status_code, 409, stale.content)
                        response = endpoint(self.request({"signature": PNG, "reviewRevision": 1}, account), review.event_key)
                    self.assertEqual(response.status_code, 200, response.content)
                    review.refresh_from_db()
                self.assertEqual(review.status, "completed")
                self.assertIsNotNone(review.completed_at)
                self.assertEqual(review.answers["answer"], "Corrected agreed action")
                self.assertEqual(review.meeting_intelligence["otjhCredit"], original[1]["otjhCredit"])
                self.assertEqual(review.meeting_intelligence["unrelated"], "retain")
                self.assertTrue(self.definition(review)["readOnly"])
                new_pdf = bytes(ensure_document(review, **CONTEXT).pdf_bytes)
                self.assertNotEqual(new_pdf, old_pdf)
                archived.refresh_from_db()
                self.assertEqual(bytes(archived.pdf_bytes), old_pdf)

    def test_source_only_draft_flags_and_unrelated_archive_do_not_grant_access(self):
        review, _ = self.review("PR")
        review.status, review.completed_at = "in-progress", None
        review.meeting_intelligence = {"reviewRevision": 1, "reopenCompletedAt": timezone.now().isoformat()}
        review.save()
        self.assertFalse(has_lms_completion_history(review))
        self.assertFalse(self.definition(review)["migratedForm"])
        revision = MigratedReviewRevision.objects.create(overlay=review, number=1,
            snapshot={"status": "completed", "source_review_id": review.source_review_id + 1,
                "learner_id": review.learner_id, "completed_at": timezone.now().isoformat()},
            pdf_bytes=b"synthetic", pdf_sha256="saved", reason_code="incorrect-answer", actor_account_id=1, actor_email=self.owner)
        self.assertFalse(has_lms_completion_history(review))
        revision.snapshot.update(source_review_id=review.source_review_id, learner_id=999)
        revision.save()
        self.assertFalse(has_lms_completion_history(review))

    def test_learner_psp_prepare_reads_completed_and_reopened_without_initializing(self):
        review, _ = self.review("PSP")
        account = SimpleNamespace(role="learner", subject_id=71)
        self.patch("coach_api.personal_support_access.authenticate_request", return_value=account)
        self.patch("coach_api.personal_support_access.EnrolmentUser.all_learners.filter").return_value.first.return_value = self.learner
        self.patch("coach_api.personal_support_access.review_profile_for_source", return_value=self.profile)
        self.patch("coach_api.personal_support_access.source_for_learner", return_value=SimpleNamespace(kind="aptem"))
        self.patch("coach_api.personal_support_access.initialize_imported_review", side_effect=AssertionError("No reinitialization"))
        for reopened in (False, True):
            with self.subTest(reopened=reopened):
                if reopened:
                    response = unwrap(reopening.reopen_review)(self.request({"reasonCode": "correction-required",
                        "answerVersion": answer_version(review)}), review.event_key)
                    self.assertEqual(response.status_code, 200, response.content)
                response = personal_support_access.prepare_learner_personal_support(self.request({}), review.event_key)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(json.loads(response.content)["readOnly"], not reopened)

    def test_wrong_actor_and_view_as_cannot_reopen_or_create_an_archive(self):
        review, _ = self.review("PR_SKILLS_RADAR")
        for account in (SimpleNamespace(role="learner", email=self.owner),
                        SimpleNamespace(role="staff", email="another@example.invalid")):
            response = unwrap(reopening.reopen_review)(self.request({"reasonCode": "correction-required"}, account), review.event_key)
            self.assertEqual(response.status_code, 403)
        self.assertFalse(views._imported_review_definition(self.owner, review.event_key, preview_only=True)["canReopen"])
        self.assertFalse(review.archived_revisions.exists())
