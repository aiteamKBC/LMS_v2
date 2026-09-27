"""Upload -> worker -> vectors -> Ready, against an in-memory repository.

Covers the failure paths the design requires: duplicates, crash and resume
without paying twice, lost leases, stale-job takeover, corrupt files and
incomplete books. No database, no network.

    python manage.py test knowledge_base.tests_worker
"""
import copy
import tempfile
import uuid

from django.test import SimpleTestCase, override_settings

from . import jobs, pipeline, storage
from .providers import FakeEmbeddingProvider
from .repository import LeaseLost
from .tests_pipeline import _book_pdf


class FakeRepository:
    """Same interface and fencing rules as repository.Repository, in memory."""

    def __init__(self):
        self.now = 0
        self.books, self.scopes, self.versions, self.builds, self.jobs = {}, {}, {}, {}, {}
        self.pages, self.assets, self.occurrences = {}, {}, []
        self.sections, self.chunks, self.chunk_vectors, self.embeddings = {}, {}, {}, {}
        self.issues, self.page_writes = {}, 0

    # registry
    def find_version_by_sha(self, sha):
        return next(({"id": vid, "book_id": v["book_id"]} for vid, v in self.versions.items() if v["sha"] == sha), None)

    def create_book_version(self, *, title, scopes, file_sha, file_name, size, storage_ref, edition, user, build_versions, space_id):
        book_id, version_id, build_id, job_id = (uuid.uuid4().hex for _ in range(4))
        self.books[book_id] = {"title": title, "current_version_id": None}
        self.scopes[book_id] = set(scopes)
        self.versions[version_id] = {"book_id": book_id, "sha": file_sha, "ref": storage_ref, "page_count": None, "active_build_id": None}
        self.builds[build_id] = {"version_id": version_id, "space_id": space_id, "status": "building", "completeness": {}}
        self.jobs[job_id] = {"id": job_id, "build_id": build_id, "state": "queued", "attempts": 0, "max_attempts": 5,
                             "lease_id": None, "heartbeat": None, "next": 0, "error": ""}
        return {"book_id": book_id, "version_id": version_id, "build_id": build_id}

    def add_scopes(self, book_id, scopes):
        self.scopes[book_id] |= set(scopes)

    def active_space(self):
        return {"id": 1, "provider": "fake", "model": "fake-embedding", "dims": 1536}

    def job_context(self, build_id):
        build = self.builds[build_id]
        version = self.versions[build["version_id"]]
        return {"build_id": build_id, "embedding_space_id": build["space_id"], "version_id": build["version_id"],
                "storage_ref": version["ref"], "page_count": version["page_count"], "book_id": version["book_id"],
                "title": self.books[version["book_id"]]["title"]}

    # queue
    def claim_job(self, lease_id, stale_minutes):
        for job in self.jobs.values():
            due = job["state"] in ("queued", "failed", "paused") and job["next"] <= self.now and job["attempts"] < job["max_attempts"]
            stale = job["state"] == "running" and job["heartbeat"] is not None and job["heartbeat"] < self.now - stale_minutes
            if due or stale:
                job.update(state="running", lease_id=lease_id, heartbeat=self.now)
                job["attempts"] += 1
                return {"id": job["id"], "build_id": job["build_id"], "attempts": job["attempts"], "max_attempts": job["max_attempts"], "stage": ""}
        return None

    def _job(self, job_id, lease_id):
        job = self.jobs[job_id]
        if job["lease_id"] != lease_id or job["state"] != "running":
            raise LeaseLost(job_id)
        return job

    def _fence(self, job):
        self._job(job["id"], job["lease_id"])

    def heartbeat(self, job_id, lease_id, stage, progress):
        self._job(job_id, lease_id)["heartbeat"] = self.now

    def finish_job(self, job_id, lease_id, state, error="", backoff_minutes=0):
        job = self._job(job_id, lease_id)
        job.update(state=state, error=error, next=self.now + backoff_minutes, lease_id=None)

    def worker_seen(self, *args):
        pass

    # pages and assets
    def set_page_count(self, version_id, count):
        self.versions[version_id]["page_count"] = count

    def stored_pages(self, version_id, extractor_version):
        return {n for (v, n, e) in self.pages if v == version_id and e == extractor_version}

    def save_pages(self, job, version_id, extractor_version, pages):
        self._fence(job)
        for p in pages:
            self.page_writes += 1
            self.pages[(version_id, p.pdf_page, extractor_version)] = {
                "pdf_page": p.pdf_page, "printed_label": p.printed_label, "status": p.status,
                "blocks": [{"t": l.text, "s": l.size, "b": l.bold, "y": l.y0} for l in p.lines]}

    def load_pages(self, version_id, extractor_version):
        return [copy.deepcopy(v) for (vid, n, e), v in sorted(self.pages.items(), key=lambda kv: kv[0][1])
                if vid == version_id and e == extractor_version]

    def save_assets(self, job, build_id, items):
        self._fence(job)
        for asset, occ in items:
            asset_id = self.assets.setdefault(asset["sha256"], {"id": len(self.assets) + 1, **asset})["id"]
            key = (asset_id, build_id, occ["pdf_page"], occ["kind"])
            if not any((o["asset_id"], o["build_id"], o["pdf_page"], o["kind"]) == key for o in self.occurrences):
                self.occurrences.append({"id": len(self.occurrences) + 1, "asset_id": asset_id, "build_id": build_id,
                                         "pdf_page": occ["pdf_page"], "kind": occ["kind"], "book_caption": occ["caption"],
                                         "label_text": occ["label_text"], "sha256": asset["sha256"],
                                         "manual_description": None, "vision_description": None})

    def load_occurrences(self, build_id):
        return [dict(o) for o in self.occurrences if o["build_id"] == build_id]

    # structure and vectors
    def replace_structure(self, job, build_id, sections, chunks, links, decorative_ids):
        self._fence(job)
        self.sections[build_id] = list(sections)
        self.chunks[build_id] = {c.ordinal: {"id": f"{build_id}:{c.ordinal}", "sha": c.content_sha256,
                                             "embed_text": c.embed_text, "kind": c.kind, "section": c.section_ordinal}
                                 for c in chunks}

    def chunks_without_vectors(self, build_id, space_id, limit):
        rows = [{"id": c["id"], "content_sha256": c["sha"], "embed_text": c["embed_text"]}
                for c in self.chunks.get(build_id, {}).values() if (c["id"], space_id) not in self.chunk_vectors]
        return rows[:limit]

    def cached_embeddings(self, shas, space_id):
        return {sha: self.embeddings[(sha, space_id)] for sha in shas if (sha, space_id) in self.embeddings}

    def store_vectors(self, job, space_id, new_embeddings, chunk_vectors):
        self._fence(job)
        for sha, vector, _tokens in new_embeddings:
            self.embeddings.setdefault((sha, space_id), pipeline._literal(vector))
        for chunk_id, literal in chunk_vectors:
            self.chunk_vectors[(chunk_id, space_id)] = literal

    def verification_counts(self, build_id, space_id):
        chunks = self.chunks.get(build_id, {}).values()
        return {"chunks": len(chunks),
                "chunks_without_vector": sum(1 for c in chunks if (c["id"], space_id) not in self.chunk_vectors),
                "chunks_without_section": sum(1 for c in chunks if c["section"] is None)}

    def record_issues(self, job, build_id, issues):
        self._fence(job)
        self.issues[build_id] = list(issues)

    def set_build_status(self, job, build_id, status, completeness):
        self._fence(job)
        self.builds[build_id].update(status=status, completeness=completeness)

    def activate_build(self, build_id, accepted_by=None):
        build = self.builds[build_id]
        if build["status"] not in ("ready", "needs_review") or (build["status"] == "needs_review" and not accepted_by):
            raise ValueError("not activatable")
        version = self.versions[build["version_id"]]
        for other in self.builds.values():
            if other["status"] == "active" and self.versions[other["version_id"]]["book_id"] == version["book_id"]:
                other["status"] = "superseded"
        build["status"] = "active"
        version["active_build_id"] = build_id
        self.books[version["book_id"]]["current_version_id"] = build["version_id"]


class CountingProvider(FakeEmbeddingProvider):
    def __init__(self, fail_on_call=None):
        super().__init__()
        self.texts = []
        self.fail_on_call = fail_on_call

    def embed(self, texts):
        if self.fail_on_call is not None and self.calls + 1 == self.fail_on_call:
            self.calls += 1
            raise ConnectionError("provider timeout")
        self.texts.extend(texts)
        return super().embed(texts)


class WorkerTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.override = override_settings(KNOWLEDGE_BASE_LOCAL_DIR=self.tmp.name)
        self.override.enable()
        self.repo = FakeRepository()
        self.store = storage.get_storage()

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def upload(self, data=None, scopes=("ME",)):
        return jobs.register_upload(self.repo, self.store, data or _book_pdf(), file_name="book.pdf",
                                    title="The Marketing Book", scopes=list(scopes), user="staff@kbc")

    def test_upload_to_ready_activates_the_book(self):
        created = self.upload()
        provider = CountingProvider()
        self.assertEqual(jobs.run_one(self.repo, self.store, provider), "ready")
        build = self.repo.builds[created["build_id"]]
        self.assertEqual(build["status"], "active")
        self.assertEqual(self.repo.books[created["book_id"]]["current_version_id"], created["version_id"])
        self.assertEqual(build["completeness"]["chunks_without_vector"], 0)
        self.assertEqual(build["completeness"]["text_coverage"], 1.0)
        self.assertEqual(len(provider.texts), len(set(provider.texts)))  # each text embedded once
        self.assertIsNone(jobs.run_one(self.repo, self.store, provider))  # queue is empty

    def test_the_same_file_is_never_processed_twice(self):
        data = _book_pdf()
        first = self.upload(data, scopes=["ME"])
        second = self.upload(data, scopes=["MM"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(second["book_id"], first["book_id"])
        self.assertEqual(self.repo.scopes[first["book_id"]], {"ME", "MM"})
        self.assertEqual(len(self.repo.jobs), 1)

    def test_invalid_uploads_are_rejected(self):
        for data, name, scopes in ((b"", "a.pdf", ["ME"]), (b"not a pdf", "a.pdf", ["ME"]),
                                   (_book_pdf(), "a.docx", ["ME"]), (_book_pdf(), "a.pdf", [])):
            with self.subTest(name=name, scopes=scopes), self.assertRaises(jobs.UploadRejected):
                jobs.register_upload(self.repo, self.store, data, file_name=name, title="x", scopes=scopes, user="u")

    def test_a_crash_resumes_without_re_extracting_or_paying_twice(self):
        self.upload()
        failing = CountingProvider(fail_on_call=2)
        original_batch = pipeline.EMBED_BATCH
        pipeline.EMBED_BATCH = 5
        try:
            self.assertEqual(jobs.run_one(self.repo, self.store, failing), "retry")
            pages_after_first_run = self.repo.page_writes
            paid_texts = list(failing.texts)
            self.repo.now += 60
            resumed = CountingProvider()
            self.assertEqual(jobs.run_one(self.repo, self.store, resumed), "ready")
        finally:
            pipeline.EMBED_BATCH = original_batch
        self.assertEqual(self.repo.page_writes, pages_after_first_run)       # no page extracted twice
        self.assertFalse(set(paid_texts) & set(resumed.texts))                # nothing embedded twice

    def test_a_worker_that_lost_its_lease_stops_writing(self):
        created = self.upload()

        def steal():
            for job in self.repo.jobs.values():
                job["lease_id"] = "someone-else"

        store, provider = self.store, CountingProvider()
        lease = uuid.uuid4().hex
        job = self.repo.claim_job(lease, jobs.STALE_MINUTES)
        job["lease_id"] = lease
        ctx = pipeline.Context(job=job, repo=self.repo, store=store, provider=provider,
                               info=self.repo.job_context(job["build_id"]), throttle=steal)
        with self.assertRaises(LeaseLost):
            pipeline.run_build(ctx)
        self.assertEqual(self.repo.builds[created["build_id"]]["status"], "building")
        self.assertEqual(provider.texts, [])

    def test_a_stale_running_job_is_taken_over(self):
        self.upload()
        abandoned = self.repo.claim_job("crashed-worker", jobs.STALE_MINUTES)
        self.assertIsNotNone(abandoned)
        self.assertIsNone(self.repo.claim_job("fresh", jobs.STALE_MINUTES))    # still leased
        self.repo.now += jobs.STALE_MINUTES + 1
        self.assertEqual(jobs.run_one(self.repo, self.store, CountingProvider()), "ready")

    def test_a_corrupt_file_fails_permanently(self):
        created = self.upload()
        path = storage.LocalStorage()._path(self.repo.versions[created["version_id"]]["ref"][len("local:"):])
        path.write_bytes(b"%PDF-1.7\n" + b"\x00" * 200)
        self.assertEqual(jobs.run_one(self.repo, self.store, CountingProvider()), "failed")
        self.assertEqual(self.repo.builds[created["build_id"]]["status"], "failed")
        self.repo.now += 10_000
        self.assertIsNone(self.repo.claim_job("again", jobs.STALE_MINUTES))

    def test_missing_pages_mean_needs_review_and_acceptance_is_explicit(self):
        created = self.upload()
        original = pipeline.extract.extract_page

        def flaky(page, number):
            result = original(page, number)
            if number == 3:
                result.status, result.lines = "failed", []
            return result

        pipeline.extract.extract_page = flaky
        try:
            self.assertEqual(jobs.run_one(self.repo, self.store, CountingProvider()), "needs_review")
        finally:
            pipeline.extract.extract_page = original
        build_id = created["build_id"]
        self.assertEqual([i["pdf_page"] for i in self.repo.issues[build_id]], [3])
        self.assertIsNone(self.repo.books[created["book_id"]]["current_version_id"])  # not live
        with self.assertRaises(ValueError):
            self.repo.activate_build(build_id)
        self.repo.activate_build(build_id, accepted_by="lead@kbc")
        self.assertEqual(self.repo.books[created["book_id"]]["current_version_id"], created["version_id"])
