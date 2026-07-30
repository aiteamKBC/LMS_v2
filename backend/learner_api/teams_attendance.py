from collections import defaultdict

from django.db import connections, router, transaction
from django.db.models import Q
from django.utils import timezone

from curriculum_api.models import LiveSession, LiveSessionAttendance, LiveSessionOccurrence

from .models import LearnerProfile


def _email(value) -> str:
    return str(value or "").strip().casefold()


def _local_datetime(value):
    if value is None:
        return None
    if timezone.is_aware(value):
        return timezone.localtime(value)
    return value


def fetch_verified_teams_attendance_rows(
    learner_ids: list[int] | None = None,
    learner_emails: list[str] | None = None,
    module_refs: list[str] | None = None,
    *,
    all_learners: bool = False,
) -> list[dict]:
    """Build real attendance from completed Microsoft Teams reports."""

    ids = sorted({int(value) for value in (learner_ids or []) if value})
    emails = sorted({_email(value) for value in (learner_emails or []) if _email(value)})
    modules = sorted({str(value).strip() for value in (module_refs or []) if str(value).strip()})
    if not ids and not emails and not modules and not all_learners:
        return []

    database = router.db_for_read(LearnerProfile) or "default"
    learner_filter = Q()
    if ids:
        learner_filter |= Q(id__in=ids)
    if emails:
        learner_filter |= Q(email_normalized__in=emails)
    if modules:
        learner_filter |= Q(plan_modules__module_ref__in=modules)

    learner_queryset = LearnerProfile.objects.using(database).prefetch_related("plan_modules")
    if learner_filter:
        learner_queryset = learner_queryset.filter(learner_filter)
    learners = list(learner_queryset.distinct())
    if not learners:
        return []

    learners_by_module: dict[str, list[LearnerProfile]] = defaultdict(list)
    for learner in learners:
        seen_modules = set()
        for plan_module in learner.plan_modules.all():
            module_ref = str(plan_module.module_ref or "").strip()
            if module_ref and module_ref not in seen_modules:
                learners_by_module[module_ref].append(learner)
                seen_modules.add(module_ref)
    if not learners_by_module:
        return []

    sessions = list(
        LiveSession.objects.using(database)
        .filter(module_catalogue_id__in=list(learners_by_module))
        .only("id", "module_catalogue_id", "module_title")
    )
    if not sessions:
        return []

    sessions_by_id = {session.id: session for session in sessions}
    occurrences = list(
        LiveSessionOccurrence.objects.using(database)
        .filter(live_session_id__in=list(sessions_by_id))
        .exclude(Q(attendance_report_id__isnull=True) | Q(attendance_report_id__exact=""))
        .order_by("scheduled_start", "session_number", "id")
    )
    if not occurrences:
        return []

    attendance_by_occurrence: dict[str, dict[str, dict]] = defaultdict(dict)
    attendance_records = (
        LiveSessionAttendance.objects.using(database)
        .filter(occurrence_id__in=[occurrence.id for occurrence in occurrences])
        .only("occurrence_id", "email", "display_name", "total_attendance_seconds")
    )
    for record in attendance_records:
        email_key = _email(record.email)
        if not email_key:
            continue
        existing = attendance_by_occurrence[record.occurrence_id].get(email_key)
        if existing is None:
            attendance_by_occurrence[record.occurrence_id][email_key] = {
                "total_attendance_seconds": max(record.total_attendance_seconds or 0, 0),
            }
        else:
            existing["total_attendance_seconds"] += max(record.total_attendance_seconds or 0, 0)

    rows = []
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

        for learner in learners_by_module.get(module_ref, []):
            attendance = attendance_by_occurrence[occurrence.id].get(_email(learner.email))
            rows.append(
                {
                    "learner_id": learner.id,
                    "learner_name": learner.full_name,
                    "learner_email": learner.email,
                    "session_id": occurrence.id,
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
                    "module_title": str(session.module_title or "").strip(),
                    "coach_name": learner.coach_name,
                    "updated_at": occurrence.artifacts_synced_at or occurrence.updated_at,
                }
            )

    return rows


ATTENDANCE_REPORTING_TABLE = '"Learner"."learner_attendance_details"'


def ensure_teams_attendance_reporting_columns(database: str = "default") -> None:
    with connections[database].cursor() as cursor:
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
                ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone
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
            CREATE OR REPLACE VIEW "Learner"."verified_teams_attendance" AS
            SELECT *
            FROM {ATTENDANCE_REPORTING_TABLE}
            WHERE source = 'microsoft_teams'
            """
        )


def sync_verified_teams_attendance_reporting(
    learner_ids: list[int] | None = None,
    learner_emails: list[str] | None = None,
    module_refs: list[str] | None = None,
    *,
    all_learners: bool = False,
) -> int:
    """Upsert verified Teams attendance into the flat reporting table."""

    database = router.db_for_write(LearnerProfile) or "default"
    rows = fetch_verified_teams_attendance_rows(
        learner_ids,
        learner_emails,
        module_refs,
        all_learners=all_learners,
    )
    ensure_teams_attendance_reporting_columns(database)
    if not rows:
        return 0

    query = f"""
        INSERT INTO {ATTENDANCE_REPORTING_TABLE} (
            learner_id, learner_name, learner_email,
            session_id, session_title, session_type,
            session_date, session_start_time, session_end_time,
            attendance_status, minutes_late, absence_reason,
            catchup_completed, coach_name, module_title,
            attended_seconds, attendance_report_id, live_session_id,
            source, synced_at, updated_at
        ) VALUES (
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            %s, %s, %s,
            'microsoft_teams', CURRENT_TIMESTAMP, %s
        )
        ON CONFLICT (learner_id, session_id) DO UPDATE SET
            learner_name = EXCLUDED.learner_name,
            learner_email = EXCLUDED.learner_email,
            session_title = EXCLUDED.session_title,
            session_type = EXCLUDED.session_type,
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
            source = EXCLUDED.source,
            synced_at = CURRENT_TIMESTAMP,
            updated_at = EXCLUDED.updated_at
    """
    params = [
        (
            row["learner_id"],
            row["learner_name"],
            row["learner_email"],
            row["session_id"],
            row["session_title"],
            row["session_type"],
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
            row["updated_at"],
        )
        for row in rows
    ]
    with transaction.atomic(using=database):
        with connections[database].cursor() as cursor:
            cursor.executemany(query, params)
    return len(rows)
