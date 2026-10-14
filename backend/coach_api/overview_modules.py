"""Read-only learner-dashboard inputs for the coach's module progress card."""
from django.db import connections

from learner_api import canonical_learning
from learner_api.journal_sources import learner_journal_reads
from old_otjh.service import ServiceError


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
