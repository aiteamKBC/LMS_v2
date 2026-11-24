"""Coordinate authored live links with the existing delivery planner."""
from collections import defaultdict

from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.session_identity import resolved_live_session_date as _default_resolved_live_session_date
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import unique as _default_unique


def delivery_slots_by_catalogue(
    weeks_by_catalogue,
    *,
    modules_by_catalogue=None,
    groups_by_id=None,
    holidays_by_cohort=None,
    strict=False,
    read_module_rows,
    read_group_rows,
    clean_str=_default_clean_str,
    logger,
    module_week_delivery_slots,
    unique=_default_unique,
):
    """Each module's planned week slots, for dating its primary live sessions.

    Returns ``{catalogue_id: (slots_by_week, session_plan)}``, the shape
    ``module_week_delivery_slots`` gives. A module whose plan cannot be
    built raises for required reads (strict=True). Compatibility callers keep
    their existing stored-date behavior until separately integrated.

    Rows a caller already holds are used as given; only what is missing is
    read. ``holidays_by_cohort`` supplied but silent about a cohort means that
    cohort has no ticked holidays, which is how
    ``build_sessions_from_authoring_modules`` reads it too -- passing ``None``
    instead would send the planner to the database for every module.
    """
    catalogue_ids = [clean_str(value) for value in weeks_by_catalogue if clean_str(value)]
    if not catalogue_ids:
        return {}
    modules = {clean_str(key): value for key, value in (modules_by_catalogue or {}).items()}
    missing = [value for value in catalogue_ids if value not in modules]
    if missing:
        try:
            for row in read_module_rows(missing):
                modules[clean_str(row.get('module_catalogue_id'))] = row
        except (Exception, AssertionError):
            if strict:
                raise
            logger.debug('Unable to read modules for the live-session plan.', exc_info=True)
    groups = {clean_str(key): value for key, value in (groups_by_id or {}).items()}
    if groups_by_id is None:
        wanted = unique([
            clean_str((modules.get(value) or {}).get('group_id')) for value in catalogue_ids
        ])
        wanted = [value for value in wanted if value]
        if wanted:
            try:
                for row in read_group_rows(wanted):
                    groups[clean_str(row.get('group_id'))] = row
            except (Exception, AssertionError):
                if strict:
                    raise
                logger.debug('Unable to read groups for the live-session plan.', exc_info=True)
    plans = {}
    for catalogue_id in catalogue_ids:
        module_row = modules.get(catalogue_id)
        week_count = len(weeks_by_catalogue.get(catalogue_id) or [])
        if not module_row or not week_count:
            continue
        holidays = None
        if holidays_by_cohort is not None:
            holidays = holidays_by_cohort.get(clean_str(module_row.get('cohort_id'))) or []
        try:
            plans[catalogue_id] = module_week_delivery_slots(
                module_row,
                groups.get(clean_str(module_row.get('group_id'))) or {},
                week_count,
                holidays=holidays,
            )
        except (Exception, AssertionError):
            if strict:
                raise
            # One module's plan failing leaves that module on its stored dates;
            # it must not blank the session links of every other module here.
            logger.debug('Unable to plan live-session dates for %s.', catalogue_id, exc_info=True)
    return plans


def authoring_session_links_by_catalogue(
    module_catalogue_ids,
    *,
    modules_by_catalogue=None,
    groups_by_id=None,
    holidays_by_cohort=None,
    week_rows=None,
    component_rows=None,
    strict=False,
    read_week_rows,
    read_component_rows,
    active_component_rows,
    active_week_rows,
    clean_str=_default_clean_str,
    component_builder_settings,
    delivery_slots_by_catalogue,
    format_date=_default_format_date,
    live_session_meeting_scope,
    logger,
    module_has_booked_series,
    normalise_component_type=_default_normalise_component_type,
    parse_int=_default_parse_int,
    resolved_live_session_date=_default_resolved_live_session_date,
    unique=_default_unique,
):
    """Every authored live session of each module, in course-structure order.

    **One live-session component is one live session.** The course structure is
    the authority for how many a module has and for when each one runs, so this
    returns one entry per live-session component -- not one per week. Each
    carries its own component id, so each gets its own Teams occurrence and its
    own join link instead of the second one landing on nothing.

    **A week's date belongs to its primary live session.** The primary is the
    first live-session component of the week in ``(display_order, id)`` order --
    the order this read and both structure reads already spell, so every process
    picks the same one whatever the database returns rows in. It runs on the
    week's planned date and follows it: move the week and the primary moves with
    it. Any further live session in the same week is an ADDITIONAL one, dated
    only by its own ``settings.sessionDate``; it never borrows the week's, and
    with no date of its own it stays undated and makes no Teams occurrence.

    This is the same resolution ``apply_module_session_plan_to_weeks`` applies
    when it serves the structure, and the two must not drift: reading only the
    stored ``settings.sessionDate`` here is what let the Module Builder show a
    module's thirteen dated weeks while this told the Teams dialog it had no
    sessions at all.

    The plan is read from the module, group and cohort holidays a caller
    already holds; it is fetched here only when they are not supplied. A plan
    that cannot be built raises for strict callers. Compatibility callers keep
    the original stored-date behavior.

    Weeks with no live session contribute nothing. A week is a week -- reading,
    assignments and the rest stand -- but it delivers no live session, so there
    is no meeting to create for it.
    """
    # Sorted so two callers asking for the same modules in a different order
    # (build_sessions and build_sessions_from_authoring_modules in one overview
    # build) share the read-scope memo instead of each paying for both reads.
    # Row order comes from the ORDER BY clauses, not from this list.
    module_catalogue_ids = sorted(unique([clean_str(value) for value in module_catalogue_ids if clean_str(value)]))
    if not module_catalogue_ids:
        return {}
    try:
        week_rows = active_week_rows(week_rows if week_rows is not None else read_week_rows(module_catalogue_ids))
        component_rows = active_component_rows(component_rows if component_rows is not None else read_component_rows(module_catalogue_ids))
    except (Exception, AssertionError):
        if strict:
            raise
        # Compatibility callers retain their existing best-effort contract.
        # Required overview reads raise above instead of fabricating emptiness.
        # AssertionError remains part of that historical compatibility contract;
        # required readers never turn a blocked or failed read into zero sessions.
        logger.debug('Unable to batch read authored session links.', exc_info=True)
        return {}

    live_components_by_week = defaultdict(list)
    for row in component_rows:
        # The SQL filter is the fast path; this is the authority, so a spelling
        # it somehow let through is still rejected here.
        if normalise_component_type(row.get('type')) != 'live_session':
            continue
        week_id = clean_str(row.get('week_id'))
        if week_id:
            live_components_by_week[week_id].append(row)

    # The weeks of each module, in the order this read already asked for them
    # (`display_order, week_number, id`). Authored week N is the Nth of these,
    # which is the index its planned slot is numbered by.
    weeks_by_catalogue = defaultdict(list)
    for week_row in week_rows:
        weeks_by_catalogue[clean_str(week_row.get('module_catalogue_id'))].append(week_row)
    plans_by_catalogue = delivery_slots_by_catalogue(
        weeks_by_catalogue,
        modules_by_catalogue=modules_by_catalogue,
        groups_by_id=groups_by_id,
        holidays_by_cohort=holidays_by_cohort,
        **({"strict": True} if strict else {}),
    )

    links_by_catalogue = defaultdict(list)
    settings_by_catalogue = defaultdict(list)
    for catalogue_id, module_week_rows in weeks_by_catalogue.items():
        slots_by_week, session_plan = plans_by_catalogue.get(catalogue_id) or ([], [])
        for week_index, week_row in enumerate(module_week_rows):
            week_id = clean_str(week_row.get('id'))
            week_slots = slots_by_week[week_index] if week_index < len(slots_by_week) else []
            # `display_order, id` within the week, as the SQL asked for it, so
            # the Nth live session takes the Nth delivery slot in every process.
            for offset, component in enumerate(live_components_by_week.get(week_id) or []):
                settings = component_builder_settings(component)
                settings = settings if isinstance(settings, dict) else {}
                stored_date = format_date(settings.get('sessionDate'))
                booked_at_microsoft = bool(
                    clean_str(settings.get('extraTeamsMeetingUrl'))
                    or (clean_str(settings.get('teamsLiveSessionId'))
                        and parse_int(settings.get('teamsSessionNumber'), 0) > 0)
                )
                settings_by_catalogue[catalogue_id].append(settings)
                links_by_catalogue[catalogue_id].append({
                    'weekId': week_id,
                    'componentId': clean_str(component.get('id')),
                    'title': component.get('title') or week_row.get('title') or '',
                    'weekTitle': (clean_str(week_row.get('title'))
                                  if clean_str(component.get('module_catalogue_id')) == catalogue_id else ''),
                    # Delivered by its own additional meeting rather than by the
                    # module's calendar. Flagged, never dropped: the week still runs
                    # a live session and every screen that lists sessions must still
                    # show it. Only the Teams paths exclude it -- the module series
                    # neither books it nor should be judged against it.
                    'additionalMeeting': bool(clean_str(settings.get('extraTeamsMeetingUrl'))),
                    'date': resolved_live_session_date(
                        settings, offset, week_slots, session_plan,
                        stored_date=stored_date, booked_at_microsoft=booked_at_microsoft,
                    ),
                    'startTime': clean_str(settings.get('sessionTime')),
                    'timeZone': clean_str(settings.get('sessionTimeZone')),
                    'durationMinutes': parse_int(
                        settings.get('durationMinutes') or settings.get('teamsDurationMinutes'), 0,
                    ),
                    'bookedAtMicrosoft': booked_at_microsoft,
                })
    # Which calendar delivers each one. Only 'main' belongs to the module's own
    # series; an 'additional' or still 'pending' live session is listed like any
    # other but never booked, counted or judged by it.
    for catalogue_id, links in links_by_catalogue.items():
        all_settings = settings_by_catalogue[catalogue_id]
        has_series = module_has_booked_series(all_settings)
        for link, settings in zip(links, all_settings):
            link['meetingScope'] = live_session_meeting_scope(settings, has_series)
    return dict(links_by_catalogue)
