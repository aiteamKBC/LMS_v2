"""Delete a learner's linked identities on the shared enrolment database."""
from django.db import transaction
from django.db.models import Q

from login.models import Invitation, LoginAccount, LoginAudit, LoginSession, PasswordReset

from .mappers import ValidationError
from .models import EnrolmentUser, LearnerProfile


def _profiles_for_deletion(user):
    # Profile ids and enrolment ids use independent sequences. Never match pk.
    match = Q(enrolment_id=user.pk)
    if user.uuid:
        match |= Q(enrolment_id__isnull=True, uuid=user.uuid)
    profiles = list(LearnerProfile.objects.using("enrolment").select_for_update().filter(match))
    email = str(user.email or "").strip()
    if email:
        legacy = list(LearnerProfile.objects.using("enrolment").select_for_update().filter(
            enrolment_id__isnull=True, email__iexact=email,
        ).exclude(pk__in=[profile.pk for profile in profiles]))
        if legacy and EnrolmentUser.all_learners.using("enrolment").filter(
            email__iexact=email,
        ).exclude(pk=user.pk).exists():
            raise ValidationError("This email belongs to multiple enrolment records. Link the legacy learner profile to the correct enrolment record before deleting this account.")
        profiles.extend(legacy)
    return profiles


def delete_learner_account(user_id):
    """Remove linked identities atomically; a failure rolls back every deletion.

    Profile deletion also cascades through its ORM-owned learning plan, KSBs,
    progress entries and quiz answers. Shared curriculum records are preserved.
    """
    with transaction.atomic(using="enrolment"):
        user = EnrolmentUser.all_learners.using("enrolment").select_for_update().get(pk=user_id)
        profiles = _profiles_for_deletion(user)
        accounts = list(LoginAccount.objects.using("enrolment").select_for_update().filter(
            subject_type="learner", subject_id=user.pk,
        ))
        for account in accounts:
            for model in (LoginSession, Invitation, PasswordReset, LoginAudit):
                model.objects.using("enrolment").filter(account_id=account.pk).delete()
            account.delete(using="enrolment")
        for profile in profiles:
            profile.delete(using="enrolment")
        user.delete(using="enrolment")
