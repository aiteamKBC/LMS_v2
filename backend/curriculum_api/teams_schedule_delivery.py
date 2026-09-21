"""Individual schedule summaries, with durable claims before any mail request.

Calendar operations remain in the existing Teams endpoints. This endpoint only
reads Microsoft calendars and sends ordinary mail after verifying saved dates.
The owner provisions the ledger using backend/sql/teams_schedule_emails.sql.
"""
import base64
import logging
from pathlib import Path
from urllib.parse import quote

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .teams_calendar_checks import utc_datetime, verify_calendar
from .teams_schedule_email import render_schedule_email

logger = logging.getLogger(__name__)
BATCH_SIZE = 4
TABLE = 'curriculum.teams_schedule_emails'


class DeliveryLedger:
    def __init__(self, db):
        self.db = db

    def check(self):
        if self.db.vendor != 'postgresql' or self.db.in_atomic_block or not self.db.get_autocommit():
            raise RuntimeError('Schedule email delivery needs the provisioned PostgreSQL ledger and autocommit.')
        with self.db.cursor() as cursor:
            cursor.execute('SELECT to_regclass(%s)', [TABLE])
            if not cursor.fetchone()[0]:
                raise RuntimeError('Schedule emails are not enabled yet. The owner must apply backend/sql/teams_schedule_emails.sql.')

    def enqueue(self, live_id, recipients):
        with self.db.cursor() as cursor:
            cursor.executemany(f'''INSERT INTO {TABLE} (live_session_id, recipient)
                VALUES (%s, %s) ON CONFLICT (live_session_id, recipient) DO NOTHING''',
                               [(live_id, recipient) for recipient in recipients])

    def states(self, live_id):
        with self.db.cursor() as cursor:
            cursor.execute(f'SELECT recipient, status FROM {TABLE} WHERE live_session_id = %s', [live_id])
            return dict(cursor.fetchall())

    def retry_failed(self, live_id, recipients):
        with self.db.cursor() as cursor:
            cursor.execute(f'''UPDATE {TABLE} SET status = 'queued', updated_at = CURRENT_TIMESTAMP
                WHERE live_session_id = %s AND recipient = ANY(%s) AND status = 'failed' ''', [live_id, recipients])

    def claim(self, live_id, recipient, retry_failed):
        # A committed conditional UPDATE is the latch shared by concurrent requests.
        allowed = ['queued', 'failed'] if retry_failed else ['queued']
        with self.db.cursor() as cursor:
            cursor.execute(f'''UPDATE {TABLE} SET status = 'sending', attempt_count = attempt_count + 1,
                error_code = '', updated_at = CURRENT_TIMESTAMP
                WHERE live_session_id = %s AND recipient = %s AND status = ANY(%s)
                RETURNING recipient''', [live_id, recipient, allowed])
            return cursor.fetchone() is not None

    def finish(self, live_id, recipient, status, code):
        with self.db.cursor() as cursor:
            cursor.execute(f'''UPDATE {TABLE} SET status = %s, error_code = %s, updated_at = CURRENT_TIMESTAMP
                WHERE live_session_id = %s AND recipient = %s AND status = 'sending' ''',
                           [status, code, live_id, recipient])


def dispatch_batch(live_id, recipients, message, ledger, send, retry_failed=False):
    """An uncertain send is never automatically repeated, even after a timeout."""
    recipients = list(dict.fromkeys(value.strip().lower() for value in recipients if value.strip()))
    ledger.check()
    ledger.enqueue(live_id, recipients)
    if retry_failed:
        ledger.retry_failed(live_id, recipients)
    before = ledger.states(live_id)
    attempted = 0
    for recipient in recipients:
        if attempted >= BATCH_SIZE:
            break
        if before.get(recipient) != 'queued':
            continue
        if not ledger.claim(live_id, recipient, False):
            continue
        attempted += 1
        try:
            status, code = send(recipient, message)
        except Exception:
            # No exception text, message body or learner address enters logs.
            status, code = 'unknown', 'mail_result_unknown'
        ledger.finish(live_id, recipient, status, code)
    states = ledger.states(live_id)
    counts = {status: sum(states.get(recipient) == status for recipient in recipients)
              for status in ('queued', 'accepted', 'failed', 'sending', 'unknown')}
    return {'total': len(recipients), 'accepted': counts['accepted'], 'queued': counts['queued'],
            'failed': counts['failed'], 'uncertain': counts['sending'] + counts['unknown'],
            'status': 'complete' if counts['accepted'] == len(recipients) else 'pending'}


def _send_message(recipient, message):
    import httpx
    from login import email_azure
    if not email_azure.is_configured():
        return 'failed', 'mail_not_configured'
    try:
        token = email_azure._access_token()
        logo = base64.b64encode((Path(__file__).with_name('templates') / 'kbc-logo.png').read_bytes()).decode('ascii')
    except (email_azure.EmailNotConfigured, email_azure.EmailSendError, httpx.HTTPError):
        return 'failed', 'mail_authorization_failed'
    except OSError:
        return 'failed', 'mail_logo_missing'
    subject, html, _text = message
    payload = {'message': {
        'subject': subject, 'body': {'contentType': 'HTML', 'content': html},
        'toRecipients': [{'emailAddress': {'address': recipient}}],
        'attachments': [{'@odata.type': '#microsoft.graph.fileAttachment', 'name': 'kbc-logo.png',
                         'contentType': 'image/png', 'contentId': 'kbc-schedule-logo',
                         'isInline': True, 'contentBytes': logo}],
    }, 'saveToSentItems': True}
    sender = quote(email_azure.mail_config()['sender'], safe='')
    try:
        response = httpx.post(f'{email_azure.GRAPH_BASE}/users/{sender}/sendMail',
                              headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                              json=payload, timeout=15.0)
    except httpx.HTTPError:
        return 'unknown', 'mail_transport_unknown'
    if response.status_code == 202:
        return 'accepted', ''
    # 5xx/timeouts can be ambiguous. Do not risk a duplicate by retrying them.
    if 400 <= response.status_code < 500 and response.status_code != 408:
        return 'failed', f'mail_rejected_{response.status_code}'
    return 'unknown', f'mail_result_{response.status_code}'


def verified_message(live_id):
    from coach_api.views import get_graph_settings, microsoft_graph_request
    from . import views as v
    series_rows = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)
    if not series_rows or series_rows[0].get('status') != 'active':
        raise ValueError('The active Teams calendar could not be found.')
    series = series_rows[0]
    if v.parse_json_value(series.get('warnings'), []):
        raise ValueError('Finish calendar verification before sending schedule emails.')
    rows = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE,
                                "live_session_id = %s and status <> 'cancelled'", [live_id], 'session_number', ensure_tables=False)
    recipients = v.teams_series_email_list(series.get('attendees'))
    excluded = set(v.teams_series_email_list(series.get('presenters'), series.get('co_organizers'), [series.get('organizer_email')]))
    recipients = v.teams_attendee_emails([address for address in recipients if address not in excluded])
    message = render_schedule_email(series.get('module_title'), rows, v.graph_timezone_iana(get_graph_settings()))
    manifest = v.stored_calendar_series(series)
    if not manifest:
        manifest = [{'eventId': series.get('graph_event_id'), 'joinUrl': series.get('join_url'),
                     'sessionNumbers': [row['session_number'] for row in rows]}]
    covered = set()
    owner = quote(series.get('organizer_email') or '', safe='')
    for item in manifest:
        group = [row for row in rows if row['session_number'] in item['sessionNumbers']]
        if not group or any(row['session_number'] in covered or row['join_url'] != item['joinUrl'] for row in group):
            raise ValueError('The saved session-to-meeting links are inconsistent.')
        targets = [{'session_number': row['session_number'], 'start': utc_datetime(row['scheduled_start']),
                    'end': utc_datetime(row['scheduled_end'])} for row in group]
        checked = verify_calendar(microsoft_graph_request, owner, item['eventId'], targets, item['joinUrl'],
                                  len(group) > 1 if v.stored_calendar_series(series) else series.get('repeat_pattern') != 'none')
        invited = {str((attendee.get('emailAddress') or {}).get('address') or '').strip().lower()
                   for attendee in checked.get('attendees', [])}
        if not set(recipients).issubset(invited):
            raise ValueError('Microsoft has not confirmed every learner invitation yet.')
        covered.update(row['session_number'] for row in group)
    if len(covered) != len(rows):
        raise ValueError('Some saved sessions do not have a verified meeting.')
    return recipients, message


@transaction.non_atomic_requests
@require_role('admin', 'staff')
@require_POST
def schedule_email(request, live_session_id):
    """CSRF protected; only stored recipients/dates/links can enter a message."""
    from . import views as v
    payload = v.json_body(request)
    if not isinstance(payload, dict) or set(payload) - {'retryFailed'} or not isinstance(payload.get('retryFailed', False), bool):
        return JsonResponse({'error': 'Supply only the retryFailed boolean.'}, status=400)
    try:
        ledger = DeliveryLedger(connection)
        ledger.check()
        from login import email_azure
        if not email_azure.is_configured():
            return JsonResponse({'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                                 'code': 'schedule_email_not_configured'}, status=503)
        recipients, message = verified_message(live_session_id)
        result = dispatch_batch(live_session_id, recipients, message, ledger, _send_message, payload.get('retryFailed', False))
        return JsonResponse(result)
    except (ValueError, RuntimeError) as exc:
        return JsonResponse({'error': str(exc), 'code': 'schedule_email_blocked'}, status=409)
    except Exception:
        logger.error('Schedule email batch could not finish; durable delivery claims remain intact.')
        return JsonResponse({'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                             'code': 'schedule_email_status_unknown'}, status=502)
