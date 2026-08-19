"""Scoped reads for the Actual Hours review.

Two rules run through every query here:

* **learner + month scope is a predicate, not a filter applied later.** Every
  per-learner read carries ``aptem_id`` and ``month``.
* **global analytics are aggregates.** They never load rows into memory and
  never appear in the same transaction as a write.

Band boundaries are interpolated from ``rules.py`` constants so the SQL cannot
drift away from the Python classifier.
"""

from __future__ import annotations

from . import rules
from .tables import BASE_TABLE, REVISION_TABLE, VALIDATION_TABLE


ACTIVITIES_TABLE = '"Last_audit"."activities"'

_ELIGIBLE_KINDS_SQL = "('reading_quiz', 'video', 'audio')"

# Observed duration in seconds: genuine elapsed wall-clock for a System row,
# otherwise the stored decimal hours. Nothing is invented — a row without either
# yields NULL and is reported as such.
_SECONDS_SQL = """
    case
        when ah.reporting_method = 'System'
             and ah.start_time is not null and ah.end_time is not null
            then extract(epoch from (ah.end_time - ah.start_time))::int
        when ah.actual_hours is not null
            then round(ah.actual_hours * 3600)::int
    end
"""

_MEDIA_SECONDS_SQL = """
    case
        when act.configured_duration_min is not null and act.configured_duration_min > 0
            then round(act.configured_duration_min * 60)::int
    end
"""


def _bounds_sql() -> str:
    """normal_min / normal_max / maximum per kind and source, from rules.py."""
    return f"""
        case
            when d.kind in ('video', 'audio') and d.media_seconds is not null then
                greatest({rules.MINIMUM_DURATION_SECONDS},
                         d.media_seconds - case when d.is_timestamped
                                                then {rules.TIMESTAMPED_MEDIA_TOLERANCE_SECONDS}
                                                else {rules.INPUT_MEDIA_TOLERANCE_SECONDS} end)
            when d.kind in ('video', 'audio') then null
            when d.is_timestamped then {rules.TIMESTAMPED_READING_NORMAL_MIN}
            else {rules.INPUT_READING_NORMAL_MIN}
        end as normal_min,
        case
            when d.kind in ('video', 'audio') and d.media_seconds is not null then
                d.media_seconds + case when d.is_timestamped
                                       then {rules.TIMESTAMPED_MEDIA_TOLERANCE_SECONDS}
                                       else {rules.INPUT_MEDIA_TOLERANCE_SECONDS} end
            when d.kind in ('video', 'audio') then null
            when d.is_timestamped then {rules.TIMESTAMPED_READING_NORMAL_MAX}
            else {rules.INPUT_READING_NORMAL_MAX}
        end as normal_max,
        case
            when d.kind in ('video', 'audio') and d.media_seconds is not null then 2 * d.media_seconds
            when d.kind in ('video', 'audio') then null
            else {rules.READING_QUIZ_MAX_SECONDS}
        end as maximum
    """


_BAND_SQL = f"""
    case
        when b.seconds is null then '{rules.BAND_UNCLASSIFIABLE}'
        when b.maximum is null then '{rules.BAND_UNCLASSIFIABLE}'
        when b.seconds < {rules.MINIMUM_DURATION_SECONDS} then '{rules.BAND_BELOW_MINIMUM}'
        when b.seconds > b.maximum then '{rules.BAND_EXCESSIVE}'
        when b.seconds < b.normal_min then '{rules.BAND_BELOW_NORMAL}'
        when b.seconds <= b.normal_max then '{rules.BAND_NORMAL}'
        else '{rules.BAND_LONG_TAIL}'
    end
"""


def _dict_rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def scope_rows(cursor, aptem_id: int, month: str) -> list[dict]:
    """Every eligible LMS row for one learner in one month, with media duration."""
    cursor.execute(
        f"""
        select ah.learner_id, ah.aptem_id, ah.kind, ah.ref, ah.title, ah.month,
               ah.actual_hours, ah.reported_hours, ah.reporting_method, ah.timestamp_label,
               ah.activity_date, ah.start_time, ah.end_time, ah.source, ah.updated_at,
               {_MEDIA_SECONDS_SQL} as media_seconds
        from {BASE_TABLE} ah
        left join {ACTIVITIES_TABLE} act on act.activity_id::text = ah.ref
        where ah.aptem_id = %s and ah.month = %s and ah.kind in {_ELIGIBLE_KINDS_SQL}
        order by ah.activity_date, ah.start_time nulls last, ah.kind, ah.ref
        """,
        [aptem_id, month],
    )
    return _dict_rows(cursor)


def base_row(cursor, learner_id: int, kind: str, ref: str) -> dict | None:
    """One base row by its composite primary key, with media duration."""
    cursor.execute(
        f"""
        select ah.learner_id, ah.aptem_id, ah.kind, ah.ref, ah.title, ah.month,
               ah.actual_hours, ah.reporting_method, ah.timestamp_label,
               ah.activity_date, ah.start_time, ah.end_time, ah.source, ah.updated_at,
               {_MEDIA_SECONDS_SQL} as media_seconds
        from {BASE_TABLE} ah
        left join {ACTIVITIES_TABLE} act on act.activity_id::text = ah.ref
        where ah.learner_id = %s and ah.kind = %s and ah.ref = %s
        """,
        [learner_id, kind, ref],
    )
    rows = _dict_rows(cursor)
    return rows[0] if rows else None


def lock_base_row(cursor, learner_id: int, kind: str, ref: str) -> dict | None:
    """``SELECT … FOR UPDATE`` on the base row, for the approval transaction."""
    cursor.execute(
        f"""
        select learner_id, aptem_id, kind, ref, month, actual_hours, reporting_method,
               timestamp_label, activity_date, start_time, end_time, source, updated_at
        from {BASE_TABLE}
        where learner_id = %s and kind = %s and ref = %s
        for update
        """,
        [learner_id, kind, ref],
    )
    rows = _dict_rows(cursor)
    return rows[0] if rows else None


def analytics(cursor, aptem_id: int | None = None, month: str | None = None) -> dict:
    """Source and long-tail aggregates for one scope.

    ``aptem_id``/``month`` omitted = the whole eligible LMS population, read-only.
    """
    conditions = [f"ah.kind in {_ELIGIBLE_KINDS_SQL}"]
    params: list = []
    if aptem_id is not None:
        conditions.append("ah.aptem_id = %s")
        params.append(aptem_id)
    if month is not None:
        conditions.append("ah.month = %s")
        params.append(month)

    cursor.execute(
        f"""
        with d as (
            select ah.kind,
                   (ah.reporting_method = 'System') as is_timestamped,
                   ah.reporting_method,
                   {_SECONDS_SQL} as seconds,
                   {_MEDIA_SECONDS_SQL} as media_seconds
            from {BASE_TABLE} ah
            left join {ACTIVITIES_TABLE} act on act.activity_id::text = ah.ref
            where {' and '.join(conditions)}
        ),
        b as (select d.*, {_bounds_sql()} from d),
        c as (select b.*, {_BAND_SQL} as band from b)
        select count(*) as eligible,
               count(*) filter (where reporting_method = 'System') as timestamped,
               count(*) filter (where reporting_method = 'Input') as input_rows,
               count(*) filter (where reporting_method not in ('System', 'Input')
                                   or reporting_method is null) as other_rows,
               count(*) filter (where band <> '{rules.BAND_UNCLASSIFIABLE}') as classifiable,
               count(*) filter (where band = '{rules.BAND_LONG_TAIL}') as long_tail,
               count(*) filter (where band = '{rules.BAND_UNCLASSIFIABLE}') as unclassifiable,
               count(*) filter (where band = '{rules.BAND_BELOW_MINIMUM}') as below_minimum,
               count(*) filter (where band = '{rules.BAND_BELOW_NORMAL}') as below_normal,
               count(*) filter (where band = '{rules.BAND_NORMAL}') as normal_band,
               count(*) filter (where band = '{rules.BAND_EXCESSIVE}') as excessive
        from c
        """,
        params,
    )
    row = _dict_rows(cursor)[0]
    source = rules.source_analytics(row["timestamped"], row["input_rows"], row["other_rows"])
    tail = rules.long_tail_analytics(row["eligible"], row["classifiable"],
                                     row["long_tail"], row["unclassifiable"])
    return {"counts": row, "source": source, "long_tail": tail}


def unscoped_row_count(cursor) -> int:
    """Eligible LMS rows with no ``aptem_id`` — real rows that no learner-scoped
    page can reach. Reported as coverage, never silently dropped."""
    cursor.execute(
        f"""select count(*) from {BASE_TABLE}
            where aptem_id is null and kind in {_ELIGIBLE_KINDS_SQL}"""
    )
    return int(cursor.fetchone()[0])


def active_findings(cursor, aptem_id: int, month: str) -> list[dict]:
    cursor.execute(
        f"""
        select validation_id, learner_id, kind, ref, code, severity, status, message,
               details, related_ref, fingerprint, detected_at, last_seen_at
        from {VALIDATION_TABLE}
        where aptem_id = %s and selected_month = %s and status = 'active'
        order by kind, ref, code
        """,
        [aptem_id, month],
    )
    return _dict_rows(cursor)


def blocking_findings_for_row(cursor, learner_id: int, kind: str, ref: str) -> list[dict]:
    cursor.execute(
        f"""
        select code, message from {VALIDATION_TABLE}
        where learner_id = %s and kind = %s and ref = %s
          and status = 'active' and severity = '{rules.SEVERITY_BLOCKING}'
        """,
        [learner_id, kind, ref],
    )
    return _dict_rows(cursor)


def revisions(cursor, aptem_id: int, month: str) -> list[dict]:
    cursor.execute(
        f"""
        select revision_id, learner_id, kind, ref, status, previous_actual_hours,
               proposed_actual_hours, proposed_seconds, calculation_type, calculation_note,
               proposed_by, proposed_at, decided_by, decided_at, comment, base_fingerprint
        from {REVISION_TABLE}
        where aptem_id = %s and selected_month = %s
        order by proposed_at desc, revision_id desc
        """,
        [aptem_id, month],
    )
    return _dict_rows(cursor)


def lock_revision(cursor, revision_id: int) -> dict | None:
    cursor.execute(
        f"""
        select revision_id, learner_id, kind, ref, aptem_id, selected_month, status,
               proposed_actual_hours, proposed_seconds, previous_actual_hours,
               calculation_type, proposed_by, base_fingerprint
        from {REVISION_TABLE}
        where revision_id = %s
        for update
        """,
        [revision_id],
    )
    rows = _dict_rows(cursor)
    return rows[0] if rows else None
