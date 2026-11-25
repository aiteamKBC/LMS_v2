"""Authored session read assembly and calendar projection; no HTTP dependencies."""
from datetime import date
from .overview import CurriculumOverviewUnavailable

from curriculum_api.catalogue.domain.session_plan import holiday_date_set as _default_holiday_date_set
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def calendar_snapshot_from_rows(
    authoring_modules,
    cohorts,
    groups,
    holiday_rows,
    *,
    raw_groups=None,
    week_rows=None,
    component_rows=None,
    strict=True,
    read_links,
    select_holidays,
    build_authored_sessions,
    clean_str=_default_clean_str,
    parse_date=_default_parse_date,
):
    """Resolve one authored source once, retaining genuine empty and undated states."""
    try:
        if strict and any(cohort.get('calendarError') for cohort in cohorts):
            raise CurriculumOverviewUnavailable('Curriculum calendar unavailable.')
        holidays = select_holidays(cohorts, holiday_rows)
        if strict and any(cohort.get('calendarError') for cohort in cohorts):
            raise CurriculumOverviewUnavailable('Curriculum calendar unavailable.')
        modules = {clean_str(row.get('module_catalogue_id')): row for row in authoring_modules
                   if clean_str(row.get('module_catalogue_id'))}
        options = {}
        if strict:
            options['strict'] = True
        if raw_groups is not None:
            options['groups_by_id'] = {clean_str(row.get('group_id')): row for row in raw_groups}
        if week_rows is not None:
            options['week_rows'] = week_rows
        if component_rows is not None:
            options['component_rows'] = component_rows
        links = read_links(list(modules), modules_by_catalogue=modules,
                           holidays_by_cohort=holidays, **options)
        sessions = build_authored_sessions(authoring_modules, holidays,
            groups_by_id={group['id']: {
                'session_start_time': group.get('startTime'), 'session_end_time': group.get('endTime'),
            } for group in groups}, session_links=links)
        undated = sum(1 for module in authoring_modules
                      if clean_str(module.get('module_catalogue_id')) and clean_str(module.get('status')).lower() != 'archived'
                      for link in (links.get(clean_str(module.get('module_catalogue_id'))) or [])
                      if not parse_date(link.get('date')))
        return {'sessions': sessions, 'undatedSessionCount': undated}
    except CurriculumOverviewUnavailable:
        raise
    except Exception as exc:
        if not strict:
            raise
        raise CurriculumOverviewUnavailable('Curriculum calendar unavailable. Please retry.') from exc


def required_curriculum_sessions(rows, training_rows, authoring_modules, cohorts, groups, holiday_rows, *,
                                 read_links, select_holidays, build_authored_sessions, clean_str, parse_date):
    return calendar_snapshot_from_rows(authoring_modules, cohorts, groups, holiday_rows,
        raw_groups=rows['_delivery_rows']['groups'], read_links=read_links,
        select_holidays=select_holidays, build_authored_sessions=build_authored_sessions,
        clean_str=clean_str, parse_date=parse_date)['sessions']


def build_sessions_from_authoring_modules(
    authoring_module_rows,
    holidays_by_cohort=None,
    groups_by_id=None,
    *,
    session_links=None,
    clean_str=_default_clean_str,
    authoring_session_links_by_catalogue,
    parse_date=_default_parse_date,
    parse_json_value=_default_parse_json_value,
    holiday_date_set=_default_holiday_date_set,
    slugify=_default_slugify,
    module_live_session_clock,
):
    """The live sessions each authored module delivers, from its own structure.

    **One live-session component is one session.** The course structure decides
    how many there are and when each one runs, not ``sessions_number``: the
    module drawer says how many WEEKS the module has, and the author then puts
    live sessions inside them. Delete one and the module delivers one session
    fewer; date one by hand and that is the date it runs on. Everything
    downstream of this list -- the calendar, the Teams occurrences and their
    join links, attendance -- therefore counts and dates exactly what the Course
    structure shows.

    **Nothing is invented here.** A module with no authored live sessions
    delivers none, and a live session nobody has dated is not placed on a date
    of our choosing. Both used to be filled in from ``sessions_number`` and the
    generated weekly plan, which put sessions on the calendar that no author had
    written and dates on sessions that no author had chosen -- and then created
    Teams meetings for them. Where the author has not done the job, the screens
    say so (``moduleAuthoredLiveSessions`` and the Schedule tab in the module
    workspace); they do not show a plausible-looking stand-in.

    A ticked holiday landing on one of these dates is named in
    ``skippedHolidays`` and does nothing else. It is read off the date itself,
    so it stays right for a component whose date was moved by hand.
    """
    sessions = []
    modules = [module for module in (authoring_module_rows or []) if clean_str(module.get('module_catalogue_id'))]
    # The module rows and ticked holidays this caller already holds, so dating
    # each week's primary live session costs no further round trips for them.
    #
    # `groups_by_id` is deliberately NOT forwarded: here it carries a group's
    # CLOCK only, which is all `module_live_session_clock` needs below. Read as
    # a delivery pattern it would say the group names no weekday, and
    # `module_delivery_row` takes a group that delivers on no day at its word --
    # so every primary would come back undated. The planner reads the real
    # group rows instead.
    live_sessions_by_catalogue = session_links if session_links is not None else authoring_session_links_by_catalogue(
        [clean_str(module.get('module_catalogue_id')) for module in modules],
        modules_by_catalogue={clean_str(module.get('module_catalogue_id')): module for module in modules},
        holidays_by_cohort=holidays_by_cohort,
    )
    for module in modules:
        status = clean_str(module.get('status')).lower()
        if status == 'archived':
            continue
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        # Only live sessions that carry a date of their own. An undated one is
        # an unfinished module, reported as such rather than dated by us.
        live_links = [
            link for link in (live_sessions_by_catalogue.get(catalogue_id) or [])
            if parse_date(link.get('date'))
        ]
        if not live_links:
            continue
        # The cohort's ticked holidays. They move nothing -- a holiday is a
        # warning -- but a date that lands on one has to be able to say so.
        applied_holidays = (holidays_by_cohort or {}).get(clean_str(module.get('cohort_id'))) or []
        own_holidays = parse_json_value(module.get('session_holidays') or module.get('sessionHolidays'), [])
        closed_dates = holiday_date_set([
            *applied_holidays,
            *(own_holidays if isinstance(own_holidays, list) else []),
        ])
        title = clean_str(module.get('title')) or catalogue_id
        programme_name = clean_str(module.get('programme_name')) or 'Unassigned programme'
        programme_id = clean_str(module.get('programme_id')) or f'program-{slugify(programme_name)}'
        group_name = clean_str(module.get('group_name')) or clean_str(module.get('group_id')) or 'Unassigned group'
        cohort_name = clean_str(module.get('cohort_name')) or clean_str(module.get('cohort_id')) or 'Unassigned cohort'
        tutor = clean_str(module.get('tutor_name')) or 'Unassigned'

        for index, link in enumerate(live_links):
            session_date = parse_date(link.get('date'))
            iso_date = session_date.isoformat()
            start_time, end_time, _duration = module_live_session_clock(
                module, link.get('startTime'), link.get('durationMinutes'),
                booked=link.get('bookedAtMicrosoft', False), session_date=iso_date,
                group_row=(groups_by_id or {}).get(clean_str(module.get('group_id'))),
            )
            sessions.append({
                'id': f'module-{catalogue_id}-session-{index + 1}',
                'trainingPlanId': module.get('source_id') or '',
                'programmeId': programme_id,
                'programmeSourceId': programme_id,
                'cohortId': clean_str(module.get('cohort_id')),
                'groupId': clean_str(module.get('group_id')),
                'moduleId': catalogue_id,
                'moduleCatalogueId': catalogue_id,
                # The week this live session really sits in, and the component
                # that is this session -- so a join link written back reaches
                # the row the author is looking at.
                'weekId': clean_str(link.get('weekId')),
                'componentId': clean_str(link.get('componentId')),
                'weekTitle': clean_str(link.get('weekTitle')),
                # The live session's own name, as its author typed it on the
                # component. The module's name and a number are what is left
                # when a component carries no title of its own.
                'title': clean_str(link.get('title')) or f'{title} #{index + 1}',
                'type': 'Live Session',
                'date': iso_date,
                'day': session_date.strftime('%A'),
                'startTime': start_time,
                'endTime': end_time,
                'timeZone': clean_str(link.get('timeZone')),
                'tutor': tutor,
                'group': group_name,
                'cohort': cohort_name,
                'programme': programme_name,
                'venue': 'LMS',
                'module': title,
                'week': index + 1,
                # Read off this session's own date, so a hand-moved component
                # still warns about the day it actually lands on.
                'skippedHolidays': [iso_date] if session_date in closed_dates else [],
                'scheduleWarnings': [],
                'status': 'completed' if session_date < date.today() else 'scheduled',
                'ksbCodes': [],
            })
    return sessions


def curriculum_sessions_from_rows(
    rows,
    training_rows,
    authoring_modules,
    cohorts,
    groups,
    holiday_rows,
    *,
    list_only_summaries=False,
    read_links,
    select_holidays,
    build_authored_sessions,
    clean_str=_default_clean_str,
    parse_date=_default_parse_date,
):
    """Compatibility row assembly; generated training sessions have been retired.

    Post-save callers retain tolerant link reads, but never invent count-based sessions.
    Required GET callers use the same projection with strict source checks.
    """
    return calendar_snapshot_from_rows(authoring_modules, cohorts, groups, holiday_rows,
        raw_groups=rows.get('_delivery_rows', {}).get('groups'), strict=False,
        read_links=read_links, select_holidays=select_holidays,
        build_authored_sessions=build_authored_sessions, clean_str=clean_str, parse_date=parse_date)['sessions']
