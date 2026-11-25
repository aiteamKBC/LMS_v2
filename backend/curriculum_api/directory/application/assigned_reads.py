"""Assigned directory projections and scope orchestration over explicit read capabilities."""


def assigned_learners_for_programme(
    programme_id, lifecycle_status='', *, strict=False, read_programme_profiles, clean_str,
    float_weight, normalise,
):
    canonical_rows = read_programme_profiles(programme_id, lifecycle_status, strict=strict)
    learners = [
        {
            'id': row.get('id'),
            'sourceId': row.get('id'),
            'sourceKind': 'learner',
            # Use this value for module assignment writes.  ``id`` remains the
            # profile identity used by progress/roster consumers.
            'enrolmentId': row.get('enrolment_id'),
            'name': row.get('full_name') or '',
            'email': row.get('email') or '',
            'programme': row.get('programme') or '',
            'programmeStatus': row.get('programme_status') or '',
            'cohort': row.get('cohort') or '',
            'group': row.get('group_name') or '',
            # Stable placement keys; missing keys never trigger name matching.
            'cohortId': clean_str(row.get('cohort_id')),
            'groupId': clean_str(row.get('group_id')),
            'lifecycleStatus': row.get('lifecycle_status') or '',
            'coachName': row.get('coach_name') or '',
            'coachEmail': row.get('coach_email') or '',
            'completedHours': float_weight(row.get('completed_hours') or 0),
            'plannedHours': float_weight(row.get('planned_hours') or 0),
            'targetHours': float_weight(row.get('target_hours') or 0),
            'progressHours': float_weight(row.get('progress_hours') or 0),
            'progressVariance': row.get('progress_variance'),
            'otjhStatus': row.get('otjh_status') or '',
        }
        for row in canonical_rows
    ]
    return sorted(learners, key=lambda row: (normalise(row.get('name') or row.get('email')), str(row.get('id'))))


def assigned_learners_for_scope(
    scope, identifier, lifecycle_status='', lineage=None, *, strict=False, scope_placement_lineage,
    scope_programme_identifier, clean_str, database_vendor, module_assignment_roster,
    assigned_learners_for_programme, narrow_learners_to_placement,
):
    """Narrow placement by IDs, then apply the existing direct/manual roster read."""
    lineage = lineage or scope_placement_lineage(scope, identifier)
    read_options = {'strict': True} if strict else {}
    programme_ident = scope_programme_identifier(lineage)
    module_id = clean_str(lineage.get('moduleCatalogueId')) if scope in {'module', 'week', 'component'} else ''
    if not programme_ident and not module_id:
        return []
    if module_id and database_vendor() == 'postgresql':
        if clean_str(lineage.get('learnerRosterMode')).lower() == 'manual':
            # A duplicated module remains attached to its group for curriculum
            # navigation, but its roster is opt-in.  Start from explicit module
            # plan entries only; never seed the group placement learners.
            learners = module_assignment_roster(module_id, [], lifecycle_status)
        else:
            learners = assigned_learners_for_programme(programme_ident, lifecycle_status, **read_options) if programme_ident else []
            learners = narrow_learners_to_placement(
                learners, 'cohortId', lineage.get('cohortId'), 'cohort', lineage.get('cohortName'),
            )
            learners = narrow_learners_to_placement(
                learners, 'groupId', lineage.get('groupId'), 'group', lineage.get('groupName'),
            )
            learners = module_assignment_roster(module_id, learners, lifecycle_status)
    else:
        learners = assigned_learners_for_programme(programme_ident, lifecycle_status, **read_options) if programme_ident else []
        learners = narrow_learners_to_placement(
            learners, 'cohortId', lineage.get('cohortId'), 'cohort', lineage.get('cohortName'),
        )
        learners = narrow_learners_to_placement(
            learners, 'groupId', lineage.get('groupId'), 'group', lineage.get('groupName'),
        )
    return learners
