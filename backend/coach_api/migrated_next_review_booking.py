"""Add next-meeting confirmation to active migrated review templates."""

from copy import deepcopy


QUESTION = "Please confirm that the next session has been booked through the coaching booking system."
SECTION_TITLE = "Confirm Next Meeting & Close (5 minutes)"
SECTION_KEY = "lms-next-meeting-close"
FIELD_KEY = "lms-next-meeting-booked"
FAMILIES = {"MCM", "PR", "PR_SKILLS_RADAR"}


def _all_fields(definition):
    def walk(field):
        yield field
        for branch in ("ifTrue", "ifFalse"):
            for child in field.get(branch) or []:
                yield from walk(child)

    for section in definition["sections"]:
        for field in section["fields"]:
            yield from walk(field)


def with_next_review_booking(definition, family):
    """Return (action, copy); never alter the supplied template or saved answers."""
    if family not in FAMILIES:
        raise ValueError("Next-meeting booking applies to MCM and Progress Review templates only.")
    updated = deepcopy(definition)
    matches = [field for field in _all_fields(updated) if field.get("title", "").strip().casefold() == QUESTION.casefold()]
    if len(matches) > 1:
        raise ValueError("The template contains more than one next-meeting confirmation question.")
    if matches:
        field = matches[0]
        if field.get("aptemType") not in (2, 6):
            raise ValueError("The existing next-meeting question must be Yes/No.")
        roles = field.get("respondentRoles") or []
        if "participant" in roles:
            return "already_present", updated
        field["respondentRoles"] = [*roles, "participant"]
        return "add_learner_access", updated
    if family == "MCM":
        raise ValueError("An active MCM template has no next-meeting question to grant learner access to.")

    if any(section["key"] == SECTION_KEY for section in updated["sections"]):
        raise ValueError("The next-meeting section key is already used by another section.")
    if any(field["key"] == FIELD_KEY for field in _all_fields(updated)):
        raise ValueError("The next-meeting field key is already used by another question.")
    next_order = max(section.get("order", 0) for section in updated["sections"]) + 1
    updated["sections"].append({
        "key": SECTION_KEY,
        "title": SECTION_TITLE,
        "order": next_order,
        "fields": [{
            "key": FIELD_KEY,
            "title": QUESTION,
            "aptemType": 6,
            "order": 0,
            "mandatory": True,
            "respondentRoles": ["participant"],
            "ifTrue": [],
            "ifFalse": [],
        }],
    })
    return "add_question", updated
