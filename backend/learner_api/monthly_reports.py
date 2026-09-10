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
from django.views.decorators.csrf import csrf_exempt

from .evidence_storage import azure_configured, download_blob_bytes
from login.permissions import learner_self_only, learner_self_or_staff

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
# WRITE their own monthly report (POST, self-only); the owner OR staff may READ
# them (GET) - a coach reviews what the learner submitted.
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
            else:
                cur.execute(
                    f"""
                    select {SELECT_COLUMNS}
                      from "Learner".learner_monthly_reports
                     where learner_kind = %s and learner_id = %s
                     order by month_key desc
                    """,
                    [kind, str(pk)],
                )
            rows = cur.fetchall()
            # Offered so the wizard can pre-fill "use my saved signature"
            # instead of making the learner produce one every month.
            saved = _saved_signature(cur, pk)
    except DatabaseError:
        logger.exception("Could not load learner monthly reports.")
        return _error("Could not load the monthly reports.", 502)

    reports = [_row_to_report(row) for row in rows]
    if month_key:
        return JsonResponse(
            {
                "report": reports[0] if reports else None,
                "savedSignature": saved["signature"],
                "savedSignatureName": saved["name"],
            }
        )
    return JsonResponse(
        {
            "reports": reports,
            "savedSignature": saved["signature"],
            "savedSignatureName": saved["name"],
        }
    )


@learner_self_only(kwarg="pk")
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
                    insert into "Learner".learner_monthly_reports (
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
                    ],
                )
                row = cur.fetchone()

                # Keep the signature on the learner's own record when they ask,
                # so the next document they sign can offer it back. Best-effort:
                # the report itself is already signed and stored, and failing
                # the whole submit because this convenience could not be saved
                # would lose the learner's work.
                # The nested atomic() is a savepoint, so a failure here rolls
                # back only this update and leaves the stored report intact.
                if payload.get("saveSignature"):
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
