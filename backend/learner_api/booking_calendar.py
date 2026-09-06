"""Working-day rules for learner calendar bookings.

The college is in England, so "UK bank holiday" means the official GOV.UK
``england-and-wales`` division.  Requests must not call GOV.UK live: booking
availability has to remain deterministic when an external service is down.
The dates below mirror the published feed and deliberately fail closed for a
year the checked-in calendar does not cover.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class BookingDateRestriction:
    code: str
    message: str


# Source: https://www.gov.uk/bank-holidays.json, division england-and-wales.
# Includes substitute days exactly as published by GOV.UK.
ENGLAND_WALES_BANK_HOLIDAYS = {
    # 2024
    date(2024, 1, 1): "New Year's Day",
    date(2024, 3, 29): "Good Friday",
    date(2024, 4, 1): "Easter Monday",
    date(2024, 5, 6): "Early May bank holiday",
    date(2024, 5, 27): "Spring bank holiday",
    date(2024, 8, 26): "Summer bank holiday",
    date(2024, 12, 25): "Christmas Day",
    date(2024, 12, 26): "Boxing Day",
    # 2025
    date(2025, 1, 1): "New Year's Day",
    date(2025, 4, 18): "Good Friday",
    date(2025, 4, 21): "Easter Monday",
    date(2025, 5, 5): "Early May bank holiday",
    date(2025, 5, 26): "Spring bank holiday",
    date(2025, 8, 25): "Summer bank holiday",
    date(2025, 12, 25): "Christmas Day",
    date(2025, 12, 26): "Boxing Day",
    # 2026
    date(2026, 1, 1): "New Year's Day",
    date(2026, 4, 3): "Good Friday",
    date(2026, 4, 6): "Easter Monday",
    date(2026, 5, 4): "Early May bank holiday",
    date(2026, 5, 25): "Spring bank holiday",
    date(2026, 8, 31): "Summer bank holiday",
    date(2026, 12, 25): "Christmas Day",
    date(2026, 12, 28): "Boxing Day (substitute day)",
    # 2027
    date(2027, 1, 1): "New Year's Day",
    date(2027, 3, 26): "Good Friday",
    date(2027, 3, 29): "Easter Monday",
    date(2027, 5, 3): "Early May bank holiday",
    date(2027, 5, 31): "Spring bank holiday",
    date(2027, 8, 30): "Summer bank holiday",
    date(2027, 12, 27): "Christmas Day (substitute day)",
    date(2027, 12, 28): "Boxing Day (substitute day)",
    # 2028
    date(2028, 1, 3): "New Year's Day (substitute day)",
    date(2028, 4, 14): "Good Friday",
    date(2028, 4, 17): "Easter Monday",
    date(2028, 5, 1): "Early May bank holiday",
    date(2028, 5, 29): "Spring bank holiday",
    date(2028, 8, 28): "Summer bank holiday",
    date(2028, 12, 25): "Christmas Day",
    date(2028, 12, 26): "Boxing Day",
}

COVERED_YEARS = frozenset(range(2024, 2029))


def booking_date_restriction(day: date | None) -> BookingDateRestriction | None:
    """Why no learner session may be booked on ``day``, or ``None``."""
    if day is None:
        return BookingDateRestriction("invalid-date", "Choose a valid booking date.")
    if day.weekday() >= 5:
        return BookingDateRestriction(
            "weekend",
            "Sessions cannot be booked on Saturdays or Sundays.",
        )
    holiday = ENGLAND_WALES_BANK_HOLIDAYS.get(day)
    if holiday:
        return BookingDateRestriction(
            "bank-holiday",
            f"Sessions cannot be booked on UK bank holidays ({holiday}).",
        )
    if day.year not in COVERED_YEARS:
        return BookingDateRestriction(
            "calendar-unavailable",
            "Sessions cannot be booked because the UK bank-holiday calendar is not available for this year.",
        )
    return None


def booking_calendar_payload() -> dict:
    """Client-safe dates used to draw the same closed days as the server."""
    return {
        "division": "england-and-wales",
        "coveredYears": sorted(COVERED_YEARS),
        "bankHolidays": [
            {"date": day.isoformat(), "title": title}
            for day, title in sorted(ENGLAND_WALES_BANK_HOLIDAYS.items())
        ],
    }
