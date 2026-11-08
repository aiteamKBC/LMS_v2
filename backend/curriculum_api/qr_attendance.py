"""Public email-only curriculum attendance declarations, independent of attendance credit."""
import hashlib
import ipaddress
import json
import os
from datetime import datetime
from datetime import timezone as utc
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from . import qr_attendance_store as store

INVALID = {'cancelled', 'canceled', 'deleted', 'failed', 'superseded', 'invalid'}


class AttendanceError(Exception):
    def __init__(self, message, code, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def clean(value):
    return str(value or '').strip()


def email_value(value):
    if not isinstance(value, str) or not value.strip():
        raise AttendanceError('Enter your registered email address.', 'email_required')
    value = value.strip().lower()
    try:
        validate_email(value)
        if len(value) > 320:
            raise ValidationError('Email too long')
    except ValidationError:
        raise AttendanceError('Enter a valid email address.', 'invalid_email') from None
    return value


def unique(values, label):
    values = {clean(value) for value in values if clean(value)}
    if len(values) > 1:
        raise AttendanceError(f'Your {label} needs checking. Please contact the college.', 'ambiguous_placement', 409)
    return next(iter(values), None)


def module_programme(module):
    ids = {clean(module.get(key)) for key in ('programme_id', 'group_programme_id',
           'cohort_programme_id', 'group_cohort_programme_id') if clean(module.get(key))}
    conflicting_cohort = (module.get('cohort_id') and module.get('group_cohort_id')
                          and module['cohort_id'] != module['group_cohort_id'])
    return next(iter(ids)) if len(ids) == 1 and not module['deleted'] and not conflicting_cohort else None


def named_placement(rows, value, name_field):
    """Legacy placement fallback: exact, unique, and already programme-scoped."""
    wanted = clean(value).casefold()
    matches = [row for row in rows if wanted and wanted in
               {clean(row['id']).casefold(), clean(row.get(name_field)).casefold()}]
    return matches[0] if len(matches) == 1 else None


def context(email):
    matches = store.students(email)
    if len(matches) != 1:
        message = ('We could not find this registered email. Please check it or contact the college.'
                   if not matches else 'This email matches more than one record. Please contact the college.')
        raise AttendanceError(message, 'email_not_resolved', 400)
    student = matches[0]
    profiles = store.placements(student.id)
    placement = {'programme_id': unique((row.get('programme_id') for row in profiles), 'programme')}
    profile_values = {}
    for key in ('group_id', 'cohort_id'):
        values = {clean(row.get(key)) for row in profiles if clean(row.get(key))}
        profile_values[key] = values
        # Ambiguous original placement is unknown, not an eligibility gate.
        placement[key] = next(iter(values)) if len(values) == 1 else None
    programmes = store.programmes()
    if placement['programme_id']:
        programme_id = placement['programme_id']
        valid = any(row['id'] == programme_id for row in programmes)
    else:
        # Legacy enrolments carry a programme name, not an ID. Resolve only an
        # exact, unique registered programme (never a module title).
        wanted = clean(student.programme).casefold()
        ids = {row['id'] for row in programmes if wanted and
               wanted in {clean(row['id']).casefold(), clean(row['name']).casefold()}}
        programme_id = next(iter(ids)) if len(ids) == 1 else None
        valid = programme_id is not None
    if not valid:
        raise AttendanceError('Your programme could not be verified. Please contact the college.', 'programme_unresolved', 409)
    groups = {row['id']: row for row in store.groups() if row['programme_id'] == programme_id}
    cohorts = {row['id']: row for row in store.cohorts() if row['programme_id'] == programme_id}
    # IDs survive renames. Only genuinely absent IDs can use legacy names;
    # conflicting/stale IDs must not be silently replaced with a guessed name.
    if not profile_values['cohort_id']:
        cohort = named_placement(cohorts.values(), getattr(student, 'cohort', ''), 'cohort_name')
        placement['cohort_id'] = cohort['id'] if cohort else None
    if not profile_values['group_id']:
        candidates = [row for row in groups.values() if not placement['cohort_id']
                      or row.get('cohort_id') == placement['cohort_id']]
        resolved_group = named_placement(candidates, student.group, 'group_name')
        placement['group_id'] = resolved_group['id'] if resolved_group else None
    # Missing placement is permitted. It affects suggestions/snapshots only.
    group = groups.get(placement['group_id'])
    placement['group_id'] = group['id'] if group else None
    placement['cohort_id'] = placement['cohort_id'] if placement['cohort_id'] in cohorts else None
    if group and not profile_values['cohort_id'] and not placement['cohort_id'] and group['cohort_id'] in cohorts:
        placement['cohort_id'] = group['cohort_id']
    catalog = {row['id']: row for row in store.modules()}
    eligible = {key: row for key, row in catalog.items() if module_programme(row) == programme_id}
    student.programme_id = programme_id
    student.group_id = placement['group_id'] or ''
    student.cohort_id = placement['cohort_id'] or ''
    student.qr_group = group
    return student, programme_id, placement, catalog, eligible


def shared_sources(module_id, catalog):
    # Same directed owner chain as curriculum/attendance, without calling the
    # views' schema-provisioning helpers. A shared source is not programme membership.
    chain = []
    while module_id:
        if module_id in chain or len(chain) >= 32:
            raise AttendanceError('This shared lecture setup needs checking. Please contact the college.', 'invalid_shared_session', 409)
        module = catalog.get(module_id)
        if module is None or module['deleted']:
            raise AttendanceError('This module is no longer available.', 'invalid_module', 400)
        chain.append(module_id)
        source = clean(module.get('shared_source'))
        relation = clean(module.get('share_relation'))
        if source and relation and source != relation:
            raise AttendanceError('This shared lecture setup needs checking. Please contact the college.', 'invalid_shared_session', 409)
        module_id = source or relation
    return chain


def aware(value):
    # Existing occurrence timestamps without timezone are UTC, not local time.
    return timezone.make_aware(value, utc.utc) if value and timezone.is_naive(value) else value


def business_day(instant):
    return timezone.localdate(instant, timezone.get_default_timezone())


def component_settings(value):
    if isinstance(value, dict):
        return value
    try:
        decoded = json.loads(value or '')
    except (TypeError, ValueError):
        return {}
    return decoded if isinstance(decoded, dict) else {}


def lecture_title(occurrence, components, module_ids):
    """Use the unique authored Title linked to this occurrence, never list position."""
    matches = {}
    for component in components:
        settings = component_settings(component.get('settings_json'))
        settings = {**component_settings(settings.get('legacySettings')), **settings}
        if clean(settings.get('teamsCalendarBinding')) in {'unverified', 'missing'}:
            continue
        extra = clean(settings.get('extraTeamsLiveSessionId'))
        occurrence_id = clean(settings.get('teamsOccurrenceId'))
        series_id = clean(settings.get('teamsLiveSessionId'))
        if extra:
            # An additional meeting owns its single occurrence, not the inherited series.
            linked = extra == clean(occurrence['live_session_id']) and occurrence['session_number'] == 1
        elif occurrence_id:
            linked = occurrence_id == clean(occurrence['id']) and (
                not series_id or series_id == clean(occurrence['live_session_id']))
        else:
            linked = (series_id == clean(occurrence['live_session_id'])
                      and clean(settings.get('teamsSessionNumber')) == clean(occurrence['session_number']))
        if linked:
            matches.setdefault(component['module_catalogue_id'], {})[component['id']] = clean(component.get('title'))
    # Prefer the selected delivery's authoring, then its directed shared source.
    # Ambiguous or absent labels retain the occurrence without inventing a title.
    for module_id in module_ids:
        titles = matches.get(module_id, {})
        if titles:
            title = next(iter(titles.values())) if len(titles) == 1 else ''
            return title or f"Session {occurrence['session_number']}"
    return f"Session {occurrence['session_number']}"


def lecture_options(module_id, catalog, eligible, *, now=None):
    if module_id not in eligible:
        raise AttendanceError('Choose a module in your programme.', 'invalid_module')
    module = eligible[module_id]
    now = now or timezone.now()
    today = business_day(now)
    result = {}
    sources = shared_sources(module_id, catalog)
    components = store.lecture_components(sources)
    for row in store.occurrences(sources):
        if any(clean(row[key]).lower() in INVALID for key in ('status', 'series_status')):
            continue
        start, end = aware(row['scheduled_start']), aware(row['scheduled_end'])
        if start is None or (end is not None and end <= start):
            continue
        completed = clean(row['status']).lower() == 'completed'
        current = bool(not completed and end and start <= now < end)  # Suggestion only.
        result[row['id']] = {
            'id': row['id'], 'moduleId': module_id,
            'title': lecture_title(row, components, sources),
            'startsAt': start.isoformat(), 'endsAt': end.isoformat() if end else None,
            'group': module.get('group_name') or '', 'cohort': module.get('cohort_name') or '',
            'current': current,
            # The whole scheduled business day is open, including completed lectures.
            'dueToday': business_day(start) == today,
            '_order': (start, row['id']),
        }
    ordered = sorted(result.values(), key=lambda row: row['_order'])
    for row in ordered:
        row.pop('_order')
    return ordered


def effective_assignments(student, eligible):
    from learner_api.learning_plan import _effective_plan_ids, _module_ids_from_column
    group = student.qr_group
    preset = (group.get('module_ids') or []) if group else []
    preset = _module_ids_from_column(preset)
    preset = [key for key in preset if key in eligible and eligible[key].get('learner_roster_mode') != 'manual']
    key = ('group_id', student.group_id) if student.group_id else (clean(student.programme), clean(student.group))
    return set(_effective_plan_ids(student, {key: preset})) & eligible.keys()


def normal_placement(module, placement):
    return all(not placement[key] or module.get(key) == placement[key]
               for key in ('group_id', 'cohort_id'))


def best_lectures(options, eligible, placement):
    """Return every equally best match; sorting is never a tie breaker."""
    ranked = []
    for row in options:
        if not row['dueToday']:
            continue
        normal = normal_placement(eligible[row['moduleId']], placement)
        rank = (0 if normal else 1) if row['current'] else 2 if row['dueToday'] and normal else None
        if rank is not None:
            ranked.append((rank, row))
    best = min((rank for rank, _ in ranked), default=None)
    return [row for rank, row in ranked if rank == best]


def automatic_selection(student, placement, catalog, eligible):
    from learner_api.learning_plan import _parse_day
    assigned = effective_assignments(student, eligible)
    now = timezone.now()
    today = business_day(now)
    options, current_modules = [], []
    for module_id in sorted(assigned):
        module = eligible[module_id]
        try:
            lectures = lecture_options(module_id, catalog, eligible, now=now)
        except AttendanceError:
            # Invalid shared setup must not block other modules or manual reads.
            continue
        options.extend(lectures)
        start, end = _parse_day(module.get('start_date')), _parse_day(module.get('end_date'))
        # Actual occurrences retain holiday-shifted delivery past a stored end.
        # They never fabricate an occurrence or select a merely next/last module.
        ends = [business_day(datetime.fromisoformat(row['endsAt'] or row['startsAt'])) for row in lectures]
        effective_end = max([end, *ends]) if end else None
        if start and effective_end and start <= today <= effective_end:
            current_modules.append(module_id)
    suggestions = best_lectures(options, eligible, placement)
    if suggestions:
        candidates = sorted({row['moduleId'] for row in suggestions})
    else:
        normal = [key for key in current_modules if normal_placement(eligible[key], placement)]
        candidates = normal or current_modules
    module_id = candidates[0] if len(candidates) == 1 else None
    occurrence_id = suggestions[0]['id'] if module_id and len(suggestions) == 1 else None
    # Equal delivery aliases of one shared occurrence must not choose an owner
    # by ID or repeat the same lecture as separate suggestions. Keep the module
    # alternatives; selecting a delivery loads that occurrence exactly once.
    deliveries = {}
    for row in suggestions:
        deliveries.setdefault(row['id'], set()).add(row['moduleId'])
    suggestions = [row for row in suggestions if len(deliveries[row['id']]) == 1]
    return {'suggestions': suggestions, 'moduleCandidates': candidates,
            'selection': {'moduleId': module_id, 'occurrenceId': occurrence_id}}


def lookup(email):
    student, _, placement, catalog, eligible = context(email)
    selection = automatic_selection(student, placement, catalog, eligible)
    return {'modules': [{'id': key, 'title': row['title'], 'group': row.get('group_name') or '',
                         'cohort': row.get('cohort_name') or ''}
                        for key, row in sorted(eligible.items(), key=lambda pair: (pair[1]['title'], pair[0]))],
            **selection}


def public_url():
    base = (getattr(settings, 'FRONTEND_URL', '') or os.environ.get('FRONTEND_URL', '')).strip().rstrip('/')
    parsed = urlsplit(base)
    local = parsed.hostname in {'localhost', '127.0.0.1', '::1'}
    try:
        local = local or ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        pass
    if (parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or (not settings.DEBUG and (local or parsed.scheme != 'https'))):
        raise AttendanceError('The attendance link is not configured. Please contact the college.', 'not_configured', 503)
    return base + '/qr-attendance'


def throttle(request, email=''):
    from login.security import client_ip
    # Existing proxy trust policy; never trust an arbitrary forwarded header.
    # A generous IP ceiling accommodates a class sharing the college network.
    limits = [('email', email, 30, 60)] if email else [('ip', client_ip(request) or '', 3000, 300)]
    for kind, identity, maximum, seconds in limits:
        digest = hashlib.sha256(identity.encode()).hexdigest()
        key = f'qr-attendance:{kind}:{digest}'
        try:
            if cache.add(key, 1, timeout=seconds):
                count = 1
            else:
                try:
                    count = cache.incr(key)
                except ValueError:
                    if not cache.add(key, 1, timeout=seconds):
                        raise AttendanceError('Please try again shortly.', 'temporarily_unavailable', 503)
                    count = 1
        except AttendanceError:
            raise
        except Exception:
            raise AttendanceError('Please try again shortly.', 'temporarily_unavailable', 503) from None
        if count > maximum:
            raise AttendanceError('Too many attempts. Please try again shortly.', 'rate_limited', 429)


def response(body, status=200):
    result = JsonResponse(body, status=status)
    result['Cache-Control'] = 'private, no-store'
    result['Referrer-Policy'] = 'no-referrer'
    if status == 429:
        result['Retry-After'] = '300'
    return result


@csrf_protect
def attendance(request):
    try:
        if request.method == 'GET':
            return response({'csrfToken': get_token(request), 'url': public_url(),
                             'timeZone': settings.TIME_ZONE, 'serverNow': timezone.now().isoformat()})
        if request.method != 'POST':
            return response({'error': 'Method not allowed.', 'code': 'method_not_allowed'}, 405)
        throttle(request)
        if len(request.body) > 4096:
            raise AttendanceError('The request is too large.', 'invalid_request', 413)
        try:
            payload = json.loads(request.body)
        except (ValueError, UnicodeDecodeError):
            raise AttendanceError('Check the form and try again.', 'invalid_request') from None
        if not isinstance(payload, dict):
            raise AttendanceError('Check the form and try again.', 'invalid_request')
        email = email_value(payload.get('email'))
        throttle(request, email)
        action = payload.get('action')
        if action == 'lookup':
            return response(lookup(email))
        module_id = clean(payload.get('moduleId'))
        if not module_id or len(module_id) > 128:
            raise AttendanceError('Choose a module.', 'invalid_module')
        if action == 'lectures':
            _, _, placement, catalog, eligible = context(email)
            lectures = lecture_options(module_id, catalog, eligible)
            suggestions = best_lectures(lectures, eligible, placement)
            return response({'lectures': lectures,
                             'suggestedOccurrenceId': suggestions[0]['id'] if len(suggestions) == 1 else None})
        if action == 'confirm':
            occurrence_id = clean(payload.get('occurrenceId'))
            if not occurrence_id or len(occurrence_id) > 128:
                raise AttendanceError('Choose a lecture.', 'invalid_lecture')
            created, confirmed_at = store.confirm(email, module_id, occurrence_id)
            return response({'recorded': True, 'alreadyRecorded': not created,
                             'confirmedAt': confirmed_at.isoformat(),
                             'message': 'Attendance confirmed successfully.' if created else 'Your attendance has already been recorded.'},
                            201 if created else 200)
        raise AttendanceError('Check the form and try again.', 'invalid_request')
    except AttendanceError as error:
        return response({'error': str(error), 'code': error.code}, error.status)
    except (DatabaseError, RuntimeError):
        return response({'error': 'Attendance is temporarily unavailable. Please try again.',
                         'code': 'temporarily_unavailable'}, 503)
