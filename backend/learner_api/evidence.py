"""Learner evidence upload/list/download API (Azure Blob Storage backed).

Lifecycle (see EVIDENCE_CLOUD.md):
    upload -> scanner readiness gate -> QUARANTINE + pending metadata
           -> authoritative scan
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

from .evidence_storage import (
    azure_configured, upload_to_quarantine, move_blob, blob_url, get_download_sas,
    delete_blob,
)
from .malware_scanning import (
    MalwareDetected,
    ScanError,
    ScannerUnavailable,
    ensure_scanner_ready as _ensure_scanner_ready,
    scan_uploaded_blob,
    verified_verdict,
)
from login.permissions import learner_self_or_admin, learner_self_or_staff

logger = logging.getLogger(__name__)

VALID_KINDS = {"commercial", "apprenticeship"}

#: Returned when the marking lookup itself fails. Distinct from "" (never
#: submitted) so a database problem locks the file rather than unlocking it.
MARKING_STATUS_UNKNOWN = "unknown"
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


#: What an evidence write returns so it can be recorded. `container` and
#: `blob_name` are not here: together they locate the file in Azure, which is a
#: way to fetch it rather than a fact about it -- the same rule this codebase
#: applies to meeting join links.
EVIDENCE_AUDIT_COLUMNS = (
    'id', 'learner_kind', 'learner_id', 'section_ref', 'component_ref',
    'progress_entry_id', 'original_filename', 'content_type', 'size_bytes',
    'status', 'scan_result', 'uploaded_by', 'uploaded_at', 'reviewed_at',
)
EVIDENCE_AUDIT_SQL = ', '.join(f'"{column}"' for column in EVIDENCE_AUDIT_COLUMNS)


def _record_evidence_file(row, *, deleted=False):
    """Record an evidence upload or deletion in the Audit Trail. Never raises.

    Evidence is what an audit of off-the-job hours ultimately rests on, so who
    uploaded a file, whether the scan accepted it, and who later removed it are
    exactly the questions this exists to answer.
    """
    if not row:
        return
    try:
        from system_audit.writes import record_table_rows

        record_table_rows(
            'evidence_files',
            [dict(zip(EVIDENCE_AUDIT_COLUMNS, row))],
            reason='deleted' if deleted else '',
            deleted=deleted,
            using='enrolment',
        )
    except Exception:
        logger.warning('Could not record an evidence file write.', exc_info=True)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


EVIDENCE_SCHEMA_SQLSTATES = {
    "3F000",  # invalid_schema_name
    "42P01",  # undefined_table
    "42703",  # undefined_column
}


def _database_sqlstate(exc):
    """Find PostgreSQL's SQLSTATE through Django's wrapped exception chain."""
    current = exc
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        code = getattr(current, "sqlstate", None) or getattr(current, "pgcode", None)
        if code:
            return str(code)
        current = current.__cause__ or current.__context__
    return None


def _database_error_response(exc, *, operation, fallback):
    """Return a stable response without exposing database or learner details."""
    if _database_sqlstate(exc) in EVIDENCE_SCHEMA_SQLSTATES:
        logger.error(
            "Evidence schema dependency unavailable during %s (%s). "
            "Run validate_evidence_schema for the deployment target.",
            operation,
            exc.__class__.__name__,
        )
        return _error("Evidence service is temporarily unavailable.", 503)
    logger.warning("Evidence database operation %s failed (%s).", operation, exc.__class__.__name__)
    return _error(fallback, 502)


def _conn():
    return connections["enrolment"]


def _scan(data_container, blob_name):
    """Return a provider-correlated result or raise; never fabricate ``clean``."""
    return scan_uploaded_blob(data_container, blob_name)


def _verified_scan_verdict(result, container, blob_name):
    return verified_verdict(
        result,
        expected_container=container,
        expected_blob_name=blob_name,
    )


SCANNER_UNAVAILABLE_MESSAGE = (
    "Malware scanning is temporarily unavailable. Upload has not been saved."
)


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
    from .reflection_submissions import _learner_profile_ids_for_source as resolve
    return resolve(cur, learner_id)


def _training_plan_details(value):
    # Raw PostgreSQL cursors may return JSON/JSONB as text. The client expects
    # an object: forwarding text loses the entered title, placement and KSBs.
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return None
    return value if isinstance(value, dict) else None


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
# Learners and admins can upload to the selected learner's portfolio.
@learner_self_or_admin(kwarg="pk")
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

    # This deployment has no authoritative scanner. Reject before opening a
    # database cursor or sending bytes to Azure; request fields can never
    # substitute for a trusted provider result.
    try:
        _ensure_scanner_ready()
    except ScannerUnavailable:
        logger.error("Evidence upload blocked because malware scanning is unavailable.")
        return _error(SCANNER_UNAVAILABLE_MESSAGE, 503)

    lineage = _evidence_lineage(kind, pk, section_ref)

    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else "bin"
    file_id = uuid.uuid4()
    blob_name = f"{kind}/{pk}/{section_ref}/{file_id}.{ext}"
    quarantine = settings.AZURE_QUARANTINE_CONTAINER

    try:
        upload_to_quarantine(f, blob_name, f.content_type)
    except Exception as exc:  # SDK / network / duplicate-blob errors
        logger.warning("Evidence upload to quarantine failed (%s).", exc.__class__.__name__)
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
        return _database_error_response(
            exc,
            operation="upload metadata insert",
            fallback="Could not record evidence metadata.",
        )

    # Scan + route. Only a structured provider-correlated CLEAN result may be
    # promoted. Infrastructure/timeout/invalid outcomes remain in quarantine.
    try:
        verdict = _verified_scan_verdict(_scan(quarantine, blob_name), quarantine, blob_name)
    except MalwareDetected:
        verdict = "infected"
    except ScanError as exc:
        logger.error(
            "Evidence upload remains quarantined because scanning failed (%s).",
            exc.__class__.__name__,
        )
        return _error("Malware scanning could not be completed. The file is not available.", 503)
    approved = settings.AZURE_APPROVED_CONTAINER
    rejected = settings.AZURE_REJECTED_CONTAINER
    dest = approved if verdict == "clean" else rejected
    status = "approved" if verdict == "clean" else "rejected"

    try:
        move_blob(quarantine, dest, blob_name)
    except Exception as exc:
        logger.warning("Evidence blob routing failed (%s).", exc.__class__.__name__)
        return _error("Could not finalise upload.", 502)

    try:
        with _conn().cursor() as cur:
            cur.execute(
                'update "Learner"."evidence_files" '
                "set container = %s, status = %s, scan_result = %s, reviewed_at = %s "
                "where id = %s "
                "returning " + EVIDENCE_AUDIT_SQL,
                [dest, status, verdict, timezone.now(), str(file_id)],
            )
            # Recorded here rather than at the insert above. The insert writes a
            # `pending` row that this statement settles moments later in the
            # same request, so recording both would report one upload as two
            # edits -- and the second is the one that says whether the file was
            # accepted at all.
            _record_evidence_file(cur.fetchone())
            if status == "approved":
                _record_approved_evidence(cur, blob_name, f.name, blob_url(approved, blob_name))
    except DatabaseError as exc:
        return _database_error_response(
            exc,
            operation="upload metadata finalisation",
            fallback="Upload stored but metadata update failed.",
        )

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
        return _database_error_response(
            exc,
            operation="evidence list",
            fallback="Could not load evidence.",
        )

    # Whether each file may still be removed, answered the same way delete_evidence
    # answers it, so the page never offers a Remove the server will refuse.
    #
    # Every file under one activity shares its answer. Resolve all activities
    # in one bounded lookup instead of opening two cursors per section.
    marking_by_section = _marking_statuses(kind, pk, (row[6] for row in rows))

    def _marking(section_ref):
        return marking_by_section.get(str(section_ref or "").strip(), "")

    return JsonResponse({"results": [
        {
            "id": str(r[0]), "filename": r[1], "contentType": r[2], "sizeBytes": r[3],
            "status": r[4], "scanResult": r[5], "sectionRef": r[6],
            "uploadedAt": r[7].isoformat() if r[7] else None,
            "trainingPlanDetails": _training_plan_details(r[8]),
            "componentRef": r[9],
            "progressEntryId": r[10],
            # False once the activity has been handed in: the file is part of
            # what was submitted for marking and is no longer the learner's to
            # withdraw. The UI hides Remove on this rather than offering an
            # action the server will refuse.
            "canDelete": _marking(r[6]) == "",
            # The coach's decision on the activity this file belongs to, or ""
            # when it has not been handed in. Distinct from `status` above,
            # which is the malware-scan verdict: a file can be stored and clean
            # while no coach has ever looked at it.
            "markingStatus": _marking(r[6]),
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
    try:
        with _conn().cursor() as cur:
            cur.execute(
                'select blob_name, status from "Learner"."evidence_files" '
                "where id = %s and learner_kind = %s and learner_id = %s",
                [str(file_id), kind, str(pk)],
            )
            row = cur.fetchone()
    except DatabaseError as exc:
        return _database_error_response(
            exc,
            operation="evidence download lookup",
            fallback="Could not load evidence.",
        )

    if not row:
        return _error("Evidence not found.", 404)
    blob_name, status = row
    if status != "approved":
        return _error("File is not available for download.", 409)

    url = get_download_sas(settings.AZURE_APPROVED_CONTAINER, blob_name)
    return JsonResponse({"url": url})


def _marking_learner_ids(cur, learner_id):
    """Return the canonical enrolment id plus unambiguous legacy profile ids.

    Reflection submissions are canonically keyed by enrolment id. Older rows
    can carry a linked Learner profile id, but a bare integer may also name a
    different enrolment account. Only accept a profile id when the explicit
    ``learners.enrolment_id`` bridge exists and that number is not owned by a
    different enrolment account.
    """
    canonical = str(learner_id or "").strip()
    if not canonical:
        return []
    candidates = {canonical}
    try:
        enrolment_id = int(canonical)
    except (TypeError, ValueError):
        return sorted(candidates)
    cur.execute(
        '''
        select l.id::text
          from "Learner".learners l
         where l.enrolment_id = %s
           and not exists (
               select 1
                 from enrolment."Created_users" other
                where other.id = l.id
                  and other.id <> %s
           )
        ''',
        [enrolment_id, enrolment_id],
    )
    candidates.update(str(row[0]) for row in cur.fetchall() if row and row[0] is not None)
    return sorted(candidates)


def _marking_statuses(kind, learner_id, section_refs):
    """Resolve the preferred marking status for every requested activity.

    The precedence is deliberately identical to the former per-section query:
    accepted, then submitted-for-review, then any other latest status.
    """
    sections = sorted({str(value or "").strip() for value in section_refs} - {""})
    if not sections:
        return {}
    try:
        with _conn().cursor() as cur:
            candidates = _marking_learner_ids(cur, learner_id)
            cur.execute(
                '''
                select distinct on (activity_id) activity_id, status
                  from "Learner"."learning_reflection_submissions"
                 where activity_id = any(%s)
                   and learner_kind = %s
                   and learner_id::text = any(%s)
                 order by activity_id,
                     case status when 'accepted' then 0 when 'submitted_for_tutor_review' then 1 else 2 end,
                     submitted_at desc nulls last
                ''',
                [sections, kind, candidates],
            )
            statuses = {section: "" for section in sections}
            for activity_id, status in cur.fetchall():
                activity_id = str(activity_id or "").strip()
                if activity_id in statuses:
                    statuses[activity_id] = str(status or "")
            return statuses
    except DatabaseError as exc:
        logger.warning(
            "Could not read marking statuses for %s (%s activities): %s",
            kind,
            len(sections),
            exc,
        )
        # A lookup failure must not make submitted evidence deletable.
        return {section: MARKING_STATUS_UNKNOWN for section in sections}


def _marking_status(kind, learner_id, section_ref):
    """The coach's decision on the activity this file belongs to, or ''.

    '' means the work has not been handed in, so no coach has seen it. Anything
    else is the status of the submission -- 'submitted_for_tutor_review' while
    it waits, 'accepted' once a coach has validated it.

    The learner's Evidence Library needs this because a file's own `status`
    column is the malware-scan verdict from the upload pipeline: 'approved'
    there means "scanned clean and stored", not "a coach agreed with it".
    Labelling a freshly-uploaded file "Validated" told the learner their
    evidence had been accepted when nobody had looked at it.
    """
    section_ref = str(section_ref or "").strip()
    if not section_ref:
        return ""
    return _marking_statuses(kind, learner_id, [section_ref]).get(section_ref, "")


def _is_submitted_for_marking(kind, learner_id, section_ref):
    """Whether this activity has been handed to a coach, so its evidence is
    no longer the learner's to withdraw.

    Expressed in terms of _marking_status so the list endpoint and the delete
    gate cannot drift apart: both ask one function the same question, and a
    change to the rule lands in one place.
    """
    return _marking_status(kind, learner_id, section_ref) != ""


@csrf_exempt
# Portfolio removal uses the same owner/admin permission as uploads.
@learner_self_or_admin(kwarg="pk")
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
        return _database_error_response(
            exc,
            operation="evidence delete lookup",
            fallback="Could not load evidence.",
        )

    if not row:
        return _error("Evidence not found.", 404)
    blob_name, container, section_ref, progress_entry_id = row

    if _is_submitted_for_marking(kind, pk, section_ref):
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
                "where id = %s and learner_kind = %s and learner_id = %s "
                "returning " + EVIDENCE_AUDIT_SQL,
                [str(file_id), kind, str(pk)],
            )
            # Read from what the delete returned: that is the only moment the
            # row still exists, and a trail entry for a deletion that cannot say
            # what was deleted is the one entry that most needed to.
            _record_evidence_file(cur.fetchone(), deleted=True)
            # Approved uploads are also indexed in "Learner"."Evidence" by blob
            # name (see _record_approved_evidence); drop that entry too rather
            # than leave it pointing at a blob that no longer exists.
            if blob_name:
                cur.execute('delete from "Learner"."Evidence" where "Azure_id" = %s', [blob_name])
    except DatabaseError as exc:
        return _database_error_response(
            exc,
            operation="evidence metadata delete",
            fallback="Could not remove the evidence record.",
        )

    return JsonResponse({"id": str(file_id), "deleted": True})
