"""Knowledge Base API for the Library page.

Mounted at /curriculum_api/knowledge-base/ so it rides the existing proxy and
the staff API gate. Every endpoint also requires Curriculum access. Uploads are
only registered here -- processing always happens in the separate worker, so a
request never does heavy work.
"""
from __future__ import annotations

import datetime
import decimal
import json
import logging
import uuid

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import require_access
from login.sessions import authenticate_request

from . import jobs, storage
from .repository import Repository

logger = logging.getLogger(__name__)
WORKER_OFFLINE_AFTER = datetime.timedelta(minutes=5)


def _json_default(value):
    if isinstance(value, (datetime.datetime, datetime.date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    raise TypeError(type(value).__name__)


def _ok(payload, status=200):
    return JsonResponse(payload, status=status, json_dumps_params={"default": _json_default}, safe=False)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _user(request):
    account = authenticate_request(request)
    return (getattr(account, "email", "") or "").strip() or "staff"


def _repo():
    return Repository()


def _serialize_book(row):
    stage = row.get("job_stage") or ""
    state = row.get("job_state") or ""
    build_status = row.get("build_status") or ""
    if build_status in ("active", "ready"):
        display = "ready"
    elif build_status in ("needs_review", "failed"):
        display = build_status
    elif state == "failed":
        display = "retrying"
    elif state == "running":
        display = stage or "processing"
    else:
        display = "queued"
    return {
        "id": row["id"], "title": row["title"], "scopes": row.get("scopes") or [],
        "archived": row.get("book_status") == "archived", "createdAt": row["created_at"],
        "live": row.get("current_version_id") is not None and row.get("current_version_id") == row.get("version_id"),
        "version": {"id": row.get("version_id"), "fileName": row.get("file_name"), "sizeBytes": row.get("size_bytes"),
                    "pageCount": row.get("page_count"), "edition": row.get("edition_label") or ""},
        "build": {"id": row.get("build_id"), "status": build_status, "completeness": row.get("completeness") or {}},
        "processing": {"status": display, "stage": stage, "progress": row.get("job_progress") or {},
                       "attempts": row.get("attempts") or 0, "lastError": row.get("last_error") or ""},
    }


@csrf_exempt
@require_access("curriculum")
def scopes(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return _ok({"scopes": _repo().list_scopes()})


@csrf_exempt
@require_access("curriculum")
def books(request):
    repo = _repo()
    if request.method == "GET":
        rows = repo.list_books(scope=request.GET.get("scope") or None,
                               include_archived=request.GET.get("archived") == "1")
        return _ok({"books": [_serialize_book(row) for row in rows]})
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    uploaded = request.FILES.get("file")
    if uploaded is None:
        return _error("Choose a PDF book to upload.", 400)
    scope_values = request.POST.getlist("scopes") or [s for s in (request.POST.get("scopes") or "").split(",")]
    try:
        result = jobs.register_upload(
            repo, storage.get_storage(), uploaded, file_name=uploaded.name,
            title=request.POST.get("title") or "", scopes=scope_values,
            edition=request.POST.get("edition") or "", user=_user(request))
    except jobs.UploadRejected as exc:
        return _error(str(exc), 400)
    except Exception:  # noqa: BLE001 - storage/database problems are reported plainly
        logger.exception("Knowledge Base upload failed")
        return _error("The book could not be stored. Please try again.", 503)
    return _ok(result, status=200 if result["duplicate"] else 202)


@csrf_exempt
@require_access("curriculum")
def book_detail(request, book_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    repo = _repo()
    row = next((r for r in repo.list_books(include_archived=True) if str(r["id"]) == str(book_id)), None)
    if row is None:
        return _error("Book not found.", 404)
    book = _serialize_book(row)
    build_id = row.get("build_id")
    book["outline"] = repo.book_outline(build_id) if build_id else []
    book["issues"] = repo.build_issues(build_id) if build_id else []
    return _ok(book)


@csrf_exempt
@require_access("curriculum")
def retry_build(request, build_id):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    if not _repo().requeue_build(build_id):
        return _error("This book is being processed right now, or does not exist.", 409)
    return _ok({"queued": True}, status=202)


@csrf_exempt
@require_access("curriculum")
def accept_build(request, build_id):
    """Accept a book with recorded gaps. The decision and its author are stored."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    repo = _repo()
    if repo.build_status(build_id) != "needs_review":
        return _error("Only a book that needs review can be accepted with gaps.", 409)
    repo.activate_build(build_id, accepted_by=_user(request))
    return _ok({"active": True})


@csrf_exempt
@require_access("curriculum")
def worker_status(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    last_seen, now = _repo().worker_last_seen()
    online = bool(last_seen and now - last_seen <= WORKER_OFFLINE_AFTER)
    return _ok({"online": online, "lastSeenAt": last_seen})
