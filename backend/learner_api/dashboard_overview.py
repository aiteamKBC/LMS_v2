"""Read-only Overview facts. No legacy dashboard response or evidence expansion."""
from collections import Counter, defaultdict
import re

from django.db import connections
from django.utils import timezone

from . import canonical_learning as canonical, training_plan_dashboard as schedule
from .dashboard_monthly import day, review_day, display_subjects, display_date, MONTH
from .dashboard_training import display_modules, module_rows, percentage


def reviews_to_date(reviews, today):
    unique = {r.get('eventKey'): r for r in reviews
              if r.get('source') != 'student-support' and r.get('status') != 'cancelled'}
    due = [r for r in unique.values() if isinstance(r.get('targetDate') or r.get('date'), str)
           and re.match(r'^\d{4}-\d{2}-\d{2}', r.get('targetDate') or r.get('date'))
           and (r.get('targetDate') or r.get('date'))[:10] <= today]
    completed = sum(r.get('status') == 'completed' for r in due)
    return {'completed': completed, 'total': len(due),
            'percent': percentage(completed, len(due)) if due else None}


def hour_rows(records, targets, weekly, signed_months, current, *, log_summary=None, actual_rows=None):
    """The existing monthlyHours precedence, without document/history payloads."""
    from .dashboard_tabs import monthly_hours
    summary = log_summary if log_summary is not None else monthly_hours({}, records, targets,
        signed_months=signed_months, current_month=current)
    logs = {row['month']: {'completed': row['actual_hours'], 'submitted': row['not_accepted_hours']}
            for row in summary['months']}
    actual = defaultdict(float)
    for row in actual_rows if actual_rows is not None else schedule._canonical_actual_rows({}, records):
        actual[row['month']] += row['hours']
    result = []
    for month in sorted({*logs, *weekly, *actual}):
        if not isinstance(month, str) or not MONTH.fullmatch(month):
            continue
        native = weekly.get(month) or {}
        log = logs.get(month)
        target = max(0, targets[month]) if log is not None and month in targets else native.get('planned')
        completed = max(0, log['completed']) if log is not None else (
            native.get('actual', 0) if native.get('includesHistorical') else
            actual[month] if month in actual else native.get('actual', 0))
        result.append({'key': month, 'target': target,
                       'submitted': max(0, log['submitted']) if log is not None else native.get('submitted', 0),
                       'completed': completed})
    return result


def overview_subjects(learning):
    from .progress_rules import progress_counts_as_achieved
    native = learning['detail']
    subjects = display_subjects(learning, deduplicate=False)
    completed = {str(r['componentId']) for bucket in ('videoProgress', 'componentProgress')
                 for r in native.get(bucket, []) if r.get('componentId')
                 and progress_counts_as_achieved(r.get('kind'), r.get('passed'))}
    components = defaultdict(list)
    for i, component in enumerate([*native.get('components', []), *native.get('retiredQuizComponents', [])]):
        ref = component.get('componentId') or f"quiz:{(component.get('quizMeta') or {}).get('quizId') or str(component.get('week')) + ':' + str(i)}"
        components[ref].append(component)
    legacy_done = {}
    for activity in (learning['activity'] or {}).get('activities', []):
        legacy_done.setdefault((f"legacy:{activity['group_id']}", activity['activity_id']), bool(activity.get('completed')))
    def native_done(component):
        quiz = (component.get('quizMeta') or {}).get('quizId')
        return any(a.get('passed') is True and ((quiz is not None and str(a.get('quizId')) == str(quiz))
                   or (component.get('componentId') and a.get('componentId') == component['componentId']))
                   for a in native.get('quizAttempts', [])) if component.get('isQuiz') else str(component.get('componentId')) in completed
    for subject in subjects:
        module_id = subject.get('moduleId') or (learning['metadata']['builder_subjects'].get(subject['id']) or {}).get('id') \
            or (subject['id'][8:] if subject['id'].startswith('current:') else None)
        for activity in subject['activities']:
            activity['date'] = display_date(activity.get('date'))
            candidates = [c for ref in activity.get('nativeRefs', [activity['id']]) for c in components.get(ref, [])
                          if c.get('moduleId') == module_id and (module_id is not None or subject['id'] == f"unlinked:{c.get('module')}")]
            done = any(native_done(c) for c in candidates) if activity.get('nativeRefs') else native_done(candidates[0] if candidates else {})
            activity['completed'] = legacy_done.get((subject['id'], activity['id']), False) or done
    return subjects


def read_overview(source, kind, owner, profile, request):
    from .overview_week import read_week
    from .module_progress import aggregate_module_progress
    from .attendance_lectures import lecture_register
    from .attendance import _summarize_attendance
    from .dashboard_metrics import coach_otjh_target_to_date
    from .dashboard_tabs import learning_projection, monthly_hours

    records = canonical.entries_for(owner, training_summary=True)
    targets = canonical.targets_for(owner)
    with connections['enrolment'].cursor() as cur:
        ids, links = schedule.plan_module_ids(cur, source, owner)
        modules = module_rows(cur, ids)
        bounds = schedule._plan_session_rows(cur, str(source.email or '').strip().casefold(), ids,
            rail_only=True, navigation_only=True) if ids else []
    # Reuse narrow catalogue/native facts; no component descriptions or evidence.
    # Populate the existing request-scoped Builder dates cache before learning
    # membership reads it, preserving the old read order without planSubjects.
    weekly = read_week(source, monthly_hours_only=True)
    learning = learning_projection(source, owner, records)
    native = learning['detail']
    subjects = overview_subjects(learning)
    displayed = display_modules(subjects, modules, links, {r['module_id']: r for r in bounds})
    duplicates = Counter(a.get('dedupe') for s in subjects for a in s['activities'] if a.get('dedupe'))
    ledger = schedule._canonical_module_progress(records, list(modules.values()))
    actual_rows = schedule._canonical_actual_rows(owner, records)
    chart_modules = []
    for module in displayed:
        entry = ledger.get(str(module['moduleId']))
        historical = [r for r in actual_rows if module['id'].startswith('legacy:')
                      and r['groupId'] == module['id'][7:]]
        actual = entry['hours']['actual'] if entry else sum(r['hours'] for r in historical) if historical else None
        chart_modules.append({'id': module['id'], 'title': module['title'], 'start': module['start'], 'end': module['end'],
            'activities': {'completed': module['done'], 'total': module['activityCount']},
            'attendance': entry['attendance'] if entry else None,
            'hours': {'actual': actual, 'planned': module['detail'].get('total_otjh')},
            'ksb': {key: entry['ksb'][key] for key in ('completed', 'total')} if entry else None})
        duplicate_rows = [a for a in module['_subject']['activities'] if duplicates.get(a.get('dedupe'), 0) > 1]
        if duplicate_rows:
            # Only cross-subject duplicate identities leave the reader. Browser
            # locale ordering owns their winner, exactly as the existing UI did.
            bound = next((b for b in bounds if b['module_id'] == module['moduleId']), {})
            unique_dates = [a['date'] for a in module['_subject']['activities'] if a.get('date') and not a.get('needsReview')
                            and duplicates.get(a.get('dedupe'), 0) <= 1]
            from .dashboard_training import day_from_session
            unique_dates.extend(day_from_session(schedule.instant(bound[k])) for k in ('first_start', 'last_start') if bound.get(k))
            chart_modules[-1]['duplicates'] = [{'key': a['dedupe'], 'completed': bool(a['completed']),
                'date': (a.get('date') or '') if not a.get('needsReview') else ''} for a in duplicate_rows]
            chart_modules[-1]['dateBounds'] = {'startFixed': bool(day(module['detail'].get('start_date'))),
                'endFixed': bool(day(module['detail'].get('end_date'))),
                'first': min(unique_dates, default=''), 'last': max(unique_dates, default='')}
        if day(module['detail'].get('effectiveEndDate')) > module['end']:
            chart_modules[-1]['deliveryEnd'] = day(module['detail']['effectiveEndDate'])
    # Keep the canonical activity population used by programme module progress.
    # Reuse already-read native completion facts instead of a second ORM read.
    progress = [{**r, 'component_ref': r.get('componentId'),
                 'submitted_at': True if r.get('kind') == 'quiz_reading' else None}
                for bucket in ('videoProgress', 'componentProgress') for r in native.get(bucket, [])]
    metadata = learning['metadata']
    programme = aggregate_module_progress(learning['activity'], native, metadata['current_subjects'],
                                         progress, metadata['builder_subjects'])
    signed = [r['report_month'] for r in canonical.query('''SELECT DISTINCT report_month
        FROM "Learner".learner_monthly_signatures WHERE learner_id=%s AND review_confirmed IS TRUE''', [owner['id']])]
    today = timezone.localdate(timezone=schedule.UK).isoformat()
    log_summary = monthly_hours(owner, records, targets, signed_months=signed, current_month=today[:7])
    reviews = schedule.plan_reviews(source, profile, ('mcr', 'progress-review', 'student-support'), dates_only=True)
    # This authoritative reader intentionally stays separate from the display
    # ledger: its completion population is the established learner metrics contract.
    metrics = canonical.metrics_bulk([source.pk], learner_workspace=True).get(source.pk)
    if metrics is None:
        raise LookupError('Learner identity is unavailable.')
    if metrics['otjh'].get('planned') is None:
        # The plan's module ids were resolved above; do not re-read them.
        metrics['otjh']['planned'] = schedule.plan_planned_hours(source, owner, ids=ids)
    metrics['otjh']['targetToDate'] = coach_otjh_target_to_date(source, metrics['otjh'], owner=owner)
    attendance = _summarize_attendance(lecture_register(source), overview_only=True)
    payload_months = [*(m for m in targets if m <= today[:7]), *(r['month'] for r in actual_rows), *(review_day(r)[:7] for r in reviews)]
    end = max([day(owner.get('end_date')),
               *(m + '-28' for m in payload_months if MONTH.fullmatch(m))], default='')[:7]
    return {'metrics': {key: {field: metrics[key].get(field) for field in fields} for key, fields in {
                'ksb': ('completed', 'total', 'percent'),
                'otjh': ('actual', 'targetToDate')}.items()},
            'attendance': attendance, 'reviews': reviews_to_date(reviews, today),
            'modules': chart_modules, 'programme': [{key: r[key] for key in ('id', 'title', 'percent')} for r in programme],
            'hours': {'months': hour_rows(records, targets, weekly, signed, today[:7], log_summary=log_summary,
                                         actual_rows=actual_rows),
                      'planned': log_summary['training_plan_totals']['planned_hours'],
                      'end': end},
            'programmeStartDate': day(owner.get('start_date')) or None,
            'programmeEndDate': day(owner.get('end_date')) or None}
