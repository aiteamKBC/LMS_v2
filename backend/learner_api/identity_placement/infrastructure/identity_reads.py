"""Existing Learner/Enrolment ORM identity reads, unchanged in semantics."""

from django.apps import apps


def learner_profile_model():
    return apps.get_model("learner_api", "LearnerProfile")


def enrolment_user_model():
    return apps.get_model("learner_api", "EnrolmentUser")


def _profiles(fields):
    LearnerProfile = learner_profile_model()
    return LearnerProfile.objects.only(*fields) if fields else LearnerProfile.objects


def profile_by_enrolment(source_pk, *, active_only=False, fields=None):
    filters = {"lifecycle_status": "active"} if active_only else {}
    return _profiles(fields).filter(enrolment_id=source_pk, **filters).first()


def unlinked_profile_by_email(email, *, active_only=False, fields=None):
    filters = {"lifecycle_status": "active"} if active_only else {}
    return _profiles(fields).filter(
        email__iexact=email,
        enrolment_id__isnull=True,
        **filters,
    ).first()


def duplicate_enrolment_ids(email, source_pk):
    EnrolmentUser = enrolment_user_model()
    return list(
        EnrolmentUser.all_learners.filter(email__iexact=email)
        .exclude(pk=source_pk)
        .values_list("pk", flat=True)[:5]
    )


def repair_enrolment_link(profile, source_pk):
    profile.enrolment_id = source_pk
    profile.save(update_fields=["enrolment_id"])


def unlinked_profile_by_id(source_pk, *, active_only=False, fields=None):
    filters = {"lifecycle_status": "active"} if active_only else {}
    return _profiles(fields).filter(
        pk=source_pk,
        enrolment_id__isnull=True,
        **filters,
    ).first()


def canonical_learner_by_kind(kind, enrolment_id):
    LearnerProfile = learner_profile_model()
    return (
        LearnerProfile.objects
        .only("id", "enrolment_id", "learner_type", "lifecycle_status", "programme_status")
        .get(enrolment_id=enrolment_id, learner_type=kind)
    )
