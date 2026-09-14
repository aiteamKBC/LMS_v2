"""Resolve the current case owner and keep coach names/emails together."""
from .models import StaffUser


def _text(value):
    return str(value or "").strip()


def case_owner_coach(owner, source=None):
    name = _text(owner)
    if not name:
        return {"coach_name": "", "coach_email": ""}
    # An email already saved with this name disambiguates duplicate staff names.
    if (source is not None
            and _text(getattr(source, "coach_name", "")).casefold() == name.casefold()
            and _text(getattr(source, "coach_email", ""))):
        return {"coach_name": name, "coach_email": _text(source.coach_email)}
    staff = list(StaffUser.objects.filter(username__iexact=name).only("email")[:2])
    # Legacy free-text and ambiguous names remain visible, without retaining
    # the previous coach's email or choosing another person's address.
    return {"coach_name": name,
            "coach_email": _text(staff[0].email) if len(staff) == 1 else ""}


def source_coach(source):
    """None means a legacy row with no assignment; empty strings mean cleared."""
    owner = _text(getattr(source, "case_owner", ""))
    if owner:
        return case_owner_coach(owner, source)
    name = getattr(source, "coach_name", None)
    email = getattr(source, "coach_email", None)
    if name is not None or email is not None:
        return {"coach_name": _text(name), "coach_email": _text(email)}
    return None


def current_coach(source, profile=None, historical=None):
    contact = source_coach(source)
    if contact is not None:
        return contact
    if profile is not None and (profile.coach_name or profile.coach_email):
        return {"coach_name": _text(profile.coach_name), "coach_email": _text(profile.coach_email)}
    historical = historical or {}
    return {"coach_name": _text(historical.get("coach_name")),
            "coach_email": _text(historical.get("coach_email"))}
