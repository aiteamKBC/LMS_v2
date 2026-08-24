"""Email a tutor when a module is assigned to them.

Why a reconcile pass instead of a hook per write
------------------------------------------------
A tutor becomes attached to a module through several unrelated paths: the
programme creation/edit wizard (``save_tree_group_modules``), the staffing
screen (``update_staffing_assignment``), a group PATCH that carries ``tutor``,
a staff-profile POST/PATCH that carries ``assignedModuleIds``, and the mirror
rebuild that derives ``tutors.assigned_module_ids`` from
``curriculum.modules.tutor_name``. Hooking a "send mail" call into each of them
would mean five chances to miss one, and each of those paths writes several
modules in a loop -- so per-write hooks also produce a mail per module rather
than one mail per save.

Instead this module reconciles. After a write commits it compares the set of
(tutor, module) pairs that currently exist against a ledger of pairs already
mailed, and sends one grouped message per tutor for whatever is new. The pass is
idempotent, so calling it from an extra place costs a few reads and nothing
else, and a path nobody remembered to wire up is still covered the next time any
curriculum write happens.

The ledger
----------
``curriculum.tutor_module_notifications`` -- one row per (tutor identity,
module) pair that has been mailed. Rows are claimed *before* the send so a crash
mid-send cannot produce a duplicate, and a failed send is left recorded as
``failed`` with an attempt count so it retries on later passes but cannot loop
forever against a permanently bad address.

Rows for pairs that no longer exist are deleted, which is deliberate: a tutor
taken off a module and put back on it later is told about it again.

Seeding
-------
Migration ``0049`` creates the table already populated with every assignment
that existed at the time. Without that, the first reconcile after deployment
would read the entire back catalogue as "new" and mail every tutor about every
module they have ever been given. The runtime bootstrap path below seeds the
same way for local/SQLite provisioning.

Failure policy
--------------
Nothing here may break a curriculum save. The whole pass runs after commit and
swallows its own exceptions -- an assignment that saved but did not mail is a
notification bug, not a data-loss bug, and is recoverable on the next pass.
"""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime

from django.db import connection, transaction

from login import email_azure

from . import schema_gate

logger = logging.getLogger(__name__)

#: Ledger of pairs already mailed. Lives in the curriculum schema alongside the
#: tutors and modules it references.
NOTIFICATION_TABLE = 'tutor_module_notifications'

#: A failed send is retried on later passes, but not forever: a mailbox that has
#: been decommissioned would otherwise be retried on every curriculum write for
#: the life of the deployment.
MAX_SEND_ATTEMPTS = 3

#: Collapses the many writes of one save into a single pass. See
#: ``schedule_assignment_notifications``.
_state = threading.local()

_TABLE_READY = False


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
    """Verify the ledger exists; provision it only outside production.

    Schema is migration-owned, so
    a request path that finds it missing gets a named error rather than silently
    issuing DDL.
    """
    global _TABLE_READY
    if _TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(NOTIFICATION_TABLE)
        _TABLE_READY = True
        return
    provision_notification_table()


def provision_notification_table():
    """Create the ledger (and seed it) for the test runner / local bootstrap."""
    global _TABLE_READY
    views = _views()
    already_present = views.table_exists(NOTIFICATION_TABLE)
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'create schema if not exists {views.quote_ident(views.CURRICULUM_SCHEMA)}'
            )
        cursor.execute(
            'create table if not exists '
            + views.table_name(NOTIFICATION_TABLE)
            + """ (
                id varchar(160) primary key,
                tutor_key varchar(320) not null default '',
                tutor_id varchar(128) not null default '',
                tutor_name varchar(255) not null default '',
                tutor_email varchar(255) not null default '',
                module_catalogue_id varchar(128) not null default '',
                status varchar(32) not null default 'sent',
                attempts integer not null default 0,
                detail text not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )"""
        )
        cursor.execute(
            'create index if not exists curriculum_tutor_notify_key_idx on '
            + views.table_name(NOTIFICATION_TABLE)
            + ' (tutor_key)'
        )
    views._TABLE_COLUMNS_CACHE.pop(f'{views.CURRICULUM_SCHEMA}.{NOTIFICATION_TABLE}', None)
    _TABLE_READY = True
    if not already_present:
        seed_existing_assignments()


def ledger_id(tutor_key, module_id):
    """Primary key for a pair. Deterministic, so a concurrent insert collides."""
    return f'{tutor_key}|{module_id}'[:160]


def seed_existing_assignments():
    """Record every current assignment as already-notified, sending nothing.

    Called once, when the ledger is first created. See the module docstring.
    """
    views = _views()
    try:
        assignments = current_assignments()
    except Exception:
        logger.warning('Could not seed the tutor assignment ledger.', exc_info=True)
        return
    seeded = 0
    for tutor_key, entry in assignments.items():
        for module_id in entry['modules']:
            try:
                views.insert_row(NOTIFICATION_TABLE, {
                    'id': ledger_id(tutor_key, module_id),
                    'tutor_key': tutor_key,
                    'tutor_id': entry['tutor']['id'],
                    'tutor_name': entry['tutor']['name'],
                    'tutor_email': entry['tutor']['email'],
                    'module_catalogue_id': module_id,
                    'status': 'seeded',
                    'attempts': 0,
                    'detail': 'Recorded when the notification ledger was created.',
                })
                seeded += 1
            except Exception:
                logger.debug('Could not seed ledger row for %s.', module_id, exc_info=True)
    logger.info('Seeded %s existing tutor module assignments (no mail sent).', seeded)


# ---------------------------------------------------------------------------
# Current state
# ---------------------------------------------------------------------------

def current_assignments():
    """Every live tutor-to-module pair, keyed by tutor identity.

    Returns ``{tutor_key: {'tutor': {...}, 'modules': {catalogue_id: detail}}}``.

    Only tutors with an email address appear: there is nowhere to send for the
    others, and leaving them out keeps the pair out of the ledger so they are
    notified once an address is filled in.

    The tutors come from the staff directory and the assignment from
    ``curriculum.modules.tutor_name`` -- the module row is the only thing that
    says who teaches it, so there is no second list here to disagree with it.
    """
    views = _views()
    tutor_rows = views.get_staff_profile_rows('tutor')
    module_rows = views.safe_authoring_module_rows()
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

    # Indexed once so the tutor loop below is a name comparison rather than a
    # row read per pair. Descriptions are built lazily, because only the handful
    # of modules that actually match ever need one.
    live_modules = []
    for module_row in module_rows:
        module_id = views.clean_str(module_row.get('module_catalogue_id'))
        deleted = (
            views.truthy(module_row.get('is_programme_deleted'))
            or views.row_has_deleted_at(module_row)
        )
        if not module_id or deleted:
            continue
        live_modules.append((
            module_id,
            views.staff_assignment_key(module_row.get('tutor_name')),
            module_row,
        ))

    assignments = {}
    for tutor in tutor_rows:
        name = views.staff_profile_name(tutor)
        email = views.staff_profile_email(tutor)
        tutor_key = views.staff_assignment_key(name) or email.lower()
        if not tutor_key or tutor_key == 'unassigned' or not email:
            continue
        modules = {}
        for module_id, module_tutor_key, module_row in live_modules:
            if module_tutor_key != tutor_key:
                continue
            modules[module_id] = describe_module(
                module_row,
                groups_by_id.get(views.clean_str(module_row.get('group_id'))),
                cohorts_by_id.get(views.clean_str(module_row.get('cohort_id'))),
            )
        if modules:
            assignments[tutor_key] = {
                'tutor': {
                    'id': views.clean_str(tutor.get('id')),
                    'name': name,
                    'email': email,
                },
                'modules': modules,
            }
    return assignments


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
    otjh = views.clean_str(module_row.get('total_otjh'))
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
    """Queue one reconcile pass for after the current transaction commits.

    Registered on the transaction rather than run inline for two reasons: a save
    that later rolls back must not have mailed anybody, and a wizard save that
    writes twenty modules should mail once, not twenty times. Only the
    last-registered callback of a transaction does the work -- earlier ones see
    a newer token and return.

    If that last callback is discarded by a nested rollback the pass is simply
    skipped; because it is a full diff rather than an increment, the next
    curriculum write picks up whatever it missed.
    """
    if not notifications_enabled():
        return
    token = getattr(_state, 'token', 0) + 1
    _state.token = token

    def run():
        if getattr(_state, 'token', 0) != token:
            return
        _state.token = 0
        dispatch_assignment_notifications()

    try:
        transaction.on_commit(run)
    except Exception:
        logger.debug('Could not schedule tutor assignment notifications.', exc_info=True)


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
    views = _views()
    ensure_notification_table()
    assignments = current_assignments()
    ledger = {views.clean_str(row.get('id')): row for row in ledger_rows()}

    live_ids = set()
    batches = []

    for tutor_key, entry in assignments.items():
        pending = []
        for module_id, detail in entry['modules'].items():
            row_id = ledger_id(tutor_key, module_id)
            live_ids.add(row_id)
            existing = ledger.get(row_id)
            if existing is None:
                pending.append((row_id, module_id, detail, 0))
                continue
            status = views.clean_str(existing.get('status')).lower()
            attempts = int(existing.get('attempts') or 0)
            if status == 'failed' and attempts < MAX_SEND_ATTEMPTS:
                pending.append((row_id, module_id, detail, attempts))
        if pending:
            batches.append(_notify(entry, pending))

    _forget_stale_rows(live_ids, ledger)
    return batches


def _notify(entry, pending):
    """Claim the pending pairs in the ledger, then mail one message for them.

    The claim happens first and unconditionally. If the process dies between the
    claim and the send the tutor misses a mail; the other order would re-send
    the same mail on every later pass, which is the worse of the two failures.
    """
    tutor = entry['tutor']
    modules = [detail for _, _, detail, _ in pending]

    for row_id, module_id, _, attempts in pending:
        _upsert_ledger_row(row_id, tutor, module_id, 'pending', attempts, '')

    subject, html, text = email_azure.tutor_assignment_message(
        tutor_name=tutor['name'],
        modules=modules,
        workspace_url=workspace_url(),
    )
    sent, detail = email_azure.send_mail(
        to=tutor['email'], subject=subject, html_body=html, text_body=text
    )

    status = 'sent' if sent else 'failed'
    for row_id, module_id, _, attempts in pending:
        _upsert_ledger_row(
            row_id,
            tutor,
            module_id,
            status,
            attempts + 1,
            '' if sent else (detail or '')[:500],
        )
    if sent:
        logger.info(
            'Emailed %s about %s newly assigned module(s).', tutor['email'], len(pending)
        )
    else:
        logger.warning(
            'Could not email %s about %s newly assigned module(s): %s',
            tutor['email'], len(pending), detail,
        )
    return {
        'tutor': tutor['email'],
        'modules': [module_id for _, module_id, _, _ in pending],
        'sent': sent,
    }


def _upsert_ledger_row(row_id, tutor, module_id, status, attempts, detail):
    views = _views()
    payload = {
        'tutor_key': row_id.split('|', 1)[0],
        'tutor_id': tutor['id'],
        'tutor_name': tutor['name'],
        'tutor_email': tutor['email'],
        'module_catalogue_id': module_id,
        'status': status,
        'attempts': attempts,
        'detail': detail,
        'updated_at': datetime.utcnow(),
    }
    updated = views.update_rows(NOTIFICATION_TABLE, 'id = %s', [row_id], payload)
    if not updated:
        try:
            views.insert_row(NOTIFICATION_TABLE, {'id': row_id, **payload})
        except Exception:
            # A concurrent pass claimed the same deterministic key first. That is
            # the collision doing its job, not an error.
            logger.debug('Ledger row %s already claimed.', row_id, exc_info=True)


def _forget_stale_rows(live_ids, ledger):
    """Drop ledger rows whose assignment no longer exists.

    Keeps a re-assignment notifiable, and stops the ledger growing without bound
    as modules and tutors are deleted.
    """
    views = _views()
    stale = [row_id for row_id in ledger if row_id and row_id not in live_ids]
    for row_id in stale:
        try:
            views.delete_rows(NOTIFICATION_TABLE, 'id = %s', [row_id])
        except Exception:
            logger.debug('Could not drop stale ledger row %s.', row_id, exc_info=True)
