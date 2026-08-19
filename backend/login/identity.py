"""Resolve a login account to the person behind it, and mint accounts for them.

The three creation forms write to three different tables (see ``models.py``).
This module is the single place that knows how each of them maps onto an
``auth."Login_accounts"`` row: which column holds the address, what the display
name is made of, and which role the person gets.

Keeping it here rather than in the views means the invitation endpoints, the
management commands and the ``/me`` payload all derive the role the same way. A
role that differs depending on which code path created the account is the kind of
bug that quietly grants somebody the wrong console.
"""
from __future__ import annotations

from django.db import transaction

from learner_api.constants import (
    ACCESS_CHOICES,
    ACCESS_HOME_ROUTES,
    ACCESS_NAV_ROLES,
    ACCESS_SUPER_ADMIN,
    NO_ACCESS_ROUTE,
)
from learner_api.models import Employer, EnrolmentUser, StaffUser

from .models import (
    ROLE_ADMIN,
    ROLE_EMPLOYER,
    ROLE_LEARNER,
    ROLE_STAFF,
    SUBJECT_CHOICES,
    SUBJECT_EMPLOYER,
    SUBJECT_LEARNER,
    SUBJECT_STAFF,
    LoginAccount,
)

# SUBJECT_CHOICES is imported (and unused here) purely so callers holding
# `identity` can validate a subject_type without also importing `models`.
from .security import normalize_email

#: Staff position that is granted full admin. Everything else in
#: learner_api.constants.POSITION_CHOICES is staff-level. Compared
#: case-insensitively so "admin" and "Admin" both count.
ADMIN_POSITION = "admin"


def role_for_staff(position, access=None):
    """Map a staff row's Position/Access onto a login role.

    ``Access`` is the authority when set: it is the deliberate permission grant
    (see ``learner_api.constants.ACCESS_CHOICES``), and only ``super-admin``
    carries the platform-wide ``admin`` role. Every other access is staff-level;
    what it additionally *permits* is enforced by
    ``login.permissions.require_access``, not by this coarse role.

    ``Position`` no longer grants anything. It briefly remained a fallback so the
    administrator who predated the Access column was not locked out of the very
    console that assigns access — that account now holds ``super-admin``
    explicitly, so the fallback is gone. Keeping it would have meant every
    account the console creates (all of which are ``Position='Admin'``) silently
    arriving as a full platform administrator, which is the opposite of what the
    access grant is for.

    An account with no access recorded is therefore staff-level and, having no
    grant, is refused everywhere access is checked. The SPA lands it on
    ``/access-required`` so the person is told to ask for one rather than
    dropped into a workspace they cannot use.
    """
    resolved = (access or "").strip().lower()
    if resolved == ACCESS_SUPER_ADMIN:
        return ROLE_ADMIN
    return ROLE_STAFF


def access_for_staff(subject):
    """The staff row's recorded access, or "" when none has been set.

    Normalised to lower case so a value typed with different capitalisation
    still matches ``ACCESS_CHOICES``.
    """
    return (getattr(subject, "access", "") or "").strip().lower()


def subject_model(subject_type):
    return {
        SUBJECT_LEARNER: EnrolmentUser,
        SUBJECT_EMPLOYER: Employer,
        SUBJECT_STAFF: StaffUser,
    }[subject_type]


def fetch_subject(subject_type, subject_id):
    """Load the enrolment row behind an account, or None if it has been deleted.

    Learners are read through ``all_learners``: the default manager on
    EnrolmentUser is scoped to apprenticeships, and a commercial learner must
    still be able to sign in.
    """
    if subject_type == SUBJECT_LEARNER:
        manager = EnrolmentUser.all_learners
    else:
        manager = subject_model(subject_type).objects
    try:
        return manager.get(pk=subject_id)
    except (subject_model(subject_type).DoesNotExist, ValueError, TypeError):
        return None


def describe_subject(subject_type, subject):
    """Extract (email, display_name, role) from one of the three row types.

    Returns ``(None, None, None)`` when the row has no usable address — an
    account cannot be created for somebody we cannot email.
    """
    if subject is None:
        return None, None, None

    if subject_type == SUBJECT_LEARNER:
        email = normalize_email(subject.email)
        name = (subject.username or "").strip() or (subject.preferred_name or "").strip()
        return email or None, name or None, ROLE_LEARNER

    if subject_type == SUBJECT_EMPLOYER:
        email = normalize_email(subject.email)
        name = subject.full_name
        return email or None, name or None, ROLE_EMPLOYER

    if subject_type == SUBJECT_STAFF:
        email = normalize_email(subject.email)
        name = (subject.username or "").strip() or (subject.preferred_name or "").strip()
        return email or None, name or None, role_for_staff(subject.position, subject.access)

    raise ValueError(f"Unknown subject_type: {subject_type!r}")


class AccountError(ValueError):
    """Raised when an account cannot be created or updated for a subject."""


@transaction.atomic(using="enrolment")
def ensure_account(subject_type, subject_id, *, subject=None, activate=True):
    """Return the login account for a person, creating it if absent.

    Idempotent, and safe to call every time one of the creation forms saves: an
    existing account is refreshed (address, name and role follow the enrolment
    row) but never has its password, lockout state or active flag reset by a
    later edit to the person's profile.

    Raises ``AccountError`` if the person has no email address, or if the address
    already belongs to a different person of the same kind.
    """
    if subject_type not in (SUBJECT_LEARNER, SUBJECT_EMPLOYER, SUBJECT_STAFF):
        raise AccountError(f"Unknown subject type: {subject_type!r}")

    subject = subject if subject is not None else fetch_subject(subject_type, subject_id)
    if subject is None:
        raise AccountError("That record no longer exists.")

    email, display_name, role = describe_subject(subject_type, subject)
    if not email:
        raise AccountError("This record has no email address, so it cannot be invited.")

    existing = LoginAccount.objects.filter(
        subject_type=subject_type, subject_id=subject_id
    ).first()

    # Guard the (subject_type, lower(email)) unique index before hitting it, so
    # the caller gets an explanation rather than an IntegrityError.
    clash = (
        LoginAccount.objects.filter(subject_type=subject_type, email=email)
        .exclude(subject_id=subject_id)
        .first()
    )
    if clash is not None:
        raise AccountError(
            f"Another {subject_type} account already uses {email}."
        )

    if existing is None:
        return LoginAccount.objects.create(
            subject_type=subject_type,
            subject_id=subject_id,
            email=email,
            display_name=display_name,
            role=role,
            is_active=activate,
        ), True

    # Refresh the descriptive fields only. Deliberately does not touch
    # password_hash, failed_attempts, locked_until or is_active.
    changed = []
    if existing.email != email:
        existing.email, _ = email, changed.append("email")
    if existing.display_name != display_name:
        existing.display_name, _ = display_name, changed.append("display_name")
    if existing.role != role:
        existing.role, _ = role, changed.append("role")
    if changed:
        existing.save(update_fields=[*changed, "updated_at"])

    return existing, False


def account_for_subject(subject_type, subject_id):
    """The login account belonging to a person, or None if they have none."""
    return LoginAccount.objects.filter(
        subject_type=subject_type, subject_id=subject_id
    ).first()


def account_for_email(email):
    """Find the single active account for an address, or None.

    An address can legitimately exist as both (say) an employer and a staff
    member, because the unique index is per subject_type. When that happens there
    is no way to tell from the sign-in form which one was meant, so this returns
    None rather than guessing — and ``views.login`` reports it as a plain
    credential failure so the ambiguity is not disclosed to an anonymous caller.
    """
    matches = list(
        LoginAccount.objects.filter(email=normalize_email(email), is_active=True)[:2]
    )
    if len(matches) == 1:
        return matches[0]
    return None


def account_payload(account, *, subject=None):
    """The ``/me`` document: identity and role, and nothing sensitive.

    Never includes the password hash, lockout counters or session token. The
    frontend uses ``role`` to choose a console and ``permissions`` for finer
    gating; both are recomputed server-side on every request, so tampering with
    the stored copy in the browser achieves nothing.
    """
    subject = subject if subject is not None else fetch_subject(
        account.subject_type, account.subject_id
    )

    payload = {
        "id": account.id,
        "email": account.email,
        "displayName": account.display_name,
        "role": account.role,
        "subjectType": account.subject_type,
        "subjectId": account.subject_id,
        "hasPassword": account.has_password,
        "lastLoginAt": account.last_login_at.isoformat() if account.last_login_at else None,
        "permissions": permissions_for(account.role),
    }

    # A few role-specific extras the console needs immediately on load, so it
    # does not have to make a second call before it can render.
    if subject is not None:
        if account.subject_type == SUBJECT_STAFF:
            payload["position"] = subject.position
            # The access grant, plus where it lands and which sidebar it gets.
            # Sent from here rather than duplicated in the SPA so the landing
            # route and the permission it reflects change in one place.
            access = access_for_staff(subject)
            payload["access"] = access
            # No grant: land them on the page that explains why and lets them
            # ask, rather than on a workspace that would refuse them anyway.
            payload["accessHome"] = ACCESS_HOME_ROUTES.get(access) or NO_ACCESS_ROUTE
            payload["accessNavRole"] = ACCESS_NAV_ROLES.get(access)
        elif account.subject_type == SUBJECT_LEARNER:
            payload["learnerType"] = subject.learner_type
            payload["programme"] = subject.programme
        elif account.subject_type == SUBJECT_EMPLOYER:
            payload["organisationIds"] = list(subject.employer_group_ids or [])

    return payload


#: Coarse capability list per role, consumed by the SPA's existing RBAC helpers.
#: Intentionally simple: the authoritative checks are the server-side decorators
#: in ``permissions.py``. This exists so the UI can hide what it should not offer.
_PERMISSIONS = {
    ROLE_ADMIN: [
        "enrolment.read", "enrolment.write",
        "learners.read", "learners.write",
        "employers.read", "employers.write",
        "staff.read", "staff.write",
        "accounts.manage",
    ],
    ROLE_STAFF: [
        "enrolment.read", "enrolment.write",
        "learners.read", "learners.write",
        "employers.read",
    ],
    ROLE_EMPLOYER: [
        "employer-portal.read",
        "documents.sign",
    ],
    ROLE_LEARNER: [
        "self.read",
        "documents.sign",
    ],
}


def permissions_for(role):
    return list(_PERMISSIONS.get(role, []))
