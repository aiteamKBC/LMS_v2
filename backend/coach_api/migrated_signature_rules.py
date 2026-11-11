"""Template-owned signature policy for Aptem continuation reviews."""
from datetime import date, datetime


WAIVER_KEY = "mcmSignatureWaiver"

ROLES = ("advisor", "participant", "employer", "referrer")
CONFIGURABLE_ROLES = ROLES[:3]
FAMILY_REQUIRED_ROLES = {
    "MCM": ("advisor", "participant"),
    "PR": ("advisor", "participant", "employer"),
    "PR_SKILLS_RADAR": ("advisor", "participant", "employer"),
    "PSP": (),
}


def requirements_for_family(family):
    if family not in FAMILY_REQUIRED_ROLES:
        raise ValueError("Unsupported migrated review family.")
    return {role: role in FAMILY_REQUIRED_ROLES[family] for role in ROLES}


def validate_template_signatures(definition, family=None):
    if "signatures" not in definition:
        return
    rules = definition["signatures"]
    if (not isinstance(rules, dict) or set(rules) != set(CONFIGURABLE_ROLES)
            or any(type(value) is not bool for value in rules.values())):
        raise ValueError("Signatures must specify true or false for Coach, Learner and Employer only.")


def requirements_for_definition(definition, family):
    validate_template_signatures(definition, family)
    defaults = requirements_for_family(family)
    # Missing settings preserve the established defaults of existing templates.
    # An explicit all-false selection means completion without signatures.
    return {**defaults, **definition.get("signatures", {}), "referrer": False}


def signature_waiver(overlay, family):
    """Only an audited, explicitly selected historical MCM may be exempt.

    This metadata is written by the scoped maintenance command, never accepted
    from form payloads or inherited from a template or another review.
    """
    waiver = (getattr(overlay, "meeting_intelligence", None) or {}).get(WAIVER_KEY)
    if family != "MCM" or not isinstance(waiver, dict):
        return None
    if (waiver.get("version") != 1 or waiver.get("eventKey") != overlay.event_key
            or waiver.get("sourceReviewId") != overlay.source_review_id
            or waiver.get("learnerId") != overlay.learner_id
            or not waiver.get("reason") or not waiver.get("appliedBy")):
        return None
    try:
        meeting_day = date.fromisoformat(waiver["meetingDate"])
        cutoff = date.fromisoformat(waiver["before"])
        applied = datetime.fromisoformat(waiver["appliedAt"])
        if not applied.tzinfo or not meeting_day < cutoff <= applied.date():
            return None
    except (KeyError, TypeError, ValueError):
        return None
    return waiver


def requirements_for_overlay(overlay, family, *, definition=None):
    rules = requirements_for_definition(overlay.template_snapshot if definition is None else definition, family)
    return {role: False for role in ROLES} if signature_waiver(overlay, family) else rules
