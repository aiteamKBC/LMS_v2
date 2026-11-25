"""Exact canonical placement ORM reads."""

from django.apps import apps

from ..domain.placement import RELATIONS


def learner_profile_model():
    return apps.get_model("learner_api", "LearnerProfile")


def profile_for_enrolment(enrolment_id, *, using):
    LearnerProfile = learner_profile_model()
    try:
        return (
            LearnerProfile.objects.using(using)
            .select_related(*RELATIONS)
            .only("id", "enrolment_id", *RELATIONS)
            .get(enrolment_id=enrolment_id)
        )
    except LearnerProfile.DoesNotExist:
        return None


def profiles_for_enrolments(enrolment_ids, *, using):
    LearnerProfile = learner_profile_model()
    return (
        LearnerProfile.objects.using(using)
        .select_related(*RELATIONS)
        .only("id", "enrolment_id", *RELATIONS)
        .filter(enrolment_id__in=enrolment_ids)
    )
