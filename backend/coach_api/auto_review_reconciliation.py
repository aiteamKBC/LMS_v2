"""Explicit operator batch policy; never imported by a page, importer or GET.

Dates define an approved business window, not historical identity evidence.
All writes go through review_reconciliation.apply, one atomic pair at a time.
"""
from collections import Counter, defaultdict
from datetime import date, datetime
import json

from django.db import connection, DatabaseError
from django.utils import timezone
from config.management_safety import read_only_databases

from . import reconciliation_links as links, review_reconciliation as canonical
from .migrated_reviews import review_family
from .models import CoachCalendarEvent, ImportedReviewInstance
from .reconciliation_schema import reconciliation_schema_available, require_reconciliation_schema
from .review_sources import ReviewIdentityConflict, linked_booking, source_for_learner


RULE_VERSION = "single_candidate_month_union_v1"
PROVENANCE = "BUSINESS_RULE_SINGLE_CANDIDATE"
REPORT_COLUMNS = (
    "learner_internal_id", "effective_aptem_id", "native_instance_id", "calendar_event_id",
    "native_status", "candidate_count", "selected_source_review_id", "selected_aptem_review_id",
    "selected_source_planned_date", "selected_source_status", "existing_imported_calendar_id",
    "existing_overlay_id", "source_already_selected_elsewhere", "identity_preservable",
    "classification", "block_reason", "rule_version",
)


def month(value):
    """Use the saved calendar date, never the machine's timezone or today's date."""
    if isinstance(value, (date, datetime)):
        return value.year, value.month
    if value:
        try:
            parsed = date.fromisoformat(str(value)[:10])
            return parsed.year, parsed.month
        except ValueError:
            pass
    return None


def candidate_window(instance, record, sources):
    months = {month(value) for value in (
        instance.get("target_date"), record.target_date, record.scheduled_date,
    )} - {None}
    # Keep completed and conflicting candidates: they must not manufacture a
    # single candidate by disappearing before the ambiguity check.
    return [source for source in sources if review_family(source.get("review_type")) == "MCM"
            and month(source.get("planned_scheduled_date")) in months]


def _sources(profile_id):
    with connection.cursor() as cursor:
        cursor.execute('SELECT id, learner_id, aptem_review_id, review_type, status, '
                       'planned_scheduled_date, completed_date, review_data '
                       'FROM "Learner".reviews WHERE learner_id=%s ORDER BY id', [profile_id])
        rows = [dict(zip([col[0] for col in cursor.description], row)) for row in cursor.fetchall()]
    for row in rows:
        if isinstance(row["review_data"], str):
            row["review_data"] = json.loads(row["review_data"])
    return rows


def _owned_source(source, profile, decision):
    data = source.get("review_data") or {}
    odata = data.get("live_odata") or {}
    return (source.get("learner_id") == profile.pk
            and bool(str(source.get("aptem_review_id") or "").strip())
            and all(str(value).strip() == str(decision.aptem_id) for value in
                    (data.get("aptem_learner_id"), odata.get("LearnerId")) if value is not None)
            and all(str(value).strip() == str(source["aptem_review_id"]) for value in
                    (data.get("aptem_review_id"), odata.get("Id")) if value is not None))


def _block(row, classification, detail):
    row.update(classification=classification, block_reason=detail)
    return row


def _inventory(learner_id=None):
    """Only durable Native bookings; imported legacy keys have no Native ID."""
    from learner_api.models import LearnerProfile, EnrolmentUser
    records = CoachCalendarEvent.objects.filter(event_type="mcr").exclude(review_instance_id="")
    if learner_id is not None:
        records = records.filter(learner_id=learner_id)
    records = list(records.order_by("id"))
    profiles = {p.pk: p for p in LearnerProfile.objects.using("default").filter(
        pk__in={r.learner_id for r in records})}
    enrolments = {e.pk: e for e in EnrolmentUser.all_learners.using("default").filter(
        pk__in={p.enrolment_id for p in profiles.values() if p.enrolment_id})}
    result = []
    for record in records:
        if not record.review_instance_id:
            continue
        profile = profiles.get(record.learner_id)
        enrolment = enrolments.get(profile.enrolment_id) if profile else None
        decision = source_for_learner(enrolment, profile)
        if profile and decision.kind == "curriculum":
            continue
        result.append((record, profile, decision, bool(profile and profile.enrolment_id and not enrolment)))
    return result


def evaluate_auto_reconciliation(*, learner_id=None):
    """Read only. Caller owns a read-only scope or the learner/calendar locks.

Evaluate the complete learner set before selecting an execution subset, so a
calendar-id filter cannot conceal another Native row claiming the same source.
"""
    from curriculum_api import review_instances as engine
    canonical.require_same_database()
    schema = reconciliation_schema_available()
    rows, contexts, sources_by_learner, caseloads = [], {}, {}, {}
    records = list(CoachCalendarEvent.objects.filter(event_type="mcr"))
    for record, profile, decision, broken in _inventory(learner_id):
        row = {key: None for key in REPORT_COLUMNS}
        row.update(learner_internal_id=record.learner_id, effective_aptem_id=decision.aptem_id,
                   native_instance_id=record.review_instance_id, calendar_event_id=record.pk,
                   candidate_count=0, source_already_selected_elsewhere=False,
                   identity_preservable=False, rule_version=RULE_VERSION, candidate_ids=[])
        rows.append(row)
        if not profile or broken or decision.kind != "aptem":
            _block(row, "INVALID_OWNERSHIP", "Stable linked Aptem learner identity is unavailable or conflicting.")
            continue
        instance = engine.get_review_instance(record.review_instance_id)
        row["native_status"] = instance.get("status") if instance else None
        if not instance or instance.get("learner_id") != profile.pk or instance.get("calendar_event_id") != record.pk:
            _block(row, "INVALID_OWNERSHIP", "Native instance and booking ownership differ.")
            continue
        if profile.pk not in sources_by_learner:
            sources_by_learner[profile.pk] = _sources(profile.pk)
        candidates = candidate_window(instance, record, sources_by_learner[profile.pk])
        row.update(candidate_count=len(candidates), candidate_ids=[s["id"] for s in candidates])
        # Existing exact authority is independent of today's window/lifecycle.
        current = links.for_native(record.review_instance_id) if schema else None
        if schema:
            try:
                calendar_link = links.for_calendar(record)
                if calendar_link and (not current or calendar_link.pk != current.pk):
                    raise ReviewIdentityConflict("Calendar and Native authority differ.")
            except ReviewIdentityConflict:
                _block(row, "NATIVE_ALREADY_MAPPED", "The calendar's existing reconciliation is inconsistent; manual review required.")
                continue
        if current:
            try:
                links.validate_record(current, record)
                source = canonical.read_source(current.source_review_id)
                if (not _owned_source(source, profile, decision)
                        or str(source["aptem_review_id"]) != current.aptem_review_id
                        or review_family(source.get("review_type")) != "MCM"):
                    raise ValueError("Applied source identity changed.")
                row.update(selected_source_review_id=current.source_review_id,
                           selected_aptem_review_id=current.aptem_review_id, existing_overlay_id=current.overlay_id,
                           identity_preservable=True)
                _block(row, "ALREADY_RECONCILED", "Existing valid exact association; no action.")
            except (ValueError, ReviewIdentityConflict):
                _block(row, "NATIVE_ALREADY_MAPPED", "Existing mapping is inconsistent; manual review required.")
            continue
        if len(candidates) != 1:
            _block(row, "AMBIGUOUS" if candidates else "NO_CANDIDATE",
                   "Multiple candidates remain manual." if candidates else "No owned MCM in the saved month union.")
            continue
        source = candidates[0]
        row.update(selected_source_review_id=source["id"], selected_aptem_review_id=source["aptem_review_id"],
                   selected_source_planned_date=source["planned_scheduled_date"], selected_source_status=source["status"])
        contexts[record.pk] = (record, profile, decision, source)

    selected = defaultdict(list)
    for row in rows:
        if row["selected_source_review_id"] is not None:
            selected[row["selected_source_review_id"]].append(row)
    for group in selected.values():
        if len(group) > 1:
            for row in group:
                row["source_already_selected_elsewhere"] = True
                if row["classification"] != "ALREADY_RECONCILED":
                    _block(row, "SOURCE_REUSE_CONFLICT", "Multiple Native bookings select or already claim this source.")

    for row in rows:
        if row["classification"]:
            continue
        record, profile, decision, source = contexts[row["calendar_event_id"]]
        if not _owned_source(source, profile, decision):
            _block(row, "INVALID_OWNERSHIP", "Captured source identity disagrees with the effective Aptem learner.")
            continue
        try:
            overlays = list(ImportedReviewInstance.objects.filter(source_review_id=source["id"]))
            if len(overlays) > 1:
                raise canonical.ReconciliationConflict("Multiple overlays claim this source.", code="OVERLAY_CONFLICT")
            overlay = overlays[0] if overlays else None
            row["existing_overlay_id"] = overlay.pk if overlay else None
            booking = linked_booking(canonical._source_event(profile, source), records, overlay, reconciliations=[])
            row["existing_imported_calendar_id"] = booking.pk if booking else None
            if booking and booking.pk != record.pk:
                raise canonical.ReconciliationConflict("A separate imported calendar claims this source (including placeholders).",
                                                       code="IMPORTED_CALENDAR_CONFLICT")
            # Same validation as explicit preview/apply. It only reads; even an
            # absent ledger is safely readable via the canonical optional path.
            # One actual authorized caseload read per owner per evaluation.
            # Never retain this context across runs or transaction boundaries.
            from .views import fetch_caseload_dashboard_profiles
            if record.owner_email not in caseloads:
                caseloads[record.owner_email] = fetch_caseload_dashboard_profiles(record.owner_email)
            if not any(learner.id == record.learner_id for learner in caseloads[record.owner_email]):
                raise canonical.ReconciliationConflict("The preserved booking's coach no longer owns this learner's imported continuation.",
                                                       code="INVALID_OWNERSHIP")
            canonical._inspect(record.pk, source["id"], learners=caseloads[record.owner_email])
            row["identity_preservable"] = True
            _block(row, "AUTO_ELIGIBLE" if schema else "SCHEMA_MISSING",
                   "" if schema else "Business rule and canonical inspection pass; reconciliation schema is not deployed.")
        except canonical.ReconciliationConflict as exc:
            _block(row, exc.code, str(exc))
        except ReviewIdentityConflict:
            _block(row, "OTHER_BLOCKED", "Conflicting imported identity associations; manual review required.")
        except ValueError as exc:
            _block(row, "OTHER_BLOCKED", str(exc))
    return rows


def _apply_pair(row, *, actor_id, reason):
    """Canonical apply owns every lock/write and invokes the final policy check."""
    def validate_locked(record, source):
        if record.learner_id != row["learner_internal_id"] or record.review_instance_id != row["native_instance_id"]:
            raise canonical.ReconciliationConflict("Booking identity changed after the dry-run.")
        fresh = next((r for r in evaluate_auto_reconciliation(learner_id=record.learner_id)
                      if r["calendar_event_id"] == record.pk), None)
        if (not fresh or fresh["classification"] not in {"AUTO_ELIGIBLE", "ALREADY_RECONCILED"}
                or fresh["selected_source_review_id"] != row["selected_source_review_id"]
                or fresh["selected_aptem_review_id"] != row["selected_aptem_review_id"]
                or fresh["effective_aptem_id"] != row["effective_aptem_id"]):
            raise canonical.ReconciliationConflict("Eligibility changed after the dry-run; no pair writes performed.")
    # Existing ledger has no JSON metadata column. Store versioned JSON in
    # its existing reason field; actor/time and all exact IDs also have
    # dedicated ledger columns. No duplicate migration/schema is needed.
    provenance = {"method": PROVENANCE, "rule_version": RULE_VERSION, "candidate_count": 1,
                  "effective_aptem_id": row["effective_aptem_id"],
                  "native_instance_id": row["native_instance_id"], "calendar_event_id": row["calendar_event_id"],
                  "source_review_id": row["selected_source_review_id"],
                  "aptem_review_id": row["selected_aptem_review_id"], "operator_id": actor_id,
                  "evaluated_at": timezone.now().isoformat(), "operator_reason": reason.strip()}
    return canonical.apply(calendar_event_id=row["calendar_event_id"], source_review_id=row["selected_source_review_id"],
                           actor_id=actor_id, reason=json.dumps(provenance, sort_keys=True), validate_locked=validate_locked)


def run_batch(*, actor_id, apply=False, reason="", expected_count=None, calendar_event_ids=None):
    """Per-row atomic, explicit apply. A failure cannot partially mutate a pair."""
    with read_only_databases():
        canonical.require_operator(actor_id)
        rows = evaluate_auto_reconciliation()
    if calendar_event_ids:
        requested = set(calendar_event_ids)
        found = {r["calendar_event_id"] for r in rows}
        if requested - found:
            raise ValueError("Requested IDs include a missing or non-Aptem Native booking.")
        rows = [row for row in rows if row["calendar_event_id"] in requested]
    counts = dict(Counter(row["classification"] for row in rows))
    result = {"rule_version": RULE_VERSION, "method": PROVENANCE, "mode": "apply" if apply else "dry-run",
              "atomicity": "per-row", "counts": counts, "rows": rows, "outcomes": []}
    if not apply:
        return result
    canonical.require_operator(actor_id)
    require_reconciliation_schema()
    if expected_count is None or expected_count < 0 or not str(reason or "").strip():
        raise ValueError("Apply requires an explicit reason and --expected-count from a reviewed dry-run.")
    eligible = [row for row in rows if row["classification"] == "AUTO_ELIGIBLE"]
    if len(eligible) != expected_count:
        # Repeating a fully applied batch is a no-op, including after work starts.
        if not eligible and any(row["classification"] == "ALREADY_RECONCILED" for row in rows):
            return result
        raise ValueError("AUTO_ELIGIBLE count changed; review a fresh dry-run before applying.")
    for row in eligible:
        try:
            outcome = _apply_pair(row, actor_id=actor_id, reason=reason)
        except (ValueError, DatabaseError) as exc:
            # Do not expose SQL/private connection details in batch reports.
            outcome = {"status": "BLOCKED", "code": getattr(exc, "code", "OTHER_BLOCKED"),
                       "detail": str(exc) if isinstance(exc, ValueError) else "Database validation failed; pair rolled back."}
        result["outcomes"].append({"calendar_event_id": row["calendar_event_id"], **outcome})
    return result
