"""Pure Training Plan document formatting; preserve frozen snapshot shapes."""
from ..mappers import _s

COMPONENT_METHODS = {
    "live_session": "Live session",
    "recording_placeholder": "Recorded session",
    "video": "Pre-recorded video",
    "podcast": "Podcast",
    "reading": "Reading material",
    "quiz": "Quiz",
    "assignment": "Assignment (task)",
    "reflection": "Reflection",
    "workplace_task": "Workplace task",
    "slides": "Slides",
    "digital_learning": "Digital learning",
}


def _iso(value):
    return value.isoformat() if value else ""


def _method_label(component_type):
    """A readable Method for the plan table, from the component's type."""
    key = _s(component_type)
    return COMPONENT_METHODS.get(key, key.replace("_", " ").capitalize())


def _party_json(signature, name, position, at):
    return {
        "signed": bool(_s(signature)),
        "name": _s(name),
        "position": _s(position),
        "signedAt": at.isoformat() if at else None,
    }


def _document_json(document):
    if document is None:
        return None
    return {
        "id": str(document.id),
        "status": _s(document.status),
        "fullySigned": bool(document.fully_signed),
        "createdAt": document.created_at.isoformat() if document.created_at else None,
        "updatedAt": document.updated_at.isoformat() if document.updated_at else None,
        # The frozen content — what the three parties signed.
        "programme": document.programme or {},
        "employment": document.employment or {},
        "learningPlan": document.learning_plan or [],
        "otjh": document.otjh or {},
        "epa": document.epa or {},
        "contacts": document.contacts or {},
        "signatures": {
            "apprentice": _party_json(
                document.apprentice_signature,
                document.apprentice_signed_name,
                document.apprentice_position,
                document.apprentice_signed_at,
            ),
            "employer": _party_json(
                document.employer_signature,
                document.employer_signed_name,
                document.employer_position,
                document.employer_signed_at,
            ),
            "provider": _party_json(
                document.provider_signature,
                document.provider_signed_name,
                document.provider_position,
                document.provider_signed_at,
            ),
        },
        "marks": {
            "apprentice": _s(document.apprentice_signature),
            "employer": _s(document.employer_signature),
            "provider": _s(document.provider_signature),
        },
    }

