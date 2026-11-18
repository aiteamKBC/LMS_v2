"""Separate verified lecture attendance, activity requirements and earned hours.

Read-time metadata only. Historical progress, attendance and hour records are
never rewritten. Unmatched identities never enter this projection.
"""
from django.db import connections


def learning_state(credit, requirements):
    """Verified attendance completes the lecture; review work stays separate."""
    marking = requirements.get('marking') or ''
    reflection = requirements.get('reflection_required', False)
    validation = requirements.get('validation_required', False)
    evidence = requirements.get('evidence_required', False)
    status = 'completed'
    if credit.get('timeTrackingSource') == 'manual_attendance':
        # Preserve the established explicit staff completion override.
        pass
    elif (reflection or validation or evidence) and marking in {'rejected', 'referred', 'partial'}:
        status = 'changes-required'
    elif reflection and not requirements.get('reflection_submitted'):
        status = 'reflection-required'
    elif evidence and not requirements.get('evidence_uploaded'):
        status = 'evidence-required'
    elif validation and marking != 'accepted':
        status = 'awaiting-review' if marking == 'submitted_for_tutor_review' else 'submission-required'
    return {
        'attendance': 'present', 'attendedSeconds': credit.get('verifiedSeconds'),
        'attendedAt': credit.get('submittedAt'), 'status': 'completed',
        'requirementsStatus': status,
    }


def with_learning_requirements(source, credits, *, as_of=None):
    # Historical snapshots retain their existing completion rule. Current
    # authoring/review state cannot reconstruct what was required at that cutoff.
    if as_of is not None:
        return credits
    # Recording watches and legacy manual progress are not proof of attendance.
    attended = [credit for credit in credits if credit.get('componentType', 'live_session') == 'live_session' and (
        'verifiedSeconds' in credit or credit.get('timeTrackingSource') == 'manual_attendance')]
    if not attended:
        return credits
    from .live_session_progress import _credit_profile
    from .submission_visibility import ACTIVITY_MARKING_REFLECTION
    profile = _credit_profile(source)
    if profile is None:
        raise ValueError('Attendance learning requires a verified learner profile.')
    learner_id = profile.enrolment_id
    kind = 'commercial' if getattr(source, 'learner_type', '') == 'commercial' else 'apprenticeship'
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT c.id,c.module_catalogue_id,c.reflection_required,
            (coalesce(c.tutor_validation_required,false) OR coalesce(c.coach_validation_required,true)),
            c.workplace_evidence_required,submission.status,
            ((submission.status IN ('submitted_for_tutor_review','accepted')
              AND coalesce(btrim(submission.learning_reflection),'') NOT IN ('',%s))
             OR EXISTS(SELECT 1 FROM "Learner".learner_progress_entries p
                 WHERE p.learner_id=%s AND p.component_ref=c.id AND p.module_ref=c.module_catalogue_id
                   AND p.deleted_at IS NULL AND p.kind='component' AND p.passed IS NOT FALSE
                   AND NOT coalesce(p.reflection_skipped,false) AND coalesce(btrim(p.feedback),'')<>'')),
            EXISTS(SELECT 1 FROM "Learner".evidence_files e WHERE e.section_ref=c.id
                AND e.learner_kind=%s AND e.learner_id=%s AND e.status='approved')
            FROM curriculum.components c
            LEFT JOIN LATERAL (
                SELECT status,learning_reflection FROM "Learner".learning_reflection_submissions
                WHERE learner_id=%s AND learner_kind=%s AND activity_id=c.id
                  AND activity_type IN ('session','live_session','activity')
                  AND assignment_topic_id=''
                ORDER BY submitted_at DESC NULLS LAST,id DESC LIMIT 1
            ) submission ON true
            WHERE c.id=ANY(%s) AND lower(replace(c.type,'-','_'))='live_session'
              AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)''',
            [ACTIVITY_MARKING_REFLECTION, profile.pk, kind, str(learner_id), str(learner_id), kind,
             sorted({credit['componentId'] for credit in attended})])
        requirements = {(str(cid), str(mid)): dict(zip(
            ('reflection_required', 'validation_required', 'evidence_required', 'marking',
             'reflection_submitted', 'evidence_uploaded'), values))
            for cid, mid, *values in cursor.fetchall()}
    return [{**credit, 'liveSessionLearning': learning_state(credit, requirements[key])}
            if (key := (str(credit['componentId']), str(credit['moduleId']))) in requirements
            and credit in attended else credit for credit in credits]


def annotate_learning(components, credits):
    states = {(str(row['componentId']), str(row['moduleId'])): row['liveSessionLearning']
              for row in credits if row.get('liveSessionLearning')}
    return [{**component, 'liveSessionLearning': states[key],
             'attendanceCompleted': states[key]['status'] == 'completed'}
            if (key := (str(component.get('componentId')), str(component.get('moduleId')))) in states
            else component for component in components]
