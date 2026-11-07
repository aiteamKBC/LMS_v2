"""Plan identity/status updates without rebuilding a learner's delivery record.

The imported Aptem row is evidence only for the fields it actually supplies.
Missing rows/statuses never mean withdrawal, and Aptem Active never bypasses
the LMS invitation, compliance or deliberate local lifecycle decisions.
"""

import re


def text(value):
    return "" if value is None else str(value).strip()


def aptem_id(value):
    value = text(value)
    if not re.fullmatch(r"[0-9]{1,19}", value):
        return None
    number = int(value)
    return str(number) if 0 < number <= 9223372036854775807 else None


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
    ident = aptem_id(source.get("aptem_id"))
    if not ident or ident != aptem_id(enrolment.aptem_id):
        result["review"].append("identity_mismatch")
        return result
    if profile is not None and (
        profile.enrolment_id != enrolment.pk
        or (text(profile.aptem_id) and aptem_id(profile.aptem_id) != ident)
    ):
        result["review"].append("profile_identity_mismatch")
        return result
    if account is not None and (
        account.subject_type != "learner" or account.subject_id != enrolment.pk
    ):
        result["review"].append("account_identity_mismatch")
        return result

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
