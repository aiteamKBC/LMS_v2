"""Module assignment totals using explicit profile or enrolment count readers."""


def attach_module_assignment_counts(
    modules,
    *,
    learner_profiles=False,
    clean_str,
    load_assignment_counts,
    load_status_counts
):
    """Set each module row's real `assignments` count, in one bulk pass.

    Every card shows this eagerly, so it has to be cheap for a whole list, not
    one query per module.

    Bulk Attendance opts into the canonical profile/plan-module membership
    rule shared by its scope rosters. Other callers retain the legacy counts.

    The legacy counting rule lives in `learner_assignments.bulk_assigned_learner_counts`
    and is still the reference implementation; what runs here is the jsonb
    rewrite of it, because the original reads every learner row whole -- 11 MB of
    Learning_plan to produce a few integers, measured at 47-84 s from outside the
    database's region, which is longer than the statement timeout, so the payload
    build this feeds never completed and never populated its cache.
    `manage.py compare_assignment_counts` runs both and diffs every module; it
    reports 268/268 identical.
    """
    def key_for(module):
        return clean_str(module.get('moduleCatalogueId')) or clean_str(module.get('catalogueId')) or clean_str(module.get('id'))

    module_ids = {key_for(module) for module in modules}
    if learner_profiles:
        status_counts = load_status_counts()
        module_ids.discard('')
        totals = status_counts('module', sorted(module_ids)) if module_ids else {}
        counts = {key: value['total'] if value is not None else 0 for key, value in totals.items()}
    else:
        bulk_assigned_learner_counts_sql = load_assignment_counts()
        counts = bulk_assigned_learner_counts_sql(module_ids)
    for module in modules:
        module['assignments'] = counts.get(key_for(module), 0)
