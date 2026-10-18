"""Strict read-only calendar resolution for the Student Weekly projection."""
import json


def normalise_projected_calendar(module):
    """Decode raw-cursor JSON text without relaxing scheduler validation."""
    result = dict(module)
    for field in ('weekly_schedule', 'session_holidays', 'session_overrides'):
        value = result.get(field)
        if isinstance(value, str):
            try:
                result[field] = json.loads(value)
            except ValueError:
                # Keep malformed values for the canonical field parser/validator.
                pass
    return result


def cohort_holidays(cohort_ids):
    # Use the existing sources/exclusion rule, but propagate read failures.
    # The general curriculum helper deliberately swallows them for other views.
    from curriculum_api.views import (
        clean_str, curriculum_in_clause, COHORT_AUTHORING_DETAILS_TABLE,
        scheduling_holidays_from, parse_json_value, fetch_all, table_name,
        table_exists, ENGLAND_HOLIDAYS_TABLE, authored_holiday_table_name,
        holiday_row_archived, holiday_row_sort_key,
    )
    wanted = list(dict.fromkeys(clean_str(value) for value in cohort_ids if clean_str(value)))
    if not wanted:
        return {}
    clause, params = curriculum_in_clause('cohort_id', wanted)
    # One round trip for the same canonical calendar sources. JSON envelopes
    # permit differently shaped tables without losing archive/exclusion fields.
    statements = [f"SELECT 'cohort' AS source,to_jsonb(c) AS payload FROM {table_name(COHORT_AUTHORING_DETAILS_TABLE)} c WHERE {clause}"]
    if table_exists(ENGLAND_HOLIDAYS_TABLE):
        statements.append(f"SELECT 'england',to_jsonb(h) FROM {table_name(ENGLAND_HOLIDAYS_TABLE)} h")
    authored = authored_holiday_table_name()
    if authored:
        statements.append(f"SELECT 'authored',to_jsonb(h) FROM {table_name(authored)} h")
    calendar = fetch_all(' UNION ALL '.join(statements), params)
    cohorts, holidays = [], []
    for envelope in calendar:
        row = parse_json_value(envelope['payload'], {})
        if envelope['source'] == 'cohort':
            cohorts.append(row)
        elif envelope['source'] != 'authored' or not holiday_row_archived(row):
            holidays.append(row)
    if not cohorts:
        return {}
    holidays.sort(key=holiday_row_sort_key)
    return {clean_str(cohort['cohort_id']): scheduling_holidays_from(
                holidays, cohort.get('start_date'), parse_json_value(cohort.get('excluded_holiday_ids'), []))
            for cohort in cohorts if clean_str(cohort.get('cohort_id'))}
