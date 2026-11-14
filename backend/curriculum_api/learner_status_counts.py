"""Read-only status totals, sharing the curriculum roster's placement rules."""
import json
from collections import Counter, defaultdict

from django.db import DatabaseError

from . import curriculum_names


def status_key(value):
    return ' '.join(str(value or 'unknown').strip().lower().replace('_', ' ').replace('-', ' ').split()) or 'unknown'


def plan_membership(value, wanted):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = []
    entries = [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []
    return (any(entry.get('assignmentMode') == 'explicit' for entry in entries),
            {str(entry.get('moduleId')) for entry in entries if str(entry.get('moduleId')) in wanted})


def learner_facts(module_ids, profile_ids=None):
    """One small row per learner, with placement labels but no personal names.

    Module membership is reduced inside Postgres. Only the rare JSON-string
    plans take the roster's Python parsing path, and only for those learners.
    ``profile_ids`` limits the read to those ``"Learner".learners`` ids (an
    attendance check asks about one learner, not the whole directory).
    """
    from . import views
    if views.connection.vendor != 'postgresql' or not views.learner_schema_table_exists('learners'):
        raise DatabaseError('Learner counts are unavailable.')
    columns = views.learner_schema_columns('learners')
    if not {'id', 'lifecycle_status'} <= columns:
        raise DatabaseError('Learner count columns are unavailable.')
    # "Learner".learners no longer stores placement names. Read them as
    # LearnerProfile.programme/.cohort/.group_name do: through the profile's own
    # placement ids and the curriculum tables. A missing id reads as no name.
    # Each target ID is a verified primary key: these LEFT JOINs preserve one
    # row per learner, including learners with absent placement relationships.
    name_selects, name_joins = [], []
    for alias, id_column, table, name, label in (
            ('placement_programme', 'programme_id', 'curriculum.programmes', 'name', 'programme'),
            ('placement_cohort', 'cohort_id', 'curriculum.cohorts', 'cohort_name', 'cohort'),
            ('placement_group', 'group_id', 'curriculum.groups', 'group_name', 'group_name')):
        if id_column in columns:
            name_selects.append(f'{alias}.{name} AS {label}')
            name_joins.append(f'LEFT JOIN {table} {alias} ON {alias}.{id_column} = p.{id_column}')
        else:
            name_selects.append(f'NULL AS {label}')
    identity = ', '.join(f"coalesce(p.{column}, '') AS {column}" if column in columns
                         else f"'' AS {column}" for column in ('programme_id', 'cohort_id', 'group_id'))
    identity += ', p.enrolment_id AS enrolment_id' if 'enrolment_id' in columns else ', NULL AS enrolment_id'
    plan_select = 'false AS explicit, ARRAY[]::text[] AS module_ids, false AS ambiguous'
    plan_join = ''
    params = []
    if module_ids:
        plan_select = "coalesce(membership.explicit,false) AS explicit, coalesce(membership.module_ids,ARRAY[]::text[]) AS module_ids, false AS ambiguous"
        plan_join = """
            LEFT JOIN LATERAL (
                SELECT count(*) > 0 AS explicit,
                       coalesce(array_agg(DISTINCT plan.curriculum_module_id)
                           FILTER (WHERE plan.curriculum_module_id = ANY(%s)), ARRAY[]::text[]) AS module_ids
                FROM "Learner".learner_training_plan_modules plan
                WHERE plan.learner_id=p.id
            ) membership ON true
        """
        params.append(sorted(module_ids))
    programme_status = "nullif(btrim(p.programme_status), '')," if 'programme_status' in columns else ''
    where = ''
    if profile_ids is not None:
        where = 'WHERE p.id = ANY(%s)'
        params.append(sorted({int(value) for value in profile_ids}))
    with views.connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT p.id, {', '.join(name_selects)}, {identity},
                   coalesce(nullif(btrim(p.lifecycle_status), ''), {programme_status} 'unknown') AS status,
                   {plan_select}
            FROM "Learner"."learners" p {' '.join(name_joins)} {plan_join}
            {where}
        """, params)
        names = [column[0] for column in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    return rows


def placement_lineages(scope, identifiers):
    """Resolve canonical list IDs in one narrow read, without catalogue content.

    Legacy aliases retain the roster resolver. Normal list rows already carry
    the stored ID and need neither lesson/KSB summaries nor one query per row.
    """
    from . import views
    if scope == 'programme':
        return {identifier: views.scope_placement_lineage(scope, identifier) for identifier in identifiers}
    table, id_column = {
        'module': (views.AUTHORING_MODULES_TABLE, 'module_catalogue_id'),
        'cohort': (views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id'),
        'group': (views.GROUPS_TABLE, 'group_id'),
    }[scope]
    columns = [id_column, 'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name']
    if scope == 'module':
        columns.append('learner_roster_mode')
    # Names are not columns: they come with the read, from the rows the ids name.
    available = set(views.column_names(table)) | set(curriculum_names.NAME_FIELDS.get(table, ()))
    columns = tuple(dict.fromkeys(column for column in columns if column in available))
    if id_column not in columns:
        raise DatabaseError('Curriculum placement is unavailable.')
    rows = views.authoring_fetch_all(
        table, f'{id_column} in ({", ".join(["%s"] * len(identifiers))})', identifiers,
        columns=columns, ensure_tables=False,
    )
    by_id = {views.clean_str(row.get(id_column)): row for row in rows}
    result = {}
    for identifier in identifiers:
        row = by_id.get(identifier)
        if row is None:
            result[identifier] = views.scope_placement_lineage(scope, identifier)
            continue
        lineage = {'found': True, 'programmeId': views.clean_str(row.get('programme_id')),
                   'programmeName': views.clean_str(row.get('programme_name'))}
        if scope in {'cohort', 'group', 'module'}:
            lineage.update(cohortId=views.clean_str(row.get('cohort_id')), cohortName=views.clean_str(row.get('cohort_name')))
        if scope in {'group', 'module'}:
            lineage.update(groupId=views.clean_str(row.get('group_id')), groupName=views.clean_str(row.get('group_name')))
        if scope == 'module':
            lineage.update(moduleCatalogueId=identifier,
                           learnerRosterMode=views.clean_str(row.get('learner_roster_mode') or 'inherited').lower())
        result[identifier] = lineage
    return result


def members_for_lineages(lineages, facts, programme_candidates):
    """Indexes into `facts` of the learners each found lineage holds.

    The single membership rule: the card's count and the "Assign learners to
    module" drawer's assigned list both come from here, so they cannot disagree.
    A learner with saved plan rows is a member only if those rows carry the
    module; a learner with none inherits it from their placement, unless the
    module's roster is manual.
    """
    from . import views
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
        programme_id = views.scope_programme_identifier(lineage)
        candidates = {views.normalise(value) for value in programme_candidates.get(programme_id, []) if views.normalise(value)}
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
            # String plans can contribute direct memberships only inside the
            # inherited placement, just as the authoritative roster permits.
            members = (placed - explicit) | (direct[module_id] - ambiguous) | (direct[module_id] & placed)
        result[identifier] = frozenset(members)
    return result


def counts_for_lineages(lineages, facts, programme_candidates):
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


def status_counts(scope, identifiers):
    from . import views
    with views.curriculum_read_scope(targeted_child_reads=True):
        lineages = placement_lineages(scope, identifiers)
        programme_ids = {views.scope_programme_identifier(lineage) for lineage in lineages.values() if lineage.get('found')}
        candidates = {identifier: views.programme_identity_candidates(identifier) for identifier in programme_ids if identifier}
        module_ids = {str(lineage.get('moduleCatalogueId')) for lineage in lineages.values() if lineage.get('moduleCatalogueId')}
        if not any(lineage.get('found') for lineage in lineages.values()):
            return {identifier: None for identifier in identifiers}
        return counts_for_lineages(lineages, learner_facts(module_ids), candidates)


def module_member_enrolment_ids(module_id):
    """Enrolment ids of the learners `status_counts('module', ...)` counts.

    None when the module is not found. Learners with no linked enrolment row
    cannot appear in the enrolment-keyed drawer and are left out.
    """
    from . import views
    with views.curriculum_read_scope(targeted_child_reads=True):
        lineages = placement_lineages('module', [module_id])
        lineage = lineages.get(module_id) or {}
        if not lineage.get('found'):
            return None
        programme_id = views.scope_programme_identifier(lineage)
        candidates = {programme_id: views.programme_identity_candidates(programme_id)} if programme_id else {}
        facts = learner_facts({str(lineage.get('moduleCatalogueId') or module_id)})
        members = members_for_lineages({module_id: lineage}, facts, candidates)[module_id] or frozenset()
        return {str(facts[index]['enrolment_id']) for index in members if facts[index].get('enrolment_id')}


def module_member_enrolment_ids_by_module(module_ids):
    """{module id: enrolment ids of its members} for several modules in one read.

    Same rule as `module_member_enrolment_ids`. A module that is not found maps
    to an empty set, so callers can treat "unknown" and "nobody" alike.
    """
    from . import views
    module_ids = sorted({str(value).strip() for value in module_ids or () if str(value or '').strip()})
    result = {module_id: set() for module_id in module_ids}
    if not module_ids:
        return result
    with views.curriculum_read_scope(targeted_child_reads=True):
        found = {key: lineage for key, lineage in placement_lineages('module', module_ids).items()
                 if lineage.get('found')}
        if not found:
            return result
        programme_ids = {views.scope_programme_identifier(lineage) for lineage in found.values()}
        candidates = {identifier: views.programme_identity_candidates(identifier)
                      for identifier in programme_ids if identifier}
        facts = learner_facts({str(lineage.get('moduleCatalogueId') or key) for key, lineage in found.items()})
        members = members_for_lineages(found, facts, candidates)
    for module_id, indexes in members.items():
        if module_id in result:
            result[module_id] = {str(facts[index]['enrolment_id']) for index in indexes or ()
                                 if facts[index].get('enrolment_id')}
    return result
