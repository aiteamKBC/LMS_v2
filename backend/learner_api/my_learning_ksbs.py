"""Narrow, read-only KSB point facts for the My Learning subject cards."""
from django.db import connections
from curriculum_api.learning_storage import read_sql
from curriculum_api.week_visibility import visible_child_sql

from . import canonical_learning as canonical
from .dashboard_metrics import point_codes, ratio, unavailable
from .ksb_exclusions import and_not_excluded
from .learner_detail import _component_ksb_items


# Card percentages consume codes, never the descriptions, classifications or
# weights carried by each authoring mapping. Preserve the three accepted code
# keys and their JSON types so the existing Python decoder keeps precedence,
# empty/invalid fallback and legacy encoded-string behavior unchanged.
INLINE_CODES_SQL = """CASE WHEN jsonb_typeof(c.ksb_mappings)='array' THEN
    (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'code',item->'code','ksbCode',item->'ksbCode','ksb_code',item->'ksb_code'))),'[]'::jsonb)
     FROM jsonb_array_elements(c.ksb_mappings) item WHERE jsonb_typeof(item)='object')
    ELSE c.ksb_mappings END"""


def read_card_ksb_mappings(owner, native, record_ids):
    """Read codes in batches within the card's existing assignment/lineage scope.

    Inline mappings take precedence over normalized mappings, as in learner-
    detail. Historical codes come only from this learner's exact progress rows.
    """
    components = [*native.get('components', []), *native.get('retiredQuizComponents', [])]
    facts = {c['componentId']: point_codes(c['ksbMappings']) for c in components
             if c.get('componentId') and 'ksbMappings' in c}
    component_ids = sorted({str(c['componentId']) for c in components if c.get('componentId')})
    connection = connections['enrolment']
    if component_ids:
        rows = canonical.query(read_sql(f'''
            WITH scoped_components AS MATERIALIZED (
                SELECT c.id,c.ksb_mappings FROM curriculum.components c
                WHERE c.id=ANY(%s) AND {visible_child_sql('c')}
            ), normalized AS (
                SELECT m.component_id,jsonb_agg(jsonb_build_object('code',m.ksb_code)) AS mappings
                FROM curriculum.ksb_mappings m
                JOIN scoped_components c ON c.id=m.component_id
                WHERE {visible_child_sql('m')} GROUP BY m.component_id
            )
            SELECT c.id AS component_id,{INLINE_CODES_SQL} AS inline_mappings,
                coalesce(n.mappings,'[]'::jsonb) AS normalized_mappings
            FROM scoped_components c LEFT JOIN normalized n ON n.component_id=c.id
        ''', connection), [component_ids])
        for row in rows:
            inline = _component_ksb_items(row['inline_mappings'])
            facts[row['component_id']] = point_codes(inline or row['normalized_mappings'])

    owned_ids = sorted({int(record_id) for ids in record_ids.values() for record_id in ids
                        if str(record_id).isdigit()})
    if owned_ids:
        rows = canonical.query('''
            SELECT p.id,coalesce(jsonb_agg(k.ksb_code)
                FILTER (WHERE k.ksb_code IS NOT NULL),'[]'::jsonb) AS codes
            FROM "Learner".learner_progress_entries p
            LEFT JOIN "Learner".learner_progress_ksbs k ON k.progress_id=p.id
            ''' + and_not_excluded('k', connection) + '''
            WHERE p.learner_id=%s AND p.deleted_at IS NULL AND p.id=ANY(%s)
            GROUP BY p.id
        ''', [owner['id'], owned_ids])
        by_record = {str(row['id']): point_codes(row['codes']) for row in rows}
        for (course, activity), ids in record_ids.items():
            codes = [by_record.get(str(record_id)) for record_id in ids]
            if codes and all(value is not None for value in codes):
                facts[f'catalogue:{course}:{activity}'] = set().union(*codes)
    return facts


def card_ksb_progress(items, mappings):
    """Use the plan's rule: one point per activity/code, not per activity.

    Repeated codes in one activity count once; another activity has its own
    points. Unknown mappings must not make a partial denominator look complete.
    """
    completed = total = missing = 0
    for item in items:
        component = item.get('component')
        if component is not None:
            ident = component.get('componentId')
            codes = mappings.get(ident) if ident else point_codes(component.get('ksbMappings') or [])
        else:
            codes = mappings.get(item['activity_id'])
        if codes is None:
            missing += 1
            continue
        total += len(codes)
        if item['completed']:
            completed += len(codes)
    if missing:
        return {**unavailable('activity_points_missing'), 'unmappedActivities': missing,
                'mappedCompleted': completed, 'mappedTotal': total}
    return ratio(completed, total)
