"""Read-only component destinations for Student Home's scheduled lectures."""
from collections import defaultdict
from datetime import datetime, timezone
import json
from zoneinfo import ZoneInfo

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from .builder_activity_dates import COMPONENT_SCHEDULE_SETTINGS, read_builder_activity_dates


def _instant(value):
    try:
        parsed = datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
        return (parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed).astimezone(timezone.utc)
    except ValueError:
        return None


def upcoming_session_components(cursor, sessions):
    """Match within each assigned delivery module, preferring occurrence identity.

    A recurring series can have one activity per week. Series identity alone
    cannot choose between those activities; use its exact instant or UK date.
    Ambiguous matches never open an arbitrary component.
    """
    module_ids = sorted({row['module_id'] for row in sessions})
    if not module_ids:
        return {}
    cursor.execute(f'''SELECT c.id,c.module_catalogue_id,c.week_id,c.title,c.type,
        {COMPONENT_SCHEDULE_SETTINGS} || jsonb_build_object(
            'teamsOccurrenceId',c.settings_json->>'teamsOccurrenceId',
            'legacyOccurrenceId',c.settings_json #>> '{{legacySettings,teamsOccurrenceId}}')
        FROM curriculum.components c
        JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
        JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
        WHERE c.module_catalogue_id=ANY(%s)
          AND lower(regexp_replace(btrim(coalesce(c.type,'')), '[[:space:]-]+', '_', 'g'))='live_session'
          AND {visible_child_sql('c')} AND {visible_week_sql('w')}
          AND (m.deleted_at IS NULL OR COALESCE(m.deleted_via_parent,'')<>'')
        ORDER BY c.module_catalogue_id,c.display_order,c.id''', [module_ids])
    by_module = defaultdict(list)
    for component_id, module_id, _, _, _, settings in cursor.fetchall():
        settings = json.loads(settings) if isinstance(settings, str) else settings
        by_module[str(module_id)].append((str(component_id), settings if isinstance(settings, dict) else {}))
    if not by_module:
        return {}
    dates = None
    result = {}
    for session in sessions:
        module_id = str(session['module_id'])
        session_id = str(session['occurrence_id'] or session['session_id'])
        series_id = str(session['session_id'])
        candidates = by_module.get(module_id, [])
        linked = [c for c in candidates if str(c[1].get('teamsOccurrenceId') or c[1].get('legacyOccurrenceId')
                  or c[1].get('teamsLiveSessionId') or '') == session_id]
        if not linked:
            # An explicit link to another occurrence/series must not be reused by date.
            candidates = [c for c in candidates
                if not (c[1].get('teamsOccurrenceId') or c[1].get('legacyOccurrenceId'))
                and (not c[1].get('teamsLiveSessionId') or str(c[1]['teamsLiveSessionId']) in (series_id, session_id))]
            start = _instant(session['scheduled_start'] or session['start_datetime'])
            exact = [c for c in candidates if start is not None and any(
                _instant(c[1].get(key)) == start for key in ('sessionDateTimeUtc', 'teamsStartDateTimeUtc'))]
            if exact:
                linked = exact
            elif start is not None and candidates:
                if dates is None:
                    dates = read_builder_activity_dates(cursor, module_ids)
                day = start.astimezone(ZoneInfo('Europe/London')).date().isoformat()
                linked = [c for c in candidates if (dates.get(c[0]) or {}).get('date') == day
                          and not (dates.get(c[0]) or {}).get('date_needs_review')]
        if len(linked) == 1:
            result[(module_id, session_id)] = linked[0][0]
    return result
