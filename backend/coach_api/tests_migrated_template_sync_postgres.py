"""Real PostgreSQL locking on an exactly verified disposable Neon branch.

Only uniquely named synthetic fixtures are mutated/removed; never flush tables.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from inspect import unwrap
import json
from threading import Event
from types import SimpleNamespace
from unittest import SkipTest
from unittest.mock import patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections, transaction
from django.test import RequestFactory, SimpleTestCase

from . import migrated_completion_views as lifecycle, migrated_progress, migrated_summary_upload, views
from . import tests_migrated_progress_postgres as fixtures
from .migrated_completion import complete, sign, submit
from .migrated_summary_binding import answer_version
from .migrated_template_sync import lock_template_family, synchronize_locked
from .models import ImportedReviewInstance, MigratedReviewTemplate
from .tests_migrated_completion import PNG


class MigratedTemplateSyncPostgresRaces(SimpleTestCase):
    databases = {"default", "enrolment"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if connections["default"].vendor != "postgresql" or not getattr(settings, "USE_SECURITY_TEST_BRANCH", False):
            raise SkipTest("Requires an explicitly verified disposable PostgreSQL branch")
        from login.test_runner import _verify_security_test_branch
        _verify_security_test_branch(settings)

    def setUp(self):
        fixtures.MigratedProgressPostgresRaces.setUp(self)
        guard = patch("requests.sessions.Session.request", side_effect=AssertionError("External HTTP is forbidden in sync races"))
        guard.start()
        self.addCleanup(guard.stop)

    def edit_template(self, title="Latest question"):
        with transaction.atomic():
            lock_template_family("PR")
            template = MigratedReviewTemplate.objects.select_for_update().get(pk=self.template.pk)
            template.definition_json["sections"][0]["fields"].append({"key": "new", "title": title, "aptemType": 1})
            template.save(update_fields=["definition_json", "updated_at"])

    def sync(self):
        with transaction.atomic():
            locked = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
            return synchronize_locked(locked, "PR", self.template.programme_key)

    def post(self, view, version):
        request = RequestFactory().post("/", data=json.dumps({"answers": {"note": "Client wording"}, "answerVersion": version}), content_type="application/json")
        request.coach_email = self.overlay.owner_email
        return unwrap(view)(request, self.overlay.event_key).status_code

    def race(self, worker, mutation, *, lock="overlay", wait_for="FOR UPDATE"):
        attempted = Event()
        def work():
            connection = connections["default"]
            def observe(execute, sql, params, many, context):
                if wait_for.casefold() in sql.casefold():
                    attempted.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observe):
                    return worker()
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                if lock == "overlay":
                    locked = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
                else:
                    lock_template_family("PR")
                    locked = None
                pending = pool.submit(work)
                self.assertTrue(attempted.wait(15), "Worker did not reach the PostgreSQL lock")
                self.assertFalse(pending.done(), "Worker bypassed the held database lock")
                mutation(locked)
            result = pending.result(timeout=20)
        self.overlay.refresh_from_db()
        return result

    def test_sync_wins_stale_answer_save_is_rejected(self):
        self.edit_template()
        version = answer_version(self.overlay)
        status = self.race(lambda: self.post(views.coach_review_instance_answers, version), lambda row: synchronize_locked(row, "PR", self.template.programme_key))
        self.assertEqual(status, 409)
        self.assertEqual(self.overlay.answers, {"note": "Initial answer"})

    def test_answer_save_wins_later_sync_reads_and_preserves_latest_answer(self):
        self.edit_template()
        def save(row):
            row.answers = {"note": "Newest saved answer"}
            row.save(update_fields=["answers", "updated_at"])
        self.assertTrue(self.race(self.sync, save))
        self.assertEqual(self.overlay.answers, {"note": "Newest saved answer"})

    def test_sync_wins_late_progress_calculation_is_rejected(self):
        self.edit_template()
        def calculate():
            try:
                migrated_progress.persist_snapshot(self.overlay.owner_email, self.overlay.event_key, self.context, fixtures.SNAPSHOT)
            except migrated_progress.ProgressError as error:
                return error.status
            return 200
        self.assertEqual(self.race(calculate, lambda row: synchronize_locked(row, "PR", self.template.programme_key)), 409)
        self.assertIsNone(self.overlay.progress_snapshot)

    def test_progress_wins_later_sync_preserves_exact_calculation(self):
        self.edit_template()
        def calculate(row):
            row.progress_snapshot = deepcopy(fixtures.SNAPSHOT)
            row.save(update_fields=["progress_snapshot", "updated_at"])
        self.assertTrue(self.race(self.sync, calculate))
        self.assertEqual(self.overlay.progress_snapshot, fixtures.SNAPSHOT)

    def test_summary_save_wins_later_sync_preserves_answers_and_original(self):
        self.edit_template()
        state = {"summaryStatus": "edited", "aiSummaryOriginal": {"overview": "Original"}, "summary": {"overview": "Coach words"}}
        def summary(row):
            row.meeting_intelligence = state
            row.answers = {"note": "Coach words"}
            row.save(update_fields=["answers", "meeting_intelligence", "updated_at"])
        self.assertTrue(self.race(self.sync, summary))
        self.assertEqual(self.overlay.meeting_intelligence, state)
        self.assertEqual(self.overlay.answers, {"note": "Coach words"})

    def test_sync_during_upload_generation_rejects_stale_fingerprint(self):
        self.template.definition_json["sections"][0]["fields"][0]["semanticKey"] = "meeting_summary"
        self.template.save()
        self.sync()
        self.definition["template"] = {"reviewTypeCode": "aptem_progress_review"}
        self.definition["learnerName"] = "Synthetic learner"
        generating, resume = Event(), Event()
        def ai(*args):
            generating.set()
            if not resume.wait(20):
                raise AssertionError("Sync did not release generation")
            return {"overview": "Generated against old template"}, "synthetic"
        def upload():
            try:
                request = RequestFactory().post("/", {"transcript": SimpleUploadedFile("synthetic.txt", b"Synthetic meeting", "text/plain")})
                request.coach_email = self.overlay.owner_email
                return unwrap(migrated_summary_upload.migrated_review_summary_upload)(request, self.overlay.event_key).status_code
            finally:
                connections.close_all()
        with patch.object(views, "openai_meeting_summary", side_effect=ai), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(upload)
            try:
                self.assertTrue(generating.wait(15))
                self.edit_template()
                self.sync()
            finally:
                resume.set()
            self.assertEqual(pending.result(timeout=20), 409)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.meeting_intelligence, {})
        self.assertEqual(self.overlay.answers, {"note": "Initial answer"})

    def test_sync_wins_late_submit_cannot_freeze_an_unseen_definition(self):
        self.edit_template()
        version = answer_version(self.overlay)
        result = self.race(lambda: self.post(lifecycle.migrated_review_submit, version), lambda row: synchronize_locked(row, "PR", self.template.programme_key))
        self.assertEqual(result, 409)
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertEqual(self.post(lifecycle.migrated_review_submit, answer_version(self.overlay)), 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "awaiting-signature")

    def test_submit_wins_late_sync_does_not_change_frozen_snapshot(self):
        before = deepcopy(self.overlay.template_snapshot)
        self.assertFalse(self.race(self.sync, lambda row: submit(row, {"note": "Final answer"})))
        self.edit_template()
        self.assertFalse(self.sync())
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot, before)

    def test_signatures_and_completion_win_late_sync_cannot_touch_history(self):
        with transaction.atomic():
            row = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
            submit(row, {"note": "Final answer"})
        self.overlay.refresh_from_db()
        before = deepcopy(self.overlay.template_snapshot)
        def finish(row):
            for role in ("advisor", "participant", "employer"):
                sign(row, role, account=SimpleNamespace(pk=-1, display_name="Synthetic signer", email=self.overlay.owner_email), signature=PNG)
            complete(row)
        self.assertFalse(self.race(self.sync, finish))
        self.assertEqual(self.overlay.status, "completed")
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(self.overlay.migrated_signatures.count(), 3)

    def test_template_edit_wins_pending_sync_reads_one_consistent_latest_definition(self):
        self.assertTrue(self.race(self.sync, lambda row: self.edit_template(), lock="family", wait_for="pg_advisory_xact_lock"))
        self.assertEqual(self.overlay.template_snapshot["sections"][0]["fields"][-1]["title"], "Latest question")

    def test_submit_holds_family_lock_until_exact_validated_snapshot_is_frozen(self):
        attempted = Event()
        def edit():
            connection = connections["default"]
            def observe(execute, sql, params, many, context):
                if "pg_advisory_xact_lock" in sql:
                    attempted.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observe):
                    self.edit_template("After freeze")
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                row = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
                synchronize_locked(row, "PR", self.template.programme_key)
                frozen = deepcopy(row.template_snapshot)
                pending = pool.submit(edit)
                self.assertTrue(attempted.wait(15))
                self.assertFalse(pending.done())
                submit(row, {"note": "Signed wording"})
            pending.result(timeout=20)
        self.overlay.refresh_from_db()
        self.template.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot, frozen)
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertEqual(self.template.definition_json["sections"][0]["fields"][-1]["title"], "After freeze")
