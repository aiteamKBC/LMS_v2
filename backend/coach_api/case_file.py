"""Semantic Case File transport; existing endpoints retain their source rules.

The route always accepts a LearnerProfile ID. Never accept an enrolment ID,
table name or arbitrary upstream URL from the caller.
"""
from copy import copy
from hashlib import sha256
import json
import logging
import re
from datetime import datetime, timezone
from math import floor
from time import perf_counter
from contextvars import copy_context
from concurrent.futures import ThreadPoolExecutor
from threading import Lock

from django.http import JsonResponse, QueryDict
from django.urls import resolve
from django.views.decorators.http import require_GET
from django.db.models.functions import Lower, Trim
from django.db import connections, close_old_connections
from old_otjh.repository import request_read_scope

from learner_api.models import LearnerProfile, EnrolmentUser
from learner_api import canonical_learning
from learner_api.projection_performance import measure_projection
from .auth import authenticated_coach_email, coach_access_required
from .selectors.otjh import SOURCE_WINDOW_FIELDS

log = logging.getLogger(__name__)


def case_file_ksb_detail(request, learner_id, code):
    delegated = copy(request)
    delegated.GET = request.GET.copy()
    delegated.GET['code'] = code
    return case_file_section(delegated, learner_id, section='ksb-detail')


def case_file_learning_module(request, learner_id, module_id, week_id=None):
    delegated = copy(request)
    delegated.GET = request.GET.copy()
    delegated.GET['moduleId'] = module_id
    if week_id is not None:
        delegated.GET['weekId'] = week_id
    return case_file_section(delegated, learner_id, section='learning-plan-module')

# Resource names are transport projections, never client-selected data sources.
RESOURCES = {
    'overview': {'detail', 'activity', 'covers', 'week', 'schedule', 'hours'},
    'weekly-learning': {'detail', 'week', 'schedule', 'hours'},
    'monthly-focus': {'focus'},
    'otjh-ksb': set(),
    'learning-plan': {'detail', 'activity', 'covers', 'week', 'schedule', 'hours', 'module'},
    'assignments': {'detail', 'covers', 'contract', 'statuses', 'marking', 'submission'},
    'attendance': {'summary', 'history'},
    'reviews': {'rows'},
    'enrolment-documents': {'rows'},
}

# These dates have distinct presentation roles (planned, booked, completed).
# Raw source status/answers, meeting artifacts and tenant identity are unused.
REVIEW_ROW_FIELDS = {
    'id', 'eventKey', 'learnerId', 'enrolmentId', 'type', 'source', 'sequence',
    'reviewTemplateId', 'reviewInstanceId', 'reviewTypeName', 'reviewTypeCode',
    'occurrenceNumber', 'title', 'date', 'targetDate', 'scheduledDate', 'scheduledTime',
    'year', 'month', 'dayOfMonth', 'startHour', 'endHour', 'timeLabel', 'isTimeEstimated',
    'durationMinutes', 'status', 'reviewCompletedAt', 'meetingProvider', 'notes',
    'reviewerName', 'ownerName', 'hasReviewForm', 'hasTranscript', 'hasAttendance',
}


PROFILE_FIELDS = ('id', 'enrolment_id', 'learner_type', 'full_name', 'email', 'aptem_id',
                  'programme', 'programme_status', 'group_name')
PROFILE_SOURCE_FIELDS = ('id', 'aptem_id', 'learner_type', 'username', 'email', 'programme',
                         'programme_status', 'group', 'employer', 'learner_start_date', 'learner_end_date')


class CaseFileContext:
    def __init__(self, request, learner_id, *, profile_only=False):
        self.request = request
        self.coach = authenticated_coach_email(request)
        self.learner_id = learner_id
        self.profile_only = profile_only
        fields = PROFILE_FIELDS if profile_only else (
            *PROFILE_FIELDS, 'programme_id', 'cohort', 'cohort_id', 'group_id', 'lifecycle_status',
            'coach_name', 'coach_email', 'coach_rag', 'start_date', 'end_date', 'gateway_review_date')
        self.profile = (LearnerProfile.objects
                        .annotate(coach_email_key=Lower(Trim('coach_email')))
                        .filter(id=learner_id, coach_email_key=self.coach)
                        .only(*fields).first())
        self.responses = {}
        self._source_loaded = False
        self._source = None
        self.stage_measurements = []
        self._stage_lock = Lock()

    @property
    def source(self):
        if not self._source_loaded:
            if self.profile and self.profile.enrolment_id:
                fields = set(PROFILE_SOURCE_FIELDS) if self.profile_only else {'id', 'aptem_id', 'learner_type', 'username', 'email', 'programme',
                                      'programme_status', 'cohort', 'group', 'employer', 'coach_name', 'coach_email',
                                      'start_date', 'learner_start_date', 'learner_end_date', 'end_date',
                                      'apprenticeship_end_date', 'practical_period_end_date'}
                narrow_learning = '/learning-plan' in self.request.path and not self.request.GET.get('resource')
                if not self.profile_only and not narrow_learning and self.request.path.rstrip('/').split('/')[-1] in {'weekly-learning', 'learning-plan', 'assignments'}:
                    from learner_api.training_plan_dashboard import TRAINING_PLAN_SOURCE_FIELDS
                    fields.update(TRAINING_PLAN_SOURCE_FIELDS)
                if not self.profile_only and self.request.path.rstrip('/').split('/')[-1] == 'weekly-learning':
                    fields = {'id', 'aptem_id', 'learner_type', 'username', 'email', 'programme', 'cohort', 'group'}
                if not self.profile_only and self.request.path.rstrip('/').split('/')[-1] == 'overview':
                    fields = {'id', 'aptem_id', 'learner_type', 'email', 'username', *SOURCE_WINDOW_FIELDS}
                query = EnrolmentUser.all_learners.filter(pk=self.profile.enrolment_id).only(*sorted(fields))
                weekly = not self.profile_only and (narrow_learning or self.request.path.rstrip('/').split('/')[-1] in {'weekly-learning', 'monthly-focus'})
                if weekly:
                    from .weekly_learning import assignment_projection
                    query = assignment_projection(query)
                self._source = query.first()
                if weekly and self._source is not None:
                    self._source.training_plan = self._source._weekly_training_plan
                    self._source.learning_plan = self._source._weekly_learning_plan
                if self._source is not None:
                    self._source._case_file_profile = self.profile
            self._source_loaded = True
        return self._source

    @property
    def kind(self):
        raw = getattr(self.source, 'learner_type', None) or self.profile.learner_type
        return 'commercial' if str(raw or '').strip().casefold() == 'commercial' else 'apprenticeship'

    def read(self, path, params=None):
        key = (path, tuple(sorted((params or {}).items())))
        if key not in self.responses:
            delegated = copy(self.request)
            delegated.path = delegated.path_info = path
            delegated._case_file_context = self
            delegated.GET = QueryDict('', mutable=True)
            delegated.GET.update(params or {})
            # Preserve server-authenticated view-as scope for legacy guards.
            selection = self.request.GET.get('viewAsCoach')
            if selection:
                delegated.GET['viewAsCoach'] = selection
            match = resolve(path)
            self.responses[key] = match.func(delegated, *match.args, **match.kwargs)
        return self.responses[key]

    def learner_read(self, resource):
        profile = self.profile
        if not profile.enrolment_id:
            return JsonResponse({'detail': 'Learner enrolment is unavailable.'}, status=404)
        identity = f'{self.kind}/{profile.enrolment_id}'
        routes = {
            'detail': (f'/learner_api/learner-detail/{identity}/', {'content': 'summary'}),
            'metrics': (f'/learner_api/metrics/{identity}/', {'view': 'learner-overview'}),
            'breakdown': (f'/learner_api/metrics/{identity}/', {'view': 'coach-ksb-breakdown'}),
            'activity': (f'/learner_api/student-activity/{identity}/', {}),
            'covers': (f'/learner_api/subject-covers/{profile.enrolment_id}/', {'refs': self.request.GET.get('refs', '')}),
            'week': (f'/learner_api/overview-week/{identity}/', {}),
            'schedule': (f'/learner_api/training-plan-dashboard/{identity}/', {'section': 'overview'}),
            'contract': (f'/learner_api/training-plan-dashboard/{identity}/', {'section': 'contract'}),
            'hours': (f'/learner_api/monthly-logs/{profile.enrolment_id}/', {'perspective': 'learner'}),
            'statuses': ('/learner_api/reflection/submissions/', {'learnerKind': self.kind, 'learnerId': str(profile.enrolment_id)}),
            'submission': ('/learner_api/reflection/submissions/', {'learnerKind': self.kind, 'learnerId': str(profile.enrolment_id), 'activityType': 'assignment', 'activityId': self.request.GET.get('activityId', '')}),
            'marking': ('/coach_api/coach/marking-queue', {'learner': str(profile.enrolment_id), 'page_size': '100'}),
            'summary': (f'/learner_api/attendance/{identity}/', {}),
            'history': (f'/learner_api/attendance/{identity}/', {}),
        }
        return self.read(*routes[resource])

    def payload(self, resource):
        response = self.learner_read(resource)
        if response.status_code != 200:
            raise ValueError(f'Unable to load {resource}.')
        return json.loads(response.content)

    def parallel(self, readers):
        # Resolve shared source identity before workers start. Each worker owns
        # its Django connections; ContextVars retain journal/source selection.
        self.source

        def run(name, read):
            close_old_connections()
            try:
                with measure_projection('case-file-stage', kind='coach', learner_id=self.learner_id,
                                        section=name) as measurement:
                    with measurement.stage(name):
                        return read()
            finally:
                with self._stage_lock:
                    self.stage_measurements.append(measurement)
                connections.close_all()

        with ThreadPoolExecutor(max_workers=min(4, len(readers))) as pool:
            pending = {name: pool.submit(copy_context().run, run, name, read) for name, read in readers.items()}
            return {name: future.result() for name, future in pending.items()}


def build_tab(context, section, month=None):
    """Read each source once and send only projections consumed by this tab."""
    if section == 'otjh-ksb':
        from .otjh_ksb import read_otjh_ksb
        return read_otjh_ksb(context)
    if section == 'monthly-focus':
        from .monthly_focus import read_monthly_focus
        return read_monthly_focus(context, month)
    if section == 'assignments':
        parts = context.parallel({**{resource: lambda resource=resource: context.payload(resource)
                                    for resource in ('covers', 'contract', 'statuses')},
                                  'detail': lambda: read_assignment_detail(context)})
        # Marking is already included in learner-detail's componentMarkingStatus.
        # Loading the queue a second time would duplicate the same source rows.
        return normalize_assignments(parts)
    readers = {resource: lambda resource=resource: context.payload(resource)
               for resource in ('schedule', 'week', 'hours')}
    if section in {'weekly-learning', 'learning-plan'}:
        readers['detail'] = lambda: read_plan_detail(context)
    if section == 'learning-plan':
        readers['covers'] = lambda: context.payload('covers')
        if context.profile.aptem_id:
            readers['activity'] = lambda: context.payload('activity')
    parts = context.parallel(readers)
    schedule = parts['schedule']
    if section != 'learning-plan':
        schedule['modules'] = [{key: value for key, value in module.items()
                            if key not in {'description', 'learning_outcomes'}}
                           for module in schedule.get('modules', [])]
    week = parts['week']
    hours = parts['hours']
    hours = {'learner': {'planned_end_date': hours.get('learner', {}).get('planned_end_date')},
             'training_plan_totals': hours.get('training_plan_totals'),
             'months': [{key: value for key, value in row.items() if key in {
                 'month', 'actual_hours', 'not_accepted_hours', 'training_plan_target'}}
                 for row in hours.get('months', [])]}
    result = {'schedule': schedule, 'week': week, 'hours': hours}
    if section in {'weekly-learning', 'learning-plan'}:
        result['detail'] = parts['detail']
    if section == 'learning-plan':
        result['covers'] = parts['covers']
        if 'activity' in parts:
            result['activity'] = parts['activity']
    return result


def read_assignment_detail(context, *, include_progress=True):
    """Reuse authored plan/marking rules without running detail's repair writes."""
    from learner_api.mappers import flatten_training_plan, get_training_plan, _component_marking_statuses
    from learner_api.learning_plan import effective_training_plan
    from learner_api.learner_detail import _resolve_from_master
    modules, weeks, components = flatten_training_plan(get_training_plan(context.source))
    modules, weeks, components = _resolve_from_master(modules, weeks, components,
                                           assigned_modules=effective_training_plan(context.source), compact=True)
    progress = [{'kind': row.kind, 'componentId': row.component_ref, 'passed': row.passed}
                for row in context.profile.progress_entries.only('kind', 'component_ref', 'passed', 'submitted_at')
                if row.kind in {'video', 'component'} or row.kind == 'quiz_reading' and row.submitted_at] if include_progress else []
    return {'modules': modules, 'week': weeks, 'components': components,
            'componentMarkingStatus': _component_marking_statuses(context.source, context.profile),
            'componentProgress': progress}


def read_plan_detail(context):
    """Read-only journey fields; preserve the existing progress projection."""
    detail = read_assignment_detail(context, include_progress=False)
    from learner_api.models import _serialise_quiz_ref
    fields = {'kind': 'kind', 'moduleId': 'module_ref', 'moduleTitle': 'module_title',
              'weekId': 'week_ref', 'weekTitle': 'week_title', 'componentId': 'component_ref',
              'componentTitle': 'component_title', 'componentType': 'component_type',
              'attempt': 'attempt', 'passed': 'passed', 'feedback': 'feedback', 'timeTaken': 'time_taken'}
    entries = context.profile.progress_entries.only(
        'id', 'learner_id', *fields.values(), 'quiz_ref', 'grade', 'achieved_score',
        'total_score', 'expected_otjh', 'started_at', 'submitted_at').prefetch_related('ksb_links')
    progress = []
    for entry in entries:
        if entry.kind == 'activity_event':
            continue
        row = {key: getattr(entry, field) for key, field in fields.items()}
        row['quizId'] = _serialise_quiz_ref(entry.quiz_ref)
        for key, field in {'grade': 'grade', 'achievedScore': 'achieved_score',
                           'totalScore': 'total_score', 'expectedOtjh': 'expected_otjh'}.items():
            value = getattr(entry, field)
            row[key] = float(value) if value is not None else None
        for key, field in {'startedAt': 'started_at', 'submittedAt': 'submitted_at'}.items():
            value = getattr(entry, field)
            row[key] = value.isoformat() if value else ''
        row['ksbs'] = [link.ksb_code for link in entry.ksb_links.all()]
        progress.append(row)
    detail.update({
        'id': str(context.profile.enrolment_id),
        'learnerStartDate': str(context.source.learner_start_date or ''),
        'learnerEndDate': str(context.source.learner_end_date or ''),
        'quizAttempts': [row for row in progress if row.get('kind', 'quiz') == 'quiz'],
        'videoProgress': [row for row in progress if row.get('kind') == 'video'],
        'componentProgress': [row for row in progress if row.get('kind') == 'component'
                              or row.get('kind') == 'quiz_reading' and row.get('submittedAt')],
    })
    return detail


def normalize_assignments(parts):
    from learner_api.progress_rules import progress_counts_as_achieved
    detail, metadata, contract = parts['detail'], parts['covers'], parts['contract']
    if not isinstance(parts['statuses'].get('statuses'), list):
        raise ValueError('Assignment statuses are unavailable.')
    statuses = {row['activityId']: row for row in parts['statuses']['statuses']
                if row.get('activityType') == 'assignment'}
    completed = {row['componentId'] for field in ('videoProgress', 'componentProgress')
                 for row in detail.get(field, []) if row.get('componentId')
                 and progress_counts_as_achieved(row.get('kind'), row.get('passed'))}
    groups, seen = {}, set()
    for component in detail.get('components', []):
        identity = component.get('componentId')
        if not identity or identity in seen or str(component.get('type') or '').strip().lower().replace('-', '_') != 'assignment':
            continue
        seen.add(identity)
        marking = detail.get('componentMarkingStatus', {}).get(identity)
        submitted = statuses.get(identity, {})
        status = submitted.get('status') or (marking or {}).get('status') or ('completed' if identity in completed else 'todo')
        count = submitted.get('submissionCount')
        if status in {'', 'todo', 'draft'} and not (isinstance(count, int) and count > 0):
            continue
        schedule = metadata.get('activity_dates', {}).get(identity)
        if schedule and schedule.get('date_source') not in {'original_created_at', 'source_date', 'undated'}:
            day = '' if schedule.get('date_needs_review') else (schedule.get('date') or '')[:10]
        else:
            day = (component.get('sessionDate') or '')[:10]
        try:
            day = datetime.strptime(day, '%Y-%m-%d').date().isoformat() if re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) else ''
        except ValueError:
            day = ''
        month = day[:7]
        row = {key: component.get(key) for key in ('component', 'module', 'week')}
        row.update(id=identity, status=status, date=day, marking=marking)
        if isinstance(count, int) and count >= 0:
            row['submissionCount'] = count
        groups.setdefault(month, []).append(row)
    return {'months': [{'month': month, 'label': contract.get('months', {}).get(month, {}).get('label', '').strip(),
                        'assignments': sorted(rows, key=lambda row: row['date'])}
                       for month, rows in sorted(groups.items(), key=lambda item: (bool(item[0]), item[0]), reverse=True)],
            'errors': []}


def merge_overview_subjects(subjects, schedule):
    """Match dashboardPlanSubjects' verified-link merging and availability rules."""
    groups = {}
    links = schedule.get('moduleLinks', {})
    for subject in subjects:
        module_id = subject['id'][8:] if subject['id'].startswith('current:') else None
        matches = [item for item in subjects if item.get('source') == 'legacy'
                   and links.get(item['id'], {}).get('id') == module_id] if module_id else []
        key = matches[0]['id'] if len(matches) == 1 else subject['id']
        previous = groups.get(key)
        row = {**subject, 'id': key, 'title': links.get(key, {}).get('title') or subject['title']}
        row['total'] = (previous or {}).get('total', 0) + subject.get('total', 0)
        row['completed'] = (previous or {}).get('completed', 0) + subject.get('completed', 0)
        row['dates'] = sorted(set((previous or {}).get('dates', []) + subject.get('dates', [])))
        if previous:
            old, new = previous.get('ksbProgress'), subject.get('ksbProgress')
            row['ksbProgress'] = {name: old[name] + new[name] for name in ('completed', 'total')} if old and new else None
            old, new = previous.get('directHours'), subject.get('directHours')
            row['directHours'] = old + new if old is not None and new is not None else None
        groups[key] = row
    return sorted(groups.values(), key=lambda row: (row['title'].casefold(), row['id']))


def overview_percent(done, total):
    """Match the Overview chart's two-decimal, capped percentage boundary."""
    if done is None or total is None:
        return None
    return min(100, floor(done / total * 10000 + 0.5) / 100) if total > 0 else 0


def read_overview_learning(context):
    """One canonical record read serves totals and recorded course counts."""
    owner = canonical_learning.require_profile(context.profile.enrolment_id)
    records = canonical_learning.entries_for(owner, overview_only=True)
    # Keep source_subjects' completion semantics separate from the workspace
    # enrichment used by metrics_bulk. Neither changes stored accepted hours.
    workspace = [{**record, 'completed': canonical_learning.counts_as_completed(record)}
                 for record in records]
    metrics = canonical_learning.metrics_from_records(workspace, {}, include_ksb_points=False)
    metrics['otjh']['planned'] = canonical_learning.programme_planned_hours(
        context.profile.enrolment_id, owner=owner)
    return metrics, None


def build_overview(context):
    """Final Overview numbers; no content, schedules or evidence hydration."""
    from learner_api.module_progress import canonical_module_progress, compact_module_progress
    parts = context.parallel({
        'progress': lambda: canonical_module_progress(context.source, context.profile),
        'learning': lambda: read_overview_learning(context),
        # Read the established attendance projection without catch-up writes.
        'attendance': lambda: context.payload('summary').get('attendance') or {},
    })
    metrics, _ = parts['learning']
    attendance = parts['attendance']
    rows = compact_module_progress(parts['progress'])
    # Reuse the established source/profile precedence and business-date pacing.
    from .selectors.otjh import learner_programme_window
    from .views import apply_otjh_to_date_metrics
    start, end = learner_programme_window(context.profile, context.source)
    hours = metrics['otjh']
    paced = apply_otjh_to_date_metrics({'otjhCompleted': hours['actual'],
        'otjhPlanned': hours['planned'], 'otjhProgrammeStartDate': start, 'plannedEndDate': end})
    target = paced['otjhTargetAsOfToday']
    return {'wholeProgrammeProgress': {
        'overall': {key: metrics['programme'][key] for key in ('completed', 'total', 'percent')},
        'attendance': {**{key: attendance.get(key) for key in ('present', 'sessions')},
                       'percent': overview_percent(attendance.get('present'), attendance.get('sessions'))},
        'otjh': {'actual': hours['actual'], 'targetToDate': target, 'planned': hours['planned'],
                 'percent': overview_percent(hours['actual'], target)},
        'ksb': {key: metrics['ksb'][key] for key in ('completed', 'total', 'percent')},
    }, 'programmeProgress': rows}


def project_attendance(response, *, history=False):
    if response.status_code != 200 or history:
        return response
    data = json.loads(response.content)
    attendance = data.get('attendance')
    if attendance:
        data['attendance'] = {key: value for key, value in attendance.items() if key != 'sessionHistory'}
    return JsonResponse(data)


def project_month_focus(response, month):
    if response.status_code != 200:
        return response
    data = json.loads(response.content)
    return JsonResponse({
        'month': month,
        'months': {month: data['months'][month]} if month in data.get('months', {}) else {},
        'actual': [row for row in data.get('actual', []) if row.get('month') == month],
        'actualAvailable': data.get('actualAvailable', False),
        'reviews': [row for row in data.get('reviews', [])
                    if str(row.get('scheduledDate') or row.get('targetDate') or row.get('date') or '').startswith(month)],
    })


def programme_window(context):
    from .selectors.otjh import learner_programme_window
    from .views import format_date
    start, end = learner_programme_window(context.profile, context.source)
    return {'startDate': format_date(start) if start else None,
            'plannedEndDate': format_date(end) if end else None}


def canonical_profile_metrics(context):
    data = canonical_learning.metrics_bulk([context.profile.enrolment_id], learner_workspace=True,
                                          include_ksb_points=False).get(context.profile.enrolment_id)
    if data is None:
        raise ValueError('Learner identity is unavailable.')
    return {**{key: data[key] for key in ('programme', 'otjh')},
            'ksb': {key: value for key, value in data['ksb'].items() if key not in {'codes', 'points'}}}


def build_header_summary(context, learner_id):
    def metrics():
        return canonical_profile_metrics(context)

    def read(name, reader):
        try:
            return reader(), None
        except Exception:
            log.exception('case_file_header_part_failed learner_id=%s section=%s', learner_id, name)
            return None, f'Unable to load {name}.'

    def next_session():
        from .views import _case_file_next_session
        event = _case_file_next_session(context.coach, context.profile)
        if event is None:
            return None
        fields = {'id', 'eventKey', 'learnerId', 'enrolmentId', 'source', 'type', 'title', 'module',
                  'date', 'scheduledDate', 'targetDate', 'scheduledTime', 'startHour', 'endHour',
                  'durationMinutes', 'timeLabel', 'status', 'tutor', 'group'}
        return {key: value for key, value in event.items() if key in fields}

    def reviews():
        from .views import _case_file_review_events
        events, _issues = _case_file_review_events(context.coach, context.profile)
        fields = {'learnerId', 'enrolmentId', 'status', 'scheduledDate', 'scheduledTime', 'date',
                  'targetDate', 'source', 'reviewTypeName', 'reviewTypeCode'}
        return [{key: value for key, value in event.items() if key in fields} for event in events]

    def attendance():
        value = context.payload('summary').get('attendance')
        return {key: value for key, value in value.items() if key != 'sessionHistory'} if value else None

    readers = {'metrics': metrics, 'attendance': attendance, 'nextSession': next_session, 'reviews': reviews}
    parts = context.parallel({name: lambda name=name, reader=reader: read(name, reader)
                              for name, reader in readers.items()})
    header = {name: value for name, (value, error) in parts.items()}
    header['errors'] = {name: error for name, (value, error) in parts.items() if error}
    if header.get('metrics'):
        header['metrics']['ksb'] = {key: value for key, value in header['metrics']['ksb'].items()
                                    if key not in {'codes', 'points'}}
    return header


@coach_access_required
@require_GET
def case_file_section(request, learner_id, section='profile'):
    started = perf_counter()
    response = None
    owner = authenticated_coach_email(request)
    # Stable pseudonymous identity keeps email addresses out of timing logs.
    coach_key = sha256(owner.encode()).hexdigest()[:16]
    context = None
    with request_read_scope(), measure_projection('case-file', kind='coach', learner_id=learner_id, section=section) as measurement:
        try:
            with measurement.stage('identity'):
                context = CaseFileContext(request, learner_id, profile_only=section == 'profile')
            if context.profile is not None:
                with measurement.stage('source'):
                    context.source
            if context.profile is None:
                response = JsonResponse({'detail': 'Learner not found.'}, status=404)
            elif section == 'profile':
                from .serializers.case_file_profile import serialize_case_file_profile
                response = JsonResponse(serialize_case_file_profile(context.profile, context.source))
            elif section == 'overview' and not request.GET.get('resource'):
                response = JsonResponse(build_overview(context))
            elif section in {'learning-plan', 'learning-plan-module'} and not request.GET.get('resource'):
                from .learning_plan_projection import read_learning_plan, read_journey
                try:
                    payload = read_journey(context, request.GET['moduleId'], request.GET.get('weekId')) if section == 'learning-plan-module' else read_learning_plan(context)
                    response = JsonResponse(payload)
                except LookupError as error:
                    response = JsonResponse({'detail': str(error)}, status=404)
            elif section == 'attendance' and request.GET.get('resource', 'history') == 'history':
                from .attendance_projection import AttendancePaginationError, read_attendance
                try:
                    response = JsonResponse(read_attendance(context, request.GET))
                except AttendancePaginationError:
                    response = JsonResponse({'detail': 'Invalid attendance pagination.'}, status=400)
            elif section == 'ksb-search':
                from .otjh_ksb import search_ksb_activities
                response = JsonResponse(search_ksb_activities(context.profile.id, request.GET.get('query', '')))
            elif section == 'weekly-learning':
                from .weekly_learning import read_weekly_learning
                if request.GET.get('resource'):
                    response = JsonResponse({'detail': 'Weekly Learning uses a compact week projection.'}, status=400)
                else:
                    try:
                        response = JsonResponse(read_weekly_learning(context, request.GET.get('week')))
                    except LookupError as error:
                        response = JsonResponse({'detail': str(error)}, status=404)
            elif section in {'weekly-learning', 'monthly-focus', 'otjh-ksb', 'learning-plan', 'assignments'} and not request.GET.get('resource'):
                month = request.GET.get('month', '')
                if section == 'monthly-focus' and not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
                    response = JsonResponse({'detail': 'A valid month (YYYY-MM) is required.'}, status=400)
                else:
                    response = JsonResponse(build_tab(context, section, month))
            elif section == 'attendance' and not request.GET.get('resource'):
                with measurement.stage('attendance'):
                    response = context.learner_read('history')
            elif section == 'header-summary':
                response = JsonResponse(build_header_summary(context, learner_id))
            elif section == 'ksb-detail':
                from learner_api.aptem_ksb_breakdown import read_learner_breakdown
                code = request.GET.get('code')
                if not code:
                    response = JsonResponse({'detail': 'A KSB code is required.'}, status=400)
                else:
                    payload = read_learner_breakdown(connections['enrolment'], context.profile.enrolment_id, code=code)
                    response = JsonResponse(payload) if payload['rows'] else JsonResponse({'detail': 'KSB not found.'}, status=404)
            elif section == 'next-session':
                response = context.read(f'/coach_api/coach/learners/{learner_id}/next-session')
            elif section == 'reviews':
                from .views import _case_file_review_events
                with measurement.stage('reviews'):
                    events, issues = _case_file_review_events(context.coach, context.profile)
                response = JsonResponse({'events': events, 'reviewGenerationIssues': issues})
                if response.status_code == 200:
                    payload = json.loads(response.content)
                    fields = ({'learnerId', 'enrolmentId', 'status', 'scheduledDate', 'scheduledTime', 'source', 'reviewTypeName', 'reviewTypeCode'}
                              if request.GET.get('resource') == 'summary' else REVIEW_ROW_FIELDS)
                    response = JsonResponse({'events': [
                        {key: value for key, value in event.items() if key in fields}
                        for event in payload.get('events', [])
                    ], 'reviewGenerationIssues': payload.get('reviewGenerationIssues', [])})
            elif section == 'enrolment-documents':
                with measurement.stage('documents'):
                    response = context.read(f'/coach_api/coach/learners/{learner_id}/enrolment-documents')
            elif section == 'learning-plan' and request.GET.get('resource') == 'module':
                response = context.learner_read('schedule')
                if response.status_code == 200:
                    payload = json.loads(response.content)
                    module = next((row for row in payload.get('modules', [])
                                   if str(row.get('id')) == request.GET.get('moduleId')), None)
                    response = JsonResponse({'module': module}) if module else JsonResponse({'detail': 'Module not found in this learner plan.'}, status=404)
            elif section == 'monthly-focus' and request.GET.get('resource', 'focus') == 'focus':
                month = request.GET.get('month', '')
                if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
                    response = JsonResponse({'detail': 'A valid month (YYYY-MM) is required.'}, status=400)
                else:
                    response = JsonResponse(build_tab(context, section, month))
            else:
                defaults = {'overview': 'detail', 'weekly-learning': 'week', 'monthly-focus': 'schedule',
                            'otjh-ksb': 'breakdown', 'learning-plan': 'schedule',
                            'assignments': 'marking', 'attendance': 'summary'}
                resource = request.GET.get('resource') or defaults.get(section, 'invalid')
                if resource not in RESOURCES.get(section, set()):
                    response = JsonResponse({'detail': 'Unknown Case File resource.'}, status=400)
                else:
                    response = context.learner_read(resource)
                    if section == 'attendance':
                        response = project_attendance(response, history=resource == 'history')
                    elif resource == 'schedule' and response.status_code == 200:
                        payload = json.loads(response.content)
                        payload['modules'] = [{key: value for key, value in module.items()
                                               if key not in {'description', 'learning_outcomes'}}
                                              for module in payload.get('modules', [])]
                        response = JsonResponse(payload)
                    elif resource == 'hours' and response.status_code == 200:
                        payload = json.loads(response.content)
                        fields = {'month', 'actual_hours', 'not_accepted_hours', 'training_plan_target'}
                        response = JsonResponse({
                            'learner': {'planned_end_date': payload.get('learner', {}).get('planned_end_date')},
                            'training_plan_totals': payload.get('training_plan_totals'),
                            'months': [{key: value for key, value in month.items() if key in fields}
                                       for month in payload.get('months', [])],
                        })
            response['Cache-Control'] = 'private, no-store'
            stages = {name: round(seconds * 1000, 2) for stage in [measurement, *(context.stage_measurements if context else [])]
                      for name, seconds in stage.stages.items()}
            response['Server-Timing'] = ', '.join(f'{name};dur={duration}' for name, duration in stages.items())
            response['X-DB-Query-Count'] = str(measurement.query_count + sum(stage.query_count for stage in (context.stage_measurements if context else [])))
            return response
        except Exception:
            log.exception('case_file_section_failed section=%s learner_id=%s', section, learner_id)
            response = JsonResponse({'detail': 'Unable to load this Case File section.'}, status=503)
            response['Cache-Control'] = 'private, no-store'
            return response
        finally:
            log.info('case_file_section %s', {
                'case_file_section': section, 'learner_id': learner_id, 'coach': coach_key,
                'duration_ms': round((perf_counter() - started) * 1000, 2),
                'query_count': measurement.query_count + sum(stage.query_count for stage in (context.stage_measurements if context else [])),
                'response_bytes': len(response.content) if response is not None else 0,
                'cache_hit': False,
            })
            for stage in [measurement, *(context.stage_measurements if context else [])]:
                for name, duration in stage.stages.items():
                    if duration > .5:
                        log.warning('case_file_slow_stage section=%s stage=%s duration_ms=%.2f', section, name, duration * 1000)
            if perf_counter() - started > 2:
                log.warning('case_file_slow_request section=%s duration_ms=%.2f', section, (perf_counter() - started) * 1000)
