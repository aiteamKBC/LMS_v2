"""Lazy final-document reads using synthetic reviews and mocked source identity.

Run with settings_sqlite_test and DiscoverRunner. The row-lock race additionally
requires an independently verified disposable PostgreSQL test database; SQLite
cannot prove PostgreSQL locking. No production database or external calls.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
import hashlib
from inspect import unwrap
import json
from threading import Event
from types import SimpleNamespace
from unittest import SkipTest, skipUnless
from unittest.mock import patch
from uuid import uuid4

import fitz
from django.db import IntegrityError, connections, transaction
from django.conf import settings
from django.test import RequestFactory, SimpleTestCase, TestCase

from . import migrated_completion_views as endpoints
from .migrated_completion import build_pdf
from .models import ImportedReviewInstance, MigratedReviewDocument, MigratedReviewSignature
from .review_pdf import coach_mcm_pdf
from .test_migrated_pdf_parity import AT, CONTEXT, sample_review, text_of


def create_review(family="PR", *, source_id=None):
    sample = sample_review(family)
    overlay = ImportedReviewInstance.objects.create(
        event_key=f"imported-review:SYNTHETIC-{family}-{source_id or sample.source_review_id}", owner_email=sample.owner_email,
        learner_id=sample.learner_id, source_review_id=source_id or sample.source_review_id,
        template_snapshot=sample.template_snapshot, answers=sample.answers,
        progress_snapshot=sample.progress_snapshot, signature_requirements=sample.signature_requirements,
        status="completed", completed_at=AT,
    )
    for signature in sample.migrated_signatures.all():
        MigratedReviewSignature.objects.create(overlay=overlay, signer_account_id=1, **vars(signature))
    return overlay


def definition_for(overlay):
    return {"migratedForm": True, "pdf": {"available": False},
            "instance": {"id": overlay.event_key, "learnerId": overlay.learner_id},
            "historicalReview": {"id": str(overlay.source_review_id)}}


@contextmanager
def coach_context(overlay):
    with patch("coach_api.views._imported_review_definition", return_value=definition_for(overlay)) as resolve, \
         patch("coach_api.auth.authenticated_coach_email", return_value=overlay.owner_email), \
         patch.object(endpoints, "authenticated_coach_email", return_value=overlay.owner_email), \
         patch.object(endpoints, "_pdf_context", return_value=CONTEXT), \
         patch("requests.sessions.Session.request", side_effect=AssertionError("Network call")), \
         patch("coach_api.views.resolve_migrated_template", side_effect=AssertionError("Master lookup")), \
         patch("coach_api.migrated_template_sync.synchronize_locked", side_effect=AssertionError("Template sync")), \
         patch("learner_api.review_progress_snapshot.build_progress_snapshot", side_effect=AssertionError("Live progress")), \
         patch("learner_api.aptem_review_pdf.original_review_pdf", side_effect=AssertionError("Historical route")):
        yield resolve


def coach_download(overlay):
    return unwrap(coach_mcm_pdf)(RequestFactory().get("/"), overlay.event_key)


class MigratedLazyPdfTests(TestCase):
    def test_storage_enforces_one_authoritative_document_per_overlay(self):
        overlay = create_review()
        with coach_context(overlay):
            self.assertEqual(coach_download(overlay).status_code, 200)
        with self.assertRaises(IntegrityError), transaction.atomic():
            MigratedReviewDocument.objects.create(overlay=overlay, pdf_bytes=b"duplicate", sha256="0" * 64)
        self.assertEqual(MigratedReviewDocument.objects.count(), 1)

    def test_participants_can_be_first_downloader_for_each_supported_family(self):
        cases = (("MCM", "learner"), ("PR", "learner"), ("PR", "employer"),
                 ("PR_SKILLS_RADAR", "learner"), ("PR_SKILLS_RADAR", "employer"))
        for index, (family, role) in enumerate(cases, 1):
            with self.subTest(family=family, role=role):
                overlay = create_review(family, source_id=-index)
                with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                     patch.object(endpoints, "_party_overlay", return_value=overlay), \
                     patch.object(endpoints, "_pdf_context", return_value=CONTEXT), \
                     patch("coach_api.migrated_completion.build_pdf", wraps=build_pdf) as render:
                    responses = [endpoints.migrated_review_party_pdf(RequestFactory().get("/"), overlay.event_key) for _ in range(3)]
                    self.assertEqual([response.status_code for response in responses], [200, 200, 200])
                    self.assertEqual(render.call_count, 1)
                    saved = MigratedReviewDocument.objects.get(overlay=overlay)
                    self.assertTrue(all(bytes(saved.pdf_bytes) == response.content for response in responses))
                    self.assertTrue(all(saved.sha256 == hashlib.sha256(response.content).hexdigest() for response in responses))

    def test_first_download_all_families_stores_frozen_content_then_three_reads_reuse_bytes(self):
        for family in ("MCM", "PR", "PR_SKILLS_RADAR"):
            with self.subTest(family=family):
                # Separate source identities keep the existing unique source constraint.
                overlay = create_review(family)
                before = deepcopy((overlay.template_snapshot, overlay.answers, overlay.progress_snapshot,
                                   overlay.signature_requirements, overlay.status, overlay.completed_at))
                with coach_context(overlay) as resolve, \
                     patch("coach_api.migrated_completion.build_pdf", wraps=build_pdf) as render:
                    first = coach_download(overlay)
                    self.assertEqual(first.status_code, 200)
                    resolve.assert_called_once_with(overlay.owner_email, overlay.event_key, pdf_only=True)
                    saved = MigratedReviewDocument.objects.get(overlay=overlay)
                    text = text_of(fitz.open(stream=first.content, filetype="pdf"))
                    self.assertIn("Final saved meeting summary.", text)
                    self.assertIn("Name: Sample coach", text)
                    self.assertIn("Name: Sample learner", text)
                    if family != "MCM":
                        for value in ("28%", "64%", "73%", "Name: Sample employer"):
                            self.assertIn(value, text)
                    if family == "PR_SKILLS_RADAR":
                        self.assertIn("Skills Radar", text)
                        self.assertIn("Confident in practical collaboration.", text)
                    overlay.refresh_from_db()
                    self.assertEqual(before, (overlay.template_snapshot, overlay.answers, overlay.progress_snapshot,
                                             overlay.signature_requirements, overlay.status, overlay.completed_at))
                    # Even an incorrect later edit cannot rewrite the authoritative file.
                    overlay.answers = {"summary": "Incorrect later answer/AI change"}
                    overlay.progress_snapshot = None
                    overlay.template_snapshot["name"] = "Changed template"
                    overlay.save(update_fields=["answers", "progress_snapshot", "template_snapshot"])
                    for _ in range(2):
                        response = coach_download(overlay)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.content, first.content)
                        current = MigratedReviewDocument.objects.get(overlay=overlay)
                        self.assertEqual((current.pk, current.sha256, current.created_at),
                                         (saved.pk, saved.sha256, saved.created_at))
                        self.assertEqual(hashlib.sha256(response.content).hexdigest(), saved.sha256)
                    self.assertEqual(render.call_count, 1)
                    self.assertEqual(MigratedReviewDocument.objects.filter(overlay=overlay).count(), 1)
                MigratedReviewDocument.objects.filter(overlay=overlay).delete()
                MigratedReviewSignature.objects.filter(overlay=overlay).delete()
                overlay.delete()

    def test_failed_download_leaves_completion_intact_and_next_download_retries(self):
        overlay = create_review()
        for viewer in ("coach", "learner", "employer"):
            with self.subTest(viewer=viewer), coach_context(overlay), \
                 patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=viewer)), \
                 patch.object(endpoints, "_party_overlay", return_value=overlay), \
                 patch("coach_api.migrated_completion.build_pdf", side_effect=[RuntimeError("Render failed"), b"%PDF-retry"]) as render:
                def download():
                    return coach_download(overlay) if viewer == "coach" else endpoints.migrated_review_party_pdf(RequestFactory().get("/"), overlay.event_key)
                failed = download()
                self.assertEqual(failed.status_code, 503)
                self.assertEqual(json.loads(failed.content)["detail"], "Unable to prepare the signed PDF. Please try again.")
                self.assertFalse(MigratedReviewDocument.objects.exists())
                overlay.refresh_from_db()
                self.assertEqual((overlay.status, overlay.completed_at), ("completed", AT))
                first, second, third = download(), download(), download()
                self.assertEqual([r.status_code for r in (first, second, third)], [200, 200, 200])
                self.assertEqual(first.content, second.content)
                self.assertEqual(first.content, third.content)
                self.assertEqual(render.call_count, 2)
                self.assertEqual(MigratedReviewDocument.objects.count(), 1)
            MigratedReviewDocument.objects.all().delete()

    def test_completed_but_missing_required_signatures_does_not_create_document(self):
        for family, missing in (("MCM", "participant"), ("PR", "employer"), ("PR_SKILLS_RADAR", "employer")):
            with self.subTest(family=family):
                overlay = create_review(family)
                overlay.migrated_signatures.filter(role=missing).delete()
                with coach_context(overlay):
                    self.assertEqual(coach_download(overlay).status_code, 503)
                self.assertFalse(MigratedReviewDocument.objects.exists())
                overlay.migrated_signatures.all().delete()
                overlay.delete()

    def test_real_participant_gate_and_context_allow_only_linked_accounts(self):
        overlay = create_review()
        profile = SimpleNamespace(enrolment_id=71, full_name="Sample learner", email="learner@example.invalid", programme="Sample programme")
        learner = SimpleNamespace(pk=71, employer_id=81)
        with patch.object(endpoints.LearnerProfile.objects, "filter") as profiles, \
             patch.object(endpoints.EnrolmentUser.all_learners, "filter") as learners, \
             patch.object(endpoints.CoachCalendarEvent.objects, "filter") as calendars, \
             patch.object(endpoints, "connections") as source_connections, \
             patch("coach_api.views._imported_review_definition", side_effect=AssertionError("Participant required coach caseload")), \
             patch("requests.sessions.Session.request", side_effect=AssertionError("Network call")), \
             patch("coach_api.migrated_completion.build_pdf", wraps=build_pdf) as render:
            profiles.return_value.first.return_value = profile
            learners.return_value.first.return_value = learner
            calendars.return_value.first.return_value = None
            cursor = source_connections["default"].cursor.return_value.__enter__.return_value
            def source_read(sql, params):
                cursor.fetchone.return_value = ("2026-10-04", "Progress Review", "Scheduled", None) if "planned_scheduled_date" in sql else ("Scheduled", None)
            cursor.execute.side_effect = source_read
            for role, subject in (("learner", 71), ("employer", 81)):
                for identity, expected in ((999, 404), (subject, 200)):
                    with self.subTest(role=role, identity=identity), \
                         patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role, subject_id=identity)):
                        response = endpoints.migrated_review_party_pdf(RequestFactory().get("/"), overlay.event_key)
                        self.assertEqual(response.status_code, expected)
                self.assertEqual(render.call_count, 1)
            self.assertEqual(MigratedReviewDocument.objects.count(), 1)
            cursor.execute.side_effect = None
            cursor.fetchone.return_value = ("Completed", AT)
            with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=71)):
                self.assertEqual(endpoints.migrated_review_party_pdf(RequestFactory().get("/"), overlay.event_key).status_code, 404)
            self.assertEqual(render.call_count, 1)

    def test_anonymous_and_unrelated_roles_cannot_reach_coach_pdf_preparation(self):
        with patch("coach_api.views._imported_review_definition", side_effect=AssertionError("Unauthorized PDF lookup")):
            for account in (None, SimpleNamespace(role="learner", subject_type="learner", subject_id=999),
                            SimpleNamespace(role="employer", subject_type="employer", subject_id=999)):
                with patch("login.permissions.authenticate_request", return_value=account):
                    response = coach_mcm_pdf(RequestFactory().get("/"), "imported-review:SYNTHETIC")
                    self.assertIn(response.status_code, (401, 403))

    def test_admin_view_as_can_prepare_missing_document_but_cannot_mutate_review(self):
        overlay = create_review()
        account = SimpleNamespace(role="admin", subject_type="staff", subject_id=1)
        admin = SimpleNamespace(id=1, access="super-admin", email="admin@example.invalid", username="Admin")
        coach = SimpleNamespace(id=2, email=overlay.owner_email)
        with patch("login.permissions.authenticate_request", return_value=account), \
             patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff, \
             patch("coach_api.auth._staff_access", return_value="super-admin"), \
             patch("coach_api.auth._find_coach_staff", return_value=coach), \
             patch("coach_api.views._imported_review_definition", return_value=definition_for(overlay)), \
             patch.object(endpoints, "_pdf_context", return_value=CONTEXT):
            staff.return_value.only.return_value.first.return_value = admin
            request = RequestFactory().get("/?viewAsCoach=" + overlay.owner_email)
            request.login_account = account
            response = coach_mcm_pdf(request, overlay.event_key)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(MigratedReviewDocument.objects.count(), 1)
            for endpoint in (endpoints.migrated_review_submit, endpoints.migrated_review_coach_sign,
                             endpoints.migrated_review_complete, endpoints.migrated_review_generate_pdf):
                request = RequestFactory().post("/?viewAsCoach=" + overlay.owner_email)
                request.login_account = account
                self.assertEqual(endpoint(request, overlay.event_key).status_code, 403)


@skipUnless(connections["default"].vendor == "postgresql", "Requires a verified disposable PostgreSQL test database")
class MigratedLazyPdfPostgresConcurrencyTests(SimpleTestCase):
    # No flush or broad cleanup, including when using the repository's guarded
    # disposable branch runner. Only this test's uniquely identified rows change.
    databases = {"default"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not getattr(settings, "USE_SECURITY_TEST_BRANCH", False):
            raise SkipTest("Requires the repository's verified disposable branch runner")
        from login.test_runner import _verify_security_test_branch
        _verify_security_test_branch(settings)

    def test_simultaneous_coach_and_participant_first_downloads_share_one_document(self):
        overlay = create_review(source_id=-int(uuid4().int % 10**12))
        self.addCleanup(lambda: ImportedReviewInstance.objects.filter(pk=overlay.pk).delete())
        self.addCleanup(lambda: MigratedReviewSignature.objects.filter(overlay=overlay).delete())
        self.addCleanup(lambda: MigratedReviewDocument.objects.filter(overlay=overlay).delete())
        rendering, release_render, waiting_for_lock = Event(), Event(), Event()
        def render_once(locked, **context):
            rendering.set()
            if not release_render.wait(10):
                raise AssertionError("Concurrent reader never reached the lock")
            return build_pdf(locked, **context)

        def download(party=False):
            connection = connections["default"]
            def observe(execute, sql, params, many, context):
                if party and "FOR UPDATE" in sql.upper():
                    waiting_for_lock.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observe):
                    if party:
                        return endpoints.migrated_review_party_pdf(RequestFactory().get("/"), overlay.event_key)
                    return coach_download(overlay)
            finally:
                connections.close_all()

        def party_gate(*args, **kwargs):
            self.assertTrue(kwargs["lock"])
            return ImportedReviewInstance.objects.select_for_update().get(pk=overlay.pk)

        with coach_context(overlay), \
             patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role="learner")), \
             patch.object(endpoints, "_party_overlay", side_effect=party_gate), \
             patch("coach_api.migrated_completion.build_pdf", side_effect=render_once) as render, \
             ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(download)
            try:
                self.assertTrue(rendering.wait(10))
                second = pool.submit(download, True)
                self.assertTrue(waiting_for_lock.wait(10))
                self.assertFalse(second.done(), "Participant bypassed the held overlay lock")
            finally:
                release_render.set()
            responses = [first.result(timeout=15), second.result(timeout=15)]
            self.assertEqual([r.status_code for r in responses], [200, 200])
            self.assertEqual(responses[0].content, responses[1].content)
            self.assertEqual(render.call_count, 1)
        saved = MigratedReviewDocument.objects.get(overlay=overlay)
        self.assertEqual(MigratedReviewDocument.objects.count(), 1)
        self.assertEqual(saved.sha256, hashlib.sha256(responses[0].content).hexdigest())
