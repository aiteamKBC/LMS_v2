"""Close Live authoring and booking without moving the curriculum's weeks."""
from datetime import date, timedelta


def _day(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or '')[:10])
    except ValueError:
        return None


def with_closed_weeks(plan, holidays_by_date, start, end=None, first_weekday=0):
    """Keep the legacy slot grid/identities; expose whole-week Live closures."""
    study_weeks = plan.get('weeks')
    if isinstance(study_weeks, list):
        return {**plan, 'closedWeeks': [week for week in study_weeks if week.get('holidays')]}
    sessions = plan.get('sessions') or []
    if not sessions or not holidays_by_date:
        return {**plan, 'closedWeeks': []}
    first = sessions[0]
    first_date = _day(first.get('slotDate') or first.get('date'))
    if not first_date:
        return {**plan, 'closedWeeks': []}
    anchor = first_date - timedelta(days=(first_date.weekday() - first_weekday) % 7)
    anchor -= timedelta(weeks=max(0, int(first.get('weekNumber') or 1) - 1))
    lower, upper = _day(start), _day(end)
    closed = []
    for number in sorted({int(item.get('weekNumber') or 1) for item in sessions}):
        begin = anchor + timedelta(weeks=number - 1)
        finish = begin + timedelta(days=6)
        begin = max(begin, lower) if lower else begin
        finish = min(finish, upper) if upper else finish
        holidays = []
        for value, entries in holidays_by_date.items():
            day = _day(value)
            if day and begin <= day <= finish:
                for entry in entries:
                    if entry not in holidays:
                        holidays.append(entry)
        if holidays:
            closed.append({'weekNumber': number, 'startDate': begin.isoformat(),
                           'endDate': finish.isoformat(), 'holidays': holidays, 'holidayWeek': True})
    return {**plan, 'closedWeeks': closed}


def closed_date_reason(plan, value):
    day = _day(value)
    if day:
        for week in plan.get('closedWeeks') or []:
            if _day(week['startDate']) <= day <= _day(week['endDate']):
                labels = ', '.join(str(item.get('label') or item.get('title') or 'Holiday')
                                   for item in week.get('holidays') or [])
                return f'No live sessions in this holiday week ({labels}). Reading and quizzes remain available.'
    return ''


def module_closure_plan(module, weeks=None):
    """Use the same effective group pattern and selected country holidays."""
    if not module.get('start_date'):
        return {'sessions': [], 'closedWeeks': []}
    from . import views as v
    group = v.fetch_group_row(module.get('group_id')) if module.get('group_id') else None
    delivery = v.module_delivery_row(module, group)
    count = max(len(weeks or []), v.module_stored_week_count(module))
    return v.module_session_plan_for_weeks(delivery, count)


def closed_week_ids(module, weeks, plan):
    numbers = {week['weekNumber'] for week in plan.get('closedWeeks') or []}
    if not numbers:
        return set()
    from . import views as v
    from .week_plan_alignment import week_plan_offset
    sessions = plan.get('sessions') or []
    if v.module_structure_uses_session_rows(weeks, v.module_stored_session_count(module),
                                            v.delivery_days_per_week(module)):
        return {str(week.get('id') or '') for index, week in enumerate(weeks)
                if index < len(sessions) and sessions[index].get('weekNumber') in numbers}
    offset = 0 if v.module_week_boundary_mode(module) == 'calendar' else week_plan_offset(weeks, sessions)
    return {str(week.get('id') or '') for index, week in enumerate(weeks)
            if index + 1 - offset in numbers}


def without_new_closed_live(module, weeks, stored_components):
    """Never trust copied booking settings as proof of a historical component."""
    from . import views as v
    # New group-created week shells do not have database IDs yet. Distinguish
    # them by position so one closed shell cannot close every empty-ID shell.
    indexed = [{**week, 'id': week.get('id') or f'__holiday_week_{index}'}
               for index, week in enumerate(weeks)]
    plan = module_closure_plan(module, indexed)
    closed = closed_week_ids(module, indexed, plan)
    retained = {str(row.get('id')): str(row.get('week_id')) for row in stored_components
                if v.frontend_component_type(row.get('type')) == 'live-session'
                and not row.get('deleted_at')}
    for index, week in enumerate(weeks):
        for component in week.get('components') or []:
            identifier = str(component.get('id'))
            if (v.stored_component_type(component.get('type')) == 'live_session'
                    and identifier in retained and retained[identifier] != str(week.get('id'))
                    and (str(indexed[index]['id']) in closed
                         or closed_date_reason(plan, (component.get('settings') or {}).get('sessionDate')))):
                raise v.ModuleAuthoringValidationError([{'path': f'weekStructure[{index}].components',
                    'message': 'An existing Live session cannot be moved into a holiday week. Its original booking and recording must stay linked.'}])
    return [{**week, 'components': [component for component in week.get('components') or []
             if v.stored_component_type(component.get('type')) != 'live_session'
             or (str(indexed[index]['id']) not in closed
                 and not closed_date_reason(plan, (component.get('settings') or {}).get('sessionDate')))
             or retained.get(str(component.get('id'))) == str(week.get('id'))]}
            for index, week in enumerate(weeks)]
