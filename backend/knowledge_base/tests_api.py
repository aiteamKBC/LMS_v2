"""Library API: permissions, upload validation, duplicates, status, retry/accept.
No database -- the repository is the in-memory one from tests_worker.

    python manage.py test knowledge_base.tests_api
"""
import datetime
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import jobs, views
from .tests_pipeline import _book_pdf
from .tests_worker import CountingProvider, FakeRepository


class ApiRepository(FakeRepository):
    def list_scopes(self):
        return [{"code": c, "name": c} for c in ("ME", "MM", "PCP", "APM")]

    def list_books(self, scope=None, include_archived=False):
        rows = []
        for book_id, book in self.books.items():
            if scope and scope.upper() not in self.scopes[book_id]:
                continue
            version_id, version = next((vid, v) for vid, v in self.versions.items() if v["book_id"] == book_id)
            build_id, build = next((bid, b) for bid, b in self.builds.items() if b["version_id"] == version_id)
            job = next(j for j in self.jobs.values() if j["build_id"] == build_id)
            rows.append({"id": book_id, "title": book["title"], "book_status": "active", "created_at": datetime.datetime(2026, 9, 26),
                         "current_version_id": book["current_version_id"], "scopes": sorted(self.scopes[book_id]),
                         "version_id": version_id, "file_name": "book.pdf", "size_bytes": 1, "page_count": version["page_count"],
                         "edition_label": "", "build_id": build_id, "build_status": build["status"],
                         "completeness": build["completeness"], "job_state": job["state"], "job_stage": "",
                         "job_progress": {}, "last_error": job["error"], "attempts": job["attempts"]})
        return rows

    def book_outline(self, build_id, limit=2000):
        return [{"title": s.title, "level": s.level} for s in self.sections.get(build_id, [])]

    def build_issues(self, build_id):
        return self.issues.get(build_id, [])

    def build_status(self, build_id):
        build = self.builds.get(str(build_id))
        return build["status"] if build else None

    def requeue_build(self, build_id):
        job = next((j for j in self.jobs.values() if j["build_id"] == str(build_id)), None)
        if job is None or job["state"] == "running":
            return False
        job.update(state="queued", attempts=0, next=self.now, error="")
        return True

    def worker_last_seen(self):
        return None, datetime.datetime.now(datetime.timezone.utc)


def _account(accesses):
    return SimpleNamespace(role="staff", subject_type="staff", subject_id=1, email="designer@kbc.test"), frozenset(accesses)


class ApiTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(KNOWLEDGE_BASE_LOCAL_DIR=self.tmp.name)
        self.settings_override.enable()
        self.repo = ApiRepository()
        self.factory = RequestFactory()
        self.patches = [patch.object(views, "_repo", return_value=self.repo)]
        for p in self.patches:
            p.start()
        self.as_user(["curriculum"])

    def tearDown(self):
        patch.stopall()
        self.settings_override.disable()
        self.tmp.cleanup()

    def as_user(self, accesses, role="staff"):
        account, grants = _account(accesses)
        account.role = role
        for target in ("login.permissions.authenticate_request", "knowledge_base.views.authenticate_request"):
            patch(target, return_value=account).start()
        patch("login.permissions._accesses_of", return_value=grants).start()

    def upload(self, data, name="book.pdf", scopes="ME", title="Marketing Book"):
        request = self.factory.post("/curriculum_api/knowledge-base/books/", data={
            "file": SimpleUploadedFile(name, data, content_type="application/pdf"), "title": title, "scopes": scopes})
        return views.books(request)

    def test_only_curriculum_staff_can_use_the_api(self):
        self.as_user(["enrolment"])
        self.assertEqual(views.books(self.factory.get("/x")).status_code, 403)
        self.as_user([], role="learner")
        self.assertEqual(views.books(self.factory.get("/x")).status_code, 403)
        self.as_user(["super-admin"])
        self.assertEqual(views.books(self.factory.get("/x")).status_code, 200)

    def test_upload_registers_the_book_and_returns_202(self):
        response = self.upload(_book_pdf())
        self.assertEqual(response.status_code, 202)
        book = self.repo.list_books()[0]
        self.assertEqual(book["title"], "Marketing Book")
        self.assertEqual(book["scopes"], ["ME"])

    def test_same_file_again_is_a_duplicate_and_only_adds_the_programme(self):
        data = _book_pdf()
        self.upload(data, scopes="ME")
        response = self.upload(data, scopes="MM")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.repo.list_books()[0]["scopes"], ["ME", "MM"])
        self.assertEqual(len(self.repo.jobs), 1)

    def test_bad_uploads_are_refused_with_a_clear_message(self):
        self.assertEqual(self.upload(b"hello").status_code, 400)
        self.assertEqual(self.upload(_book_pdf(), name="book.docx").status_code, 400)
        self.assertEqual(self.upload(_book_pdf(), scopes="").status_code, 400)
        self.assertEqual(views.books(self.factory.post("/x", data={})).status_code, 400)

    def test_list_shows_processing_then_ready(self):
        self.upload(_book_pdf())
        listing = views.books(self.factory.get("/x"))
        import json
        first = json.loads(listing.content)["books"][0]
        self.assertEqual(first["processing"]["status"], "queued")
        self.assertFalse(first["live"])
        jobs.run_one(self.repo, provider=CountingProvider())
        ready = json.loads(views.books(self.factory.get("/x")).content)["books"][0]
        self.assertEqual(ready["processing"]["status"], "ready")
        self.assertTrue(ready["live"])
        detail = json.loads(views.book_detail(self.factory.get("/x"), ready["id"]).content)
        self.assertIn("1.1 SWOT analysis", [s["title"] for s in detail["outline"]])

    def test_scope_filter(self):
        self.upload(_book_pdf(), scopes="PCP")
        import json
        self.assertEqual(len(json.loads(views.books(self.factory.get("/x", {"scope": "PCP"})).content)["books"]), 1)
        self.assertEqual(len(json.loads(views.books(self.factory.get("/x", {"scope": "MM"})).content)["books"]), 0)

    def test_accept_is_only_for_books_that_need_review(self):
        self.upload(_book_pdf())
        jobs.run_one(self.repo, provider=CountingProvider())
        build_id = next(iter(self.repo.builds))
        self.assertEqual(views.accept_build(self.factory.post("/x"), build_id).status_code, 409)

    def test_retry_requeues_a_book_that_is_not_running(self):
        self.upload(_book_pdf())
        build_id = next(iter(self.repo.builds))
        self.assertEqual(views.retry_build(self.factory.post("/x"), build_id).status_code, 202)
        self.repo.claim_job("worker", jobs.STALE_MINUTES)
        self.assertEqual(views.retry_build(self.factory.post("/x"), build_id).status_code, 409)

    def test_worker_status_reports_offline_when_never_seen(self):
        import json
        self.assertFalse(json.loads(views.worker_status(self.factory.get("/x")).content)["online"])
