"""Read-only status totals, sharing the curriculum roster's placement rules."""
import json
from collections import Counter, defaultdict

from django.db import DatabaseError


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


def learner_facts(module_ids):
    """One small row per permanent learner; no names, emails or plan bodies.

    Module membership is reduced inside Postgres. Only the rare JSON-string
    plans take the roster's Python parsing path, and only for those learners.
    """
    from . import views
    if views.connection.vendor != 'postgresql' or not views.learner_schema_table_exists('learners'):
        raise DatabaseError('Learner counts are unavailable.')
    columns = views.learner_schema_columns('learners')
    if not {'id', 'programme', 'cohort', 'group_name', 'lifecycle_status'} <= columns:
        raise DatabaseError('Learner count columns are unavailable.')
    identity = ', '.join(f"coalesce(p.{column}, '') AS {column}" if column in columns
                         else f"'' AS {column}" for column in ('programme_id', 'cohort_id', 'group_id'))
    plan_select = 'false AS explicit, ARRAY[]::text[] AS module_ids, false AS ambiguous'
    plan_join = ''
    params = []
    if module_ids:
        if 'learning_plan' not in columns:
            raise DatabaseError('Module membership is unavailable.')
        plan_select = "membership.explicit, membership.module_ids, jsonb_typeof(p.learning_plan::jsonb) = 'string' AS ambiguous"
        plan_join = """
            LEFT JOIN LATERAL (
                SELECT coalesce(bool_or(entry->>'assignmentMode' = 'explicit'), false) AS explicit,
                       coalesce(array_agg(DISTINCT entry->>'moduleId')
                           FILTER (WHERE entry->>'moduleId' = ANY(%s)), ARRAY[]::text[]) AS module_ids
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.learning_plan::jsonb) = 'array'
                     THEN p.learning_plan::jsonb ELSE '[]'::jsonb END) entry
            ) membership ON true
        """
        params.append(sorted(module_ids))
    programme_status = "nullif(btrim(p.programme_status), '')," if 'programme_status' in columns else ''
    with views.connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT p.id, p.programme, p.cohort, p.group_name, {identity},
                   coalesce(nullif(btrim(p.lifecycle_status), ''), {programme_status} 'unknown') AS status,
                   {plan_select}
            FROM "Learner"."learners" p {plan_join}
        """, params)
        names = [column[0] for column in cursor.description]
        rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    ambiguous = [row['id'] for row in rows if row['ambiguous']]
    if ambiguous:
        from learner_api.models import LearnerProfile
        plans = {profile.pk: profile.learning_plan for profile in LearnerProfile.objects.only('id', 'learning_plan').filter(pk__in=ambiguous)}
        for row in rows:
            if row['ambiguous']:
                row['explicit'], row['module_ids'] = plan_membership(plans.get(row['id']), module_ids)
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
    available = views.column_names(table)
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


def counts_for_lineages(lineages, facts, programme_candidates):
    """The same ID-first placement narrowing and explicit-module overrides as rosters."""
    from . import views
    result, placements, totals = {}, {}, {}
    facts = list(facts)
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
                if not (programme_id and candidates and (
                    linked_programme == programme_id if linked_programme else views.normalise(fact.get('programme')) in candidates
                )):
                    continue
                row = {'cohortId': fact.get('cohort_id'), 'cohort': fact.get('cohort'),
                       'groupId': fact.get('group_id'), 'group': fact.get('group_name')}
                if all(views.narrow_learners_to_placement(
                    [row], id_key, lineage.get(id_key) or '', name_key, lineage.get(lineage_name) or '')
                    for id_key, name_key, lineage_name in (
                        ('cohortId', 'cohort', 'cohortName'), ('groupId', 'group', 'groupName'))):
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
        membership_key = frozenset(members)
        if membership_key not in totals:
            counts, seen = Counter(), set()
            for index in sorted(members):
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
