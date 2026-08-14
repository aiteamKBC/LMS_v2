"""Learner evidence explorer for the auditor-copy workspace.

Every file/note a learner ever uploaded to Aptem — mirrored to Azure by the
fetch service and indexed in ``fetching_evidence.evidence_items`` — listed,
CLASSIFIED and previewable inside the system.

Classification is deliberately tiered and deterministic:

  Tier 1 — the Aptem component the evidence was filed under names its own
           kind ("… - Assignment", "… - Attendance", "Progress Review", …).
           Measured coverage on the live data: ~89.5% of 48,826 items.
  Tier 2 — extra signals (evidence file name, hours type, evidence kind)
           resolve most of the remainder to ~95%+.
  Tier 3 — anything still unresolved is reported as "other" with
           needs_review=True so the (already provisioned) AI audit pipeline
           or a human can pick it up. Nothing here writes to the fetch
           service's tables — classification happens per request.
"""

import json
import re

from django.db import DatabaseError
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from learner_api import evidence_storage

from .evidence_classifier import CLASSIFICATIONS, classify_by_hints, ensure_classification_table
from .last_audit_ledger_views import _connection, _dict_rows
from .manual_ledger_views import (
    MANUAL_DOCS,
    MANUAL_ROWS,
    _ensure_manual_tables,
    _load_learner,
    _month_is_signed_off,
    _report_display_name,
)

EVIDENCE_ITEMS = '"fetching_evidence"."evidence_items"'

# Display order also encodes precedence for reporting.
CATEGORIES = (
    "assignment",
    "attendance_reflection",
    "lms_activity",
    "review",
    "work_product",
    "administrative",
    "other",
)

def _minutes(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@require_GET
def evidence_list(request: HttpRequest) -> JsonResponse:
    """One learner's complete Aptem evidence, classified, month-filterable."""
    try:
        aptem_id = int(request.GET.get("aptem_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "aptem_id (int) is required"}, status=400)
    month = str(request.GET.get("month") or "").strip()

    conditions = ["learner_id = %s"]
    params = [aptem_id]
    if month:
        conditions.append(
            "to_char(coalesce(completed_date, submission_date, created_date), 'YYYY-MM') = %s"
        )
        params.append(month)
    try:
        with _connection().cursor() as cursor:
            ensure_classification_table(cursor)
            cursor.execute(
                f"""
                SELECT e.evidence_id, e.evidence_name, e.evidence_kind, e.evidence_status,
                       e.hours_type, e.spent_time, e.component_id, e.component_name,
                       coalesce(e.completed_date, e.submission_date, e.created_date) AS evidence_date,
                       e.file_blob, e.report_blob,
                       left(coalesce(e.note_content, ''), 240) AS note_preview,
                       e.evidence_type, e.needs_manual_review,
                       c.category AS content_category, c.confidence AS content_confidence,
                       c.mismatch AS content_mismatch, c.reason AS content_reason,
                       c.review_status,
                       (SELECT m.month FROM {MANUAL_ROWS} m
                         WHERE m.aptem_id = e.learner_id AND m.deleted_at IS NULL
                           AND (m.source_ref = 'ev:' || e.evidence_id
                                OR (e.component_id IS NOT NULL AND m.source_ref = 'asg:' || e.component_id))
                         LIMIT 1) AS report_month
                FROM {EVIDENCE_ITEMS} e
                LEFT JOIN {CLASSIFICATIONS} c ON c.evidence_id = e.evidence_id
                WHERE {' AND '.join(conditions)}
                ORDER BY coalesce(e.completed_date, e.submission_date, e.created_date) DESC NULLS LAST,
                         e.evidence_id DESC
                """,
                params,
            )
            rows = _dict_rows(cursor)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read the learner's evidence.", "details": str(error)},
            status=503,
        )

    items = []
    counts = {category: 0 for category in CATEGORIES}
    content_classified = 0
    misfiled = 0
    for row in rows:
        # Learners upload into the wrong slot often enough that the component
        # name cannot be trusted — the CONTENT classifier's verdict wins.
        # Anything it has not reached yet gets a PROVISIONAL hint (slot/name
        # rules, flagged needs_review) until the classifier catches up.
        mismatch = False
        # What the SLOT says the item is — shown next to the content verdict
        # so the auditor sees "uploaded as X / classified as Y" at a glance.
        slot_category = classify_by_hints(row.get("component_name"), "", None, None)[0]
        review_status = str(row.get("review_status") or "") or None
        content_category = str(row.get("content_category") or "").strip().lower()
        ai_type = str(row.get("evidence_type") or "").strip().lower()
        if review_status == "rejected" and content_category:
            # The auditor overruled the model — the slot's own category stands.
            category, source, needs_review = slot_category, "reviewed-reverted", False
            content_classified += 1
        elif content_category in CATEGORIES:
            category, source = content_category, "content"
            mismatch = bool(row.get("content_mismatch"))
            needs_review = mismatch and review_status != "confirmed"
            content_classified += 1
        elif ai_type in CATEGORIES or ai_type in {"quiz_result", "reflection"}:
            category = {"quiz_result": "lms_activity", "reflection": "attendance_reflection"}.get(ai_type, ai_type)
            source, needs_review = "ai", bool(row.get("needs_manual_review"))
            content_classified += 1
        else:
            category, source, needs_review = classify_by_hints(
                row.get("component_name"), row.get("evidence_name"),
                row.get("hours_type"), row.get("evidence_kind"),
            )
            source = f"hint-{source}" if source != "unresolved" else "unresolved"
            needs_review = True
        misfiled += 1 if mismatch else 0
        counts[category] += 1
        evidence_date = row.get("evidence_date")
        minutes = _minutes(row.get("spent_time"))
        items.append({
            "evidence_id": int(row["evidence_id"]),
            "name": row.get("evidence_name") or f"Evidence {row['evidence_id']}",
            "kind": row.get("evidence_kind") or "File",
            "status": row.get("evidence_status") or "",
            "category": category,
            "category_source": source,
            "confidence": float(row["content_confidence"]) if row.get("content_confidence") is not None else None,
            "mismatch": mismatch,
            "mismatch_reason": (row.get("content_reason") or "").strip() or None if mismatch else None,
            "needs_review": needs_review,
            "slot_category": slot_category,
            "review_status": review_status,
            "report_month": row.get("report_month"),
            "component_id": int(row["component_id"]) if row.get("component_id") is not None else None,
            "component_name": row.get("component_name") or "",
            "date": evidence_date.isoformat()[:10] if evidence_date else None,
            "otjh_hours": round(minutes / 60, 2) if minutes else 0.0,
            "has_file": bool(row.get("file_blob")),
            "has_report": bool(row.get("report_blob")),
            "note_preview": (row.get("note_preview") or "").strip() or None,
        })

    return JsonResponse({
        "aptem_id": aptem_id,
        "month": month or None,
        "total": len(items),
        "counts": counts,
        "content_classified": content_classified,
        "misfiled": misfiled,
        "items": items,
    })


@require_GET
def evidence_open(request: HttpRequest) -> JsonResponse:
    """A short-lived read URL for one evidence blob (submission or assessor
    report), for the in-system /doc preview page."""
    try:
        evidence_id = int(request.GET.get("id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "id (int) is required"}, status=400)
    part = str(request.GET.get("part") or "file").strip().lower()
    if part not in {"file", "report"}:
        return JsonResponse({"error": "part must be 'file' or 'report'"}, status=400)
    try:
        with _connection().cursor() as cursor:
            cursor.execute(
                f"""
                SELECT evidence_id, evidence_name, file_blob, report_blob
                FROM {EVIDENCE_ITEMS} WHERE evidence_id = %s
                LIMIT 1
                """,
                [evidence_id],
            )
            found = _dict_rows(cursor)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read the evidence item.", "details": str(error)},
            status=503,
        )
    if not found:
        return JsonResponse({"error": f"no evidence {evidence_id}"}, status=404)
    row = found[0]
    blob = row.get("report_blob") if part == "report" else row.get("file_blob")
    if not blob:
        return JsonResponse({"error": f"This evidence has no {part}."}, status=404)
    url = None
    if evidence_storage.azure_configured():
        try:
            url = evidence_storage.get_read_sas("fetch-aptem-evidences", blob)
        except Exception:
            url = None
    if not url:
        return JsonResponse({"error": "The document store is not reachable."}, status=503)
    name = row.get("evidence_name") or f"Evidence {evidence_id}"
    if part == "report":
        name = _report_display_name(name, blob)
    return JsonResponse({"id": evidence_id, "name": name, "content_type": None, "url": url})


@csrf_exempt
def evidence_review(request: HttpRequest) -> JsonResponse:
    """The auditor's verdict on one classification: confirm the model's
    category, or reject it (the slot's own category stands again)."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        body = json.loads(request.body or b"{}")
        evidence_id = int(body.get("evidence_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "evidence_id (int) is required"}, status=400)
    action = str(body.get("action") or "").strip().lower()
    if action not in {"confirm", "reject"}:
        return JsonResponse({"error": "action must be 'confirm' or 'reject'"}, status=400)
    try:
        with _connection().cursor() as cursor:
            ensure_classification_table(cursor)
            cursor.execute(
                f"""
                UPDATE {CLASSIFICATIONS}
                SET review_status = %s, reviewed_at = now(),
                    mismatch = CASE WHEN %s = 'reject' THEN false ELSE mismatch END
                WHERE evidence_id = %s
                RETURNING evidence_id
                """,
                ["confirmed" if action == "confirm" else "rejected", action, evidence_id],
            )
            updated = cursor.fetchall()
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not save the review.", "details": str(error)},
            status=503,
        )
    if not updated:
        return JsonResponse({"error": f"Evidence {evidence_id} has no classification to review."}, status=404)
    return JsonResponse({"ok": True, "evidence_id": evidence_id, "review_status": "confirmed" if action == "confirm" else "rejected"})


@csrf_exempt
def evidence_transfer(request: HttpRequest) -> JsonResponse:
    """File one evidence item onto the learner's monthly report as a
    document-backed activity row (assignment category, so its files show),
    with the evidenced OTJH time as the actual hours. Idempotent via the
    ``ev:<evidence_id>`` source ref."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        body = json.loads(request.body or b"{}")
        evidence_id = int(body.get("evidence_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "evidence_id (int) is required"}, status=400)
    actor = str(body.get("created_by") or "").strip()[:100] or "evidence-transfer"
    try:
        with _connection().cursor() as cursor:
            ensure_classification_table(cursor)
            _ensure_manual_tables(cursor)
            cursor.execute(
                f"""
                SELECT e.evidence_id, e.learner_id, e.evidence_name, e.evidence_status,
                       e.spent_time, e.file_blob, e.report_blob,
                       coalesce(e.completed_date, e.submission_date, e.created_date) AS evidence_date
                FROM {EVIDENCE_ITEMS} e WHERE e.evidence_id = %s
                """,
                [evidence_id],
            )
            found = _dict_rows(cursor)
            if not found:
                return JsonResponse({"error": f"no evidence {evidence_id}"}, status=404)
            item = found[0]
            aptem_id = int(item["learner_id"])
            evidence_date = item.get("evidence_date")
            if not evidence_date:
                return JsonResponse({"error": "This evidence has no date, so it cannot be placed in a month."}, status=400)
            month = evidence_date.isoformat()[:7]
            if _month_is_signed_off(aptem_id, month):
                return JsonResponse({"error": f"{month} is signed off — remove the signatures first."}, status=409)
            learner = _load_learner(cursor, aptem_id)
            minutes = float(item.get("spent_time") or 0)
            actual_hours = round(min(50.0, max(0.0, minutes / 60)), 2)
            name = (item.get("evidence_name") or f"Evidence {evidence_id}")[:500]
            accepted_status = str(item.get("evidence_status") or "").lower() == "accepted"
            cursor.execute(
                f"""
                INSERT INTO {MANUAL_ROWS} (
                    aptem_id, learner_id, month, category, source_ref,
                    group_id, activity_id, title, activity_date,
                    planned_hours, actual_hours, timestamp_label,
                    completion_note, accepted, created_by
                ) VALUES (%s, %s, %s, 'assignment', %s, NULL, NULL, %s, %s, 0, %s, 'input', %s, true, %s)
                ON CONFLICT (aptem_id, month, source_ref)
                    WHERE deleted_at IS NULL AND source_ref IS NOT NULL
                    DO NOTHING
                RETURNING id
                """,
                [
                    aptem_id, (learner or {}).get("learner_id"), month, f"ev:{evidence_id}",
                    name, evidence_date.isoformat()[:10], actual_hours,
                    "completed" if accepted_status else None, actor,
                ],
            )
            inserted = cursor.fetchall()
            if not inserted:
                return JsonResponse({"ok": True, "already": True, "month": month})
            row_id = int(inserted[0][0])
            # Attach the evidence file + assessor report so the row previews.
            for blob, label in (
                (item.get("file_blob"), name),
                (item.get("report_blob"), _report_display_name(name, item.get("report_blob"))),
            ):
                if not blob:
                    continue
                cursor.execute(
                    f"""
                    INSERT INTO {MANUAL_DOCS} (
                        manual_activity_id, aptem_id, month, container,
                        blob_name, display_name, uploaded_by
                    )
                    SELECT %s, %s, %s, 'fetch-aptem-evidences', %s, %s, %s
                    WHERE NOT EXISTS (
                        SELECT 1 FROM {MANUAL_DOCS}
                        WHERE manual_activity_id = %s AND blob_name = %s AND deleted_at IS NULL
                    )
                    """,
                    [row_id, aptem_id, month, blob, label[:200], actor, row_id, blob],
                )
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not transfer the evidence.", "details": str(error)},
            status=503,
        )
    return JsonResponse({"ok": True, "already": False, "month": month, "row_id": row_id})
