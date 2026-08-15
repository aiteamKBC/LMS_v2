"""DDL for the Actual Hours review tables.

Django migrations never reach the Neon audit branches (``EnrolmentRouter``
blocks them and the ``audit`` alias has no migration history), so the
repository convention for this schema is an idempotent, schema-qualified
``ensure_*`` helper plus a ``setup_*`` management command — see
``manual_audit_api/management/commands/setup_manual_audit.py`` and the nine
``ensure_*_table`` helpers already in ``audit_api``.

Everything here is additive and non-destructive:

* no existing column is altered or dropped — in particular
  ``activity_actual_hours.actual_hours`` keeps its ``numeric`` type;
* no learner row is written;
* re-running is safe.

The base table has no surrogate key, so children reference its composite
primary key ``(learner_id, kind, ref)``.
"""

REVISION_TABLE = '"Last_audit"."activity_actual_hours_revision"'
VALIDATION_TABLE = '"Last_audit"."activity_actual_hours_validation"'
BANK_HOLIDAY_TABLE = '"Last_audit"."bank_holidays_england_wales"'
BASE_TABLE = '"Last_audit"."activity_actual_hours"'


REVISION_DDL = f"""
create table if not exists {REVISION_TABLE} (
    revision_id            bigserial primary key,
    learner_id             bigint not null,
    kind                   text   not null,
    ref                    text   not null,
    aptem_id               bigint,
    selected_month         text   not null,
    previous_actual_hours  numeric,
    proposed_actual_hours  numeric not null,
    proposed_seconds       integer not null,
    previous_seconds       integer,
    calculation_type       text    not null,
    calculation_note       text,
    source_snapshot        text,
    timestamp_label_snapshot text,
    activity_date_snapshot date,
    start_time_snapshot    time,
    end_time_snapshot      time,
    kind_snapshot          text,
    media_duration_seconds integer,
    status                 text    not null default 'pending',
    proposed_by            text    not null,
    proposed_by_source     text,
    proposed_at            timestamptz not null default now(),
    decided_by             text,
    decided_by_source      text,
    decided_at             timestamptz,
    comment                text,
    evidence_ref           text,
    base_fingerprint       text    not null,
    rule_version           text    not null,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now(),
    constraint activity_actual_hours_revision_base_fk
        foreign key (learner_id, kind, ref)
        references {BASE_TABLE} (learner_id, kind, ref)
        on delete cascade,
    constraint activity_actual_hours_revision_status_check
        check (status in ('pending', 'approved', 'rejected', 'superseded')),
    constraint activity_actual_hours_revision_seconds_check
        check (proposed_seconds > 0),
    constraint activity_actual_hours_revision_month_check
        check (selected_month ~ '^[0-9]{{4}}-[0-9]{{2}}$'),
    -- two-person approval, enforced by the database and not only by the service
    constraint activity_actual_hours_revision_two_person_check
        check (decided_by is null or decided_by <> proposed_by),
    constraint activity_actual_hours_revision_decision_check
        check (
            (status in ('pending', 'superseded') and decided_by is null and decided_at is null)
            or (status in ('approved', 'rejected') and decided_by is not null and decided_at is not null)
        )
)
"""

VALIDATION_DDL = f"""
create table if not exists {VALIDATION_TABLE} (
    validation_id    bigserial primary key,
    learner_id       bigint not null,
    kind             text   not null,
    ref              text   not null,
    aptem_id         bigint,
    selected_month   text   not null,
    code             text   not null,
    severity         text   not null,
    status           text   not null default 'active',
    message          text   not null,
    details          jsonb  not null default '{{}}'::jsonb,
    related_ref      text,
    fingerprint      text   not null,
    rule_version     text   not null,
    detected_at      timestamptz not null default now(),
    last_seen_at     timestamptz not null default now(),
    resolved_at      timestamptz,
    resolved_by      text,
    review_comment   text,
    constraint activity_actual_hours_validation_base_fk
        foreign key (learner_id, kind, ref)
        references {BASE_TABLE} (learner_id, kind, ref)
        on delete cascade,
    constraint activity_actual_hours_validation_severity_check
        check (severity in ('informational', 'warning', 'blocking')),
    constraint activity_actual_hours_validation_status_check
        check (status in ('active', 'resolved', 'acknowledged')),
    constraint activity_actual_hours_validation_month_check
        check (selected_month ~ '^[0-9]{{4}}-[0-9]{{2}}$')
)
"""

BANK_HOLIDAY_DDL = f"""
create table if not exists {BANK_HOLIDAY_TABLE} (
    holiday_date  date primary key,
    title         text not null,
    division      text not null default 'england-and-wales',
    data_version  text,
    retrieved_at  timestamptz not null default now()
)
"""

# Statements that are safe to re-run; ``create index if not exists`` keeps the
# helper idempotent without inspecting pg_indexes first.
INDEX_DDL = (
    f"create index if not exists activity_actual_hours_revision_base_idx "
    f"on {REVISION_TABLE} (learner_id, kind, ref)",
    f"create index if not exists activity_actual_hours_revision_scope_idx "
    f"on {REVISION_TABLE} (aptem_id, selected_month)",
    # One pending proposal per unchanged source state: re-running the scan is
    # idempotent by construction, not by hoping the service checked first.
    f"create unique index if not exists activity_actual_hours_revision_pending_uq "
    f"on {REVISION_TABLE} (learner_id, kind, ref, base_fingerprint) where status = 'pending'",
    f"create index if not exists activity_actual_hours_validation_base_idx "
    f"on {VALIDATION_TABLE} (learner_id, kind, ref)",
    f"create index if not exists activity_actual_hours_validation_scope_idx "
    f"on {VALIDATION_TABLE} (aptem_id, selected_month, status, code)",
    f"create unique index if not exists activity_actual_hours_validation_active_uq "
    f"on {VALIDATION_TABLE} (fingerprint) where status = 'active'",
    # Supporting indexes on the base table: it ships with only its primary key,
    # and both the scope read and the overlap scan filter on these columns.
    f"create index if not exists activity_actual_hours_scope_idx "
    f"on {BASE_TABLE} (aptem_id, month)",
    f"create index if not exists activity_actual_hours_overlap_idx "
    f"on {BASE_TABLE} (aptem_id, activity_date, start_time) where reporting_method = 'System'",
)


REQUIRED_TABLES = (
    "activity_actual_hours_revision",
    "activity_actual_hours_validation",
    "bank_holidays_england_wales",
)


def ensure_actual_hours_tables(cursor):
    """Create the review structures if they are missing. Safe to call twice.

    Deliberately NOT called from a request: unlike the older ``ensure_*``
    helpers in this app, this feature's DDL runs only through
    ``manage.py setup_actual_hours_review``, so applying it stays an explicit,
    reviewable act against a named database alias.
    """
    cursor.execute(REVISION_DDL)
    cursor.execute(VALIDATION_DDL)
    cursor.execute(BANK_HOLIDAY_DDL)
    for statement in INDEX_DDL:
        cursor.execute(statement)


def missing_tables(cursor) -> list[str]:
    """Which review tables are not installed yet (read-only check)."""
    cursor.execute(
        """
        select table_name from information_schema.tables
        where table_schema = 'Last_audit' and table_name = any(%s)
        """,
        [list(REQUIRED_TABLES)],
    )
    present = {row[0] for row in cursor.fetchall()}
    return [name for name in REQUIRED_TABLES if name not in present]
