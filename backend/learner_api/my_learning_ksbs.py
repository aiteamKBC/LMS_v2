"""Narrow, read-only KSB point facts for the My Learning subject cards."""
from django.db import connections
from curriculum_api.canonical_read_sql import component_ksb_codes_sql
from curriculum_api.catalogue.infrastructure.course_storage_reads import read_sql
from curriculum_api.week_visibility import visible_child_sql

from . import canonical_learning as canonical
from .dashboard_metrics import point_codes, ratio, unavailable
from .ksb_exclusions import and_not_excluded


def read_card_ksb_mappings(owner, native, record_ids):
    """Read codes in batches within the card's existing assignment/lineage scope.

    Mappings already present in the native projection take precedence over a
    normalized lookup. Historical codes come only from this learner's exact
    progress rows.
    """
    components = [*native.get('components', []), *native.get('retiredQuizComponents', [])]
    facts = {c['componentId']: point_codes(c['ksbMappings']) for c in components
             if c.get('componentId') and 'ksbMappings' in c}
    component_ids = sorted({str(c['componentId']) for c in components if c.get('componentId')})
    connection = connections['enrolment']
    if component_ids:
        rows = canonical.query(read_sql(f'''
            SELECT c.id AS component_id,
                {component_ksb_codes_sql('c')} AS normalized_mappings
            FROM curriculum.components c
            WHERE c.id=ANY(%s) AND {visible_child_sql('c')}
        ''', connection), [component_ids])
        for row in rows:
            facts.setdefault(row['component_id'], point_codes(row['normalized_mappings']))

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
