"""Pure decisions for the preserved legacy identity resolution policy."""


def has_ambiguous_email_matches(enrolment_ids):
    return bool(enrolment_ids)


def should_repair_enrolment_link(profile, source_pk, *, heal):
    return bool(
        heal
        and source_pk is not None
        and getattr(profile, "enrolment_id", None) != source_pk
    )
