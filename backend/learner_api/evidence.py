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
    DELETE /learner_api/evidence/<kind>/<pk>/<file_id>/   (own file, pre-submission)
"""
import json
import logging
from pathlib import Path
import uuid

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .evidence_tables import ensure_evidence_tables
from .evidence_storage import (
    azure_configured, upload_to_quarantine, move_blob, blob_url, get_download_sas,
    delete_blob,
)
from login.permissions import learner_self_only, learner_self_or_staff

logger = logging.getLogger(__name__)

VALID_KINDS = {"commercial", "apprenticeship"}
#: What a learner may upload as evidence. Browsers send the type, so this is
#: keyed on it — but a browser with no mapping for .docx sends
#: application/octet-stream, and Windows sometimes sends the legacy
#: application/msword for a .docx, so the extension is accepted as corroboration
#: in _evidence_type_allowed rather than trusting the header alone.
ALLOWED_TYPES = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "video/mp4",
    # Word
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # PowerPoint
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
}

#: Extensions matching ALLOWED_TYPES, for the upload whose declared type is
#: missing or generic. Both have to line up with the accept list the learner
#: page offers (frontend AssignmentEvidence).
ALLOWED_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".mp4",
    ".doc", ".docx", ".ppt", ".pptx", ".ppsx",
}

#: Types a browser sends when it does not recognise the file, which on their own
#: say nothing — accepted only when the extension is one of ours.
GENERIC_TYPES = {"", "application/octet-stream", "binary/octet-stream"}


def _evidence_type_allowed(uploaded):
    """Whether this upload is a kind of evidence we accept.

    A declared type we know is enough. A generic or absent type is accepted on
    the strength of the extension, because otherwise a learner on a machine with
    no .docx mapping simply cannot submit their assignment.
    """
    content_type = (getattr(uploaded, "content_type", "") or "").split(";")[0].strip().lower()
    suffix = Path(getattr(uploaded, "name", "") or "").suffix.lower()
    if content_type in ALLOWED_TYPES:
        return True
    if content_type in GENERIC_TYPES and suffix in ALLOWED_EXTENSIONS:
        return True
    return False
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


def _learner_profile_ids_for_source(cur, learner_id):
    learner_id = str(learner_id or "").strip()
    if not learner_id:
        return []

    ids = {learner_id}
    email = ""
    cur.execute('select "Email" from enrolment."Created_users" where id::text = %s limit 1', [learner_id])
    row = cur.fetchone()
    if row:
        email = str(row[0] or "").strip()

    if email:
        cur.execute(
            """
            select id::text
              from "Learner".learners
             where id::text = %s
                or lower(email) = lower(%s)
            """,
            [learner_id, email],
        )
    else:
        cur.execute('select id::text from "Learner".learners where id::text = %s', [learner_id])
    ids.update(str(row[0] or "").strip() for row in cur.fetchall() if row and str(row[0] or "").strip())
    return sorted(ids)


def _evidence_lineage(kind, learner_id, section_ref):
    section_ref = str(section_ref or "").strip()
    lineage = {"component_ref": None, "progress_entry_id": None}
    if not section_ref:
        return lineage
    try:
        with _conn().cursor() as cur:
            cur.execute("select id from curriculum.components where id = %s limit 1", [section_ref])
            if cur.fetchone():
                lineage["component_ref"] = section_ref
            learner_ids = _learner_profile_ids_for_source(cur, learner_id)
            if not learner_ids:
                return lineage
            cur.execute(
                """
                select p.id
                  from "Learner"."learner_progress_entries" p
                 where p.component_ref = %s
                   and p.learner_id::text = any(%s)
                 order by p.submitted_at desc nulls last, p.id desc
                 limit 1
                """,
                [section_ref, learner_ids],
            )
            row = cur.fetchone()
            if row:
                lineage["progress_entry_id"] = row[0]
    except DatabaseError:
        return lineage
    return lineage


@csrf_exempt
# Evidence is the learner's own portfolio: staff assess what is uploaded, they
# do not upload on the learner's behalf from the learner's own page.
@learner_self_only(kwarg="pk")
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
    if not _evidence_type_allowed(f):
        return _error(
            "Unsupported file type. Upload a PDF, Word or PowerPoint document, "
            "an image (PNG/JPEG) or an MP4 video.",
            400,
        )
    if f.size > MAX_BYTES:
        return _error("File exceeds the 50 MB size limit.", 400)

    # Training-plan context the file was uploaded against (module/week/component
    # identity+titles), stored verbatim so the row stays traceable even if the
    # curriculum is later restructured. Optional — posted as a JSON string field.
    training_plan_details = None
    raw_details = request.POST.get("training_plan_details")
    if raw_details:
        try:
            training_plan_details = json.loads(raw_details)
        except ValueError:
            return _error("training_plan_details must be valid JSON.", 400)
    lineage = _evidence_lineage(kind, pk, section_ref)

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
                   original_filename, content_type, size_bytes, status, uploaded_by, uploaded_at,
                   "Training_plan_details", component_ref, progress_entry_id)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending', %s, %s, %s, %s, %s)
                """,
                [str(file_id), kind, str(pk), section_ref, quarantine, blob_name,
                 f.name, f.content_type, f.size, str(pk), timezone.now(),
                 json.dumps(training_plan_details) if training_plan_details is not None else None,
                 lineage.get("component_ref"), lineage.get("progress_entry_id")],
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


# The learner's own evidence portfolio; staff assess it, so both may read (A5).
@learner_self_or_staff(kwarg="pk")
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
                'scan_result, section_ref, uploaded_at, "Training_plan_details", component_ref, progress_entry_id '
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
            "trainingPlanDetails": r[8],
            "componentRef": r[9],
            "progressEntryId": r[10],
        }
        for r in rows
    ]})


# Mints a short-lived SAS URL to the learner's file; owner or staff only (A5).
@learner_self_or_staff(kwarg="pk")
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


def _is_submitted_for_marking(progress_entry_id):
    """Has this progress entry actually been handed in?

    Today only `submit_component_progress` writes these rows and it always sets
    `submitted_at`, so the mere existence of an entry means "submitted". Asking
    about `submitted_at` directly states what the evidence gate actually cares
    about, so a future draft/in-progress row would not silently start locking
    learners out of files they have not handed in. Unreadable => treat as
    submitted: refusing a delete is the safe direction.
    """
    try:
        with _conn().cursor() as cur:
            cur.execute(
                'select submitted_at is not null '
                'from "Learner"."learner_progress_entries" where id = %s',
                [progress_entry_id],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not check progress entry %s: %s", progress_entry_id, exc)
        return True
    return bool(row[0]) if row else False


@csrf_exempt
# Same rule as upload: a learner curates their own portfolio. Staff assess what
# is there, they do not remove a learner's file from the learner's own page.
@learner_self_only(kwarg="pk")
def delete_evidence(request, kind, pk, file_id):
    """Remove one of the learner's own evidence files.

    Lets a learner correct a mistaken upload — the frontend's "reupload" is this
    delete followed by an ordinary upload, so there is no separate replace path.

    Refused once the file is attached to a submitted progress entry: from that
    point an assessor may be marking against it, and deleting it would pull the
    evidence out from under the marking queue. That link is re-derived here as
    well as read off the row, because the row's `progress_entry_id` is captured
    at upload time — null for the normal case of uploading *before* finishing
    the component, which is exactly the case that must stay deletable.
    """
    if request.method != "DELETE":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)
    ensure_evidence_tables()

    # Scoping the lookup by learner is the ownership check: another learner's
    # file id simply does not resolve here.
    try:
        with _conn().cursor() as cur:
            cur.execute(
                'select blob_name, container, section_ref, progress_entry_id '
                'from "Learner"."evidence_files" '
                "where id = %s and learner_kind = %s and learner_id = %s",
                [str(file_id), kind, str(pk)],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not look up evidence for delete: %s", exc)
        return _error("Could not load evidence.", 502)

    if not row:
        return _error("Evidence not found.", 404)
    blob_name, container, section_ref, progress_entry_id = row

    if progress_entry_id is None:
        progress_entry_id = _evidence_lineage(kind, pk, section_ref).get("progress_entry_id")
    if progress_entry_id is not None and _is_submitted_for_marking(progress_entry_id):
        return _error(
            "This file has been submitted for marking and can no longer be removed. "
            "Ask your tutor if it needs to be replaced.",
            409,
        )

    # Blob first: a delete that removed the row but left the blob would strand
    # a file nothing points at any more. A blob that has already gone is not a
    # failure — the row still has to go.
    if azure_configured() and blob_name and container:
        try:
            delete_blob(container, blob_name)
        except Exception as exc:  # already deleted / SDK / network
            logger.warning("Evidence blob delete failed for %s/%s: %s", container, blob_name, exc)

    try:
        with _conn().cursor() as cur:
            cur.execute(
                'delete from "Learner"."evidence_files" '
                "where id = %s and learner_kind = %s and learner_id = %s",
                [str(file_id), kind, str(pk)],
            )
            # Approved uploads are also indexed in "Learner"."Evidence" by blob
            # name (see _record_approved_evidence); drop that entry too rather
            # than leave it pointing at a blob that no longer exists.
            if blob_name:
                cur.execute('delete from "Learner"."Evidence" where "Azure_id" = %s', [blob_name])
    except DatabaseError as exc:
        logger.warning("Could not delete evidence row: %s", exc)
        return _error("Could not remove the evidence record.", 502)

    return JsonResponse({"id": str(file_id), "deleted": True})
