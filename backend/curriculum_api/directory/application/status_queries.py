"""Status aggregation and canonical/alias placement query orchestration."""


from collections import Counter


def counts_for_lineages(lineages, facts, programme_candidates, *, members_for_lineages, status_key):
    """The same ID-first placement narrowing and explicit-module overrides as rosters."""
    facts = list(facts)
    result, totals = {}, {}
    for identifier, membership_key in members_for_lineages(lineages, facts, programme_candidates).items():
        if membership_key is None:
            result[identifier] = None
            continue
        if membership_key not in totals:
            counts, seen = Counter(), set()
            for index in sorted(membership_key):
                fact = facts[index]
                learner_id = str(fact['id'])
                if learner_id not in seen:
                    seen.add(learner_id)
                    counts[status_key(fact.get('status'))] += 1
            totals[membership_key] = {'total': sum(counts.values()), 'statuses': dict(sorted(counts.items()))}
        result[identifier] = totals[membership_key]
    return result


def status_counts(
    scope, identifiers, *, curriculum_read_scope, placement_lineages, scope_programme_identifier,
    programme_identity_candidates, learner_facts, counts_for_lineages,
):
    with curriculum_read_scope(targeted_child_reads=True):
        lineages = placement_lineages(scope, identifiers)
        programme_ids = {scope_programme_identifier(lineage) for lineage in lineages.values() if lineage.get('found')}
        candidates = {identifier: programme_identity_candidates(identifier) for identifier in programme_ids if identifier}
        module_ids = {str(lineage.get('moduleCatalogueId')) for lineage in lineages.values() if lineage.get('moduleCatalogueId')}
        if not any(lineage.get('found') for lineage in lineages.values()):
            return {identifier: None for identifier in identifiers}
        return counts_for_lineages(lineages, learner_facts(module_ids), candidates)


def placement_lineages(scope, identifiers, *, scope_placement_lineage, read_rows, clean_str):
    """Resolve canonical list IDs in one narrow read, without catalogue content.

    Legacy aliases retain the roster resolver. Normal list rows already carry
    the stored ID and need neither lesson/KSB summaries nor one query per row.
    """
    if scope == 'programme':
        return {identifier: scope_placement_lineage(scope, identifier) for identifier in identifiers}
    id_column, rows = read_rows(scope, identifiers)
    by_id = {clean_str(row.get(id_column)): row for row in rows}
    result = {}
    for identifier in identifiers:
        row = by_id.get(identifier)
        if row is None:
            result[identifier] = scope_placement_lineage(scope, identifier)
            continue
        lineage = {'found': True, 'programmeId': clean_str(row.get('programme_id')),
                   'programmeName': clean_str(row.get('programme_name'))}
        if scope in {'cohort', 'group', 'module'}:
            lineage.update(cohortId=clean_str(row.get('cohort_id')), cohortName=clean_str(row.get('cohort_name')))
        if scope in {'group', 'module'}:
            lineage.update(groupId=clean_str(row.get('group_id')), groupName=clean_str(row.get('group_name')))
        if scope == 'module':
            lineage.update(moduleCatalogueId=identifier,
                           learnerRosterMode=clean_str(row.get('learner_roster_mode') or 'inherited').lower())
        result[identifier] = lineage
    return result
