"""Read-only learner-dashboard inputs for the coach's module progress card."""
from django.db import connections

from learner_api import canonical_learning
from learner_api.journal_sources import learner_journal_reads
from old_otjh.service import ServiceError
from old_otjh.repository import query
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql


def overview_owner(context):
    if context.source is None:
        raise LookupError('Learner enrolment is unavailable.')
    owner = canonical_learning.require_profile(context.source.pk)
    if owner['id'] != context.profile.pk or context.profile.enrolment_id != context.source.pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner


def read_overview_catalogue(context):
    """Assignment identities and dates only; no activities or progress evidence."""
    from learner_api.training_plan_dashboard import plan_module_ids, rows, date_only, number
    from learner_api.subject_content import clean_text
    from learner_api.student_activity_access import student_activity_available
    owner = overview_owner(context)
    courses = query('''SELECT c.source_course_ref,c.curriculum_module_ref,c.source_course_title
        FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id AND c.deleted_at IS NULL
        WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.source_system='old_lms'
          AND c.source_course_ref ~ '^[0-9]+$' ''', [owner['id']]) \
        if student_activity_available(context.source.aptem_id) else []
    with connections['enrolment'].cursor() as cur:
        ids, links = plan_module_ids(cur, context.source, owner)
        cur.execute('''SELECT module_catalogue_id AS id,title,start_date,end_date,total_otjh,sessions_number
            FROM curriculum.modules WHERE module_catalogue_id=ANY(%s) ORDER BY title,module_catalogue_id''', [ids])
        modules = [{**row, 'title': clean_text(row['title']), 'total_otjh': number(row['total_otjh']),
                    'start_date': date_only(row['start_date']), 'end_date': date_only(row['end_date'])}
                   for row in rows(cur)]
    historical = {f"legacy:{row['source_course_ref']}": row for row in courses}
    for key, row in historical.items():
        if row['curriculum_module_ref']:
            links[key] = {'id': row['curriculum_module_ref'], 'title': row['source_course_title']}
    suppressed = {row['curriculum_module_ref'] for row in courses if row['curriculum_module_ref']}
    allowed = {f'current:{mid}' for mid in ids if mid not in suppressed} | set(historical)
    return {'modules': modules, 'moduleLinks': links, 'allowed': allowed}


def project_overview_index(progress, catalogue):
    """Counts already needed by the programme chart also populate its picker."""
    return {
        'subjects': [{**{key: row[key] for key in ('id', 'title', 'completed', 'total')},
                      'source': 'legacy' if row['id'].startswith('legacy:') else 'current',
                      'moduleIds': [], 'dates': [], 'sessionTitles': []} for row in progress],
        'modules': [{key: row[key] for key in ('id', 'title', 'start_date', 'end_date', 'total_otjh')}
                    for row in catalogue['modules']],
        'moduleLinks': catalogue['moduleLinks'],
    }


def selected_record_ids(records, modules, module_id, *, legacy_id=None):
    """Match the dashboard's ID/title rule, keeping retry/dedup dependencies.

    Only narrow identity facts are read for other modules. Related retries,
    manual corrections and retained imports must still participate in the
    shared completion projection before the selected module is aggregated.
    """
    from learner_api.subject_content import clean_text
    by_id = {str(row['id']): row for row in modules}
    by_title = {}
    for row in modules:
        title = clean_text(row.get('title')).casefold()
        if title:
            by_title.setdefault(title, []).append(str(row['id']))
    selected = set()
    for row in records:
        direct = str(row.get('module_ref') or '').strip()
        matches = by_title.get(clean_text(row.get('module_title')).casefold(), [])
        resolved = direct if direct in by_id else matches[0] if len(matches) == 1 else None
        if (module_id is not None and resolved == module_id) or (legacy_id and direct == legacy_id):
            selected.add(row['id'])
    changed = True
    while changed:
        related = [row for row in records if row['id'] in selected]
        components = {row['component_ref'] for row in related if row.get('component_ref')}
        quizzes = {row['quiz_ref'] for row in related if row.get('quiz_ref')}
        refs = {str(row.get('original_source_ref') or '') for row in related}
        selected_refs = {f'progress:{ident}' for ident in selected}
        previous = len(selected)
        selected.update(row['id'] for row in records if
                        (row.get('component_ref') and row['component_ref'] in components)
                        or (row.get('quiz_ref') and row['quiz_ref'] in quizzes)
                        or f"progress:{row['id']}" in refs
                        or str(row.get('original_source_ref') or '') in selected_refs)
        changed = len(selected) != previous
    return sorted(selected)


def read_overview_module(context, subject_id):
    """Lazy module measures: never resolve programme-wide learning content."""
    from learner_api.training_plan_dashboard import (
        rows, is_educational_live_session_week, _canonical_module_progress, _canonical_actual_rows)
    owner = overview_owner(context)
    catalogue = read_overview_catalogue(context)
    if subject_id not in catalogue['allowed']:
        raise LookupError('Module not found in this learner plan.')
    mid = catalogue['moduleLinks'].get(subject_id, {}).get('id') \
        or (subject_id[8:] if subject_id.startswith('current:') else None)
    modules = catalogue['modules']
    selected = next((row for row in modules if row['id'] == mid), None)
    if selected is not None:
        with connections['enrolment'].cursor() as cur:
            cur.execute('''SELECT w.title,count(c.id) AS live_session_count
                FROM curriculum.weeks w LEFT JOIN curriculum.components c ON c.week_id=w.id
                  AND c.module_catalogue_id=w.module_catalogue_id
                  AND lower(replace(coalesce(c.type,''),'-','_'))='live_session'
                  AND ''' + visible_child_sql('c') + '''
                WHERE w.module_catalogue_id=%s
                  AND ''' + visible_week_sql('w') + '''
                GROUP BY w.id,w.title''', [mid])
            selected['educational_session_count'] = sum(row['live_session_count'] for row in rows(cur)
                if is_educational_live_session_week(row['title']))
    identities = query('''SELECT id,module_ref,module_title,component_ref,quiz_ref,
        source_payload->>'original_source_ref' AS original_source_ref
        FROM "Learner".learner_progress_entries WHERE learner_id=%s AND deleted_at IS NULL''', [owner['id']])
    legacy_id = subject_id[7:] if subject_id.startswith('legacy:') else None
    ids = selected_record_ids(identities, modules, mid, legacy_id=legacy_id)
    with learner_journal_reads():
        records = canonical_learning.entries_for(owner, entry_ids=ids) if ids else []
    # Pass the whole identity list to keep ambiguous equal titles ambiguous.
    progress = _canonical_module_progress(records, modules)
    actual = [row for row in _canonical_actual_rows(owner, records) if legacy_id and row['groupId'] == legacy_id]
    return {'id': subject_id, 'moduleProgress': {mid: progress[mid]} if mid in progress else {},
            'actual': actual, 'actualAvailable': True}


def project_module_overview(detail, activity, metadata, schedule):
    """Send only the facts used by buildUnifiedLearningSummary/buildPlanModules."""
    def only(row, fields):
        return {key: value for key, value in row.items() if key in fields}

    component_fields = (
        'module', 'moduleId', 'week', 'weekId', 'component', 'componentId', 'type',
        'isQuiz', 'quizMeta', 'sessionDate', 'sessionDateTimeUtc', 'ksbMappings', 'expectedOtjh',
    )
    progress_fields = ('kind', 'componentId', 'componentType', 'quizId', 'passed', 'grade', 'startedAt', 'submittedAt', 'timeTaken')
    activity_fields = (
        'activity_id', 'source_activity_id', 'catalogue_kind', 'group_id', 'group_name',
        'activity', 'category', 'completed', 'position', 'date', 'month', 'week_start',
        'week_end', 'date_source', 'date_needs_review', 'due_timing', 'section_title',
        'status', 'actual', 'planned', 'planned_hours_mapped', 'hours_mapped',
        'quiz_score', 'quiz_maximum_score', 'best_score_percent',
    )
    learning_detail = {'modules': detail.get('modules', [])}
    for field in ('components', 'retiredQuizComponents'):
        learning_detail[field] = [only(row, component_fields) for row in detail.get(field, [])]
    for field in ('quizAttempts', 'videoProgress', 'componentProgress'):
        learning_detail[field] = [only(row, progress_fields) for row in detail.get(field, [])]
    learning_activity = None if activity is None else {
        **only(activity, ('progress_basis', 'activity_sources')),
        'subjects': [only(row, ('id', 'name', 'module_id', 'catalogue_count', 'accepted_hours'))
                     for row in activity.get('subjects', [])],
        'activities': [only(row, activity_fields) for row in activity.get('activities', [])],
    }
    return {
        'learning': {'detail': learning_detail, 'activity': learning_activity,
                     'metadata': {'covers': {}, **only(metadata, (
                         'current_subjects', 'builder_subjects', 'activity_dates', 'activity_sources'))}},
        'modules': [only(row, ('id', 'title', 'start_date', 'end_date', 'total_otjh'))
                    for row in schedule['modules']],
        'sessions': [only(row, ('id', 'moduleId', 'title', 'start', 'end', 'minutes', 'status', 'attended'))
                     for row in schedule['sessions']],
        **{key: schedule[key] for key in ('moduleLinks', 'actual', 'actualAvailable')},
        **({'moduleProgress': schedule['moduleProgress']} if 'moduleProgress' in schedule else {}),
    }


def read_overview_modules(context):
    from learner_api.learner_detail import build_learner_detail
    from learner_api.student_activity import _effective_current_subjects, _builder_subject_metadata
    from learner_api.student_activity_data import summarize_activities
    from learner_api.builder_activity_dates import read_builder_activity_dates
    from learner_api.training_plan_dashboard import read_dashboard

    source = context.source
    owner = canonical_learning.require_profile(source.pk)
    if owner['id'] != context.profile.pk or context.profile.enrolment_id != source.pk:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    # Delegated learner HTTP views deliberately retain the coach perspective.
    # This card explicitly mirrors the learner, including their journal sources.
    with learner_journal_reads():
        detail = build_learner_detail(source, source.pk, compact=True, read_only=True, quiz_view=True)
        activity = canonical_learning.source_subjects(source.pk, summarize_activities, owner=owner) \
            if detail.get('studentActivityAvailable') else None
        refs = {f"legacy:{row['id']}" for row in (activity or {}).get('subjects', [])}
        refs.update(f"legacy:{row['group_id']}" for row in (activity or {}).get('activities', []))
        refs.update(f"current:{row['moduleId']}" for row in detail.get('components', []) if row.get('moduleId'))
        with connections['enrolment'].cursor() as cursor:
            current = _effective_current_subjects(cursor, source.pk)
            refs.update(f"current:{row['id']}" for row in current)
            _, builder = _builder_subject_metadata(cursor, sorted(refs))
            dates = read_builder_activity_dates(cursor, [row['id'] for row in current])
        source._canonical_profile = owner
        schedule = read_dashboard(source, section='overview')
    return project_module_overview(detail, activity, {
        'current_subjects': current, 'builder_subjects': builder, 'activity_dates': dates,
    }, schedule)
