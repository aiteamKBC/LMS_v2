"""Pure holiday source, archive and period rules over ordinary Python values."""

from curriculum_api.catalogue.domain.hierarchy_dates import calculate_cohort_end_date as _default_calculate_cohort_end_date
from curriculum_api.catalogue.domain.hierarchy_values import extract_notes_meta as _default_extract_notes_meta
from curriculum_api.catalogue.domain.read_contracts import HOLIDAY_SOURCE_AUTHORED as _default_HOLIDAY_SOURCE_AUTHORED
from curriculum_api.catalogue.domain.read_contracts import HOLIDAY_SOURCE_GOVUK as _default_HOLIDAY_SOURCE_GOVUK
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import truthy as _default_truthy


def holiday_row_archived(
    row,
    *,
    truthy=_default_truthy,
    clean_str=_default_clean_str,
    extract_notes_meta=_default_extract_notes_meta,
):
    """Whether an authored holiday has been archived, however it was recorded.

    ``archive_payload`` sets whichever of ``is_archived``/``status``/``notes``
    the table happens to carry, so the read side has to accept all three.
    """
    row = row or {}
    return bool(
        truthy(row.get('is_archived'))
        or truthy(row.get('archived'))
        or clean_str(row.get('status')).lower() == 'archived'
        or truthy(extract_notes_meta(row.get('notes')).get('archived'))
    )


def cohort_holiday_period_end(
    cohort,
    *,
    format_date=_default_format_date,
    parse_int=_default_parse_int,
    calculate_cohort_end_date=_default_calculate_cohort_end_date,
):
    """The last date a cohort's holidays are drawn from.

    The practical end date -- the end of the delivery period, not the end of the
    EPA window that follows it. A cohort row that has lost its end date falls
    back to the contracted duration, which is the same rule
    ``cohort_authoring_payload`` writes the stored row with, so the two agree.
    """
    cohort = cohort or {}
    end_date = format_date(
        cohort.get('practicalEndDate') or cohort.get('practical_end_date')
        or cohort.get('endDate') or cohort.get('end_date')
    )
    if end_date:
        return end_date
    start_date = format_date(cohort.get('startDate') or cohort.get('start_date'))
    months = parse_int(cohort.get('durationMonths') or cohort.get('duration_months'), 0)
    if not start_date or months <= 0:
        return ''
    return format_date(calculate_cohort_end_date(start_date, months))


def holiday_row_source(
    row,
    *,
    clean_str=_default_clean_str,
    HOLIDAY_SOURCE_GOVUK=_default_HOLIDAY_SOURCE_GOVUK,
    HOLIDAY_SOURCE_AUTHORED=_default_HOLIDAY_SOURCE_AUTHORED,
):
    """Which of the two tables a holiday row came from.

    ``division`` and ``holiday_date`` are columns only the GOV.UK mirror has, so
    they identify a bank holiday without the caller having to say. An already
    serialized row states its own source and is believed.
    """
    row = row or {}
    stated = clean_str(row.get('source')).lower()
    if stated in {HOLIDAY_SOURCE_GOVUK, HOLIDAY_SOURCE_AUTHORED, 'calendarific'}:
        return stated
    if row.get('division') or row.get('holiday_date'):
        return HOLIDAY_SOURCE_GOVUK
    return HOLIDAY_SOURCE_AUTHORED


def date_ranges_overlap(left_start, left_end, right_start, right_end, *, parse_date=_default_parse_date):
    left_start = parse_date(left_start)
    left_end = parse_date(left_end) or left_start
    right_start = parse_date(right_start)
    right_end = parse_date(right_end) or right_start
    if not left_start or not left_end or not right_start or not right_end:
        return False
    return left_start <= right_end and right_start <= left_end
