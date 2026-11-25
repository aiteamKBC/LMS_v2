"""Tutor conflict reads, shared guard orchestration and availability projection."""
from collections import defaultdict


class TutorAvailabilityUnavailable(Exception):
    """Required availability facts could not be read; no verdict may be issued."""

from curriculum_api.catalogue.domain.delivery_pattern import tutor_delivery_schedule as _default_tutor_delivery_schedule
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key as _default_staff_assignment_key
from curriculum_api.catalogue.domain.tutor_conflicts import module_time_window as _default_module_time_window
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date


def module_slot_clash_dates(
    left,
    right,
    holiday_cache=None,
    *,
    module_session_dates,
    module_session_clock,
    module_time_window=_default_module_time_window,
):
    """Dates on which two modules occupy an overlapping clock window.

    Overlap rather than equality: 10:00-12:00 against 11:00-13:00 puts the same
    tutor in two rooms just as surely as two identical slots do.
    """
    shared = module_session_dates(left, holiday_cache) & module_session_dates(right, holiday_cache)
    clashes = []
    for day in sorted(shared):
        left_clock, left_finish, _ = module_session_clock(left, session_date=day)
        right_clock, right_finish, _ = module_session_clock(right, session_date=day)
        left_start, left_end = module_time_window({'session_start_time': left_clock, 'session_end_time': left_finish})
        right_start, right_end = module_time_window({'session_start_time': right_clock, 'session_end_time': right_finish})
        if left_start < right_end and right_start < left_end:
            clashes.append(day)
    return clashes


def tutor_conflict_context(
    module_rows=None,
    *,
    safe_group_delivery_rows,
    surviving_authoring_module_rows,
    tutor_delivery_schedule=_default_tutor_delivery_schedule,
    module_schedule_view,
    module_session_dates,
):
    """The stored side of a conflict check, prepared once.

    Everything here is the same for every tutor and every candidate a caller goes
    on to check, so it is built once rather than per question: the surviving
    module rows as schedules, the days their groups have taken away already gone
    (``tutor_delivery_schedule``), their session dates, the group rows that reads
    from, and the cohort holiday reads those dates depend on. A twenty-name
    roster over a few hundred stored modules was otherwise thousands of session
    plans -- and thousands of holiday reads -- for one change of the slot.
    """
    holiday_cache = {}
    groups = safe_group_delivery_rows()
    stored = []
    for row in surviving_authoring_module_rows(module_rows):
        view = tutor_delivery_schedule(module_schedule_view(row), groups)
        # Dated here, while the holiday read for its cohort is shared with every
        # other module that sits in the same cohort.
        module_session_dates(view, holiday_cache)
        stored.append(view)
    return {'stored': stored, 'holidays': holiday_cache, 'groups': groups}


def find_tutor_schedule_conflicts(
    candidate,
    module_rows=None,
    exclude_catalogue_ids=(),
    pending=(),
    context=None,
    *,
    staff_assignment_key=_default_staff_assignment_key,
    clean_str=_default_clean_str,
    tutor_conflict_context,
    tutor_delivery_schedule=_default_tutor_delivery_schedule,
    module_slot_clash_dates,
    module_session_clock,
):
    """Modules that would put `candidate`'s tutor in two places at once.

    `exclude_catalogue_ids` names the modules this save is rewriting: their
    stored rows still carry the previous tutor and schedule, so comparing against
    them would report a module clashing with its own former self. `pending`
    carries the candidates already accepted earlier in the same save, which is
    what catches two *new* modules that clash with each other.

    `context` is a ``tutor_conflict_context`` a caller asking many questions of
    the same stored state has already built; without one it is built here, so a
    single call still needs nothing but the candidate.
    """
    tutor_key = staff_assignment_key(candidate.get('tutor_name'))
    if not tutor_key:
        return []
    self_id = clean_str(candidate.get('module_catalogue_id'))
    # Narrows the *stored* side only. `pending` carries this save's own intent for
    # those same modules, so applying the exclusion to it as well would skip
    # exactly the comparisons a multi-module save exists to make.
    excluded = {clean_str(item) for item in exclude_catalogue_ids}
    excluded.discard('')

    context = context if context is not None else tutor_conflict_context(module_rows)
    holiday_cache = context.get('holidays')
    # The candidate is a payload, not a stored row, so it arrives carrying
    # whatever day the form had -- including the copy a module created into a
    # dayless group still holds. Read the same way the stored side was.
    candidate = tutor_delivery_schedule(candidate, context.get('groups'))
    # Pending first: where a pending candidate and a stored row share an id, the
    # candidate is the newer intent and the stored row must not mask it.
    stored = context.get('stored') or []
    # Pending candidates are payloads too, so they are delivered the same way the
    # stored side already was.
    pending = [tutor_delivery_schedule(item, context.get('groups')) for item in pending]

    conflicts = []
    seen = set()
    for other, from_store in [(item, False) for item in pending] + [(item, True) for item in stored]:
        catalogue_id = clean_str(other.get('module_catalogue_id'))
        if not catalogue_id or catalogue_id == self_id or catalogue_id in seen:
            continue
        if from_store and catalogue_id in excluded:
            continue
        if staff_assignment_key(other.get('tutor_name')) != tutor_key:
            continue
        shared = module_slot_clash_dates(candidate, other, holiday_cache)
        if not shared:
            continue
        seen.add(catalogue_id)
        dates_by_clock = defaultdict(list)
        for day in shared:
            clock, end, _duration = module_session_clock(other, session_date=day)
            dates_by_clock[(clock, end)].append(day.isoformat())
        for (clock, end), dates in dates_by_clock.items():
            conflicts.append({
                'moduleCatalogueId': catalogue_id,
                'moduleName': other.get('title') or catalogue_id,
                'programme': other.get('programme_name'),
                'cohort': other.get('cohort_name'),
                'group': other.get('group_name'),
                'startTime': clock,
                'endTime': end,
                'dates': dates,
            })
    return sorted(conflicts, key=lambda item: (item['dates'][0], item['moduleName']))


def tutor_schedule_conflicts_created(
    before, candidate, *,
    clean_str,
    staff_assignment_key,
    find_tutor_schedule_conflicts,
    tutor_conflict_context,
    **kwargs,
):
    """The clashes a save would CREATE, without the ones it inherited.

    ``module_schedule_assignment_changed`` answers for the whole module: change
    the tutor, the day, the time, the start date or the number of weeks, and
    every clash that module is in is reported -- including clashes on dates the
    edit never touched. Adding one week to a module therefore failed on a clash
    in its *first* week, one that was there before the edit and is still there
    after it, and the author was told to change the tutor, the day or the time
    in order to save a change that moved none of them. There was no way out of
    that dialog except to fix an unrelated booking first.

    This restores the rule the guard was written for and still documents in
    ``module_schedule_assignment_changed``: a save may not create or move a
    booking into a clash, but a module already in one is not frozen.

    ``before`` is the module's stored schedule. A clash on a date that schedule
    already had is inherited. Everything else is this save's doing -- including
    every clash of a tutor the save is changing, because that booking is new,
    and every clash with another module in the same save, which is why the
    baseline is asked without ``pending``.
    """
    # A candidate is assembled from whichever payload the caller was handed, and
    # several of them carry only the fields the save writes. The group is not one
    # of those fields -- a module does not change group through these doors -- so
    # the stored one stands, and without it the candidate would be checked
    # against its own day rather than the day its group delivers on.
    if not clean_str((candidate or {}).get('group_id')) and clean_str((before or {}).get('group_id')):
        candidate = {**candidate, 'group_id': clean_str(before.get('group_id'))}
    conflicts = find_tutor_schedule_conflicts(candidate, **kwargs)
    if not conflicts:
        return []
    baseline = {**(before or {}), 'module_catalogue_id': clean_str(candidate.get('module_catalogue_id'))}
    # No stored tutor is a booking that did not exist: nothing to inherit.
    if not staff_assignment_key(baseline.get('tutor_name')):
        return conflicts
    if kwargs.get('context') is None:
        # Both questions read the same stored state, so it is prepared once.
        kwargs = {**kwargs, 'context': tutor_conflict_context(kwargs.get('module_rows'))}
        conflicts = find_tutor_schedule_conflicts(candidate, **kwargs)
        if not conflicts:
            return []
    inherited = {
        (item['moduleCatalogueId'], day)
        for item in find_tutor_schedule_conflicts(baseline, **{**kwargs, 'pending': ()})
        for day in item['dates']
    }
    created = []
    for item in conflicts:
        dates = [day for day in item['dates'] if (item['moduleCatalogueId'], day) not in inherited]
        if dates:
            created.append({**item, 'dates': dates})
    return created


def first_tutor_schedule_conflict(
    candidates,
    module_rows=None,
    *,
    clean_str=_default_clean_str,
    tutor_conflict_context,
    find_tutor_schedule_conflicts,
):
    """Validate a whole save at once, returning the first clash it would create.

    Returns ``(candidate, conflicts)``, or ``(None, [])`` when the save is clean.
    Every module the save writes is excluded from the stored side and re-added as
    it is accepted, so the check sees the state the save is *about* to produce
    rather than the one it is replacing. A candidate carrying ``enforce: False``
    is compared against but never itself refused -- see
    ``module_schedule_assignment_changed``.
    """
    candidates = [item for item in candidates if item]
    written_ids = {clean_str(item.get('module_catalogue_id')) for item in candidates}
    written_ids.discard('')
    # Read and date the stored rows once: a group save can carry a dozen modules,
    # and each would otherwise re-read the whole table.
    context = tutor_conflict_context(module_rows)

    accepted = []
    for candidate in candidates:
        conflicts = find_tutor_schedule_conflicts(
            candidate,
            exclude_catalogue_ids=written_ids,
            pending=accepted,
            context=context,
        )
        # A candidate whose booking is not moving still takes part as context --
        # a module moved *onto* it is a new clash and must be refused -- but a
        # clash it was already in is not this save's doing.
        if conflicts and candidate.get('enforce', True):
            return candidate, conflicts
        accepted.append(candidate)
    return None, []


def tutor_conflict_message(
    candidate,
    conflicts,
    *,
    format_date=_default_format_date,
    parse_date=_default_parse_date,
):
    clash = conflicts[0]
    dates = clash.get('dates') or []
    when = format_date(parse_date(dates[0])) if dates else ''
    also = f' (+{len(conflicts) - 1} more)' if len(conflicts) > 1 else ''
    subject = candidate.get('title') or 'this module'
    return (
        f'{candidate.get("tutor_name")} is already teaching "{clash.get("moduleName")}" '
        f'at {clash.get("startTime")}-{clash.get("endTime")} on {when}{also}. '
        f'Change the tutor, the day or the time before saving "{subject}".'
    )


def group_tutor_assignment_conflict(
    group_id, tutor_name, module_rows=None, *,
    safe_authoring_module_rows,
    clean_str,
    staff_assignment_key,
    module_schedule_view,
    surviving_authoring_module_rows,
    first_tutor_schedule_conflict,
):
    """The clash assigning one tutor across a whole group would create.

    The group PATCH and the staffing screen both set a single name against every
    module in the group at once, so each of those modules is checked as though it
    already carried the new tutor.
    """
    module_rows = safe_authoring_module_rows() if module_rows is None else module_rows
    group_key = clean_str(group_id)
    next_key = staff_assignment_key(tutor_name)
    candidates = [
        {
            **module_schedule_view(row, tutor_name=tutor_name),
            'enforce': staff_assignment_key(row.get('tutor_name')) != next_key,
        }
        for row in surviving_authoring_module_rows(module_rows)
        if clean_str(row.get('group_id')) == group_key
    ]
    return first_tutor_schedule_conflict(candidates, module_rows=module_rows)


def preview_tutor_availability(
    payload, *,
    module_schedule_view,
    clean_str,
    curriculum_read_scope,
    resolve_stored_module_catalogue_id,
    read_module_rows,
    read_group_rows,
    read_tutor_rows,
    surviving_authoring_module_rows,
    tutor_delivery_schedule,
    find_tutor_schedule_conflicts,
    tutor_conflict_message,
    module_session_dates,
    module_time_window,
    DEFAULT_SESSION_START_TIME,
    DEFAULT_SESSION_END_TIME,
    unique,
    staff_profile_name,
    truthy,
    staff_assignment_key,
):
    """Read one shared context and project tutor verdicts; None means missing module."""
    slot = module_schedule_view(payload)
    # Resolved the same way the module PATCH resolves its own identifier, so the
    # preview can never answer about a module the save would not have recognised.
    requested_module = clean_str(
        payload.get('moduleCatalogueId') or payload.get('moduleId') or payload.get('catalogueId')
    )
    # One scope over every read this preview makes. It is asked on a 300ms
    # debounce as a slot is typed, and the reads below overlap heavily: resolving
    # the module identifier and listing the modules both read the modules table,
    # and dating the stored modules reads each cohort's holidays.
    with curriculum_read_scope():
        excluded = resolve_stored_module_catalogue_id(requested_module)
        if requested_module and not excluded:
            # Silently carrying on would leave the slot empty, and an empty slot
            # clashes with nothing -- every tutor would read as free. A wrong
            # all-clear is worse here than no answer, so this is an error.
            return None
        # Read *and date* the module rows once, then reuse them for every tutor: the
        # all-tutors form of this call is made on every keystroke-ish change of the
        # slot, and the answer for a name depends on the name alone.
        module_rows = read_module_rows()
        context = tutor_conflict_context(
            module_rows, safe_group_delivery_rows=read_group_rows,
            surviving_authoring_module_rows=surviving_authoring_module_rows,
            tutor_delivery_schedule=tutor_delivery_schedule,
            module_schedule_view=module_schedule_view, module_session_dates=module_session_dates,
        )
        tutor_rows = read_tutor_rows()

    # Naming a module is enough. A screen that only wants "who is free for this
    # module" should not have to carry its weekday and times around just to ask,
    # and reading them here means the preview cannot answer about a slot that
    # differs from the stored one. Anything the caller *does* send still wins, so
    # a form previewing an edited schedule gets the answer for the edit.
    if excluded:
        stored = next(
            (row for row in module_rows if clean_str(row.get('module_catalogue_id')) == excluded),
            None,
        )
        if stored:
            stored_slot = module_schedule_view(stored)
            slot = {key: (slot.get(key) or stored_slot.get(key)) for key in stored_slot}
    # Resolved here rather than left to the check: the dates and clock this
    # preview *reports* have to be the ones it answered about, and doing it once
    # keeps every candidate below a copy of an already dated schedule.
    slot = tutor_delivery_schedule(slot, context.get('groups'))

    def answer_for(name):
        conflicts = find_tutor_schedule_conflicts(
            {**slot, 'tutor_name': name, 'module_catalogue_id': excluded},
            context=context,
        )
        return {
            'tutor': name,
            'available': not conflicts,
            'conflicts': conflicts,
            # Pre-rendered so every screen phrases a clash the same way the save
            # would have, rather than each inventing its own sentence.
            'message': tutor_conflict_message({**slot, 'tutor_name': name}, conflicts) if conflicts else '',
        }

    # Dated before the first verdict is asked for: every candidate below is a copy
    # of this slot with only the tutor name changed, so they all inherit the
    # answer instead of re-planning it once per name.
    dates = sorted(module_session_dates(slot, context['holidays']))
    start_minutes, end_minutes = module_time_window(slot)
    window = {
        'sessionDates': [item.isoformat() for item in dates],
        'startTime': slot.get('session_start_time') or DEFAULT_SESSION_START_TIME,
        'endTime': slot.get('session_end_time') or DEFAULT_SESSION_END_TIME,
        # A slot with no resolvable dates books nothing, so nobody can clash with
        # it. Saying so explicitly stops a screen reading "everyone is free" as a
        # meaningful all-clear.
        'bookable': bool(dates) and end_minutes > start_minutes,
    }

    requested = clean_str(payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name'))
    if requested:
        return {**window, **answer_for(requested)}

    directory_names = unique([
        staff_profile_name(row)
        for row in tutor_rows
        if staff_profile_name(row) and not truthy(row.get('is_archived'))
    ])
    # The save checks the name a module carries, whoever it is -- an archived
    # tutor, or a name that was never in the directory at all. A picker lists
    # those names too, so the roster answers for them: a name missing from here
    # reached the picker unchecked and was shown as free while the save refused
    # it. Spelt as the module has it, since that is the string the picker shows.
    directory_keys = {staff_assignment_key(name) for name in directory_names}
    listed = {name.lower() for name in directory_names}
    module_names = []
    for row in surviving_authoring_module_rows(module_rows):
        name = clean_str(row.get('tutor_name'))
        if not staff_assignment_key(name) or name.lower() in listed:
            continue
        listed.add(name.lower())
        module_names.append(name)
    # The verdict depends on the save's key alone, so two spellings of one
    # person are asked once.
    verdicts = {}

    def roster_answer(name):
        key = staff_assignment_key(name)
        if key not in verdicts:
            verdicts[key] = answer_for(name)
        conflicts = verdicts[key]['conflicts']
        return {
            **verdicts[key],
            'tutor': name,
            'message': tutor_conflict_message({**slot, 'tutor_name': name}, conflicts) if conflicts else '',
            'inDirectory': key in directory_keys,
        }

    results = [roster_answer(name) for name in directory_names + module_names]
    return {
        **window,
        'results': results,
        'availableCount': sum(1 for item in results if item['available']),
        'busyCount': sum(1 for item in results if not item['available']),
    }
