"""Authorized coaching snapshots, background refresh and private media delivery."""
import logging
from hashlib import sha256
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import DatabaseError
from django.db.models import Q, OuterRef, Subquery
from django.core import signing
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse, HttpResponseNotModified, HttpResponse
from django.views.decorators.http import require_GET
from django.views.decorators.gzip import gzip_page
from django.views.decorators.clickjacking import xframe_options_sameorigin

from learner_api.constants import ACCESS_COACH, ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN
from learner_api.models import LearnerProfile, StaffUser, EnrolmentUser
from login.identity import accesses_for_staff
from login.permissions import require_access

from .models import CoachCalendarEvent
from .recordings_calendar import FAMILIES, cancelled_bookings, compare_coach_calendar, load_coach_calendar, is_lms_cancelled, _instant, _event_instant
from .recordings_media import in_session_window, session_window
from .recordings_cache import recent_calendar
from .recordings_errors import calendar_failure
from .recordings_calendar_media import calendar_context, calendar_key, calendar_reference, read_reference, calendar_record, saved_calendar_attendance, event_context
from .recordings_jobs import calendar_snapshots, evidence_jobs, source_summary, source_details, queue_attendance
from .recordings_saved_evidence import empty_evidence
from .recordings_evidence import saved_evidence, check_microsoft_transcript
from .recordings_categories import lecture_occurrences, category
from .recordings_links import occurrence_id

log = logging.getLogger(__name__)
BOOKING_FIELDS = ('event_key', 'owner_email', 'learner_id', 'event_type', 'graph_event_id',
                  'meeting_link', 'scheduled_date', 'scheduled_time', 'duration_minutes',
                  'status', 'sync_state', 'updated_at')


def _email(value):
    return str(value or '').strip().casefold()


def _response(data, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


def _staff(account):
    return StaffUser.objects.filter(pk=account.subject_id).only(
        'id', 'email', 'username', 'access', 'access_extra').first()


def _coaches():
    # Coach may be a secondary grant. Do not rely on primary Access alone.
    found = {}
    for row in StaffUser.objects.only('email', 'username', 'access', 'access_extra').order_by('id'):
        email = _email(row.email)
        if email and ACCESS_COACH in accesses_for_staff(row):
            found[email] = {'email': email, 'name': row.username or email}
    return sorted(found.values(), key=lambda row: (row['name'].casefold(), row['email']))


def _learners(owner=None):
    rows = LearnerProfile.objects.all()
    if owner is not None:
        rows = rows.annotate(owner_key=Lower(Trim('coach_email'))).filter(owner_key=owner)
    return list(rows.order_by('full_name', 'id').values('id', 'email', 'full_name', 'coach_email', 'learner_type'))


def _bookings(owner, start, end):
    # A one-day margin includes UK appointments overlapping either UTC boundary.
    return list(CoachCalendarEvent.objects.annotate(owner_key=Lower(Trim('owner_email')))
                .filter(Q(scheduled_date__range=(start.date() - timedelta(days=1), end.date()))
                        | (Q(scheduled_date__isnull=True, updated_at__gte=start, updated_at__lt=end)
                           & (Q(status='cancelled') | Q(sync_state='cancelled'))),
                        owner_key=owner, event_type__in=tuple(FAMILIES))
                .values(*BOOKING_FIELDS))


def _bookings_many(owners, start, end):
    result = {owner: [] for owner in owners}
    rows = CoachCalendarEvent.objects.annotate(owner_key=Lower(Trim('owner_email'))).filter(
        Q(scheduled_date__range=(start.date() - timedelta(days=1), end.date()))
        | (Q(scheduled_date__isnull=True, updated_at__gte=start, updated_at__lt=end)
           & (Q(status='cancelled') | Q(sync_state='cancelled'))),
        owner_key__in=owners, event_type__in=tuple(FAMILIES)).values(*BOOKING_FIELDS)
    for row in rows:
        result[_email(row['owner_email'])].append(row)
    return result


def _parameters(params):
    start_day, end_day = date.fromisoformat(params.get('start', '')), date.fromisoformat(params.get('end', ''))
    if not 0 <= (end_day - start_day).days <= 30:
        raise ValueError()
    zone_name = params.get('timeZone', 'Europe/London')
    zone = ZoneInfo(zone_name)
    start = datetime.combine(start_day, time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(end_day + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    offset, limit = int(params.get('offset', 0)), int(params.get('limit', 5))
    if offset < 0 or not 1 <= limit <= 10:
        raise ValueError()
    learner_id = params.get('learnerId', '')
    if learner_id and (not learner_id.isdecimal() or int(learner_id) <= 0):
        raise ValueError()
    return start, end, zone_name, offset, limit, str(int(learner_id)) if learner_id else ''


def _roster_bookings(owner, learner_ids, start, end, first_day, last_day):
    if not learner_ids:
        return []
    return list(CoachCalendarEvent.objects.annotate(owner_key=Lower(Trim('owner_email'))).filter(
        Q(scheduled_date__range=(start.date() - timedelta(days=1), end.date()))
        | Q(scheduled_date__isnull=True, target_date__range=(first_day, last_day))
        | (Q(scheduled_date__isnull=True, updated_at__gte=start, updated_at__lt=end)
           & (Q(status='cancelled') | Q(sync_state='cancelled'))),
        owner_key=owner, learner_id__in=learner_ids,
    ).order_by('target_date', 'id').values(*BOOKING_FIELDS, 'target_date', 'sequence', 'review_completed_at'))


def _roster_booking(row, *, owner, learner_ids, start, end, first_day, last_day):
    if _email(row.get('owner_email')) != owner or str(row.get('learner_id')) not in learner_ids:
        return None
    begin, finish = session_window(row)
    cancelled = is_lms_cancelled(row)
    planned_day = row.get('scheduled_date') or row.get('target_date')
    updated = _instant(row.get('updated_at'))
    if begin:
        if not (begin < end and finish > start):
            return None
        basis = 'session'
    elif not ((planned_day and first_day <= planned_day <= last_day)
              or (cancelled and updated and start <= updated < end)):
        return None
    else:
        basis = ('scheduled-date' if row.get('scheduled_date') else 'target') if planned_day and first_day <= planned_day <= last_day else 'record-updated'
    completed = _instant(row.get('review_completed_at'))
    return {
        'eventKey': row['event_key'], 'eventType': row['event_type'], 'sequence': row.get('sequence') or 1,
        'status': row.get('status') or '', 'syncState': row.get('sync_state') or '', 'cancelled': cancelled,
        'targetDate': row['target_date'].isoformat() if row.get('target_date') else None,
        'scheduledDate': row['scheduled_date'].isoformat() if row.get('scheduled_date') else None,
        'startsAt': begin.isoformat() if begin else None, 'endsAt': finish.isoformat() if finish else None,
        'reviewCompletedAt': completed.isoformat() if completed else None,
        'periodBasis': basis, 'recordUpdatedAt': updated.isoformat() if updated else None,
    }


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
def coaching_recordings_learners(request):
    """Current caseload and saved LMS booking states; no Graph calls or writes."""
    try:
        range_params = {key: request.GET.get(key, '') for key in ('start', 'end')}
        range_params['timeZone'] = request.GET.get('timeZone', 'Europe/London')
        start, end, zone_name, *_ = _parameters(range_params)
        offset, limit = int(request.GET.get('offset', 0)), int(request.GET.get('limit', 50))
        search = request.GET.get('search', '').strip()
        if offset < 0 or not 1 <= limit <= 100 or len(search) > 100:
            raise ValueError()
        first_day, last_day = date.fromisoformat(range_params['start']), date.fromisoformat(range_params['end'])
    except (TypeError, ValueError, ZoneInfoNotFoundError, OverflowError):
        return _response({'error': 'Choose a valid date range, learner page and search.', 'code': 'invalid_roster_range'}, 400)
    try:
        staff = _staff(request.login_account)
        grants = accesses_for_staff(staff) if staff else frozenset()
        all_access = bool(grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN})
        if not all_access and ACCESS_COACH not in grants:
            return _response({'error': 'Access denied.', 'code': 'forbidden'}, 403)
        owner = _email(staff.email) if staff else ''
        chosen = _email(request.GET.get('coachEmail'))
        if all_access:
            if not chosen:
                return _response({'error': 'Choose one coach to view their learners.', 'code': 'choose_coach'}, 400)
            coach = next((row for row in _coaches() if row['email'] == chosen), None)
            if coach is None:
                return _response({'error': 'Coach not found.', 'code': 'not_found'}, 404)
        else:
            if not owner or (chosen and chosen != owner):
                return _response({'error': 'Coach not found.', 'code': 'not_found'}, 404)
            coach = {'email': owner, 'name': staff.username or owner}
        owner = coach['email']
        # Ownership comes from the current caseload, never from a client list or a historical booking.
        roster = [row for row in _learners(owner) if _email(row.get('coach_email')) == owner
                  and (not search or search.casefold() in str(row.get('full_name') or '').casefold())]
        page = roster[offset:offset + limit]
        ids = {str(row['id']) for row in page}
        by_learner = {key: [] for key in ids}
        for row in _roster_bookings(owner, [row['id'] for row in page], start, end, first_day, last_day):
            booking = _roster_booking(row, owner=owner, learner_ids=ids, start=start, end=end,
                                      first_day=first_day, last_day=last_day)
            if booking is not None:
                by_learner[str(row['learner_id'])].append(booking)
        return _response({
            'coach': coach, 'scope': 'all' if all_access else 'own', 'source': 'lms',
            'start': range_params['start'], 'end': range_params['end'], 'timeZone': zone_name, 'search': search,
            'learners': [{'id': str(row['id']), 'name': row['full_name'], 'learnerType': row['learner_type'],
                          'bookings': by_learner[str(row['id'])]} for row in page],
            'coverage': {'offset': offset, 'totalLearners': len(roster),
                         'nextOffset': offset + len(page) if offset + len(page) < len(roster) else None},
        })
    except DatabaseError:
        log.warning('Coaching learner roster database lookup failed.')
        return _response({'error': 'Coach learners and saved bookings could not be loaded.',
                          'code': 'coaching_roster_unavailable'}, 503)


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
@gzip_page
def coaching_recordings_calendar(request):
    background = request.GET.get('background') == '1'
    try:
        start, end, zone_name, offset, limit, learner_id = _parameters(request.GET)
    except (TypeError, ValueError, ZoneInfoNotFoundError, OverflowError):
        return _response({'error': 'Choose a valid date range of at most 31 days, time zone and page.',
                          'code': 'invalid_calendar_range'}, 400)

    try:
        # Re-read the authoritative staff row. Browser mailbox/role parameters
        # never install an identity or expand the account's access.
        staff = _staff(request.login_account)
        grants = accesses_for_staff(staff) if staff else frozenset()
        all_access = bool(grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN})
        if not all_access and ACCESS_COACH not in grants:
            return _response({'error': 'Access denied.', 'code': 'forbidden'}, 403)
        owner = _email(staff.email)
        if not all_access and not owner:
            return _response({'error': 'Access denied.', 'code': 'forbidden'}, 403)
        coaches = _coaches() if all_access else [{'email': owner, 'name': staff.username or owner}]
        chosen = _email(request.GET.get('coachEmail'))
        if chosen and chosen not in {row['email'] for row in coaches}:
            return _response({'error': 'Coach not found.', 'code': 'not_found'}, 404)
        learners = _learners((chosen or None) if background and all_access else None if all_access else owner)
        if learner_id and learner_id not in {str(row['id']) for row in learners}:
            return _response({'error': 'Learner not found.', 'code': 'not_found'}, 404)
        selected = [row for row in coaches if not chosen or row['email'] == chosen]
        directory_only = request.GET.get('directoryOnly') == '1'
        page = [] if directory_only else selected if background else selected[offset:offset + limit]
        # Resolve all database reads before external requests. A database failure
        # must not be misreported as missing LMS appointments.
        bookings = _bookings_many([row['email'] for row in page], start, end) if background else {row['email']: _bookings(row['email'], start, end) for row in page}
    except DatabaseError:
        log.warning('Coaching recording calendar database lookup failed.')
        return _response({'error': 'Coaching calendar data could not be loaded.',
                          'code': 'coaching_calendar_unavailable'}, 503)

    meetings, lms_only, cancellations, errors, checked = [], [], [], [], []
    now = datetime.now(timezone.utc)
    # Only provider reads run in threads; ORM work and permission checks stay
    # on the request thread. Three mailboxes maximum, with no orphaned jobs.
    def calendar_read(coach):
        try:
            return recent_calendar(coach['email'], start, end, load_coach_calendar,
                                   refresh=request.GET.get('refresh') == '1'), None
        except Exception as failure:
            return None, calendar_failure(failure)

    pending_calendars = pending_evidence = 0
    initial_calendars = initial_evidence = 0
    stamps = []
    discoveries = {}
    if background:
        try:
            snapshots = calendar_snapshots(page, start, end, refresh=request.GET.get('refresh') == '1')
            calendar_pages = []
            contexts = []
            for coach, snapshot in zip(page, snapshots):
                pending_calendars += int(snapshot['pending'])
                initial_calendars += int(snapshot['pending'] and not snapshot['syncedAt'])
                if snapshot['syncedAt']:
                    stamps.append(snapshot['syncedAt'])
                if snapshot['error']:
                    errors.append({'coachEmail': coach['email'], **snapshot['error']})
                calendar_pages.append((snapshot['events'], None))
                contexts.extend(event_context(coach['email'], event) for event in snapshot['events'] or [])
            discoveries = evidence_jobs(contexts)
            for job in discoveries.values():
                waiting = job.state in ('queued', 'running') or bool(
                    getattr(job, 'next_run_at', None) and job.next_run_at <= now)
                pending_evidence += int(waiting)
                initial_evidence += int(waiting and not getattr(job, 'last_success_at', None))
        except DatabaseError:
            return _response({'error': 'Background coaching storage is unavailable. Apply the reviewed coaching migration.',
                              'code': 'coaching_background_unavailable'}, 503)
    elif len(page) > 1:
        with ThreadPoolExecutor(max_workers=3) as pool:
            calendar_pages = list(pool.map(calendar_read, page))
    else:
        calendar_pages = [calendar_read(coach) for coach in page]
    try:
        lectures = lecture_occurrences(start, end) if any(events for events, _ in calendar_pages) else []
    except DatabaseError:
        return _response({'error': 'Lecture identities could not be checked. Retry the calendar.',
                          'code': 'coaching_categories_unavailable'}, 503)
    version = None
    if background:
        # Revalidate current grants, roster, bookings and job versions, then
        # acknowledge unchanged data before matching/signing thousands of rows.
        boundary = max((stamp.timestamp() for events, _ in calendar_pages for event in events or [] if isinstance(event, dict)
                        for key in ('start', 'end') if isinstance(event.get(key), dict)
                        if (stamp := _event_instant(event[key])) and stamp <= now), default=0)
        fingerprint = [start, end, zone_name, chosen, learner_id, sorted(grants), coaches, learners, lectures,
            {owner: sorted(rows, key=lambda row: row['event_key']) for owner, rows in bookings.items()},
            stamps, errors, pending_calendars, pending_evidence, initial_calendars, initial_evidence,
            boundary, int(now.timestamp()) // 1800,
            [(key, getattr(job, 'last_success_at', None), job.error_code) for key, job in sorted(discoveries.items())]]
        version = sha256(json.dumps(fingerprint, sort_keys=True, default=str).encode()).hexdigest()
        if request.headers.get('If-None-Match') == f'"{version}"' and request.GET.get('refresh') != '1':
            response = HttpResponseNotModified()
            response['ETag'] = f'"{version}"'
            response['Cache-Control'] = 'private, no-store'
            return response
    for coach, (events, failure) in zip(page, calendar_pages):
        email = coach['email']
        saved_cancellations = cancelled_bookings(bookings[email], learners,
            coach_email=email, start=start, end=end)
        cancellations.extend(row for row in saved_cancellations
                             if not learner_id or learner_id == row['learnerId'])
        if failure:
            log.warning('Coaching calendar read failed (%s).', failure['code'])
            errors.append({'coachEmail': email, **failure})
            continue
        if events is None:
            continue
        try:
            result = compare_coach_calendar(events, bookings[email], learners,
                                            coach_email=email, start=start, end=end, now=now)
        except Exception as failure:
            # Never return provider bodies, tokens, invite contents or private URLs.
            log.warning('Coaching calendar read failed (%s).', type(failure).__name__)
            errors.append({'coachEmail': email, 'code': 'calendar_read_failed'})
            continue
        checked.append(email)
        if not result['complete']:
            errors.append({'coachEmail': email, 'code': 'calendar_incomplete',
                           'invalidEvents': result['invalidEvents']})
        visible = [row for row in result['meetings'] if not learner_id or learner_id in row['learnerIds']]
        external = {}
        events_by_id = {event['id']: event for event in events if isinstance(event, dict) and event.get('id')}
        for row in visible:
            row['category'], row['categorySource'] = category(row, events_by_id[row['calendarEventId']], lectures)
            context = calendar_context(email, row['calendarEventId'], row['startsAt'], row['endsAt'])
            row['meetingId'] = occurrence_id(context)
            row['recordingsReference'] = calendar_reference(context)
            external[(row['calendarEventId'], row['startsAt'], row['endsAt'])] = calendar_key(context)
        native_ids = {row['event_key']: row.get('graph_event_id') or '' for row in bookings[email]}
        if not background:
            try:
                discoveries.update(evidence_jobs([calendar_context(email, row['calendarEventId'], row['startsAt'], row['endsAt']) for row in visible]))
            except DatabaseError:
                errors.append({'coachEmail': email, 'code': 'recordings_incomplete'})
        for row in visible:
            if row['eventKey'] and row['match'] == 'matched' and row['phase'] != 'cancelled':
                row['analysisContext'] = signing.dumps(
                    {**{key: row[key] for key in ('eventKey', 'startsAt', 'endsAt', 'title')},
                     'graphEventId': native_ids[row['eventKey']]},
                    salt='coaching-quality-title', compress=True)
            key = external[(row['calendarEventId'], row['startsAt'], row['endsAt'])]
            discovery = discoveries.get(key)
            row['media'] = source_summary(discovery)
            if discovery and discovery.error_code and not any(item.get('coachEmail') == email and item['code'] == 'recordings_incomplete' for item in errors):
                errors.append({'coachEmail': email, 'code': 'recordings_incomplete'})
            row['readyToAction'] = row['phase'] == 'ended' and (row['match'] == 'matched' or bool(row.get('recordingsReference'))) and row['media']['readyCount'] > 0
        if any(row['media']['state'] in {'unavailable', 'missing', 'failed'}
               or any(file['state'] in {'unavailable', 'missing', 'failed'} for file in row['media']['recordings']) for row in visible):
            errors.append({'coachEmail': email, 'code': 'recordings_incomplete'})
        meetings.extend(visible)
        lms_only.extend({**row, 'coachEmail': email} for row in result['lmsOnly']
                        if not learner_id or learner_id == row['learnerId'])
    next_offset = offset + len(page) if not background and offset + len(page) < len(selected) else None
    if directory_only:
        next_offset = 0 if selected else None
    payload = {
        'start': request.GET['start'], 'end': request.GET['end'], 'timeZone': zone_name,
        'scope': 'all' if all_access else 'own',
        'coaches': coaches,
        'learners': [{'id': str(row['id']), 'name': row['full_name'],
                      'coachEmail': _email(row['coach_email']), 'learnerType': row['learner_type']} for row in learners],
        'meetings': sorted(meetings, key=lambda row: (row['startsAt'], row['coachEmail'], row['calendarEventId'])),
        'lmsOnly': sorted(lms_only, key=lambda row: (row['startsAt'], row['coachEmail'], row['eventKey'])),
        'cancelledBookings': cancellations,
        'errors': errors, 'partial': bool(errors),
        'coverage': {'checkedCoachEmails': checked, 'totalCoaches': len(selected), 'nextOffset': next_offset},
    }
    if background:
        directory = {'coaches': payload['coaches'], 'learners': payload['learners']}
        digest = sha256(json.dumps(directory, sort_keys=True).encode()).hexdigest()
        unchanged = request.GET.get('directoryHash') == digest
        payload['sync'] = {'pending': bool(pending_calendars or pending_evidence), 'pendingCalendars': pending_calendars,
            'pendingEvidence': pending_evidence, 'lastSuccessfulAt': min(stamps) if stamps else None,
            'initialPendingCalendars': initial_calendars, 'initialPendingEvidence': initial_evidence,
            'directoryHash': digest, 'directoryUnchanged': unchanged}
        payload['sync']['version'] = version
        if unchanged:
            payload['coaches'] = payload['learners'] = []
    status = 503 if page and not checked and not (background and pending_calendars) else 207 if errors else 200
    if background:
        from .recordings_response_cache import delta_payload
        wire_payload = delta_payload(request, payload,
            [request.login_account.subject_id, sorted(grants), start, end, zone_name, chosen, learner_id], int(now.timestamp()) // 1800)
    else:
        wire_payload = payload
    response = _response(wire_payload, status)
    if background:
        response['ETag'] = f'"{payload["sync"]["version"]}"'
    return response


def _authorised_record(request):
    if request.GET.get('reference'):
        try:
            context = read_reference(request.GET['reference'])
        except (signing.BadSignature, KeyError, TypeError, ValueError):
            return None, _response({'error': 'Refresh the calendar to renew this meeting reference.', 'code': 'invalid_calendar_reference'}, 400)
        try:
            staff = _staff(request.login_account)
            grants = accesses_for_staff(staff) if staff else frozenset()
            all_access = bool(grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN})
            if not all_access and ACCESS_COACH not in grants:
                return None, _response({'error': 'Access denied.', 'code': 'forbidden'}, 403)
            allowed = context['owner'] in {row['email'] for row in _coaches()} if all_access else context['owner'] == _email(staff.email)
            record = calendar_record(context)
            supplied = request.GET.get('eventKey')
            if not allowed or (supplied and supplied != record.event_key):
                return None, _response({'error': 'Session not found.', 'code': 'not_found'}, 404)
            record.recording_reference = request.GET['reference']
            return record, None
        except DatabaseError:
            return None, _response({'error': 'Session could not be loaded.', 'code': 'session_unavailable'}, 503)
    key = request.GET.get('eventKey', '').strip()
    if not key or len(key) > 255:
        return None, _response({'error': 'Choose a coaching session.', 'code': 'invalid_session'}, 400)
    try:
        staff = _staff(request.login_account)
        grants = accesses_for_staff(staff) if staff else frozenset()
        all_access = bool(grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN})
        if not all_access and ACCESS_COACH not in grants:
            return None, _response({'error': 'Access denied.', 'code': 'forbidden'}, 403)
        record = CoachCalendarEvent.objects.filter(event_key=key, event_type__in=tuple(FAMILIES)).first()
        allowed = bool(record) and (all_access or (
            _email(record.owner_email) == _email(staff.email)
            and bool(_email(staff.email))
            and any(str(row['id']) == str(record.learner_id) for row in _learners(_email(staff.email)))))
        if not allowed:
            return None, _response({'error': 'Session not found.', 'code': 'not_found'}, 404)
        return record, None
    except DatabaseError:
        return None, _response({'error': 'Session could not be loaded.', 'code': 'session_unavailable'}, 503)


def _saved_session_evidence(request, record, job, *, part='all'):
    """Fresh authorization precedes cache access, including on downloads."""
    try:
        staff = _staff(request.login_account)
        grants = accesses_for_staff(staff) if staff else frozenset()
        if not grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN, ACCESS_COACH}:
            return empty_evidence('unavailable')
        learner_ids = None
        if part != 'attendance' and not grants & {ACCESS_CURRICULUM, ACCESS_SUPER_ADMIN}:
            owner = _email(staff.email)
            profiles = LearnerProfile.objects.annotate(owner_key=Lower(Trim('coach_email')),
                enrolment_aptem=Subquery(EnrolmentUser.objects.filter(id=OuterRef('enrolment_id')).values('aptem_id')[:1])
                ).filter(owner_key=owner).values('aptem_id', 'enrolment_aptem')
            learner_ids = sorted({int(value) for row in profiles
                if (value := row['enrolment_aptem'] if row['enrolment_aptem'] not in (None, '') else row['aptem_id']) is not None
                and str(value).isdecimal() and int(value) > 0})
        return saved_evidence(record, job, learner_ids=learner_ids, part=part)
    except DatabaseError:
        return empty_evidence('unavailable')


def _with_saved_evidence(request, record, job, attendance, *, part='all'):
    if part == 'attendance' and attendance['state'] == 'available':
        return None, attendance
    evidence = _saved_session_evidence(request, record, job, part=part)
    if part != 'attendance':
        from .completion_status import completion_summary
        evidence = {**evidence, 'completion': completion_summary(record)}
    # A pending/failed fetch is not proof that the existing source has no report.
    # Preserve already verified local attendance; never infer missing invitees absent.
    if attendance['state'] != 'available' and evidence['attendance']['state'] == 'available':
        attendance = evidence['attendance']
    return {key: value for key, value in evidence.items() if key != 'attendance'}, attendance


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
def coaching_recording_session(request):
    record, failure = _authorised_record(request)
    if failure is not None:
        return failure
    part = request.GET.get('part', 'all')
    if part not in ('all', 'attendance', 'evidence'):
        return _response({'error': 'Choose a valid session detail section.'}, 400)
    if part == 'evidence':
        try:
            job = source_details(record)
            evidence = _saved_session_evidence(request, record, job, part='evidence')
            from .completion_status import completion_summary
            evidence = {**evidence, 'completion': completion_summary(record)}
            if request.GET.get('checkMicrosoft') == '1':
                evidence = check_microsoft_transcript(record, job, evidence)
            return _response({'eventKey': record.event_key, 'reference': getattr(record, 'recording_reference', None),
                'evidence': {key: value for key, value in evidence.items() if key != 'attendance'}})
        except DatabaseError:
            return _response({'error': 'Saved meeting evidence is temporarily unavailable.'}, 503)
    if getattr(record, 'recording_reference', None):
        try:
            job = source_details(record)
            media = source_summary(job)
            try:
                attendance = saved_calendar_attendance(record)
            except Exception:
                attendance = {'state': 'unavailable', 'reportCount': 0, 'rows': []}
            evidence, attendance = _with_saved_evidence(request, record, job, attendance, part=part)
            attendance_job = queue_attendance(record) if attendance['state'] != 'available' else None
            if attendance_job and attendance_job.error_code and attendance['state'] != 'available':
                attendance['state'] = 'unavailable'
            return _response({'eventKey': record.event_key, 'reference': record.recording_reference,
                              'media': media, 'attendance': attendance, **({'evidence': evidence} if part == 'all' else {}),
                              'partial': attendance['state'] == 'unavailable' or media['state'] == 'unavailable'})
        except Exception:
            return _response({'error': 'Saved calendar meeting evidence could not be loaded.', 'code': 'session_unavailable'}, 503)
    from .views import stored_coach_meeting_snapshot, build_coach_meeting_attendance_tracker
    snapshot = stored_coach_meeting_snapshot(record)
    attendance = snapshot.get('attendance') or {}
    job = None
    try:
        job = source_details(record)
        media = source_summary(job)
    except Exception:
        media = {'state': 'unavailable', 'recordings': [], 'readyCount': 0}
    unavailable = bool(snapshot.get('partial')) or not (snapshot.get('storage') or {}).get('stored')
    reports = snapshot.get('attendanceReports') or []
    verdicts = [in_session_window(row.get('meetingStartDateTime'), row.get('meetingEndDateTime'), session_window(record)) for row in reports]
    if any(value is None for value in verdicts) or (attendance.get('reportCount') and not reports):
        unavailable = True
    selected = [row for row, belongs in zip(reports, verdicts) if belongs]
    tracker = attendance.get('tracker') or []
    if len(selected) != len(reports):
        tracker = build_coach_meeting_attendance_tracker(attendance.get('expectedAttendees') or [],
            [row for report in selected for row in report.get('records') or []], has_report=bool(selected))['tracker']
    if unavailable or not selected:
        tracker = []
    rows = [{key: row.get(key) for key in ('name', 'displayName', 'email', 'role', 'status', 'totalAttendanceSeconds', 'expected')}
            for row in tracker if isinstance(row, dict)]
    attendance = {'state': 'unavailable' if unavailable else 'available' if selected else 'pending',
                                     'reportCount': len(selected), 'rows': rows,
                                     'syncedAt': (snapshot.get('storage') or {}).get('syncedAt')}
    evidence, attendance = _with_saved_evidence(request, record, job, attendance, part=part)
    return _response({'eventKey': record.event_key, 'media': media, 'attendance': attendance, **({'evidence': evidence} if part == 'all' else {}),
                      'partial': attendance['state'] == 'unavailable' or media['state'] == 'unavailable'})


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
def coaching_saved_evidence_download(request):
    record, failure = _authorised_record(request)
    if failure is not None:
        return failure
    kind = request.GET.get('kind')
    if kind not in ('transcript', 'analysis', 'attendance'):
        return _response({'error': 'Choose a saved evidence file.'}, 400)
    local_attendance = None
    if kind == 'attendance' and getattr(record, 'calendar_window', None):
        try:
            local_attendance = saved_calendar_attendance(record)
        except Exception:
            local_attendance = None
    try:
        job = source_details(record) if not local_attendance or local_attendance['state'] != 'available' else None
        evidence = empty_evidence('matched') if local_attendance and local_attendance['state'] == 'available' else (
            _saved_session_evidence(request, record, job, part='attendance' if kind == 'attendance' else 'evidence'))
        if kind == 'transcript' and not evidence['transcript'] and request.GET.get('checkMicrosoft') == '1':
            evidence = check_microsoft_transcript(record, job, evidence)
            if (evidence.get('transcriptCheck') or {}).get('state') == 'unavailable':
                return _response({'error': 'Microsoft could not return this transcript. Please retry.', 'code': 'transcript_unavailable'}, 503)
    except DatabaseError:
        return _response({'error': 'Saved meeting evidence is temporarily unavailable.'}, 503)
    if evidence['state'] == 'unavailable' and kind != 'attendance':
        return _response({'error': 'Saved meeting evidence is temporarily unavailable.'}, 503)
    if kind == 'transcript':
        content = (evidence['transcript'] or {}).get('content')
        content_type, extension = 'text/plain; charset=utf-8', 'txt'
    elif kind == 'analysis':
        report = next((row for row in evidence['analyses'] if row['id'] == request.GET.get('analysisId')
                       and row['status'] == 'completed' and row['report'] is not None), None)
        content = json.dumps(report['report'], ensure_ascii=False, indent=2) if report else None
        content_type, extension = 'application/json; charset=utf-8', 'json'
    else:
        # Use the drawer's same precedence: verified local, then saved source.
        attendance = local_attendance
        if not attendance or attendance['state'] != 'available':
            attendance = evidence['attendance']
        content = json.dumps(attendance, ensure_ascii=False, indent=2) if attendance and attendance['state'] == 'available' else None
        content_type, extension = 'application/json; charset=utf-8', 'json'
    if content is None:
        return _response({'error': 'No saved file was found for this meeting.'}, 404)
    response = HttpResponse(content, content_type=content_type)
    response['Content-Disposition'] = f'attachment; filename="coaching-{kind}.{extension}"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
@xframe_options_sameorigin
def coaching_saved_evidence_pdf(request):
    record, failure = _authorised_record(request)
    if failure is not None:
        return failure
    kind = request.GET.get('kind')
    if kind not in ('transcript', 'analysis'):
        return _response({'error': 'Choose a transcript or saved report PDF.'}, 400)
    try:
        job = source_details(record)
        evidence = _saved_session_evidence(request, record, job, part='pdf')
        if kind == 'transcript' and not evidence['transcript'] and request.GET.get('checkMicrosoft') == '1':
            evidence = check_microsoft_transcript(record, job, evidence)
        if evidence['state'] == 'unavailable' or (evidence.get('transcriptCheck') or {}).get('state') == 'unavailable':
            return _response({'error': 'This PDF could not be prepared because its saved evidence is unavailable. Please retry.', 'code': 'pdf_evidence_unavailable'}, 503)
        analysis = next((row for row in evidence['analyses'] if row['id'] == request.GET.get('analysisId')
                         and row['status'] == 'completed' and row['report'] is not None), None) if kind == 'analysis' else None
        if evidence['state'] != 'matched' or (kind == 'transcript' and not evidence['transcript']) or (kind == 'analysis' and not analysis):
            return _response({'error': 'No verified saved evidence is available for this PDF.', 'code': 'pdf_not_found'}, 404)
        from .recordings_pdf import evidence_pdf
        content = evidence_pdf(record, evidence, kind=kind, analysis=analysis)
    except DatabaseError:
        return _response({'error': 'Saved PDF evidence is temporarily unavailable.', 'code': 'pdf_evidence_unavailable'}, 503)
    except Exception as failure:
        log.warning('Coaching PDF rendering failed (%s).', type(failure).__name__)
        return _response({'error': 'This PDF could not be prepared. Please retry.', 'code': 'pdf_render_failed'}, 503)
    response = HttpResponse(content, content_type='application/pdf')
    disposition = 'inline' if request.GET.get('preview') == '1' else 'attachment'
    response['Content-Disposition'] = f'{disposition}; filename="coaching-{kind}.pdf"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    response['Content-Length'] = str(len(content))
    response['Content-Security-Policy'] = "frame-ancestors 'self'"
    return response


@require_GET
@require_access(ACCESS_CURRICULUM, ACCESS_COACH)
def coaching_recording_content(request):
    record, failure = _authorised_record(request)
    if failure is not None:
        return failure
    artifact_id = request.GET.get('recordingId', '')
    try:
        job = source_details(record)
        artifact = next((item for item in (job.result.get('artifacts', []) if job else [])
                         if item.get('artifact_type', 'recording') == 'recording' and item['graph_artifact_id'] == artifact_id), None)
        if not artifact:
            return _response({'error': 'Recording not found.', 'code': 'not_found'}, 404)
        window = session_window(record)
        if not in_session_window(artifact.get('created_datetime'), artifact.get('end_datetime'), window):
            return _response({'error': 'Recording occurrence changed.', 'code': 'recording_session_mismatch'}, 409)
        from .views import get_graph_settings, microsoft_graph_request
        from .recordings_cache import recent_read
        from .recordings_transport import valid_range, recording_response
        from urllib.parse import quote
        try:
            valid_range(request.headers.get('Range'))
        except ValueError:
            return _response({'error': 'Unsupported video range.', 'code': 'invalid_range'}, 416)
        def verify_identity():
            current = microsoft_graph_request('GET', f'{job.result["base"]}/recordings/{quote(artifact_id, safe="")}')
            return current.get('id') == artifact_id and bool(in_session_window(
                current.get('createdDateTime'), current.get('endDateTime'), window))
        verified = recent_read('source-identity', [get_graph_settings(), record.event_key, artifact_id],
                               verify_identity, cache_if=lambda value: value is True)
        if not verified:
            return _response({'error': 'Recording occurrence could not be verified.', 'code': 'recording_session_mismatch'}, 409)
        from django.core.handlers.asgi import ASGIRequest
        return recording_response(job.result['base'], artifact_id, preview=request.GET.get('preview') == '1',
            byte_range=request.headers.get('Range'), if_range=request.headers.get('If-Range'),
            asynchronous=isinstance(request, ASGIRequest))
    except Exception:
        return _response({'error': 'Recording access is temporarily unavailable.', 'code': 'recording_unavailable'}, 503)
