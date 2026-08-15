"""HTTP boundary for the Actual Hours review — HOURS-TEST mount only.

These views are registered in ``audit_api/clone_urls.py`` and nowhere else, so
the live ``/audit_api`` mount has no route to them. Each one additionally
asserts :func:`audit_api.db_source.is_clone`, so even a mis-registration cannot
point them at the live audit branch.

Scope is a server-side precondition: ``aptem_id`` and ``month`` are parsed and
validated before any query runs, and every write is keyed by a base row already
verified to be in that scope.
"""

from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from ..db_source import is_clone, resolve
from ..views import _has_audit_permission
from . import journal_hours, repository, rules, service
from .auth import resolve_auditor, resolve_journal_actor
from .holidays import load_calendar
from .service import ServiceError
from .tables import missing_tables


MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
CONNECTION_ALIAS = "audit"

# Timestamp semantics: enabled on the product owner's instruction (2026-08-15).
# Evidence behind the setting, for whoever reads this next:
#   * start_time/end_time are wall-clock `time` columns; the 09:00-17:00 bounds
#     are identical in BST and GMT months, so they are NOT UTC and behave as
#     Europe/London local time;
#   * the ingest pipeline is outside this repository, so that reading is
#     inferred from the data rather than proven from code.
# With this true, a time-stamped row whose stored hours differ from its genuine
# elapsed time produces a PENDING proposal (never a direct write). On the
# current data that is 0 of 26,896 rows — stored hours and elapsed time already
# agree everywhere — so this only affects future divergence.
TIMESTAMP_SEMANTICS_CONFIRMED = True


def _connection():
    from django.db import connections
    return connections[resolve(CONNECTION_ALIAS)]


_NOT_INSTALLED_MESSAGE = (
    "The Actual Hours review structures are not installed on this database. "
    "Run: manage.py setup_actual_hours_review"
)


def _not_installed(absent):
    return JsonResponse(
        {"error": _NOT_INSTALLED_MESSAGE, "code": "not_installed",
         "details": {"missing_tables": absent}},
        status=503,
    )


def _error(message, status=400, code=None, details=None):
    payload = {"error": message}
    if code:
        payload["code"] = code
    if details:
        payload["details"] = details
    return JsonResponse(payload, status=status)


def _guard(request, *, write=False, clone_only=True):
    """Permission gate shared by every endpoint here.

    ``clone_only`` keeps the Last_audit review (proposals, findings, analytics
    over ``Last_audit.activity_actual_hours``) on the HOURS-TEST clone. The
    Learner Journal's Activity-log calculation runs in both workspaces — the
    Automatic one against the live audit branch, HOURS-TEST against its clone —
    so those views pass ``clone_only=False`` and are registered on both mounts.
    Which database they touch is still decided by ``db_source.resolve()``, i.e.
    by the mount the request arrived on, never by anything in the request.
    """
    if clone_only and not is_clone():
        return _error("The Actual Hours review runs on the HOURS-TEST clone only.",
                      status=409, code="not_clone")
    if not _has_audit_permission(request, write=write):
        return _error("Authentication or audit permission is required.", status=403)
    return None


def _scope(request, body=None):
    source = body if body is not None else request.GET
    raw_aptem = str(source.get("aptem_id") or "").strip()
    month = str(source.get("month") or "").strip()
    if not raw_aptem.isdigit() or int(raw_aptem) <= 0:
        raise ServiceError("aptem_id (positive integer) is required.", status=400)
    if not MONTH_RE.match(month):
        raise ServiceError("month must be YYYY-MM.", status=400)
    return int(raw_aptem), month


def _decimal(value, field):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as error:
        raise ServiceError(f"{field} must be a number.", status=400) from error


def _body(request):
    try:
        parsed = json.loads(request.body or b"{}")
    except (TypeError, ValueError) as error:
        raise ServiceError("The request body must be JSON.", status=400) from error
    if not isinstance(parsed, dict):
        raise ServiceError("The request body must be a JSON object.", status=400)
    return parsed


def _serialise_row(row, calendar, findings_by_key, revisions_by_key):
    source = rules.source_category(row.get("reporting_method"), row.get("timestamp_label"))
    seconds = service._observed_seconds(row)
    classification = rules.classify(row.get("kind"), source, seconds, row.get("media_seconds"))
    key = (row["learner_id"], row["kind"], row["ref"])
    row_findings = findings_by_key.get(key, [])
    pending = next((item for item in revisions_by_key.get(key, []) if item["status"] == "pending"), None)
    return {
        "learner_id": row["learner_id"],
        "kind": row["kind"],
        "ref": row["ref"],
        "title": row.get("title"),
        "month": row.get("month"),
        "activity_date": row["activity_date"].isoformat() if row.get("activity_date") else None,
        "start_time": row["start_time"].isoformat() if row.get("start_time") else None,
        "end_time": row["end_time"].isoformat() if row.get("end_time") else None,
        "timestamp_label": row.get("timestamp_label"),
        "reporting_method": row.get("reporting_method"),
        "source_category": source,
        "active_actual_hours": str(row["actual_hours"]) if row.get("actual_hours") is not None else None,
        "observed_seconds": seconds,
        "media_duration_seconds": row.get("media_seconds"),
        "band": classification.band,
        "normal_min_seconds": classification.normal_min,
        "normal_max_seconds": classification.normal_max,
        "maximum_seconds": classification.maximum,
        "permitted_offsets_minutes": [
            offset // rules.MINUTE for offset in rules.permitted_media_offsets(row.get("media_seconds"))
        ] if row.get("kind") in rules.MEDIA_KINDS else [],
        "findings": [
            {"code": item["code"], "severity": item["severity"], "message": item["message"],
             "related_ref": item.get("related_ref")}
            for item in row_findings
        ],
        "blocking": any(item["severity"] == rules.SEVERITY_BLOCKING for item in row_findings),
        "pending_revision": None if not pending else {
            "revision_id": pending["revision_id"],
            "proposed_actual_hours": str(pending["proposed_actual_hours"]),
            "proposed_seconds": pending["proposed_seconds"],
            "calculation_type": pending["calculation_type"],
            "proposed_by": pending["proposed_by"],
            "proposed_at": pending["proposed_at"].isoformat() if pending.get("proposed_at") else None,
        },
        "history": [
            {"revision_id": item["revision_id"], "status": item["status"],
             "proposed_actual_hours": str(item["proposed_actual_hours"]),
             "previous_actual_hours": (str(item["previous_actual_hours"])
                                       if item.get("previous_actual_hours") is not None else None),
             "calculation_type": item["calculation_type"],
             "proposed_by": item["proposed_by"], "decided_by": item.get("decided_by"),
             "proposed_at": item["proposed_at"].isoformat() if item.get("proposed_at") else None,
             "decided_at": item["decided_at"].isoformat() if item.get("decided_at") else None}
            for item in revisions_by_key.get(key, [])
        ],
    }


def _analytics_payload(result):
    source = result["source"]
    tail = result["long_tail"]
    return {
        "source": {
            "eligible": source.eligible,
            "timestamped": source.timestamped,
            "input": source.input,
            "other": source.other,
            "expected_timestamped": source.expected_timestamped,
            "expected_input": source.expected_input,
            "exception_count": source.exception_count,
            "exception_rate": str(source.exception_rate) if source.exception_rate is not None else None,
            "threshold": str(rules.SOURCE_EXCEPTION_THRESHOLD),
            "status": source.status,
        },
        "long_tail": {
            "eligible": tail.eligible,
            "classifiable": tail.classifiable,
            "long_tail": tail.long_tail,
            "unclassifiable": tail.unclassifiable,
            "rate": str(tail.rate) if tail.rate is not None else None,
            "threshold": str(rules.LONG_TAIL_THRESHOLD),
            "status": tail.status,
        },
        "bands": result["counts"],
    }


@require_GET
def summary(request):
    """Read-only view of one learner's selected month, plus both analytics scopes."""
    blocked = _guard(request)
    if blocked:
        return blocked
    try:
        aptem_id, month = _scope(request)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)

    try:
        with _connection().cursor() as cursor:
            absent = missing_tables(cursor)
            if absent:
                return _not_installed(absent)
            rows = repository.scope_rows(cursor, aptem_id, month)
            years = {row["activity_date"].year for row in rows if row.get("activity_date")}
            calendar = load_calendar(cursor, years)
            findings_by_key: dict = {}
            for item in repository.active_findings(cursor, aptem_id, month):
                findings_by_key.setdefault((item["learner_id"], item["kind"], item["ref"]), []).append(item)
            revisions_by_key: dict = {}
            for item in repository.revisions(cursor, aptem_id, month):
                revisions_by_key.setdefault((item["learner_id"], item["kind"], item["ref"]), []).append(item)
            scope_analytics = repository.analytics(cursor, aptem_id, month)
            global_analytics = repository.analytics(cursor)
            unscoped = repository.unscoped_row_count(cursor)
    except DatabaseError as error:
        return _error("Could not read the Actual Hours review.", status=503, details={"error": str(error)})

    serialised = [_serialise_row(row, calendar, findings_by_key, revisions_by_key) for row in rows]
    pending_count = sum(1 for row in serialised if row["pending_revision"])
    return JsonResponse({
        "aptem_id": aptem_id,
        "month": month,
        "rule_version": rules.RULE_VERSION,
        "timestamp_semantics_confirmed": TIMESTAMP_SEMANTICS_CONFIRMED,
        "timezone": rules.WORKING_TIMEZONE,
        "rows": serialised,
        "counts": {
            "records_scanned": len(serialised),
            "timestamped": sum(1 for row in serialised if row["source_category"] == rules.SOURCE_TIMESTAMPED),
            "input": sum(1 for row in serialised if row["source_category"] == rules.SOURCE_INPUT),
            "other": sum(1 for row in serialised if row["source_category"] == rules.SOURCE_OTHER),
            "input_needing_entry": sum(1 for row in serialised
                                       if row["source_category"] == rules.SOURCE_INPUT
                                       and row["active_actual_hours"] is None),
            "pending_proposals": pending_count,
            "blocking": sum(1 for row in serialised
                            for finding in row["findings"] if finding["severity"] == rules.SEVERITY_BLOCKING),
            "warnings": sum(1 for row in serialised
                            for finding in row["findings"] if finding["severity"] == rules.SEVERITY_WARNING),
            "duplicates_and_overlaps": sum(1 for row in serialised for finding in row["findings"]
                                           if finding["code"] in {rules.CODE_DUPLICATE_INTERVAL,
                                                                  rules.CODE_OVERLAPPING_INTERVAL}),
            "long_tail": sum(1 for row in serialised if row["band"] == rules.BAND_LONG_TAIL),
            "unclassifiable": sum(1 for row in serialised if row["band"] == rules.BAND_UNCLASSIFIABLE),
        },
        "analytics": {
            "scope": _analytics_payload(scope_analytics),
            "global": _analytics_payload(global_analytics),
            "global_rows_without_learner_scope": unscoped,
        },
        "calendar_years_covered": sorted(calendar.covered_years),
    })


@csrf_exempt
@require_POST
def validate(request):
    """Validate and calculate for ONE learner and ONE month."""
    blocked = _guard(request, write=True)
    if blocked:
        return blocked
    try:
        body = _body(request)
        aptem_id, month = _scope(request, body)
        auditor = resolve_auditor(request)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)

    try:
        connection = _connection()
        with transaction.atomic(using=connection.alias):
            with connection.cursor() as cursor:
                absent = missing_tables(cursor)
                if absent:
                    return _not_installed(absent)
                result = service.run_scan(
                    cursor, aptem_id=aptem_id, month=month, auditor=auditor,
                    timestamp_semantics_confirmed=TIMESTAMP_SEMANTICS_CONFIRMED,
                )
    except ServiceError as error:
        return _error(error.message, error.status, error.code, error.details)
    except DatabaseError as error:
        return _error("The validation run could not be completed.", status=503,
                      details={"error": str(error)})

    return JsonResponse({"ok": True, "aptem_id": aptem_id, "month": month,
                         "actor": auditor.label, "summary": result})


@csrf_exempt
@require_POST
def propose(request):
    """Create a pending Input proposal. Never generates a value."""
    blocked = _guard(request, write=True)
    if blocked:
        return blocked
    try:
        body = _body(request)
        aptem_id, month = _scope(request, body)
        auditor = resolve_auditor(request)
        learner_id = int(body.get("learner_id"))
        kind = str(body.get("kind") or "").strip()
        ref = str(body.get("ref") or "").strip()
        seconds = int(_decimal(body.get("proposed_seconds"), "proposed_seconds"))
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    except (TypeError, ValueError):
        return _error("learner_id, kind, ref and proposed_seconds are required.", status=400)

    try:
        connection = _connection()
        with transaction.atomic(using=connection.alias):
            with connection.cursor() as cursor:
                absent = missing_tables(cursor)
                if absent:
                    return _not_installed(absent)
                result = service.create_input_proposal(
                    cursor, aptem_id=aptem_id, month=month, learner_id=learner_id,
                    kind=kind, ref=ref, seconds=seconds, actor=auditor,
                    comment=(body.get("comment") or None),
                )
    except ServiceError as error:
        return _error(error.message, error.status, error.code, error.details)
    except DatabaseError as error:
        return _error("The proposal could not be saved.", status=503, details={"error": str(error)})
    return JsonResponse(result)


def _decide(request, approve):
    blocked = _guard(request, write=True)
    if blocked:
        return blocked
    try:
        body = _body(request)
        auditor = resolve_auditor(request, approving=True)
        revision_id = int(body.get("revision_id"))
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    except (TypeError, ValueError):
        return _error("revision_id is required.", status=400)

    try:
        connection = _connection()
        with transaction.atomic(using=connection.alias):
            with connection.cursor() as cursor:
                absent = missing_tables(cursor)
                if absent:
                    return _not_installed(absent)
                action = service.approve if approve else service.reject
                result = action(cursor, revision_id=revision_id, actor=auditor,
                                comment=(body.get("comment") or None))
    except ServiceError as error:
        return _error(error.message, error.status, error.code, error.details)
    except DatabaseError as error:
        return _error("The decision could not be saved.", status=503, details={"error": str(error)})
    return JsonResponse(result)


@csrf_exempt
@require_POST
def approve(request):
    return _decide(request, approve=True)


@csrf_exempt
@require_POST
def reject(request):
    return _decide(request, approve=False)


# --- Learner Journal Activity-log hours -------------------------------------
# These act on the employee-arranged ledger rows the monthly report shows, not
# on Last_audit.activity_actual_hours. Same rules, same two-person approval.

@require_GET
def journal_summary(request):
    """Pending/decided calculated hours for the open learner and month."""
    blocked = _guard(request, clone_only=False)
    if blocked:
        return blocked
    try:
        aptem_id, month = _scope(request)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    try:
        with _connection().cursor() as cursor:
            if not journal_hours.journal_tables_present(cursor):
                return _not_installed(["manual_activity_hours_revision"])
            pending = journal_hours.pending(cursor, aptem_id, month)
            history = journal_hours.history(cursor, aptem_id, month)
    except DatabaseError as error:
        return _error("Could not read the calculated hours.", status=503,
                      details={"error": str(error)})
    return JsonResponse({
        "aptem_id": aptem_id,
        "month": month,
        "permitted_offsets_minutes": list(rules.PERMITTED_OFFSET_MINUTES),
        "offset_modes": list(journal_hours.OFFSET_MODES),
        "reading_quiz_reference_minutes": rules.READING_QUIZ_REFERENCE_SECONDS // rules.MINUTE,
        "pending": [
            {"revision_id": item["revision_id"], "row_id": item["row_id"],
             "category": item["category"], "offset_minutes": item["offset_minutes"],
             "offset_mode": item["offset_mode"],
             "previous_planned_hours": (str(item["previous_planned_hours"])
                                        if item["previous_planned_hours"] is not None else None),
             "proposed_planned_hours": (str(item["proposed_planned_hours"])
                                        if item["proposed_planned_hours"] is not None else None),
             "planned_basis": item["planned_basis"],
             "previous_actual_hours": (str(item["previous_actual_hours"])
                                       if item["previous_actual_hours"] is not None else None),
             "proposed_actual_hours": str(item["proposed_actual_hours"]),
             "proposed_seconds": item["proposed_seconds"],
             "basis": item["basis"], "proposed_by": item["proposed_by"],
             "proposed_at": item["proposed_at"].isoformat() if item["proposed_at"] else None}
            for item in pending
        ],
        "history": [
            {"revision_id": item["revision_id"], "row_id": item["row_id"], "status": item["status"],
             "previous_actual_hours": (str(item["previous_actual_hours"])
                                       if item["previous_actual_hours"] is not None else None),
             "proposed_actual_hours": str(item["proposed_actual_hours"]),
             "basis": item["basis"], "offset_minutes": item["offset_minutes"],
             "proposed_by": item["proposed_by"], "decided_by": item["decided_by"],
             "decided_at": item["decided_at"].isoformat() if item["decided_at"] else None}
            for item in history
        ],
    })


@csrf_exempt
@require_POST
def journal_calculate(request):
    """Calculate actual/planned hours for this learner-month's Activity log."""
    blocked = _guard(request, write=True, clone_only=False)
    if blocked:
        return blocked
    try:
        body = _body(request)
        aptem_id, month = _scope(request, body)
        # Validated before any query runs: an unusable offset must not reach the
        # database at all.
        offset_minutes = journal_hours.validate_offset_minutes(body.get("offset_minutes"))
        offset_mode = journal_hours.validate_offset_mode(body.get("offset_mode"))
        fields = journal_hours.validate_fields(body.get("fields"))
        auditor = resolve_journal_actor(request)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    try:
        connection = _connection()
        with transaction.atomic(using=connection.alias):
            with connection.cursor() as cursor:
                if not journal_hours.journal_tables_present(cursor):
                    return _not_installed(["manual_activity_hours_revision"])
                result = journal_hours.calculate(
                    cursor, aptem_id=aptem_id, month=month, actor=auditor,
                    offset_minutes=offset_minutes, offset_mode=offset_mode,
                    fields=fields,
                )
    except ServiceError as error:
        return _error(error.message, error.status, error.code, error.details)
    except DatabaseError as error:
        return _error("The calculation could not be saved.", status=503, details={"error": str(error)})
    return JsonResponse({"ok": True, "aptem_id": aptem_id, "month": month,
                         "actor": auditor.label, "summary": result})


def _journal_decide(request, approve):
    blocked = _guard(request, write=True, clone_only=False)
    if blocked:
        return blocked
    try:
        body = _body(request)
        aptem_id, month = _scope(request, body)
        auditor = resolve_journal_actor(request, approving=True)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    revision_ids = body.get("revision_ids") or None
    try:
        connection = _connection()
        with transaction.atomic(using=connection.alias):
            with connection.cursor() as cursor:
                if not journal_hours.journal_tables_present(cursor):
                    return _not_installed(["manual_activity_hours_revision"])
                result = journal_hours.decide(
                    cursor, aptem_id=aptem_id, month=month, actor=auditor, approve=approve,
                    revision_ids=revision_ids, comment=(body.get("comment") or None),
                )
    except ServiceError as error:
        return _error(error.message, error.status, error.code, error.details)
    except DatabaseError as error:
        return _error("The decision could not be saved.", status=503, details={"error": str(error)})
    return JsonResponse(result)


@csrf_exempt
@require_POST
def journal_approve(request):
    return _journal_decide(request, approve=True)


@csrf_exempt
@require_POST
def journal_reject(request):
    return _journal_decide(request, approve=False)


@require_GET
def analytics(request):
    """Read-only analytics. Never writes, in either scope."""
    blocked = _guard(request)
    if blocked:
        return blocked
    aptem_id = request.GET.get("aptem_id")
    month = request.GET.get("month")
    scope_result = None
    try:
        with _connection().cursor() as cursor:
            if aptem_id and month:
                parsed_aptem, parsed_month = _scope(request)
                scope_result = _analytics_payload(repository.analytics(cursor, parsed_aptem, parsed_month))
            global_result = _analytics_payload(repository.analytics(cursor))
            unscoped = repository.unscoped_row_count(cursor)
    except ServiceError as error:
        return _error(error.message, error.status, error.code)
    except DatabaseError as error:
        return _error("Could not read the analytics.", status=503, details={"error": str(error)})
    return JsonResponse({"scope": scope_result, "global": global_result,
                         "global_rows_without_learner_scope": unscoped})
