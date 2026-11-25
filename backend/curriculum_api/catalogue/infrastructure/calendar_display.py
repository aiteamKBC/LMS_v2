"""Display cohort holiday read failures only on the affected cohort."""
from .cohort_calendar_composition import cohort_selected_holidays_by_cohort


def display_cohort_holidays(cohort_ids):
    """Keep a failed country scoped to its own rows in a multi-cohort read."""
    from .country_calendar_reads import CalendarUnavailable
    result = {}
    for identifier in dict.fromkeys(cohort_ids):
        try:
            result.update(cohort_selected_holidays_by_cohort([identifier]))
        except CalendarUnavailable as exc:
            result[identifier] = [{'_calendarError': str(exc)}]
    return result
