"""Normalized module rows and directory profile reads; no write capabilities."""


def _plan_row_counts(*, connection):
    """Saved plan rows per enrolment id: the drawers' "N modules" figure."""
    with connection.cursor() as cursor:
        cursor.execute("""
            SELECT l.enrolment_id, count(t.id)
            FROM "Learner".learners l
            JOIN "Learner".learner_training_plan_modules t ON t.learner_id = l.id
            WHERE l.enrolment_id IS NOT NULL
            GROUP BY l.enrolment_id
        """)
        return {str(enrolment_id): count for enrolment_id, count in cursor.fetchall()}


def module_roster_facts(module_id, placed_ids, lifecycle_status, *, LearnerProfile, RELATIONS, Q):
    profiles = LearnerProfile.objects.select_related(*RELATIONS).filter(
        Q(pk__in=placed_ids) | Q(plan_modules__curriculum_module_id=module_id)
    ).prefetch_related('plan_modules').distinct()
    if lifecycle_status:
        profiles = profiles.filter(lifecycle_status__iexact=lifecycle_status)
    return (_profile_fact(profile) for profile in profiles)


def _profile_fact(profile):
    module_refs = {
        str(module.module_ref) for module in profile.plan_modules.all()
        if module.module_ref
    }
    return str(profile.pk), module_refs, lambda: _profile_payload(profile)


def _profile_payload(profile):
    return {
        'id': profile.pk, 'sourceId': profile.pk, 'sourceKind': 'learner',
        'enrolmentId': profile.enrolment_id,
        'assignmentBasis': 'module',
        'name': profile.full_name or '', 'email': profile.email or '',
        'programme': profile.programme or '', 'programmeStatus': profile.programme_status or '',
        'cohort': profile.cohort or '', 'cohortId': profile.cohort_id or '',
        'group': profile.group_name or '', 'groupId': profile.group_id or '',
        'lifecycleStatus': profile.lifecycle_status or '',
        'coachName': profile.coach_name or '', 'coachEmail': profile.coach_email or '',
        **{out: float(getattr(profile, field, 0) or 0) for out, field in (
            ('completedHours', 'completed_hours'), ('plannedHours', 'planned_hours'),
            ('targetHours', 'target_hours'), ('progressHours', 'progress_hours'),
        )},
        'progressVariance': profile.progress_variance, 'otjhStatus': profile.otjh_status or '',
    }
