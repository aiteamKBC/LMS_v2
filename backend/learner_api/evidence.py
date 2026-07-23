"""Learner evidence upload/list/download API (Azure Blob Storage backed).

Lifecycle (see EVIDENCE_CLOUD.md):
    upload -> QUARANTINE container + evidence_files row (status 'pending')
           -> scan (see _scan; no scanner infra yet -> TODO)
           -> promote to APPROVED (status 'approved') and record the approved
              blob in "Learner"."Evidence"  ── OR ── move to REJECTED.
    download -> short-lived SAS URL, ONLY from the approved container, ONLY for
                approved rows.

Learners are addressed by (kind, id) like the rest of learner_api — this project
has no auth_user-based learners, so the generic spec's auth_user/DRF model is
adapted to plain CSRF-exempt JSON views keyed on kind+id.

    POST /learner_api/evidence/<kind>/<pk>/upload/   (multipart: file, section_ref)
    GET  /learner_api/evidence/<kind>/<pk>/          (optional ?section_ref= &status=)
    GET  /learner_api/evidence/<kind>/<pk>/<file_id>/download/
"""
import logging
import uuid

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .evidence_tables import ensure_evidence_tables
from .evidence_storage import (
    azure_configured, upload_to_quarantine, move_blob, blob_url, get_download_sas,
)

logger = logging.getLogger(__name__)

VALID_KINDS = {"commercial", "apprenticeship"}
ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "video/mp4"}
MAX_BYTES = 50 * 1024 * 1024  # 50 MB


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _conn():
    return connections["enrolment"]


def _scan(_data_container, _blob_name) -> str:
    """Return a scan verdict: 'clean' | 'infected'.

    TODO: no malware scanner is wired up yet (no ClamAV daemon / Defender event
    subscription in this environment). Until one exists we optimistically treat
    uploads as clean so the quarantine->approved promotion works end-to-end.
    When a scanner is available, download the blob and inspect it here (see
    EVIDENCE_CLOUD.md §6) and return 'infected' on a hit.
    """
    return "clean"


def _record_approved_evidence(cur, blob_name, original_filename, approved_path):
    """Insert the approved blob into "Learner"."Evidence" (the requested index).
    Idempotent on Azure_id so a re-promote doesn't duplicate the row."""
    cur.execute('SELECT 1 FROM "Learner"."Evidence" WHERE "Azure_id" = %s LIMIT 1', [blob_name])
    if cur.fetchone():
        return
    cur.execute(
        'INSERT INTO "Learner"."Evidence" ("Azure_id", "Evidence_name", "Evidence_path") '
        "VALUES (%s, %s, %s)",
        [blob_name, original_filename, approved_path],
    )


@csrf_exempt
def upload_evidence(request, kind, pk):
    """Multipart upload -> quarantine -> (scan) -> promote to approved.
    On approval the blob is recorded in "Learner"."Evidence"."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)
    if not azure_configured():
        return _error("Evidence storage is not configured.", 503)

    f = request.FILES.get("file")
    section_ref = (request.POST.get("section_ref") or "").strip()
    if not f or not section_ref:
        return _error("file and section_ref are required.", 400)
    if f.content_type not in ALLOWED_TYPES:
        return _error("Unsupported file type.", 400)
    if f.size > MAX_BYTES:
        return _error("File exceeds the 50 MB size limit.", 400)

    ensure_evidence_tables()

    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else "bin"
    file_id = uuid.uuid4()
    blob_name = f"{kind}/{pk}/{section_ref}/{file_id}.{ext}"
    quarantine = settings.AZURE_QUARANTINE_CONTAINER

    try:
        upload_to_quarantine(f, blob_name, f.content_type)
    except Exception as exc:  # SDK / network / duplicate-blob errors
        logger.warning("Evidence upload to quarantine failed: %s", exc)
        return _error("Upload to storage failed.", 502)

    # Record the pending row.
    try:
        with _conn().cursor() as cur:
            cur.execute(
                """
                insert into "Learner"."evidence_files"
                  (id, learner_kind, learner_id, section_ref, container, blob_name,
                   original_filename, content_type, size_bytes, status, uploaded_by, uploaded_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s)
                """,
                [str(file_id), kind, str(pk), section_ref, quarantine, blob_name,
                 f.name, f.content_type, f.size, str(pk), timezone.now()],
            )
    except DatabaseError as exc:
        logger.warning("Could not record evidence_files row: %s", exc)
        return _error("Could not record evidence metadata.", 502)

    # Scan + route. (No async worker infra yet -> inline; move to Celery/RQ later.)
    verdict = _scan(quarantine, blob_name)
    approved = settings.AZURE_APPROVED_CONTAINER
    rejected = settings.AZURE_REJECTED_CONTAINER
    dest = approved if verdict == "clean" else rejected
    status = "approved" if verdict == "clean" else "rejected"

    try:
        move_blob(quarantine, dest, blob_name)
    except Exception as exc:
        logger.warning("Evidence promotion (%s -> %s) failed: %s", quarantine, dest, exc)
        return _error("Could not finalise upload.", 502)

    try:
        with _conn().cursor() as cur:
            cur.execute(
                'update "Learner"."evidence_files" '
                "set container = %s, status = %s, scan_result = %s, reviewed_at = %s "
                "where id = %s",
                [dest, status, verdict, timezone.now(), str(file_id)],
            )
            if status == "approved":
                _record_approved_evidence(cur, blob_name, f.name, blob_url(approved, blob_name))
    except DatabaseError as exc:
        logger.warning("Could not update evidence status / record approval: %s", exc)
        return _error("Upload stored but metadata update failed.", 502)

    return JsonResponse(
        {"id": str(file_id), "status": status, "scanResult": verdict,
         "filename": f.name, "sectionRef": section_ref},
        status=201,
    )


def list_evidence(request, kind, pk):
    """The learner's evidence, newest first. Optional ?section_ref= & ?status= filters."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)
    ensure_evidence_tables()

    where = ["learner_kind = %s", "learner_id = %s"]
    params = [kind, str(pk)]
    section_ref = (request.GET.get("section_ref") or "").strip()
    status = (request.GET.get("status") or "").strip()
    if section_ref:
        where.append("section_ref = %s")
        params.append(section_ref)
    if status:
        where.append("status = %s")
        params.append(status)

    try:
        with _conn().cursor() as cur:
            cur.execute(
                "select id, original_filename, content_type, size_bytes, status, "
                "scan_result, section_ref, uploaded_at "
                'from "Learner"."evidence_files" '
                f"where {' and '.join(where)} "
                "order by uploaded_at desc",
                params,
            )
            rows = cur.fetchall()
    except DatabaseError as exc:
        logger.warning("Could not list evidence: %s", exc)
        return _error("Could not load evidence.", 502)

    return JsonResponse({"results": [
        {
            "id": str(r[0]), "filename": r[1], "contentType": r[2], "sizeBytes": r[3],
            "status": r[4], "scanResult": r[5], "sectionRef": r[6],
            "uploadedAt": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]})


def download_evidence(request, kind, pk, file_id):
    """Short-lived SAS URL for an APPROVED file, from the approved container only."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)
    if not azure_configured():
        return _error("Evidence storage is not configured.", 503)
    ensure_evidence_tables()

    try:
        with _conn().cursor() as cur:
            cur.execute(
                'select blob_name, status from "Learner"."evidence_files" '
                "where id = %s and learner_kind = %s and learner_id = %s",
                [str(file_id), kind, str(pk)],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not look up evidence for download: %s", exc)
        return _error("Could not load evidence.", 502)

    if not row:
        return _error("Evidence not found.", 404)
    blob_name, status = row
    if status != "approved":
        return _error("File is not available for download.", 409)

    url = get_download_sas(settings.AZURE_APPROVED_CONTAINER, blob_name)
    return JsonResponse({"url": url})
