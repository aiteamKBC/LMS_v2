"""Validate / propose / approve services for Learner Journal Actual Hours.

Guarantees this module is responsible for:

* ``actual_hours`` is written in exactly one place — :func:`approve` — inside a
  transaction that has re-checked the proposal, the approver, the blocking
  findings and the base fingerprint.
* No timestamp, source label or genuine value is ever rewritten, shifted,
  clamped or generated.
* Re-running :func:`run_scan` on unchanged data creates no second proposal and
  no second active finding (deterministic fingerprints + partial unique
  indexes).
"""

from __future__ import annotations

import hashlib
import json
from decimal import Decimal

from django.db import IntegrityError, transaction

from . import repository, rules
from .holidays import load_calendar
from .tables import BASE_TABLE, REVISION_TABLE, VALIDATION_TABLE


CALCULATION_TIMESTAMP = "timestamp_elapsed"
CALCULATION_AUDITOR_INPUT = "auditor_input"

SCAN_ACTOR = "system:scan"


class ServiceError(Exception):
    """A refusal the API turns into a 4xx response."""

    def __init__(self, message, status=400, code=None, details=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details or {}


def _text(value):
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return format(value.normalize(), "f")
    return str(value)


def base_fingerprint(row: dict) -> str:
    """Deterministic hash of the source state a proposal was derived from.

    Display strings are deliberately excluded; only values a rule reads are in
    here, so an unrelated edit does not invalidate every pending proposal.
    """
    payload = "|".join(_text(value) for value in (
        row.get("learner_id"), row.get("kind"), row.get("ref"),
        row.get("reporting_method"), row.get("timestamp_label"),
        row.get("activity_date"), row.get("start_time"), row.get("end_time"),
        row.get("actual_hours"), row.get("media_seconds"),
        rules.RULE_VERSION,
    ))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _finding_fingerprint(row, code, month, related_ref=None):
    payload = "|".join(_text(value) for value in (
        row.get("learner_id"), row.get("kind"), row.get("ref"), code,
        related_ref, month, base_fingerprint(row), rules.RULE_VERSION,
    ))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _observed_seconds(row) -> int | None:
    """Genuine elapsed time for a time-stamped row, the stored value otherwise."""
    source = rules.source_category(row.get("reporting_method"), row.get("timestamp_label"))
    if source == rules.SOURCE_TIMESTAMPED:
        elapsed = rules.elapsed_seconds(row.get("start_time"), row.get("end_time"))
        if elapsed is not None:
            return elapsed
    return rules.hours_to_seconds(row.get("actual_hours"))


def _row_findings(row, calendar, month):
    """Every finding for one row, without touching the row itself."""
    source = rules.source_category(row.get("reporting_method"), row.get("timestamp_label"))
    findings: list[rules.Finding] = []

    if source == rules.SOURCE_OTHER:
        findings.append(rules.Finding(
            code=rules.CODE_UNRECOGNISED_SOURCE,
            severity=rules.SEVERITY_WARNING,
            message=f"Unrecognised source {row.get('reporting_method') or row.get('timestamp_label')!r}.",
            details={"reporting_method": row.get("reporting_method")},
        ))

    if source == rules.SOURCE_TIMESTAMPED:
        findings.extend(rules.working_time_findings(
            row.get("activity_date"), row.get("start_time"), row.get("end_time"),
            holiday_status=calendar.is_holiday(row.get("activity_date")),
        ))

    seconds = _observed_seconds(row)
    classification = rules.classify(row.get("kind"), source, seconds, row.get("media_seconds"))
    classification_finding = classification.finding()
    if classification_finding is not None:
        findings.append(classification_finding)
    return source, seconds, classification, findings


def _overlap_findings(rows, month):
    """Duplicate / overlapping time-stamped intervals for one learner.

    Only wall-clock times are stored, so two rows can only overlap inside one
    ``activity_date`` — which belongs to exactly one month. Cross-month overlap
    is structurally impossible here (see the plan, blocker B5), so scanning the
    selected month is complete rather than a shortcut.
    """
    pairs: list[tuple[dict, str, dict]] = []
    timestamped = [
        row for row in rows
        if rules.source_category(row.get("reporting_method"), row.get("timestamp_label")) == rules.SOURCE_TIMESTAMPED
        and row.get("activity_date") and row.get("start_time") and row.get("end_time")
        and row["end_time"] > row["start_time"]
    ]
    by_date: dict = {}
    for row in timestamped:
        by_date.setdefault(row["activity_date"], []).append(row)

    for day_rows in by_date.values():
        ordered = sorted(day_rows, key=lambda item: (item["start_time"], _text(item["ref"])))
        for index, first in enumerate(ordered):
            for second in ordered[index + 1:]:
                if not rules.intervals_overlap(first["start_time"], first["end_time"],
                                               second["start_time"], second["end_time"]):
                    continue
                # Canonical order: the pair is recorded once, on the earlier row.
                code = (rules.CODE_DUPLICATE_INTERVAL
                        if rules.is_duplicate_interval(first["start_time"], first["end_time"],
                                                       second["start_time"], second["end_time"])
                        else rules.CODE_OVERLAPPING_INTERVAL)
                pairs.append((first, code, second))
    return pairs


def _upsert_finding(cursor, row, month, finding, fingerprint, related_ref=None):
    cursor.execute(
        f"""
        insert into {VALIDATION_TABLE}
            (learner_id, kind, ref, aptem_id, selected_month, code, severity, status,
             message, details, related_ref, fingerprint, rule_version)
        values (%s, %s, %s, %s, %s, %s, %s, 'active', %s, %s::jsonb, %s, %s, %s)
        on conflict (fingerprint) where status = 'active'
        do update set last_seen_at = now(), message = excluded.message, details = excluded.details
        """,
        [row["learner_id"], row["kind"], row["ref"], row.get("aptem_id"), month,
         finding.code, finding.severity, finding.message, json.dumps(finding.details or {}),
         related_ref, fingerprint, rules.RULE_VERSION],
    )


def run_scan(cursor, *, aptem_id: int, month: str, auditor, timestamp_semantics_confirmed: bool) -> dict:
    """Validate one learner's selected month and create timestamp-derived
    proposals. Writes stay inside the scope; the active value is never touched."""
    rows = repository.scope_rows(cursor, aptem_id, month)
    years = {row["activity_date"].year for row in rows if row.get("activity_date")}
    calendar = load_calendar(cursor, years)

    seen_fingerprints: list[str] = []
    blocking_by_key: dict = {}
    summary = {
        "records_scanned": len(rows),
        "timestamped": 0,
        "input": 0,
        "other": 0,
        "input_needing_entry": 0,
        "blocking": 0,
        "warnings": 0,
        "long_tail": 0,
        "unclassifiable": 0,
        "duplicates": 0,
        "overlaps": 0,
        "proposals_created": 0,
        "proposals_skipped_blocked": 0,
        "calendar_years_covered": sorted(calendar.covered_years),
    }

    evaluated = []
    for row in rows:
        source, seconds, classification, findings = _row_findings(row, calendar, month)
        summary[{"timestamped": "timestamped", "input": "input"}.get(source, "other")] += 1
        if source == rules.SOURCE_INPUT and row.get("actual_hours") is None:
            summary["input_needing_entry"] += 1
        if classification.is_long_tail:
            summary["long_tail"] += 1
        if not classification.is_classifiable:
            summary["unclassifiable"] += 1
        evaluated.append((row, source, seconds, classification, findings))

    for row, code, other in _overlap_findings(rows, month):
        summary["duplicates" if code == rules.CODE_DUPLICATE_INTERVAL else "overlaps"] += 1
        message = ("Identical time-stamped interval as "
                   if code == rules.CODE_DUPLICATE_INTERVAL else "Overlaps the time-stamped interval of ")
        finding = rules.Finding(
            code=code,
            severity=rules.SEVERITY_BLOCKING,
            message=f"{message}{other['kind']}:{other['ref']} "
                    f"({other['start_time']}-{other['end_time']} on {other['activity_date']}).",
            details={"related_kind": other["kind"], "related_ref": other["ref"]},
        )
        for candidate in evaluated:
            if candidate[0] is row:
                candidate[4].append(finding)
                break

    for row, source, seconds, classification, findings in evaluated:
        key = (row["learner_id"], row["kind"], row["ref"])
        for finding in findings:
            related = (finding.details or {}).get("related_ref")
            fingerprint = _finding_fingerprint(row, finding.code, month, related)
            _upsert_finding(cursor, row, month, finding, fingerprint, related)
            seen_fingerprints.append(fingerprint)
            if finding.is_blocking:
                summary["blocking"] += 1
                blocking_by_key.setdefault(key, []).append(finding.code)
            elif finding.severity == rules.SEVERITY_WARNING:
                summary["warnings"] += 1

    for row, source, seconds, classification, findings in evaluated:
        if source != rules.SOURCE_TIMESTAMPED or seconds is None:
            continue
        stored_seconds = rules.hours_to_seconds(row.get("actual_hours"))
        if stored_seconds == seconds:
            continue
        key = (row["learner_id"], row["kind"], row["ref"])
        if not timestamp_semantics_confirmed:
            # Blocker B3: the ingest timezone convention for these wall-clock
            # columns is unverified, so a timestamp-derived value must not be
            # proposed. Flagged only on the rows it would have changed.
            finding = rules.Finding(
                code=rules.CODE_TIMESTAMP_SEMANTICS_UNCONFIRMED,
                severity=rules.SEVERITY_BLOCKING,
                message="Stored hours differ from the elapsed wall-clock, but the "
                        "timestamp storage convention is unconfirmed, so no proposal was created.",
                details={"elapsed_seconds": seconds, "stored_seconds": stored_seconds},
            )
            fingerprint = _finding_fingerprint(row, finding.code, month)
            _upsert_finding(cursor, row, month, finding, fingerprint)
            seen_fingerprints.append(fingerprint)
            summary["blocking"] += 1
            summary["proposals_skipped_blocked"] += 1
            continue
        if blocking_by_key.get(key):
            summary["proposals_skipped_blocked"] += 1
            continue
        created = _insert_revision(
            cursor, row, month=month, seconds=seconds,
            calculation_type=CALCULATION_TIMESTAMP,
            note="Genuine elapsed time between the stored start and end.",
            actor=auditor,
        )
        if created:
            summary["proposals_created"] += 1

    # Resolve findings that no longer describe the data — AFTER the proposal
    # loop, so the findings that loop raises are already in seen_fingerprints.
    # Resolving first would resolve-and-recreate them on every re-scan, which
    # would break idempotency and invent a "resolved" history row each time.
    # History is kept either way: rows are marked resolved, never deleted.
    cursor.execute(
        f"""
        update {VALIDATION_TABLE}
           set status = 'resolved', resolved_at = now(), resolved_by = %s
         where aptem_id = %s and selected_month = %s and status = 'active'
           and not (fingerprint = any(%s))
        """,
        [SCAN_ACTOR, aptem_id, month, seen_fingerprints or [""]],
    )
    summary["findings_resolved"] = cursor.rowcount

    return summary


def _insert_revision(cursor, row, *, month, seconds, calculation_type, note, actor, comment=None):
    """Insert one pending revision. The partial unique index makes a duplicate
    impossible; a conflict simply means the same proposal already exists."""
    proposed_hours = rules.seconds_to_hours(seconds)
    try:
        with transaction.atomic(using=cursor.db.alias):
            cursor.execute(
                f"""
                insert into {REVISION_TABLE}
                    (learner_id, kind, ref, aptem_id, selected_month,
                     previous_actual_hours, previous_seconds,
                     proposed_actual_hours, proposed_seconds,
                     calculation_type, calculation_note,
                     source_snapshot, timestamp_label_snapshot, activity_date_snapshot,
                     start_time_snapshot, end_time_snapshot, kind_snapshot, media_duration_seconds,
                     status, proposed_by, proposed_by_source, comment,
                     base_fingerprint, rule_version)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        'pending', %s, %s, %s, %s, %s)
                on conflict do nothing
                """,
                [row["learner_id"], row["kind"], row["ref"], row.get("aptem_id"), month,
                 row.get("actual_hours"), rules.hours_to_seconds(row.get("actual_hours")),
                 proposed_hours, seconds,
                 calculation_type, note,
                 row.get("reporting_method"), row.get("timestamp_label"), row.get("activity_date"),
                 row.get("start_time"), row.get("end_time"), row.get("kind"), row.get("media_seconds"),
                 actor.key, actor.source, comment,
                 base_fingerprint(row), rules.RULE_VERSION],
            )
            return cursor.rowcount > 0
    except IntegrityError:
        return False


def create_input_proposal(cursor, *, aptem_id, month, learner_id, kind, ref, seconds, actor, comment=None):
    """An auditor's explicit Input value. Nothing is generated here."""
    row = repository.base_row(cursor, learner_id, kind, ref)
    if not row:
        raise ServiceError("That activity does not exist.", status=404)
    if row.get("aptem_id") != aptem_id or row.get("month") != month:
        raise ServiceError("That activity is outside the selected learner and month.", status=403)
    if row.get("kind") not in rules.ELIGIBLE_KINDS:
        raise ServiceError("Only LMS reading/quiz, video and audio rows are in scope.", status=400)

    try:
        validated = rules.validate_proposal(kind, seconds, row.get("media_seconds"))
    except rules.ProposalError as error:
        raise ServiceError(str(error), status=400, code="invalid_proposal") from error

    if rules.hours_to_seconds(row.get("actual_hours")) == validated:
        raise ServiceError("The proposed value equals the active value.", status=409, code="redundant")

    created = _insert_revision(
        cursor, row, month=month, seconds=validated,
        calculation_type=CALCULATION_AUDITOR_INPUT,
        note="Auditor-entered value.", actor=actor, comment=comment,
    )
    if not created:
        raise ServiceError("An identical proposal is already pending for this activity.",
                           status=409, code="duplicate_pending")
    return {"ok": True, "proposed_seconds": validated,
            "proposed_actual_hours": str(rules.seconds_to_hours(validated))}


def _decide(cursor, *, revision_id, actor, approve, comment=None):
    revision = repository.lock_revision(cursor, revision_id)
    if not revision:
        raise ServiceError("That proposal does not exist.", status=404)
    if revision["status"] != "pending":
        raise ServiceError(f"That proposal is already {revision['status']}.", status=409, code="stale")
    if not getattr(actor, "may_decide", False):
        # Defence in depth: auth.resolve_auditor already refuses this, but a
        # decision must never be reachable from an identity this deployment
        # does not accept for decisions.
        raise ServiceError("This identity may not decide proposals.",
                           status=403, code="identity_not_permitted")
    if revision["proposed_by"] == actor.key:
        raise ServiceError("A proposal must be reviewed by a different auditor.",
                           status=403, code="self_approval")

    if approve:
        blocking = repository.blocking_findings_for_row(
            cursor, revision["learner_id"], revision["kind"], revision["ref"])
        if blocking:
            raise ServiceError("Blocking validation findings must be resolved first.",
                               status=409, code="blocked",
                               details={"codes": [item["code"] for item in blocking]})
        locked = repository.lock_base_row(cursor, revision["learner_id"], revision["kind"], revision["ref"])
        if not locked:
            raise ServiceError("The underlying activity no longer exists.", status=409, code="stale")
        # Re-read through the media join rather than trusting the proposal's own
        # snapshot: a changed configured_duration_min MUST invalidate the
        # proposal, and grafting the snapshot back would hide exactly that.
        current = repository.base_row(cursor, revision["learner_id"], revision["kind"], revision["ref"])
        if current is None or base_fingerprint(current) != revision["base_fingerprint"]:
            # The proposal stays pending: a re-scan (or the auditor) decides what
            # the new source state should propose. Nothing is written here, so
            # this refusal leaves no half-applied state behind.
            raise ServiceError("The activity changed after this proposal was made.",
                               status=409, code="stale")
        cursor.execute(
            f"""
            update {BASE_TABLE} set actual_hours = %s, updated_at = now()
             where learner_id = %s and kind = %s and ref = %s
            """,
            [revision["proposed_actual_hours"], revision["learner_id"], revision["kind"], revision["ref"]],
        )

    cursor.execute(
        f"""
        update {REVISION_TABLE}
           set status = %s, decided_by = %s, decided_by_source = %s, decided_at = now(),
               comment = coalesce(%s, comment), updated_at = now()
         where revision_id = %s and status = 'pending'
        """,
        ["approved" if approve else "rejected", actor.key, actor.source, comment, revision_id],
    )
    if cursor.rowcount != 1:
        raise ServiceError("That proposal was decided by someone else.", status=409, code="stale")
    return {"ok": True, "revision_id": revision_id, "status": "approved" if approve else "rejected"}


def approve(cursor, *, revision_id, actor, comment=None):
    """The ONLY path that writes ``actual_hours``."""
    return _decide(cursor, revision_id=revision_id, actor=actor, approve=True, comment=comment)


def reject(cursor, *, revision_id, actor, comment=None):
    return _decide(cursor, revision_id=revision_id, actor=actor, approve=False, comment=comment)
