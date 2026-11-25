"""Manual tutor assignment emails with a canonical, retained notification ledger.

Assignments come only from modules.tutor_id; profile data comes from tutors.
Automatic assignment hooks remain disabled. Explicit reconcile calls group new
assignments, while manual sends intentionally permit resends. History survives
renames, email changes, reassignment and archival. Database RESTRICT constraints
protect it from parent deletion.
"""
from __future__ import annotations

import json
import logging
import os

from django.db import connection, transaction
from django.http import JsonResponse

from login.permissions import require_role
from curriculum_api.canonical_read_sql import module_expected_otjh_sql

from login import email_azure

from . import schema_gate, tutor_notification_schema

logger = logging.getLogger(__name__)

#: Ledger of pairs already mailed. Lives in the curriculum schema alongside the
#: tutors and modules it references.
NOTIFICATION_TABLE = 'tutor_module_notifications'

#: A failed send is retried on later passes, but not forever: a mailbox that has
#: been decommissioned would otherwise be retried on every curriculum write for
#: the life of the deployment.
MAX_SEND_ATTEMPTS = 3


def _views():
    """Imported lazily -- ``views`` imports this module at load time."""
    from . import views

    return views


def workspace_url():
    """Where the mail points. Same env var the invitation mails already use."""
    base = (os.environ.get('FRONTEND_URL') or 'http://localhost:3000').rstrip('/')
    return f'{base}/workspace/tutor'


def notifications_enabled():
    """``TUTOR_ASSIGNMENT_EMAILS=false`` turns the whole feature off.

    Worth having when a production database is restored into staging: the
    reconcile would otherwise find a ledger that does not match the restored
    assignments and mail real tutors about a test system.
    """
    value = (os.environ.get('TUTOR_ASSIGNMENT_EMAILS') or 'true').strip().lower()
    return value not in {'0', 'false', 'no', 'off'}


# ---------------------------------------------------------------------------
# Ledger schema
# ---------------------------------------------------------------------------

def ensure_notification_table():
    """Read-only final-schema gate. Provisioning is explicit, never a GET side effect."""
    schema_gate.require_tables(NOTIFICATION_TABLE)
    with connection.cursor() as cursor:
        tutor_notification_schema.verify(cursor, connection.vendor)


def provision_notification_table():
    """Create and seed the final schema in an explicitly authorized bootstrap."""
    views = _views()
    already_present = views.table_exists(NOTIFICATION_TABLE)
    with transaction.atomic(), connection.cursor() as cursor:
        tutor_notification_schema.create_table(cursor, connection.vendor)
        tutor_notification_schema.verify(cursor, connection.vendor)
        if not already_present:
            seed_existing_assignments()
    views._TABLE_COLUMNS_CACHE.pop(f'{views.CURRICULUM_SCHEMA}.{NOTIFICATION_TABLE}', None)


def seed_existing_assignments():
    """Seed canonical pairs without claiming delivery or altering existing history."""
    views = _views()
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {views.table_name(NOTIFICATION_TABLE)}
            (tutor_id,module_catalogue_id,status,attempts,detail)
            SELECT t.id,m.module_catalogue_id,'seeded',0,
                   'Recorded when the notification ledger was created.'
            FROM {views.table_name('modules')} m
            JOIN {views.table_name('tutors')} t ON t.id=m.tutor_id
            WHERE 1=1
            ON CONFLICT (tutor_id,module_catalogue_id) DO NOTHING''')


def _tutor_profile(tutor_id):
    views = _views()
    rows = views.fetch_all(
        f'SELECT id,name,email FROM {views.table_name("tutors")} WHERE id=%s',
        [tutor_id])
    if not rows:
        return None
    return {key: views.clean_str(rows[0].get(key)) for key in ('id','name','email')}


def _assigned_tutor_id(module_id):
    views = _views()
    rows = views.fetch_all(
        f'SELECT tutor_id FROM {views.table_name("modules")} WHERE module_catalogue_id=%s',
        [module_id])
    return views.clean_str(rows[0].get('tutor_id')) if rows else ''


def current_assignments():
    """Current canonical pairs, grouped by tutors.id for explicit grouped dispatch."""
    views = _views()
    tutor_rows = views.fetch_all(f'SELECT id,name,email FROM {views.table_name("tutors")}')
    module_rows = views.safe_authoring_module_rows()
    _annotate_module_otjh(module_rows)
    if not tutor_rows or not module_rows:
        return {}

    groups_by_id = {}
    cohorts_by_id = {}
    try:
        groups_by_id = {
            views.clean_str(row.get('group_id')): row
            for row in views.authoring_fetch_all(views.GROUPS_TABLE)
            if views.clean_str(row.get('group_id'))
        }
        cohorts_by_id = {
            views.clean_str(row.get('cohort_id')): row
            for row in views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE)
            if views.clean_str(row.get('cohort_id'))
        }
    except Exception:
        # Coach name and cohort dates are enrichment. Losing them costs two rows
        # of the mail; losing the mail costs the tutor the assignment.
        logger.debug('Could not read groups/cohorts for assignment mail.', exc_info=True)

    assigned_ids = {row['module_catalogue_id']: row['tutor_id'] for row in views.fetch_all(
        f'SELECT module_catalogue_id,tutor_id FROM {views.table_name("modules")}')}
    live_modules = []
    for module_row in module_rows:
        module_id = views.clean_str(module_row.get('module_catalogue_id'))
        deleted = views.row_has_deleted_at(module_row)
        if not module_id or deleted:
            continue
        live_modules.append((
            module_id,
            views.clean_str(assigned_ids.get(module_id)),
            module_row,
        ))

    assignments = {}
    for tutor in tutor_rows:
        name = views.clean_str(tutor.get('name'))
        email = views.clean_str(tutor.get('email'))
        resolved_tutor_id = views.clean_str(tutor.get('id'))
        if not resolved_tutor_id or not email:
            continue
        modules = {}
        for module_id, assigned_id, module_row in live_modules:
            if assigned_id != resolved_tutor_id:
                continue
            modules[module_id] = describe_module(
                module_row,
                groups_by_id.get(views.clean_str(module_row.get('group_id'))),
                cohorts_by_id.get(views.clean_str(module_row.get('cohort_id'))),
            )
        if modules:
            assignments[resolved_tutor_id] = {
                'tutor': {
                    'id': views.clean_str(tutor.get('id')),
                    'name': name,
                    'email': email,
                },
                'modules': modules,
            }
    return assignments


def _annotate_module_otjh(module_rows):
    """Add computed_total_otjh to each module row using a single batch query."""
    ids = [r.get('module_catalogue_id') for r in module_rows if r.get('module_catalogue_id')]
    if not ids:
        return
    with connection.cursor() as cur:
        cur.execute(
            f"SELECT m.module_catalogue_id, {module_expected_otjh_sql('m')} AS otjh"
            f" FROM curriculum.modules m WHERE m.module_catalogue_id = ANY(%s)",
            [ids],
        )
        otjh_map = {row[0]: row[1] for row in cur.fetchall()}
    for row in module_rows:
        row['computed_total_otjh'] = otjh_map.get(row.get('module_catalogue_id'))


def float_or_zero(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def format_hours(value):
    """``24.00`` -> "24 hours", ``22.50`` -> "22.5 hours", ``0``/junk -> "".

    total_otjh is numeric(8,2), so the raw value reads as "24.00" — correct, and
    not how anyone writes a number of hours in a sentence.
    """
    hours = float_or_zero(value)
    if not hours:
        return ''
    text = f'{hours:.2f}'.rstrip('0').rstrip('.')
    return f'{text} hours'


def describe_module(module_row, group_row=None, cohort_row=None):
    """Flatten a module row into the labelled facts the mail prints."""
    views = _views()
    group_row = group_row or {}
    cohort_row = cohort_row or {}

    schedule = views.build_group_schedule(
        module_row.get('session_week_day') or group_row.get('session_week_day'),
        module_row.get('session_start_time') or group_row.get('session_start_time'),
        module_row.get('session_end_time') or group_row.get('session_end_time'),
    )
    start = views.format_date(module_row.get('start_date'))
    end = views.format_date(module_row.get('end_date'))
    if start and end:
        dates = f'{start} to {end}'
    else:
        dates = start or end or ''
        if not dates:
            cohort_start = views.format_date(cohort_row.get('start_date'))
            cohort_end = views.format_date(cohort_row.get('end_date'))
            # Labelled explicitly: a tutor reading "2026-09-01 to 2027-06-30"
            # must not take the cohort's span for their own module's dates.
            if cohort_start and cohort_end:
                dates = f'cohort runs {cohort_start} to {cohort_end}'

    sessions = views.clean_str(module_row.get('sessions_number'))
    if 'computed_total_otjh' not in (module_row or {}):
        raise AssertionError(
            'Call _annotate_module_otjh(module_rows) before describe_module(); '
            'computed_total_otjh key is missing from module_row'
        )
    otjh = views.clean_str(module_row.get('computed_total_otjh'))
    return {
        'name': views.clean_str(module_row.get('title')),
        'code': views.clean_str(module_row.get('module_catalogue_id')),
        'programme': views.clean_str(module_row.get('programme_name')),
        'cohort': (
            views.clean_str(module_row.get('cohort_name'))
            or views.clean_str(cohort_row.get('cohort_name'))
        ),
        'group': (
            views.clean_str(module_row.get('group_name'))
            or views.clean_str(group_row.get('group_name'))
        ),
        'schedule': schedule,
        'dates': dates,
        'sessions': sessions if float_or_zero(sessions) else '',
        'otjh': format_hours(otjh),
        'coach': views.clean_str(group_row.get('coach_name')),
    }


# ---------------------------------------------------------------------------
# Reconcile pass
# ---------------------------------------------------------------------------

def ledger_rows():
    views = _views()
    return views.fetch_all(f'select * from {views.table_name(NOTIFICATION_TABLE)}')


def schedule_assignment_notifications():
    """Automatic assignment emails remain disabled."""
    return


def dispatch_assignment_notifications():
    """Mail every tutor about assignments the ledger has not recorded yet.

    Never raises: this runs after a save has already committed, and a mail
    transport problem must not surface as a failed curriculum write.
    """
    if not notifications_enabled():
        return []
    try:
        return _dispatch()
    except Exception:
        logger.warning(
            'Tutor assignment notifications could not be dispatched.', exc_info=True
        )
        return []


def _dispatch():
    ensure_notification_table()
    batches = []
    for entry in current_assignments().values():
        result = _notify(entry, list(entry['modules'].items()))
        if result:
            batches.append(result)
    return batches


def _upsert_ledger_row(tutor_id, module_id, *, manual=False):
    """Atomically claim an attempt; never copy a stale application-side count.

    Call inside the transaction containing delivery and completion. PostgreSQL
    holds the conflicting row lock until completion, serializing sends for the
    same pair. Reconcile contenders recheck eligibility after waiting; explicit
    manual requests each count as an intentional resend.
    """
    views = _views()
    table = views.table_name(NOTIFICATION_TABLE)
    condition = '' if manual else "WHERE ledger.status='failed' AND ledger.attempts < %s"
    now = "(clock_timestamp() AT TIME ZONE 'UTC')" if connection.vendor == 'postgresql' else 'CURRENT_TIMESTAMP'
    params = [tutor_id, module_id] + ([] if manual else [MAX_SEND_ATTEMPTS])
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {table} AS ledger
            (tutor_id,module_catalogue_id,status,attempts,detail)
            VALUES (%s,%s,'pending',1,'')
            ON CONFLICT (tutor_id,module_catalogue_id) DO UPDATE
            SET status='pending', attempts=ledger.attempts+1, detail='',
                updated_at={now}
            {condition}
            RETURNING attempts''', params)
        row = cursor.fetchone()
    return row[0] if row else None


def _notify(entry, pending, *, manual=False):
    """One grouped message, with sorted pair locks and atomic attempt accounting."""
    views = _views()
    tutor_id = entry['tutor']['id']
    with transaction.atomic():
        # Re-read canonical recipient just before the send, including after a
        # concurrent sender held the tutor lock. Lock order is stable per batch.
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute(f'SELECT id FROM {views.table_name("tutors")} WHERE id=%s FOR NO KEY UPDATE', [tutor_id])
                if cursor.fetchone() is None:
                    raise ValueError('Tutor no longer exists.')
        tutor = _tutor_profile(tutor_id)
        if not tutor or not tutor['email']:
            raise ValueError('Tutor has no current email address.')
        claimed = []
        for module_id, detail in sorted(pending):
            if connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute(f'SELECT tutor_id FROM {views.table_name("modules")} WHERE module_catalogue_id=%s FOR SHARE', [module_id])
                    row = cursor.fetchone()
                    if not row or row[0] != tutor_id:
                        raise ValueError('Module assignment changed; refresh before sending.')
            if _upsert_ledger_row(tutor_id, module_id, manual=manual) is not None:
                claimed.append((module_id, detail))
        if not claimed:
            return None
        subject, html, text = email_azure.tutor_assignment_message(
            tutor_name=tutor['name'], modules=[detail for _,detail in claimed],
            workspace_url=workspace_url())
        try:
            sent, failure = email_azure.send_mail(
                to=tutor['email'], subject=subject, html_body=html, text_body=text)
        except Exception:
            logger.exception('Tutor notification transport failed.')
            sent, failure = False, 'Email transport failed.'
        now = "(clock_timestamp() AT TIME ZONE 'UTC')" if connection.vendor == 'postgresql' else 'CURRENT_TIMESTAMP'
        with connection.cursor() as cursor:
            for module_id, _ in claimed:
                cursor.execute(f'''UPDATE {views.table_name(NOTIFICATION_TABLE)}
                    SET status=%s,detail=%s,updated_at={now}
                    WHERE tutor_id=%s AND module_catalogue_id=%s''',
                    ['sent' if sent else 'failed', '' if sent else (failure or '')[:500],
                     tutor_id,module_id])
        return {'tutor': tutor['email'], 'modules': [mid for mid,_ in claimed], 'sent': sent}


def _module_tutor(module_id):
    """``(module_row, tutor or None, resolved_tutor_id)`` for a live module, or ``(None, None, '')``."""
    views = _views()
    module_id = views.clean_str(module_id)
    module_row = next((
        row for row in views.safe_authoring_module_rows() or []
        if views.clean_str(row.get('module_catalogue_id')) == module_id
        and not views.row_has_deleted_at(row)
    ), None)
    if module_row is None:
        return None, None, ''
    tutor_id = _assigned_tutor_id(module_id)
    return module_row, _tutor_profile(tutor_id) if tutor_id else None, tutor_id


def _last_send(resolved_tutor_id, module_id):
    views = _views()
    ensure_notification_table()
    rows = views.fetch_all(
        f'SELECT status,updated_at FROM {views.table_name(NOTIFICATION_TABLE)} '
        'WHERE tutor_id=%s AND module_catalogue_id=%s', [resolved_tutor_id,module_id])
    row = rows[0] if rows else None
    if row is None:
        return None
    updated = row.get('updated_at')
    return {
        'status': views.clean_str(row.get('status')).lower() or None,
        'at': updated.isoformat() if hasattr(updated, 'isoformat') else (views.clean_str(updated) or None),
    }


def module_tutor_status(module_id):
    module_row, tutor, resolved_tutor_id = _module_tutor(module_id)
    if module_row is None:
        return None
    return {
        'moduleId': module_id,
        'tutor': {'name': tutor['name'], 'hasEmail': bool(tutor['email'])} if tutor else None,
        'lastSent': _last_send(resolved_tutor_id, module_id) if tutor else None,
    }


def tutor_email_status(module_ids, tutor_id=''):
    """Preview an explicit canonical tutor ID, or each module's saved assignment."""
    views = _views()
    ordered = []
    for value in module_ids or []:
        module_id = views.clean_str(value)
        if module_id and module_id not in ordered:
            ordered.append(module_id)

    override_key = views.clean_str(tutor_id)
    tutor = _tutor_profile(override_key) if override_key else None
    if override_key and tutor is None:
        raise ValueError('Tutor not found.')

    deliveries = []
    for module_id in ordered:
        if override_key:
            resolved_tutor_id = override_key
        else:
            _row, stored_tutor, resolved_tutor_id = _module_tutor(module_id)
            if tutor is None and stored_tutor is not None:
                tutor = stored_tutor
        last = _last_send(resolved_tutor_id, module_id) if resolved_tutor_id else None
        deliveries.append({
            'moduleId': module_id,
            'emailed': bool(last and last.get('status') == 'sent'),
            'lastSent': last,
        })

    sent_at = [
        d['lastSent']['at'] for d in deliveries
        if d['emailed'] and (d.get('lastSent') or {}).get('at')
    ]
    return {
        'tutor': {'name': tutor['name'], 'hasEmail': bool(tutor['email'])} if tutor else None,
        'total': len(deliveries),
        'emailed': sum(1 for d in deliveries if d['emailed']),
        # The most recent one the tutor actually received, so a module whose
        # deliveries were notified on different days reports the latest.
        'lastSentAt': max(sent_at) if sent_at else None,
        'deliveries': deliveries,
    }


def send_tutor_email(module_ids):
    """Email one tutor about these modules now. Returns ``(payload, http_status)``.

    One mail covers the whole list, because that is what being put on three
    groups' deliveries of the same module in one save actually is -- see
    ``email_azure.tutor_assignment_message``, which has always taken a list.
    Three separate mails arriving in the same second would describe the same
    decision three times.

    Every module must belong to the same tutor. The two callers both satisfy
    that by construction (one module, or one drawer save that put one name on
    all of them), so a mixed list is a programming error rather than something
    to paper over by sending several mails.

    Re-sending is allowed -- the workspace button asks first, and the drawer
    only sends what a person ticked -- and each module gets its own ledger row,
    so the workspace can still say when that module last went out.
    """
    views = _views()
    ordered = []
    for value in module_ids or []:
        module_id = views.clean_str(value)
        if module_id and module_id not in ordered:
            ordered.append(module_id)
    if not ordered:
        return {'error': 'No module was named.'}, 400

    resolved = []
    for module_id in ordered:
        module_row, tutor, resolved_tutor_id = _module_tutor(module_id)
        if module_row is None:
            return {'error': 'Module not found.'}, 404
        if tutor is None:
            return {'error': 'Assign a tutor to this module before emailing them.'}, 409
        if not tutor['email']:
            return {'error': f"{tutor['name']} has no email address in the staff directory."}, 409
        resolved.append((module_id, module_row, tutor, resolved_tutor_id))

    first_key = resolved[0][3]
    if any(key != first_key for _id, _row, _tutor, key in resolved):
        return {'error': 'These modules do not all have the same tutor.'}, 409
    tutor = resolved[0][2]

    groups = {views.clean_str(r.get('group_id')): r for r in views.authoring_fetch_all(views.GROUPS_TABLE)}
    cohorts = {views.clean_str(r.get('cohort_id')): r for r in views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE)}
    _annotate_module_otjh([row for _,row,_,_ in resolved])
    details = [
        describe_module(
            module_row,
            groups.get(views.clean_str(module_row.get('group_id'))),
            cohorts.get(views.clean_str(module_row.get('cohort_id'))),
        )
        for _id, module_row, _tutor, _key in resolved
    ]

    ensure_notification_table()
    result = _notify({'tutor': tutor}, list(zip(ordered, details)), manual=True)
    sent = result['sent']
    if not sent:
        logger.warning('Requested tutor notification failed for %d modules.', len(ordered))
        return {'error': f'The email to {tutor["name"]} could not be sent. Please try again.', 'code': 'send_failed'}, 502
    logger.info('Emailed %s about %d module(s) on request.', tutor['email'], len(ordered))
    return {
        'sent': True,
        'tutor': tutor['name'],
        'modules': len(ordered),
        'lastSent': _last_send(first_key, ordered[0]),
    }, 200


def send_module_tutor_email(module_id):
    """Email this one module's tutor about it now. See ``send_tutor_email``."""
    return send_tutor_email([module_id])


def notification_options(module_ids):
    """Canonical choices and saved IDs for the notification preview selector."""
    views = _views()
    return {
        'tutors': views.fetch_all(f'SELECT id,name FROM {views.table_name("tutors")} ORDER BY name,id'),
        'assignments': [{'moduleId': mid, 'tutorId': _assigned_tutor_id(mid)} for mid in module_ids],
    }


@require_role('admin', 'staff')
def modules_tutor_email(request):
    """GET: whether this tutor has been emailed about these deliveries yet.
    POST: one mail to one tutor covering several modules (CSRF protected).

    The module drawer's "email the tutor" tick, both halves. The tick is not a
    form field the drawer remembers -- it reads its state from here every time
    it opens, because the ledger is the only place that knows whether the tutor
    was actually written to, and it has to still know next week.

    One drawer save can attach the module to several groups at once -- one
    delivery per group, all carrying the same tutor -- so both halves take a
    list: the tutor hears about that once, and the tick reports "2 of 3" rather
    than pretending the module is one thing.

    Deliberately a route of its own rather than a body on the per-module one:
    that endpoint's URL names the module it acts on, and the workspace button
    depends on it staying that way.
    """
    if request.method == 'GET':
        raw = request.GET.get('moduleIds') or ''
        module_ids = [part for part in raw.split(',') if part.strip()]
        try:
            if request.GET.get('options') == '1':
                return JsonResponse(notification_options(module_ids))
            if request.GET.get('tutor'):
                return JsonResponse({'error': 'Use canonical tutorId.'}, status=400)
            return JsonResponse(tutor_email_status(module_ids, request.GET.get('tutorId') or ''), status=200)
        except ValueError as exc:
            return JsonResponse({'error': str(exc)}, status=404)
        except Exception:
            logger.exception('Could not read the tutor email status for modules %s', module_ids)
            return JsonResponse({'error': 'The tutor email status could not be loaded.'}, status=502)
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    body = {}
    try:
        body = json.loads((request.body or b'').decode('utf-8') or '{}')
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON body.'}, status=400)
    module_ids = body.get('moduleIds') if isinstance(body, dict) else None
    if not isinstance(module_ids, list):
        return JsonResponse({'error': 'moduleIds must be a list.'}, status=400)
    try:
        payload, status = send_tutor_email(module_ids)
    except Exception:
        logger.exception('Could not email the tutor of modules %s', module_ids)
        return JsonResponse({'error': 'The email could not be sent. Please try again.'}, status=502)
    return JsonResponse(payload, status=status)


@require_role('admin', 'staff')
def module_tutor_email(request, module_id):
    """GET: who the tutor is and when they were last emailed. POST: email them now (CSRF protected)."""
    if request.method == 'GET':
        try:
            status = module_tutor_status(module_id)
        except Exception:
            logger.exception('Could not read the tutor email status for module %s', module_id)
            return JsonResponse({'error': 'The tutor email status could not be loaded.'}, status=502)
        return JsonResponse(status, status=200) if status else JsonResponse({'error': 'Module not found.'}, status=404)
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        payload, status = send_module_tutor_email(module_id)
    except Exception:
        logger.exception('Could not email the tutor of module %s', module_id)
        return JsonResponse({'error': 'The email could not be sent. Please try again.'}, status=502)
    return JsonResponse(payload, status=status)
