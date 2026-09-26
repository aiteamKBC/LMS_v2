"""The ingestion queue: registering an upload and running queued builds.

Runs only in the separate worker process (``process_knowledge_jobs``), never
inside a web request. One job at a time across the whole server (database
lease), exponential backoff on failure, and a stale-lease takeover so a job
abandoned by a crash or restart is resumed rather than stuck forever.
"""
from __future__ import annotations

import logging
import os
import socket
import time
import uuid

from . import pipeline, storage
from .providers import get_embedding_provider

logger = logging.getLogger(__name__)
STALE_MINUTES = 10
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class UploadRejected(ValueError):
    pass


def register_upload(repo, store, data, *, file_name, title, scopes, user, edition=""):
    """Validate and register a book. ``data`` is bytes or a file object (an
    uploaded file is streamed, never read fully into memory).
    Returns {'duplicate': bool, ...}.

    A file already in the registry (same SHA-256) is never processed again: its
    book simply gains any new programme scopes."""
    import io

    fileobj = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    fileobj.seek(0, 2)
    size = fileobj.tell()
    fileobj.seek(0)
    if not size:
        raise UploadRejected("The file is empty.")
    if size > MAX_UPLOAD_BYTES:
        raise UploadRejected("The file is larger than 200 MB.")
    head = fileobj.read(1024)
    fileobj.seek(0)
    if not file_name.lower().endswith(".pdf") or b"%PDF-" not in head:
        raise UploadRejected("Only PDF books can be uploaded.")
    scopes = sorted({s.strip().upper() for s in scopes if s and s.strip()})
    if not scopes:
        raise UploadRejected("Choose at least one programme.")
    file_sha = storage.sha256_of_file(fileobj)
    existing = repo.find_version_by_sha(file_sha)
    if existing:
        repo.add_scopes(existing["book_id"], scopes)
        return {"duplicate": True, **existing}
    space = repo.active_space()
    if space is None:
        raise UploadRejected("No active embedding space is configured.")
    ref = store.put_stream(storage.source_key(file_sha), fileobj)
    created = repo.create_book_version(
        title=title.strip() or file_name, scopes=scopes, file_sha=file_sha, file_name=file_name,
        size=size, storage_ref=ref, edition=edition, user=user,
        build_versions=pipeline.build_versions(), space_id=space["id"])
    return {"duplicate": False, **created}


def backoff_minutes(attempts):
    return min(360, 5 * (2 ** max(0, attempts - 1)))


def run_one(repo, store=None, provider=None, throttle=None):
    """Claim and process at most one job. Returns the outcome or None if idle."""
    lease_id = uuid.uuid4().hex
    job = repo.claim_job(lease_id, STALE_MINUTES)
    if job is None:
        return None
    job["lease_id"] = lease_id
    ctx = pipeline.Context(job=job, repo=repo, store=store or storage.get_storage(),
                           provider=provider or get_embedding_provider(),
                           info=repo.job_context(job["build_id"]), throttle=throttle)
    try:
        status = pipeline.run_build(ctx)
        repo.finish_job(job["id"], lease_id, "complete")
        return status
    except pipeline.PermanentFailure as exc:
        repo.set_build_status(job, job["build_id"], "failed", {"error": str(exc)})
        repo.finish_job(job["id"], lease_id, "failed", str(exc), backoff_minutes=10 ** 6)
        return "failed"
    except Exception as exc:  # noqa: BLE001 - recorded on the job and retried
        from .repository import LeaseLost

        if isinstance(exc, LeaseLost):
            logger.warning("Knowledge job %s lost its lease; stopping without writing.", job["id"])
            return "lease_lost"
        logger.exception("Knowledge job %s failed (attempt %s).", job["id"], job["attempts"])
        try:
            repo.finish_job(job["id"], lease_id, "failed", f"{type(exc).__name__}: {exc}",
                            backoff_minutes=backoff_minutes(job["attempts"]))
        except LeaseLost:
            return "lease_lost"
        return "retry"


def server_busy(max_load_per_core=0.7):
    """True when the VPS is under load; the worker waits instead of competing
    with the live LMS. Always False where load averages do not exist (Windows)."""
    if not hasattr(os, "getloadavg"):
        return False
    return os.getloadavg()[0] > (os.cpu_count() or 1) * max_load_per_core


def make_throttle(pause_seconds=60, max_waits=30):
    def throttle():
        waits = 0
        while server_busy() and waits < max_waits:
            time.sleep(pause_seconds)
            waits += 1
        time.sleep(0.2)  # always yield a little between batches
    return throttle


def worker_identity():
    return f"{socket.gethostname()}:{os.getpid()}", socket.gethostname(), os.getpid()
