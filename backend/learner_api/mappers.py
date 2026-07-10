"""Map the flat/JSON EnrolmentUser row to the shapes the frontend expects.

Two output shapes:
  * to_list_row  -> UserListRow (Users List screen)
  * to_board     -> EnrolmentBoard (read-only details page)

And two inbound helpers:
  * write_fields -> validates + returns kwargs for create/update (flat columns)
  * validate_choices -> enforces the canonical option lists
"""
from .constants import STATUS_CHOICES, TYPE_CHOICES, PROGRAMME_STATUS_CHOICES


# --------------------------------------------------------------------------- #
# small defensive helpers                                                      #
# --------------------------------------------------------------------------- #
def _s(value):
    """Coerce to a trimmed string ('' for None)."""
    return "" if value is None else str(value).strip()


def _as_list(value):
    return value if isinstance(value, list) else []


def _as_dict(value):
    return value if isinstance(value, dict) else {}


def _pick(d, *keys, default=""):
    """First present key from a dict, tolerant of camel/snake variants."""
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _maybe_json(value):
    """A TEXT column that might hold JSON. Returns parsed value or None."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        import json

        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return None


# --------------------------------------------------------------------------- #
# outbound: list row                                                           #
# --------------------------------------------------------------------------- #
def to_list_row(u):
    status = _s(u.status)
    utype = _s(u.type) or "User"
    return {
        "id": str(u.id),
        "name": _s(u.username),
        "type": utype,
        "email": _s(u.email),
        "group": _s(u.group),
        "subscriptionStatus": status,
        "subscriptionVerified": status.lower() == "fulluser",
        "learningPlan": utype == "User",
        "programmeStatus": _s(u.programme_status),
        "notesCount": 0,
        "hasTasks": utype == "User",
        "reference": _s(u.organization),
    }


# --------------------------------------------------------------------------- #
# outbound: full board                                                         #
# --------------------------------------------------------------------------- #
def _fs_block(assessments, exemption):
    exempt = False
    evidence = []
    ex = _as_dict(exemption)
    if ex:
        exempt = bool(ex.get("exempt"))
        evidence = _as_list(ex.get("evidence"))
    elif isinstance(exemption, bool):
        exempt = exemption
    return {"assessments": _as_list(assessments), "exempt": exempt, "evidence": evidence}


def _split_enrolled(value):
    """'31/10/2025 18:24:17 by Ayman Badewi' -> ('31/10/2025 18:24:17', 'Ayman Badewi')."""
    text = _s(value)
    if " by " in text:
        at, _, by = text.partition(" by ")
        return at.strip(), by.strip()
    return text, ""


def _review_groups(u):
    """Reviews / Review_documents -> [{programme, reviews:[...]}]."""
    raw = u.review_documents if u.review_documents is not None else u.reviews
    items = _as_list(raw)
    if not items:
        return []
    # Already grouped? (each item has a 'reviews' array)
    if all(isinstance(i, dict) and "reviews" in i for i in items):
        return [
            {"programme": _s(_pick(g, "programme")), "reviews": _as_list(g.get("reviews"))}
            for g in items
        ]
    # Flat list of reviews -> wrap under the user's programme.
    return [{"programme": _s(u.programme), "reviews": items}]


def _competencies(u):
    parsed = _maybe_json(u.competencies)
    items = _as_list(parsed)
    out = []
    for i, c in enumerate(items):
        d = _as_dict(c)
        out.append(
            {
                "id": _s(_pick(d, "id", default=f"comp-{i}")) or f"comp-{i}",
                "name": _s(_pick(d, "name")),
                "version": _s(_pick(d, "version", default="v1.0")) or "v1.0",
            }
        )
    return out


def _subscription(u):
    d = _as_dict(u.subscription_details)
    return {
        "startDate": _s(_pick(d, "startDate", "start_date")),
        "endDate": _s(_pick(d, "endDate", "end_date")),
        "status": _s(_pick(d, "status", default=u.status)),
    }


def to_board(u):
    enrolled_at, enrolled_by = _split_enrolled(u.enrolled_time_and_user)
    return {
        "user": {
            "id": str(u.id),
            "name": _s(u.username),
            "reference": _s(u.organization),
            "owner": enrolled_by or _s(u.line_manager),
        },
        "contact": {
            "email": _s(u.email),
            "phone": _s(u.phone_number),
            "dob": _s(u.date_of_birth),
            "groupMembership": _s(u.group),
            "signatureUrl": None,
            "hasMandate": False,
        },
        "activity": {
            "aptemUsage": "00:00",
            "daysTillNextReporting": 0,
            "lastLoggedIn": None,
            "logins": 0,
            "tasksAddedByUser": 0,
            "uncompletedTasks": 0,
            "adviceItemsAccessed": 0,
            "adviceLastAccessed": None,
            "actionPlans": "No plans created",
        },
        "programme": {
            "type": "Delivery",
            "name": _s(u.programme),
            "status": _s(u.programme_status) or "Non starter",
            "startDate": "",
            "endDate": _s(u.apprenticeship_end_date),
            "enrolledAt": enrolled_at,
            "enrolledBy": enrolled_by,
            "onboardingStatus": _s(u.onboarding_status) or "Not started",
            "onboardingCompletedAt": _s(u.onboarding_completed) or None,
        },
        "subProgrammes": _as_list(u.sub_programme),
        "aims": _as_list(u.aims_qualifications),
        "previousProgrammes": [],
        "functionalSkills": {
            "english": _fs_block(u.english_assessments, u.english_exemption),
            "maths": _fs_block(u.maths_assessments, u.maths_exemption),
            "ict": _fs_block(u.ict_assessments, u.ict_exemption),
        },
        "managedJobs": _as_list(_maybe_json(u.managed_jobs)),
        "tracker": _as_list(u.tracker),
        "milestones": _as_list(u.milestones),
        "notes": [],
        "courseProgress": [],
        "contacts": _as_list(u.contacts),
        "activities": _as_list(u.activity),
        "complianceDocuments": _as_list(u.compliance_documents),
        "reviewDocuments": _review_groups(u),
        "documents": _as_list(u.documents),
        "competencies": _competencies(u),
        "subscription": _subscription(u),
        "auditTrail": [],
    }


# --------------------------------------------------------------------------- #
# inbound: create / update                                                     #
# --------------------------------------------------------------------------- #
# payload key -> model attribute (flat text columns only)
WRITABLE_FIELDS = {
    "username": "username",
    "email": "email",
    "phone": "phone_number",
    "dob": "date_of_birth",
    "type": "type",
    "status": "status",
    "programmeStatus": "programme_status",
    "programme": "programme",
    "cohort": "cohort",
    "group": "group",
    "employer": "employer",
    "organization": "organization",
    "reference": "organization",
    "lineManager": "line_manager",
    "onboardingStatus": "onboarding_status",
    "onboardingCompleted": "onboarding_completed",
}


class ValidationError(Exception):
    """Raised with a user-facing message when a payload fails validation."""


def validate_choices(payload):
    checks = (
        ("status", STATUS_CHOICES),
        ("type", TYPE_CHOICES),
        ("programmeStatus", PROGRAMME_STATUS_CHOICES),
    )
    for key, allowed in checks:
        val = payload.get(key)
        if val not in (None, "") and val not in allowed:
            raise ValidationError(f"Invalid {key}: {val!r}. Allowed: {', '.join(allowed)}")


def write_fields(payload, *, require_create=False):
    """Validate a payload and return {model_attr: value} for the flat columns."""
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    validate_choices(payload)
    if require_create:
        if not _s(payload.get("username")):
            raise ValidationError("username is required.")
        if not _s(payload.get("email")):
            raise ValidationError("email is required.")
    fields = {}
    for key, attr in WRITABLE_FIELDS.items():
        if key in payload:
            val = payload[key]
            fields[attr] = None if val is None else str(val).strip()
    return fields
