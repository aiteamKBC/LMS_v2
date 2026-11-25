"""Meeting use cases composed from explicit reads, policies and provider capabilities."""


def teams_non_delivery_reason(
    targets, time_zone='Europe/London', holiday_rows=None, module_catalogue_id=None, *, ZoneInfo,
    authoring_module_exists, datetime, england_non_delivery_reason, get_holiday_rows_safe, load_module_policy,
    load_non_delivery_reason, parse_graph_datetime, parse_int, timezone,
    module_cohort_selected_holidays,
):
    """Validate Teams target instants against the England business calendar."""
    try:
        zone = ZoneInfo(time_zone or 'Europe/London')
    except (KeyError, ValueError):
        zone = ZoneInfo('Europe/London')
    holidays = get_holiday_rows_safe() if holiday_rows is None else (holiday_rows or [])
    policy = None
    closure_plan = {}
    if module_catalogue_id:
        module_policy, policy_holidays = load_module_policy()
        module = authoring_module_exists(module_catalogue_id) or {}
        if module:
            from curriculum_api.live_holiday_policy import module_closure_plan
            closure_plan = module_closure_plan(module)
        policy = module_policy(module)
        if module.get('cohort_id'):
            from curriculum_api.delivery_calendar import module_holidays
            holidays = module_holidays(module, module_cohort_selected_holidays(module))
        elif policy is not None:
            holidays = policy_holidays(policy, module.get('start_date'), module.get('end_date'), holidays)
    for target in targets or []:
        instant = (
            target.get('start') or target.get('startDateTimeUtc') or target.get('start_datetime')
            if isinstance(target, dict) else target
        )
        if not isinstance(instant, datetime):
            instant = parse_graph_datetime(instant)
        if not instant:
            continue
        local = instant.replace(tzinfo=instant.tzinfo or timezone.utc).astimezone(zone)
        if policy is None:
            reason = england_non_delivery_reason(local.date(), holidays)
        else:
            non_delivery_reason, = load_non_delivery_reason()
            reason = non_delivery_reason(local.date(), policy, holidays)
        from curriculum_api.live_holiday_policy import closed_date_reason
        reason = closed_date_reason(closure_plan, local.date()) or reason
        if reason:
            session_number = parse_int(
                target.get('session_number') or target.get('sessionNumber'), 0,
            ) if isinstance(target, dict) else 0
            prefix = f'Session {session_number}: ' if session_number else ''
            return f'{prefix}{reason}'
    return ''
