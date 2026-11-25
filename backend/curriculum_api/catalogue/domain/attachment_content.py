"""Attachment identity, week-count and content-preservation rules over supplied values."""

from curriculum_api.catalogue.domain.hierarchy_dates import cohort_delivery_window as _default_cohort_delivery_window
from curriculum_api.catalogue.domain.hierarchy_dates import module_soft_start_date as _default_module_soft_start_date
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def first_clean_payload_value(payload, *keys, clean_str=_default_clean_str):
    for key in keys:
        value = clean_str(payload.get(key))
        if value:
            return value
    return ''


def identity_values_match_context(left_values, context_values, *, normalise=_default_normalise):
    left = {normalise(value) for value in left_values if normalise(value)}
    context = {normalise(value) for value in context_values if normalise(value)}
    if context and not left:
        return False
    if left and context:
        return bool(left & context)
    return True


def identity_ids_conflict(left_id, context_ids, *, normalise=_default_normalise):
    """True when both sides name a canonical id and none of them agree.

    ``identity_values_match_context`` pools ids and display names into one set,
    so a shared name (two cohorts each with a group called "G1-Wed") satisfies
    the match even when the ids point at different rows. Callers that hold a
    canonical id on both sides use this to reject that cross-row collision
    before it silently reuses another group's module.
    """
    # normalise(None) returns the string 'none', which is truthy, so None must be
    # discarded before normalising or a missing id becomes a bogus candidate that
    # every real id "conflicts" with.
    left = normalise(left_id) if left_id is not None else ''
    if not left:
        return False
    candidates = {
        normalise(value)
        for value in context_ids
        if value is not None and normalise(value)
    }
    if not candidates:
        return False
    return left not in candidates


def payload_week_list(value):
    """Return value only when it is a usable list of authored weeks.

    Attachment payloads overload `weeks`: the module catalogue shape carries an
    integer session count, while authored payloads carry a list of week dicts.
    Returning [] for anything that is not a list of dicts keeps an integer from
    being treated as a week structure (which would silently drop every week).
    """
    if not isinstance(value, list):
        return []
    return value if all(isinstance(item, dict) for item in value) else []


def attachment_week_count(
    item,
    session_count,
    schedule,
    *,
    delivery_days_per_week,
    parse_int=_default_parse_int,
    payload_week_list=payload_week_list,
):
    """The authored week count for an attachment, given its session count.

    An explicit scalar `weeks` on the item wins. Otherwise the count is derived
    back out of the sessions using the group's delivery days, so a Mon+Thu group
    asked for 10 sessions is recorded as 5 authored weeks rather than 10.
    """
    weeks_field = item.get('weeksNumber') if 'weeksNumber' in item else item.get('weeks')
    explicit = 0 if isinstance(weeks_field, (list, tuple, dict)) else parse_int(weeks_field, 0)
    if explicit > 0:
        return explicit
    authored = len(payload_week_list(item.get('weekStructure')) or payload_week_list(item.get('weeks')))
    if authored:
        return authored
    sessions = max(0, parse_int(session_count, 0))
    if not sessions:
        return 0
    return max(1, sessions // delivery_days_per_week({'session_week_day': schedule}))


def empty_authoring_week(week_number):
    """An unauthored week shell, in the shape save_module_authoring_structure expects."""
    return {
        'weekNumber': week_number,
        'title': f'Week {week_number}',
        'summary': '',
        'learningOutcomes': [],
        'components': [],
        'ksbMappings': [],
    }


def resize_authoring_week_structure(
    weeks,
    target_count,
    *,
    empty_authoring_week=empty_authoring_week,
    parse_int=_default_parse_int,
):
    """Grow or shrink an authored week list to a new count without touching what is built.

    Growing appends empty weeks after the last one; shrinking drops from the
    end -- the most recently added weeks -- so a person changing the weeks
    count on a module that already has authored content never has an earlier,
    already-built week rewritten or removed out from under them.
    """
    weeks = list(weeks or [])
    target = max(0, parse_int(target_count, len(weeks)))
    if target == len(weeks):
        return weeks
    if target > len(weeks):
        return weeks + [empty_authoring_week(index + 1) for index in range(len(weeks), target)]
    return weeks[:target]


def week_holds_authored_content(
    week,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    parse_int=_default_parse_int,
):
    """Whether a week holds anything somebody actually put there.

    An untouched week shell -- the thing a week-count change creates -- is a
    default title and nothing else. Everything past that is authored work.
    """
    if not isinstance(week, dict):
        return False
    if week.get('components') or week.get('ksbMappings') or week.get('learningOutcomes'):
        return True
    if clean_str(week.get('summary')):
        return True
    title = clean_str(week.get('title'))
    if not title:
        return False
    week_number = parse_int(week.get('weekNumber') or week.get('week_number'), 0)
    return normalise(title) != normalise(f'Week {week_number}')


def resize_authoring_week_structure_preserving_content(
    weeks,
    target_count,
    *,
    parse_int=_default_parse_int,
    resize_authoring_week_structure=resize_authoring_week_structure,
    week_holds_authored_content=week_holds_authored_content,
):
    """Resize a week list from a scalar count, but never delete authored weeks.

    The module PATCH carries the week *count* and never the week *list* -- the
    list belongs to the Module Builder. Shrinking straight to that number let a
    single scalar delete whole weeks and every component in them while the
    response still said ``updated: True``: the drawer seeds its Weeks box from
    the module's stored count and falls back to 1 when the module has none, so
    simply opening an imported module and pressing Save could cut it down to one
    week. Trailing shells hold nothing and are safe to drop; a week with
    authored content stops the shrink where it is, and the stored count is
    re-derived from what survived so the number and the rows never disagree.
    """
    weeks = list(weeks or [])
    target = max(0, parse_int(target_count, len(weeks)))
    if target >= len(weeks):
        return resize_authoring_week_structure(weeks, target)
    kept = list(weeks)
    while len(kept) > target and not week_holds_authored_content(kept[-1]):
        kept.pop()
    return kept


def attachment_session_count(
    item,
    weeks=None,
    *,
    module_weekly_schedule,
    parse_int=_default_parse_int,
    payload_week_list=payload_week_list,
):
    """Resolve the session count for an attachment payload.

    `weeks` may arrive as an integer count or as a list of authored weeks, so the
    count is taken from sessionsNumber first, then an integer `weeks`, then the
    length of the resolved week structure.
    """
    item = item or {}
    explicit = parse_int(item.get('sessionsNumber'), 0)
    if explicit:
        return explicit
    weekly = module_weekly_schedule(item)
    if weekly:
        count = parse_int(item.get('weeks') or item.get('weeksNumber'), 0) or len(weeks or payload_week_list(item.get('weekStructure') or item.get('weeks')))
        return max(1, count) * len(weekly)
    raw_weeks = item.get('weeks')
    if not isinstance(raw_weeks, (list, tuple, dict)):
        counted = parse_int(raw_weeks, 0)
        if counted:
            return counted
    return len(weeks or payload_week_list(raw_weeks))


def module_structure_component_count(structure):
    return sum(len(week.get('components') or []) for week in ((structure or {}).get('weekStructure') or []))


def module_cohort_date_error(
    module_name,
    start_value,
    end_value,
    cohort,
    *,
    clean_str=_default_clean_str,
    cohort_delivery_window=_default_cohort_delivery_window,
    format_date=_default_format_date,
    module_soft_start_date=_default_module_soft_start_date,
    parse_date=_default_parse_date,
):
    """Refuse a module whose dates fall outside its cohort's delivery window.

    Three ways out of the window, one message each: starting before the allowed
    soft-start month, starting after it has finished, and -- the case a
    generated session plan reaches on its own -- running past the end. Returns
    ``(message, field)`` or ``None``.
    """
    cohort_start, cohort_end = cohort_delivery_window(cohort)
    soft_start = module_soft_start_date(cohort_start) or cohort_start
    module_start = parse_date(start_value)
    module_end = parse_date(end_value)
    label = f'Module "{clean_str(module_name)}"' if clean_str(module_name) else 'The module'

    if module_start and soft_start and module_start < soft_start:
        return (
            f'{label} cannot start more than one month before the cohort start date ({format_date(cohort_start)}).',
            'startDate',
        )
    if module_start and cohort_end and module_start > cohort_end:
        return (
            f'{label} cannot start after the cohort end date ({format_date(cohort_end)}).',
            'startDate',
        )
    if module_end and cohort_end and module_end > cohort_end:
        return (
            f'{label} cannot finish after the cohort end date ({format_date(cohort_end)}). '
            f'It currently finishes {format_date(module_end)} -- move the start date earlier '
            f'or reduce the number of sessions.',
            'endDate',
        )
    return None
