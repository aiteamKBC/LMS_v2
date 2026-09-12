"""Resolve Aptem intake labels exclusively from Program Name.

No learner start date is accepted by this module. The parsed month is literal;
any business mapping to a different intake must be supplied separately.
"""

import re
from dataclasses import dataclass
from datetime import date


MONTHS = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}
INTAKE_PATTERN = re.compile(
    r'\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
    r'jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
    r'[\s./_-]*(\d{4}|\d{2})(?!\d)',
    re.IGNORECASE,
)


@dataclass(frozen=True)
class IntakeResolution:
    cohort_start: date | None
    issue: str | None

    @property
    def cohort_name(self):
        return self.cohort_start.strftime('%b %Y') if self.cohort_start else None


def parse_programme_intake(programme_name):
    if not programme_name or not programme_name.strip():
        return IntakeResolution(None, 'missing_programme_name')
    found = set()
    for month, raw_year in INTAKE_PATTERN.findall(programme_name):
        year = int(raw_year) + (2000 if len(raw_year) == 2 else 0)
        if not 1 <= year <= 9999:
            return IntakeResolution(None, 'invalid_intake_year')
        found.add(date(year, MONTHS[month[:3].lower()], 1))
    if not found:
        return IntakeResolution(None, 'intake_not_in_programme_name')
    if len(found) > 1:
        return IntakeResolution(None, 'multiple_intakes_in_programme_name')
    return IntakeResolution(found.pop(), None)
