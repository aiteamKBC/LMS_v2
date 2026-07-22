import re
from datetime import date, datetime, timedelta, timezone

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.db.models import Count, F, Sum
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from . import ai
from .helpers import json_body, json_error, require_fields
from .models import (
    Club, ClubMeeting, Event, EventBooking, FlashCard, FlashCardDeck, FlashCardView,
    PointsGrant, PointsRule, Recognition, Reward, VoucherClaim,
)
from .services import grant_points

FLASH_CARD_RULE_KEY = 'flash_card_opened'
DECK_STATUSES = {'draft', 'published'}


def reward_to_dict(reward):
    return {
        'id': reward.id,
        'name': reward.name,
        'description': reward.description,
        'points': reward.points,
        'category': reward.category,
        'deliveryType': reward.delivery_type,
        'stock': reward.stock,
        'totalClaimed': reward.total_claimed,
        'image': reward.image,
        'popular': reward.popular,
        'active': reward.active,
    }


def claim_to_dict(claim):
    return {
        'id': claim.id,
        'learnerId': claim.learner_id,
        'learner': claim.learner_name,
        'rewardId': claim.reward_id,
        'reward': claim.reward.name,
        'points': claim.points,
        'requestedAt': claim.requested_at.isoformat(),
        'status': claim.status,
        'reviewedBy': claim.reviewed_by,
        'reviewedAt': claim.reviewed_at.isoformat() if claim.reviewed_at else None,
        'deliveryType': claim.delivery_type,
        'deliveryMethod': claim.delivery_method,
        'deliveryDetail': claim.delivery_detail,
        'deliveryInstructions': claim.delivery_instructions,
    }


def recognition_to_dict(recognition):
    return {
        'id': recognition.id,
        'learnerId': recognition.learner_id,
        'learner': recognition.learner_name,
        'avatarImg': recognition.avatar_img,
        'programmeCode': recognition.programme_code,
        'programme': recognition.programme,
        'cohort': recognition.cohort,
        'type': recognition.type,
        'title': recognition.title,
        'description': recognition.description,
        'awardedBy': recognition.awarded_by,
        'awardedAt': recognition.awarded_at.isoformat(),
        'category': recognition.category,
        'points': recognition.points,
        'public': recognition.is_public,
    }


def event_to_dict(event):
    return {
        'id': event.id,
        'title': event.title,
        'description': event.description,
        'date': event.date,
        'time': event.time,
        'location': event.location,
        'type': event.type,
        'attendees': event.attendees,
        'status': event.status,
        'organizer': event.organizer,
    }


def event_booking_to_dict(booking):
    return {
        'id': booking.id,
        'eventId': booking.event_id,
        'learnerId': booking.learner_id,
        'learner': booking.learner_name,
        'email': booking.learner_email,
        'status': booking.status,
        'bookedAt': booking.booked_at.isoformat(),
        'cancelledAt': booking.cancelled_at.isoformat() if booking.cancelled_at else None,
    }


def meeting_to_dict(meeting):
    return {
        'id': meeting.id,
        'title': meeting.title,
        'scheduled': meeting.scheduled,
        'date': meeting.date,
        'time': meeting.time,
        'venue': meeting.venue,
        'attendees': meeting.attendees,
    }


def club_to_dict(club):
    return {
        'id': club.id,
        'name': club.name,
        'location': club.location,
        'description': club.description,
        'ambassador': club.ambassador,
        'ambassadorRole': club.ambassador_role,
        'members': club.members,
        'sampleMembers': club.sample_members,
        'active': club.active,
        'meetings': [meeting_to_dict(m) for m in club.meetings.all()],
    }


def rules_with_stats():
    """PointsRule queryset annotated with grant-derived aggregates.

    `learnersImpacted`/`totalPointsAwarded` aren't stored columns — they're
    computed here from the related PointsGrant rows so they're always
    accurate, even as grants are added later.
    """
    return PointsRule.objects.annotate(
        learners_impacted=Count('grants__learner_id', distinct=True),
        total_points_awarded=Sum('grants__points'),
    )


def rule_to_dict(rule):
    return {
        'id': rule.id,
        'name': rule.name,
        'description': rule.description,
        'points': rule.points,
        'category': rule.category,
        'frequency': rule.frequency,
        'trigger': rule.trigger,
        'active': rule.active,
        'key': rule.key,
        'learnersImpacted': rule.learners_impacted,
        'totalPointsAwarded': rule.total_points_awarded or 0,
    }


def grant_to_dict(grant):
    return {
        'id': grant.id,
        'ruleId': grant.rule_id,
        'rule': grant.rule.name,
        'category': grant.rule.category,
        'learnerId': grant.learner_id,
        'learner': grant.learner_name,
        'points': grant.points,
        'awardedAt': grant.awarded_at.isoformat(),
    }


@csrf_exempt
def rewards_collection(request):
    if request.method == 'GET':
        rewards = Reward.objects.all().order_by('-popular', 'name')
        return JsonResponse({'rewards': [reward_to_dict(r) for r in rewards]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['name', 'points', 'deliveryType'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    reward = Reward.objects.create(
        name=payload['name'],
        description=payload.get('description', ''),
        points=payload['points'],
        category=payload.get('category', ''),
        delivery_type=payload['deliveryType'],
        stock=payload.get('stock', 0),
        image=payload.get('image', ''),
        popular=bool(payload.get('popular', False)),
        active=bool(payload.get('active', True)),
    )
    return JsonResponse({'created': True, 'reward': reward_to_dict(reward)}, status=201)


@csrf_exempt
def reward_detail(request, pk):
    try:
        reward = Reward.objects.get(pk=pk)
    except Reward.DoesNotExist:
        return json_error('Reward not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'reward': reward_to_dict(reward)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['name', 'description', 'points', 'category', 'stock', 'image', 'popular', 'active']
    for field in direct_fields:
        if field in payload:
            setattr(reward, field, payload[field])
    if 'deliveryType' in payload:
        reward.delivery_type = payload['deliveryType']

    reward.save()
    return JsonResponse({'reward': reward_to_dict(reward)})


@csrf_exempt
def voucher_claims_collection(request):
    if request.method == 'GET':
        claims = VoucherClaim.objects.select_related('reward').all().order_by('-requested_at')
        learner_id = request.GET.get('learnerId')
        if learner_id:
            claims = claims.filter(learner_id=learner_id)
        return JsonResponse({'claims': [claim_to_dict(c) for c in claims]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName', 'rewardId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    learner_id = str(payload['learnerId'])
    with transaction.atomic():
        try:
            reward = Reward.objects.select_for_update().get(pk=payload['rewardId'])
        except Reward.DoesNotExist:
            return json_error('Reward not found.', status=404)

        if not reward.active:
            return json_error('This reward is not currently available.', status=400)
        if reward.stock <= reward.total_claimed:
            return json_error('This reward is out of stock.', status=400)

        earned = PointsGrant.objects.filter(learner_id=learner_id).aggregate(total=Sum('points'))['total'] or 0
        committed = VoucherClaim.objects.filter(learner_id=learner_id).exclude(status='rejected').aggregate(total=Sum('points'))['total'] or 0
        if earned - committed < reward.points:
            return json_error('You do not have enough available points for this reward.', status=400)

        claim = VoucherClaim.objects.create(
            learner_id=learner_id,
            learner_name=payload['learnerName'],
            reward=reward,
            points=reward.points,
            delivery_type=reward.delivery_type,
            delivery_method='Email' if reward.delivery_type == 'digital' else 'Post',
        )
    return JsonResponse({'created': True, 'claim': claim_to_dict(claim)}, status=201)


@csrf_exempt
def voucher_claim_detail(request, pk):
    try:
        claim = VoucherClaim.objects.select_related('reward').get(pk=pk)
    except VoucherClaim.DoesNotExist:
        return json_error('Voucher claim not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'claim': claim_to_dict(claim)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    status = payload.get('status')
    if status is not None:
        if status not in dict(VoucherClaim.STATUS_CHOICES):
            return json_error('Invalid status.', status=400)
        claim.status = status
        if status in ('approved', 'rejected'):
            claim.reviewed_by = payload.get('reviewedBy', claim.reviewed_by)
            claim.reviewed_at = datetime.now(timezone.utc)
        if status == 'fulfilled':
            claim.reward.total_claimed += 1
            claim.reward.save(update_fields=['total_claimed'])

    if 'deliveryDetail' in payload:
        claim.delivery_detail = payload['deliveryDetail']
    if 'deliveryInstructions' in payload:
        claim.delivery_instructions = payload['deliveryInstructions']

    claim.save()
    return JsonResponse({'claim': claim_to_dict(claim)})


@csrf_exempt
def recognitions_collection(request):
    if request.method == 'GET':
        recognitions = Recognition.objects.all().order_by('-awarded_at')
        learner_id = request.GET.get('learnerId')
        if learner_id:
            recognitions = recognitions.filter(learner_id=learner_id)
        return JsonResponse({'recognitions': [recognition_to_dict(r) for r in recognitions]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, [
        'learnerId', 'learnerName', 'programmeCode', 'programme', 'cohort',
        'type', 'title', 'description', 'awardedBy',
    ])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    if payload['type'] not in dict(Recognition.TYPE_CHOICES):
        return json_error('Invalid type.', status=400)

    recognition = Recognition.objects.create(
        learner_id=payload['learnerId'],
        learner_name=payload['learnerName'],
        avatar_img=payload.get('avatarImg'),
        programme_code=payload['programmeCode'],
        programme=payload['programme'],
        cohort=payload['cohort'],
        type=payload['type'],
        title=payload['title'],
        description=payload['description'],
        awarded_by=payload['awardedBy'],
        category=payload.get('category', ''),
        points=payload.get('points', 0),
        is_public=bool(payload.get('public', True)),
    )
    return JsonResponse({'created': True, 'recognition': recognition_to_dict(recognition)}, status=201)


@csrf_exempt
def recognition_detail(request, pk):
    try:
        recognition = Recognition.objects.get(pk=pk)
    except Recognition.DoesNotExist:
        return json_error('Recognition not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'recognition': recognition_to_dict(recognition)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['title', 'description', 'category', 'points']
    for field in direct_fields:
        if field in payload:
            setattr(recognition, field, payload[field])
    if 'public' in payload:
        recognition.is_public = bool(payload['public'])

    recognition.save()
    return JsonResponse({'recognition': recognition_to_dict(recognition)})


@csrf_exempt
def events_collection(request):
    if request.method == 'GET':
        events = Event.objects.all().order_by('-created_at')
        return JsonResponse({'events': [event_to_dict(e) for e in events]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, [
        'title', 'description', 'date', 'time', 'location', 'type', 'organizer',
    ])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    if payload['type'] not in dict(Event.TYPE_CHOICES):
        return json_error('Invalid type.', status=400)

    event = Event.objects.create(
        title=payload['title'],
        description=payload['description'],
        date=payload['date'],
        time=payload['time'],
        location=payload['location'],
        type=payload['type'],
        attendees=payload.get('attendees', 0),
        status=payload.get('status', 'upcoming'),
        organizer=payload['organizer'],
    )
    return JsonResponse({'created': True, 'event': event_to_dict(event)}, status=201)


@csrf_exempt
def event_detail(request, pk):
    try:
        event = Event.objects.get(pk=pk)
    except Event.DoesNotExist:
        return json_error('Event not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'event': event_to_dict(event)})

    if request.method == 'DELETE':
        event.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    if 'type' in payload and payload['type'] not in dict(Event.TYPE_CHOICES):
        return json_error('Invalid type.', status=400)
    if 'status' in payload and payload['status'] not in dict(Event.STATUS_CHOICES):
        return json_error('Invalid status.', status=400)

    direct_fields = [
        'title', 'description', 'date', 'time', 'location', 'type',
        'attendees', 'status', 'organizer',
    ]
    for field in direct_fields:
        if field in payload:
            setattr(event, field, payload[field])

    event.save()
    return JsonResponse({'event': event_to_dict(event)})


@csrf_exempt
def event_bookings_collection(request):
    if request.method == 'GET':
        bookings = EventBooking.objects.select_related('event').order_by('-booked_at')
        learner_id = request.GET.get('learnerId')
        if learner_id:
            bookings = bookings.filter(learner_id=learner_id)
        return JsonResponse({'bookings': [event_booking_to_dict(booking) for booking in bookings]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['eventId', 'learnerId', 'learnerName'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    with transaction.atomic():
        try:
            event = Event.objects.select_for_update().get(pk=payload['eventId'])
        except Event.DoesNotExist:
            return json_error('Event not found.', status=404)
        if event.status == 'completed':
            return json_error('Completed events cannot be booked.', status=400)

        booking, created = EventBooking.objects.select_for_update().get_or_create(
            event=event,
            learner_id=str(payload['learnerId']),
            defaults={
                'learner_name': payload['learnerName'],
                'learner_email': payload.get('learnerEmail', ''),
            },
        )
        if not created and booking.status == 'booked':
            return json_error('You have already booked this event.', status=409)
        if not created:
            booking.status = 'booked'
            booking.learner_name = payload['learnerName']
            booking.learner_email = payload.get('learnerEmail', booking.learner_email)
            booking.booked_at = datetime.now(timezone.utc)
            booking.cancelled_at = None
            booking.save()
        Event.objects.filter(pk=event.pk).update(attendees=F('attendees') + 1)
        event.refresh_from_db()

    return JsonResponse({'created': created, 'booking': event_booking_to_dict(booking), 'event': event_to_dict(event)}, status=201)


@csrf_exempt
def event_booking_detail(request, pk):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)

    with transaction.atomic():
        try:
            booking = EventBooking.objects.select_for_update().get(pk=pk)
        except EventBooking.DoesNotExist:
            return json_error('Event booking not found.', status=404)
        if booking.status == 'cancelled':
            return json_error('This booking is already cancelled.', status=409)
        booking.status = 'cancelled'
        booking.cancelled_at = datetime.now(timezone.utc)
        booking.save(update_fields=['status', 'cancelled_at'])
        Event.objects.filter(pk=booking.event_id, attendees__gt=0).update(attendees=F('attendees') - 1)
        event = Event.objects.get(pk=booking.event_id)

    return JsonResponse({'cancelled': True, 'booking': event_booking_to_dict(booking), 'event': event_to_dict(event)})


@csrf_exempt
def clubs_collection(request):
    if request.method == 'GET':
        clubs = Club.objects.prefetch_related('meetings').all().order_by('name')
        return JsonResponse({'clubs': [club_to_dict(c) for c in clubs]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['name', 'location', 'ambassador', 'ambassadorRole'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    club = Club.objects.create(
        name=payload['name'],
        location=payload['location'],
        description=payload.get('description', ''),
        ambassador=payload['ambassador'],
        ambassador_role=payload['ambassadorRole'],
        members=payload.get('members', 0),
        sample_members=payload.get('sampleMembers', []),
        active=bool(payload.get('active', True)),
    )
    return JsonResponse({'created': True, 'club': club_to_dict(club)}, status=201)


@csrf_exempt
def club_detail(request, pk):
    try:
        club = Club.objects.prefetch_related('meetings').get(pk=pk)
    except Club.DoesNotExist:
        return json_error('Club not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'club': club_to_dict(club)})

    if request.method == 'DELETE':
        # The FK from ClubMeeting is ON DELETE CASCADE, so the club's
        # meetings go with it.
        club.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['name', 'location', 'description', 'ambassador', 'members', 'active']
    for field in direct_fields:
        if field in payload:
            setattr(club, field, payload[field])
    if 'ambassadorRole' in payload:
        club.ambassador_role = payload['ambassadorRole']
    if 'sampleMembers' in payload:
        club.sample_members = payload['sampleMembers']

    club.save()
    return JsonResponse({'club': club_to_dict(club)})


@csrf_exempt
def club_meetings_collection(request, club_id):
    try:
        club = Club.objects.get(pk=club_id)
    except Club.DoesNotExist:
        return json_error('Club not found.', status=404)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['title'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    meeting = ClubMeeting.objects.create(
        club=club,
        title=payload['title'],
        scheduled=bool(payload.get('scheduled', False)),
        date=payload.get('date'),
        time=payload.get('time'),
        venue=payload.get('venue'),
        attendees=payload.get('attendees', 0),
    )
    return JsonResponse({'created': True, 'meeting': meeting_to_dict(meeting)}, status=201)


@csrf_exempt
def club_meeting_detail(request, club_id, pk):
    try:
        meeting = ClubMeeting.objects.get(pk=pk, club_id=club_id)
    except ClubMeeting.DoesNotExist:
        return json_error('Meeting not found.', status=404)

    if request.method == 'DELETE':
        meeting.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['title', 'date', 'time', 'venue', 'attendees']
    for field in direct_fields:
        if field in payload:
            setattr(meeting, field, payload[field])
    if 'scheduled' in payload:
        meeting.scheduled = bool(payload['scheduled'])

    meeting.save()
    return JsonResponse({'meeting': meeting_to_dict(meeting)})


@csrf_exempt
def points_rules_collection(request):
    if request.method == 'GET':
        rules = rules_with_stats().order_by('-created_at')
        return JsonResponse({'rules': [rule_to_dict(r) for r in rules]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['name', 'points', 'category', 'frequency', 'trigger'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    rule = PointsRule.objects.create(
        name=payload['name'],
        description=payload.get('description', ''),
        points=payload['points'],
        category=payload['category'],
        frequency=payload['frequency'],
        trigger=payload['trigger'],
        active=bool(payload.get('active', True)),
        key=payload.get('key'),
    )
    rule = rules_with_stats().get(pk=rule.pk)
    return JsonResponse({'created': True, 'rule': rule_to_dict(rule)}, status=201)


@csrf_exempt
def points_rule_detail(request, pk):
    try:
        rule = rules_with_stats().get(pk=pk)
    except PointsRule.DoesNotExist:
        return json_error('Points rule not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'rule': rule_to_dict(rule)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['name', 'description', 'points', 'category', 'frequency', 'trigger', 'active', 'key']
    for field in direct_fields:
        if field in payload:
            setattr(rule, field, payload[field])

    rule.save()
    rule = rules_with_stats().get(pk=rule.pk)
    return JsonResponse({'rule': rule_to_dict(rule)})


@csrf_exempt
def points_rule_grants(request, rule_id):
    try:
        rule = PointsRule.objects.get(pk=rule_id)
    except PointsRule.DoesNotExist:
        return json_error('Points rule not found.', status=404)

    if request.method == 'GET':
        grants = rule.grants.all().order_by('-awarded_at')
        return JsonResponse({'grants': [grant_to_dict(g) for g in grants]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    grant = PointsGrant.objects.create(
        rule=rule,
        learner_id=payload['learnerId'],
        learner_name=payload['learnerName'],
        points=payload.get('points', rule.points),
    )
    return JsonResponse({'created': True, 'grant': grant_to_dict(grant)}, status=201)


def points_grants_collection(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)

    grants = PointsGrant.objects.select_related('rule').order_by('-awarded_at')
    learner_id = request.GET.get('learnerId')
    if learner_id:
        grants = grants.filter(learner_id=learner_id)
    return JsonResponse({'grants': [grant_to_dict(grant) for grant in grants]})


# ---------------------------------------------------------------------------
# Flash cards (gamification) — deck builder (programme -> module -> week),
# mirroring the quiz builder. A deck is a points-only game: it is authored and
# published here, but never injected into the training plan or progress/OTJH.
# ---------------------------------------------------------------------------

def deck_to_dict(deck):
    return {
        'id': deck.id,
        'title': deck.title,
        'programmeId': deck.programme_id,
        'programme': deck.programme,
        'module': deck.module,
        'weekId': deck.week_id,
        'status': deck.status,
        'author': deck.author,
        'cardCount': deck.card_count,
        'aiGenerated': deck.ai_generated,
        'createdAt': deck.created_at.isoformat(),
        'updatedAt': deck.updated_at.isoformat(),
    }


def card_to_dict(card):
    return {
        'id': card.id,
        'question': card.question,
        'answer': card.answer,
        'category': card.category,
        'difficulty': card.difficulty,
        'sortOrder': card.sort_order,
    }


def _week_number_from_value(value):
    """Pull a week number out of '3', 'Week 3', 'w3', etc. (mirrors quiz_api)."""
    text = str(value or '').strip()
    if not text:
        return None
    if text.isdigit():
        return int(text)
    match = re.search(r'\bweek\s*(\d+)\b', text, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.search(r'(?:^|[-_\s])w(?:eek)?[-_\s]*(\d+)(?:$|[-_\s])', text, flags=re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def _build_week_id(programme_id, week_value):
    """Same delivery-key format the quiz builder computes, so a deck targets the
    exact learners a quiz for that programme/week reaches."""
    week_number = _week_number_from_value(week_value)
    if not programme_id or not week_number:
        return ''
    return f'week-training-module-{programme_id}-{week_number}'


def _is_placeholder_training_value(value):
    text = (value or '').lower()
    return 'test' in text or 'delete' in text


@csrf_exempt
def training_plan_options(request):
    """Programme/module options for the deck builder's selectors."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select programme_name, title, max(module_catalogue_id) as programme_id
                from curriculum.modules
                where coalesce(trim(programme_name), '') <> ''
                  and coalesce(trim(title), '') <> ''
                group by programme_name, title
                order by programme_name, title
                '''
            )
            rows = cursor.fetchall()
    except Exception:
        rows = []

    programmes = []
    modules_by_programme = {}
    seen_programmes = set()
    for programme, module_name, programme_id in rows:
        if _is_placeholder_training_value(programme) or _is_placeholder_training_value(module_name):
            continue
        if programme not in seen_programmes:
            programmes.append({'value': programme, 'label': programme})
            seen_programmes.add(programme)
        modules_by_programme.setdefault(programme, []).append({
            'value': module_name, 'label': module_name, 'programmeId': programme_id,
        })

    return JsonResponse({'programmes': programmes, 'modulesByProgramme': modules_by_programme})


def flash_card_points():
    """The award value flipping a card earns — driven by the points rule so
    the manager controls it from the Points Rules page. 0 if the rule is
    missing or switched off (a flip still works, it just earns nothing)."""
    rule = PointsRule.objects.filter(key=FLASH_CARD_RULE_KEY, active=True).first()
    return rule.points if rule else 0


@csrf_exempt
def flash_card_decks(request):
    """List decks (filter ?status/?search/?weekId/?programmeId) or create one."""
    if request.method == 'GET':
        qs = FlashCardDeck.objects.all()
        status = request.GET.get('status')
        if status in DECK_STATUSES:
            qs = qs.filter(status=status)
        week_id = request.GET.get('weekId')
        if week_id:
            qs = qs.filter(week_id=week_id)
        programme_id = request.GET.get('programmeId')
        if programme_id:
            qs = qs.filter(programme_id=programme_id)
        search = (request.GET.get('search') or '').strip()
        if search:
            qs = qs.filter(title__icontains=search)
        qs = qs.order_by('-updated_at', 'title')
        return JsonResponse({'decks': [deck_to_dict(d) for d in qs]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['title'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    status = payload.get('status', 'draft')
    if status not in DECK_STATUSES:
        status = 'draft'
    try:
        programme_id = int(payload['programmeId']) if payload.get('programmeId') else None
    except (TypeError, ValueError):
        programme_id = None
    week_id = payload.get('weekId') or _build_week_id(programme_id, payload.get('week'))

    deck = FlashCardDeck.objects.create(
        title=payload['title'],
        programme_id=programme_id,
        programme=payload.get('programme', '') or '',
        module=payload.get('module', '') or '',
        week_id=week_id,
        status=status,
        author=payload.get('author', '') or '',
        ai_generated=bool(payload.get('aiGenerated', False)),
        card_count=0,
    )
    return JsonResponse({'created': True, 'deck': deck_to_dict(deck)}, status=201)


@csrf_exempt
def flash_card_deck_detail(request, pk):
    try:
        deck = FlashCardDeck.objects.get(pk=pk)
    except FlashCardDeck.DoesNotExist:
        return json_error('Flash card deck not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'deck': deck_to_dict(deck)})

    if request.method == 'DELETE':
        # Cards (and their view history) cascade via the FKs.
        deck.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    if 'status' in payload:
        if payload['status'] not in DECK_STATUSES:
            return json_error('Invalid status.', status=400)
        deck.status = payload['status']
    for field in ('title', 'programme', 'module', 'author'):
        if field in payload:
            setattr(deck, field, payload[field] or '')
    if 'programmeId' in payload:
        try:
            deck.programme_id = int(payload['programmeId']) if payload['programmeId'] else None
        except (TypeError, ValueError):
            deck.programme_id = None
    # Recompute the delivery key only on a deliberate week/weekId change so an
    # unrelated PATCH can't silently wipe it.
    if 'weekId' in payload:
        deck.week_id = payload['weekId'] or ''
    elif 'week' in payload or 'weekNumber' in payload:
        deck.week_id = _build_week_id(deck.programme_id, payload.get('week') or payload.get('weekNumber'))

    deck.save()
    return JsonResponse({'deck': deck_to_dict(deck)})


@csrf_exempt
def flash_card_deck_cards(request, pk):
    """Read a deck's cards, or replace them wholesale (save from the builder).

    Save is an upsert: cards with a known id are updated in place, new cards are
    created, and cards absent from the payload are deleted. Updating in place
    (rather than delete-all + recreate) preserves the view/points history of
    unchanged cards.
    """
    try:
        deck = FlashCardDeck.objects.get(pk=pk)
    except FlashCardDeck.DoesNotExist:
        return json_error('Flash card deck not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({
            'deck': deck_to_dict(deck),
            'cards': [card_to_dict(c) for c in deck.cards.all()],
            'pointsPerCard': flash_card_points(),
        })

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    cards = payload.get('cards')
    if not isinstance(cards, list):
        return json_error('cards must be a list.', status=400)

    existing = {c.id: c for c in deck.cards.all()}
    seen_ids = set()
    with transaction.atomic():
        for index, item in enumerate(cards):
            if not isinstance(item, dict):
                continue
            question = str(item.get('question') or '').strip()
            answer = str(item.get('answer') or '').strip()
            if not question or not answer:
                continue
            difficulty = item.get('difficulty') or 'medium'
            if difficulty not in dict(FlashCard.DIFFICULTY_CHOICES):
                difficulty = 'medium'
            category = str(item.get('category') or '').strip()

            card_id = item.get('id')
            record = existing.get(card_id) if isinstance(card_id, int) else None
            if record is not None:
                record.question = question
                record.answer = answer
                record.category = category
                record.difficulty = difficulty
                record.sort_order = index
                record.save(update_fields=['question', 'answer', 'category', 'difficulty', 'sort_order', 'updated_at'])
                seen_ids.add(record.id)
            else:
                created = FlashCard.objects.create(
                    deck=deck, question=question, answer=answer,
                    category=category, difficulty=difficulty, sort_order=index,
                )
                seen_ids.add(created.id)

        for card_id, record in existing.items():
            if card_id not in seen_ids:
                record.delete()

        deck.card_count = deck.cards.count()
        deck.save(update_fields=['card_count', 'updated_at'])

    deck.refresh_from_db()
    return JsonResponse({
        'deck': deck_to_dict(deck),
        'cards': [card_to_dict(c) for c in deck.cards.all()],
        'pointsPerCard': flash_card_points(),
    })


@csrf_exempt
def generate_flashcards_view(request):
    """AI-generate cards for review (mirrors quiz_api's generate endpoint).

    Accepts multipart (files + fields) or JSON. Returns cards for the builder to
    review and edit — it does NOT save; saving is a separate deck + cards POST.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    readable_files = []
    unreadable_files = []
    if request.FILES:
        files = request.FILES.getlist('files') or request.FILES.getlist('file')
        try:
            source_text, readable_files, unreadable_files = ai.extract_text_from_files(files)
        except ValueError as exc:
            return json_error(str(exc), status=400)
        payload = request.POST
        fallback = str(payload.get('lessonContent') or payload.get('text') or '').strip()
        source_text = source_text.strip() or fallback
    else:
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        source_text = str(payload.get('lessonContent') or payload.get('text') or '').strip()

    topic = str(payload.get('topic') or '').strip()
    custom_instructions = str(payload.get('customInstructions') or '').strip()
    programme = str(payload.get('programme') or '').strip()
    module = str(payload.get('module') or '').strip()
    count = ai.clamp_count(payload.get('questionCount') or payload.get('count') or ai.DEFAULT_CARD_COUNT)

    if not source_text and not topic:
        note = f' Unreadable files: {", ".join(unreadable_files)}.' if unreadable_files else ''
        return json_error(
            f'No readable content. Add a topic, paste lesson text, or upload readable files.{note}',
            status=400, unreadableFiles=unreadable_files,
        )

    try:
        cards = ai.generate_flashcards(
            source_text, topic=topic, custom_instructions=custom_instructions,
            programme=programme, module=module, count=count,
        )
    except RuntimeError as exc:
        message = str(exc)
        status = 502
        if 'not configured' in message or 'not installed' in message:
            status = 503
        elif 'quota' in message:
            status = 429
        elif 'API key is invalid' in message:
            status = 401
        return json_error(message, status=status)

    return JsonResponse({
        'cards': cards,
        'source': {
            'model': settings.OPENAI_MODEL,
            'cardCount': len(cards),
            'readableFiles': readable_files,
            'unreadableFiles': unreadable_files,
        },
    })


@csrf_exempt
def flash_card_flip(request, card_id):
    """Award points the first time a learner opens a card, and return the answer.

    Points once per (card, learner), ever — a re-open returns the answer with
    pointsAwarded=0. Next week's deck has new card ids, so its cards award again.
    No daily cap, no cycle.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    try:
        card = FlashCard.objects.get(pk=card_id)
    except FlashCard.DoesNotExist:
        return json_error('Flash card not found.', status=404)

    learner_id = payload['learnerId']
    learner_name = payload['learnerName']

    existing = FlashCardView.objects.filter(flash_card=card, learner_id=learner_id).first()
    if existing is not None:
        return JsonResponse({
            'flipped': True,
            'alreadyFlipped': True,
            'answer': card.answer,
            'pointsAwarded': existing.points_awarded,
        })

    # Award once. event_reference includes the learner id because grant_points'
    # idempotency is global per (rule, event_reference) — a learner-less ref
    # would pay only the first learner to open the card. A points failure must
    # never block the flip, so swallow a missing/inactive rule.
    points_awarded = 0
    try:
        grant = grant_points(
            FLASH_CARD_RULE_KEY, learner_id, learner_name,
            event_reference=f'flashcard:{card.id}:learner:{learner_id}',
        )
        points_awarded = grant.points
    except PointsRule.DoesNotExist:
        points_awarded = 0

    try:
        FlashCardView.objects.create(
            flash_card=card,
            learner_id=learner_id,
            learner_name=learner_name,
            points_awarded=points_awarded,
        )
    except IntegrityError:
        # Concurrent first-open won the race — treat as already flipped.
        existing = FlashCardView.objects.filter(flash_card=card, learner_id=learner_id).first()
        return JsonResponse({
            'flipped': True,
            'alreadyFlipped': True,
            'answer': card.answer,
            'pointsAwarded': existing.points_awarded if existing else 0,
        })

    return JsonResponse({
        'flipped': True,
        'alreadyFlipped': False,
        'answer': card.answer,
        'pointsAwarded': points_awarded,
    }, status=201)
