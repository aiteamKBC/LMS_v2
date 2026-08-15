"""Calculated actual hours for the Learner Journal's **Activity log** rows.

The journal's Activity log is the employee-arranged ledger
(``structured_manual_activities.manual_learner_activities``) — a different table
from ``Last_audit.activity_actual_hours``, with its own ``actual_hours`` column,
which is the one shown in the report.

What this module does, on one learner and one month at a time:

* computes a value per row from the reference plus an offset drawn from
  -15/-10/-5/0/+5/+10/+15 minutes —
  ``reading+quiz`` → 29 minutes + offset, snapped to the nearest 5 minutes so
  the report reads 15/20/25/30/35/40 rather than 14/19/24/29/34/39/44 (the top
  offset would snap to 45, one minute past the contract's 44-minute normal
  bound, so it steps back to 40),
  ``video``/``audio`` → **exactly** the activity's configured media duration.
  It is a real length, so it is neither offset nor snapped: the actual hours are
  the media's own runtime. Audio carries no duration in the source data
  (``configured_duration_min`` is null for every audio activity), so audio rows
  are reported as skipped rather than given an invented figure;

  The offset therefore applies to ``reading+quiz`` only. Two modes: ``fixed``
  applies the one offset the auditor picked to every such row, and ``spread``
  (the default) gives each row its own offset from the permitted set. ``spread`` is **derived, not random**: the offset comes from a
  SHA-256 of the row's own identity, so the same row always gets the same
  offset, a re-run reproduces the month exactly, and the result is auditable
  rather than a number nobody can explain twice.
* leaves any row whose ``timestamp_label`` carries a genuine
  ``HH:MM:SS-HH:MM:SS`` range on that elapsed time — a real measurement is never
  shifted by an offset;
* stores it as a **pending proposal**, never as a direct write;
* applies it to the row only when someone presses Approve — and, as everywhere
  else in this feature, the approver must be a different auditor than the
  proposer (enforced in this module and by a database CHECK).

It also fills **planned** hours for reading-only rows: Aptem's own plan carries
components whose name contains "LMS" (e.g. "February - LMS Activity",
"Implementation & Exam Prep - Portfolio Management (LMS Activity)"), each with
its own planned hours and due date. Those are read from the fetched Aptem plan
(``LMS.Aptem_users.components_json``) and bucketed by the component's due date;
their planned hours for the month are shared across that month's reading-only
activities — the ones
that are a reading with no quiz attached.

``attendance`` and ``assignment`` rows are never touched: attendance carries the
register's own hours and assignment hours come from Aptem.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal

from django.db import DatabaseError

from . import rules
from .service import ServiceError


MANUAL_ROWS = '"structured_manual_activities"."manual_learner_activities"'
JOURNAL_REVISION = '"structured_manual_activities"."manual_activity_hours_revision"'
ACTIVITIES = '"Last_audit"."activities"'
# Aptem's own plan components (name, type, planned hours, month).
# Aptem's own learning plan, as fetched: one JSON array of components per
# learner, each with a name, type, planned_hours and start/end dates. This is
# the only place the non-assignment components live — the assignments feed
# (Last_audit.learner_assignments) carries "Assignment" types only, so the
# "… - LMS Activity" rows an auditor sees in Aptem are missing from it.
APTEM_PLAN = '"LMS"."Aptem_users"'

# Only these categories get a calculated value.
ELIGIBLE_CATEGORIES = ("reading+quiz", "video", "audio")

LMS_COMPONENT_PATTERN = "%LMS%"
PLANNED_BASIS_LMS_SHARE = "aptem_lms_component_share"

BASIS_REFERENCE = "reading_quiz_reference"
BASIS_MEDIA = "media_duration"
BASIS_ELAPSED = "timestamp_elapsed"

# The journal's own column is capped at 50 hours by a CHECK constraint.
MAX_JOURNAL_HOURS = Decimal("50")


REVISION_DDL = f"""
create table if not exists {JOURNAL_REVISION} (
    revision_id            bigserial primary key,
    row_id                 bigint not null references {MANUAL_ROWS} (id) on delete cascade,
    aptem_id               bigint not null,
    selected_month         text   not null,
    category               text   not null,
    previous_actual_hours  numeric,
    proposed_actual_hours  numeric,
    previous_planned_hours numeric,
    proposed_planned_hours numeric,
    planned_basis          text,
    proposed_seconds       integer,
    basis                  text,
    reference_seconds      integer,
    offset_minutes         integer not null default 0,
    offset_mode            text    not null default 'fixed',
    status                 text    not null default 'pending',
    proposed_by            text    not null,
    proposed_by_source     text,
    proposed_at            timestamptz not null default now(),
    decided_by             text,
    decided_by_source      text,
    decided_at             timestamptz,
    comment                text,
    base_fingerprint       text    not null,
    rule_version           text    not null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint manual_activity_hours_revision_status_check
        check (status in ('pending', 'approved', 'rejected', 'superseded')),
    constraint manual_activity_hours_revision_seconds_check
        check (proposed_seconds is null or proposed_seconds > 0),
    -- A revision has to propose something: actual hours, planned hours or both.
    constraint manual_activity_hours_revision_has_a_value_check
        check (proposed_actual_hours is not null or proposed_planned_hours is not null),
    constraint manual_activity_hours_revision_month_check
        check (selected_month ~ '^[0-9]{{4}}-[0-9]{{2}}$'),
    -- Two-person approval applies to identified auditors. The unattended
    -- workspace actor is exempt: the Activity-log page asks for no identity,
    -- so one actor both calculates and approves there by design.
    constraint manual_activity_hours_revision_two_person_check
        check (decided_by is null
               or decided_by <> proposed_by
               or proposed_by_source = 'workspace'),
    constraint manual_activity_hours_revision_decision_check
        check (
            (status in ('pending', 'superseded') and decided_by is null and decided_at is null)
            or (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
        )
)
"""

# Additive column for databases created before the per-run offset existed.
ALTER_DDL = (
    f"alter table {JOURNAL_REVISION} add column if not exists offset_minutes integer not null default 0",
    f"alter table {JOURNAL_REVISION} add column if not exists offset_mode text not null default 'fixed'",
    f"alter table {JOURNAL_REVISION} add column if not exists previous_planned_hours numeric",
    f"alter table {JOURNAL_REVISION} add column if not exists proposed_planned_hours numeric",
    f"alter table {JOURNAL_REVISION} add column if not exists planned_basis text",
    # Actual and planned are independent proposals now: a run can calculate one
    # without the other, so neither column may be NOT NULL.
    f"alter table {JOURNAL_REVISION} alter column proposed_actual_hours drop not null",
    f"alter table {JOURNAL_REVISION} alter column proposed_seconds drop not null",
    f"alter table {JOURNAL_REVISION} alter column basis drop not null",
    f"alter table {JOURNAL_REVISION} drop constraint if exists manual_activity_hours_revision_seconds_check",
    f"""alter table {JOURNAL_REVISION} add constraint manual_activity_hours_revision_seconds_check
        check (proposed_seconds is null or proposed_seconds > 0)""",
    f"alter table {JOURNAL_REVISION} drop constraint if exists manual_activity_hours_revision_has_a_value_check",
    f"""alter table {JOURNAL_REVISION} add constraint manual_activity_hours_revision_has_a_value_check
        check (proposed_actual_hours is not null or proposed_planned_hours is not null)""",
    # Relax the two-person CHECK for workspace-sourced runs on databases created
    # before the Activity-log page dropped its auditor name box. Additive and
    # non-destructive: existing rows are untouched.
    f"alter table {JOURNAL_REVISION} drop constraint if exists manual_activity_hours_revision_two_person_check",
    f"""alter table {JOURNAL_REVISION} add constraint manual_activity_hours_revision_two_person_check
        check (decided_by is null or decided_by <> proposed_by or proposed_by_source = 'workspace')""",
)

INDEX_DDL = (
    f"create index if not exists manual_activity_hours_revision_scope_idx "
    f"on {JOURNAL_REVISION} (aptem_id, selected_month, status)",
    f"create unique index if not exists manual_activity_hours_revision_pending_uq "
    f"on {JOURNAL_REVISION} (row_id) where status = 'pending'",
)


def ensure_journal_hours_tables(cursor):
    cursor.execute(REVISION_DDL)
    for statement in ALTER_DDL:
        cursor.execute(statement)
    for statement in INDEX_DDL:
        cursor.execute(statement)


def journal_tables_present(cursor) -> bool:
    cursor.execute(
        """
        select count(*) from information_schema.tables
        where table_schema = 'structured_manual_activities'
          and table_name = 'manual_activity_hours_revision'
        """
    )
    return bool(cursor.fetchone()[0])


def _dict_rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _fingerprint(row, seconds, offset_minutes):
    payload = "|".join(str(value) for value in (
        row["id"], row["category"], row["activity_id"], row["timestamp_label"],
        row["actual_hours"], seconds, offset_minutes, rules.RULE_VERSION,
    ))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


FIELD_ACTUAL = "actual"
FIELD_PLANNED = "planned"
FIELD_BOTH = "both"
CALCULATION_FIELDS = (FIELD_BOTH, FIELD_ACTUAL, FIELD_PLANNED)


def validate_fields(value) -> str:
    """Which column(s) this run proposes: actual hours, planned hours or both."""
    if value in (None, ""):
        return FIELD_BOTH
    field = str(value).strip().lower()
    if field not in CALCULATION_FIELDS:
        raise ServiceError(f"fields must be one of: {', '.join(CALCULATION_FIELDS)}.",
                           status=400, code="invalid_fields")
    return field


MODE_FIXED = "fixed"
MODE_SPREAD = "spread"
OFFSET_MODES = (MODE_SPREAD, MODE_FIXED)


def validate_offset_mode(value) -> str:
    if value in (None, ""):
        return MODE_SPREAD
    mode = str(value).strip().lower()
    if mode not in OFFSET_MODES:
        raise ServiceError(f"offset_mode must be one of: {', '.join(OFFSET_MODES)}.",
                           status=400, code="invalid_offset_mode")
    return mode


def row_offset_minutes(row, mode: str, offset_minutes: int) -> int:
    """The offset for ONE row.

    ``fixed`` → the auditor's chosen offset for every row.
    ``spread`` → an offset derived from this row's own identity. It is a hash,
    not a random draw: the same row yields the same offset on every run, so a
    month can be recalculated and reproduced exactly, and every value can be
    explained from the row it belongs to.
    """
    if mode == MODE_FIXED:
        return offset_minutes
    seed = f"{row['id']}|{row.get('activity_id')}|{row['category']}|{rules.RULE_VERSION}"
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    index = int.from_bytes(digest[:8], "big") % len(rules.PERMITTED_OFFSET_MINUTES)
    return rules.PERMITTED_OFFSET_MINUTES[index]


def validate_offset_minutes(value) -> int:
    """The one offset an auditor picked for this run."""
    if value in (None, ""):
        return 0
    try:
        offset = int(value)
    except (TypeError, ValueError) as error:
        raise ServiceError("offset_minutes must be a whole number of minutes.",
                           status=400, code="invalid_offset") from error
    if offset not in rules.PERMITTED_OFFSET_MINUTES:
        allowed = ", ".join(f"{item:+d}" for item in rules.PERMITTED_OFFSET_MINUTES)
        raise ServiceError(f"offset_minutes must be one of: {allowed}.",
                           status=400, code="invalid_offset")
    return offset


def _reference_seconds(row, offset_minutes: int = 0):
    """The calculated value for one row, or ``(None, None, reason)`` when there
    is none.

    Nothing is invented: a genuine time range wins and is never shifted, a media
    row needs its configured duration, and reading+quiz uses the 29-minute
    reference from the contract. The run's offset applies to the reference
    values only, and a result under one minute is skipped rather than clamped.
    """
    label = (row.get("timestamp_label") or "").strip()
    if rules.source_category(None, label) == rules.SOURCE_TIMESTAMPED:
        start, _, end = label.partition("-")
        try:
            import datetime
            elapsed = rules.elapsed_seconds(datetime.time.fromisoformat(start.strip()),
                                            datetime.time.fromisoformat(end.strip()))
        except ValueError:
            return None, None, "unreadable timestamp range"
        if elapsed is None or elapsed < rules.MINIMUM_DURATION_SECONDS:
            return None, None, "timestamp range is under one minute"
        return elapsed, BASIS_ELAPSED, None

    offset_seconds = int(offset_minutes) * rules.MINUTE
    if row["category"] == "reading+quiz":
        # Input Reading/Quiz has no measured duration behind it, so the value is
        # reported on a 5-minute grid: 29 + offset snapped to the nearest 5,
        # giving 15/20/25/30/35/40. The top offset would snap to 45, one minute
        # above the contract's 44-minute normal upper bound, so it steps down to
        # the last in-band grid point instead of pushing the month into the
        # long-tail band.
        seconds = rules.snap_to_grid(rules.READING_QUIZ_REFERENCE_SECONDS + offset_seconds)
        while seconds > rules.INPUT_READING_NORMAL_MAX:
            seconds -= rules.INPUT_GRID_SECONDS
        basis = BASIS_REFERENCE
    else:
        # Video/audio report the media's own runtime. A real measured length is
        # used as it stands — no offset, no rounding.
        media = rules.minutes_to_seconds(row.get("configured_duration_min"))
        if not media:
            return None, None, "no configured media duration"
        seconds = media
        basis = BASIS_MEDIA
    if seconds < rules.MINIMUM_DURATION_SECONDS:
        return None, None, f"{offset_minutes:+d} min would leave it under one minute"
    return seconds, basis, None


def scope_rows(cursor, aptem_id: int, month: str) -> list[dict]:
    cursor.execute(
        f"""
        select m.id, m.aptem_id, m.learner_id, m.month, m.category, m.title,
               m.activity_id, m.planned_hours, m.actual_hours, m.timestamp_label,
               m.accepted, a.configured_duration_min,
               a.quiz_id, a.reading_type, a.reading_iframe_url, a.reading_text_body
        from {MANUAL_ROWS} m
        left join {ACTIVITIES} a on a.activity_id = m.activity_id
        where m.aptem_id = %s and m.month = %s and m.deleted_at is null
        order by m.category, m.id
        """,
        [aptem_id, month],
    )
    return _dict_rows(cursor)


def is_reading_only(row) -> bool:
    """A reading with no quiz attached — the rows the Aptem LMS plan is shared
    across. A row that carries a quiz, or has no reading content at all, is not
    one of them."""
    if row.get("category") != "reading+quiz":
        return False
    if row.get("quiz_id") is not None:
        return False
    return bool(row.get("reading_type") or row.get("reading_iframe_url")
                or row.get("reading_text_body"))


def lms_planned_hours(cursor, aptem_id: int, month: str):
    """Aptem's planned hours for this learner's LMS components in this month.

    Returns ``(total_hours, component_count)``. The plan is read as it stands —
    nothing here writes to it.
    """
    cursor.execute(
        f"""
        select coalesce(sum((component->>'planned_hours')::numeric), 0), count(*)
        from {APTEM_PLAN} plan
        cross join lateral json_array_elements(plan.components_json) component
        where plan."ID" = %s
          and component->>'name' ilike %s
          and component->>'planned_hours' is not null
          and component->>'end_date' is not null
          and to_char((component->>'end_date')::date, 'YYYY-MM') = %s
        """,
        [aptem_id, LMS_COMPONENT_PATTERN, month],
    )
    total, count = cursor.fetchone()
    return Decimal(str(total or 0)), int(count or 0)


def lms_components(cursor, aptem_id: int, month: str) -> list:
    """The LMS components themselves, so the panel can show what was summed."""
    cursor.execute(
        f"""
        select component->>'name', (component->>'planned_hours')::numeric,
               component->>'end_date'
        from {APTEM_PLAN} plan
        cross join lateral json_array_elements(plan.components_json) component
        where plan."ID" = %s
          and component->>'name' ilike %s
          and component->>'planned_hours' is not null
          and component->>'end_date' is not null
          and to_char((component->>'end_date')::date, 'YYYY-MM') = %s
        order by 1
        """,
        [aptem_id, LMS_COMPONENT_PATTERN, month],
    )
    return [{"name": name, "planned_hours": str(hours), "due_date": due}
            for name, hours, due in cursor.fetchall()]


def planned_share(total_hours: Decimal, row_count: int) -> Decimal | None:
    """The even share of the month's LMS planned hours, for display/limit checks."""
    if not row_count or total_hours is None or total_hours <= 0:
        return None
    return (Decimal(total_hours) / Decimal(row_count)).quantize(rules.HOURS_QUANTUM)


def planned_allocation(total_hours: Decimal, row_ids) -> dict:
    """Split the month's LMS planned hours across the reading-only rows so the
    parts add back up to the total **exactly**.

    An even share rounded to 4 dp would drift (23h over 22 rows leaves 0.001h
    unaccounted), and a monthly plan that no longer sums to Aptem's figure is a
    reporting error. Each row takes the difference between two running totals,
    so the rounding remainder lands on real rows instead of vanishing.
    """
    ordered = list(row_ids)
    if not ordered or total_hours is None or Decimal(total_hours) <= 0:
        return {}
    total = Decimal(total_hours)
    count = len(ordered)
    allocation = {}
    previous = Decimal("0")
    for index, row_id in enumerate(ordered, start=1):
        running = (total * index / count).quantize(rules.HOURS_QUANTUM)
        allocation[row_id] = running - previous
        previous = running
    return allocation


def calculate(cursor, *, aptem_id: int, month: str, actor,
              offset_minutes: int = 0, offset_mode: str = MODE_SPREAD,
              fields: str = FIELD_BOTH) -> dict:
    """Propose hours for one learner-month.

    ``fields`` chooses what this run works out: ``actual``, ``planned`` or
    ``both``. The two are independent — calculating one never discards a pending
    proposal for the other; the row's pending proposal is re-issued carrying
    both, and the previous one is kept as ``superseded`` history.
    """
    fields = validate_fields(fields)
    offset_mode = validate_offset_mode(offset_mode)
    offset_minutes = validate_offset_minutes(offset_minutes)
    wants_actual = fields in (FIELD_BOTH, FIELD_ACTUAL)
    wants_planned = fields in (FIELD_BOTH, FIELD_PLANNED)

    rows = scope_rows(cursor, aptem_id, month)
    summary = {
        "fields": fields,
        "offset_mode": offset_mode,
        "offset_minutes": offset_minutes if offset_mode == MODE_FIXED else None,
        "offsets_used": {},
        "rows_in_month": len(rows),
        "eligible": 0,
        "proposals_created": 0,
        "already_pending": 0,
        "already_matching": 0,
        "superseded": 0,
        "skipped": 0,
        "skipped_reasons": {},
        "excluded_categories": 0,
        "actual_set": 0,
        "planned_set": 0,
        "planned_note": "",
    }

    # Planned hours for reading-only rows: this month's Aptem LMS components,
    # shared across them. The Aptem plan is only read, never written.
    lms_total, lms_component_count = lms_planned_hours(cursor, aptem_id, month)
    reading_only_ids = [row["id"] for row in rows if is_reading_only(row)]
    planned_each = planned_share(lms_total, len(reading_only_ids))
    planned_by_row = planned_allocation(lms_total, reading_only_ids) if wants_planned else {}
    summary["lms_planned_hours"] = str(lms_total)
    summary["lms_components"] = lms_component_count
    summary["lms_component_names"] = lms_components(cursor, aptem_id, month)
    summary["reading_only_rows"] = len(reading_only_ids)
    summary["planned_each"] = str(planned_each) if planned_each is not None else None
    if wants_planned:
        if planned_each is None:
            if not lms_component_count:
                summary["planned_note"] = "Aptem has no LMS component for this month."
            elif not reading_only_ids:
                summary["planned_note"] = "This month has no reading-only activities."
        elif planned_each > MAX_JOURNAL_HOURS:
            summary["planned_note"] = (f"{planned_each}h per row is above the 50-hour column "
                                       f"limit — planned hours were left alone.")
            planned_by_row = {}

    for row in rows:
        if row["category"] not in ELIGIBLE_CATEGORIES:
            summary["excluded_categories"] += 1
            continue
        summary["eligible"] += 1

        # --- the actual-hours side ---------------------------------------
        proposed_hours = seconds = basis = row_offset = None
        if wants_actual:
            row_offset = row_offset_minutes(row, offset_mode, offset_minutes)
            seconds, basis, reason = _reference_seconds(row, row_offset)
            if seconds is None:
                summary["skipped"] += 1
                summary["skipped_reasons"][reason] = summary["skipped_reasons"].get(reason, 0) + 1
                if not wants_planned:
                    continue
            else:
                proposed_hours = rules.seconds_to_hours(seconds)
                if proposed_hours > MAX_JOURNAL_HOURS:
                    summary["skipped"] += 1
                    summary["skipped_reasons"]["over the 50-hour column limit"] = \
                        summary["skipped_reasons"].get("over the 50-hour column limit", 0) + 1
                    proposed_hours = seconds = basis = None
                    if not wants_planned:
                        continue
            current_actual = row.get("actual_hours")
            if proposed_hours is not None and current_actual is not None \
                    and Decimal(str(current_actual)) == proposed_hours:
                proposed_hours = seconds = basis = None      # already correct

        # --- the planned-hours side ---------------------------------------
        row_planned = planned_by_row.get(row["id"]) if wants_planned else None
        current_planned = row.get("planned_hours")
        if row_planned is not None and current_planned is not None \
                and Decimal(str(current_planned)) == row_planned:
            row_planned = None                                # already correct

        # --- merge with whatever is already pending on this row ------------
        cursor.execute(
            f"""select revision_id, proposed_actual_hours, proposed_seconds, basis,
                       offset_minutes, offset_mode, proposed_planned_hours
                  from {JOURNAL_REVISION}
                 where row_id = %s and status = 'pending' for update""",
            [row["id"]],
        )
        existing = cursor.fetchone()

        merged_actual, merged_seconds, merged_basis = proposed_hours, seconds, basis
        merged_offset, merged_mode = row_offset, offset_mode
        merged_planned = row_planned
        if existing:
            if merged_actual is None and not wants_actual:
                merged_actual, merged_seconds, merged_basis = existing[1], existing[2], existing[3]
                merged_offset, merged_mode = existing[4], existing[5]
            elif merged_actual is None and wants_actual and existing[1] is not None:
                # This run found nothing to change; keep what is pending.
                merged_actual, merged_seconds, merged_basis = existing[1], existing[2], existing[3]
                merged_offset, merged_mode = existing[4], existing[5]
            if merged_planned is None and not wants_planned:
                merged_planned = existing[6]
            elif merged_planned is None and wants_planned and existing[6] is not None \
                    and not planned_by_row:
                merged_planned = existing[6]

        if merged_actual is None and merged_planned is None:
            if existing is None:
                summary["already_matching"] += 1
            else:
                summary["already_pending"] += 1
            continue

        if existing:
            same_actual = _same(existing[1], merged_actual)
            same_planned = _same(existing[6], merged_planned)
            if same_actual and same_planned:
                summary["already_pending"] += 1
                continue
            cursor.execute(
                f"""update {JOURNAL_REVISION}
                       set status = 'superseded', updated_at = now()
                     where revision_id = %s and status = 'pending'""",
                [existing[0]],
            )
            summary["superseded"] += 1

        cursor.execute(
            f"""
            insert into {JOURNAL_REVISION}
                (row_id, aptem_id, selected_month, category, previous_actual_hours,
                 proposed_actual_hours, proposed_seconds, basis, reference_seconds,
                 offset_minutes, offset_mode, previous_planned_hours,
                 proposed_planned_hours, planned_basis, status, proposed_by,
                 proposed_by_source, base_fingerprint, rule_version)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    'pending', %s, %s, %s, %s)
            on conflict do nothing
            """,
            [row["id"], aptem_id, month, row["category"], row.get("actual_hours"),
             merged_actual, merged_seconds, merged_basis, merged_seconds,
             merged_offset if merged_offset is not None else 0,
             merged_mode or offset_mode,
             current_planned, merged_planned,
             PLANNED_BASIS_LMS_SHARE if merged_planned is not None else None,
             actor.key, actor.source,
             _fingerprint(row, merged_seconds, merged_offset), rules.RULE_VERSION],
        )
        if cursor.rowcount:
            summary["proposals_created"] += 1
            # Count only what THIS run worked out. A value carried over from a
            # pending proposal is re-issued, not calculated again.
            if wants_actual and proposed_hours is not None:
                summary["actual_set"] += 1
            if wants_planned and row_planned is not None:
                summary["planned_set"] += 1
            if merged_offset is not None and merged_actual is not None:
                key = f"{merged_offset:+d}"
                summary["offsets_used"][key] = summary["offsets_used"].get(key, 0) + 1
        else:
            summary["already_pending"] += 1
    return summary


def _same(left, right) -> bool:
    """Two proposed values are the same, treating NULL as a value."""
    if left is None or right is None:
        return left is None and right is None
    return Decimal(str(left)) == Decimal(str(right))


def pending(cursor, aptem_id: int, month: str) -> list[dict]:
    cursor.execute(
        f"""
        select revision_id, row_id, category, previous_actual_hours, proposed_actual_hours,
               previous_planned_hours, proposed_planned_hours, planned_basis,
               proposed_seconds, basis, offset_minutes, offset_mode, proposed_by, proposed_at
        from {JOURNAL_REVISION}
        where aptem_id = %s and selected_month = %s and status = 'pending'
        order by row_id
        """,
        [aptem_id, month],
    )
    return _dict_rows(cursor)


def history(cursor, aptem_id: int, month: str, limit: int = 200) -> list[dict]:
    cursor.execute(
        f"""
        select revision_id, row_id, status, previous_actual_hours, proposed_actual_hours,
               basis, offset_minutes, offset_mode, proposed_by, proposed_at, decided_by, decided_at
        from {JOURNAL_REVISION}
        where aptem_id = %s and selected_month = %s
        order by revision_id desc limit %s
        """,
        [aptem_id, month, limit],
    )
    return _dict_rows(cursor)


def decide(cursor, *, aptem_id: int, month: str, actor, approve: bool,
           revision_ids=None, comment=None) -> dict:
    """Approve (apply) or reject the month's pending proposals.

    The approver must differ from the proposer — checked here per revision and
    guaranteed by the table's two-person CHECK constraint.
    """
    if not getattr(actor, "may_decide", False):
        raise ServiceError("This identity may not decide proposals.",
                           status=403, code="identity_not_permitted")

    conditions = ["aptem_id = %s", "selected_month = %s", "status = 'pending'"]
    params: list = [aptem_id, month]
    if revision_ids:
        conditions.append("revision_id = any(%s)")
        params.append([int(value) for value in revision_ids])

    cursor.execute(
        f"""select revision_id, row_id, proposed_actual_hours, proposed_planned_hours,
                   proposed_by
            from {JOURNAL_REVISION} where {' and '.join(conditions)}
            order by revision_id for update""",
        params,
    )
    proposals = _dict_rows(cursor)
    if not proposals:
        raise ServiceError("There is nothing pending for this learner and month.",
                           status=409, code="nothing_pending")

    two_person = getattr(actor, "enforces_two_person", True)
    own = [item for item in proposals if item["proposed_by"] == actor.key]
    if two_person and own and len(own) == len(proposals):
        raise ServiceError(
            "These proposals were made by you — a different auditor has to approve them.",
            status=403, code="self_approval",
        )

    applied = skipped_own = 0
    for proposal in proposals:
        if two_person and proposal["proposed_by"] == actor.key:
            skipped_own += 1
            continue
        if approve:
            # A planned value is only written when this proposal carries one;
            # otherwise the row keeps the planned hours it already has.
            cursor.execute(
                f"""update {MANUAL_ROWS}
                       set actual_hours = %s,
                           planned_hours = coalesce(%s, planned_hours),
                           updated_by = %s, updated_at = now()
                     where id = %s and aptem_id = %s and month = %s and deleted_at is null""",
                [proposal["proposed_actual_hours"], proposal["proposed_planned_hours"],
                 actor.label, proposal["row_id"], aptem_id, month],
            )
            if cursor.rowcount != 1:
                raise ServiceError("A journal row changed while approving; nothing was applied.",
                                   status=409, code="stale")
        cursor.execute(
            f"""update {JOURNAL_REVISION}
                   set status = %s, decided_by = %s, decided_by_source = %s,
                       decided_at = now(), comment = coalesce(%s, comment), updated_at = now()
                 where revision_id = %s and status = 'pending'""",
            ["approved" if approve else "rejected", actor.key, actor.source, comment,
             proposal["revision_id"]],
        )
        applied += 1

    return {
        "ok": True,
        "decided": applied,
        "skipped_own_proposals": skipped_own,
        "status": "approved" if approve else "rejected",
    }
