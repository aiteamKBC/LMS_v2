"""Keep the header's learner-specific dates on both linked identities."""
from django.db import transaction

from .identity import learner_profile_for_source


DATE_FIELDS = ("learner_start_date", "learner_end_date")


def learner_date_values(source):
    return {field: getattr(source, field, None) or None for field in DATE_FIELDS}


def save_enrolment_fields(user, fields):
    if not any(field in fields for field in DATE_FIELDS):
        user.save(update_fields=list(fields))
        return

    # A failed profile write must also roll back the enrolment date edit.
    with transaction.atomic(using="enrolment"):
        user.save(update_fields=list(fields))
        profile = learner_profile_for_source(user)
        if profile is None:
            # Activation copies these dates when the profile is created later.
            return
        for field, value in learner_date_values(user).items():
            setattr(profile, field, value)
        profile.save(using="enrolment", update_fields=[*DATE_FIELDS, "updated_at"])
