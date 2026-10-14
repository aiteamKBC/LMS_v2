"""Event RSVP audience management, invitations, and booking reconciliation."""
from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from learner_api.models import EnrolmentUser
from login import email_azure
from login.invitations import frontend_base_url
from login.security import generate_token, hash_token

from .event_emails import event_logo_attachment, render_email
from .models import Event, EventBooking, EventRsvpCampaign, EventRsvpRecipient, FeedbackForm


TOKEN_TTL = timedelta(days=30)
EVENT_RSVP_FRONTEND_PATH = '/event-rsvp'
RSVP_VALUES = {'yes', 'no', 'maybe'}


def rsvp_link(token):
    return f'{frontend_base_url()}{EVENT_RSVP_FRONTEND_PATH}#token={token}'


def recipient_for_token(token):
    if not token:
        return None
    return EventRsvpRecipient.objects.select_related('campaign__event', 'campaign__form').filter(
        token_hash=hash_token(token), token_expires_at__gt=timezone.now(),
        revoked_at__isnull=True, campaign__status='open',
    ).first()


def _normalise_guest(item):
    if not isinstance(item, dict):
        raise ValueError('Each guest needs a name and email address.')
    name = str(item.get('name', '')).strip()
    email = str(item.get('email', '')).strip().casefold()
    if not name or len(name) > 255:
        raise ValueError('Each guest needs a valid name of 255 characters or fewer.')
    try:
        validate_email(email)
    except ValidationError as exc:
        raise ValueError(f'Invalid guest email: {email or "missing"}.') from exc
    return {'name': name, 'email': email, 'learner_id': ''}


@transaction.atomic
def configure_campaign(*, event, form_id, learner_ids, guests, created_by):
    form = FeedbackForm.objects.filter(pk=form_id, form_type='event_rsvp', status='published').first()
    if form is None:
        raise ValueError('Choose a published Event RSVP form.')
    if not isinstance(learner_ids, list) or not isinstance(guests, list):
        raise ValueError('Recipients must contain learner IDs and guest details.')
    requested_ids = {str(value) for value in learner_ids if str(value).strip()}
    learners = list(EnrolmentUser.all_learners.filter(id__in=requested_ids))
    if {str(item.id) for item in learners} != requested_ids:
        raise ValueError('One or more selected learners are invalid.')
    audience = {}
    for learner in learners:
        email = str(learner.email or '').strip().casefold()
        try:
            validate_email(email)
        except ValidationError as exc:
            raise ValueError(f'{learner.username or "A selected learner"} does not have a valid email address.') from exc
        audience[email] = {
            'name': learner.username or learner.email or f'Learner {learner.id}',
            'email': email, 'learner_id': str(learner.id),
        }
    for raw in guests:
        guest = _normalise_guest(raw)
        audience.setdefault(guest['email'], guest)
    if not audience:
        raise ValueError('Select at least one learner or add one guest.')

    campaign, _ = EventRsvpCampaign.objects.update_or_create(
        event=event,
        defaults={'form': form, 'status': 'open', 'created_by': created_by},
    )
    active_emails = list(audience)
    campaign.recipients.filter(revoked_at__isnull=True).exclude(
        recipient_email__in=active_emails,
    ).update(revoked_at=timezone.now())
    for item in audience.values():
        existing = EventRsvpRecipient.objects.filter(
            campaign=campaign, recipient_email=item['email'],
        ).first()
        was_revoked = bool(existing and existing.revoked_at)
        recipient, _ = EventRsvpRecipient.objects.update_or_create(
            campaign=campaign, recipient_email=item['email'],
            defaults={
                'recipient_name': item['name'], 'learner_id': item['learner_id'],
                'revoked_at': None,
            },
        )
        if was_revoked:
            recipient.token_hash = None
            recipient.token_expires_at = None
            recipient.invite_status = 'pending'
            recipient.invitation_sent_at = None
            recipient.invitation_error = ''
            recipient.save(update_fields=[
                'token_hash', 'token_expires_at', 'invite_status',
                'invitation_sent_at', 'invitation_error', 'updated_at',
            ])
    return campaign


def send_invitations(campaign, recipients):
    results = []
    event = campaign.event
    for recipient in recipients:
        token = generate_token()
        recipient.token_hash = hash_token(token)
        recipient.token_expires_at = timezone.now() + TOKEN_TTL
        recipient.invite_status = 'pending'
        recipient.invitation_error = ''
        recipient.save(update_fields=[
            'token_hash', 'token_expires_at', 'invite_status',
            'invitation_error', 'updated_at',
        ])
        link = rsvp_link(token)
        subject, text, html = render_email(event, recipient.recipient_name, link, 'event_rsvp')
        sent, detail = email_azure.send_mail(
            to=recipient.recipient_email, subject=subject, html_body=html,
            text_body=text, save_to_sent=True, attachments=[event_logo_attachment()],
        )
        recipient.invite_status = 'sent' if sent else 'failed'
        recipient.invitation_sent_at = timezone.now() if sent else None
        recipient.invitation_error = '' if sent else str(detail or 'Email delivery failed')[:1000]
        recipient.save(update_fields=[
            'invite_status', 'invitation_sent_at', 'invitation_error', 'updated_at',
        ])
        results.append({'id': recipient.id, 'email': recipient.recipient_email, 'sent': sent})
    return results


def reset_failed_recipients(campaign, emails):
    """Queue failed invitees from a newly uploaded roster for one fresh attempt."""
    if not isinstance(emails, list):
        raise ValueError('Retry recipients must be a list of email addresses.')
    requested = {str(email).strip().casefold() for email in emails if str(email).strip()}
    if not requested:
        return 0
    return campaign.recipients.filter(
        revoked_at__isnull=True, invite_status='failed', recipient_email__in=requested,
    ).update(
        invite_status='pending', invitation_sent_at=None, invitation_error='',
        updated_at=timezone.now(),
    )


@transaction.atomic
def save_rsvp(recipient, status):
    status = str(status or '').strip().casefold()
    if status not in RSVP_VALUES:
        raise ValueError('Choose Yes, No, or Maybe.')
    # Match the existing learner booking path's event lock. This keeps the
    # denormalised attendee counter correct if RSVP and self-booking race.
    event = Event.objects.select_for_update().get(pk=recipient.campaign.event_id)
    old_status = recipient.rsvp_status
    recipient.rsvp_status = status
    recipient.responded_at = timezone.now()
    recipient.save(update_fields=['rsvp_status', 'responded_at', 'updated_at'])

    if recipient.learner_id:
        booking = EventBooking.objects.select_for_update().filter(
            event=event, learner_id=recipient.learner_id,
        ).first()
        was_booked = bool(booking and booking.status == 'booked')
        should_book = status == 'yes'
        if booking is None:
            booking = EventBooking(
                event=event, learner_id=recipient.learner_id,
                learner_name=recipient.recipient_name, learner_email=recipient.recipient_email,
            )
        booking.learner_name = recipient.recipient_name
        booking.learner_email = recipient.recipient_email
        booking.status = 'booked' if should_book else 'cancelled'
        booking.cancelled_at = None if should_book else timezone.now()
        booking.save()
        if should_book and not was_booked:
            Event.objects.filter(pk=event.pk).update(attendees=F('attendees') + 1)
        elif was_booked and not should_book:
            Event.objects.filter(pk=event.pk, attendees__gt=0).update(attendees=F('attendees') - 1)
    return old_status != status
