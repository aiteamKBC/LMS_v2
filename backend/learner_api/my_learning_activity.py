"""Teaching dates for owned My Learning cards, without exposing calendar data."""
from curriculum_api.catalogue_activity import catalogue_facts
from . import canonical_learning as canonical
from .module_placement_sql import current_module_sql


def card_teaching_activity(cards):
    identities = {card['id']: str(card.get('moduleId') or
        (card['id'][8:] if card['id'].startswith('current:') else '')) for card in cards}
    wanted = list(dict.fromkeys(value for value in identities.values() if value))
    if not wanted:
        return {}
    modules = []
    # Follow only the owned cards' explicitly shared delivery sources. The path
    # prevents cycles; no global catalogue or per-card structure reads. Current
    # visibility comes from status: the canonical modules table has no legacy
    # deletion or library flags.
    for offset in range(0, len(wanted), 400):
        modules.extend(canonical.query(f'''WITH RECURSIVE delivery AS (
            SELECT m.module_catalogue_id,m.start_date,m.source_type,m.teams_shared_source_module_id,
                ARRAY[m.module_catalogue_id]::text[] AS path
            FROM curriculum.modules m WHERE m.module_catalogue_id=ANY(%s)
              AND {current_module_sql('m')}
            UNION ALL
            SELECT m.module_catalogue_id,m.start_date,m.source_type,m.teams_shared_source_module_id,
                delivery.path || m.module_catalogue_id
            FROM delivery JOIN curriculum.modules m
              ON m.module_catalogue_id=delivery.teams_shared_source_module_id
            WHERE NOT m.module_catalogue_id=ANY(delivery.path) AND cardinality(delivery.path)<8
              AND {current_module_sql('m')}
        ) SELECT DISTINCT module_catalogue_id,start_date,source_type,teams_shared_source_module_id
          FROM delivery''', [wanted[offset:offset+400]]))
    ids = list(dict.fromkeys(str(row['module_catalogue_id']) for row in modules))
    series = []
    for offset in range(0, len(ids), 400):
        series.extend(canonical.query('''SELECT s.id,s.module_catalogue_id,s.status,s.start_datetime,s.duration_minutes,
            COUNT(o.id) AS occurrence_count,
            MAX(CASE WHEN lower(coalesce(o.status,'')) NOT IN ('cancelled','canceled')
                THEN o.scheduled_start END) AS last_live_start,
            MAX(CASE WHEN lower(coalesce(o.status,'')) NOT IN ('cancelled','canceled')
                THEN coalesce(o.scheduled_end,o.scheduled_start) END) AS last_live_end
            FROM curriculum.live_sessions s
            LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
            WHERE s.module_catalogue_id=ANY(%s)
              AND lower(trim(coalesce(s.provider,'')))='microsoft teams'
              AND (trim(coalesce(s.graph_event_id,''))<>'' OR trim(coalesce(s.online_meeting_id,''))<>''
                   OR trim(coalesce(s.join_url,''))<>'')
            GROUP BY s.id,s.module_catalogue_id,s.status,s.start_datetime,s.duration_minutes''', [ids[offset:offset+400]]))
    facts = catalogue_facts(modules, series)
    return {ref: {key: facts[mid][key] for key in ('startDate','lastLiveDate')}
            for ref, mid in identities.items() if mid in facts}
