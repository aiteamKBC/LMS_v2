"""Read-only status totals, sharing the curriculum roster's placement rules."""
import json
from collections import Counter

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


def counts_for_lineages(lineages, facts, programme_candidates):
    """The same ID-first placement narrowing and explicit-module overrides as rosters."""
    from . import views
    result = {}
    for identifier, lineage in lineages.items():
        if not lineage.get('found'):
            result[identifier] = None
            continue
        programme_id = views.scope_programme_identifier(lineage)
        candidates = {views.normalise(value) for value in programme_candidates.get(programme_id, []) if views.normalise(value)}
        module_id = str(lineage.get('moduleCatalogueId') or '')
        counts = Counter()
        seen = set()
        for fact in facts:
            learner_id = str(fact['id'])
            if learner_id in seen:
                continue
            linked_programme = str(fact.get('programme_id') or '').strip()
            placed = bool(programme_id and candidates and (
                linked_programme == programme_id if linked_programme else views.normalise(fact.get('programme')) in candidates
            ))
            row = {'cohortId': fact.get('cohort_id'), 'cohort': fact.get('cohort'),
                   'groupId': fact.get('group_id'), 'group': fact.get('group_name')}
            for id_key, name_key, lineage_id, lineage_name in (
                ('cohortId', 'cohort', 'cohortId', 'cohortName'),
                ('groupId', 'group', 'groupId', 'groupName'),
            ):
                placed = placed and bool(views.narrow_learners_to_placement(
                    [row], id_key, lineage.get(lineage_id) or '', name_key, lineage.get(lineage_name) or ''))
            member = placed
            if module_id:
                if str(lineage.get('learnerRosterMode') or '').strip().lower() == 'manual':
                    placed = False
                # The roster's JSON containment query cannot select legacy
                # string plans outside placement; it parses them only for
                # learners already in the inherited roster.
                direct = module_id in (fact.get('module_ids') or []) and (placed or not fact.get('ambiguous'))
                member = direct or (placed and not fact.get('explicit'))
            if member:
                seen.add(learner_id)
                counts[status_key(fact.get('status'))] += 1
        result[identifier] = {'total': sum(counts.values()), 'statuses': dict(sorted(counts.items()))}
    return result


def status_counts(scope, identifiers):
    from . import views
    with views.curriculum_read_scope(targeted_child_reads=True):
        lineages = {identifier: views.scope_placement_lineage(scope, identifier) for identifier in identifiers}
        programme_ids = {views.scope_programme_identifier(lineage) for lineage in lineages.values() if lineage.get('found')}
        candidates = {identifier: views.programme_identity_candidates(identifier) for identifier in programme_ids if identifier}
        module_ids = {str(lineage.get('moduleCatalogueId')) for lineage in lineages.values() if lineage.get('moduleCatalogueId')}
        if not any(lineage.get('found') for lineage in lineages.values()):
            return {identifier: None for identifier in identifiers}
        return counts_for_lineages(lineages, learner_facts(module_ids), candidates)
