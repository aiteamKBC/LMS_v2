"""Run only in a verified disposable PostgreSQL test database."""
from concurrent.futures import ThreadPoolExecutor
from inspect import unwrap
import json
from threading import Barrier, Event
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import RequestFactory, TransactionTestCase

from . import migrated_completion_views as signatures
from . import test_migrated_reopening as fixtures
from .migrated_completion import submit
from .models import ImportedReviewInstance, MigratedReviewDocument
from .tests_migrated_completion import PNG


@skipUnless(connection.vendor == "postgresql", "Requires isolated PostgreSQL row locks")
class MigratedReopenPostgresTests(TransactionTestCase):
    def setUp(self):
        self.case = fixtures.MigratedReopenLifecycleTests()
        self.case.setUp()
        self.addCleanup(self.case.doCleanups)

    def tearDown(self):
        overlay = self.case.overlay
        template = overlay.migrated_template
        overlay.archived_revisions.all().delete()
        overlay.migrated_signatures.all().delete()
        MigratedReviewDocument.objects.filter(overlay=overlay).delete()
        self.case.calendar.delete()
        overlay.delete()
        template.delete()

    def test_concurrent_reopen_creates_one_archive_and_preserves_credit(self):
        ready = Barrier(2)

        def reopen():
            try:
                ready.wait(timeout=10)
                return self.case.request().status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [pool.submit(reopen) for _ in range(2)]
            self.assertCountEqual([result.result(timeout=25) for result in results], [200, 409])
        overlay = self.case.overlay
        overlay.refresh_from_db()
        self.assertEqual(overlay.archived_revisions.count(), 1)
        self.assertEqual(overlay.status, "in-progress")
        self.assertEqual(overlay.meeting_intelligence["otjhCredit"], self.case.original["otjhCredit"])
        self.assertFalse(overlay.migrated_signatures.exists())

    def test_coach_can_read_the_archived_pdf_under_a_real_row_lock(self):
        self.assertEqual(self.case.request().status_code, 200)
        request = RequestFactory().get("/")
        request.login_account = self.case.account
        response = unwrap(self.case.endpoints.coach_revision_pdf)(request, self.case.overlay.event_key, 1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, bytes(self.case.overlay.archived_revisions.get().pdf_bytes))

    def test_signer_waiting_during_reopen_cannot_sign_the_new_submission_from_an_old_tab(self):
        overlay = self.case.overlay
        attempted = Event()

        def lock(*args, **kwargs):
            return ImportedReviewInstance.objects.select_for_update().get(pk=overlay.pk)

        def stale_signer():
            def observe(execute, sql, params, many, context):
                if "FOR UPDATE" in sql.upper():
                    attempted.set()
                return execute(sql, params, many, context)
            request = RequestFactory().post("/", json.dumps({"signature": PNG, "reviewRevision": 0}),
                                            content_type="application/json")
            request.login_account = self.case.account
            try:
                with connections["default"].execute_wrapper(observe):
                    return unwrap(signatures.migrated_review_coach_sign)(request, overlay.event_key)
            finally:
                connections.close_all()

        with patch.object(signatures, "_coach_review", return_value=(overlay.owner_email, {"migratedForm": True})), \
             patch.object(signatures, "_locked_overlay", side_effect=lock), \
             ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                self.assertEqual(self.case.request().status_code, 200)
                overlay.refresh_from_db()
                submit(overlay, overlay.answers)
                future = pool.submit(stale_signer)
                self.assertTrue(attempted.wait(timeout=10), "Signer did not reach the row lock")
                self.assertFalse(future.done(), "Signer bypassed the reopen transaction")
            response = future.result(timeout=20)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertFalse(overlay.migrated_signatures.exists())
        self.assertEqual(overlay.archived_revisions.count(), 1)
