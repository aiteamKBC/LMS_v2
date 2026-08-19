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

import datetime
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

# Auditor edits live in OUR schema — the fetch-service mirror stays read-only.
# An override row changes what the explorer (and transfers) DISPLAY; a
# replacement row supersedes the shown file while the Aptem original stays
# archived and viewable (part=original).
EVIDENCE_OVERRIDES = '"structured_manual_activities"."evidence_overrides"'
EVIDENCE_REPLACEMENTS = '"structured_manual_activities"."evidence_replacements"'
REPLACEMENT_CONTAINER = "evidence-replacements"

_OVERRIDE_TABLES_READY = False


def ensure_override_tables(cursor):
    global _OVERRIDE_TABLES_READY
    if _OVERRIDE_TABLES_READY:
        return
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {EVIDENCE_OVERRIDES} (
            evidence_id   bigint PRIMARY KEY,
            aptem_id      bigint NOT NULL,
            display_name  text,
            category      text,
            evidence_date date,
            updated_by    text,
            updated_at    timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS {EVIDENCE_REPLACEMENTS} (
            id            bigserial PRIMARY KEY,
            evidence_id   bigint NOT NULL,
            aptem_id      bigint NOT NULL,
            container     text   NOT NULL,
            blob_name     text   NOT NULL,
            display_name  text   NOT NULL,
            content_type  text,
            size_bytes    bigint,
            uploaded_by   text,
            uploaded_at   timestamptz NOT NULL DEFAULT now(),
            archived_at   timestamptz
        );
        CREATE INDEX IF NOT EXISTS evidence_replacements_active_idx
            ON {EVIDENCE_REPLACEMENTS} (evidence_id) WHERE archived_at IS NULL;
        """
    )
    _OVERRIDE_TABLES_READY = True


# The LATERAL join both list and transfer use: the newest non-archived upload.
_ACTIVE_REPLACEMENT_JOIN = f"""
    LEFT JOIN LATERAL (
        SELECT rp.id, rp.container, rp.blob_name, rp.display_name, rp.uploaded_at
        FROM {EVIDENCE_REPLACEMENTS} rp
        WHERE rp.evidence_id = e.evidence_id AND rp.archived_at IS NULL
        ORDER BY rp.uploaded_at DESC, rp.id DESC
        LIMIT 1
    ) r ON true
"""

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
        # The auditor's edited date wins the month bucketing too.
        conditions.append(
            "to_char(coalesce(o.evidence_date, e.completed_date, e.submission_date, e.created_date), 'YYYY-MM') = %s"
        )
        params.append(month)
    try:
        with _connection().cursor() as cursor:
            ensure_classification_table(cursor)
            ensure_override_tables(cursor)
            cursor.execute(
                f"""
                SELECT e.evidence_id, e.evidence_name, e.evidence_kind, e.evidence_status,
                       e.hours_type, e.spent_time, e.component_id, e.component_name,
                       coalesce(o.evidence_date, e.completed_date, e.submission_date, e.created_date) AS evidence_date,
                       e.file_blob, e.report_blob,
                       left(coalesce(e.note_content, ''), 240) AS note_preview,
                       e.evidence_type, e.needs_manual_review,
                       c.category AS content_category, c.confidence AS content_confidence,
                       c.mismatch AS content_mismatch, c.reason AS content_reason,
                       c.review_status,
                       o.display_name AS override_name, o.category AS override_category,
                       o.evidence_date AS override_date,
                       r.display_name AS replacement_name, r.uploaded_at AS replacement_uploaded_at,
                       (SELECT m.month FROM {MANUAL_ROWS} m
                         WHERE m.aptem_id = e.learner_id AND m.deleted_at IS NULL
                           AND (m.source_ref = 'ev:' || e.evidence_id
                                OR (e.component_id IS NOT NULL AND m.source_ref = 'asg:' || e.component_id))
                         LIMIT 1) AS report_month
                FROM {EVIDENCE_ITEMS} e
                LEFT JOIN {CLASSIFICATIONS} c ON c.evidence_id = e.evidence_id
                LEFT JOIN {EVIDENCE_OVERRIDES} o ON o.evidence_id = e.evidence_id
                {_ACTIVE_REPLACEMENT_JOIN}
                WHERE {' AND '.join(conditions)}
                ORDER BY coalesce(o.evidence_date, e.completed_date, e.submission_date, e.created_date) DESC NULLS LAST,
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
        override_category = str(row.get("override_category") or "").strip().lower()
        if override_category in CATEGORIES:
            # The auditor's explicit edit outranks every classifier tier.
            category, source, needs_review = override_category, "edited", False
            content_classified += 1
        elif review_status == "rejected" and content_category:
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
        replaced = bool(row.get("replacement_name"))
        edited = any(row.get(key) is not None for key in ("override_name", "override_category", "override_date"))
        items.append({
            "evidence_id": int(row["evidence_id"]),
            "name": row.get("override_name") or row.get("evidence_name") or f"Evidence {row['evidence_id']}",
            "edited": edited,
            "replaced": replaced,
            "replacement_name": row.get("replacement_name"),
            "original_has_file": bool(row.get("file_blob")),
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
            "has_file": bool(row.get("file_blob")) or replaced,
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
    if part not in {"file", "report", "original"}:
        return JsonResponse({"error": "part must be 'file', 'report' or 'original'"}, status=400)
    try:
        with _connection().cursor() as cursor:
            ensure_override_tables(cursor)
            cursor.execute(
                f"""
                SELECT e.evidence_id, e.evidence_name, e.file_blob, e.report_blob,
                       o.display_name AS override_name,
                       r.container AS replacement_container,
                       r.blob_name AS replacement_blob,
                       r.display_name AS replacement_name
                FROM {EVIDENCE_ITEMS} e
                LEFT JOIN {EVIDENCE_OVERRIDES} o ON o.evidence_id = e.evidence_id
                {_ACTIVE_REPLACEMENT_JOIN}
                WHERE e.evidence_id = %s
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
    name = row.get("override_name") or row.get("evidence_name") or f"Evidence {evidence_id}"
    # part=file serves the auditor's replacement when one is active; the Aptem
    # original stays reachable as part=original.
    container = "fetch-aptem-evidences"
    if part == "report":
        blob = row.get("report_blob")
    elif part == "file" and row.get("replacement_blob"):
        container = row.get("replacement_container") or REPLACEMENT_CONTAINER
        blob = row.get("replacement_blob")
        name = row.get("replacement_name") or name
    else:
        blob = row.get("file_blob")
    if not blob:
        return JsonResponse({"error": f"This evidence has no {part}."}, status=404)
    url = None
    if evidence_storage.azure_configured():
        try:
            url = evidence_storage.get_read_sas(container, blob)
        except Exception:
            url = None
    if not url:
        return JsonResponse({"error": "The document store is not reachable."}, status=503)
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


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@csrf_exempt
def evidence_edit(request: HttpRequest) -> JsonResponse:
    """Auditor edit of one evidence row's display name, category or date.
    Stored as an override in OUR schema; sending an empty value clears that
    field's override so the source value shows again."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        body = json.loads(request.body or b"{}")
        evidence_id = int(body.get("evidence_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "evidence_id (int) is required"}, status=400)

    updates = {}
    if "display_name" in body:
        updates["display_name"] = str(body.get("display_name") or "").strip()[:500] or None
    if "category" in body:
        category = str(body.get("category") or "").strip().lower()
        if category and category not in CATEGORIES:
            return JsonResponse({"error": f"category must be one of {', '.join(CATEGORIES)}"}, status=400)
        updates["category"] = category or None
    if "evidence_date" in body:
        date_value = str(body.get("evidence_date") or "").strip()
        if date_value and not _DATE_RE.match(date_value):
            return JsonResponse({"error": "evidence_date must be YYYY-MM-DD"}, status=400)
        updates["evidence_date"] = date_value or None
    if not updates:
        return JsonResponse({"error": "Nothing to update — send display_name, category or evidence_date."}, status=400)
    actor = str(body.get("updated_by") or "").strip()[:100] or "evidence-edit"

    try:
        with _connection().cursor() as cursor:
            ensure_override_tables(cursor)
            cursor.execute(
                f"SELECT learner_id FROM {EVIDENCE_ITEMS} WHERE evidence_id = %s LIMIT 1",
                [evidence_id],
            )
            found = cursor.fetchall()
            if not found:
                return JsonResponse({"error": f"no evidence {evidence_id}"}, status=404)
            aptem_id = int(found[0][0])
            assignments = ", ".join(f"{field} = %s" for field in updates)
            cursor.execute(
                f"""
                INSERT INTO {EVIDENCE_OVERRIDES} (evidence_id, aptem_id, {', '.join(updates)}, updated_by)
                VALUES (%s, %s, {', '.join(['%s'] * len(updates))}, %s)
                ON CONFLICT (evidence_id)
                DO UPDATE SET {assignments}, updated_by = %s, updated_at = now()
                """,
                [evidence_id, aptem_id, *updates.values(), actor, *updates.values(), actor],
            )
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not save the edit.", "details": str(error)},
            status=503,
        )
    return JsonResponse({"ok": True, "evidence_id": evidence_id, **updates})


def _safe_filename(name):
    cleaned = re.sub(r"[^A-Za-z0-9._()\- ]+", "_", str(name or "upload")).strip() or "upload"
    return cleaned[:150]


@csrf_exempt
def evidence_replace(request: HttpRequest) -> JsonResponse:
    """Upload a file that supersedes the shown evidence file. The Aptem
    original in Azure is never touched — it stays viewable as part=original —
    and earlier replacements are archived, so every version is kept."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        evidence_id = int(request.POST.get("evidence_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "evidence_id (int) is required"}, status=400)
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"error": "file is required"}, status=400)
    if not evidence_storage.azure_configured():
        return JsonResponse({"error": "The document store is not configured."}, status=503)
    actor = str(request.POST.get("uploaded_by") or "").strip()[:100] or "evidence-replace"

    try:
        with _connection().cursor() as cursor:
            ensure_override_tables(cursor)
            cursor.execute(
                f"SELECT learner_id FROM {EVIDENCE_ITEMS} WHERE evidence_id = %s LIMIT 1",
                [evidence_id],
            )
            found = cursor.fetchall()
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read the evidence item.", "details": str(error)},
            status=503,
        )
    if not found:
        return JsonResponse({"error": f"no evidence {evidence_id}"}, status=404)
    aptem_id = int(found[0][0])

    display_name = _safe_filename(upload.name)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S")
    blob_name = f"{aptem_id}/{evidence_id}/{stamp}-{display_name}"
    try:
        try:
            evidence_storage._service_client().create_container(REPLACEMENT_CONTAINER)
        except Exception:
            pass  # already exists
        evidence_storage.upload_blob(
            upload, REPLACEMENT_CONTAINER, blob_name,
            upload.content_type or "application/octet-stream",
        )
    except Exception as error:
        return JsonResponse({"error": "Azure upload failed.", "details": str(error)}, status=502)

    try:
        with _connection().cursor() as cursor:
            cursor.execute(
                f"UPDATE {EVIDENCE_REPLACEMENTS} SET archived_at = now() "
                f"WHERE evidence_id = %s AND archived_at IS NULL",
                [evidence_id],
            )
            cursor.execute(
                f"""
                INSERT INTO {EVIDENCE_REPLACEMENTS} (
                    evidence_id, aptem_id, container, blob_name,
                    display_name, content_type, size_bytes, uploaded_by
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, uploaded_at
                """,
                [
                    evidence_id, aptem_id, REPLACEMENT_CONTAINER, blob_name,
                    display_name, upload.content_type or "application/octet-stream",
                    upload.size, actor,
                ],
            )
            created = cursor.fetchall()
    except DatabaseError as error:
        try:  # keep storage tidy if the record could not be written
            evidence_storage.delete_blob(REPLACEMENT_CONTAINER, blob_name)
        except Exception:
            pass
        return JsonResponse(
            {"error": "Could not record the replacement.", "details": str(error)},
            status=503,
        )
    return JsonResponse({
        "ok": True,
        "evidence_id": evidence_id,
        "replacement_id": int(created[0][0]),
        "replacement_name": display_name,
        "uploaded_at": created[0][1].isoformat(),
    }, status=201)


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
            ensure_override_tables(cursor)
            cursor.execute(
                f"""
                SELECT e.evidence_id, e.learner_id, e.evidence_name, e.evidence_status,
                       e.spent_time, e.file_blob, e.report_blob,
                       coalesce(o.evidence_date, e.completed_date, e.submission_date, e.created_date) AS evidence_date,
                       o.display_name AS override_name,
                       r.container AS replacement_container,
                       r.blob_name AS replacement_blob,
                       r.display_name AS replacement_name
                FROM {EVIDENCE_ITEMS} e
                LEFT JOIN {EVIDENCE_OVERRIDES} o ON o.evidence_id = e.evidence_id
                {_ACTIVE_REPLACEMENT_JOIN}
                WHERE e.evidence_id = %s
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
            name = (item.get("override_name") or item.get("evidence_name") or f"Evidence {evidence_id}")[:500]
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
            # An active replacement supersedes the original submission file.
            if item.get("replacement_blob"):
                file_doc = (
                    item.get("replacement_container") or REPLACEMENT_CONTAINER,
                    item.get("replacement_blob"),
                    item.get("replacement_name") or name,
                )
            else:
                file_doc = ("fetch-aptem-evidences", item.get("file_blob"), name)
            for container, blob, label in (
                file_doc,
                ("fetch-aptem-evidences", item.get("report_blob"),
                 _report_display_name(name, item.get("report_blob"))),
            ):
                if not blob:
                    continue
                cursor.execute(
                    f"""
                    INSERT INTO {MANUAL_DOCS} (
                        manual_activity_id, aptem_id, month, container,
                        blob_name, display_name, uploaded_by
                    )
                    SELECT %s, %s, %s, %s, %s, %s, %s
                    WHERE NOT EXISTS (
                        SELECT 1 FROM {MANUAL_DOCS}
                        WHERE manual_activity_id = %s AND blob_name = %s AND deleted_at IS NULL
                    )
                    """,
                    [row_id, aptem_id, month, container, blob, label[:200], actor, row_id, blob],
                )
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not transfer the evidence.", "details": str(error)},
            status=503,
        )
    return JsonResponse({"ok": True, "already": False, "month": month, "row_id": row_id})
