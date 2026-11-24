"""Pure membership decisions over materialized lineage and profile facts.

Used by the module membership read application. Callers supply the same facts as learner_facts:
``explicit`` means ANY normalized plan row exists (including sibling/null
module rows); ``module_ids`` contains direct module references. No JSON plans
or lifecycle filters are interpreted here.

Results map each requested key to a frozenset of input fact indexes; None
means the target was not found, while an empty set means no members. Facts
must be a re-iterable sequence. Duplicate profile IDs are not coalesced here.
Enrolment bridge projection (including omission of None/0) and registration
existence/display remain caller responsibilities, as in the existing policy.
Inputs are read only; neither mappings nor facts are mutated.
"""
from collections import defaultdict
import re


def _normalise(value):
    return re.sub(r'[^a-z0-9]+', '', str(value).lower())


def members_for_lineages(lineages, facts, programme_candidates):
    """Indexes into `facts` of the learners each found lineage holds.

    Shared by the module reader and legacy count/batch callers through their
    compatibility bindings; membership decisions have one implementation.
    A learner with saved plan rows is a member only if those rows carry the
    module; a learner with none inherits it from their placement, unless the
    module's roster is manual.
    """
    result, placements = {}, {}
    direct = defaultdict(set)
    explicit, ambiguous = set(), set()
    for index, fact in enumerate(facts):
        if fact.get('explicit'):
            explicit.add(index)
        if fact.get('ambiguous'):
            ambiguous.add(index)
        for module_id in fact.get('module_ids') or []:
            direct[module_id].add(index)
    for identifier, lineage in lineages.items():
        if not lineage.get('found'):
            result[identifier] = None
            continue
        programme_id = (str(lineage.get('programmeId') or '').strip()
                        or str(lineage.get('programmeName') or '').strip())
        candidates = {_normalise(value) for value in programme_candidates.get(programme_id, []) if _normalise(value)}
        module_id = str(lineage.get('moduleCatalogueId') or '')
        placement_key = (programme_id, frozenset(candidates), *(lineage.get(key) or '' for key in (
            'cohortId', 'cohortName', 'groupId', 'groupName')))
        if placement_key not in placements:
            placed = set()
            for index, fact in enumerate(facts):
                linked_programme = str(fact.get('programme_id') or '').strip()
                if not programme_id or linked_programme != programme_id:
                    continue
                if all(not lineage.get(scope_key) or str(fact.get(fact_key) or '') == str(lineage[scope_key])
                       for scope_key, fact_key in (('cohortId', 'cohort_id'), ('groupId', 'group_id'))):
                    placed.add(index)
            placements[placement_key] = placed
        placed = placements[placement_key]
        members = placed
        if module_id:
            if str(lineage.get('learnerRosterMode') or '').strip().lower() == 'manual':
                placed = set()
            # Ambiguous direct facts require inherited placement. This does
            # not parse or introduce legacy JSON plan fallback.
            members = (placed - explicit) | (direct[module_id] - ambiguous) | (direct[module_id] & placed)
        result[identifier] = frozenset(members)
    return result
