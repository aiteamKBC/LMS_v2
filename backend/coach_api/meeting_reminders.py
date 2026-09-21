"""Explicit learner reminders; never update a booking or its Teams event."""
import hashlib
from datetime import datetime
from html import escape

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST

from coach_api.auth import authenticated_coach_email, coach_access_required
from coach_api.models import CoachCalendarEvent
from learner_api.models import LearnerProfile
from login import email_azure


@coach_access_required
@require_POST
def coach_meeting_reminder(request, event_key):
    owner = authenticated_coach_email(request)
    try:
        record = CoachCalendarEvent.objects.annotate(owner_key=Lower(Trim('owner_email'))).filter(
            owner_key=owner, event_key=event_key,
            event_type__in=['mcr', 'progress-review', 'catch-up', 'student-support'],
        ).first()
        if record is None:
            return JsonResponse({'detail': 'Meeting not found.'}, status=404)
        learner = LearnerProfile.objects.annotate(coach_key=Lower(Trim('coach_email'))).filter(
            pk=record.learner_id, coach_key=owner,
        ).only('email', 'full_name').first()
    except DatabaseError:
        return JsonResponse({'detail': 'Meeting details are temporarily unavailable.'}, status=503)

    if learner is None:
        return JsonResponse({'detail': 'Meeting not found.'}, status=404)
    if record.status not in {'scheduled', 'confirmed'} or not record.scheduled_date or not record.scheduled_time:
        return JsonResponse({'detail': 'Only scheduled or confirmed meetings can receive a reminder.'}, status=409)
    zone = timezone.get_default_timezone()
    starts = timezone.make_aware(datetime.combine(record.scheduled_date, record.scheduled_time), zone)
    if starts <= timezone.now():
        return JsonResponse({'detail': 'This meeting has already started.'}, status=409)
    recipient = (learner.email or '').strip()
    try:
        validate_email(recipient)
    except ValidationError:
        return JsonResponse({'detail': 'The learner does not have a valid email address.'}, status=409)
    if not email_azure.is_configured():
        return JsonResponse({'detail': 'Email delivery is not configured. Contact your administrator.'}, status=503)

    # An atomic cache reservation prevents double clicks and immediate retries
    # sending again. Use the application's shared cache in multi-worker deployments.
    fingerprint = f'{owner}|{record.event_key}|{starts.isoformat()}|{recipient.lower()}'
    key = 'coach-reminder:' + hashlib.sha256(fingerprint.encode()).hexdigest()
    try:
        reserved = cache.add(key, 'sending', timeout=300)
        if not reserved:
            if cache.get(key) == 'sent':
                return JsonResponse({'sent': True, 'alreadySent': True, 'detail': 'A reminder was already accepted for delivery.'})
            return JsonResponse({'detail': 'A reminder is sending or its delivery is uncertain. Wait five minutes before trying again.'}, status=429)
    except Exception:
        return JsonResponse({'detail': 'Reminder delivery is temporarily unavailable.'}, status=503)

    label = {'mcr': 'Monthly Coaching', 'progress-review': 'Progress Review',
             'catch-up': 'Catch-up', 'student-support': 'Student Support'}[record.event_type]
    coach_name = (record.owner_name or 'Your coach').strip()
    learner_name = learner.full_name or 'Learner'
    lines = [f'Hello {learner_name},', '', f'This is a reminder for your {label} meeting.',
             f'Date: {starts:%d %B %Y}', f'Time: {starts:%H:%M %Z} ({zone})',
             f'Duration: {record.duration_minutes} minutes', f'Coach: {coach_name}']
    # The link and recipient come exclusively from authorized server records.
    if record.meeting_link and record.meeting_link.startswith('https://'):
        lines.extend(['', f'Join meeting: {record.meeting_link}'])
    lines.extend(['', 'Please open your learner calendar for the latest meeting details.'])
    body = '\n'.join(lines)
    meeting_link = record.meeting_link if record.meeting_link and record.meeting_link.startswith('https://') else ''
    details = ''.join(
        f'<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:34%;">{escape(label)}</td>'
        f'<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">{escape(value)}</td></tr>'
        for label, value in (
            ('Date', f'{starts:%d %B %Y}'),
            ('Time', f'{starts:%H:%M %Z} ({zone})'),
            ('Duration', f'{record.duration_minutes} minutes'),
            ('Coach', coach_name),
        )
    )
    safe_link = escape(meeting_link, quote=True)
    html_body = f'''<!doctype html>
<html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
<tr><td style="padding:22px 28px;background:#123c69;color:#ffffff;"><div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;opacity:.8;">KBC LMS</div><div style="margin-top:6px;font-size:24px;font-weight:700;">{escape(label)} reminder</div></td></tr>
<tr><td style="padding:30px 28px;"><p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Hello {escape(learner_name)},</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#334155;">Here are the details for your upcoming {escape(label.lower())} meeting.</p>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">{details}</table>
{f'<p style="margin:26px 0 14px;"><a href="{safe_link}" style="display:inline-block;padding:12px 22px;background:#123c69;color:#ffffff;text-decoration:none;border-radius:7px;font-size:14px;font-weight:700;">Join meeting in Teams</a></p><p style="margin:0 0 22px;font-size:12px;line-height:1.5;color:#64748b;word-break:break-all;">If the button does not work, copy this link:<br>{safe_link}</p>' if meeting_link else ''}
<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">Please open your learner calendar for the latest meeting details.</p></td></tr>
<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">Sent by {escape(coach_name)} via KBC LMS.</td></tr>
</table></td></tr></table></body></html>'''
    try:
        sent, _ = email_azure.send_mail(to=recipient, subject=f'Reminder: {label} meeting',
                                      html_body=html_body, text_body=body, sender_name=coach_name)
    except Exception:
        sent = False
    if not sent:
        # Keep the reservation: a transport timeout may follow acceptance.
        return JsonResponse({'detail': 'Email delivery could not be confirmed. Wait five minutes before retrying.'}, status=502)
    try:
        cache.set(key, 'sent', timeout=300)
    except Exception:
        return JsonResponse({'sent': True, 'detail': 'Email accepted for delivery, but repeat-send protection could not be refreshed. Do not resend yet.'})
    return JsonResponse({'sent': True, 'detail': 'Reminder email accepted for delivery.'})
