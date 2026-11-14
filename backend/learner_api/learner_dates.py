"""Save enrolment fields and mirror learner-specific dates and coach contact."""
from django.db import transaction

from .coach_assignment import case_owner_coach, coach_id_for_contact
from .identity import learner_profile_for_source


DATE_FIELDS = ("learner_start_date", "learner_end_date")


def learner_date_values(source):
    return {field: getattr(source, field, None) or None for field in DATE_FIELDS}


def _save_enrolment_fields(user, fields):
    profile_fields = {}
    if any(field in fields for field in DATE_FIELDS):
        profile_fields.update(learner_date_values(user))
    if "case_owner" in fields:
        contact = ({key: fields[key] for key in ("coach_name", "coach_email")}
                   if all(key in fields for key in ("coach_name", "coach_email"))
                   else case_owner_coach(fields["case_owner"], user))
        fields = {**fields, **contact}
        for field, value in contact.items():
            setattr(user, field, value)
        profile_fields["coach_id"] = coach_id_for_contact(contact)
        # Imported ownership is a separate, explicit outcome of reassignment.
        # Resolve without opportunistically repairing an identity link.
        profile = learner_profile_for_source(user, heal=False)
        from coach_api.review_handover import save_assignment
        handover = save_assignment(user, profile, fields, profile_fields)
        if handover is not None and handover[0]:
            return {"reviewHandover": handover[1]}
    else:
        handover = None
    if not profile_fields:
        user.save(update_fields=list(fields))
        return

    # A failed profile write must also roll back the enrolment edit.
    with transaction.atomic(using="enrolment"):
        user.save(update_fields=list(fields))
        profile = learner_profile_for_source(user)
        if profile is None:
            # Activation copies these values when the profile is created later.
            return {"reviewHandover": handover[1]} if handover is not None else None
        for field, value in profile_fields.items():
            setattr(profile, field, value)
        profile.save(using="enrolment", update_fields=[*profile_fields, "updated_at"])
    return {"reviewHandover": handover[1]} if handover is not None else None


def save_enrolment_fields(user, fields):
    """Save registration fields and explicit educational FK changes atomically."""
    from .placement_links import FIELDS, CACHE, placement_profile, validate_placement

    requested = {key: value for key, value in fields.items() if key in FIELDS}
    if not requested:
        return _save_enrolment_fields(user, fields)
    alias = user._state.db or 'enrolment'
    with transaction.atomic(using=alias):
        profile = placement_profile(user)
        validate_placement(requested, profile, using=alias)
        registration = {key: value for key, value in fields.items() if key not in FIELDS}
        if profile is None:
            # First placement uses the normal profile provisioning path.
            from .active_users import sync_active_user
            registration.update(requested)
            result = _save_enrolment_fields(user, registration)
            sync_active_user(user)
            user.__dict__.pop(CACHE, None)
            profile = placement_profile(user)
            if profile is None:
                raise ValueError('Unable to establish the canonical learner placement.')
        else:
            result = _save_enrolment_fields(user, registration) if registration else None
            for key, value in requested.items():
                setattr(profile, key, value)
            profile.save(using=alias, update_fields=[*requested, 'updated_at'])
        user.__dict__[CACHE] = profile
        user.__dict__.pop('_placement_names', None)
    return result
