"""Standalone courses use the ordinary module/content/progress stores.

The source marker distinguishes newly authored courses from unplaced modules
and ordinary modules. Adopted legacy courses retain their existing live content.
"""

FREE_COURSE_SOURCE = 'free_course'
UNASSIGNED = {'', 'unassigned', 'unassigned programme'}


def retained_live_component_ids(stored):
    """Only already stored live components of an adopted course are allowed."""
    from .legacy_free_course_migration import adopted_id
    source_id = (stored or {}).get('source_id')
    if (not source_id or stored.get('source_type') != FREE_COURSE_SOURCE
            or stored.get('module_catalogue_id') != adopted_id('MOD', source_id, source_id)):
        return set()
    from . import views
    return {row['id'] for row in views.authoring_fetch_all(
        views.AUTHORING_COMPONENTS_TABLE,
        "module_catalogue_id = %s and type = 'live_session' and lower(btrim(coalesce(status, ''))) <> 'inactive'",
        [stored['module_catalogue_id']], columns=['id'],
    )}


def free_course_errors(payload, stored=None, *, allowed_live_ids=None):
    stored = stored or {}
    if stored and stored.get('source_type') != FREE_COURSE_SOURCE:
        return [{'path': 'isFreeCourse', 'message': 'Create a new free course; existing modules cannot be converted by editing their type.'}]
    errors = []
    if stored.get('source_id'):
        for key in ('sourceId', 'source_id'):
            if key in payload and payload[key] not in (None, '', stored['source_id']):
                errors.append({'path': key, 'message': 'The free course source identity cannot be changed.'})
    allowed_live_ids = retained_live_component_ids(stored) if allowed_live_ids is None else set(allowed_live_ids)
    metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
    for key in ('programmeId', 'programme_id', 'programme', 'programmeName', 'programme_name',
                'cohortId', 'cohort_id', 'cohort', 'cohortName', 'cohort_name',
                'groupId', 'group_id', 'group', 'groupName', 'group_name'):
        for values in (payload, metadata):
            value = str(values.get(key) or '').strip().lower()
            if value not in UNASSIGNED:
                errors.append({'path': key, 'message': 'Free courses are independent of programmes, cohorts and groups.'})
    for key in ('teamsSharedSourceModuleId', 'teams_shared_source_module_id', 'weeklySchedule',
                'weekDays', 'startTime', 'endTime', 'teamsLiveSessionId', 'teamsJoinUrl',
                'teamsMeetingUrl', 'teamsEventId'):
        if payload.get(key) or metadata.get(key):
            errors.append({'path': key, 'message': 'Free courses contain self-study content only; Teams and delivery schedules are unavailable.'})
    weeks = payload.get('weekStructure') if 'weekStructure' in payload else payload.get('weeks', [])
    for wi, week in enumerate(weeks if isinstance(weeks, list) else []):
        for ci, component in enumerate(week.get('components') or []):
            if (str(component.get('type') or '').lower().replace('_', '-').replace(' ', '-') == 'live-session'
                    and component.get('id') not in allowed_live_ids):
                errors.append({'path': f'weekStructure[{wi}].components[{ci}].type',
                               'message': 'Live sessions are unavailable in a self-study free course.'})
    return errors
