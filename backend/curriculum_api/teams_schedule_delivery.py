"""Individual schedule summaries, with durable claims before any mail request.

Calendar operations remain in the existing Teams endpoints. This endpoint only
reads Microsoft calendars and sends ordinary mail after verifying saved dates.
The owner provisions the ledger using backend/sql/teams_schedule_emails.sql.
"""
import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .teams_calendar_checks import utc_datetime, verify_calendar
from .teams_schedule_email import meeting_settings, render_change_email, render_schedule_email

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
    """The invited learners: attendees, minus everyone who runs the meeting."""
    recipients = v.teams_series_email_list(series.get('attendees'))
    excluded = set(v.teams_series_email_list(series.get('presenters'), series.get('co_organizers'), [series.get('organizer_email')]))
    return v.teams_attendee_emails([address for address in recipients if address not in excluded])


def organiser_recipients(v, series, learners):
    """The organiser, every co-organiser and every presenter, once each, from the stored calendar.

    Presenters run the sessions with the organisers, so they get the same copy.
    Never from the request, and never an address that is also an invited
    learner: one address gets one email, and a learner never gets the copy that
    lists the other learners.
    """
    learners = set(learners)
    return [address for address in v.teams_series_email_list([series.get('organizer_email')], series.get('co_organizers'),
                                                             series.get('presenters'))
            if address and address not in learners]


def learner_roster(recipients):
    names = learner_names(recipients)
    return [(names.get(email, ''), email) for email in recipients]


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
    """The learner copy and the organiser copy of a new calendar's schedule.

    Both are rendered from the saved occurrences only after Microsoft confirms
    those dates, links and learner invitations.
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
    organisers = organiser_recipients(v, series, recipients)
    organiser_copy = render_schedule_email(title, rows, zone, roster=learner_roster(recipients),
                                           settings=meeting_settings(series, zone), session_titles=names)
    return recipients, organisers, message, organiser_copy


def dispatch_by_role(key, learners, organisers, learner_copy, organiser_copy, ledger, send, retry_failed=False, parallel=False):
    """One ledger batch: each learner their own copy, each organiser the roster copy.

    The copy is chosen per address, so a learner is never handed the organiser
    copy and its list of the other learners, and an address listed twice is
    claimed, and emailed, once.
    """
    organiser_set = {address.strip().lower() for address in organisers}
    return dispatch_batch(key, [*learners, *organisers], None, ledger,
                          lambda recipient, _message: send(recipient, organiser_copy if recipient in organiser_set else learner_copy),
                          retry_failed, parallel)


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
        recipients, organisers, learner_copy, organiser_copy = verified_message(live_id)
        previous_queued = None
        while True:
            status = dispatch_by_role(live_id, recipients, organisers, learner_copy, organiser_copy,
                                      ledger, send or _send_message, parallel=True)
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


def learner_names(emails):
    """Display names for the organiser copy, from the learner records; '' when unknown."""
    try:
        from learner_api.models import LearnerProfile
        found = LearnerProfile.objects.filter(email_normalized__in=list(emails)).values_list('email_normalized', 'full_name')
        return {email: ' '.join(str(name or '').split()) for email, name in found}
    except Exception:
        # A name is a courtesy in the organiser copy; its absence must not stop
        # the learners hearing about their change. The email address is shown.
        logger.warning('Learner names for a schedule change could not be read.')
        return {}


def verified_change_messages(live_id, notice):
    """The learner copy and the organiser copy of one signed schedule change.

    Recipients and dates come only from the stored calendar and the server-signed
    notice. Learners get a copy with the shared schedule and nothing else; the
    organiser and co-organisers get the same change plus the invited learners.
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
    organisers = organiser_recipients(v, series, recipients)
    zone = calendar_time_zone(v, series, get_graph_settings())
    title = series.get('module_title')
    previous = as_occurrences(notice.get('before') or [])
    names = session_titles(v, live_id, series, rows)
    if same_schedule(notice.get('before') or [], notice.get('after') or []):
        # The author asked for the email and no date moved. A "was / now" with
        # nothing in either column tells them nothing, so they are sent the
        # schedule as it now stands -- under this update's own ledger key, so
        # it goes out rather than being suppressed as already delivered.
        learner_copy = render_schedule_email(title, current, zone, session_titles=names)
        organiser_copy = render_schedule_email(title, current, zone, roster=learner_roster(recipients),
                                               settings=meeting_settings(series, zone), session_titles=names)
    else:
        learner_copy = render_change_email(title, previous, current, zone, session_titles=names)
        organiser_copy = render_change_email(title, previous, current, zone, roster=learner_roster(recipients), session_titles=names)
    return recipients, organisers, learner_copy, organiser_copy


def added_only(recipients, organisers, added):
    """Narrow both lists to the people an update just added.

    ``added`` comes from the browser, so it only ever removes people: an address
    the stored calendar does not invite is dropped, never emailed. The ledger's
    calendar key still skips anyone already sent this schedule.
    """
    wanted = {str(value).strip().lower() for value in added}
    return [value for value in recipients if value in wanted], [value for value in organisers if value in wanted]


def dispatch_change(live_id, token, ledger, retry_failed=False, send=None):
    """Email one signed schedule change: each learner their copy, organisers theirs."""
    from .teams_schedule_notice import read_change_notice
    send = send or _send_message
    notice = read_change_notice(token, live_id)
    recipients, organisers, learner_copy, organiser_copy = verified_change_messages(live_id, notice)
    # Its own ledger key per change. The calendar's own key already holds
    # everyone the creation email reached, and "accepted once, never again" is
    # right for that email but would silence every update after it.
    return dispatch_by_role(f"{live_id}#{notice['id']}", recipients, organisers, learner_copy, organiser_copy,
                            ledger, send, retry_failed)


@transaction.non_atomic_requests
@require_role('admin', 'staff')
@require_POST
def schedule_email(request, live_session_id):
    """CSRF protected; only stored recipients/dates/links can enter a message."""
    from . import views as v
    payload = v.json_body(request)
    added = payload.get('addedPeople') if isinstance(payload, dict) else None
    if (not isinstance(payload, dict) or set(payload) - {'retryFailed', 'changeNotice', 'addedPeople'}
            or not isinstance(payload.get('retryFailed', False), bool)
            or not isinstance(payload.get('changeNotice', ''), str)
            or ('addedPeople' in payload and (payload.get('changeNotice') or not isinstance(added, list) or len(added) > 500
                                              or not all(isinstance(value, str) for value in added)))):
        return JsonResponse({'error': 'Supply only the retryFailed boolean and either a changeNotice or an addedPeople list.'}, status=400)
    try:
        ledger = DeliveryLedger(connection)
        ledger.check()
        from login import email_azure
        if not email_azure.is_configured():
            return JsonResponse({'error': 'Schedule emails are not configured. Check the existing Azure mail settings.',
                                 'code': 'schedule_email_not_configured'}, status=503)
        if payload.get('changeNotice'):
            return JsonResponse(dispatch_change(live_session_id, payload['changeNotice'], ledger, payload.get('retryFailed', False)))
        recipients, organisers, learner_copy, organiser_copy = verified_message(live_session_id)
        if added is not None:
            # People an update added: the same full schedule a creation sends,
            # under the calendar's own key, to them alone.
            recipients, organisers = added_only(recipients, organisers, added)
        return JsonResponse(dispatch_by_role(live_session_id, recipients, organisers, learner_copy, organiser_copy,
                                             ledger, _send_message, payload.get('retryFailed', False)))
    except (ValueError, RuntimeError) as exc:
        return JsonResponse({'error': str(exc), 'code': 'schedule_email_blocked'}, status=409)
    except Exception:
        logger.error('Schedule email batch could not finish; durable delivery claims remain intact.')
        return JsonResponse({'error': 'Schedule email status could not be confirmed. Retry to check pending messages; accepted messages will not be sent again.',
                             'code': 'schedule_email_status_unknown'}, status=502)
