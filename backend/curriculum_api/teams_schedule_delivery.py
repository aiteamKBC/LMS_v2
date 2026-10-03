"""Individual schedule summaries, with durable claims before any mail request.

Calendar operations remain in the existing Teams endpoints. This endpoint only
reads Microsoft calendars and sends ordinary mail after verifying saved dates.
The owner provisions the ledger using backend/sql/teams_schedule_emails.sql.
"""
import base64
import logging
import re
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .teams_calendar_checks import utc_datetime, verify_calendar
from .teams_schedule_email import render_change_email, render_schedule_email

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


def _guarded_send(send, recipient, message):
    try:
        return send(recipient, message)
    except Exception:
        # No exception text, message body or learner address enters logs.
        return 'unknown', 'mail_result_unknown'


def valid_resend_key(value):
    """A resend names its own batch, so "accepted once, never again" applies inside
    that one press instead of silencing it.

    The browser generates the name and repeats it across the press's batches,
    which is what makes its retry safe. The name carries no recipient and no
    date -- both are still read back from the stored calendar -- so all it can
    ever decide is whether this press starts a fresh round or continues one.
    """
    return isinstance(value, str) and bool(re.match(r'^[A-Za-z0-9-]{8,64}$', value))


def dispatch_batch(live_id, recipients, message, ledger, send, retry_failed=False, parallel=False):
    """An uncertain send is never automatically repeated, even after a timeout.

    ``parallel`` claims the whole batch first and then submits its mails side by
    side, never more than ``BATCH_SIZE`` at once (Microsoft's own concurrency
    limit per mailbox). Every claim is still committed before its mail request,
    so a result that is lost stays 'sending' and is never sent again.
    """
    recipients = list(dict.fromkeys(value.strip().lower() for value in recipients if value.strip()))
    ledger.check()
    ledger.enqueue(live_id, recipients)
    if retry_failed:
        ledger.retry_failed(live_id, recipients)
    before = ledger.states(live_id)
    attempted = 0
    claimed = []
    for recipient in recipients:
        if attempted >= BATCH_SIZE:
            break
        if before.get(recipient) != 'queued':
            continue
        if not ledger.claim(live_id, recipient, False):
            continue
        attempted += 1
        if parallel:
            claimed.append(recipient)
            continue
        status, code = _guarded_send(send, recipient, message)
        ledger.finish(live_id, recipient, status, code)
    if claimed:
        # Only the mail requests run on the pool; every ledger write stays on
        # this thread and its database connection.
        with ThreadPoolExecutor(max_workers=min(BATCH_SIZE, len(claimed))) as pool:
            results = list(pool.map(lambda recipient: _guarded_send(send, recipient, message), claimed))
        for recipient, (status, code) in zip(claimed, results):
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


def learner_recipients(v, series):
    """The invited learners: attendees, minus everyone who runs the meeting.

    They are the only people a schedule email is addressed to. The organiser,
    co-organisers and presenters are on Microsoft's own invitation and get
    nothing from the LMS.
    """
    recipients = v.teams_series_email_list(series.get('attendees'))
    excluded = set(v.teams_series_email_list(series.get('presenters'), series.get('co_organizers'), [series.get('organizer_email')]))
    return v.teams_attendee_emails([address for address in recipients if address not in excluded])


def session_titles(v, live_id, series, rows):
    """Each session's name: the title of the live-session component it is attached to.

    Attaching a calendar stamps every live-session component with its
    occurrence id and with this calendar's id and session number, so the
    component names the session, not its position in the week. A session no
    component names keeps its number in the email.
    """
    module_id = str(series.get('module_catalogue_id') or '').strip()
    if not module_id:
        return {}
    try:
        components = v.active_component_rows(v.authoring_fetch_all(
            v.AUTHORING_COMPONENTS_TABLE, "module_catalogue_id = %s and type in ('live_session', 'live-session')",
            [module_id], 'display_order, id', ensure_tables=False))
    except Exception:
        # A title is a courtesy; its absence must not stop learners hearing
        # about their schedule. The session number is shown instead.
        logger.warning('Live-session titles for a schedule email could not be read.')
        return {}
    numbers = {str(row.get('id') or ''): int(row['session_number']) for row in rows if row.get('id')}
    by_occurrence, by_number = {}, {}
    for component in components:
        title = ' '.join(str(component.get('title') or '').split())
        if not title:
            continue
        settings = v.component_builder_settings(component)
        occurrence_number = numbers.get(str(settings.get('teamsOccurrenceId') or ''))
        if occurrence_number:
            by_occurrence.setdefault(occurrence_number, title)
        number = v.parse_int(settings.get('teamsSessionNumber'), 0)
        if str(settings.get('teamsLiveSessionId') or '') == str(live_id) and number > 0:
            by_number.setdefault(number, title)
    return {**by_number, **by_occurrence}


def calendar_time_zone(v, series, graph_settings):
    """The zone this calendar was scheduled in, the one its emails print times in.

    The calendar's own saved zone, read the way the schedule endpoint reads it,
    so an Egypt calendar's email says 09:00 like the meeting does. Only a
    calendar with no saved zone falls back to the tenant-wide setting.
    """
    return v.graph_timezone_iana(v.teams_schedule_settings(graph_settings, series=series))


def verified_message(live_id):
    """The learners and the schedule email of a new calendar.

    Rendered from the saved occurrences only after Microsoft confirms those
    dates, links and learner invitations.
    """
    from coach_api.views import get_graph_settings
    from . import views as v
    series_rows = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)
    if not series_rows or series_rows[0].get('status') != 'active':
        raise ValueError('The active Teams calendar could not be found.')
    series = series_rows[0]
    if v.parse_json_value(series.get('warnings'), []):
        raise ValueError('Finish calendar verification before sending schedule emails.')
    rows = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE,
                                "live_session_id = %s and status <> 'cancelled'", [live_id], 'session_number', ensure_tables=False)
    recipients = learner_recipients(v, series)
    zone = calendar_time_zone(v, series, get_graph_settings())
    title = series.get('module_title')
    names = session_titles(v, live_id, series, rows)
    message = render_schedule_email(title, rows, zone, session_titles=names)
    verify_saved_calendar(v, series, rows, recipients)
    return recipients, message


def send_creation_emails(live_id, ledger=None, send=None):
    """Send a just-created calendar's schedule emails, all of them, in one go.

    Called by the create endpoint once Microsoft has built the calendar, moved
    its dates and accepted the invitations. It is the same verified message and
    the same ledger as the schedule-email endpoint, so nobody is emailed twice:
    a browser that retries afterwards only reads back what was already sent.

    Batches repeat until nothing is queued. A batch that makes no progress stops
    the loop instead of spinning, and whatever is left stays queued for the
    browser's "Retry pending emails". Never raises: the calendar is already
    saved, and a mail problem is reported next to it rather than in its place.
    """
    try:
        from login import email_azure
        ledger = ledger or DeliveryLedger(connection)
        ledger.check()
        if not email_azure.is_configured():
            return {'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                    'code': 'schedule_email_not_configured'}
        recipients, message = verified_message(live_id)
        previous_queued = None
        while True:
            status = dispatch_batch(live_id, recipients, message, ledger, send or _send_message, parallel=True)
            if not status['queued'] or (previous_queued is not None and status['queued'] >= previous_queued):
                return status
            previous_queued = status['queued']
    except (ValueError, RuntimeError) as exc:
        return {'error': str(exc), 'code': 'schedule_email_blocked'}
    except Exception:
        logger.error('Creation schedule emails could not finish; durable delivery claims remain intact.')
        return {'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                'code': 'schedule_email_status_unknown'}


def verify_saved_calendar(v, series, rows, recipients):
    """Microsoft holds exactly these rows, on these links, with every learner invited."""
    from coach_api.views import microsoft_graph_request
    manifest = v.stored_calendar_series(series)
    if not manifest:
        manifest = [{'eventId': series.get('graph_event_id'), 'joinUrl': series.get('join_url'),
                     'sessionNumbers': [row['session_number'] for row in rows]}]
    covered = set()
    owner = quote(series.get('organizer_email') or '', safe='')
    for item in manifest:
        group = [row for row in rows if row['session_number'] in item['sessionNumbers']]
        # `rows` holds the sessions still standing, so a meeting whose sessions
        # were all cancelled simply has nothing left here to verify. Reading
        # that as a broken manifest is what stopped a cancellation email: the
        # calendar was consistent, one of its meetings had just been withdrawn.
        if not group:
            continue
        if any(row['session_number'] in covered or row['join_url'] != item['joinUrl'] for row in group):
            raise ValueError('The saved session-to-meeting links are inconsistent.')
        targets = [{'session_number': row['session_number'], 'start': utc_datetime(row['scheduled_start']),
                    'end': utc_datetime(row['scheduled_end'])} for row in group]
        # Whether this meeting is a recurring one is a fact about how it was
        # booked, not about how many of its sessions survive. Read from the
        # surviving count, a series whose last-but-one session was cancelled
        # would be read back as a single event and never match.
        checked = verify_calendar(microsoft_graph_request, owner, item['eventId'], targets, item['joinUrl'],
                                  len(item['sessionNumbers']) > 1 if v.stored_calendar_series(series)
                                  else series.get('repeat_pattern') != 'none')
        invited = {str((attendee.get('emailAddress') or {}).get('address') or '').strip().lower()
                   for attendee in checked.get('attendees', [])}
        if not set(recipients).issubset(invited):
            raise ValueError('Microsoft has not confirmed every learner invitation yet.')
        covered.update(row['session_number'] for row in group)
    if len(covered) != len(rows):
        raise ValueError('Some saved sessions do not have a verified meeting.')


def verified_change_message(live_id, notice):
    """The learners and the email of one signed schedule change.

    Recipients and dates come only from the stored calendar and the server-signed
    notice. Each learner gets a copy with the shared schedule and nothing else.
    """
    from coach_api.views import get_graph_settings
    from . import views as v
    from .teams_schedule_notice import as_occurrences, same_schedule, schedule_snapshot
    series_rows = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)
    if not series_rows:
        raise ValueError('The Teams calendar could not be found.')
    series = series_rows[0]
    if v.parse_json_value(series.get('warnings'), []):
        raise ValueError('Finish calendar verification before sending schedule emails.')
    rows = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE,
                                "live_session_id = %s and status <> 'cancelled'", [live_id], 'session_number', ensure_tables=False)
    current = rows if series.get('status') == 'active' else []
    if not same_schedule(schedule_snapshot(current), notice.get('after') or []):
        raise ValueError('The calendar changed again after this update, so this email would describe the wrong dates. Review the latest calendar first.')
    recipients = learner_recipients(v, series)
    if current:
        verify_saved_calendar(v, series, current, recipients)
    zone = calendar_time_zone(v, series, get_graph_settings())
    title = series.get('module_title')
    previous = as_occurrences(notice.get('before') or [])
    names = session_titles(v, live_id, series, rows)
    if same_schedule(notice.get('before') or [], notice.get('after') or []):
        # The author asked for the email and no date moved. A "was / now" with
        # nothing in either column tells them nothing, so they are sent the
        # schedule as it now stands -- under this update's own ledger key, so
        # it goes out rather than being suppressed as already delivered.
        message = render_schedule_email(title, current, zone, session_titles=names)
    else:
        message = render_change_email(title, previous, current, zone, session_titles=names)
    return recipients, message


def added_only(recipients, added):
    """Narrow the learners to the ones an update just added.

    ``added`` comes from the browser, so it only ever removes people: an address
    the stored calendar does not invite as a learner is dropped, never emailed.
    The ledger's calendar key still skips anyone already sent this schedule.
    """
    wanted = {str(value).strip().lower() for value in added}
    return [value for value in recipients if value in wanted]


def dispatch_change(live_id, token, ledger, retry_failed=False, send=None, parallel=False):
    """Email one signed schedule change: each learner their own copy."""
    from .teams_schedule_notice import read_change_notice
    send = send or _send_message
    notice = read_change_notice(token, live_id)
    recipients, message = verified_change_message(live_id, notice)
    # Its own ledger key per change. The calendar's own key already holds
    # everyone the creation email reached, and "accepted once, never again" is
    # right for that email but would silence every update after it.
    return dispatch_batch(f"{live_id}#{notice['id']}", recipients, message, ledger, send, retry_failed, parallel)


def send_change_emails(live_id, token, ledger=None, send=None):
    """Deliver a confirmed schedule change from the server.

    Cancellation actions use this path so closing the browser cannot prevent
    the LMS notice. The ledger makes retries idempotent and keeps accepted
    recipients from receiving a duplicate message.
    """
    try:
        from login import email_azure
        ledger = ledger or DeliveryLedger(connection)
        ledger.check()
        if not email_azure.is_configured():
            return {'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                    'code': 'schedule_email_not_configured'}
        previous_queued = None
        while True:
            status = dispatch_change(live_id, token, ledger, send=send or _send_message, parallel=True)
            if not status['queued'] or (previous_queued is not None and status['queued'] >= previous_queued):
                return status
            previous_queued = status['queued']
    except (ValueError, RuntimeError) as exc:
        return {'error': str(exc), 'code': 'schedule_email_blocked'}
    except Exception:
        logger.error('Schedule change emails could not finish; durable delivery claims remain intact.')
        return {'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                'code': 'schedule_email_status_unknown'}


@transaction.non_atomic_requests
@require_role('admin', 'staff')
@require_POST
def schedule_email(request, live_session_id):
    """CSRF protected; only stored recipients/dates/links can enter a message."""
    from . import views as v
    payload = v.json_body(request)
    added = payload.get('addedPeople') if isinstance(payload, dict) else None
    resend = payload.get('resendKey') if isinstance(payload, dict) else None
    if (not isinstance(payload, dict) or set(payload) - {'retryFailed', 'changeNotice', 'addedPeople', 'resendKey'}
            or not isinstance(payload.get('retryFailed', False), bool)
            or not isinstance(payload.get('changeNotice', ''), str)
            or ('addedPeople' in payload and (payload.get('changeNotice') or not isinstance(added, list) or len(added) > 500
                                              or not all(isinstance(value, str) for value in added)))
            or ('resendKey' in payload and (payload.get('changeNotice') or 'addedPeople' in payload
                                            or not valid_resend_key(resend)))):
        return JsonResponse({'error': 'Supply only the retryFailed boolean and one of a changeNotice, an addedPeople list or a resendKey.'}, status=400)
    try:
        ledger = DeliveryLedger(connection)
        ledger.check()
        from login import email_azure
        if not email_azure.is_configured():
            return JsonResponse({'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                                 'code': 'schedule_email_not_configured'}, status=503)
        if payload.get('changeNotice'):
            return JsonResponse(dispatch_change(live_session_id, payload['changeNotice'], ledger, payload.get('retryFailed', False)))
        recipients, message = verified_message(live_session_id)
        if added is not None:
            # Learners an update added: the same full schedule a creation sends,
            # under the calendar's own key, to them alone.
            recipients = added_only(recipients, added)
        # A resend is the creation email again, to every learner the saved
        # calendar invites -- including the ones it already reached. Only the
        # ledger key changes: the message and the recipients are still the
        # verified ones read back from the stored calendar, never anything sent here.
        key = f'{live_session_id}@{resend}' if resend else live_session_id
        return JsonResponse(dispatch_batch(key, recipients, message, ledger, _send_message, payload.get('retryFailed', False)))
    except (ValueError, RuntimeError) as exc:
        return JsonResponse({'error': str(exc), 'code': 'schedule_email_blocked'}, status=409)
    except Exception:
        logger.error('Schedule email batch could not finish; durable delivery claims remain intact.')
        return JsonResponse({'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                             'code': 'schedule_email_status_unknown'}, status=502)


def week_meeting_message(live_id):
    """The guests and the schedule email of one additional week meeting.

    The same rendered email the module's calendar sends, for a calendar of one
    session. Where it differs from `verified_message` is only what genuinely
    differs:

    * The row is looked up as a week meeting (``status = 'week-meeting'``), so a
      module series can never be emailed through here and vice versa.
    * There is no occurrences table row to read: this meeting is a single event
      with no series, so its one session is built from the stored start,
      duration and join link that Microsoft already confirmed.
    * Its recipients are the guests named on its own form, never the module's
      learners. `learner_recipients` reads the invitation columns off the row,
      which is exactly what those hold.
    """
    from coach_api.views import get_graph_settings
    from . import views as v
    series_rows = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)
    if not series_rows or v.clean_str(series_rows[0].get('status')) != 'week-meeting':
        raise ValueError('The additional meeting could not be found.')
    series = series_rows[0]
    start = v.parse_graph_datetime(series.get('start_datetime'))
    join_url = v.clean_str(series.get('join_url'))
    if not start or not join_url:
        raise ValueError('The meeting has no confirmed time or join link yet.')
    duration = max(15, min(1440, v.parse_int(series.get('duration_minutes'), 60)))
    title = v.clean_str(series.get('module_title')) or 'Live session'
    rows = [{
        'session_number': 1,
        'scheduled_start': start,
        'scheduled_end': start + timedelta(minutes=duration),
        'join_url': join_url,
    }]
    recipients = learner_recipients(v, series)
    zone = calendar_time_zone(v, series, get_graph_settings())
    # Named after the meeting itself rather than "SESSION 01": a one-off has a
    # name, and it is the one the invitation already carries.
    names = {1: title}
    message = render_schedule_email(title, rows, zone, session_titles=names)
    return recipients, message


def send_week_meeting_emails(live_id, ledger=None, send=None):
    """Send an additional week meeting's schedule email, from us, to its guests.

    Microsoft's own invitation is a calendar item; this is the readable schedule
    with the date, the time and the join button, which is the pair the module's
    calendar already sends. Same ledger as every other schedule email, keyed by
    the meeting's own id, so a retry re-reads what was sent rather than sending
    it twice.

    Never raises: the meeting is booked and saved by the time this runs, and a
    mail problem is reported beside it rather than in place of it.
    """
    try:
        from login import email_azure
        ledger = ledger or DeliveryLedger(connection)
        ledger.check()
        if not email_azure.is_configured():
            return {'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                    'code': 'schedule_email_not_configured'}
        recipients, message = week_meeting_message(live_id)
        if not recipients:
            return {'total': 0, 'accepted': 0, 'queued': 0, 'failed': 0, 'uncertain': 0, 'status': 'complete'}
        previous_queued = None
        while True:
            status = dispatch_batch(live_id, recipients, message, ledger, send or _send_message, parallel=True)
            if not status['queued'] or (previous_queued is not None and status['queued'] >= previous_queued):
                return status
            previous_queued = status['queued']
    except (ValueError, RuntimeError) as exc:
        return {'error': str(exc), 'code': 'schedule_email_blocked'}
    except Exception:
        logger.error('Additional meeting schedule emails could not finish; durable delivery claims remain intact.')
        return {'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                'code': 'schedule_email_status_unknown'}
