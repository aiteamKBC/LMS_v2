"""Pure template definition and idempotent update for next-review booking."""
from copy import deepcopy


QUESTION = "Please confirm that the next session has been booked through the coaching booking system."
SEMANTIC_KEY = "next_review_booking_confirmation"
PR_SECTIONS = [{
    "title": "Confirm Next Meeting & Close (5 minutes)",
    "estimatedMinutes": 5,
    "fields": [{
        "id": "",
        "title": QUESTION,
        "fieldType": "boolean",
        "required": True,
        "configuration": {"semanticKey": SEMANTIC_KEY, "respondentRoles": ["participant"]},
    }],
}]


def _matching_fields(sections):
    return [field for section in sections for field in section.get("fields", [])
            if field.get("title", "").strip().casefold() == QUESTION.casefold()
            or (field.get("configuration") or {}).get("semanticKey") == SEMANTIC_KEY]


def plan_sections(sections):
    matches = _matching_fields(sections)
    if not matches:
        return "add"
    if len(matches) == 1 and matches[0].get("fieldType") in {"boolean", "boolean_case_block"}:
        roles = (matches[0].get("configuration") or {}).get("respondentRoles") or []
        return "already_present" if "participant" in roles else "add_participant"
    return "conflict"


def with_next_booking_question(sections):
    updated = deepcopy(sections)
    action = plan_sections(updated)
    if action == "add_participant":
        return with_mcm_participant_access(updated)
    if action != "add":
        return updated
    matching_sections = [section for section in updated
                         if section.get("title", "").strip().casefold() == PR_SECTIONS[0]["title"].casefold()]
    # Existing editable reviews may already be in progress. Their new prompt
    # stays optional; newly seeded templates use the required default above.
    field = deepcopy(PR_SECTIONS[0]["fields"][0])
    field["required"] = False
    if len(matching_sections) == 1:
        matching_sections[0].setdefault("fields", []).append(field)
    else:
        section = deepcopy(PR_SECTIONS[0])
        section["fields"] = [field]
        updated.append(section)
    return updated


def plan_mcm_participant_access(sections):
    matches = _matching_fields(sections)
    if not matches:
        return "question_absent"
    if len(matches) != 1 or matches[0].get("fieldType") not in {"boolean", "boolean_case_block"}:
        return "conflict"
    roles = (matches[0].get("configuration") or {}).get("respondentRoles") or []
    return "already_present" if "participant" in roles else "add_participant"


def with_mcm_participant_access(sections):
    updated = deepcopy(sections)
    if plan_mcm_participant_access(updated) != "add_participant":
        return updated
    field = _matching_fields(updated)[0]
    config = field.setdefault("configuration", {})
    config["respondentRoles"] = list(dict.fromkeys([*(config.get("respondentRoles") or []), "participant"]))
    config.setdefault("semanticKey", SEMANTIC_KEY)
    return updated
