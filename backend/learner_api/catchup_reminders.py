"""Reminder emails to the learner 24 hours and 1 hour before a booked catch-up.

Reminders read bookings only; they never change a booking or its Teams event.
Each reminder is recorded (coach_api.CatchupReminder) before it is sent, so
several servers never send the same one twice. Sending is off unless
CATCHUP_REMINDERS_ENABLED is set, so local servers on a shared database do not
email learners.
"""
import logging
import os
import sys
import threading
from datetime import datetime, timedelta, timezone as dt_timezone
from html import escape
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError

log = logging.getLogger(__name__)

UK = ZoneInfo('Europe/London')
POLL_SECONDS = 300
# The day-before reminder goes out between 24 and 12 hours before the start;
# a catch-up booked later than that only gets the hour-before reminder.
DAY_WINDOW = (timedelta(hours=12), timedelta(hours=24))
HOUR_WINDOW = (timedelta(0), timedelta(hours=1))

_lock = threading.Lock()
_thread = None
_stop = threading.Event()


def enabled() -> bool:
    return os.environ.get('CATCHUP_REMINDERS_ENABLED', 'false').strip().lower() in {'1', 'true', 'on', 'yes'}


def reminder_kind(starts_at, now):
    """Which reminder is due for a catch-up starting at ``starts_at``, if any."""
    from coach_api.models import CatchupReminder
    left = starts_at - now
    if HOUR_WINDOW[0] < left <= HOUR_WINDOW[1]:
        return CatchupReminder.KIND_HOUR
    if DAY_WINDOW[0] < left <= DAY_WINDOW[1]:
        return CatchupReminder.KIND_DAY
    return None


def due_reminders(now=None):
    """[(booking, kind, starts_at)] for scheduled catch-ups that need a reminder now."""
    from coach_api.models import CatchupReminder, CoachCalendarEvent
    now = now or datetime.now(dt_timezone.utc)
    today = now.astimezone(UK).date()
    bookings = CoachCalendarEvent.objects.filter(
        event_type='catch-up', status=CoachCalendarEvent.STATUS_SCHEDULED,
        scheduled_date__gte=today, scheduled_date__lte=today + timedelta(days=2),
        scheduled_time__isnull=False,
    )
    due = []
    for booking in bookings:
        starts_at = datetime.combine(booking.scheduled_date, booking.scheduled_time, UK)
        kind = reminder_kind(starts_at, now)
        if kind:
            due.append((booking, kind, starts_at))
    if not due:
        return []
    sent = set(CatchupReminder.objects.filter(
        event_key__in=[booking.event_key for booking, _kind, _start in due],
    ).values_list('event_key', 'kind', 'starts_at'))
    return [(booking, kind, starts_at) for booking, kind, starts_at in due
            if (booking.event_key, kind, starts_at) not in sent]


def reminder_email(booking, kind, starts_at):
    """(subject, html, text) for one catch-up reminder."""
    local = starts_at.astimezone(UK)
    when = 'tomorrow' if kind == '24h' else 'in 1 hour'
    coach = (booking.owner_name or 'your coach').strip()
    learner = (booking.learner_name or 'there').strip()
    link = booking.meeting_link if (booking.meeting_link or '').startswith('https://') else ''
    rows = (('Date', f'{local:%A %d %B %Y}'), ('Time', f'{local:%H:%M} (UK time)'),
            ('Duration', f'{booking.duration_minutes or 30} minutes'), ('Coach', coach))
    subject = f'Reminder: your catch-up session {when} at {local:%H:%M}'
    text = '\n'.join([f'Hello {learner},', '', f'Your catch-up session with {coach} is {when}.', '',
                      *[f'{label}: {value}' for label, value in rows],
                      *(['', f'Join meeting: {link}'] if link else []),
                      '', 'You can change or cancel it from your learner calendar until 12 hours before it starts.'])
    details = ''.join(
        f'<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:34%;">{escape(label)}</td>'
        f'<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">{escape(value)}</td></tr>'
        for label, value in rows)
    safe_link = escape(link, quote=True)
    button = (f'<p style="margin:26px 0 14px;"><a href="{safe_link}" style="display:inline-block;padding:12px 22px;'
              f'background:#123c69;color:#ffffff;text-decoration:none;border-radius:7px;font-size:14px;font-weight:700;">'
              f'Join meeting in Teams</a></p>') if link else ''
    html = f'''<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
<tr><td style="padding:22px 28px;background:#123c69;color:#ffffff;"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.8;">KBC LMS</div><div style="margin-top:6px;font-size:24px;font-weight:700;">Catch-up {escape(when)}</div></td></tr>
<tr><td style="padding:30px 28px;"><p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Hello {escape(learner)},</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#334155;">Your catch-up session with {escape(coach)} is {escape(when)}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">{details}</table>
{button}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">You can change or cancel it from your learner calendar until 12 hours before it starts.</p></td></tr>
</table></td></tr></table></body></html>'''
    return subject, html, text


def send_due_reminders(now=None) -> int:
    """Send every reminder due now; return how many were accepted for delivery."""
    from coach_api.models import CatchupReminder
    from login import email_azure
    if not email_azure.is_configured():
        return 0
    accepted = 0
    for booking, kind, starts_at in due_reminders(now):
        recipient = (booking.learner_email or '').strip()
        try:
            validate_email(recipient)
        except ValidationError:
            continue
        try:
            # Recorded first: another server that reached this reminder skips it.
            reminder = CatchupReminder.objects.create(
                event_key=booking.event_key, kind=kind, starts_at=starts_at, recipient=recipient)
        except IntegrityError:
            continue
        subject, html, text = reminder_email(booking, kind, starts_at)
        try:
            sent, _detail = email_azure.send_mail(to=recipient, subject=subject, html_body=html, text_body=text,
                                                  sender_name=(booking.owner_name or '').strip() or None)
        except Exception:  # noqa: BLE001 - delivery may have been accepted; never risk sending twice
            log.warning('Catch-up reminder for %s may not have been delivered.', booking.event_key)
            continue
        if sent:
            CatchupReminder.objects.filter(pk=reminder.pk).update(sent=True)
            accepted += 1
        else:
            # Refused outright: free the reminder so the next run retries it.
            reminder.delete()
    return accepted


def _loop():
    from django.db import close_old_connections, connections
    while not _stop.is_set():
        try:
            close_old_connections()
            send_due_reminders()
        except Exception as error:  # noqa: BLE001 - keep the scheduler alive
            log.error('Catch-up reminders could not run (%s); they will retry.', type(error).__name__)
        finally:
            connections.close_all()
        _stop.wait(POLL_SECONDS)


def start_reminders() -> bool:
    """One reminder loop per serving process, only where explicitly enabled."""
    global _thread
    if not enabled():
        return False
    if any(arg in {'test', 'pytest', 'py.test'} for arg in sys.argv) or 'PYTEST_CURRENT_TEST' in os.environ:
        return False
    with _lock:
        if _thread is not None and _thread.is_alive():
            return True
        try:
            _thread = threading.Thread(target=_loop, name='catchup-reminders', daemon=True)
            _thread.start()
        except RuntimeError as error:
            log.error('Could not start catch-up reminders (%s).', type(error).__name__)
            _thread = None
            return False
    return True


class CatchupReminderWSGI:
    def __init__(self, application):
        self.application = application

    def __call__(self, environ, start_response):
        start_reminders()
        return self.application(environ, start_response)


class CatchupReminderASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http':
            start_reminders()
        await self.application(scope, receive, send)
