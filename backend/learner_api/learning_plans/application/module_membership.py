"""Coordinate membership reads over explicit callable dependencies, without infrastructure."""
from learner_api.learning_plans.domain import membership_policy


def module_member_enrolment_ids(module_id, *, read_lineages, read_facts,
                                programme_identifier, programme_candidates):
    """Return enrolment keys, preserving fact indexes and legacy bridge truthiness.

    The outer adapter owns the read scope/connection. Exceptions propagate unchanged.
    Numeric zero bridges are omitted; a string "0" remains a valid returned key.
    """
    lineages = read_lineages('module', [module_id])
    lineage = lineages.get(module_id) or {}
    if not lineage.get('found'):
        return None
    programme_id = programme_identifier(lineage)
    candidates = {programme_id: programme_candidates(programme_id)} if programme_id else {}
    facts = read_facts({str(lineage.get('moduleCatalogueId') or module_id)})
    members = membership_policy.members_for_lineages({module_id: lineage}, facts, candidates)[module_id] or frozenset()
    return {str(facts[index]['enrolment_id']) for index in members if facts[index].get('enrolment_id')}


def module_member_enrolment_ids_by_module(
    module_ids, *, curriculum_read_scope, placement_lineages, scope_programme_identifier,
    programme_identity_candidates, learner_facts, members_for_lineages,
):
    """{module id: enrolment ids of its members} for several modules in one read.

    Same rule as `module_member_enrolment_ids`. A module that is not found maps
    to an empty set, so callers can treat "unknown" and "nobody" alike.
    """
    module_ids = sorted({str(value).strip() for value in module_ids or () if str(value or '').strip()})
    result = {module_id: set() for module_id in module_ids}
    if not module_ids:
        return result
    with curriculum_read_scope(targeted_child_reads=True):
        found = {key: lineage for key, lineage in placement_lineages('module', module_ids).items()
                 if lineage.get('found')}
        if not found:
            return result
        programme_ids = {scope_programme_identifier(lineage) for lineage in found.values()}
        candidates = {identifier: programme_identity_candidates(identifier)
                      for identifier in programme_ids if identifier}
        facts = learner_facts({str(lineage.get('moduleCatalogueId') or key) for key, lineage in found.items()})
        members = members_for_lineages(found, facts, candidates)
    for module_id, indexes in members.items():
        if module_id in result:
            result[module_id] = {str(facts[index]['enrolment_id']) for index in indexes or ()
                                 if facts[index].get('enrolment_id')}
    return result
