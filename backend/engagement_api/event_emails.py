"""Reusable event email templates and safe per-event copy rendering."""
from __future__ import annotations

from functools import lru_cache
from html import escape
from pathlib import Path

from django.http import JsonResponse

from .helpers import json_body, json_error
from .models import Event, EventEmailSetting, EventEmailTemplate
from .permissions import actor_name, require_staff


DEFAULTS = {
    'event_rsvp': {
        'subject': 'Can you attend {{event_title}}?',
        'body': (
            'Hello {{recipient_name}},\n\n'
            'Please let us know whether you can attend {{event_title}} on {{event_date}} '
            'at {{event_location}}.'
        ),
        'buttonText': 'Respond to invitation',
    },
    'post_event': {
        'subject': 'Feedback for {{event_title}}',
        'body': (
            'Hello {{recipient_name}},\n\n'
            'Thank you for attending {{event_title}}. Please share your feedback with us.'
        ),
        'buttonText': 'Open event feedback',
    },
}

EVENT_LOGO_CID = 'kbc-event-logo'


@lru_cache(maxsize=1)
def _event_logo_bytes():
    path = Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'assets' / 'kbc-logo.png'
    return path.read_bytes()


def event_logo_attachment():
    return {
        'name': 'kent-business-college-logo.png',
        'content_type': 'image/png',
        'content': _event_logo_bytes(),
        'content_id': EVENT_LOGO_CID,
        'is_inline': True,
    }


def _purpose(value):
    value = str(value or '').strip()
    if value not in DEFAULTS:
        raise ValueError('Unsupported event email purpose.')
    return value


def _clean_copy(payload):
    subject = str(payload.get('subject', '')).strip()
    body = str(payload.get('body', '')).strip()
    button_text = str(payload.get('buttonText', '')).strip()
    if not subject or len(subject) > 255:
        raise ValueError('Email subject is required and must be 255 characters or fewer.')
    if not body or len(body) > 10000:
        raise ValueError('Email body is required and must be 10,000 characters or fewer.')
    if not button_text or len(button_text) > 120:
        raise ValueError('Button text is required and must be 120 characters or fewer.')
    return subject, body, button_text


def template_dict(item):
    return {
        'id': item.id, 'name': item.name, 'purpose': item.purpose,
        'subject': item.subject, 'body': item.body, 'buttonText': item.button_text,
    }


def event_email_content(event, purpose):
    purpose = _purpose(purpose)
    setting = EventEmailSetting.objects.filter(event=event, purpose=purpose).first()
    if setting:
        return {
            'templateId': setting.template_id, 'subject': setting.subject,
            'body': setting.body, 'buttonText': setting.button_text,
        }
    return {'templateId': None, **DEFAULTS[purpose]}


def render_email(event, recipient_name, link, purpose, notice=''):
    copy = event_email_content(event, purpose)
    values = {
        '{{recipient_name}}': str(recipient_name),
        '{{event_title}}': str(event.title),
        '{{event_date}}': str(event.date),
        '{{event_time}}': str(event.time),
        '{{event_location}}': str(event.location),
        '{{form_link}}': str(link),
    }

    def render(value):
        for token, replacement in values.items():
            value = value.replace(token, replacement)
        return value

    subject = render(copy['subject']).replace('\r', ' ').replace('\n', ' ')
    body = render(copy['body'])
    button_text = render(copy['buttonText'])
    notice = str(notice or '').strip()
    safe_link = escape(link, quote=True)
    paragraphs = ''.join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#342a40;">{paragraph.replace(chr(10), "<br>")}</p>'
        for paragraph in escape(body).replace('\r', '').split('\n\n')
    )
    notice_html = (
        f'<p style="margin:20px 0 0;padding:12px 14px;border-radius:8px;background:#f7f5ff;'
        f'font-size:12px;line-height:1.5;color:#6f6478;">{escape(notice)}</p>'
        if notice else ''
    )
    html_body = f'''<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f1f8;font-family:Segoe UI,Arial,sans-serif;color:#342a40;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e7dff0;border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:22px 30px;background:#f8f5fc;border-bottom:4px solid #5b21b6;">
          <img src="cid:{EVENT_LOGO_CID}" width="190" alt="Kent Business College" style="display:block;width:190px;max-width:100%;height:auto;border:0;">
        </td>
      </tr>
      <tr>
        <td style="padding:30px;">
          {paragraphs}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;border-collapse:separate;">
            <tr>
              <td bgcolor="#5b21b6" style="background:#5b21b6;border-radius:8px;">
                <a href="{safe_link}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;border-radius:8px;">{escape(button_text)}</a>
              </td>
            </tr>
          </table>
          {notice_html}
        </td>
      </tr>
    </table>
  </body>
</html>'''
    text_body = body + f'\n\n{button_text}: {link}'
    if notice:
        text_body += f'\n\n{notice}'
    return subject, text_body, html_body


@require_staff
def email_templates(request):
    if request.method == 'GET':
        try:
            purpose = _purpose(request.GET.get('purpose'))
        except ValueError as exc:
            return json_error(str(exc))
        items = EventEmailTemplate.objects.filter(purpose=purpose).order_by('name', 'id')
        return JsonResponse({'templates': [template_dict(item) for item in items]})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    try:
        purpose = _purpose(payload.get('purpose'))
        subject, body, button_text = _clean_copy(payload)
    except ValueError as exc:
        return json_error(str(exc))
    name = str(payload.get('name', '')).strip()
    if not name or len(name) > 255:
        return json_error('Template name is required and must be 255 characters or fewer.')
    if EventEmailTemplate.objects.filter(purpose=purpose, name__iexact=name).exists():
        return json_error('An email template with this name already exists.', status=409)
    item = EventEmailTemplate.objects.create(
        name=name, purpose=purpose, subject=subject, body=body,
        button_text=button_text, created_by=actor_name(request) or 'Staff',
    )
    return JsonResponse({'template': template_dict(item)}, status=201)


@require_staff
def event_email_setting(request, event_id, purpose):
    event = Event.objects.filter(pk=event_id).first()
    if event is None:
        return json_error('Event not found.', status=404)
    try:
        purpose = _purpose(purpose)
    except ValueError as exc:
        return json_error(str(exc), status=404)
    if request.method == 'GET':
        return JsonResponse({'setting': event_email_content(event, purpose)})
    if request.method not in {'PUT', 'PATCH'}:
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    try:
        subject, body, button_text = _clean_copy(payload)
    except ValueError as exc:
        return json_error(str(exc))
    template = None
    if payload.get('templateId') not in (None, ''):
        template = EventEmailTemplate.objects.filter(
            pk=payload.get('templateId'), purpose=purpose,
        ).first()
        if template is None:
            return json_error('Email template not found.', status=404)
    setting, _ = EventEmailSetting.objects.update_or_create(
        event=event, purpose=purpose,
        defaults={
            'template': template, 'subject': subject, 'body': body,
            'button_text': button_text, 'updated_by': actor_name(request) or 'Staff',
        },
    )
    return JsonResponse({'setting': {
        'templateId': setting.template_id, 'subject': setting.subject,
        'body': setting.body, 'buttonText': setting.button_text,
    }})
