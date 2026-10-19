"""Read-only identity and persistent Dashboard cards, independent of tab reads."""
from datetime import datetime, timezone
from urllib.parse import quote

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff
from old_otjh.service import ServiceError

from . import canonical_learning, journal_sources
from .apprenticeship_agreement import _group_dates
from .learner_detail import (SOURCE_MODELS, _first_session_unlocked, _iso_date,
                             DEFAULT_PROGRAMME_STATUS, programme_status, access_gate,
                             learning_access, student_activity_available, _s)
from .models import LearnerProfile
from .learning_plan import _effective_plan_ids
from .overview_week import upcoming_assignment_deadlines
from .projection_performance import measure_projection
from .subject_content import clean_text
from .training_plan_dashboard import (TRAINING_PLAN_SOURCE_FIELDS, TRAINING_PLAN_PROFILE_FIELDS,
    UK, plan_reviews, rows, current_coach, source_coach,
    assigned_group_coach, coach_phone, _active)

IDENTITY_FIELDS = ('username', 'employer', 'organization',
                   'onboarding_status', 'learner_end_date')
HEADER_SOURCE_FIELDS = tuple(field for field in TRAINING_PLAN_SOURCE_FIELDS
                             if field not in ('modules', 'weeks', 'components')) + IDENTITY_FIELDS


def read_header_source(model, pk, *, minimal=False):
    """Keep assignment semantics without transferring stored curriculum snapshots."""
    from django.db.models.expressions import RawSQL
    from .models import SafeJSONField
    query = model.all_learners.only(*dict.fromkeys(
        field for field in HEADER_SOURCE_FIELDS if field not in ('training_plan', 'learning_plan')))
    for field, column in (('training_plan', 'Training_plan'), ('learning_plan', 'Learning_plan')):
        query = query.annotate(**{f'_header_{field}': RawSQL(
            f'''CASE WHEN jsonb_typeof("{column}"::jsonb)='array' THEN
              (SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(item)='object'
                THEN jsonb_build_object('moduleId',item->'moduleId',
                  'assignmentMode',item->'assignmentMode') ELSE 'null'::jsonb END
                ORDER BY position), '[]'::jsonb)
               FROM jsonb_array_elements("{column}"::jsonb) WITH ORDINALITY AS entries(item,position))
              ELSE "{column}"::jsonb END''', [], output_field=SafeJSONField())})
    source = query.get(pk=pk)
    source.training_plan = source._header_training_plan
    source.learning_plan = source._header_learning_plan
    return source


def header_sessions(cur, ids, now):
    """Same shared-series and occurrence rules as plan_sessions; no attendance reads."""
    cur.execute('''WITH RECURSIVE owners(module_id,owner_id,depth) AS (
        SELECT m.module_catalogue_id,
          coalesce(nullif(btrim(m.teams_shared_source_module_id),''),m.module_catalogue_id),0
        FROM curriculum.modules m WHERE m.module_catalogue_id=ANY(%s)
        UNION ALL
        SELECT owners.module_id,btrim(m.teams_shared_source_module_id),owners.depth+1
        FROM owners JOIN curriculum.modules m ON m.module_catalogue_id=owners.owner_id
        WHERE coalesce(btrim(m.teams_shared_source_module_id),'')<>'' AND owners.depth<5
    ), delivery AS (SELECT DISTINCT ON (module_id) module_id,owner_id
        FROM owners ORDER BY module_id,depth DESC)
    SELECT coalesce(o.id,s.id) AS id,delivery.module_id AS "moduleId",m.title,
        coalesce(o.scheduled_start,s.start_datetime) AS start,
        coalesce(o.status,s.status,'scheduled') AS status
    FROM delivery JOIN curriculum.live_sessions s ON s.module_catalogue_id=delivery.owner_id
    JOIN curriculum.modules m ON m.module_catalogue_id=delivery.module_id
    LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
    WHERE lower(s.status) NOT IN ('cancelled','deleted','failed','superseded')
      AND (o.id IS NULL OR lower(o.status) NOT IN ('cancelled','deleted','failed','superseded'))
      AND (o.id IS NOT NULL OR coalesce(s.repeat_pattern,'') IN ('none',''))
      AND lower(btrim(coalesce(o.status,s.status,'scheduled'))) NOT IN
        ('cancelled','canceled','completed','deleted','failed','superseded','awaiting-signature')
      AND coalesce(o.scheduled_start,s.start_datetime)>=%s
    ORDER BY coalesce(o.scheduled_start,s.start_datetime),coalesce(o.id,s.id)::text LIMIT 1''',
        [ids, now.astimezone(timezone.utc).replace(tzinfo=None)])
    result = rows(cur)
    for row in result:
        start = row['start']
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        row['start'] = start.isoformat()
    return result


def header_identity(source, *, minimal=False):
    """Match learner-summary's status, dates and navigation gates without its second lookup."""
    status = programme_status(source) or DEFAULT_PROGRAMME_STATUS
    start, end, origin = _group_dates(source)
    source._resolved_group_dates = (start, end, origin)
    identity = {
        'id': str(source.id), 'name': _s(source.username), 'programme': _s(source.programme),
        'programmeStatus': status, 'onboardingStatus': _s(source.onboarding_status),
        'firstSessionUnlocked': _first_session_unlocked(source, status),
        'cohort': _s(source.cohort), 'employer': _s(source.employer),
        'organization': _s(source.organization),
        'learnerStartDate': _s(source.learner_start_date),
        'learnerEndDate': _s(source.learner_end_date),
        'accessGate': access_gate(source), 'learningAccess': learning_access(source),
        'studentActivityAvailable': student_activity_available(source.aptem_id),
    }
    if not minimal:
        identity.update(programmeStartDate=_iso_date(start),
            programmeEndDate=_iso_date(source.end_date or source.practical_period_end_date
                                      or source.apprenticeship_end_date or end))
    return identity


def lecture_href(cur, sessions, kind, pk, now):
    """Match the existing activity route using only live-session identities and authored dates."""
    upcoming = [s for s in sessions if _active(s['status']) and s.get('start')
                and datetime.fromisoformat(s['start']) >= now]
    if not upcoming:
        return None
    session = min(upcoming, key=lambda s: (s['start'], f"session-{s['id']}"))
    cur.execute('''SELECT c.id,m.title,coalesce(nullif(btrim(w.title),''),'Week ' || w.week_number),c.settings_json->>'sessionDate',
            c.settings_json->>'sessionDateTimeUtc'
        FROM curriculum.components c
        JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
        JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
        WHERE c.module_catalogue_id=%s
          AND lower(regexp_replace(btrim(coalesce(c.type,'')), '[[:space:]-]+', '_', 'g'))='live_session'
          AND (c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent, '') <> '')
          AND (m.deleted_at IS NULL OR COALESCE(m.deleted_via_parent, '') <> '')
          AND (w.deleted_at IS NULL OR COALESCE(w.deleted_via_parent, '') <> '')
        ORDER BY w.display_order,w.week_number,w.id,c.display_order,c.id''', [session['moduleId']])
    candidates = cur.fetchall()
    day = session['start'][:10]
    def same_day(value):
        if not value:
            return False
        if str(value)[:10] == day:
            return True
        try:
            instant = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            return instant.tzinfo is not None and instant.astimezone(timezone.utc).date().isoformat() == day
        except ValueError:
            return False
    match = next((row for row in candidates if any(same_day(value) for value in row[3:5])), None)
    if match is None and len(candidates) == 1:
        match = candidates[0]
    if match is None:
        return None
    component, module, week = match[:3]
    encode = lambda value: quote(str(value or ''), safe="~!*'()-_")
    return f'/learner/component/{kind}/{pk}/{encode(component)}?module={encode(module)}&week={encode(week)}'


def header_modules(modules, source):
    """Drop repeated placement labels; keep the existing browser date/locale selection.

    learnerHeaderPlan first selects exact placement, then compatible, then all
    assigned modules. Keeping dates on those candidates lets its original
    localeCompare and week/date rules run unchanged in the browser.
    """
    normal = lambda value: str(value or '').strip().lower()
    fields = [('programme_name', source.programme), ('cohort_name', source.cohort), ('group_name', source.group)]
    cleaned = [{**m, **{k: clean_text(m.get(k)) for k, _ in fields}, 'title': clean_text(m['title'])} for m in modules]
    compatible = [m for m in cleaned if all(not normal(v) or not normal(m.get(k)) or normal(m.get(k)) == normal(v) for k, v in fields)]
    exact = [m for m in compatible if all(not normal(v) or normal(m.get(k)) == normal(v) for k, v in fields)]
    candidates = [m for m in (exact or compatible) if m['title'].strip()] or [m for m in cleaned if m['title'].strip()]
    return [{key: (_iso_date(row[key]) if key in ('start_date', 'end_date') else row[key])
             for key in ('id', 'title', 'start_date', 'end_date')} for row in candidates]


def weekly_header_candidates(modules, source):
    """Eligible selectors, before placement matching; the browser owns collation."""
    return header_modules([row for row in modules if row.get('start_date')
        and max(int(row.get('sessions_number') or 0), int(row.get('week_count') or 0)) > 0], source)


def next_review(reviews, now):
    """Match homeData.upcomingReviewOrMcm, including booking precedence and ties."""
    today, clock = now.astimezone(UK).date().isoformat(), now.astimezone(UK).strftime('%H:%M')
    candidate = None
    for row in reviews:
        if row.get('source') not in ('mcr', 'progress-review') or not _active(row.get('status')):
            continue
        value = str(row.get('scheduledDate') or row.get('targetDate') or row.get('date') or '')
        time = str(row.get('scheduledTime') or '')[:5] if row.get('scheduledDate') else ''
        try:
            moment = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            continue
        if len(value) == 10:
            if value < today or value == today and time and time < clock:
                continue
            moment = moment.replace(tzinfo=timezone.utc)
        elif (moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment) < now:
            continue
        item = (moment.timestamp(), time or '23:59', f"review-action-{row['id']}", row)
        if candidate is None or item[:3] < candidate[:3]:
            candidate = item
    return [candidate[3]] if candidate else []


def header_profile(source, pk, *, identity_only=False):
    """Read the delivery profile once, retaining the canonical identity guard.

    The account side of the canonical join is the enrolment row already read by
    this request. Read two profiles to preserve the duplicate-bridge rejection;
    never use a same-number profile or an email fallback.
    """
    fields = ('id', 'email', 'aptem_id') if identity_only else TRAINING_PLAN_PROFILE_FIELDS
    profiles = list(LearnerProfile.objects.filter(enrolment_id=pk).only(*fields)[:2])
    if not profiles:
        raise ServiceError('The learner is not linked to the consolidated learning record.',
                           'ssot_identity_required', 409)
    if len(profiles) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    profile = profiles[0]
    owner = canonical_learning._validated_profile({
        'id': profile.id, 'email': profile.email, 'aptem_id': profile.aptem_id,
        'account_record_id': source.pk, 'account_email': source.email,
        'account_aptem_id': source.aptem_id,
    })
    return profile, owner


def dashboard_modules(source, owner, *, include_coach=True, include_week_counts=True):
    """Shared compact assignment/navigation read; no presentation histories."""
    ids = sorted(set(_effective_plan_ids(source, {})) |
                 set(canonical_learning.curriculum_module_ids_for(owner)))
    if not ids:
        return ids, []
    coach_column = ",coalesce(nullif(btrim(g.coach_name),''),m.coach_name) AS coach_name" if include_coach else ''
    coach_join = ' LEFT JOIN curriculum.groups g ON g.group_id=m.group_id' if include_coach else ''
    week_count = '''EXISTS (SELECT 1 FROM curriculum.weeks w WHERE w.module_catalogue_id=m.module_catalogue_id
             AND (w.deleted_at IS NULL OR COALESCE(w.deleted_via_parent,'')<>''))''' if include_week_counts else '0'
    with connections['enrolment'].cursor() as cur:
        cur.execute(f'''SELECT m.module_catalogue_id AS id,m.title,m.start_date,m.end_date,
            m.programme_name,m.cohort_name,m.group_name,m.sessions_number,
            {week_count} AS week_count{coach_column}
            FROM curriculum.modules m{coach_join}
            WHERE m.module_catalogue_id=ANY(%s) ORDER BY m.title''', [ids])
        return ids, rows(cur)


def build_dashboard_bootstrap(source, pk, *, include_pending_delivery=False):
    learner = header_identity(source)
    candidates = []
    if include_pending_delivery or learner['programmeStatus'].strip().casefold() not in ('fresh user', 'onboarding'):
        _, owner = header_profile(source, pk, identity_only=True)
        _, modules = dashboard_modules(source, owner, include_coach=False)
        candidates = weekly_header_candidates(modules, source)
    return {'learner': learner, 'weeklyCandidates': candidates}


@require_GET
@learner_self_or_staff(kwarg='pk')
@journal_sources.learner_journal_view
def dashboard_bootstrap(request, kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    try:
        with measure_projection('dashboard-bootstrap', kind=kind, learner_id=pk):
            source = read_header_source(model, pk)
            account = getattr(request, 'login_account', None)
            payload = build_dashboard_bootstrap(source, pk,
                include_pending_delivery=bool(account and account.role != 'learner'))
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except DatabaseError:
        return JsonResponse({'error': 'Could not verify your Dashboard access. Please try again.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Cookie'
    return response


def build_dashboard_header(source, kind, pk, now=None, include_pending_delivery=False, *, identity_required=True):
    now = now or datetime.now(timezone.utc)
    learner = header_identity(source) if identity_required else {
        'programmeStatus': programme_status(source) or DEFAULT_PROGRAMME_STATUS}
    # Redirected learners need their identity gates, not unavailable delivery tables.
    if not include_pending_delivery and learner['programmeStatus'].strip().casefold() in ('fresh user', 'onboarding'):
        return {'learner': learner, 'schedule': {'modules': [],
                'sessions': [], 'reviews': [], 'coach': {'name': ''}},
                'week': {'deadlines': []}, 'lectureHref': None, 'weeklyCandidates': []}
    profile, owner = header_profile(source, pk)
    ids, modules = dashboard_modules(source, owner, **({'include_week_counts': False} if not identity_required else {}))
    with connections['enrolment'].cursor() as cur:
        # plan_module_ids' metadata reader selected cover URLs only to recover
        # these same IDs. Header navigation needs only their native identities.
        sessions = []
        if ids:
            # The persistent header consumes one nearest lecture. Tabs own
            # their complete schedules, so never transfer the whole series.
            sessions = sorted((row for row in header_sessions(cur, ids, now) if _active(row['status'])),
                              key=lambda row: (row['start'], f"session-{row['id']}"))[:1]
        href = lecture_href(cur, sessions, kind, pk, now)
    contact = current_coach(source, profile, None)
    name, email = contact['coach_name'], contact['coach_email']
    if not name and not email and source_coach(source) is None:
        name = assigned_group_coach(source, modules)
    coach = {'name': name}
    if email:
        coach['email'] = email
        phone = coach_phone(email)
        if phone:
            coach['phone'] = phone
    reviews = [{key: row.get(key) for key in ('id', 'eventKey', 'title', 'source', 'status',
                'date', 'targetDate', 'scheduledDate', 'scheduledTime', 'meetingLink')}
               for row in next_review(plan_reviews(source, profile, ('mcr', 'progress-review'), header_only=True), now)]
    deadlines = [{**row, 'type': 'assignment'} for row in
                 upcoming_assignment_deadlines(source, profile, now.astimezone(UK).date(), header_only=True)[:1]]
    # Empty optional event values have no consumer; dates kept only once
    # where the selected review's fallback resolves to the same day.
    reviews = [{key: value for key, value in row.items() if value not in (None, '')
                and not (key == 'date' and value == row.get('targetDate'))} for row in reviews]
    # module_session_plan_for_count emits slots only for a dated module
    # with a positive stored/authored count. Filter before placement matching.
    weekly_candidates = weekly_header_candidates(modules, source) if identity_required else []
    modules = header_modules(modules, source)
    return {'learner': learner, 'schedule': {'modules': modules,
            'sessions': sessions, 'reviews': reviews, 'coach': coach},
            'week': {'deadlines': deadlines}, 'lectureHref': href, 'weeklyCandidates': weekly_candidates}


def selected_header_modules(candidates, today):
    """Resolve the visible list before projecting away scheduling inputs."""
    ordered = sorted(candidates, key=lambda m: (m.get('start_date') or '9999',
                                               m['title'].casefold(), str(m['id'])))
    active = [m for m in ordered if m.get('start_date') and m.get('end_date')
              and m['start_date'] <= today <= m['end_date']]
    if active:
        return ('Current modules' if len(active) > 1 else 'Current module'), active
    upcoming = next((m for m in ordered if (m.get('start_date') or '') > today), None)
    if upcoming:
        return 'Next module', [upcoming]
    past = sorted((m for m in ordered if m.get('end_date') and m['end_date'] < today),
                  key=lambda m: (m['end_date'], str(m['id'])), reverse=True)
    if past:
        latest = past[0]['end_date']
        return 'Last module', [min((m for m in past if m['end_date'] == latest), key=lambda m: str(m['id']))]
    return ('Modules' if len(ordered) > 1 else 'Module'), ordered


def build_minimal_header(source, kind, pk, now=None, include_pending_delivery=False):
    """One canonical read; never builds Bootstrap or Presentation responses."""
    now = now or datetime.now(timezone.utc)
    identity = header_identity(source, minimal=True)
    # These facts are consumed by the existing workspace/nav/redirect gates.
    payload = {'learner': identity, 'coach': {'name': ''}, 'modules': [], 'moduleLabel': 'Module',
               'initialWeeklyModuleId': None, 'nextAssignment': None,
               'nextLiveSession': None, 'nextReview': None}
    if not include_pending_delivery and identity['programmeStatus'].strip().casefold() in ('fresh user', 'onboarding'):
        return payload
    # Review cycle and coach contact share the canonical profile read.
    profile, owner = header_profile(source, pk)
    ids, modules = dashboard_modules(source, owner)
    contact = current_coach(source, profile, None)
    name, email = contact['coach_name'], contact['coach_email']
    if not name and not email and source_coach(source) is None:
        name = assigned_group_coach(source, modules)
    payload['coach'] = {'name': name}
    if email:
        payload['coach']['email'] = email
        phone = coach_phone(email)
        if phone:
            payload['coach']['phone'] = phone
    today = now.astimezone(UK).date().isoformat()
    label, visible = selected_header_modules(header_modules(modules, source), today)
    _, weekly = selected_header_modules(weekly_header_candidates(modules, source), today)
    payload.update(moduleLabel=label, modules=[{'id': str(m['id']), 'title': m['title']} for m in visible],
                   initialWeeklyModuleId=str(weekly[0]['id']) if weekly else None)
    with connections['enrolment'].cursor() as cur:
        sessions = header_sessions(cur, ids, now) if ids else []
        href = lecture_href(cur, sessions, kind, pk, now)
    if sessions:
        session = sessions[0]
        payload['nextLiveSession'] = {'title': session['title'], 'date': session['start'],
                                     'href': href or f'/learner/my-learning/{kind}/{pk}?subject=current:{quote(str(session["moduleId"]), safe="")}&week=current'}
    reviews = next_review(plan_reviews(source, profile, ('mcr', 'progress-review'), header_only=True), now)
    if reviews:
        review = reviews[0]
        payload['nextReview'] = {'sessionId': str(review['id']),
            'eventKey': str(review.get('eventKey') or review['id']), 'source': review['source'],
            'title': review.get('title') or ('Monthly Coaching Meeting' if review['source'] == 'mcr' else 'Progress Review'),
            'date': review.get('scheduledDate') or review.get('targetDate') or review.get('date'),
            **{key: review[key] for key in ('scheduledDate', 'scheduledTime', 'meetingLink') if review.get(key)}}
    assignments = upcoming_assignment_deadlines(source, profile, now.astimezone(UK).date(), header_only=True)
    if assignments:
        assignment = assignments[0]
        payload['nextAssignment'] = {'title': assignment['title'], 'date': assignment['date'],
                                     'href': '/learner/monthly-submission'}
    return payload


def compact_header(payload):
    """Opt-in V2: card-ready values without changing the legacy projection."""
    schedule = payload['schedule']
    session = next(iter(schedule['sessions']), None)
    review = next(iter(schedule['reviews']), None)
    deadline = next(iter(payload['week']['deadlines']), None)
    next_review = None
    if review:
        source = review['source']
        next_review = {
            'sessionId': review['id'],
            'eventKey': review.get('eventKey') or review['id'], 'source': source,
            'title': review.get('title') or ('Monthly Coaching Meeting' if source == 'mcr' else 'Progress Review'),
            'date': review.get('scheduledDate') or review.get('targetDate') or review.get('date'),
            **{key: review[key] for key in ('scheduledDate', 'scheduledTime', 'meetingLink') if review.get(key)},
        }
    return {
        'version': 2, 'learner': payload['learner'], 'coach': schedule['coach'],
        'modules': schedule['modules'], 'weeklyCandidates': payload.get('weeklyCandidates', []),
        'nextReview': next_review,
        'nextLiveSession': ({'id': session['id'], 'moduleId': session['moduleId'], 'title': session['title'],
            'date': session['start'], 'href': payload.get('lectureHref') or None} if session else None),
        'nextDeadline': ({'id': deadline['id'], 'title': deadline['title'], 'date': deadline['date'],
            'href': '/learner/monthly-submission'} if deadline else None),
    }


@require_GET
@learner_self_or_staff(kwarg='pk')
@journal_sources.learner_journal_view
def dashboard_header(request, kind, pk, presentation=False, minimal=False):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    try:
        with measure_projection('dashboard-header', kind=kind, learner_id=pk):
            source = read_header_source(model, pk, **({'minimal': True} if minimal else {}))
            account = getattr(request, 'login_account', None)
            builder = build_minimal_header if minimal else build_dashboard_header
            payload = builder(source, kind, pk,
                include_pending_delivery=bool(account and account.role != 'learner'),
                **({'identity_required': False} if presentation else {}))
            if not minimal and (presentation or request.headers.get('X-LMS-Header-Version') == '2'):
                payload = compact_header(payload)
            if presentation:
                # Bootstrap owns these fields; presentation never gates tabs.
                payload = {key: value for key, value in payload.items()
                           if key not in ('learner', 'weeklyCandidates', 'version')}
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except ServiceError as error:
        return JsonResponse({'error': str(error)}, status=error.status)
    except DatabaseError:
        return JsonResponse({'error': 'Could not load your Dashboard header. Please try again.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    response['Vary'] = 'Cookie' if presentation or minimal else 'X-LMS-Header-Version, Cookie'
    return response
