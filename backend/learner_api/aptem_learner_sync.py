"""Plan identity/status updates without rebuilding a learner's delivery record.

The imported Aptem row is evidence only for the fields it actually supplies.
Missing rows/statuses never mean withdrawal, and Aptem Active never bypasses
the LMS invitation, compliance or deliberate local lifecycle decisions.
"""

import re
from datetime import date, datetime


def _date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(value.strip(), fmt).date()
            except ValueError:
                continue
    return None


def _plan_dates(source, enrolment, profile, result):
    """Sync programme dates independently of status, preserving missing facts.

    Learner-specific start/end overrides anchor reviews and are separate from
    these imported programme facts. No override, plan or meeting is rewritten.
    """
    dates = {}
    invalid = False
    for field in ("start_date", "end_date"):
        if field not in source:
            continue
        raw = source[field]
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            result["preserved"].append(f"missing_{field}")
            continue
        value = _date(raw)
        if value is None:
            result["review"].append(f"invalid_{field}")
            invalid = True
        else:
            dates[field] = value
    if invalid or not dates:
        return

    targets = [("enrolment", enrolment)]
    if profile is not None:
        targets.append(("profile", profile))
    for _, target in targets:
        window = {}
        for field in ("start_date", "end_date"):
            current = getattr(target, field, None)
            if field not in dates and current not in (None, "") and _date(current) is None:
                result["review"].append("unverifiable_existing_date_range")
                return
            window[field] = dates.get(field, _date(current))
        if window["start_date"] and window["end_date"] and window["end_date"] <= window["start_date"]:
            result["review"].append("invalid_date_range")
            return

    for name, target in targets:
        for field, value in dates.items():
            if _date(getattr(target, field, None)) != value:
                result[name][field] = value.isoformat() if name == "enrolment" else value


def text(value):
    return "" if value is None else str(value).strip()


def aptem_id(value):
    value = text(value)
    if not re.fullmatch(r"[0-9]{1,19}", value):
        return None
    number = int(value)
    return str(number) if 0 < number <= 9223372036854775807 else None


def linked_aptem_id(enrolment, profile=None):
    """Use the existing legacy profile ID only when the enrolment ID is absent."""
    if text(enrolment.aptem_id):
        return aptem_id(enrolment.aptem_id)
    if profile is not None and profile.enrolment_id == enrolment.pk:
        return aptem_id(profile.aptem_id)
    return None


def status_key(value):
    return re.sub(r"[^a-z0-9]", "", text(value).casefold())


def imported_status(value):
    key = status_key(value)
    if key in {"withdrawn", "withdrawnwofunding"}:
        return "Withdrawn"
    if key in {
        "onbreak", "onabreak", "breakinlearning", "bil",
        "onmaternitybreak", "onillnessbreak", "onotherbreak",
    }:
        return "On break"
    if key == "active":
        return "Active"
    if key == "completed":
        return "Completed"
    if key in {"enteredepa", "epa"}:
        return "EnteredEpa"
    if key in {"onboarding", "readytoenrol", "nonstarter", "underreview"}:
        return {"onboarding": "Onboarding", "readytoenrol": "Ready to enrol",
                "nonstarter": "NonStarter", "underreview": "UnderReview"}[key]
    return None


def plan_update(source, enrolment, profile=None, account=None):
    """Return only changed, permitted fields and explicit review reasons."""
    result = {"enrolment": {}, "profile": {}, "account": {}, "review": [], "preserved": []}
    if profile is not None and profile.enrolment_id != enrolment.pk:
        result["review"].append("profile_identity_mismatch")
        return result
    ident = aptem_id(source.get("aptem_id"))
    if not ident or ident != linked_aptem_id(enrolment, profile):
        result["review"].append("identity_mismatch")
        return result
    if profile is not None and (
        text(profile.aptem_id) and aptem_id(profile.aptem_id) != ident
    ):
        result["review"].append("profile_identity_mismatch")
        return result
    if account is not None and (
        account.subject_type != "learner" or account.subject_id != enrolment.pk
    ):
        result["review"].append("account_identity_mismatch")
        return result

    _plan_dates(source, enrolment, profile, result)

    name = text(source.get("full_name"))
    if name:
        if enrolment.username != name:
            result["enrolment"]["username"] = name
        if profile is not None and profile.full_name != name:
            result["profile"]["full_name"] = name
        if account is not None and account.display_name != name:
            result["account"]["display_name"] = name
    else:
        result["review"].append("missing_name")

    status = imported_status(source.get("programme_status"))
    if status is None:
        result["review"].append(
            "missing_status" if not text(source.get("programme_status")) else "unsupported_status"
        )
        return result

    local = text(enrolment.programme_status)
    # Withdrawal already takes precedence in learner_api.aptem_status. A break
    # must not reopen a locally withdrawn, completed, EPA or non-starter record.
    if status == "Withdrawn":
        target = status
    elif status == "On break" and status_key(local) not in {
        "withdrawn", "completed", "enteredepa", "epa", "nonstarter",
    }:
        target = status
    elif status in {"Completed", "EnteredEpa"} and status_key(local) not in {
        "", "freshuser", "onboarding", "delivery", "readytoenrol", "withdrawn",
    } and not (status == "EnteredEpa" and status_key(local) == "completed"):
        target = status
    else:
        target = local
        if imported_status(local) != status:
            result["preserved"].append("local_lifecycle")

    if not target:
        return result
    if enrolment.programme_status != target:
        result["enrolment"]["programme_status"] = target
    if profile is not None:
        if profile.programme_status != target:
            result["profile"]["programme_status"] = target
        lifecycle = target.casefold()
        if profile.lifecycle_status != lifecycle:
            result["profile"]["lifecycle_status"] = lifecycle
    return result
