"""The preserved optional identity repair mutation."""


def repair_enrolment_link(profile, source_pk):
    profile.enrolment_id = source_pk
    profile.save(update_fields=["enrolment_id"])
