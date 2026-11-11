"""Read, and correct, learners' saved attendance for the bulk register.

KBC history is combined with the LMS live-session register; on a date both
cover, the live register wins. A saved correction updates the record in its
own source: kbc_attendance."Attendance" for KBC rows, the live register's
attendance_status for live rows.
"""
import json
import re
from datetime import date

import psycopg
from psycopg.rows import dict_row
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .bulk_attendance_kbc_source import LINKED_TABLE, NEW_DATABASE, dict_rows, new_database_cursor, on_new_database
from .bulk_attendance_learners import learner_directory_dsn
from .bulk_attendance_live_policy import live_days_per_learner, merge_live_over_kbc, parse_attendance_changes


def _live_register(kbc_id=None, kbc_ids=None):
    # Imported here so the KBC reader stays usable without the ORM loaded.
    from .bulk_attendance_live_register import read_live_register_or_warning
    if kbc_ids is None:
        return read_live_register_or_warning(kbc_id)
    return read_live_register_or_warning(kbc_id, kbc_ids=kbc_ids)


def _live_day_learner_ids(session_date):
    from .bulk_attendance_live_register import read_live_day_learner_ids
    return read_live_day_learner_ids(session_date)


def kbc_dsn():
    """Where KBC attendance is read: the new database's link, else the direct DSN.

    ``''`` still means "not configured" for the direct connection. On the new
    database the pooled application connection needs no DSN of its own.
    """
    return NEW_DATABASE if on_new_database() else learner_directory_dsn()


# The record columns every KBC read returns, in the shape _map_kbc_history_rows reads.
KBC_RECORD_COLUMNS = '''
    "key"::text AS "recordKey",
    "ID"::text AS "learnerId",
    "date"::text AS "sessionDate",
    coalesce("module", '') AS "moduleName",
    coalesce("lecture_name", '') AS "lectureName",
    "Attendance" AS attendance_value,
    "attendance_status" AS source_status'''


def read_kbc_day_learner_ids(dsn, session_date):
    """Membership in a saved day, including real unmarked records."""
    if dsn == NEW_DATABASE:
        with new_database_cursor(read_only=True) as cursor:
            cursor.execute(
                f'''SELECT DISTINCT "ID"::text FROM {LINKED_TABLE}
                    WHERE "date" = %s AND "ID" IS NOT NULL''',
                [session_date],
            )
            return {str(row[0]).strip() for row in cursor.fetchall()}
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        connection.read_only = True
        connection.execute("SET LOCAL statement_timeout = '10s'")
        return {
            str(row[0]).strip()
            for row in connection.execute(
                '''SELECT DISTINCT "ID"::text FROM public.kbc_attendance
                   WHERE "date" = %s AND "ID" IS NOT NULL''',
                [session_date],
            ).fetchall()
        }


@require_GET
def bulk_attendance_day_learners(request):
    from django.db import DatabaseError

    value = str(request.GET.get('date') or '').strip()
    try:
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError
        session_date = date.fromisoformat(value)
    except ValueError:
        return JsonResponse({'error': 'Choose a valid attendance date.'}, status=400)
    try:
        dsn = kbc_dsn()
        if not dsn:
            return JsonResponse({'error': 'KBC attendance is not configured.'}, status=503)
        # No recent-record limit: old days must work even outside Last 4.
        learner_ids = read_kbc_day_learner_ids(dsn, session_date)
        learner_ids.update(_live_day_learner_ids(session_date))
    except (psycopg.Error, DatabaseError):
        return JsonResponse({'error': 'Unable to load attendance for this date. Please try again.'}, status=503)
    return _with_warnings({'date': value, 'learnerIds': sorted(learner_ids)}, None)


def _save_live_attendance(changes, *, actor=''):
    from .bulk_attendance_live_register import save_live_attendance
    return save_live_attendance(changes, actor=actor)


def save_kbc_attendance(dsn, changes):
    """Set "Attendance" (1 present, 0 absent) on the given KBC keys, all or nothing.

    A 'makeup' flag is kept; an 'absent' flag is cleared when marking present,
    since it would otherwise still read as absent. kbc_attendance's own trigger
    records each change in lms_attendance_changes.
    """
    keys = list(changes)
    if dsn == NEW_DATABASE:
        return _save_linked_kbc_attendance(changes)
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        connection.execute("SET LOCAL statement_timeout = '10s'")
        found = {
            row[0] for row in connection.execute(
                'SELECT "key" FROM public.kbc_attendance WHERE "key" = ANY(%s) FOR UPDATE',
                [keys],
            ).fetchall()
        }
        missing = sorted(set(keys) - found)
        if missing:
            raise LookupError(missing)
        with connection.cursor() as cursor:
            cursor.executemany(
                '''UPDATE public.kbc_attendance
                   SET "Attendance" = %s,
                       attendance_status = CASE
                           WHEN %s = 1 AND attendance_status = 'absent' THEN NULL
                           ELSE attendance_status END
                   WHERE "key" = %s''',
                [(1 if status == 'present' else 0, 1 if status == 'present' else 0, key)
                 for key, status in changes.items()],
            )
    return sorted(keys)


KBC_ATTENDANCE_UPDATE = '''UPDATE {table}
   SET "Attendance" = %s,
       attendance_status = CASE
           WHEN %s = 1 AND attendance_status = 'absent' THEN NULL
           ELSE attendance_status END
   WHERE "key" = %s'''


def _save_linked_kbc_attendance(changes):
    """save_kbc_attendance through the new database's link, in one transaction."""
    keys = list(changes)
    with new_database_cursor(read_only=False) as cursor:
        cursor.execute(f'SELECT "key" FROM {LINKED_TABLE} WHERE "key" = ANY(%s) FOR UPDATE', [keys])
        found = {row[0] for row in cursor.fetchall()}
        missing = sorted(set(keys) - found)
        if missing:
            raise LookupError(missing)
        cursor.executemany(
            KBC_ATTENDANCE_UPDATE.format(table=LINKED_TABLE),
            [(1 if status == 'present' else 0, 1 if status == 'present' else 0, key)
             for key, status in changes.items()],
        )
    return sorted(keys)


def _change_keys(live_ids, kbc_keys):
    return [f'live:{row_id}' for row_id in live_ids] + list(kbc_keys)


@require_POST
def bulk_attendance_save_attendance(request):
    """Correct present/absent on KBC history and live-register records."""
    try:
        body = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid request.'}, status=400)
    try:
        live, kbc = parse_attendance_changes(body.get('changes') if isinstance(body, dict) else None)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)

    from django.db import DatabaseError

    # Two databases cannot share a transaction: each source is all-or-nothing,
    # and a later failure reports exactly what the earlier one already saved.
    saved_kbc = []
    if kbc:
        try:
            dsn = kbc_dsn()
            if not dsn:
                return JsonResponse({'error': 'KBC attendance is not configured. Nothing was saved.'}, status=503)
            saved_kbc = save_kbc_attendance(dsn, kbc)
        except LookupError:
            return JsonResponse({'error': 'One or more KBC records no longer exist. Nothing was saved.'}, status=404)
        except (psycopg.Error, DatabaseError):
            return JsonResponse({'error': 'KBC attendance could not be saved. Nothing was changed; please try again.'}, status=503)

    saved_live = []
    if live:
        try:
            actor = str(getattr(getattr(request, 'login_account', None), 'email', '') or '').strip()
            saved_live = _save_live_attendance(live, actor=actor)
        except (LookupError, DatabaseError) as exc:
            missing = isinstance(exc, LookupError)
            if not saved_kbc:
                message = ('One or more live register records no longer exist. Nothing was saved.' if missing
                           else 'Attendance could not be saved. Nothing was changed; please try again.')
                return JsonResponse({'error': message}, status=404 if missing else 503)
            return JsonResponse({
                'error': (f'{len(saved_kbc)} KBC change(s) were saved, but the live register changes were not. '
                          'Please review and try those again.'),
                'updated': _change_keys([], saved_kbc),
                'partial': True,
            }, status=409 if missing else 503)
    return JsonResponse({'updated': _change_keys(saved_live, saved_kbc)})


@require_POST
def bulk_attendance_delete_attendance(request):
    """Delete one saved attendance record without deleting its session."""
    try:
        body = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid request.'}, status=400)
    if not isinstance(body, dict):
        return JsonResponse({'error': 'Invalid request.'}, status=400)
    source = str(body.get('source') or '').strip().lower()
    record_key = str(body.get('recordKey') or '').strip()
    if source == 'kbc':
        if not record_key or len(record_key) > 500:
            return JsonResponse({'error': 'A KBC record key is invalid.'}, status=400)
        try:
            dsn = kbc_dsn()
            if not dsn:
                return JsonResponse({'error': 'KBC attendance is not configured.'}, status=503)
            if dsn == NEW_DATABASE:
                with new_database_cursor(read_only=False) as cursor:
                    cursor.execute(f'DELETE FROM {LINKED_TABLE} WHERE "key" = %s RETURNING "key"', [record_key])
                    deleted = cursor.fetchone()
            else:
                with psycopg.connect(dsn, connect_timeout=10) as connection:
                    connection.execute("SET LOCAL statement_timeout = '10s'")
                    deleted = connection.execute(
                        'DELETE FROM public.kbc_attendance WHERE "key" = %s RETURNING "key"',
                        [record_key],
                    ).fetchone()
            if not deleted:
                return JsonResponse({'error': 'The attendance record no longer exists.'}, status=404)
        except (psycopg.Error, DatabaseError):
            return JsonResponse({'error': 'Attendance could not be deleted. Please try again.'}, status=503)
    elif source == 'live':
        match = re.fullmatch(r'live:(\d{1,18})', record_key)
        if not match:
            return JsonResponse({'error': 'A live register record key is invalid.'}, status=400)
        from django.db import router, transaction
        from .models import LiveSession, LiveSessionLearnerAttendance
        from coach_api.models import CoachAttendanceSourceAdjustment
        row_id = int(match.group(1))
        database = router.db_for_write(LiveSessionLearnerAttendance)
        with transaction.atomic(using=database):
            row = LiveSessionLearnerAttendance.objects.using(database).filter(id=row_id).values(
                'learner_profile_id', 'occurrence_id', 'live_session_id', 'module_catalogue_id',
            ).first()
            if not row:
                return JsonResponse({'error': 'The attendance record no longer exists.'}, status=404)
            owners = dict(LiveSession.objects.using(database).filter(
                id=row['live_session_id'],
            ).values_list('id', 'module_catalogue_id'))
            source_id = row['occurrence_id']
            if owners.get(row['live_session_id']) != row['module_catalogue_id']:
                source_id = f"{row['occurrence_id']}:{row['module_catalogue_id']}"
            CoachAttendanceSourceAdjustment.objects.using(database).filter(
                learner_id=row['learner_profile_id'], source='microsoft-teams', source_id=source_id,
            ).update(is_deleted=True, status='')
            LiveSessionLearnerAttendance.objects.using(database).filter(id=row_id).delete()
    else:
        return JsonResponse({'error': 'The attendance record source is invalid.'}, status=400)
    return JsonResponse({'deleted': record_key})


def _session_number(lecture_name):
    match = re.search(r'\b(?:lecture|lec|session|l)\s*#?\s*(\d+)\b', lecture_name or '', re.I)
    return int(match.group(1)) if match else None


def _attendance_status(value, source_status):
    if str(source_status or '').strip().lower() == 'absent':
        return 'absent'
    if value == 1:
        return 'present'
    if value == 0:
        return 'absent'
    return None


def _session_date(value):
    """Return the KBC calendar day for date and timestamp-shaped values."""
    return str(value or '').strip()[:10]


def _map_kbc_history_rows(rows):
    records = []
    for row in rows:
        lecture_name = str(row['lectureName'] or '').strip()
        records.append({
            'recordKey': str(row['recordKey'] or '').strip(),
            'learnerId': str(row['learnerId'] or '').strip(),
            'sessionDate': _session_date(row['sessionDate']),
            'moduleName': str(row['moduleName'] or '').strip(),
            'lectureName': lecture_name,
            'sessionNumber': _session_number(lecture_name),
            'attendance': _attendance_status(row['attendance_value'], row['source_status']),
            'source': 'kbc',
        })
    return records


def read_kbc_attendance_history(dsn, learner_id, learner_email=''):
    if dsn == NEW_DATABASE:
        # Same two-step rule as below: by ID, then the email only when no ID matched.
        with new_database_cursor(read_only=True) as cursor:
            cursor.execute(
                f'''SELECT {KBC_RECORD_COLUMNS} FROM {LINKED_TABLE}
                    WHERE "ID"::text = %s ORDER BY "date" DESC NULLS LAST, "key" DESC''',
                [learner_id],
            )
            rows = dict_rows(cursor)
            if rows or not learner_email:
                return _map_kbc_history_rows(rows)
            cursor.execute(
                f'''SELECT {KBC_RECORD_COLUMNS} FROM {LINKED_TABLE}
                    WHERE lower(trim("Email")) = %s ORDER BY "date" DESC NULLS LAST, "key" DESC''',
                [learner_email],
            )
            return _map_kbc_history_rows(dict_rows(cursor))
    # Neon's pooler rejects startup `options`; set the timeout per transaction.
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as connection:
        connection.read_only = True
        connection.execute("SET LOCAL statement_timeout = '10s'")
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                SELECT
                    "key"::text AS "recordKey",
                    "ID"::text AS "learnerId",
                    "date"::text AS "sessionDate",
                    coalesce("module", '') AS "moduleName",
                    coalesce("lecture_name", '') AS "lectureName",
                    "Attendance" AS attendance_value,
                    "attendance_status" AS source_status
                FROM public.kbc_attendance
                WHERE "ID"::text = %s
                ORDER BY "date" DESC NULLS LAST, "key" DESC
                ''',
                [learner_id],
            )
            rows = cursor.fetchall()
            if rows or not learner_email:
                return _map_kbc_history_rows(rows)

            # A learner can retain attendance under an older Aptem ID after a
            # directory correction. Use the directory email only as a
            # no-ID-match fallback; the normal path remains ID based.
            cursor.execute(
                '''
                SELECT
                    "key"::text AS "recordKey",
                    "ID"::text AS "learnerId",
                    "date"::text AS "sessionDate",
                    coalesce("module", '') AS "moduleName",
                    coalesce("lecture_name", '') AS "lectureName",
                    "Attendance" AS attendance_value,
                    "attendance_status" AS source_status
                FROM public.kbc_attendance
                WHERE lower(trim("Email")) = %s
                ORDER BY "date" DESC NULLS LAST, "key" DESC
                ''',
                [learner_email],
            )
            return _map_kbc_history_rows(cursor.fetchall())


RECENT_LECTURE_LIMIT = 4


def _parse_month(value):
    value = str(value or '').strip()
    if len(value) != 7 or value[4] != '-':
        raise ValueError('Choose a valid attendance month.')
    try:
        first = date.fromisoformat(f'{value}-01')
        following = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    except ValueError as exc:
        raise ValueError('Choose a valid attendance month.') from exc
    return first, following


def read_kbc_month_attendance(dsn, first, following, learner_ids=None):
    """Read saved KBC attendance records for one calendar month."""
    if dsn == NEW_DATABASE:
        return _read_linked_month(first, following, learner_ids)
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as connection:
        connection.read_only = True
        connection.execute("SET LOCAL statement_timeout = '10s'")
        # The KBC source has existed with both DATE and timestamp-shaped text
        # values. Compare the calendar-day prefix so either shape follows the
        # same month boundary and remains compatible with the Daily reader.
        where = [
            'substr("date"::text, 1, 10) >= %s',
            'substr("date"::text, 1, 10) < %s',
            '"ID" IS NOT NULL',
        ]
        # Text against text: Postgres has no text >= date operator.
        params = [first.isoformat(), following.isoformat()]
        cleaned_ids = [str(value).strip() for value in (learner_ids or []) if str(value).strip()]
        if cleaned_ids:
            where.append('"ID"::text = ANY(%s)')
            params.append(cleaned_ids)
        with connection.cursor() as cursor:
            cursor.execute(
                f'''SELECT
                        "key"::text AS "recordKey",
                        "ID"::text AS "learnerId",
                        "date"::text AS "sessionDate",
                        coalesce("module", '') AS "moduleName",
                        coalesce("lecture_name", '') AS "lectureName",
                        "Attendance" AS attendance_value,
                        "attendance_status" AS source_status
                    FROM public.kbc_attendance
                    WHERE {' AND '.join(where)}
                    ORDER BY "date", "key"''',
                params,
            )
            records = []
            for row in cursor.fetchall():
                lecture_name = str(row['lectureName'] or '').strip()
                records.append({
                    'recordKey': str(row['recordKey'] or '').strip(),
                    'learnerId': str(row['learnerId'] or '').strip(),
                    'sessionDate': _session_date(row['sessionDate']),
                    'moduleName': str(row['moduleName'] or '').strip(),
                    'lectureName': lecture_name,
                    'sessionNumber': _session_number(lecture_name),
                    'attendance': _attendance_status(row['attendance_value'], row['source_status']),
                    'source': 'kbc',
                })
            return records


@require_GET
def bulk_attendance_kbc_month_records(request):
    try:
        first, following = _parse_month(request.GET.get('month'))
        raw_ids = str(request.GET.get('learner_ids') or '').split(',')
        learner_ids = [value.strip() for value in raw_ids if value.strip()]
        if len(learner_ids) > 1000 or any(not re.fullmatch(r'\d{1,20}', value) for value in learner_ids):
            raise ValueError('The selected learners are invalid.')
        dsn = kbc_dsn()
        if not dsn:
            return JsonResponse({'error': 'KBC attendance is not configured.'}, status=503)
        kbc_records = read_kbc_month_attendance(dsn, first, following, learner_ids)

        # Keep Monthly aligned with Daily: Daily reads the saved live register
        # and lets a live row replace KBC rows on the same calendar day.  The
        # monthly schedule endpoint is still used for unmarked scheduled days,
        # but saved live rows must remain visible even when an old module/session
        # no longer resolves through the current curriculum payload.
        live_by_learner, warning = _live_register()
        selected = set(learner_ids)
        live_records = {
            learner_id: [
                record for record in rows
                if first.isoformat() <= str(record.get('sessionDate') or '')[:10] < following.isoformat()
            ]
            for learner_id, rows in live_by_learner.items()
            if not selected or learner_id in selected
        }
        learner_keys = set(selected) | {
            record['learnerId'] for record in kbc_records if record.get('learnerId')
        } | set(live_records)
        merged = []
        for learner_id in learner_keys:
            merged.extend(merge_live_over_kbc(
                [record for record in kbc_records if record.get('learnerId') == learner_id],
                live_records.get(learner_id, []),
            ))
        return _with_warnings({'records': merged}, warning)
    except ValueError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
    except (psycopg.Error, DatabaseError):
        return JsonResponse({'error': 'Unable to load monthly KBC attendance. Please try again.'}, status=503)


def _read_linked_month(first, following, learner_ids=None):
    """read_kbc_month_attendance through the new database's link.

    The linked column is a real DATE, so the month is compared as dates: the
    comparison then runs at the KBC source instead of every row being fetched
    across the link and filtered here.
    """
    where = ['"date" >= %s', '"date" < %s', '"ID" IS NOT NULL']
    params = [first, following]
    cleaned_ids = [str(value).strip() for value in (learner_ids or []) if str(value).strip()]
    if cleaned_ids:
        where.append('"ID"::text = ANY(%s)')
        params.append(cleaned_ids)
    with new_database_cursor(read_only=True) as cursor:
        cursor.execute(
            f'''SELECT {KBC_RECORD_COLUMNS} FROM {LINKED_TABLE}
                WHERE {' AND '.join(where)} ORDER BY "date", "key"''',
            params,
        )
        return _map_kbc_history_rows(dict_rows(cursor))


def _recent_scope(learner_ids):
    """(SQL, params) narrowing a recent read to the requested learners, if any.

    Applied inside the ranked subquery, so the window only ranks those
    learners' rows instead of the whole attendance table.
    """
    if learner_ids is None:
        return '', []
    return ' AND "ID"::text = ANY(%s)', [list(learner_ids)]


def _read_linked_recent(limit, learner_ids=None):
    """read_kbc_recent_attendance through the new database's link."""
    scope_sql, scope_params = _recent_scope(learner_ids)
    with new_database_cursor(read_only=True) as cursor:
        cursor.execute(
            f'''SELECT "recordKey", "learnerId", "sessionDate", "moduleName",
                       "lectureName", attendance_value, source_status
                FROM (
                    SELECT {KBC_RECORD_COLUMNS},
                        dense_rank() OVER (PARTITION BY "ID"::text ORDER BY "date" DESC) AS recent_rank
                    FROM {LINKED_TABLE}
                    WHERE "ID" IS NOT NULL AND "date" IS NOT NULL AND "date" <= CURRENT_DATE{scope_sql}
                ) recent
                WHERE recent_rank <= %s
                ORDER BY "learnerId", "sessionDate", "recordKey"''',
            [*scope_params, limit],
        )
        recent = {}
        for record in _map_kbc_history_rows(dict_rows(cursor)):
            recent.setdefault(record['learnerId'], []).append(record)
        return recent


def read_kbc_recent_attendance(dsn, limit=RECENT_LECTURE_LIMIT, learner_ids=None):
    """Rows from each learner's latest ``limit`` dates, oldest first.

    Unmarked rows are included because they are still real learner attendance
    records. Rank dates rather than individual rows: a day replaced by Live
    can contain many KBC rows. The endpoint takes four records after merging.
    ``learner_ids`` limits the read to those KBC ids; None reads everyone.
    """
    if dsn == NEW_DATABASE:
        return _read_linked_recent(limit, learner_ids)
    scope_sql, scope_params = _recent_scope(learner_ids)
    # Neon's pooler rejects startup `options`; set the timeout per transaction.
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as connection:
        connection.read_only = True
        connection.execute("SET LOCAL statement_timeout = '10s'")
        with connection.cursor() as cursor:
            cursor.execute(
                f'''
                SELECT "recordKey", "learnerId", "sessionDate", "moduleName",
                       "lectureName", attendance_value, source_status
                FROM (
                    SELECT
                        "key"::text AS "recordKey",
                        "ID"::text AS "learnerId",
                        "date"::text AS "sessionDate",
                        coalesce("module", '') AS "moduleName",
                        coalesce("lecture_name", '') AS "lectureName",
                        "Attendance" AS attendance_value,
                        "attendance_status" AS source_status,
                        dense_rank() OVER (
                            PARTITION BY "ID"::text
                            ORDER BY "date" DESC
                        ) AS recent_rank
                    FROM public.kbc_attendance
                    WHERE "ID" IS NOT NULL
                      AND "date" IS NOT NULL
                      AND "date" <= CURRENT_DATE{scope_sql}
                ) recent
                WHERE recent_rank <= %s
                ORDER BY "learnerId", "sessionDate", "recordKey"
                ''',
                [*scope_params, limit],
            )
            recent = {}
            for row in cursor.fetchall():
                learner_id = str(row['learnerId'] or '').strip()
                lecture_name = str(row['lectureName'] or '').strip()
                recent.setdefault(learner_id, []).append({
                    'recordKey': str(row['recordKey'] or '').strip(),
                    'learnerId': learner_id,
                    'sessionDate': _session_date(row['sessionDate']),
                    'moduleName': str(row['moduleName'] or '').strip(),
                    'lectureName': lecture_name,
                    'sessionNumber': _session_number(lecture_name),
                    'attendance': _attendance_status(row['attendance_value'], row['source_status']),
                    'source': 'kbc',
                })
            return recent


def _recorded_outcomes(records):
    from .bulk_attendance_recorded import apply_recorded_outcomes
    return apply_recorded_outcomes(records)


def _with_warnings(payload, warning):
    from django.db import DatabaseError
    try:
        if 'records' in payload:
            payload = {**payload, 'records': _recorded_outcomes(payload['records'])}
        elif 'recent' in payload:
            records = _recorded_outcomes([record for rows in payload['recent'].values() for record in rows])
            recent = {key: [] for key in payload['recent']}
            for record in records:
                recent[record['learnerId']].append(record)
            payload = {**payload, 'recent': recent}
    except DatabaseError:
        return JsonResponse({'error': 'Recording attendance could not be read. Please try again.'}, status=503)
    response = JsonResponse({**payload, 'warnings': [warning] if warning else []})
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
def bulk_attendance_kbc_recent(request):
    live_only = request.GET.get('source') == 'live'
    # Optional: the register's visible page. Absent, every learner is read.
    learner_ids = None
    if 'learner_ids' in request.GET:
        learner_ids = sorted({
            value.strip() for value in str(request.GET.get('learner_ids') or '').split(',') if value.strip()
        })
        if len(learner_ids) > 1000 or any(not re.fullmatch(r'\d{1,20}', value) for value in learner_ids):
            return JsonResponse({'error': 'The selected learners are invalid.'}, status=400)
        if not learner_ids:
            return _with_warnings({'recent': {}}, None)
    live, warning = _live_register(kbc_ids=learner_ids)
    kbc = {}
    if not live_only:
        try:
            dsn = kbc_dsn()
            if not dsn:
                return JsonResponse({'error': 'KBC attendance is not configured.'}, status=503)
            # Read four candidate dates plus the dates Live may replace.
            # Each date can contain multiple records; never truncate those
            # before applying the same merge policy as full history.
            limit = RECENT_LECTURE_LIMIT + live_days_per_learner(live)
            kbc = (
                read_kbc_recent_attendance(dsn, limit) if learner_ids is None
                else read_kbc_recent_attendance(dsn, limit, learner_ids)
            )
        except (psycopg.Error, DatabaseError):
            # Database driver errors can expose connection information.
            return JsonResponse({'error': 'Unable to load recent KBC attendance. Please try again.'}, status=503)

    recent = {
        learner_id: [record for record in merge_live_over_kbc(
            kbc.get(learner_id, []), live.get(learner_id, []))
            if record.get('countsAsSession') is not False][-RECENT_LECTURE_LIMIT:]
        for learner_id in set(kbc) | set(live)
    }
    return _with_warnings({'recent': recent}, warning)


@require_GET
def bulk_attendance_kbc_history(request):
    learner_id = request.GET.get('learner_id', '').strip()
    if not re.fullmatch(r'\d{1,20}', learner_id):
        return JsonResponse({'error': 'A valid learner is required.'}, status=400)
    learner_email = request.GET.get('learner_email', '').strip().lower()
    if len(learner_email) > 320 or (learner_email and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', learner_email)):
        return JsonResponse({'error': 'The learner email is invalid.'}, status=400)

    live_only = request.GET.get('source') == 'live'
    records = []
    if not live_only:
        try:
            dsn = kbc_dsn()
            if not dsn:
                return JsonResponse({'error': 'KBC attendance is not configured.'}, status=503)
            records = read_kbc_attendance_history(dsn, learner_id, learner_email)
        except (psycopg.Error, DatabaseError):
            # Driver errors can expose connection information.
            return JsonResponse({'error': 'Unable to load KBC attendance history. Please try again.'}, status=503)

    live, warning = _live_register(learner_id)
    merged = merge_live_over_kbc(records, live.get(learner_id, []))
    return _with_warnings({'records': list(reversed(merged))}, warning)
