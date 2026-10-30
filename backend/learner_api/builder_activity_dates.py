"""Read-only delivery dates for every component in assigned Builder modules."""

import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .subject_dates import activity_schedule, as_date
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql


def _dated_schedule(day, source):
    return {**activity_schedule('', day), 'date_source': source, 'date_needs_review': False}


def _component_schedule(component, week_title):
    settings = component['settings']
    # Teams timestamps name an instant; the course calendar uses UK dates.
    for key in ('sessionDateTimeUtc', 'teamsStartDateTimeUtc'):
        try:
            instant = datetime.fromisoformat(str(settings.get(key) or '').replace('Z', '+00:00'))
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=timezone.utc)
            return _dated_schedule(instant.astimezone(ZoneInfo('Europe/London')).date(), 'builder_session')
        except ValueError:
            pass
    day = as_date(settings.get('sessionDate'))
    if day:
        return _dated_schedule(day, 'builder_session')
    return activity_schedule(component['title'], section_title=week_title,
                             section_source='builder_section_title')


def _with_due_timing(schedule, settings):
    return {**schedule, 'due_timing': str(settings.get('dueTiming') or '')}


# Only the scheduling keys of component settings, which also contain large bodies.
COMPONENT_SCHEDULE_SETTINGS = '''jsonb_build_object(
            'sessionDate',c.settings_json->>'sessionDate',
            'sessionDateTimeUtc',c.settings_json->>'sessionDateTimeUtc',
            'teamsStartDateTimeUtc',c.settings_json->>'teamsStartDateTimeUtc',
            'teamsLiveSessionId',c.settings_json->>'teamsLiveSessionId',
            'teamsSessionNumber',c.settings_json->>'teamsSessionNumber',
            'extraTeamsMeetingUrl',c.settings_json->>'extraTeamsMeetingUrl',
            'dueTiming',c.settings_json->>'dueTiming')'''
# Module Builder's component order.
COMPONENT_ORDER = 'c.module_catalogue_id,c.display_order,c.id'


def delivery_week(module_id, week):
    """Readonly display placement; never replace activity/meeting/report dates."""
    primary = next((component for component in week['components']
                    if component['type'] == 'live-session'
                    and not component['settings'].get('extraTeamsMeetingUrl')), None)
    # Ignore title/upload dates here: the linked occurrence (or the existing
    # delivery plan when no occurrence is dated) owns the authored week.
    session = _component_schedule({**primary, 'title': ''}, '') if primary else {}
    start = as_date(session.get('date')) or as_date(week.get('sessionDate'))
    return {'id': week['id'], 'module_id': module_id,
            'start': start.isoformat() if start else None,
            'end': (start + timedelta(days=6)).isoformat() if start else None,
            'month': start.strftime('%Y-%m') if start else None}


def read_builder_activity_dates(cursor, module_ids, components=None, *, resolved_metadata=None):
    """Use the same full week plan as Module Builder, never upload timestamps.

    Read empty weeks too: they still consume delivery slots. Only select the
    scheduling keys from component settings, which also contain large bodies.

    ``components`` lets a caller that already read these modules' undeleted
    components pass them as ``(id, module_id, week_id, title, type, settings)``
    in ``COMPONENT_ORDER``, with settings from ``COMPONENT_SCHEDULE_SETTINGS``.
    """
    if not module_ids:
        return {}
    from curriculum_api.views import (
        apply_module_session_plan_to_weeks, cohort_selected_holidays_by_cohort,
    )

    if resolved_metadata is not None and all(key in resolved_metadata for key in
                                             ('schedule_modules', 'weeks', 'schedule_components')):
        wanted = set(map(str, module_ids))
        modules = {str(mid): dict(row) for mid, row in resolved_metadata['schedule_modules'].items()
                   if str(mid) in wanted}
        if not modules:
            return {}
        ids = list(modules)
        weeks = {(str(mid), str(wid)): {'id': str(wid), 'title': title, 'components': []}
                 for wid, mid, title, _, _ in sorted(resolved_metadata['weeks'],
                     key=lambda row: (row[1], row[4] is None, row[4], row[3] is None, row[3], row[0])) if str(mid) in modules}
        if components is None:
            components = resolved_metadata['schedule_components']
    else:
        module_fields = ('module_catalogue_id', 'start_date', 'sessions_number',
                         'session_week_day', 'session_start_time', 'session_end_time', 'cohort_id', 'session_overrides')
        cursor.execute('''SELECT module_catalogue_id,start_date,sessions_number,
            session_week_day,session_start_time,session_end_time,cohort_id,to_jsonb(m)->'session_overrides'
            FROM curriculum.modules m WHERE module_catalogue_id=ANY(%s)
            AND (deleted_at IS NULL OR COALESCE(deleted_via_parent, '') <> '')''', [module_ids])
        modules = {str(row[0]): dict(zip(module_fields, row)) for row in cursor.fetchall()}
        if not modules:
            return {}
        ids = list(modules)
        cursor.execute('''SELECT id,module_catalogue_id,title FROM curriculum.weeks
            WHERE module_catalogue_id=ANY(%s)
              AND ''' + visible_week_sql('weeks') + '''
            ORDER BY module_catalogue_id,display_order,week_number,id''', [ids])
        weeks = {(str(module_id), str(week_id)): {'id': str(week_id), 'title': title, 'components': []}
                 for week_id, module_id, title in cursor.fetchall()}
    if components is None:
        cursor.execute(f'''SELECT c.id,c.module_catalogue_id,c.week_id,c.title,c.type,
            {COMPONENT_SCHEDULE_SETTINGS}
            FROM curriculum.components c
            WHERE c.module_catalogue_id=ANY(%s)
              AND {visible_child_sql('c')}
            ORDER BY {COMPONENT_ORDER}''', [ids])
        components = cursor.fetchall()
    else:
        components = [row for row in components if str(row[1]) in modules]
    dates = {}
    for component_id, module_id, week_id, title, component_type, settings in components:
        week = weeks.get((str(module_id), str(week_id)))
        if week_id and week is None:
            continue  # A directly deleted week must not reappear via its children.
        if isinstance(settings, str):
            settings = json.loads(settings)
        component = {'id': str(component_id), 'title': title,
                     'type': str(component_type or '').replace('_', '-'),
                     'settings': settings if isinstance(settings, dict) else {}}
        dates[component['id']] = _with_due_timing(
            _component_schedule(component, week['title'] if week else ''),
            component['settings'],
        )
        if week is not None:
            week['components'].append(component)

    holidays = cohort_selected_holidays_by_cohort([module['cohort_id'] for module in modules.values()])
    for module_id, module in modules.items():
        module_weeks = [week for (parent_id, _), week in weeks.items() if parent_id == module_id]
        apply_module_session_plan_to_weeks(module, {}, module_weeks,
                                          holidays=holidays.get(str(module['cohort_id']), []))
        placements = [delivery_week(module_id, week) for week in module_weeks]
        starts = sorted({placement['start'] for week, placement in zip(module_weeks, placements)
                         if placement['start'] and (not week['components'] or any(
                             dates[component['id']]['date_source'] not in ('introduction', 'extra_activity')
                             for component in week['components']))})
        for placement in placements:
            following = next((start for start in starts if placement['start'] and start > placement['start']), None)
            if following and placement['end'] and following <= placement['end']:
                placement['end'] = (as_date(following) - timedelta(days=1)).isoformat()
        for week, placement in zip(module_weeks, placements):
            for component in week['components']:
                if component['type'] == 'live-session' and component['settings'].get('sessionRescheduled'):
                    dates[component['id']] = _component_schedule(component, week['title'])
                # Explicit dates, Introduction and ambiguous authored dates keep
                # their placement. Only genuinely undated content inherits a slot.
                elif dates[component['id']]['date_source'] == 'undated':
                    day = as_date(component['settings'].get('sessionDate')) or as_date(week.get('sessionDate'))
                    if day:
                        dates[component['id']] = _with_due_timing(
                            _dated_schedule(day, 'builder_week'), component['settings'],
                        )
                dates[component['id']] = {**dates[component['id']], 'delivery_week': placement}
    return dates
