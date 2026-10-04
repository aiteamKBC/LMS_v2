"""Build monthly Training Plan targets from the matched learner snapshot.

The matched ``programme_structure`` is the preferred source when a month has
``hours.planned``.  Some current Aptem snapshots contain the month structure
but omit that summary object; for those rows the already-linked
``fetching_evidence.learner_hours_monthly`` plan is used as an explicit
fallback.  Activity time (``time_spent_seconds``) is deliberately never used
as a target.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import json
import re


SOURCE_SYSTEM = "aptem"
PROGRAMME_BASIS = "learner_match.programme_structure.months[].hours.planned"
FALLBACK_BASIS = "fetching_evidence.learner_hours_monthly.planned_hours_monthly"
UPDATED_BY = "Codex: user-authorized learner_match target sync"


def decode_json(value):
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def month_key(value):
    """Return a canonical YYYY-MM key, or None for undated/invalid values."""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m")
    text = str(value or "").strip()
    match = re.match(r"^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$", text)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        return f"{year:04d}-{month:02d}" if 1 <= month <= 12 else None
    for fmt in ("%B %Y", "%b %Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m")
        except ValueError:
            continue
    return None


def hours_value(value):
    """Parse a non-negative finite numeric target without using activity time."""
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        result = Decimal(str(value).strip()).quantize(Decimal("0.0001"))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return result if result.is_finite() and result >= 0 else None


def programme_structure_targets(raw):
    """Extract ``months[].hours.planned`` keyed by YYYY-MM."""
    structure = decode_json(raw)
    if not isinstance(structure, dict):
        return {}
    result = {}
    for item in structure.get("months") or []:
        if not isinstance(item, dict):
            continue
        month = month_key(item.get("date") or item.get("month"))
        hours = item.get("hours")
        planned = hours.get("planned") if isinstance(hours, dict) else None
        value = hours_value(planned)
        if month and value is not None:
            result[month] = value
    return result


def fallback_targets(raw):
    """Extract the linked monthly planned-hours map used when JSON lacks hours."""
    plan = decode_json(raw)
    if not isinstance(plan, dict):
        return {}
    result = {}
    for raw_month, raw_hours in plan.items():
        month = month_key(raw_month)
        value = hours_value(raw_hours)
        if month and value is not None:
            result[month] = value
    return result


def build_target_rows(learner_rows, match_rows, fallback_rows, scoped_aptem_ids=None):
    """Build idempotent destination rows without touching the database."""
    scoped = {str(value).strip() for value in (scoped_aptem_ids or []) if str(value).strip()}
    owners = defaultdict(list)
    for learner in learner_rows:
        aptem_id = str(learner.get("aptem_id") or "").strip()
        if aptem_id and (not scoped or aptem_id in scoped):
            owners[aptem_id].append(learner)

    matches = defaultdict(list)
    for match in match_rows:
        aptem_id = str(match.get("aptem_id") or "").strip()
        if aptem_id and (not scoped or aptem_id in scoped):
            matches[aptem_id].append(match)

    fallbacks = {}
    for row in fallback_rows:
        aptem_id = str(row.get("aptem_id") or "").strip()
        if aptem_id and (not scoped or aptem_id in scoped):
            fallbacks[aptem_id] = fallback_targets(row.get("planned_hours_monthly"))

    rows = []
    stats = defaultdict(int)
    stats["learner_match_rows"] = len(matches)
    for aptem_id, matched in matches.items():
        if not owners.get(aptem_id):
            stats["missing_learner"] += 1
            continue
        if len(owners[aptem_id]) != 1:
            stats["ambiguous_learner"] += 1
            continue
        if len(matched) != 1:
            stats["ambiguous_match"] += 1
            continue
        owner = owners[aptem_id][0]
        preferred = programme_structure_targets(matched[0].get("programme_structure"))
        fallback = fallbacks.get(aptem_id, {})
        if not preferred and not fallback:
            stats["no_target_hours"] += 1
        for month in sorted(set(preferred) | set(fallback)):
            if month in preferred:
                target, basis = preferred[month], PROGRAMME_BASIS
                source_ref = f"Audit.learner_match:{aptem_id}:{month}"
                stats["programme_structure_targets"] += 1
            else:
                target, basis = fallback[month], FALLBACK_BASIS
                source_ref = f"fetching_evidence.learner_hours_monthly:{aptem_id}:{month}"
                stats["fallback_targets"] += 1
            rows.append({
                "learner_id": owner["learner_id"],
                "enrolment_id": owner.get("enrolment_id"),
                "programme_id": str(owner["programme_id"]) if owner.get("programme_id") is not None else None,
                "report_month": month,
                "target_hours": target,
                "source_system": SOURCE_SYSTEM,
                "source_ref": source_ref,
                "basis": basis,
                "programme_profile_id": "",
                "updated_by": UPDATED_BY,
            })
    stats["target_rows"] = len(rows)
    return rows, dict(stats)
