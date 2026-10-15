"""Selected-month Dashboard read model; legacy tab projections remain separate.

Canonical lineage and learning membership remain programme-wide: narrowing them
before direct-save reconciliation changes accepted hours and course ownership.
Only compact navigation metadata and the selected month leave this reader.
"""
from datetime import date, datetime, timezone as utc_timezone
import re
from zoneinfo import ZoneInfo

from django.db import connections
from django.utils import timezone
from old_otjh.service import ServiceError
from . import canonical_learning as canonical
from . import training_plan_dashboard as schedule

UK = ZoneInfo('Europe/London')
MONTH = re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])\Z")


def validate_month(value):
    if value is None:
        return None
    if not MONTH.fullmatch(value) or not 1 <= int(value[:4]) <= 9998:
        raise ServiceError('Month must use YYYY-MM.', 'invalid_month', 400)
    return value


def shift_month(value, delta):
    year, month = map(int, value.split('-'))
    ordinal = year * 12 + month - 1 + delta
    return f'{ordinal // 12:04d}-{ordinal % 12 + 1:02d}'


def month_window(value):
    start = datetime.fromisoformat(value + '-01').replace(tzinfo=UK)
    end = datetime.fromisoformat(shift_month(value, 1) + '-01').replace(tzinfo=UK)
    return start, end


def day(value):
    if not value:
        return ''
    if isinstance(value, datetime):
        return value.replace(tzinfo=utc_timezone.utc).astimezone(UK).date().isoformat() if value.tzinfo is None else value.astimezone(UK).date().isoformat()
    return str(value)[:10]


def display_date(value):
    candidate = day(value)
    try:
        return date.fromisoformat(candidate).isoformat()
    except (TypeError, ValueError):
        return ''


def session_day(value):
    if not value:
        return ''
    return day(datetime.fromisoformat(str(value).replace('Z', '+00:00')))


def same_instant(first, second):
    if not first or not second:
        return False
    try:
        return datetime.fromisoformat(first.replace('Z', '+00:00')) == datetime.fromisoformat(second.replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return False


def review_day(review):
    return review.get('scheduledDate') or review.get('targetDate') or review.get('date') or ''


def display_subjects(learning, *, deduplicate=True):
    """The identity/date/KSB subset of learningSummary.subjectsFrom.

    Monthly currently receives unified Subjects rather than PlanSubjectSummary;
    those objects do not carry monthlyActivities or ksbCodesByMonth. Preserve
    that display behavior instead of introducing previously hidden assignments.
    """
    activity = learning.get('activity') or {}
    detail = learning.get('detail') or {}
    metadata = learning.get('metadata') or {}
    builder = metadata.get('builder_subjects') or {}
    dates = metadata.get('activity_dates') or {}
    sources = activity.get('activity_sources') or metadata.get('activity_sources') or {}
    canonical_courses = activity.get('progress_basis') in ('recorded_activities', 'catalogue_activities')
    historical = {s.get('module_id') for s in activity.get('subjects', []) if s.get('module_id')} if canonical_courses else set()
    subjects = {}
    for item in activity.get('subjects', []):
        key = f"legacy:{item['id']}"
        subjects[key] = {'id': key, 'title': item.get('name') or '', 'moduleId': item.get('module_id'), 'activities': []}
    for item in activity.get('activities', []):
        key = f"legacy:{item['group_id']}"
        subject = subjects.setdefault(key, {'id': key, 'title': item.get('group_name') or 'Unnamed subject', 'activities': []})
        if not any(a['id'] == item['activity_id'] for a in subject['activities']):
            subject['activities'].append({'id': item['activity_id'], 'date': day(item.get('date')), 'needsReview': item.get('date_needs_review'), 'ksbs': [], 'category': item.get('category'), 'title': item.get('activity'), 'legacyId': item.get('source_activity_id'), 'dedupe': f"legacy:{item['group_id']}:{item.get('catalogue_kind') or 'material'}:{item['activity_id']}" if item.get('source_activity_id') is not None else None})
    by_builder = {}
    for subject in subjects.values():
        if builder.get(subject['id']):
            by_builder.setdefault(builder[subject['id']]['id'], []).append(subject['id'])
    for source in sources.values():
        key = f"legacy:{source['group_id']}"
        if key in subjects:
            matches = by_builder.setdefault(source['module_id'], [])
            if key not in matches:
                matches.append(key)
    def current_key(module_id):
        matches = by_builder.get(module_id, [])
        return matches[0] if not canonical_courses and len(matches) == 1 else f'current:{module_id}'
    for item in metadata.get('current_subjects', []):
        if item['id'] not in historical:
            key = current_key(item['id'])
            subjects.setdefault(key, {'id': key, 'title': item.get('title') or '', 'activities': []})
    for index, item in enumerate([*detail.get('components', []), *detail.get('retiredQuizComponents', [])]):
        module_id = item.get('moduleId')
        if module_id in historical:
            continue
        key = current_key(module_id) if module_id else f"unlinked:{item.get('module')}"
        subject = subjects.setdefault(key, {'id': key, 'title': item.get('module') or 'Unnamed subject', 'activities': []})
        ref = item.get('componentId') or f"quiz:{(item.get('quizMeta') or {}).get('quizId') or str(item.get('week')) + ':' + str(index)}"
        placement = dates.get(ref) or {}
        if not placement or placement.get('date_source') in ('original_created_at', 'source_date', 'undated'):
            placement = {'date': day(item.get('sessionDate'))}
        projected = {'id': ref, 'date': day(placement.get('date')), 'needsReview': placement.get('date_needs_review'), 'ksbs': [k['code'] for k in item.get('ksbMappings') or [] if k.get('code')], 'category': item.get('type'), 'title': item.get('component'), 'sessionInstant': item.get('sessionDateTimeUtc'), 'dedupe': f"component:{item['componentId']}" if item.get('componentId') else f"quiz:{item['quizMeta']['quizId']}" if (item.get('quizMeta') or {}).get('quizId') else None}
        source = sources.get(ref)
        previous = next((a for a in subject['activities'] if source and a.get('legacyId') == source.get('activity_id')), None) if source and source.get('module_id') == module_id and key == f"legacy:{source.get('group_id')}" else None
        if previous is not None:
            previous.setdefault('nativeRefs', []).append(ref)
            previous.update(ksbs=projected['ksbs'], sessionInstant=projected['sessionInstant'], nativeRef=ref)
            if projected['date'] and not projected['needsReview']:
                previous.update(date=projected['date'], needsReview=False)
        elif not any(a['id'] == ref for a in subject['activities']):
            subject['activities'].append(projected)
    for title in detail.get('modules', []):
        if not any(s['title'].strip().lower() == title.strip().lower() for s in subjects.values()):
            key = f'unlinked:{title}'
            subjects[key] = {'id': key, 'title': title, 'activities': []}
    for subject in subjects.values():
        subject['title'] = builder.get(subject['id'], {}).get('title') or subject['title']
    ordered = sorted(subjects.values(), key=lambda s: (s['title'].casefold(), s['id']))
    if not deduplicate:
        return ordered
    seen = set()
    for subject in ordered:
        kept = []
        for item in subject['activities']:
            key = item.get('dedupe')
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            kept.append(item)
        subject['activities'] = kept
    return ordered


def read_monthly(source, kind, owner, profile, request):
    from .dashboard_tabs import learning_projection
    from .attendance_lectures import read_workspace
    requested = validate_month(request.GET.get('month'))
    current = timezone.localdate(timezone=UK).strftime('%Y-%m')
    # Retain lineage context for direct-save replacement and manual corrections.
    records = canonical.entries_for(owner, lineage_only=True, dashboard_metadata=True)
    targets = canonical.targets_for(owner)
    learning = learning_projection(source, owner, records)
    spine = schedule.read_dashboard(source, section='overview', targets=targets,
                                    dashboard_tab='monthly', compact_monthly=True)
    subjects = display_subjects(learning)
    modules = {m['id']: m for m in spine['modules']}
    ids = list(modules)
    email = str(source.email or '').strip().casefold()
    with connections['enrolment'].cursor() as cur:
        bounds = schedule._plan_session_rows(cur, email, ids, rail_only=True, navigation_only=True) if ids else []
    session_bounds = {row['module_id']: row for row in bounds}
    for subject in subjects:
        module_id = (spine['moduleLinks'].get(subject['id']) or {}).get('id') or subject.get('moduleId') or (subject['id'][8:] if subject['id'].startswith('current:') else None)
        subject['moduleId'] = module_id
        module = modules.get(module_id) or {}
        dates = [a['date'] for a in subject['activities'] if a['date'] and not a.get('needsReview')]
        bound = session_bounds.get(module_id) or {}
        dates.extend(day(bound.get(key)) for key in ('first_start', 'last_start') if bound.get(key))
        dates.sort()
        subject['dates'] = dates
        subject['sessionMonths'] = bound.get('session_months') or []
        subject['start'] = day(module.get('start_date')) or (dates[0] if dates else '')
        subject['end'] = day(module.get('end_date')) or (dates[-1] if dates else subject['start'])
        subject['visualEnd'] = max(subject['end'], day(module.get('effectiveEndDate')))
    # These bounds are display context, never authorization or data ownership.
    programme_start = request.GET.get('programmeStartDate', getattr(source, 'learner_start_date', ''))
    programme_end = request.GET.get('programmeEndDate', owner.get('end_date'))
    minimum = display_date(programme_start) or min((s['start'] for s in subjects if s['start']), default='')
    actual_rows = schedule._canonical_actual_rows(owner, records)
    payload_months = [*(m for m in targets if m <= current), *(r['month'] for r in actual_rows), *(review_day(r)[:7] for r in spine['reviews'])]
    payload_months = [m for m in payload_months if MONTH.fullmatch(m)]
    maximum = max([display_date(programme_end), *(s['visualEnd'] for s in subjects), *(m + '-28' for m in payload_months)], default='')
    minimum, maximum = minimum[:7], maximum[:7]
    month = requested or min(max(current, minimum or current), maximum or current)
    start, end = month_window(month)
    with connections['enrolment'].cursor() as cur:
        sessions = schedule._plan_session_list(schedule._plan_session_rows(cur, email, ids, start, end)) if ids else []
    # A future/no-target month uses the established direct-learning fallback.
    fallback = None
    if month not in targets or month > current:
        from .overview_week import read_week
        # Only monthly OTJH is read here: skip the plan subjects and KSB lookups.
        fallback = read_week(source, monthly_hours_only=True).get(month)
    actual_records = [a for r in records for a in canonical.allocations(r) if a.get('reporting_month') == month]
    signed = canonical.query('''SELECT 1 FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND report_month=%s AND review_confirmed IS TRUE LIMIT 1''', [owner['id'], month]) if month <= current and month not in targets and not actual_records else []
    logged = month <= current and (month in targets or actual_records or signed)
    canonical_actual = sum(canonical.number(r.get('actual_seconds')) / 3600 for r in actual_records if canonical.counts_as_actual(r))
    achieved = max(0, canonical_actual) if logged else ((fallback or {}).get('actual', 0) if (fallback or {}).get('includesHistorical') else sum(row['hours'] for row in actual_rows if row['month'] == month) + (fallback or {}).get('actual', 0))
    required = targets.get(month) if month <= current else None
    if required is None:
        required = (fallback or {}).get('planned')
    else:
        required = max(0, required)
    selected = next((s for s in subjects if s['id'] == request.GET.get('subject')), None) or next((s for s in subjects if s['start'] and s['start'][:7] <= month <= s['end'][:7]), None)
    codes = sorted({code for s in subjects if month in s['sessionMonths'] or any(d.startswith(month) for d in s['dates']) for a in s['activities'] for code in a['ksbs']})[:4]
    attendance = read_workspace(source, kind, monthly=month)['lectures']
    lecture_rows = []
    unique_sessions = {}
    for subject in subjects:
        for session in sessions:
            if session['moduleId'] != subject['moduleId']:
                continue
            matches = [a for a in subject['activities'] if same_instant(a.get('sessionInstant'), session['start']) or a['category'] == 'live_session' and a['date'] == session_day(session['start'])]
            unique_sessions[session['id']] = {**session, **({'title': matches[0]['title']} if len(matches) == 1 else {})}
    for session in unique_sessions.values():
        lecture = next((r for r in attendance if r['source'] == 'microsoft-teams' and r['sessionId'] == f"teams:{session['id']}" and r['date'] == session_day(session['start'])), None)
        module = modules.get(session['moduleId']) or {}
        subject = next((s for s in subjects if s['moduleId'] == session['moduleId']), None)
        title = ((subject or {}).get('title') or '').strip() or (session.get('title') or '').strip() or 'Live session'
        tutor = module.get('tutor_name') or module.get('coach_name') or spine['coach']['name'] or 'Tutor'
        session = {key: session.get(key) for key in ('id', 'start', 'end', 'minutes', 'joinUrl', 'status')}
        if lecture:
            lecture = {key: lecture.get(key) for key in ('id', 'date', 'title', 'status', 'effectiveAttendance', 'rawStatus', 'rawAttendanceStatus', 'canReportAbsence', 'catchupStatus', 'absenceReport', 'recovery')}
            if lecture['recovery']:
                lecture['recovery'] = {key: lecture['recovery'].get(key) for key in ('method', 'calendarKey', 'ended')}
        lecture_rows.append({'session': session, 'title': title, 'tutor': tutor, 'attendance': lecture})
    def clamp(value):
        return min(max(value, minimum or value), maximum or value)
    return {'month': month, 'navigation': {'previous': clamp(shift_month(month, -1)) if not minimum or month > minimum else None,
            'next': clamp(shift_month(month, 1)) if not maximum or month < maximum else None},
            'summary': {'requiredHours': required, 'achievedHours': achieved, 'ksbs': codes},
            'topics': [], 'contractStatus': 'ready', 'selectedSubjectId': selected['id'] if selected else None,
            'coachName': spine['coach']['name'], 'reviews': sorted([r for r in spine['reviews'] if r.get('source') != 'student-support' and r.get('status') != 'cancelled' and review_day(r).startswith(month)], key=review_day),
            'assignments': [], 'lectures': lecture_rows}
