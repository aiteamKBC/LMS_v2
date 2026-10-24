"""Learner monthly reports: the wizard the learner submits at month end.

One row per learner per calendar month in "Learner".learner_monthly_reports.
The learner reviews the month's recorded activity, writes what they learned,
attaches any supporting documents, and submits. A submitted month can then be
downloaded back as a report.

Attachments are NOT stored here: they go through the existing evidence upload
pipeline (quarantine -> scan -> approved) under a 'monthly-report:YYYY-MM'
section ref, and only their ids and display names are recorded on the row.
"""

import json
import logging
import re
import uuid

from django.conf import settings
from django.db import DatabaseError, connections, transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt

from .evidence_storage import azure_configured, download_blob_bytes
from login.permissions import learner_self_or_admin, learner_self_or_staff

logger = logging.getLogger(__name__)

VALID_KINDS = {"commercial", "apprenticeship"}
MONTH_KEY_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
# A month's worth of timeline rows is small, but the snapshot arrives from the
# browser, so both it and the free-text reflection are bounded here rather than
# trusting the client to stay reasonable.
MAX_SNAPSHOT_ITEMS = 2000
MAX_ATTACHMENTS = 50
MAX_SUMMARY_CHARS = 20000
MAX_SELECTED_KSBS = 500
# Same cap as every other signature column in the schema (see
# apprenticeship_agreement.MAX_SIGNATURE_CHARS): a data URL, not a file.
MAX_SIGNATURE_CHARS = 400_000
DEFAULT_REPORT_PAGE_SIZE = 24
MAX_REPORT_PAGE_SIZE = 100

#: The learner's reusable signature on their own user record. Distinct from the
#: per-report signature: this one is a convenience for signing the next thing,
#: and re-saving it must never alter a report already signed.
SAVED_SIGNATURE_COLUMN = "Learner_signature"
SAVED_SIGNATURE_NAME_COLUMN = "Learner_signature_name"
SAVED_SIGNATURE_AT_COLUMN = "Learner_signature_saved_at"

SELECT_COLUMNS = """
    id, learner_kind, learner_id, learner_name, programme_name,
    month_key, month_label, status, activity_snapshot, summary_metrics,
    attachments, learned_summary, submitted_at, updated_at,
    selected_ksbs, signature, signed_name, signed_at
"""

LIST_SELECT_COLUMNS = """
    id, learner_kind, learner_id, learner_name, programme_name,
    month_key, month_label, status, summary_metrics, attachments,
    learned_summary, submitted_at, updated_at, selected_ksbs,
    (coalesce(signature, '') <> '' and signed_at is not null) as signed,
    signed_name, signed_at,
    jsonb_array_length(
        case when jsonb_typeof(activity_snapshot) = 'array'
             then activity_snapshot else '[]'::jsonb end
    ) as activity_count
"""


def _record_monthly_report(row):
    """Record a submitted monthly report in the Audit Trail. Never raises.

    ``row`` is what ``returning SELECT_COLUMNS`` produced. Three of its columns
    are deliberately not carried into the history:

    * ``signature`` -- a PNG data URL. ``signed_name`` and ``signed_at`` say who
      signed and when, which is what a signing trail is for.
    * ``activity_snapshot`` -- the month's activity, frozen into the report at
      submission. It is large, it never changes afterwards, and the activity it
      copies is already recorded where it happened.
    * ``attachments`` -- file pointers, on the rule this codebase applies to
      evidence links: a digest of one is useless and the link itself is a way in.
    """
    if not row:
        return
    try:
        from system_audit.writes import record_table_rows

        record_table_rows(
            'learner_monthly_reports',
            [{
                'id': row[0], 'learner_kind': row[1], 'learner_id': row[2],
                'learner_name': row[3], 'programme_name': row[4],
                'month_key': row[5], 'month_label': row[6], 'status': row[7],
                'summary_metrics': row[9], 'learned_summary': row[11],
                'submitted_at': row[12], 'selected_ksbs': row[14],
                'signed_name': row[16], 'signed_at': row[17],
            }],
            using='enrolment',
        )
    except Exception:
        logger.warning('Could not record a monthly report submission.', exc_info=True)


def _error(message, status=400):
    return JsonResponse({"error": message}, status=status)


def _text(value):
    return str(value or "").strip()


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def _json_column(value, fallback):
    """psycopg3 usually decodes jsonb itself; a raw string means it did not."""
    if isinstance(value, str):
        try:
            return json.loads(value) if value else fallback
        except (TypeError, ValueError):
            return fallback
    return value if value is not None else fallback


def _row_to_report(row):
    """Shape one DB row as the JSON the wizard and the download both read."""
    return {
        "id": str(row[0]),
        "learnerKind": row[1],
        "learnerId": row[2],
        "learnerName": row[3],
        "programmeName": row[4],
        "monthKey": row[5],
        "monthLabel": row[6],
        "status": row[7],
        "activitySnapshot": _list(_json_column(row[8], [])),
        "summaryMetrics": _dict(_json_column(row[9], {})),
        "attachments": _list(_json_column(row[10], [])),
        "learnedSummary": row[11],
        "submittedAt": row[12].isoformat() if row[12] else None,
        "updatedAt": row[13].isoformat() if row[13] else None,
        "selectedKsbs": _list(_json_column(row[14], [])),
        "signature": row[15] or "",
        "signedName": row[16] or "",
        "signedAt": row[17].isoformat() if row[17] else None,
    }


def _row_to_summary(row):
    """Shape the bounded list row without snapshot or signature bytes."""
    return {
        "id": str(row[0]),
        "learnerKind": row[1],
        "learnerId": row[2],
        "learnerName": row[3],
        "programmeName": row[4],
        "monthKey": row[5],
        "monthLabel": row[6],
        "status": row[7],
        "summaryMetrics": _dict(_json_column(row[8], {})),
        "attachments": _list(_json_column(row[9], [])),
        "learnedSummary": row[10],
        "submittedAt": row[11].isoformat() if row[11] else None,
        "updatedAt": row[12].isoformat() if row[12] else None,
        "selectedKsbs": _list(_json_column(row[13], [])),
        "signed": bool(row[14]),
        "signedName": row[15] or "",
        "signedAt": row[16].isoformat() if row[16] else None,
        "activityCount": row[17] or 0,
    }


def _pagination_request(request):
    """Validate opt-in list pagination while retaining legacy callers."""
    raw_page = request.GET.get("page")
    raw_page_size = request.GET.get("pageSize", request.GET.get("page_size"))
    if raw_page is None and raw_page_size is None:
        return None, None
    try:
        page = int(raw_page or 1)
        page_size = int(raw_page_size or DEFAULT_REPORT_PAGE_SIZE)
    except (TypeError, ValueError):
        return None, _error("page and pageSize must be whole numbers.")
    if page < 1:
        return None, _error("page must be at least 1.")
    if not 1 <= page_size <= MAX_REPORT_PAGE_SIZE:
        return None, _error(
            f"pageSize must be between 1 and {MAX_REPORT_PAGE_SIZE}."
        )
    return {"page": page, "pageSize": page_size}, None


def _pagination_payload(pagination, total):
    total_pages = max(1, (total + pagination["pageSize"] - 1) // pagination["pageSize"])
    page = min(pagination["page"], total_pages)
    return {
        "page": page,
        "pageSize": pagination["pageSize"],
        "total": total,
        "totalPages": total_pages,
        "hasNext": page < total_pages,
        "hasPrevious": page > 1,
    }


def _saved_signature(cur, learner_id):
    """The learner's reusable signature, when they have saved one.

    Missing columns are treated as "no saved signature" rather than an error:
    the deployment script that adds them may not have been applied yet, and a
    learner can always sign without a saved one.

    ``transaction.atomic`` supplies the savepoint, so a failed probe does not
    abort a surrounding transaction. A bare ``SAVEPOINT`` statement cannot be
    used here: this also runs on the autocommit read path, where PostgreSQL
    rejects savepoints outside a transaction block, and the probe would fail for
    that reason alone rather than because the column was missing.
    """
    try:
        with transaction.atomic(using="enrolment"):
            cur.execute(
                f"""
                select "{SAVED_SIGNATURE_COLUMN}", "{SAVED_SIGNATURE_NAME_COLUMN}"
                  from enrolment."Created_users"
                 where id::text = %s
                 limit 1
                """,
                [str(learner_id)],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.warning("Saved learner signature columns are not available yet.")
        return {"signature": "", "name": ""}
    if not row:
        return {"signature": "", "name": ""}
    return {"signature": _text(row[0]), "name": _text(row[1])}


@csrf_exempt
# READ and WRITE need different authorization, so this single-URL view splits by
# method, exactly as the reflection submissions view does. A learner may only
# WRITE their own monthly report, and admins can act on their behalf. The owner
# OR staff may READ reports (GET) to review what was submitted.
def monthly_reports(request, kind, pk):
    # Forwarded as KEYWORDS, not positionally: the permission gate reads the
    # learner id out of the view's kwargs (``kwarg="pk"``), so passing them
    # positionally leaves it with nothing to check and every request is
    # rejected with "the learner this request applies to could not be
    # determined".
    if request.method == "GET":
        return _list_monthly_reports(request, kind=kind, pk=pk)
    return _submit_monthly_report(request, kind=kind, pk=pk)


@learner_self_or_staff(kwarg="pk")
def _list_monthly_reports(request, kind, pk):
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)

    month_key = _text(request.GET.get("month"))
    if month_key and not MONTH_KEY_RE.match(month_key):
        return _error("month must use YYYY-MM format.")
    pagination, pagination_error = _pagination_request(request)
    if pagination_error is not None:
        return pagination_error

    try:
        with connections["enrolment"].cursor() as cur:
            if month_key:
                cur.execute(
                    f"""
                    select {SELECT_COLUMNS}
                      from "Learner".learner_monthly_reports
                     where learner_kind = %s and learner_id = %s and month_key = %s
                     limit 1
                    """,
                    [kind, str(pk), month_key],
                )
                rows = cur.fetchall()
                response_pagination = None
            elif pagination is not None:
                cur.execute(
                    """
                    select count(*)
                      from "Learner".learner_monthly_reports
                     where learner_kind = %s and learner_id = %s
                    """,
                    [kind, str(pk)],
                )
                total = cur.fetchone()[0]
                response_pagination = _pagination_payload(pagination, total)
                offset = (
                    (response_pagination["page"] - 1)
                    * response_pagination["pageSize"]
                )
                cur.execute(
                    f"""
                    select {LIST_SELECT_COLUMNS}
                      from "Learner".learner_monthly_reports
                     where learner_kind = %s and learner_id = %s
                     order by month_key desc, id desc
                     limit %s offset %s
                    """,
                    [
                        kind,
                        str(pk),
                        response_pagination["pageSize"],
                        offset,
                    ],
                )
                rows = cur.fetchall()
            else:
                cur.execute(
                    f"""
                    select {SELECT_COLUMNS}
                      from "Learner".learner_monthly_reports
                     where learner_kind = %s and learner_id = %s
                     order by month_key desc, id desc
                    """,
                    [kind, str(pk)],
                )
                rows = cur.fetchall()
                response_pagination = None
            # Offered so the wizard can pre-fill "use my saved signature"
            # instead of making the learner produce one every month.
            saved = _saved_signature(cur, pk)
    except DatabaseError:
        logger.exception("Could not load learner monthly reports.")
        return _error("Could not load the monthly reports.", 502)

    reports = [
        _row_to_summary(row) if response_pagination is not None else _row_to_report(row)
        for row in rows
    ]
    if month_key:
        return JsonResponse(
            {
                "report": reports[0] if reports else None,
                "savedSignature": saved["signature"],
                "savedSignatureName": saved["name"],
            }
        )
    payload = {
        "reports": reports,
        "savedSignature": saved["signature"],
        "savedSignatureName": saved["name"],
    }
    if response_pagination is not None:
        payload["pagination"] = response_pagination
    return JsonResponse(payload)


@learner_self_or_admin(kwarg="pk")
def _submit_monthly_report(request, kind, pk):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)

    try:
        payload = json.loads(request.body or b"{}")
    except (TypeError, ValueError):
        return _error("Request body must be valid JSON.")

    month_key = _text(payload.get("monthKey"))
    learned_summary = _text(payload.get("learnedSummary"))
    signature = _text(payload.get("signature"))
    signed_name = _text(payload.get("signedName")) or _text(payload.get("learnerName"))
    account = getattr(request, "login_account", None)
    # An administrator or the learner's own coach signs in their own name.
    admin_action = (getattr(account, "role", None) == "admin"
                    or getattr(request, "coach_learner_action", False))
    if admin_action:
        signed_name = account.display_name or account.email

    if not MONTH_KEY_RE.match(month_key):
        return _error("A valid monthKey (YYYY-MM) is required.")
    if not learned_summary:
        return _error("Tell us what you learned this month before submitting.")
    if len(learned_summary) > MAX_SUMMARY_CHARS:
        return _error("What you learned is too long to save.")

    # A report is a declaration about the learner's own month, so it is signed.
    # Same shape and cap as every other signature in the schema.
    if not signature:
        return _error("Sign the report before submitting it.")
    if not signature.startswith("data:image/"):
        return _error("signature must be an image data URL.")
    if len(signature) > MAX_SIGNATURE_CHARS:
        return _error("That signature image is too large.")

    expected_updated_at_supplied = "expectedUpdatedAt" in payload
    expected_updated_at_raw = payload.get("expectedUpdatedAt")
    expected_updated_at = None
    if expected_updated_at_raw not in (None, ""):
        if not isinstance(expected_updated_at_raw, str):
            return _error("expectedUpdatedAt must be an ISO-8601 date-time or null.")
        expected_updated_at = parse_datetime(expected_updated_at_raw)
        if expected_updated_at is None or not timezone.is_aware(expected_updated_at):
            return _error("expectedUpdatedAt must be an ISO-8601 date-time with a timezone.")

    snapshot = _list(payload.get("activitySnapshot"))[:MAX_SNAPSHOT_ITEMS]
    attachments = [_dict(item) for item in _list(payload.get("attachments"))[:MAX_ATTACHMENTS]]
    selected_ksbs = [
        {
            "code": _text(item.get("code")).upper(),
            "type": _text(item.get("type")),
            "description": _text(item.get("description")),
        }
        for item in (_dict(entry) for entry in _list(payload.get("selectedKsbs")))
        if _text(item.get("code"))
    ][:MAX_SELECTED_KSBS]

    report_id = uuid.uuid4()
    try:
        with transaction.atomic(using="enrolment"):
            with connections["enrolment"].cursor() as cur:
                cur.execute(
                    f"""
                    insert into "Learner".learner_monthly_reports as existing_report (
                        id, learner_kind, learner_id, learner_name, programme_name,
                        month_key, month_label, status, learned_summary,
                        activity_snapshot, summary_metrics, attachments,
                        selected_ksbs, signature, signed_name, signed_at,
                        submitted_at, updated_at
                    ) values (
                        %s, %s, %s, %s, %s,
                        %s, %s, 'submitted', %s,
                        %s::jsonb, %s::jsonb, %s::jsonb,
                        %s::jsonb, %s, %s, now(),
                        now(), now()
                    )
                    on conflict (learner_kind, learner_id, month_key)
                    do update set
                        learner_name = excluded.learner_name,
                        programme_name = excluded.programme_name,
                        month_label = excluded.month_label,
                        status = 'submitted',
                        learned_summary = excluded.learned_summary,
                        activity_snapshot = excluded.activity_snapshot,
                        summary_metrics = excluded.summary_metrics,
                        attachments = excluded.attachments,
                        selected_ksbs = excluded.selected_ksbs,
                        signature = excluded.signature,
                        signed_name = excluded.signed_name,
                        signed_at = now(),
                        updated_at = now()
                    where not %s
                       or existing_report.updated_at is not distinct from %s
                    returning {SELECT_COLUMNS}
                    """,
                    [
                        str(report_id),
                        kind,
                        str(pk),
                        _text(payload.get("learnerName")),
                        _text(payload.get("programmeName")),
                        month_key,
                        _text(payload.get("monthLabel")),
                        learned_summary,
                        json.dumps(snapshot),
                        json.dumps(_dict(payload.get("summaryMetrics"))),
                        json.dumps(attachments),
                        json.dumps(selected_ksbs),
                        signature,
                        signed_name,
                        expected_updated_at_supplied,
                        expected_updated_at,
                    ],
                )
                row = cur.fetchone()
                if row is None:
                    return _error(
                        "This monthly report was updated elsewhere. Reload it before submitting again.",
                        409,
                    )
                _record_monthly_report(row)

                # Keep the signature on the learner's own record when they ask,
                # so the next document they sign can offer it back. Best-effort:
                # the report itself is already signed and stored, and failing
                # the whole submit because this convenience could not be saved
                # would lose the learner's work.
                # The nested atomic() is a savepoint, so a failure here rolls
                # back only this update and leaves the stored report intact.
                if payload.get("saveSignature") and not admin_action:
                    try:
                        with transaction.atomic(using="enrolment"):
                            cur.execute(
                                f"""
                                update enrolment."Created_users"
                                   set "{SAVED_SIGNATURE_COLUMN}" = %s,
                                       "{SAVED_SIGNATURE_NAME_COLUMN}" = %s,
                                       "{SAVED_SIGNATURE_AT_COLUMN}" = now()
                                 where id::text = %s
                                """,
                                [signature, signed_name, str(pk)],
                            )
                    except DatabaseError:
                        logger.warning(
                            "Could not store the reusable signature for learner %s.", pk
                        )
    except DatabaseError:
        logger.exception("Could not save the learner monthly report.")
        return _error("Could not save your monthly report.", 502)

    return JsonResponse({"report": _row_to_report(row)}, status=201)


# Same-origin bytes for one attached document.
#
# The evidence download endpoint hands back a short-lived Azure SAS URL, which
# is fine for opening a file in a new tab but not for reading it with `fetch`:
# that is a cross-origin request, and whether it succeeds depends on the storage
# account's CORS rules, which differ per environment. Building the attachment
# into the downloaded report means reading its bytes in the browser, so they are
# served from this origin instead. Read-only, and gated on the same learner
# ownership as every other evidence read.
@learner_self_or_staff(kwarg="pk")
def monthly_report_attachment(request, kind, pk, file_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if kind not in VALID_KINDS:
        return _error("Unknown learner kind.", 400)
    if not azure_configured():
        return _error("Evidence storage is not configured.", 503)

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                """
                select blob_name, status, content_type, original_filename
                  from "Learner"."evidence_files"
                 where id = %s and learner_kind = %s and learner_id = %s
                """,
                [str(file_id), kind, str(pk)],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.exception("Could not look up a monthly report attachment.")
        return _error("Could not load the attachment.", 502)

    if not row:
        return _error("Attachment not found.", 404)

    blob_name, status, content_type, original_filename = row
    # Only ever from the approved container, and only once the scan has cleared
    # it — the same rule the evidence download enforces.
    if status != "approved":
        return _error("That file is not available yet.", 409)

    try:
        data = download_blob_bytes(settings.AZURE_APPROVED_CONTAINER, blob_name)
    except Exception:  # SDK / network errors
        logger.warning("Could not read attachment %s from storage.", file_id)
        return _error("Could not read the attachment from storage.", 502)

    response = HttpResponse(data, content_type=content_type or "application/octet-stream")
    # inline: the browser reads these bytes to draw the file into the report, it
    # is not a download the learner sees.
    response["Content-Disposition"] = f'inline; filename="{_text(original_filename) or "attachment"}"'
    return response
