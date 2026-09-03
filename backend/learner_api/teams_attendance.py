from collections import defaultdict
from datetime import datetime, timezone as datetime_timezone

from django.db import connections, router, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from curriculum_api.models import (
    LiveSession,
    LiveSessionAttendance,
    LiveSessionOccurrence,
    ModuleAuthoringModule,
)

from .models import LearnerProfile


def _email(value) -> str:
    return str(value or "").strip().casefold()


def _session_expected_emails(session: LiveSession) -> set[str]:
    """Who this live session's own Teams invite list expects to attend.

    This is now the sole source of "who is expected" for attendance rows: a
    learner's enrolment-side group text is never consulted, so it can no
    longer silently drop a real learner from every row just because their
    group field doesn't textually match the module's. The trade-off runs the
    other way instead: the invite list is a snapshot taken when the meeting
    was created (or last had its people list re-sent), so a learner added to
    the module afterwards stays invisible here until someone resends it.
    """

    return {email for email in (_email(value) for value in (session.attendees or [])) if email}


def _local_datetime(value):
    if value is None:
        return None
    if timezone.is_aware(value):
        return timezone.localtime(value)
    return value


def _graph_datetime(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = parse_datetime(str(value or "").strip())
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, datetime_timezone.utc)
    return parsed


def _attendance_interval_bounds(intervals) -> tuple[datetime | None, datetime | None]:
    first_join = None
    last_leave = None
    for interval in intervals if isinstance(intervals, list) else []:
        if not isinstance(interval, dict):
            continue
        joined = _graph_datetime(interval.get("joinDateTime"))
        left = _graph_datetime(interval.get("leaveDateTime"))
        if joined is not None and (first_join is None or joined < first_join):
            first_join = joined
        if left is not None and (last_leave is None or left > last_leave):
            last_leave = left
    return first_join, last_leave


def fetch_verified_teams_attendance_rows(
    learner_ids: list[int] | None = None,
    learner_emails: list[str] | None = None,
    module_refs: list[str] | None = None,
    *,
    all_learners: bool = False,
    start_date=None,
    end_date=None,
) -> list[dict]:
    """Build real attendance from completed Microsoft Teams reports.

    "Expected" is whoever is on the live session's own Teams invite list
    (see ``_session_expected_emails``), not whoever the learner's enrolment
    record says shares the module's group.
    """

    ids = sorted({int(value) for value in (learner_ids or []) if value})
    emails = sorted({_email(value) for value in (learner_emails or []) if _email(value)})
    modules = sorted({str(value).strip() for value in (module_refs or []) if str(value).strip()})
    if not ids and not emails and not modules and not all_learners:
        return []

    database = router.db_for_read(LearnerProfile) or "default"

    # A caller-supplied learner scope narrows which invitees count, resolved
    # up front to normalised emails (and kept, so the later learner lookup
    # need not repeat this same query). `None` means "no narrowing": every
    # invitee of an in-scope session counts, as opposed to an empty dict,
    # which would wrongly exclude everyone.
    identity_learners_by_email: dict[str, LearnerProfile] | None = None
    if ids or emails:
        identity_filter = Q()
        if ids:
            identity_filter |= Q(id__in=ids)
        if emails:
            identity_filter |= Q(email_normalized__in=emails)
        identity_learners_by_email = {
            _email(learner.email): learner
            for learner in LearnerProfile.objects.using(database).filter(identity_filter)
            if _email(learner.email)
        }
        if not identity_learners_by_email:
            return []

    session_queryset = LiveSession.objects.using(database)
    if modules:
        session_queryset = session_queryset.filter(module_catalogue_id__in=modules)
    sessions = list(
        session_queryset.only("id", "module_catalogue_id", "module_title", "attendees")
    )
    if not sessions:
        return []

    expected_emails_by_session: dict[str, set[str]] = {}
    all_expected_emails: set[str] = set()
    for session in sessions:
        session_emails = _session_expected_emails(session)
        if identity_learners_by_email is not None:
            session_emails &= identity_learners_by_email.keys()
        if not session_emails:
            continue
        expected_emails_by_session[session.id] = session_emails
        all_expected_emails.update(session_emails)
    if not all_expected_emails:
        return []

    sessions_by_id = {
        session.id: session for session in sessions if session.id in expected_emails_by_session
    }

    if identity_learners_by_email is not None:
        learners_by_email = {
            email: identity_learners_by_email[email] for email in all_expected_emails
        }
    else:
        learners_by_email = {
            _email(learner.email): learner
            for learner in LearnerProfile.objects.using(database).filter(
                email_normalized__in=all_expected_emails,
            )
        }
    if not learners_by_email:
        return []

    module_refs_needed = {
        str(session.module_catalogue_id or "").strip() for session in sessions_by_id.values()
    }
    module_rows = ModuleAuthoringModule.objects.using(database).filter(
        module_catalogue_id__in=module_refs_needed,
    ).only("module_catalogue_id", "group_id", "group_name")
    modules_by_id = {row.module_catalogue_id: row for row in module_rows}

    occurrence_queryset = (
        LiveSessionOccurrence.objects.using(database)
        .filter(live_session_id__in=list(sessions_by_id))
        .exclude(Q(attendance_report_id__isnull=True) | Q(attendance_report_id__exact=""))
    )
    # Monthly/reporting callers only need a bounded slice. Applying the range
    # before loading reports prevents one request from materialising every
    # historical occurrence and attendance record for the whole caseload.
    if start_date is not None:
        occurrence_queryset = occurrence_queryset.filter(
            Q(actual_start__date__gte=start_date)
            | Q(actual_start__isnull=True, scheduled_start__date__gte=start_date)
        )
    if end_date is not None:
        occurrence_queryset = occurrence_queryset.filter(
            Q(actual_start__date__lte=end_date)
            | Q(actual_start__isnull=True, scheduled_start__date__lte=end_date)
        )
    occurrences = list(
        occurrence_queryset.order_by("scheduled_start", "session_number", "id")
    )
    if not occurrences:
        return []

    attendance_by_occurrence: dict[str, dict[str, dict]] = defaultdict(dict)
    attendance_records = (
        LiveSessionAttendance.objects.using(database)
        .filter(occurrence_id__in=[occurrence.id for occurrence in occurrences])
        .only(
            "occurrence_id",
            "graph_record_id",
            "email",
            "display_name",
            "total_attendance_seconds",
            "intervals",
        )
    )
    for record in attendance_records:
        email_key = _email(record.email)
        if not email_key:
            continue
        first_join, last_leave = _attendance_interval_bounds(record.intervals)
        existing = attendance_by_occurrence[record.occurrence_id].get(email_key)
        if existing is None:
            attendance_by_occurrence[record.occurrence_id][email_key] = {
                "total_attendance_seconds": max(record.total_attendance_seconds or 0, 0),
                "source_record_id": str(record.graph_record_id or "").strip(),
                "first_join_at": first_join,
                "last_leave_at": last_leave,
            }
        else:
            existing["total_attendance_seconds"] += max(record.total_attendance_seconds or 0, 0)
            if not existing["source_record_id"] and record.graph_record_id:
                existing["source_record_id"] = str(record.graph_record_id).strip()
            if first_join is not None and (
                existing["first_join_at"] is None or first_join < existing["first_join_at"]
            ):
                existing["first_join_at"] = first_join
            if last_leave is not None and (
                existing["last_leave_at"] is None or last_leave > existing["last_leave_at"]
            ):
                existing["last_leave_at"] = last_leave

    rows = []
    calculated_at = timezone.now()
    for occurrence in occurrences:
        session = sessions_by_id.get(occurrence.live_session_id)
        if session is None:
            continue
        module_ref = str(session.module_catalogue_id or "").strip()
        start = _local_datetime(occurrence.actual_start or occurrence.scheduled_start)
        end = _local_datetime(occurrence.actual_end or occurrence.scheduled_end)
        if start is None:
            continue
        title = str(session.module_title or "").strip() or "Live session"
        if occurrence.session_number:
            title = f"{title} — Session {occurrence.session_number}"

        # group_id/group_name are display metadata only now -- a module row
        # that can't be found no longer hides an otherwise-valid invite match.
        module = modules_by_id.get(module_ref)

        for email in expected_emails_by_session.get(session.id, ()):
            learner = learners_by_email.get(email)
            if learner is None:
                continue
            attendance = attendance_by_occurrence[occurrence.id].get(email)
            rows.append(
                {
                    "learner_id": learner.id,
                    "learner_profile_id": learner.id,
                    "enrolment_id": learner.enrolment_id,
                    "learner_name": learner.full_name,
                    "learner_email": learner.email,
                    "session_id": occurrence.id,
                    "occurrence_id": occurrence.id,
                    "live_session_id": session.id,
                    "session_title": title,
                    "session_type": "live_session",
                    "session_date": start.date(),
                    "session_start_time": start.time().replace(tzinfo=None),
                    "session_end_time": end.time().replace(tzinfo=None) if end else None,
                    "attendance_status": "present" if attendance else "absent",
                    "minutes_late": 0,
                    "catchup_completed": False,
                    "absence_reason": "",
                    "attended_seconds": attendance["total_attendance_seconds"] if attendance else 0,
                    "attendance_report_id": occurrence.attendance_report_id,
                    "source_record_id": attendance["source_record_id"] if attendance else "",
                    "module_catalogue_id": module_ref,
                    "module_title": str(session.module_title or "").strip(),
                    "group_id": str(module.group_id or "").strip() if module else "",
                    "group_name": str(module.group_name or "").strip() if module else "",
                    "is_expected": True,
                    "eligibility_reason": "teams_invite_list",
                    "scheduled_start": occurrence.scheduled_start,
                    "scheduled_end": occurrence.scheduled_end,
                    "actual_start": occurrence.actual_start,
                    "actual_end": occurrence.actual_end,
                    "first_join_at": attendance["first_join_at"] if attendance else None,
                    "last_leave_at": attendance["last_leave_at"] if attendance else None,
                    "coach_name": learner.coach_name,
                    "calculated_at": calculated_at,
                    "updated_at": occurrence.artifacts_synced_at or occurrence.updated_at,
                }
            )

    return rows


ATTENDANCE_REPORTING_TABLE = '"Learner"."learner_attendance_details"'
_ATTENDANCE_SCHEMA_READY_DATABASES: set[str] = set()


def ensure_teams_attendance_reporting_columns(database: str = "default") -> None:
    if database in _ATTENDANCE_SCHEMA_READY_DATABASES:
        return
    # PostgreSQL DDL is transactional. Keep the additive schema upgrade, its
    # backfill and the view replacement all-or-nothing on Neon.
    with transaction.atomic(using=database), connections[database].cursor() as cursor:
        # This legacy trigger targets the removed Learner.Absence table and
        # prevents every insert/update on the reporting table.
        cursor.execute(
            f"""
            DROP TRIGGER IF EXISTS learner_attendance_details_sync_absence_counts
            ON {ATTENDANCE_REPORTING_TABLE}
            """
        )
        cursor.execute(
            f"""
            ALTER TABLE {ATTENDANCE_REPORTING_TABLE}
                ADD COLUMN IF NOT EXISTS attended_seconds integer NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS attendance_report_id text,
                ADD COLUMN IF NOT EXISTS live_session_id text,
                ADD COLUMN IF NOT EXISTS source varchar(40) NOT NULL DEFAULT 'legacy',
                ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone,
                ADD COLUMN IF NOT EXISTS enrolment_id bigint,
                ADD COLUMN IF NOT EXISTS learner_profile_id bigint,
                ADD COLUMN IF NOT EXISTS occurrence_id text,
                ADD COLUMN IF NOT EXISTS module_catalogue_id text,
                ADD COLUMN IF NOT EXISTS group_id text,
                ADD COLUMN IF NOT EXISTS group_name text,
                ADD COLUMN IF NOT EXISTS is_expected boolean NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS eligibility_reason varchar(80),
                ADD COLUMN IF NOT EXISTS source_record_id text,
                ADD COLUMN IF NOT EXISTS scheduled_start timestamp with time zone,
                ADD COLUMN IF NOT EXISTS scheduled_end timestamp with time zone,
                ADD COLUMN IF NOT EXISTS actual_start timestamp with time zone,
                ADD COLUMN IF NOT EXISTS actual_end timestamp with time zone,
                ADD COLUMN IF NOT EXISTS first_join_at timestamp with time zone,
                ADD COLUMN IF NOT EXISTS last_leave_at timestamp with time zone,
                ADD COLUMN IF NOT EXISTS calculated_at timestamp with time zone
            """
        )
        cursor.execute(
            f"""
            UPDATE {ATTENDANCE_REPORTING_TABLE}
            SET learner_profile_id = COALESCE(learner_profile_id, learner_id),
                occurrence_id = COALESCE(NULLIF(occurrence_id, ''), session_id),
                calculated_at = COALESCE(calculated_at, synced_at, updated_at, created_at)
            WHERE source = 'microsoft_teams'
              AND (
                    learner_profile_id IS NULL
                 OR occurrence_id IS NULL
                 OR occurrence_id = ''
                 OR calculated_at IS NULL
              )
            """
        )
        cursor.execute(
            f"""
            UPDATE {ATTENDANCE_REPORTING_TABLE} attendance
            SET module_catalogue_id = session.module_catalogue_id,
                group_id = module.group_id,
                group_name = module.group_name
            FROM curriculum.live_sessions session
            LEFT JOIN curriculum.modules module
                   ON module.module_catalogue_id = session.module_catalogue_id
            WHERE attendance.source = 'microsoft_teams'
              AND attendance.live_session_id = session.id
              AND (
                    attendance.module_catalogue_id IS NULL
                 OR attendance.group_id IS NULL
                 OR attendance.group_name IS NULL
              )
            """
        )
        cursor.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_attendance_details_source
            ON {ATTENDANCE_REPORTING_TABLE} (source)
            """
        )
        cursor.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_attendance_details_learner_source_date
            ON {ATTENDANCE_REPORTING_TABLE} (learner_id, source, session_date DESC)
            """
        )
        cursor.execute(
            f"""
            CREATE INDEX IF NOT EXISTS idx_attendance_details_module_group
            ON {ATTENDANCE_REPORTING_TABLE} (module_catalogue_id, group_id)
            WHERE source = 'microsoft_teams' AND is_expected
            """
        )
        cursor.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_details_profile_occurrence
            ON {ATTENDANCE_REPORTING_TABLE} (learner_profile_id, occurrence_id)
            WHERE source = 'microsoft_teams'
              AND learner_profile_id IS NOT NULL
              AND occurrence_id IS NOT NULL
            """
        )
        cursor.execute(
            f"""
            CREATE OR REPLACE VIEW "Learner"."verified_teams_attendance" AS
            SELECT *
            FROM {ATTENDANCE_REPORTING_TABLE}
            WHERE source = 'microsoft_teams' AND is_expected
            """
        )
    transaction.on_commit(
        lambda: _ATTENDANCE_SCHEMA_READY_DATABASES.add(database),
        using=database,
    )


def _verified_occurrence_ids(database: str, module_refs: list[str] | None = None) -> list[str]:
    sessions = LiveSession.objects.using(database).all()
    modules = sorted({str(value).strip() for value in (module_refs or []) if str(value).strip()})
    if modules:
        sessions = sessions.filter(module_catalogue_id__in=modules)
    session_ids = list(sessions.values_list("id", flat=True))
    if not session_ids:
        return []
    return list(
        LiveSessionOccurrence.objects.using(database)
        .filter(live_session_id__in=session_ids)
        .exclude(Q(attendance_report_id__isnull=True) | Q(attendance_report_id__exact=""))
        .values_list("id", flat=True)
    )


def sync_verified_teams_attendance_reporting(
    learner_ids: list[int] | None = None,
    learner_emails: list[str] | None = None,
    module_refs: list[str] | None = None,
    *,
    all_learners: bool = False,
) -> int:
    """Rebuild the scoped part of the learner attendance read model."""

    database = router.db_for_write(LearnerProfile) or "default"
    scoped_modules = sorted(
        {str(value).strip() for value in (module_refs or []) if str(value).strip()}
    )
    rows = fetch_verified_teams_attendance_rows(
        learner_ids,
        learner_emails,
        module_refs,
        all_learners=all_learners,
    )
    occurrence_ids = (
        _verified_occurrence_ids(database, module_refs)
        if all_learners or module_refs
        else []
    )
    if not rows and not occurrence_ids and not scoped_modules and not all_learners:
        return 0

    query = f"""
        INSERT INTO {ATTENDANCE_REPORTING_TABLE} (
            learner_id, learner_name, learner_email,
            learner_profile_id, enrolment_id,
            session_id, session_title, session_type,
            occurrence_id,
            session_date, session_start_time, session_end_time,
            attendance_status, minutes_late, absence_reason,
            catchup_completed, coach_name, module_title,
            attended_seconds, attendance_report_id, live_session_id,
            module_catalogue_id, group_id, group_name,
            is_expected, eligibility_reason, source_record_id,
            scheduled_start, scheduled_end, actual_start, actual_end,
            first_join_at, last_leave_at,
            source, synced_at, calculated_at, updated_at
        ) VALUES (
            %s, %s, %s,
            %s, %s,
            %s, %s, %s,
            %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s,
            'microsoft_teams', CURRENT_TIMESTAMP, %s, %s
        )
        ON CONFLICT (learner_id, session_id) DO UPDATE SET
            learner_name = EXCLUDED.learner_name,
            learner_email = EXCLUDED.learner_email,
            learner_profile_id = EXCLUDED.learner_profile_id,
            enrolment_id = EXCLUDED.enrolment_id,
            session_title = EXCLUDED.session_title,
            session_type = EXCLUDED.session_type,
            occurrence_id = EXCLUDED.occurrence_id,
            session_date = EXCLUDED.session_date,
            session_start_time = EXCLUDED.session_start_time,
            session_end_time = EXCLUDED.session_end_time,
            attendance_status = EXCLUDED.attendance_status,
            minutes_late = EXCLUDED.minutes_late,
            absence_reason = EXCLUDED.absence_reason,
            catchup_completed = EXCLUDED.catchup_completed,
            coach_name = EXCLUDED.coach_name,
            module_title = EXCLUDED.module_title,
            attended_seconds = EXCLUDED.attended_seconds,
            attendance_report_id = EXCLUDED.attendance_report_id,
            live_session_id = EXCLUDED.live_session_id,
            module_catalogue_id = EXCLUDED.module_catalogue_id,
            group_id = EXCLUDED.group_id,
            group_name = EXCLUDED.group_name,
            is_expected = EXCLUDED.is_expected,
            eligibility_reason = EXCLUDED.eligibility_reason,
            source_record_id = EXCLUDED.source_record_id,
            scheduled_start = EXCLUDED.scheduled_start,
            scheduled_end = EXCLUDED.scheduled_end,
            actual_start = EXCLUDED.actual_start,
            actual_end = EXCLUDED.actual_end,
            first_join_at = EXCLUDED.first_join_at,
            last_leave_at = EXCLUDED.last_leave_at,
            source = EXCLUDED.source,
            synced_at = CURRENT_TIMESTAMP,
            calculated_at = EXCLUDED.calculated_at,
            updated_at = EXCLUDED.updated_at
    """
    params = [
        (
            row["learner_id"],
            row["learner_name"],
            row["learner_email"],
            row["learner_profile_id"],
            row["enrolment_id"],
            row["session_id"],
            row["session_title"],
            row["session_type"],
            row["occurrence_id"],
            row["session_date"],
            row["session_start_time"],
            row["session_end_time"],
            row["attendance_status"],
            row["minutes_late"],
            row["absence_reason"],
            row["catchup_completed"],
            row["coach_name"],
            row["module_title"],
            row["attended_seconds"],
            row["attendance_report_id"],
            row["live_session_id"],
            row["module_catalogue_id"],
            row["group_id"],
            row["group_name"],
            row["is_expected"],
            row["eligibility_reason"],
            row["source_record_id"],
            row["scheduled_start"],
            row["scheduled_end"],
            row["actual_start"],
            row["actual_end"],
            row["first_join_at"],
            row["last_leave_at"],
            row["calculated_at"],
            row["updated_at"],
        )
        for row in rows
    ]
    with transaction.atomic(using=database):
        # Publish the schema/view change and its rebuilt roster together, so a
        # concurrent learner request cannot observe the new view before stale
        # eligibility has been reconciled.
        ensure_teams_attendance_reporting_columns(database)
        with connections[database].cursor() as cursor:
            # Retain stale rows for audit/absence-report foreign keys, but hide
            # them from the read view until this roster rebuild marks them
            # expected again in the upsert below.
            if all_learners:
                cursor.execute(
                    f"""
                    UPDATE {ATTENDANCE_REPORTING_TABLE}
                    SET is_expected = false,
                        eligibility_reason = 'not_in_current_teams_invite_list',
                        calculated_at = CURRENT_TIMESTAMP
                    WHERE source = 'microsoft_teams'
                    """
                )
            elif scoped_modules:
                cursor.execute(
                    f"""
                    UPDATE {ATTENDANCE_REPORTING_TABLE}
                    SET is_expected = false,
                        eligibility_reason = 'not_in_current_teams_invite_list',
                        calculated_at = CURRENT_TIMESTAMP
                    WHERE source = 'microsoft_teams'
                      AND (
                            module_catalogue_id = ANY(%s)
                         OR occurrence_id = ANY(%s)
                      )
                    """,
                    [scoped_modules, occurrence_ids],
                )
            if params:
                cursor.executemany(query, params)
    return len(rows)
