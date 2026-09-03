import re
from datetime import date, datetime, timedelta, timezone

from django.conf import settings
from django.core.cache import cache
from django.db import IntegrityError, connection, transaction
from django.db.models import Count, F, Sum
from django.http import JsonResponse
from django.utils import timezone as dj_timezone

from . import ai
from .helpers import json_body, json_error, require_fields
from .models import (
    AttendanceIntervention, Club, ClubMeeting, ClubMeetingAttendance, ClubMembership, Event,
    EventAttendance, EventBooking, FlashCard, FlashCardDeck, FlashCardView, PointsGrant, PointsRule,
    Recognition, Reward, VoucherClaim,
)
from .permissions import (
    actor_name, is_staff, learner_read_scope, learner_target_identity, require_learner_identity,
    require_self_or_staff, require_staff, staff_error,
)
from .services import compute_engagement_score, compute_message_response_rates, grant_points, points_summary

FLASH_CARD_RULE_KEY = 'flash_card_opened'
DECK_STATUSES = {'draft', 'published'}

# Dashboard analytics doesn't need per-request freshness — see learner_analytics.
CACHE_TTL_SECONDS = 45


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


def member_to_dict(member):
    return {
        'id': member.id,
        'learnerId': member.learner_id,
        'learnerName': member.learner_name,
        'assignedBy': member.assigned_by,
        'assignedAt': member.assigned_at.isoformat(),
    }


def club_to_dict(club):
    # members/sampleMembers are derived from live ClubMembership rows, not
    # the stored counter/JSON list — same "never trust a drifting counter"
    # fix already applied to voucher claims (total_claimed) and stats_overview.
    active_members = [m for m in club.memberships.all() if m.status == 'active']
    return {
        'id': club.id,
        'name': club.name,
        'location': club.location,
        'description': club.description,
        'ambassador': club.ambassador,
        'ambassadorRole': club.ambassador_role,
        'members': len(active_members),
        'sampleMembers': [
            ''.join(part[0] for part in m.learner_name.split()[:2]).upper()
            for m in active_members[:5]
        ],
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
        'awardedBy': grant.awarded_by,
        'sourceType': grant.source_type,
        'reason': grant.reason,
    }


def rewards_collection(request):
    if request.method == 'GET':
        rewards = Reward.objects.all().order_by('-popular', 'name')
        return JsonResponse({'rewards': [reward_to_dict(r) for r in rewards]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['name', 'points'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    reward = Reward.objects.create(
        name=payload['name'],
        description=payload.get('description', ''),
        points=payload['points'],
        category=payload.get('category', ''),
        # No physical vouchers — every reward is fulfilled to the learner's
        # own on-file email, never a client-supplied delivery type.
        delivery_type='digital',
        stock=payload.get('stock', 0),
        image=payload.get('image', ''),
        popular=bool(payload.get('popular', False)),
        active=bool(payload.get('active', True)),
    )
    return JsonResponse({'created': True, 'reward': reward_to_dict(reward)}, status=201)


def reward_detail(request, pk):
    try:
        reward = Reward.objects.get(pk=pk)
    except Reward.DoesNotExist:
        return json_error('Reward not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'reward': reward_to_dict(reward)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    direct_fields = ['name', 'description', 'points', 'category', 'stock', 'image', 'popular', 'active']
    for field in direct_fields:
        if field in payload:
            setattr(reward, field, payload[field])
    # deliveryType is intentionally not editable — no physical vouchers.

    reward.save()
    return JsonResponse({'reward': reward_to_dict(reward)})


def voucher_claims_collection(request):
    if request.method == 'GET':
        learner_id, error = learner_read_scope(request)
        if error:
            return error
        claims = VoucherClaim.objects.select_related('reward').all().order_by('-requested_at')
        if learner_id:
            claims = claims.filter(learner_id=learner_id)
        return JsonResponse({'claims': [claim_to_dict(c) for c in claims]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    learner_id, learner_name, error = require_learner_identity(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['rewardId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    with transaction.atomic():
        # Serialise this learner's wallet across concurrent claims. Without
        # this, the affordability check below and the claim insert are a
        # read-then-write race: two simultaneous claims can both read the
        # same starting balance and both pass.
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', [f'engagement:wallet:{learner_id}'])

        try:
            reward = Reward.objects.select_for_update().get(pk=payload['rewardId'])
        except Reward.DoesNotExist:
            return json_error('Reward not found.', status=404)

        if not reward.active:
            return json_error('This reward is not currently available.', status=400)

        # Availability = stock minus claims that still hold a unit — pending
        # and approved claims reserve stock the same as a fulfilled one, so
        # concurrent pending claims can't oversell it. Rejecting a claim
        # frees its unit automatically, since it drops out of this count.
        active_claims = VoucherClaim.objects.filter(
            reward=reward, status__in=['pending', 'approved', 'fulfilled'],
        ).count()
        if reward.stock <= active_claims:
            return json_error('This reward is out of stock.', status=400)

        # Reserve-at-claim: points_summary() already excludes non-rejected
        # claims from the balance, so creating this claim immediately commits
        # its points — no separate reservation step is needed, and rejecting
        # it later refunds automatically by the same exclusion.
        summary = points_summary(learner_id)
        if summary['balance'] < reward.points:
            return json_error('You do not have enough available points for this reward.', status=400)

        claim = VoucherClaim.objects.create(
            learner_id=learner_id,
            learner_name=learner_name,
            reward=reward,
            points=reward.points,
            delivery_type=reward.delivery_type,
            delivery_method='Email' if reward.delivery_type == 'digital' else 'Post',
        )
    return JsonResponse({'created': True, 'claim': claim_to_dict(claim)}, status=201)


# A claim only ever moves forward, and only fulfilled claims are terminal —
# rejecting is allowed from either pending or approved (staff can back out of
# an approval before it's fulfilled).
_CLAIM_TRANSITIONS = {
    'pending': {'approved', 'rejected'},
    'approved': {'fulfilled', 'rejected'},
}


def voucher_claim_detail(request, pk):
    try:
        claim = VoucherClaim.objects.select_related('reward').get(pk=pk)
    except VoucherClaim.DoesNotExist:
        return json_error('Voucher claim not found.', status=404)

    if request.method == 'GET':
        error = require_self_or_staff(request, claim.learner_id)
        if error:
            return error
        return JsonResponse({'claim': claim_to_dict(claim)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    status = payload.get('status')
    if status is not None:
        if status not in dict(VoucherClaim.STATUS_CHOICES):
            return json_error('Invalid status.', status=400)
        if status != claim.status:
            allowed_next = _CLAIM_TRANSITIONS.get(claim.status, set())
            if status not in allowed_next:
                return json_error(
                    f"Cannot move a claim from '{claim.status}' to '{status}'.", status=409,
                )
            claim.status = status
            if status in ('approved', 'rejected'):
                claim.reviewed_by = actor_name(request)
                claim.reviewed_at = datetime.now(timezone.utc)
            if status == 'fulfilled':
                claim.reward.total_claimed += 1
                claim.reward.save(update_fields=['total_claimed'])
        # else: repeat PATCH of the claim's current status — a no-op, so a
        # retried 'fulfilled' PATCH doesn't re-increment total_claimed.

    if 'deliveryDetail' in payload:
        claim.delivery_detail = payload['deliveryDetail']
    if 'deliveryInstructions' in payload:
        claim.delivery_instructions = payload['deliveryInstructions']

    claim.save()
    return JsonResponse({'claim': claim_to_dict(claim)})


def points_me(request):
    """The signed-in learner's own authoritative points balance."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    learner_id, _learner_name, error = require_learner_identity(request)
    if error:
        return error
    return JsonResponse(points_summary(learner_id))


def leaderboard(request):
    """Real earned-points ranking (?scope=monthly|all-time, optional ?cohort=).

    Ranked purely on granted points — spend never affects rank, matching the
    "earned, not spendable balance" framing of a leaderboard. Orphan grants
    (a learner_id with no matching enrolment row — see the reconciliation
    command) are excluded via the inner join, not just filtered by shape.

    True club-membership ranking is deferred: Engagement.club_meetings only
    tracks an integer attendee counter today, with no per-learner membership
    rows to rank within.
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)

    scope = request.GET.get('scope') if request.GET.get('scope') in ('monthly', 'all-time') else 'all-time'
    cohort = request.GET.get('cohort') or None

    where = ["g.learner_id ~ '^[0-9]+$'"]
    params = []
    if scope == 'monthly':
        where.append("g.awarded_at >= date_trunc('month', now())")
    if cohort:
        where.append('cu."Cohort" = %s')
        params.append(cohort)

    with connection.cursor() as cursor:
        cursor.execute(
            f'''
            SELECT g.learner_id, g.learner_name, SUM(g.points) AS points, max(cu."Cohort") AS cohort
            FROM "Engagement"."points_grants" g
            JOIN enrolment."Created_users" cu ON cu.id = g.learner_id::bigint
            WHERE {' AND '.join(where)}
            GROUP BY g.learner_id, g.learner_name
            ORDER BY points DESC, g.learner_name ASC
            LIMIT 50
            ''',
            params,
        )
        rows = cursor.fetchall()

    entries = [
        {
            'rank': index + 1, 'learnerId': learner_id, 'learner': learner_name,
            'points': int(points or 0), 'cohort': entry_cohort,
        }
        for index, (learner_id, learner_name, points, entry_cohort) in enumerate(rows)
    ]
    return JsonResponse({'scope': scope, 'cohort': cohort, 'entries': entries})


def stats_overview(request):
    """Staff-only aggregate counts for the engagement command-centre overview.

    Every number here comes from a live COUNT/SUM over the real tables —
    voucher stock/claim counts intentionally don't use Reward.total_claimed
    (see the reserve-at-claim note on voucher_claims_collection: that counter
    drifts on replay, so live claim rows are the source of truth here too).
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    error = staff_error(request)
    if error:
        return error

    month_start = dj_timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    real_learner = {'learner_id__regex': r'^\d+$'}

    points_awarded = PointsGrant.objects.filter(**real_learner).aggregate(total=Sum('points'))['total'] or 0
    points_awarded_this_month = (
        PointsGrant.objects.filter(**real_learner, awarded_at__gte=month_start).aggregate(total=Sum('points'))['total'] or 0
    )
    claimed_statuses = ('approved', 'fulfilled')
    vouchers_claimed = VoucherClaim.objects.filter(status__in=claimed_statuses).count()
    vouchers_claimed_this_month = VoucherClaim.objects.filter(status__in=claimed_statuses, requested_at__gte=month_start).count()
    active_learners = (
        PointsGrant.objects.filter(**real_learner, awarded_at__gte=month_start).values('learner_id').distinct().count()
    )
    event_seats_booked = EventBooking.objects.filter(status='booked').count()

    return JsonResponse({
        'pointsAwarded': points_awarded,
        'pointsAwardedThisMonth': points_awarded_this_month,
        'vouchersClaimed': vouchers_claimed,
        'vouchersClaimedThisMonth': vouchers_claimed_this_month,
        'activeLearners': active_learners,
        'eventSeatsBooked': event_seats_booked,
    })


def _quiz_average(progress_entries):
    """Average achievedScore/totalScore across a learner's quiz attempts, or
    None if they haven't attempted any — never fabricate a 0 for "no data"."""
    ratios = [
        entry['achievedScore'] / entry['totalScore']
        for entry in progress_entries
        if entry.get('kind') == 'quiz' and entry.get('achievedScore') is not None and entry.get('totalScore')
    ]
    return round(sum(ratios) / len(ratios) * 100) if ratios else None


def _last_active(progress_entries, attendance):
    """Most recent real activity timestamp: latest progress submission, or
    (failing that) the learner's last attendance date."""
    submitted = [entry['submittedAt'] for entry in progress_entries if entry.get('submittedAt')]
    if submitted:
        return max(submitted)
    return attendance['lastSessionDate'] if attendance else None


def _risk_level(score):
    if score is None:
        return None
    if score < 55:
        return 'red'
    if score < 70:
        return 'amber'
    return 'green'


def learner_analytics(request):
    """Bulk, real per-learner analytics for the engagement roster surfaces
    (attendance-risk, learner-engagement, the command-centre charts).

    Every field is computed from real data owned by this same backend — see
    the plan this endpoint was built against: these fields were previously
    mislabeled as permanently-mock "another team's data". One roster fetch,
    a handful of bulk sidecar queries (attendance, points, club activity,
    interventions, message response) — never a per-learner query loop.

    Still genuinely expensive at real roster scale (nested per-learner JSON
    progress, KSB/quiz derivation, a chat-identity bridge that reads the
    whole ChatLearner table) — measured at several seconds per call. Django's
    ConditionalGetMiddleware answering a repeat request with 304 does NOT
    save that cost: the view still runs to completion to compute the ETag
    before the 304 swap happens. So this is cached server-side for
    CACHE_TTL_SECONDS — dashboard analytics doesn't need per-request
    freshness, and every page that mounts this (attendance-risk,
    learner-engagement, the command-centre charts) shares one cached result
    instead of each re-running the full computation.
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    error = staff_error(request)
    if error:
        return error

    programme = request.GET.get('programme') or None
    cohort = request.GET.get('cohort') or None

    cache_key = f'engagement:learner-analytics:{programme or ""}:{cohort or ""}'
    cached = cache.get(cache_key)
    if cached is not None:
        return JsonResponse({'learners': cached})

    from coach_api.views import fetch_all_learner_profiles, serialize_caseload_learner
    from learner_api.attendance import _summarize_attendance
    from learner_api.teams_attendance import fetch_verified_teams_attendance_rows

    profiles = fetch_all_learner_profiles(programme=programme, cohort=cohort)
    if not profiles:
        cache.set(cache_key, [], CACHE_TTL_SECONDS)
        return JsonResponse({'learners': []})

    profile_ids = [row.id for row in profiles]
    learner_ids = [str(row.enrolment_id) for row in profiles]

    # -- Bulk sidecars: one query each, never one per learner -----------------
    attendance_rows = fetch_verified_teams_attendance_rows(profile_ids)
    attendance_by_profile_id = {}
    for row in attendance_rows:
        attendance_by_profile_id.setdefault(row['learner_id'], []).append(row)
    attendance_by_profile_id = {
        pid: _summarize_attendance(rows) for pid, rows in attendance_by_profile_id.items()
    }

    month_start = dj_timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    points_all_time = dict(
        PointsGrant.objects.filter(learner_id__in=learner_ids)
        .values('learner_id').annotate(total=Sum('points')).values_list('learner_id', 'total')
    )
    points_this_month = dict(
        PointsGrant.objects.filter(learner_id__in=learner_ids, awarded_at__gte=month_start)
        .values('learner_id').annotate(total=Sum('points')).values_list('learner_id', 'total')
    )
    club_counts = dict(
        ClubMembership.objects.filter(learner_id__in=learner_ids, status='active')
        .values('learner_id').annotate(total=Count('club_id')).values_list('learner_id', 'total')
    )
    open_interventions = {}
    for intervention in (
        AttendanceIntervention.objects.filter(learner_id__in=learner_ids, resolved=False).order_by('-created_at')
    ):
        open_interventions.setdefault(intervention.learner_id, intervention)  # most recent wins
    response_rates = compute_message_response_rates(learner_ids)

    learners = []
    for row in profiles:
        engagement_id = str(row.enrolment_id)
        base = serialize_caseload_learner(row, refresh_live_snapshots=False)
        progress_entries = row.training_plan_progress or []
        attendance = attendance_by_profile_id.get(row.id)

        otjh_completed = base['otjhCompleted'] or 0
        otjh_target = base['otjhTarget'] or 1
        otjh_progress = min(100, round(otjh_completed / otjh_target * 100)) if otjh_target else None
        ksb_progress = base['ksbProgress'] if base['ksbProgressAvailable'] else None
        attendance_rate = attendance['attendanceRate'] if attendance else None
        quiz_average = _quiz_average(progress_entries)

        score = compute_engagement_score(attendance_rate, ksb_progress, otjh_progress, quiz_average)
        intervention = open_interventions.get(engagement_id)

        learners.append({
            'id': engagement_id,
            'name': base['name'],
            'programme': row.programme or '',
            'cohort': base['cohortName'],
            'coach': base['coachName'],
            'engagementScore': score,
            'riskLevel': _risk_level(score),
            'overallStatus': base['status'],
            'flags': base['riskFlags'],
            'attendanceRate': attendance_rate,
            'sessionsAttended': attendance['present'] if attendance else None,
            'totalSessions': attendance['sessions'] if attendance else None,
            'sessionsMissed': attendance['absent'] if attendance else None,
            'consecutiveMissed': attendance['consecutiveMissed'] if attendance else None,
            'lastAttendance': attendance['lastSessionDate'] if attendance else None,
            'otjhHours': otjh_completed,
            'otjhTarget': otjh_target,
            'ksbProgress': ksb_progress,
            'evidenceSubmitted': base['evidenceCompletedCount'],
            'evidenceTarget': base['evidenceCount'],
            'quizAverage': quiz_average,
            'messageResponse': response_rates.get(engagement_id),
            'clubActivity': club_counts.get(engagement_id, 0),
            'lastActive': _last_active(progress_entries, attendance),
            'points': points_all_time.get(engagement_id, 0),
            'pointsThisMonth': points_this_month.get(engagement_id, 0),
            'attendanceAction': intervention.action if intervention else None,
            'employerNotified': intervention.employer_notified if intervention else False,
            'interventionDate': intervention.intervention_date.isoformat() if intervention and intervention.intervention_date else None,
        })

    cache.set(cache_key, learners, CACHE_TTL_SECONDS)
    return JsonResponse({'learners': learners})


def intervention_to_dict(intervention):
    return {
        'id': intervention.id,
        'learnerId': intervention.learner_id,
        'learnerName': intervention.learner_name,
        'action': intervention.action,
        'employerNotified': intervention.employer_notified,
        'interventionDate': intervention.intervention_date.isoformat() if intervention.intervention_date else None,
        'createdBy': intervention.created_by,
        'createdAt': intervention.created_at.isoformat(),
        'resolved': intervention.resolved,
        'resolvedAt': intervention.resolved_at.isoformat() if intervention.resolved_at else None,
    }


@require_staff
def attendance_interventions_collection(request):
    """What the attendance-risk page's "Take Action" button writes to."""
    if request.method == 'GET':
        interventions = AttendanceIntervention.objects.all().order_by('-created_at')
        learner_id = request.GET.get('learnerId')
        if learner_id:
            interventions = interventions.filter(learner_id=learner_id)
        return JsonResponse({'interventions': [intervention_to_dict(i) for i in interventions]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName', 'action'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    intervention = AttendanceIntervention.objects.create(
        learner_id=str(payload['learnerId']),
        learner_name=payload['learnerName'],
        action=payload['action'],
        employer_notified=bool(payload.get('employerNotified', False)),
        intervention_date=payload.get('interventionDate') or None,
        created_by=actor_name(request),
    )
    return JsonResponse({'created': True, 'intervention': intervention_to_dict(intervention)}, status=201)


@require_staff
def attendance_intervention_detail(request, pk):
    try:
        intervention = AttendanceIntervention.objects.get(pk=pk)
    except AttendanceIntervention.DoesNotExist:
        return json_error('Intervention not found.', status=404)

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    if payload.get('resolved') and not intervention.resolved:
        intervention.resolved = True
        intervention.resolved_at = datetime.now(timezone.utc)
    for field in ('action', 'employerNotified', 'interventionDate'):
        if field in payload:
            setattr(
                intervention,
                {'employerNotified': 'employer_notified', 'interventionDate': 'intervention_date'}.get(field, field),
                payload[field],
            )
    intervention.save()
    return JsonResponse({'intervention': intervention_to_dict(intervention)})


def recognitions_collection(request):
    if request.method == 'GET':
        learner_id, error = learner_read_scope(request)
        if error:
            return error
        recognitions = Recognition.objects.all().order_by('-awarded_at')
        if learner_id:
            recognitions = recognitions.filter(learner_id=learner_id)
        return JsonResponse({'recognitions': [recognition_to_dict(r) for r in recognitions]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, [
        'learnerId', 'learnerName', 'programmeCode', 'programme', 'cohort',
        'type', 'title', 'description',
    ])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    if payload['type'] not in dict(Recognition.TYPE_CHOICES):
        return json_error('Invalid type.', status=400)

    recognition_points = max(0, int(payload.get('points') or 0))
    recognition = Recognition.objects.create(
        learner_id=str(payload['learnerId']),
        learner_name=payload['learnerName'],
        avatar_img=payload.get('avatarImg'),
        programme_code=payload['programmeCode'],
        programme=payload['programme'],
        cohort=payload['cohort'],
        type=payload['type'],
        title=payload['title'],
        description=payload['description'],
        awarded_by=actor_name(request),
        category=payload.get('category', ''),
        points=recognition_points,
        is_public=bool(payload.get('public', True)),
    )
    if recognition_points > 0:
        # Recognition points are real spendable currency, not a cosmetic
        # "+N points" label — grant them the same way every other source
        # does. A points-granting failure must never block the recognition
        # itself, so this is best-effort like the progress hooks.
        try:
            grant_points(
                'recognition_awarded', recognition.learner_id, recognition.learner_name,
                points=recognition_points,
                event_reference=f'recognition:{recognition.id}',
                awarded_by=recognition.awarded_by,
                source_type='recognition',
                source_id=str(recognition.id),
            )
        except PointsRule.DoesNotExist:
            pass
    return JsonResponse({'created': True, 'recognition': recognition_to_dict(recognition)}, status=201)


def recognition_detail(request, pk):
    try:
        recognition = Recognition.objects.get(pk=pk)
    except Recognition.DoesNotExist:
        return json_error('Recognition not found.', status=404)

    if request.method == 'GET':
        error = require_self_or_staff(request, recognition.learner_id)
        if error:
            return error
        return JsonResponse({'recognition': recognition_to_dict(recognition)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


def events_collection(request):
    if request.method == 'GET':
        events = Event.objects.all().order_by('-created_at')
        return JsonResponse({'events': [event_to_dict(e) for e in events]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


def event_detail(request, pk):
    try:
        event = Event.objects.get(pk=pk)
    except Event.DoesNotExist:
        return json_error('Event not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'event': event_to_dict(event)})

    if request.method == 'DELETE':
        error = staff_error(request)
        if error:
            return error
        event.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


def event_bookings_collection(request):
    if request.method == 'GET':
        learner_id, error = learner_read_scope(request)
        if error:
            return error
        bookings = EventBooking.objects.select_related('event').order_by('-booked_at')
        if learner_id:
            bookings = bookings.filter(learner_id=learner_id)
        return JsonResponse({'bookings': [event_booking_to_dict(booking) for booking in bookings]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    learner_id, learner_name, error = require_learner_identity(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['eventId'])
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
            learner_id=learner_id,
            defaults={
                'learner_name': learner_name,
                'learner_email': payload.get('learnerEmail', ''),
            },
        )
        if not created and booking.status == 'booked':
            return json_error('You have already booked this event.', status=409)
        if not created:
            booking.status = 'booked'
            booking.learner_name = learner_name
            booking.learner_email = payload.get('learnerEmail', booking.learner_email)
            booking.booked_at = datetime.now(timezone.utc)
            booking.cancelled_at = None
            booking.save()
        Event.objects.filter(pk=event.pk).update(attendees=F('attendees') + 1)
        event.refresh_from_db()

    return JsonResponse({'created': created, 'booking': event_booking_to_dict(booking), 'event': event_to_dict(event)}, status=201)


def event_booking_detail(request, pk):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)

    with transaction.atomic():
        try:
            booking = EventBooking.objects.select_for_update().get(pk=pk)
        except EventBooking.DoesNotExist:
            return json_error('Event booking not found.', status=404)
        error = require_self_or_staff(request, booking.learner_id)
        if error:
            return error
        if booking.status == 'cancelled':
            return json_error('This booking is already cancelled.', status=409)
        booking.status = 'cancelled'
        booking.cancelled_at = datetime.now(timezone.utc)
        booking.save(update_fields=['status', 'cancelled_at'])
        Event.objects.filter(pk=booking.event_id, attendees__gt=0).update(attendees=F('attendees') - 1)
        event = Event.objects.get(pk=booking.event_id)

    return JsonResponse({'cancelled': True, 'booking': event_booking_to_dict(booking), 'event': event_to_dict(event)})


def clubs_collection(request):
    if request.method == 'GET':
        clubs = Club.objects.prefetch_related('meetings', 'memberships').all().order_by('name')
        # Learners see only the club(s) staff assigned them to (read-only —
        # there is no learner-facing join/leave); staff see every club.
        learner_id, error = learner_read_scope(request)
        if error:
            return error
        if learner_id:
            clubs = clubs.filter(memberships__learner_id=learner_id, memberships__status='active')
        return JsonResponse({'clubs': [club_to_dict(c) for c in clubs]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


def club_detail(request, pk):
    try:
        club = Club.objects.prefetch_related('meetings').get(pk=pk)
    except Club.DoesNotExist:
        return json_error('Club not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'club': club_to_dict(club)})

    if request.method == 'DELETE':
        error = staff_error(request)
        if error:
            return error
        # The FK from ClubMeeting is ON DELETE CASCADE, so the club's
        # meetings go with it.
        club.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


@require_staff
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


@require_staff
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


def attendance_to_dict(record):
    return {
        'learnerId': record.learner_id,
        'learnerName': record.learner_name,
        'status': record.status,
        'markedBy': record.marked_by,
        'markedAt': record.marked_at.isoformat() if record.marked_at else None,
    }


def _mark_attendance_records(request, payload, *, save_mark, rule_key, event_reference, reason):
    """Shared bulk-mark logic for club meetings and events.

    `save_mark(learner_id, learner_name, status)` upserts the attendance row
    and returns it. Points are only granted for 'present' marks, and only
    once per (rule, occurrence, learner) — `grant_points`'s own idempotency
    key handles a learner being re-marked present twice. Marking someone
    absent after they were present does not claw back a prior grant (that's
    a manual adjustment concern, same as everywhere else in this app).
    """
    records = payload.get('records')
    if not isinstance(records, list) or not records:
        return None, json_error('records must be a non-empty list.', status=400)

    marker = actor_name(request)
    saved = []
    with transaction.atomic():
        for record in records:
            learner_id = str(record.get('learnerId') or '').strip()
            learner_name = (record.get('learnerName') or '').strip()
            status = record.get('status')
            if not learner_id or status not in ('present', 'absent'):
                continue
            attendance = save_mark(learner_id, learner_name, status, marker)
            saved.append(attendance)
            if status == 'present':
                try:
                    grant_points(
                        rule_key, learner_id, learner_name,
                        event_reference=event_reference(learner_id),
                        awarded_by=marker, source_type='attendance',
                        reason=reason,
                    )
                except PointsRule.DoesNotExist:
                    pass
    return saved, None


@require_staff
def club_meeting_attendance_collection(request, club_id, meeting_id):
    try:
        meeting = ClubMeeting.objects.get(pk=meeting_id, club_id=club_id)
    except ClubMeeting.DoesNotExist:
        return json_error('Meeting not found.', status=404)

    if request.method == 'GET':
        members = ClubMembership.objects.filter(club_id=club_id, status='active').order_by('learner_name')
        marks = {a.learner_id: a for a in meeting.attendance.all()}
        roster = [
            {
                'learnerId': member.learner_id,
                'learnerName': member.learner_name,
                'status': marks[member.learner_id].status if member.learner_id in marks else None,
                'markedBy': marks[member.learner_id].marked_by if member.learner_id in marks else None,
                'markedAt': marks[member.learner_id].marked_at.isoformat() if member.learner_id in marks else None,
            }
            for member in members
        ]
        return JsonResponse({'roster': roster})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    def save_mark(learner_id, learner_name, status, marker):
        attendance, _ = ClubMeetingAttendance.objects.update_or_create(
            meeting=meeting, learner_id=learner_id,
            defaults={'learner_name': learner_name, 'status': status, 'marked_by': marker},
        )
        return attendance

    saved, error = _mark_attendance_records(
        request, payload, save_mark=save_mark,
        rule_key='club_meeting_attended',
        event_reference=lambda lid: f'club_meeting:{meeting.id}:learner:{lid}',
        reason=f'Attended "{meeting.title}"',
    )
    if error:
        return error

    present_count = meeting.attendance.filter(status='present').count()
    ClubMeeting.objects.filter(pk=meeting.pk).update(attendees=present_count)
    meeting.refresh_from_db()
    return JsonResponse({'meeting': meeting_to_dict(meeting), 'roster': [attendance_to_dict(a) for a in saved]})


@require_staff
def event_attendance_collection(request, event_id):
    try:
        event = Event.objects.get(pk=event_id)
    except Event.DoesNotExist:
        return json_error('Event not found.', status=404)

    if request.method == 'GET':
        bookings = EventBooking.objects.filter(event=event, status='booked').order_by('learner_name')
        marks = {a.learner_id: a for a in event.attendance.all()}
        roster = []
        seen_ids = set()
        for booking in bookings:
            seen_ids.add(booking.learner_id)
            mark = marks.get(booking.learner_id)
            roster.append({
                'learnerId': booking.learner_id,
                'learnerName': booking.learner_name,
                'status': mark.status if mark else None,
                'markedBy': mark.marked_by if mark else None,
                'markedAt': mark.marked_at.isoformat() if mark else None,
                'booked': True,
            })
        # Walk-ins: attendance already recorded for a learner who wasn't (or
        # is no longer) booked.
        for learner_id, mark in marks.items():
            if learner_id in seen_ids:
                continue
            roster.append({
                'learnerId': mark.learner_id,
                'learnerName': mark.learner_name,
                'status': mark.status,
                'markedBy': mark.marked_by,
                'markedAt': mark.marked_at.isoformat(),
                'booked': False,
            })
        return JsonResponse({'roster': roster})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    def save_mark(learner_id, learner_name, status, marker):
        attendance, _ = EventAttendance.objects.update_or_create(
            event=event, learner_id=learner_id,
            defaults={'learner_name': learner_name, 'status': status, 'marked_by': marker},
        )
        return attendance

    saved, error = _mark_attendance_records(
        request, payload, save_mark=save_mark,
        rule_key='event_attended',
        event_reference=lambda lid: f'event:{event.id}:learner:{lid}',
        reason=f'Attended "{event.title}"',
    )
    if error:
        return error

    return JsonResponse({'roster': [attendance_to_dict(a) for a in saved]})


@require_staff
def club_members_collection(request, club_id):
    """Staff-assigned club membership — learners never join themselves."""
    try:
        club = Club.objects.get(pk=club_id)
    except Club.DoesNotExist:
        return json_error('Club not found.', status=404)

    if request.method == 'GET':
        members = club.memberships.filter(status='active').order_by('learner_name')
        return JsonResponse({'members': [member_to_dict(m) for m in members]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    learner_id = str(payload['learnerId'])
    existing = ClubMembership.objects.filter(club=club, learner_id=learner_id, status='active').first()
    if existing:
        return JsonResponse({'created': False, 'member': member_to_dict(existing)})

    member = ClubMembership.objects.create(
        club=club,
        learner_id=learner_id,
        learner_name=payload['learnerName'],
        assigned_by=actor_name(request),
    )
    return JsonResponse({'created': True, 'member': member_to_dict(member)}, status=201)


@require_staff
def club_member_detail(request, club_id, learner_id):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)

    updated = ClubMembership.objects.filter(
        club_id=club_id, learner_id=str(learner_id), status='active',
    ).update(status='removed')
    if not updated:
        return json_error('Membership not found.', status=404)
    return JsonResponse({'removed': True})


def points_rules_collection(request):
    if request.method == 'GET':
        rules = rules_with_stats().order_by('-created_at')
        return JsonResponse({'rules': [rule_to_dict(r) for r in rules]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


def points_rule_detail(request, pk):
    try:
        rule = rules_with_stats().get(pk=pk)
    except PointsRule.DoesNotExist:
        return json_error('Points rule not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'rule': rule_to_dict(rule)})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    # 'key' is deliberately excluded — automated award paths (the progress
    # hook, flash-card flips, recognition grants) call services.grant_points()
    # by key, so it must stay stable once set. Retire the rule (active=False)
    # and create a new one instead of repointing an existing key.
    direct_fields = ['name', 'description', 'points', 'category', 'frequency', 'trigger', 'active']
    for field in direct_fields:
        if field in payload:
            setattr(rule, field, payload[field])

    rule.save()
    rule = rules_with_stats().get(pk=rule.pk)
    return JsonResponse({'rule': rule_to_dict(rule)})


@require_staff
def points_rule_grants(request, rule_id):
    try:
        rule = PointsRule.objects.get(pk=rule_id)
    except PointsRule.DoesNotExist:
        return json_error('Points rule not found.', status=404)

    if request.method == 'GET':
        # select_related avoids a redundant re-fetch of `rule` per grant —
        # grant_to_dict reads grant.rule.name/category, and Django's reverse
        # FK manager doesn't back-populate the parent instance automatically.
        grants = rule.grants.select_related('rule').order_by('-awarded_at')
        return JsonResponse({'grants': [grant_to_dict(g) for g in grants]})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    missing = require_fields(payload, ['learnerId', 'learnerName'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    try:
        points = int(payload.get('points', rule.points))
    except (TypeError, ValueError):
        return json_error('points must be an integer.', status=400)
    points = max(0, points)

    grant = PointsGrant.objects.create(
        rule=rule,
        learner_id=str(payload['learnerId']),
        learner_name=payload['learnerName'],
        points=points,
        awarded_by=actor_name(request),
        source_type='manual',
        reason=(payload.get('reason') or None),
    )
    return JsonResponse({'created': True, 'grant': grant_to_dict(grant)}, status=201)


def _points_rewards_report():
    real_learner = {'learner_id__regex': r'^\d+$'}
    month_start = dj_timezone.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_awarded = PointsGrant.objects.filter(**real_learner).aggregate(total=Sum('points'))['total'] or 0
    awarded_this_month = (
        PointsGrant.objects.filter(**real_learner, awarded_at__gte=month_start).aggregate(total=Sum('points'))['total'] or 0
    )
    by_category = [
        {
            'category': row['rule__category'] or 'Uncategorised',
            'points': row['points'] or 0,
            'learners': row['learners'],
        }
        for row in (
            PointsGrant.objects.filter(**real_learner)
            .values('rule__category')
            .annotate(points=Sum('points'), learners=Count('learner_id', distinct=True))
            .order_by('-points')
        )
    ]
    claims_by_status = dict(
        VoucherClaim.objects.values('status').annotate(total=Count('id')).values_list('status', 'total')
    )
    points_committed = VoucherClaim.objects.exclude(status='rejected').aggregate(total=Sum('points'))['total'] or 0
    top_rewards = [
        {'name': row['name'], 'claims': row['total_claimed'], 'points': row['points']}
        for row in Reward.objects.order_by('-total_claimed')[:5].values('name', 'total_claimed', 'points')
    ]

    return {
        'totalPointsAwarded': total_awarded,
        'pointsAwardedThisMonth': awarded_this_month,
        'pointsCommittedToClaims': points_committed,
        'byCategory': by_category,
        'claimsByStatus': {status: claims_by_status.get(status, 0) for status in ('pending', 'approved', 'rejected', 'fulfilled')},
        'topRewards': top_rewards,
    }


def _club_activity_report():
    clubs = Club.objects.prefetch_related('memberships', 'meetings').all().order_by('name')
    rows = []
    for club in clubs:
        active_members = [m for m in club.memberships.all() if m.status == 'active']
        meetings = list(club.meetings.all())
        rows.append({
            'clubId': club.id,
            'name': club.name,
            'location': club.location,
            'members': len(active_members),
            'meetings': len(meetings),
            'meetingsScheduled': sum(1 for m in meetings if m.scheduled),
            'totalAttendanceMarked': sum(m.attendees for m in meetings),
        })
    points_awarded = (
        PointsGrant.objects.filter(rule__key='club_meeting_attended').aggregate(total=Sum('points'))['total'] or 0
    )
    return {
        'clubs': rows,
        'totalClubs': len(rows),
        'totalMembers': sum(row['members'] for row in rows),
        'totalMeetings': sum(row['meetings'] for row in rows),
        'pointsAwardedForAttendance': points_awarded,
    }


def _event_attendance_report():
    events = Event.objects.all().order_by('-created_at')
    rows = []
    for event in events:
        booked = EventBooking.objects.filter(event=event, status='booked').count()
        present = EventAttendance.objects.filter(event=event, status='present').count()
        absent = EventAttendance.objects.filter(event=event, status='absent').count()
        rows.append({
            'eventId': event.id,
            'title': event.title,
            'date': event.date,
            'type': event.type,
            'booked': booked,
            'present': present,
            'absent': absent,
            'attendanceRate': round(present / booked * 100) if booked else None,
        })
    points_awarded = (
        PointsGrant.objects.filter(rule__key='event_attended').aggregate(total=Sum('points'))['total'] or 0
    )
    return {
        'events': rows,
        'totalEvents': len(rows),
        'totalBooked': sum(row['booked'] for row in rows),
        'totalPresent': sum(row['present'] for row in rows),
        'pointsAwardedForAttendance': points_awarded,
    }


REPORT_BUILDERS = {
    'points-rewards': _points_rewards_report,
    'club-activity': _club_activity_report,
    'event-attendance': _event_attendance_report,
}


def report_data(request, report_id):
    """Live data for one of the (non-scoreboard) engagement reports.

    The Engagement Scoreboard report is served by the existing
    /learner-analytics/ endpoint directly — it's already the real,
    per-learner engagement computation, so there's no need to duplicate it
    here under a different name.
    """
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    error = staff_error(request)
    if error:
        return error

    builder = REPORT_BUILDERS.get(report_id)
    if builder is None:
        return json_error('Unknown report.', status=404)
    return JsonResponse(builder())


def points_grants_collection(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)

    learner_id, error = learner_read_scope(request)
    if error:
        return error

    grants = PointsGrant.objects.select_related('rule').order_by('-awarded_at')
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


def card_to_dict(card, *, include_answer=True):
    data = {
        'id': card.id,
        'question': card.question,
        'category': card.category,
        'difficulty': card.difficulty,
        'sortOrder': card.sort_order,
    }
    if include_answer:
        # Learner reads omit this — the answer is only ever returned by the
        # flip endpoint, after it records the flip.
        data['answer'] = card.answer
    return data


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


def training_plan_options(request):
    """Programme/module options for the deck builder's selectors."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)

    try:
        with connection.cursor() as cursor:
            # programme_id is curriculum.modules' own real identifier column —
            # NOT max(module_catalogue_id), which is a per-module id and was
            # being mislabelled as the programme id here (module_catalogue_id
            # is unrelated to which programme a module belongs to). Mirrors
            # quiz_api.views.training_plan_options' simplest fallback query.
            cursor.execute(
                '''
                select programme_name, title, programme_id
                from curriculum.modules
                where coalesce(trim(programme_name), '') <> ''
                  and coalesce(trim(title), '') <> ''
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


def flash_card_decks(request):
    """List decks (filter ?status/?search/?weekId/?programmeId) or create one."""
    if request.method == 'GET':
        qs = FlashCardDeck.objects.all()
        status = request.GET.get('status')
        if is_staff(request):
            if status in DECK_STATUSES:
                qs = qs.filter(status=status)
        else:
            # A learner never sees an unpublished deck, regardless of what
            # ?status= they pass — draft decks are a staff-only concept.
            qs = qs.filter(status='published')
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

    error = staff_error(request)
    if error:
        return error

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


def flash_card_deck_detail(request, pk):
    try:
        deck = FlashCardDeck.objects.get(pk=pk)
    except FlashCardDeck.DoesNotExist:
        return json_error('Flash card deck not found.', status=404)

    if request.method == 'GET':
        return JsonResponse({'deck': deck_to_dict(deck)})

    if request.method == 'DELETE':
        error = staff_error(request)
        if error:
            return error
        # Cards (and their view history) cascade via the FKs.
        deck.delete()
        return JsonResponse({'deleted': True})

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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
        staff = is_staff(request)
        if not staff and deck.status != 'published':
            # Hide existence rather than 403 — an unpublished deck's id
            # shouldn't be confirmable by a learner who happens to guess it.
            return json_error('Flash card deck not found.', status=404)
        return JsonResponse({
            'deck': deck_to_dict(deck),
            'cards': [card_to_dict(c, include_answer=staff) for c in deck.cards.all()],
            'pointsPerCard': flash_card_points(),
        })

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    error = staff_error(request)
    if error:
        return error

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


@require_staff
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


def flash_card_flip(request, card_id):
    """Award points the first time a learner opens a card, and return the answer.

    Points once per (card, learner), ever — a re-open returns the answer with
    pointsAwarded=0. Next week's deck has new card ids, so its cards award again.
    No daily cap, no cycle.

    Learner identity is always session-derived. Staff/admin may target a
    chosen learner (the deck-builder's "preview as" flow); a signed-in
    learner can only ever flip for themselves.
    """
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    learner_id, learner_name, error = learner_target_identity(request, payload)
    if error:
        return error

    try:
        card = FlashCard.objects.get(pk=card_id)
    except FlashCard.DoesNotExist:
        return json_error('Flash card not found.', status=404)

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
            source_type='flashcard',
            source_id=str(card.id),
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
