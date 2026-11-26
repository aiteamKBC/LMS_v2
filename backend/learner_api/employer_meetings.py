"""Live, read-only Teams invitations for an employer and their own learners."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone as utc_timezone
from hashlib import sha256
import json
import logging
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET
from login.permissions import employer_or_staff

from coach_api.recordings_calendar import load_coach_calendar, _event_instant
from . import employer_portal as portal
from .coach_assignment import current_coach
from .identity import learner_profile_for_source
from .views import _error

log = logging.getLogger(__name__)
LONDON = ZoneInfo('Europe/London')


def _email(value):
    return str(value or '').strip().casefold()


def owned_calendar_roster(employer):
    """Resolve server-owned coach mailboxes; never accept one from the client."""
    learners = portal.SOURCE_MODELS['apprenticeship'].all_learners.filter(employer_id=employer.pk).only(
        'id', 'email', 'username', 'learner_type', 'case_owner', 'coach_name', 'coach_email',
    )
    by_coach = defaultdict(list)
    missing = 0
    for learner in learners:
        profile = learner_profile_for_source(learner, learner.pk, heal=False,
            fields=('id', 'enrolment_id', 'email', 'coach_name', 'coach_email'))
        coach = current_coach(learner, profile)
        owner = _email(coach['coach_email'])
        addresses = sorted({_email(learner.email), _email(getattr(profile, 'email', ''))} - {''})
        if not owner or not addresses:
            missing += 1
            continue
        by_coach[owner].append({'id': str(learner.pk), 'kind': portal._learner_kind(learner),
                               'name': learner.username or '', 'emails': addresses,
                               'coachName': coach['coach_name']})
    return dict(by_coach), missing


def project_invitations(events, roster, employer_email, start, end):
    """Participant + ownership + privacy checks precede exposing titles/URLs."""
    result = {}
    for event in events:
        if event.get('isCancelled') or event.get('isAllDay') or event.get('sensitivity') != 'normal':
            continue
        participants = {
            _email((party.get('emailAddress') or {}).get('address'))
            for party in [event.get('organizer') or {}, *(event.get('attendees') or [])]
            if (party.get('status') or {}).get('response') != 'declined'
        } - {''}
        if employer_email not in participants:
            continue
        owners = [learner for learner in roster if participants.intersection(learner['emails'])]
        if not owners:
            continue
        begin, finish = _event_instant(event.get('start')), _event_instant(event.get('end'))
        if not begin or not finish or finish <= begin or finish <= start or begin >= end:
            continue
        link = (event.get('onlineMeeting') or {}).get('joinUrl') or event.get('onlineMeetingUrl') or ''
        try:
            parsed = urlparse(link)
            link = link if parsed.scheme == 'https' and parsed.hostname and not parsed.username and not parsed.password else ''
        except ValueError:
            link = ''
        if not link:
            continue
        identity = event.get('iCalUId') or event.get('id')
        if not identity:
            continue
        key = sha256(f'{identity}:{begin.isoformat()}'.encode()).hexdigest()[:32]
        local = begin.astimezone(LONDON)
        result[key] = {'id': key, 'title': event.get('subject') or 'Teams meeting',
                       'startsAt': begin.isoformat(), 'endsAt': finish.isoformat(),
                       'scheduledDate': local.date().isoformat(), 'scheduledTime': local.strftime('%H:%M'),
                       'endTime': finish.astimezone(LONDON).strftime('%H:%M'), 'joinUrl': link,
                       'coachName': owners[0]['coachName'],
                       'learners': [{field: learner[field] for field in ('id', 'kind', 'name')} for learner in owners]}
    return list(result.values())


def _read_calendar(owner, roster, employer_email, start, end):
    # Existing transport expands recurrences and validates every pagination URL.
    # Its explicit window is capped at 31 days, so read bounded adjacent windows.
    meetings = []
    cursor = start
    while cursor < end:
        stop = min(end, cursor + timedelta(days=30))
        events = load_coach_calendar(owner, cursor, stop)
        meetings.extend(project_invitations(events, roster, employer_email, start, end))
        cursor = stop
    return meetings


def read_employer_meetings(employer, *, now=None):
    start = (now or timezone.now()).astimezone(utc_timezone.utc)
    end = start + timedelta(days=90)
    roster, missing = owned_calendar_roster(employer)
    address = _email(employer.email)
    if not address:
        return {'meetings': [], 'status': 'error', 'detail': 'The employer email is not available for invitation matching.'}
    # Ownership is re-read before every cache lookup; an employer/roster change
    # cannot reuse another audience's invitation response.
    scope = json.dumps([str(employer.pk), address, roster, missing, start.date().isoformat()], sort_keys=True)
    cache_key = 'employer-teams-invites:v1:' + sha256(scope.encode()).hexdigest()
    saved = cache.get(cache_key)
    if saved is not None:
        return {**saved, 'meetings': [item for item in saved['meetings'] if item['endsAt'] > start.isoformat()]}
    rows, failed = {}, missing
    with ThreadPoolExecutor(max_workers=min(3, len(roster)) or 1) as executor:
        jobs = [executor.submit(_read_calendar, owner, learners, address, start, end) for owner, learners in roster.items()]
        for job in jobs:
            try:
                for meeting in job.result():
                    existing = rows.get(meeting['id'])
                    if existing:
                        owners = {(item['kind'], item['id']): item for item in [*existing['learners'], *meeting['learners']]}
                        existing['learners'] = list(owners.values())
                    else:
                        rows[meeting['id']] = meeting
            except Exception:
                failed += 1
                log.warning('An employer invitation calendar could not be read.', exc_info=False)
    payload = {'meetings': sorted(rows.values(), key=lambda row: (row['startsAt'], row['id'])),
               'status': 'partial' if rows and failed else 'error' if failed else 'ready',
               'windowStart': start.isoformat(), 'windowEnd': end.isoformat()}
    if not failed:
        cache.set(cache_key, payload, 60)
    return payload


@require_GET
@employer_or_staff()
def employer_meetings(request, employer_id):
    employer, error = portal._employer_or_404(employer_id)
    if error is not None:
        return error
    try:
        response = JsonResponse(read_employer_meetings(employer))
    except DatabaseError:
        return _error('Could not load employer meeting invitations. Please try again.', 503)
    response['Cache-Control'] = 'private, no-store'
    return response
