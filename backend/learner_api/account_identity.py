"""Correct a learner's identity without leaving their sign-in account behind."""
from django.db import DatabaseError, IntegrityError, transaction
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from login.identity import AccountError, ensure_account
from login.models import Invitation, LoginAccount, PasswordReset

from .identity import learner_profile_for_source
from .mappers import ValidationError
from .models import EnrolmentUser, LearnerProfile


class LearnerEmailConflict(ValidationError):
    def __init__(self, learner):
        super().__init__('A learner with this email already exists. Open the existing learner instead.')
        self.learner = learner

    def payload(self):
        learner = self.learner
        return {
            'error': str(self),
            'code': 'learner_email_exists',
            'existingUser': {
                'id': str(learner.pk),
                'name': learner.username or '',
                'programme': learner.programme or '',
                'learnerType': learner.learner_type or 'apprenticeship',
                'archived': str(learner.status or '').strip().casefold() == 'archived',
            },
        }


def email_owner(email, *, exclude_id=None):
    email = str(email or '').strip().lower()
    if not email:
        return None
    query = EnrolmentUser.all_learners.annotate(_identity_email=Lower(Trim('email'))).filter(
        _identity_email=email,
    )
    if exclude_id is not None:
        query = query.exclude(pk=exclude_id)
    return query.only('id', 'username', 'programme_id', 'learner_type', 'status').first()


def save_learner_identity(user, fields):
    """Save identity columns, the linked account and profile in one transaction.

    Placement/coach changes keep their existing save path. In particular this
    transaction must not surround the imported-review handover, which may use
    another connection to the same physical database.
    """
    try:
        with transaction.atomic(using='enrolment'):
            stored = EnrolmentUser.all_learners.select_for_update().get(pk=user.pk)
            profile = learner_profile_for_source(stored, heal=False)
            account = LoginAccount.objects.select_for_update().filter(
                subject_type='learner', subject_id=user.pk,
            ).first()
            email_changed = 'email' in fields and str(fields['email'] or '').strip().lower() != str(stored.email or '').strip().lower()
            if 'email' in fields:
                email = str(fields['email'] or '').strip().lower()
                if not email:
                    raise ValidationError('Email is required. No identity changes were saved.')
                owner = email_owner(email, exclude_id=user.pk)
                if owner is not None:
                    raise LearnerEmailConflict(owner)
                accounts = LoginAccount.objects.annotate(_identity_email=Lower(Trim('email'))).filter(
                    _identity_email=email,
                )
                if account is not None:
                    accounts = accounts.exclude(pk=account.pk)
                # Existing same-address staff/learner workspaces stay intact.
                # A changed address cannot take over somebody else's account.
                if email != str(stored.email or '').strip().lower() and accounts.exists():
                    raise ValidationError('This email is already used by another sign-in account. No identity changes were saved.')
                profiles = LearnerProfile.objects.filter(email_normalized=email)
                if profile is not None:
                    profiles = profiles.exclude(pk=profile.pk)
                if profiles.exists():
                    raise ValidationError('This email is already linked to another learner profile. No identity changes were saved.')
            for field, value in fields.items():
                setattr(stored, field, value)
            stored.save(update_fields=list(fields))
            if account is not None:
                # Unlike the best-effort shared sync helper, errors here must
                # escape the transaction and roll the source edit back.
                ensure_account('learner', stored.pk, subject=stored)
                if email_changed:
                    # Links delivered to the previous address must not activate
                    # or reset the corrected identity. Keep their audit rows.
                    now = timezone.now()
                    for token_model in (Invitation, PasswordReset):
                        token_model.objects.filter(
                            account_id=account.pk, used_at__isnull=True, expires_at__gt=now,
                        ).update(expires_at=now)
            if profile is not None:
                updates = {}
                if 'email' in fields:
                    updates['email'] = stored.email
                if 'username' in fields:
                    updates['full_name'] = stored.username or ''
                if updates:
                    for field, value in updates.items():
                        setattr(profile, field, value)
                    profile.save(update_fields=[*updates, 'updated_at'])
    except LearnerEmailConflict:
        raise
    except AccountError:
        raise ValidationError('The sign-in account could not be updated. No identity changes were saved.') from None
    except IntegrityError:
        owner = email_owner(fields.get('email'), exclude_id=user.pk)
        if owner is not None:
            raise LearnerEmailConflict(owner) from None
        raise ValidationError('This email conflicts with an existing identity. No identity changes were saved.') from None
    except DatabaseError:
        raise DatabaseError('The identity could not be saved. No identity changes were saved. Please try again.') from None
