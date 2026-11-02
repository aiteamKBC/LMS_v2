"""Official programme Planned Hours: one read-only selector.

The official programme total is ``"Learner".learners.planned_hours`` of the
learner's verified canonical profile, and nothing else. A missing value is
"not set", a stored zero is a real zero, and a value that cannot be a total
(negative, non-finite, malformed) is "invalid" -- reported as unavailable while
the stored value is left exactly as it is.

No other figure stands in for it: not ``Created_users.Planned_hours``, contract
documents, Training Plan or module totals, monthly or weekly targets, review
hours or historical snapshots. Those remain separate metrics with their own
names.

Profiles are found only through ``learners.enrolment_id`` and verified with the
same rules as ``canonical_learning.profile``. A learner profile id is never
matched against an enrolment id, there is no email fallback, and nothing here
writes.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

from old_otjh.repository import query
from old_otjh.service import ServiceError

from .canonical_learning import _validated_profile

SET = "set"
NOT_SET = "not_set"
INVALID = "invalid"
NO_PROFILE = "no_profile"
AMBIGUOUS_PROFILE = "ambiguous_profile"
IDENTITY_REVIEW_REQUIRED = "identity_review_required"

#: Four decimal places, as the existing programme total is presented.
_PRECISION = Decimal("0.0001")

_PROFILES_SQL = '''SELECT l.id,l.enrolment_id,l.aptem_id,l.email,
        l.planned_hours AS programme_planned_hours,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=ANY(%s)'''


@dataclass(frozen=True)
class OfficialPlannedHours:
    """The official total for one enrolment, with why it is or is not available.

    ``hours`` is set only when ``status`` is ``"set"``; ``learner_id`` only when
    exactly one verified profile exists. Internal: not an API shape.
    """

    hours: float | None
    status: str
    learner_id: int | None = None


def _as_decimal(value):
    # A float is converted through its shortest repr, so 1.00005 is rounded as
    # 1.00005 rather than as the binary fraction that happens to sit above it.
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        return Decimal(repr(value))
    if isinstance(value, str):
        # Decimal accepts "1_000"; a stored total written that way is malformed.
        if "_" in value:
            raise ValueError("digit separators are not a stored number")
        return Decimal(value)
    raise TypeError(type(value).__name__)


def normalise_official_planned_hours(value):
    """``(hours, status)`` for a stored official value. Pure; never raises.

    ``None`` -> ``(None, "not_set")``; a finite value >= 0 -> its float rounded
    half-even to four places with ``"set"`` (``0`` and ``-0`` both give
    ``0.0``); anything negative, non-finite, boolean or malformed ->
    ``(None, "invalid")``.
    """
    if value is None:
        return None, NOT_SET
    # bool is an int subclass: True must not read as one hour.
    if isinstance(value, bool):
        return None, INVALID
    try:
        number = _as_decimal(value)
        # Finite first: comparing a NaN raises.
        if not number.is_finite() or number < 0:
            return None, INVALID
        rounded = number.quantize(_PRECISION, rounding=ROUND_HALF_EVEN)
    except (TypeError, ValueError, InvalidOperation):
        return None, INVALID
    # + 0.0 turns the -0.0 of Decimal("-0") into 0.0.
    return float(rounded) + 0.0, SET


def official_planned_hours(owner):
    """The official total for an already verified canonical owner, or None.

    ``owner`` is a profile row from ``canonical_learning.profile`` /
    ``metrics_bulk``; it is not re-read or re-verified. ``None`` means there is
    no owner. A row without ``programme_planned_hours`` is a caller defect and
    raises ``KeyError`` rather than passing for "not set".
    """
    if owner is None:
        return None
    return normalise_official_planned_hours(owner["programme_planned_hours"])[0]


def _enrolment_ids(values):
    ids = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise TypeError(f"An enrolment id must be an int or a string of digits, not {type(value).__name__}.")
        if isinstance(value, str):
            text = value.strip()
            if not text.isascii() or not text.isdigit():
                raise ValueError("An enrolment id string must contain only digits.")
            value = int(text)
        ids.append(value)
    return list(dict.fromkeys(ids))


def official_planned_hours_for_enrolments(enrolment_ids):
    """``{enrolment_id: OfficialPlannedHours}`` for every distinct id given.

    One query for the whole set, matched on ``learners.enrolment_id`` only.
    An enrolment with no profile, more than one, or a profile that fails the
    canonical identity checks has no official total -- no row is picked and no
    other source is consulted. Database errors propagate to the caller.
    """
    ids = _enrolment_ids(enrolment_ids)
    result = {enrolment_id: OfficialPlannedHours(None, NO_PROFILE) for enrolment_id in ids}
    lookup = [enrolment_id for enrolment_id in ids if enrolment_id > 0]
    if not lookup:
        return result

    candidates = {}
    for row in query(_PROFILES_SQL, [lookup]):
        enrolment_id = row.get("enrolment_id")
        if enrolment_id is None or int(enrolment_id) not in result:
            continue
        candidates.setdefault(int(enrolment_id), []).append(row)

    for enrolment_id, rows in candidates.items():
        if len(rows) != 1:
            result[enrolment_id] = OfficialPlannedHours(None, AMBIGUOUS_PROFILE)
            continue
        try:
            owner = _validated_profile(rows[0])
        except ServiceError:
            result[enrolment_id] = OfficialPlannedHours(None, IDENTITY_REVIEW_REQUIRED)
            continue
        hours, status = normalise_official_planned_hours(owner["programme_planned_hours"])
        result[enrolment_id] = OfficialPlannedHours(hours, status, int(owner["id"]))
    return result
