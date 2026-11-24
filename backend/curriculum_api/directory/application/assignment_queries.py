"""Assignment read result assembly; writer guards and persistence remain at the existing boundary."""


def _payload(target, learners, *, _module_payload, _plan_row_counts, _row, _assigned):
    """The "Assign learners" directory, with membership from the normalized records.

    `assigned` and `moduleCount` use the same source as the module card and the
    module drawer, so a learner assigned in Module Builder shows as assigned here.
    """
    if target['scope'] == 'module':
        return _module_payload(target, learners)
    cache = {}
    module_counts = _plan_row_counts()
    rows = [_row(learner, _assigned(learner, target, cache), module_counts.get(str(learner.pk), 0))
            for learner in learners]
    return {
        'target': {**{key: target[key] for key in ('id', 'name', 'scope', 'programmeName')},
                   'moduleCount': len(target['moduleIds'])},
        'learners': rows,
        'totals': {'learnerCount': len(rows), 'assignedCount': sum(row['assigned'] for row in rows)},
    }


def _module_payload(target, learners, *, module_member_enrolment_ids, _plan_row_counts, _row):
    """Module drawer: assigned learners are exactly the ones the card counts.

    Membership comes from `"Learner".learners` and
    `learner_training_plan_modules` through the card's own rule
    (`learner_status_counts.module_member_enrolment_ids`), not from the legacy
    JSON plan, so the drawer and the "N learners" figure share one source.
    """

    members = module_member_enrolment_ids(target['id']) or set()
    module_counts = _plan_row_counts()
    rows = [_row(learner, str(learner.pk) in members, module_counts.get(str(learner.pk), 0))
            for learner in learners]
    return {
        'target': {**{key: target[key] for key in ('id', 'name', 'scope', 'programmeName')},
                   'moduleCount': len(target['moduleIds'])},
        'learners': rows,
        'totals': {'learnerCount': len(rows), 'assignedCount': sum(row['assigned'] for row in rows)},
    }


def _module_assigned_payload(target, *, module_member_enrolment_ids, read_sources, _row):
    """Compact membership read for the progress dialog, not its edit drawer."""

    members = module_member_enrolment_ids(target['id']) or set()
    learners = read_sources(members)
    rows = [_row(learner, True, 0) for learner in learners]
    return {
        'target': {**{key: target[key] for key in ('id', 'name', 'scope', 'programmeName')},
                   'moduleCount': len(target['moduleIds'])},
        'learners': rows,
        'totals': {'learnerCount': len(rows), 'assignedCount': len(rows)},
    }


def module_assignment_roster(module_id, placement_learners, lifecycle_status='', *, read_facts):
    """Include direct module membership without broadening programme/cohort rosters."""
    placed = {str(row['id']): row for row in placement_learners}
    profiles = read_facts(module_id, list(placed), lifecycle_status)
    result = dict(placed)
    for key, module_refs, read_payload in profiles:
        explicit = bool(module_refs)
        assigned = module_id in module_refs
        if explicit and not assigned:
            result.pop(key, None)
            continue
        if key in result or not assigned:
            continue
        result[key] = read_payload()
    return sorted(result.values(), key=lambda row: (row.get('name', '').casefold(), str(row['id'])))
