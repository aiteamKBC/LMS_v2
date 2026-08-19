"""Pure duration/validation rules for Learner Journal Actual Hours.

No database, no clock, no network, no randomness — every function here is a
deterministic function of its arguments, which is what makes the boundaries
testable to the second.

Canonical unit is **integer seconds**. ``Last_audit.activity_actual_hours.actual_hours``
stores *decimal hours* (``numeric``, observed to 4 dp), so conversion happens
only at the storage boundary, in Decimal, never in binary floating point.
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


RULE_VERSION = "actual-hours/2026-08-14"

# --- canonical constants (seconds) ------------------------------------------

MINUTE = 60
# Reading and Quiz reference/planned duration: 29 minutes. Used for comparison
# and classification ONLY — it is never written to actual_hours automatically.
READING_QUIZ_REFERENCE_SECONDS = 29 * MINUTE                      # 1740

TIMESTAMPED_READING_NORMAL_MIN = 768                              # 00:12:48
TIMESTAMPED_READING_NORMAL_MAX = 1999                             # 00:33:19

INPUT_READING_NORMAL_MIN = 14 * MINUTE                            # 840  = 00:14:00
INPUT_READING_NORMAL_MAX = 44 * MINUTE                            # 2640 = 00:44:00

# Both Reading/Quiz variants share the same maximum: 2 x 29 minutes.
READING_QUIZ_MAX_SECONDS = 2 * READING_QUIZ_REFERENCE_SECONDS     # 3480 = 00:58:00

TIMESTAMPED_MEDIA_TOLERANCE_SECONDS = 766                         # 00:12:46
INPUT_MEDIA_TOLERANCE_SECONDS = 15 * MINUTE                       # 900

# Permitted auditor offsets for a new Input video/audio proposal.
INPUT_MEDIA_OFFSETS_SECONDS = (-900, -600, -300, 0, 300, 600, 900)
# The same set expressed in minutes — the offsets an auditor may choose for a
# calculation run. ±15 keeps a Reading/Quiz value inside its 14–44 minute normal
# range and a media value inside media ± 15 minutes.
PERMITTED_OFFSET_MINUTES = tuple(offset // 60 for offset in INPUT_MEDIA_OFFSETS_SECONDS)

MINIMUM_DURATION_SECONDS = MINUTE                                 # below this is blocking

# Auditor-entered Reading/Quiz values are reported on a 5-minute grid, so a
# report reads 15/20/25/30/35/40 rather than 14/19/24/29/34/39.
INPUT_GRID_SECONDS = 5 * MINUTE

# --- working time -----------------------------------------------------------

WORKING_TIMEZONE = "Europe/London"
WORKING_DAY_START = datetime.time(9, 0, 0)
WORKING_DAY_END = datetime.time(17, 0, 0)
WORKING_WEEKDAYS = frozenset({0, 1, 2, 3, 4})                     # Mon-Fri

# --- domain vocabulary ------------------------------------------------------

SOURCE_TIMESTAMPED = "timestamped"
SOURCE_INPUT = "input"
SOURCE_OTHER = "other"
SOURCE_ATTENDANCE = "attendance"

# LMS kinds eligible for this feature. Attendance and assignment/Aptem rows are
# out of scope by contract and must keep their existing behaviour untouched.
ELIGIBLE_KINDS = frozenset({"reading_quiz", "video", "audio"})
MEDIA_KINDS = frozenset({"video", "audio"})

SEVERITY_INFO = "informational"
SEVERITY_WARNING = "warning"
SEVERITY_BLOCKING = "blocking"

BAND_BELOW_MINIMUM = "below_minimum"
BAND_BELOW_NORMAL = "below_normal"
BAND_NORMAL = "normal"
BAND_LONG_TAIL = "long_tail"
BAND_EXCESSIVE = "excessive"
BAND_UNCLASSIFIABLE = "unclassifiable"

# Validation codes (stable identifiers stored in the database).
CODE_START_BEFORE_HOURS = "start_before_working_hours"
CODE_START_AT_OR_AFTER_CLOSE = "start_at_or_after_closing_time"
CODE_END_AFTER_CLOSE = "end_after_closing_time"
CODE_END_NOT_AFTER_START = "end_not_after_start"
CODE_WEEKEND = "weekend_activity"
CODE_BANK_HOLIDAY = "england_wales_bank_holiday"
CODE_CALENDAR_UNAVAILABLE = "bank_holiday_calendar_unavailable"
CODE_DURATION_BELOW_MINUTE = "duration_below_one_minute"
CODE_BELOW_EXPECTED_RANGE = "below_expected_duration_range"
CODE_LONG_TAIL = "long_tail_duration"
CODE_EXCEEDS_DOUBLE = "exceeds_double_reference_duration"
CODE_MISSING_MEDIA_DURATION = "missing_media_duration"
CODE_UNRECOGNISED_SOURCE = "unrecognized_source"
CODE_DUPLICATE_INTERVAL = "duplicate_timestamp_interval"
CODE_OVERLAPPING_INTERVAL = "overlapping_timestamp_interval"
CODE_MISSING_TIMESTAMP = "timestamped_row_missing_timestamp"
# Local addition: the ingest timezone convention for the stored wall-clock
# columns is unconfirmed (plan blocker B3). Raised against timestamp-derived
# proposals so nothing timestamp-derived can be approved while it stands.
CODE_TIMESTAMP_SEMANTICS_UNCONFIRMED = "timestamp_semantics_unconfirmed"

BLOCKING_CODES = frozenset({
    CODE_START_BEFORE_HOURS,
    CODE_START_AT_OR_AFTER_CLOSE,
    CODE_END_AFTER_CLOSE,
    CODE_END_NOT_AFTER_START,
    CODE_WEEKEND,
    CODE_BANK_HOLIDAY,
    CODE_CALENDAR_UNAVAILABLE,
    CODE_DURATION_BELOW_MINUTE,
    CODE_EXCEEDS_DOUBLE,
    CODE_DUPLICATE_INTERVAL,
    CODE_OVERLAPPING_INTERVAL,
    CODE_MISSING_TIMESTAMP,
    CODE_TIMESTAMP_SEMANTICS_UNCONFIRMED,
})

# Analytics thresholds — review levels, never generation targets.
EXPECTED_TIMESTAMPED_SHARE = Decimal("0.23")
SOURCE_EXCEPTION_THRESHOLD = Decimal("0.075")
LONG_TAIL_THRESHOLD = Decimal("0.093")


# --- storage conversion -----------------------------------------------------

SECONDS_PER_HOUR = Decimal(3600)
# The column is numeric; every genuine value observed in Last_audit carries at
# most 4 dp, and 4 dp round-trips every rule boundary exactly (see tests).
HOURS_QUANTUM = Decimal("0.0001")


def hours_to_seconds(value) -> int | None:
    """Storage decimal hours -> canonical integer seconds."""
    if value is None:
        return None
    return int((Decimal(str(value)) * SECONDS_PER_HOUR).to_integral_value(rounding=ROUND_HALF_UP))


def seconds_to_hours(seconds) -> Decimal | None:
    """Canonical integer seconds -> storage decimal hours (never float)."""
    if seconds is None:
        return None
    return (Decimal(int(seconds)) / SECONDS_PER_HOUR).quantize(HOURS_QUANTUM, rounding=ROUND_HALF_UP)


def snap_to_grid(seconds, grid_seconds=INPUT_GRID_SECONDS) -> int:
    """Round to the nearest grid step, halves upward.

    Used only for generated Reading/Quiz values — a genuine measured duration is
    never snapped.
    """
    if seconds is None:
        return None
    steps = (int(seconds) + grid_seconds // 2) // grid_seconds
    return int(steps * grid_seconds)


def minutes_to_seconds(value) -> int | None:
    """Media ``configured_duration_min`` (numeric minutes) -> seconds."""
    if value is None:
        return None
    seconds = int((Decimal(str(value)) * MINUTE).to_integral_value(rounding=ROUND_HALF_UP))
    return seconds if seconds > 0 else None


# --- source classification --------------------------------------------------

_TIME_RANGE_LABEL = re.compile(r"^\d{2}:\d{2}:\d{2}-\d{2}:\d{2}:\d{2}$")


def source_category(reporting_method, timestamp_label=None) -> str:
    """Map the stored source onto the contract's categories.

    ``reporting_method`` is the categorical column (``System`` / ``Input`` /
    ``Attendance``); ``timestamp_label`` is a display string that carries either
    ``Input``, ``attended``/``not attended`` or an ``HH:MM:SS-HH:MM:SS`` range.
    The raw values are never rewritten — this only reads them.
    """
    method = (reporting_method or "").strip().lower()
    if method == "system":
        return SOURCE_TIMESTAMPED
    if method == "input":
        return SOURCE_INPUT
    if method == "attendance":
        return SOURCE_ATTENDANCE
    label = (timestamp_label or "").strip()
    if _TIME_RANGE_LABEL.match(label):
        return SOURCE_TIMESTAMPED
    if label.lower() == "input":
        return SOURCE_INPUT
    return SOURCE_OTHER


# --- working-time validation ------------------------------------------------

@dataclass(frozen=True)
class Finding:
    code: str
    severity: str
    message: str
    details: dict

    @property
    def is_blocking(self) -> bool:
        return self.severity == SEVERITY_BLOCKING


def _finding(code, message, severity=None, **details) -> Finding:
    resolved = severity or (SEVERITY_BLOCKING if code in BLOCKING_CODES else SEVERITY_WARNING)
    return Finding(code=code, severity=resolved, message=message, details=details)


def working_time_findings(activity_date, start_time, end_time, *, holiday_status) -> list[Finding]:
    """Validate one row's genuine wall-clock against the working-time contract.

    ``holiday_status`` is the result of a bank-holiday lookup: ``True`` (holiday),
    ``False`` (not a holiday) or ``None`` (calendar unavailable → blocking, never
    silently treated as an ordinary day).

    The stored values are only read. Nothing here shifts, truncates or clamps a
    timestamp to make a row pass.
    """
    findings: list[Finding] = []
    if start_time is None or end_time is None:
        findings.append(_finding(
            CODE_MISSING_TIMESTAMP,
            "A time-stamped row is missing its start or end time.",
        ))
        return findings

    if activity_date is not None:
        if activity_date.weekday() not in WORKING_WEEKDAYS:
            findings.append(_finding(
                CODE_WEEKEND,
                f"{activity_date.isoformat()} is a {activity_date.strftime('%A')}.",
                date=activity_date.isoformat(),
            ))
        if holiday_status is None:
            findings.append(_finding(
                CODE_CALENDAR_UNAVAILABLE,
                f"No England and Wales bank-holiday calendar is available for {activity_date.year}.",
                date=activity_date.isoformat(),
            ))
        elif holiday_status:
            findings.append(_finding(
                CODE_BANK_HOLIDAY,
                f"{activity_date.isoformat()} is an England and Wales bank holiday.",
                date=activity_date.isoformat(),
            ))

    if start_time < WORKING_DAY_START:
        findings.append(_finding(
            CODE_START_BEFORE_HOURS,
            f"Starts at {start_time.isoformat()}, before 09:00:00.",
            start=start_time.isoformat(),
        ))
    if start_time >= WORKING_DAY_END:
        findings.append(_finding(
            CODE_START_AT_OR_AFTER_CLOSE,
            f"Starts at {start_time.isoformat()}, at or after 17:00:00.",
            start=start_time.isoformat(),
        ))
    if end_time > WORKING_DAY_END:
        findings.append(_finding(
            CODE_END_AFTER_CLOSE,
            f"Ends at {end_time.isoformat()}, after 17:00:00.",
            end=end_time.isoformat(),
        ))
    if end_time <= start_time:
        findings.append(_finding(
            CODE_END_NOT_AFTER_START,
            f"Ends at {end_time.isoformat()}, which is not after {start_time.isoformat()}.",
            start=start_time.isoformat(),
            end=end_time.isoformat(),
        ))
    return findings


def elapsed_seconds(start_time, end_time) -> int | None:
    """Genuine elapsed seconds between two same-day wall-clock times.

    Only the stored values are used. A negative or zero result is returned as-is
    for the validator to flag — it is never clamped into a valid range.
    """
    if start_time is None or end_time is None:
        return None
    start = start_time.hour * 3600 + start_time.minute * 60 + start_time.second
    end = end_time.hour * 3600 + end_time.minute * 60 + end_time.second
    return end - start


# --- duration classification ------------------------------------------------

@dataclass(frozen=True)
class Classification:
    band: str
    normal_min: int | None
    normal_max: int | None
    maximum: int | None
    reference_seconds: int | None
    reason: str = ""

    @property
    def is_long_tail(self) -> bool:
        return self.band == BAND_LONG_TAIL

    @property
    def is_classifiable(self) -> bool:
        return self.band != BAND_UNCLASSIFIABLE

    def finding(self) -> Finding | None:
        if self.band == BAND_BELOW_MINIMUM:
            return _finding(CODE_DURATION_BELOW_MINUTE, self.reason or "Duration is below one minute.")
        if self.band == BAND_BELOW_NORMAL:
            return _finding(CODE_BELOW_EXPECTED_RANGE, self.reason or "Duration is below the expected range.")
        if self.band == BAND_LONG_TAIL:
            return _finding(CODE_LONG_TAIL, self.reason or "Duration is in the long-tail review range.")
        if self.band == BAND_EXCESSIVE:
            return _finding(CODE_EXCEEDS_DOUBLE, self.reason or "Duration exceeds twice the reference duration.")
        if self.band == BAND_UNCLASSIFIABLE:
            return _finding(CODE_MISSING_MEDIA_DURATION, self.reason or "No media duration is available.")
        return None


def _classify_against(seconds, *, normal_min, normal_max, maximum, reference):
    """Shared band logic. ``normal_min`` is already floored at one minute."""
    if seconds is None:
        return Classification(BAND_UNCLASSIFIABLE, normal_min, normal_max, maximum, reference,
                              "No duration is available.")
    if seconds < MINIMUM_DURATION_SECONDS:
        return Classification(BAND_BELOW_MINIMUM, normal_min, normal_max, maximum, reference,
                              f"{seconds}s is below the one-minute minimum.")
    if maximum is not None and seconds > maximum:
        return Classification(BAND_EXCESSIVE, normal_min, normal_max, maximum, reference,
                              f"{seconds}s exceeds the {maximum}s maximum.")
    if seconds < normal_min:
        return Classification(BAND_BELOW_NORMAL, normal_min, normal_max, maximum, reference,
                              f"{seconds}s is below the expected {normal_min}s-{normal_max}s range.")
    if seconds <= normal_max:
        return Classification(BAND_NORMAL, normal_min, normal_max, maximum, reference)
    # Above the normal range but within the maximum. When the normal upper bound
    # already reaches the maximum the long-tail interval is empty by definition,
    # and this branch is unreachable rather than invented.
    return Classification(BAND_LONG_TAIL, normal_min, normal_max, maximum, reference,
                          f"{seconds}s is above the expected {normal_max}s upper bound.")


def classify_timestamped_reading_quiz(seconds) -> Classification:
    return _classify_against(
        seconds,
        normal_min=TIMESTAMPED_READING_NORMAL_MIN,
        normal_max=TIMESTAMPED_READING_NORMAL_MAX,
        maximum=READING_QUIZ_MAX_SECONDS,
        reference=READING_QUIZ_REFERENCE_SECONDS,
    )


def classify_input_reading_quiz(seconds) -> Classification:
    return _classify_against(
        seconds,
        normal_min=INPUT_READING_NORMAL_MIN,
        normal_max=INPUT_READING_NORMAL_MAX,
        maximum=READING_QUIZ_MAX_SECONDS,
        reference=READING_QUIZ_REFERENCE_SECONDS,
    )


def _media_bounds(media_seconds, tolerance):
    """Normal range and maximum for a media-relative rule.

    One minute is used only as the lower validation floor; the stored duration is
    never clamped. When ``normal_max >= 2 * media`` the long-tail interval is
    empty and ``_classify_against`` simply never reports one.
    """
    normal_min = max(MINIMUM_DURATION_SECONDS, media_seconds - tolerance)
    normal_max = media_seconds + tolerance
    maximum = 2 * media_seconds
    return normal_min, normal_max, maximum


def classify_timestamped_media(seconds, media_seconds) -> Classification:
    if not media_seconds:
        return Classification(BAND_UNCLASSIFIABLE, None, None, None, None,
                              "No configured media duration — media-relative validation is unavailable.")
    normal_min, normal_max, maximum = _media_bounds(media_seconds, TIMESTAMPED_MEDIA_TOLERANCE_SECONDS)
    return _classify_against(seconds, normal_min=normal_min, normal_max=normal_max,
                             maximum=maximum, reference=media_seconds)


def classify_input_media(seconds, media_seconds) -> Classification:
    if not media_seconds:
        return Classification(BAND_UNCLASSIFIABLE, None, None, None, None,
                              "No configured media duration — media-relative validation is unavailable.")
    normal_min, normal_max, maximum = _media_bounds(media_seconds, INPUT_MEDIA_TOLERANCE_SECONDS)
    return _classify_against(seconds, normal_min=normal_min, normal_max=normal_max,
                             maximum=maximum, reference=media_seconds)


def classify(kind, source, seconds, media_seconds=None) -> Classification:
    """Classify one row by activity kind and source category."""
    if kind in MEDIA_KINDS:
        if source == SOURCE_TIMESTAMPED:
            return classify_timestamped_media(seconds, media_seconds)
        return classify_input_media(seconds, media_seconds)
    if source == SOURCE_TIMESTAMPED:
        return classify_timestamped_reading_quiz(seconds)
    return classify_input_reading_quiz(seconds)


# --- auditor proposal validation -------------------------------------------

class ProposalError(ValueError):
    """A proposed value that the contract does not permit."""


def validate_input_reading_proposal(seconds) -> int:
    """Whole minutes only; no random seconds are ever added, and an invalid
    value is rejected rather than clamped."""
    if seconds is None:
        raise ProposalError("A proposed duration is required.")
    seconds = int(seconds)
    if seconds % MINUTE:
        raise ProposalError("A Reading/Quiz proposal must be a whole number of minutes.")
    if seconds < MINIMUM_DURATION_SECONDS:
        raise ProposalError("A proposal must be at least one minute.")
    if seconds > READING_QUIZ_MAX_SECONDS:
        raise ProposalError("A proposal may not exceed 00:58:00 (twice the 29-minute reference).")
    return seconds


def permitted_media_offsets(media_seconds) -> list[int]:
    """The offsets that produce at least one minute for this media duration."""
    if not media_seconds:
        return []
    return [offset for offset in INPUT_MEDIA_OFFSETS_SECONDS
            if media_seconds + offset >= MINIMUM_DURATION_SECONDS]


def validate_input_media_proposal(seconds, media_seconds) -> int:
    """A media proposal must be the genuine media duration plus a permitted
    offset. Values outside that set are rejected, never clamped."""
    if not media_seconds:
        raise ProposalError("This activity has no configured media duration, so a "
                            "media-relative proposal cannot be validated.")
    if seconds is None:
        raise ProposalError("A proposed duration is required.")
    seconds = int(seconds)
    offset = seconds - media_seconds
    if offset not in permitted_media_offsets(media_seconds):
        allowed = ", ".join(f"{value // MINUTE:+d}m" for value in permitted_media_offsets(media_seconds))
        raise ProposalError(f"A video/audio proposal must be the media duration with one of: {allowed}.")
    if seconds < MINIMUM_DURATION_SECONDS:
        raise ProposalError("A proposal must be at least one minute.")
    return seconds


def validate_proposal(kind, seconds, media_seconds=None) -> int:
    if kind in MEDIA_KINDS:
        return validate_input_media_proposal(seconds, media_seconds)
    return validate_input_reading_proposal(seconds)


# --- overlap detection ------------------------------------------------------

def intervals_overlap(first_start, first_end, second_start, second_end) -> bool:
    """Half-open ``[start, end)`` overlap. Touching intervals do not overlap."""
    return first_start < second_end and second_start < first_end


def is_duplicate_interval(first_start, first_end, second_start, second_end) -> bool:
    return first_start == second_start and first_end == second_end


# --- analytics --------------------------------------------------------------

@dataclass(frozen=True)
class SourceAnalytics:
    eligible: int
    timestamped: int
    input: int
    other: int
    expected_timestamped: int
    expected_input: int
    exception_count: int
    exception_rate: Decimal | None
    status: str


def source_analytics(timestamped, input_count, other) -> SourceAnalytics:
    """The contract's exact 7.5% exception formula. Read-only: this never
    changes a stored source to improve the ratio."""
    total = int(timestamped) + int(input_count) + int(other)
    if total == 0:
        return SourceAnalytics(0, 0, 0, 0, 0, 0, 0, None, "no eligible records")
    expected_timestamped = int((Decimal(total) * EXPECTED_TIMESTAMPED_SHARE)
                               .to_integral_value(rounding=ROUND_HALF_UP))
    expected_input = total - expected_timestamped
    exception_count = (total
                       - min(int(timestamped), expected_timestamped)
                       - min(int(input_count), expected_input))
    rate = (Decimal(exception_count) / Decimal(total)).quantize(Decimal("0.000001"))
    status = "alert" if rate > SOURCE_EXCEPTION_THRESHOLD else "within expectation"
    return SourceAnalytics(total, int(timestamped), int(input_count), int(other),
                           expected_timestamped, expected_input, exception_count, rate, status)


@dataclass(frozen=True)
class LongTailAnalytics:
    eligible: int
    classifiable: int
    long_tail: int
    unclassifiable: int
    rate: Decimal | None
    status: str


def long_tail_analytics(eligible, classifiable, long_tail, unclassifiable) -> LongTailAnalytics:
    """``classifiable`` counts every row a rule can place in a band — including
    the two blocking bands. ``unclassifiable`` is missing-media only. That split
    is fixed here so the reported rate cannot drift with the caller."""
    if not classifiable:
        return LongTailAnalytics(int(eligible), 0, int(long_tail), int(unclassifiable),
                                 None, "no classifiable records")
    rate = (Decimal(int(long_tail)) / Decimal(int(classifiable))).quantize(Decimal("0.000001"))
    status = "above expected level" if rate > LONG_TAIL_THRESHOLD else "within expected level"
    return LongTailAnalytics(int(eligible), int(classifiable), int(long_tail),
                             int(unclassifiable), rate, status)
