"""Module membership for curriculum attendance decisions.

QR attendance suggestions, live-session alternative recovery and parallel
attendance registration all ask one question: is this learner assigned to this
module? They used to answer it from the legacy JSON plan on
``enrolment."Created_users"`` (``Learning_plan`` / ``Training_plan``). A learner
assigned through Module Builder lives in ``"Learner".learner_training_plan_modules``
and was invisible to them.

The answer now comes from the normalized records through the same rule as the
module card's learner count, the "Assign learners to module" drawer and the
scope roster (``learner_assignments.module_assignment_roster``):

* a learner with saved plan rows holds exactly the modules those rows name;
* a learner with no plan rows holds the modules their programme/cohort/group
  placement inherits, unless the module's roster is manual.

There is no fallback to the legacy JSON plan. A learner the normalized records
do not assign is not assigned.
"""


def assigned_module_ids_by_profile(profile_ids, module_ids):
    """{profile id: set of the given module ids that learner is assigned to}.

    Only ``module_ids`` are evaluated. Callers pass exactly the modules they are
    about to compare, so the answer is complete for those checks without
    resolving the whole catalogue. Unknown modules and unknown learners hold
    nothing.
    """
    from . import views
    from .learner_status_counts import learner_facts, members_for_lineages, placement_lineages

    profile_ids = {int(value) for value in profile_ids or () if str(value).strip().lstrip('-').isdigit()}
    module_ids = sorted({str(value).strip() for value in module_ids or () if str(value or '').strip()})
    result = {profile_id: set() for profile_id in profile_ids}
    if not profile_ids or not module_ids:
        return result
    with views.curriculum_read_scope(targeted_child_reads=True):
        lineages = placement_lineages('module', module_ids)
        found = {key: lineage for key, lineage in lineages.items() if lineage.get('found')}
        if not found:
            return result
        programme_ids = {views.scope_programme_identifier(lineage) for lineage in found.values()}
        candidates = {identifier: views.programme_identity_candidates(identifier)
                      for identifier in programme_ids if identifier}
        facts = learner_facts({str(lineage.get('moduleCatalogueId') or key) for key, lineage in found.items()},
                              profile_ids=profile_ids)
        members = members_for_lineages(found, facts, candidates)
    for module_id, indexes in members.items():
        for index in indexes or ():
            profile_id = int(facts[index]['id'])
            if profile_id in result:
                result[profile_id].add(module_id)
    return result


def module_roster(module_id):
    """Learners the normalized records assign to one module, with their profile.

    Same shape as the legacy ``learner_api.attendance_assignments.module_roster``
    (``learner_profile_id``, ``learner_email``, ``learner_name``) so staff
    attendance corrections keep their payload. Unknown modules have no roster.
    """
    from learner_api.models import LearnerProfile

    from . import views
    from .learner_status_counts import learner_facts, members_for_lineages, placement_lineages

    module_id = str(module_id or '').strip()
    if not module_id:
        return []
    with views.curriculum_read_scope(targeted_child_reads=True):
        lineage = placement_lineages('module', [module_id]).get(module_id) or {}
        if not lineage.get('found'):
            return []
        programme_id = views.scope_programme_identifier(lineage)
        candidates = {programme_id: views.programme_identity_candidates(programme_id)} if programme_id else {}
        facts = learner_facts({str(lineage.get('moduleCatalogueId') or module_id)})
        members = members_for_lineages({module_id: lineage}, facts, candidates).get(module_id) or ()
        profile_ids = {int(facts[index]['id']) for index in members if facts[index].get('id') is not None}
    if not profile_ids:
        return []
    profiles = LearnerProfile.objects.filter(id__in=profile_ids).values('id', 'email', 'full_name')
    return [{'learner_profile_id': profile['id'],
             'learner_email': str(profile['email'] or '').strip().casefold(),
             'learner_name': profile['full_name'] or ''} for profile in profiles]
