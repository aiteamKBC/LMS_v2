"""Public, token-scoped check-in for offline engagement events."""
from __future__ import annotations

import hashlib
from datetime import datetime, time, timedelta

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from login.models import LoginAccount

from .helpers import json_body, json_error
from .models import Event, EventAttendance, PointsRule
from .services import grant_points


def public_csrf(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    response = JsonResponse({'csrfToken': get_token(request)})
    response['Cache-Control'] = 'no-store'
    return response


def _event_for_token(token):
    if not token:
        return None
    try:
        return Event.objects.get(check_in_token=token)
    except (Event.DoesNotExist, ValueError, ValidationError):
        return None


def check_in_window(event, now=None):
    """Open at 00:00 the day before and close after the event day."""
    if event.type != 'offline' or not event.event_date:
        return 'unavailable', None, None
    zone = timezone.get_default_timezone()
    opens_at = timezone.make_aware(
        datetime.combine(event.event_date - timedelta(days=1), time.min), zone,
    )
    closes_at = timezone.make_aware(
        datetime.combine(event.event_date + timedelta(days=1), time.min), zone,
    )
    current = now or timezone.now()
    state = 'not_open' if current < opens_at else 'closed' if current >= closes_at else 'open'
    return state, opens_at, closes_at


def _learner_id(email):
    ids = {
        str(value) for value in LoginAccount.objects.filter(
            subject_type='learner', email__iexact=email,
        ).values_list('subject_id', flat=True)
    }
    return next(iter(ids)) if len(ids) == 1 else ''


def _request_key(request, token, email=''):
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip()
    address = forwarded or request.META.get('REMOTE_ADDR', '')
    digest = hashlib.sha256(f'{token}|{email}|{address}'.encode('utf-8')).hexdigest()
    return f'event-check-in:{digest}'


def _event_payload(event, state, opens_at, closes_at):
    return {
        'title': event.title,
        'date': event.date,
        'time': event.time,
        'location': event.location,
        'state': state,
        'opensAt': opens_at.isoformat() if opens_at else None,
        'closesAt': closes_at.isoformat() if closes_at else None,
    }


def event_check_in(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    token = str(payload.get('token', ''))
    event = _event_for_token(token)
    if event is None:
        return json_error('This event check-in link is invalid.', status=404)
    state, opens_at, closes_at = check_in_window(event)
    if payload.get('action') == 'read':
        response = JsonResponse({'event': _event_payload(event, state, opens_at, closes_at)})
        response['Cache-Control'] = 'private, no-store'
        return response
    if state != 'open':
        message = 'Check-in has not opened yet.' if state == 'not_open' else 'Check-in for this event has closed.'
        return json_error(message, status=409)

    name = ' '.join(str(payload.get('name', '')).strip().split())[:255]
    email = str(payload.get('email', '')).strip().casefold()
    if len(name) < 2:
        return json_error('Enter your full name.')
    try:
        validate_email(email)
    except ValidationError:
        return json_error('Enter a valid email address.')
    rate_key = _request_key(request, token, email)
    attempts = cache.get(rate_key, 0)
    if attempts >= 10:
        return json_error('Too many check-in attempts. Please try again later.', status=429)
    cache.set(rate_key, attempts + 1, timeout=60 * 60)

    learner_id = _learner_id(email)
    attendee_type = 'learner' if learner_id else 'guest'
    identity = learner_id or f'guest:{hashlib.sha256(email.encode("utf-8")).hexdigest()}'
    with transaction.atomic():
        EventAttendance.objects.update_or_create(
            event=event,
            learner_id=identity,
            defaults={
                'learner_name': name,
                'attendee_email': email,
                'attendee_type': attendee_type,
                'attendance_source': 'qr',
                'status': 'present',
                'marked_by': 'QR check-in',
            },
        )
        present_count = EventAttendance.objects.filter(event=event, status='present').count()
        Event.objects.filter(pk=event.pk).update(attendees=present_count)
        if learner_id:
            try:
                grant_points(
                    'event_attended', learner_id, name,
                    event_reference=f'event:{event.id}:learner:{learner_id}',
                    awarded_by='QR check-in', source_type='attendance',
                    reason=f'Attended "{event.title}"',
                )
            except PointsRule.DoesNotExist:
                pass
    response = JsonResponse({'recorded': True, 'message': 'Your attendance has been recorded.'})
    response['Cache-Control'] = 'no-store'
    return response
