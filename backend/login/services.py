"""The seam the three creation forms call into.

``learner_api`` must not import login views or reach into token internals; it
needs exactly one function: "this person was just created and the form said to
invite them — do the right thing."

``invite_subject`` is that function. It is deliberately forgiving about
*infrastructure* failure: a creation form's job is to create a person, and it
must not fail because the mail tenant is down. Problems come back in the return
value so the API response can surface them, and they land in the audit table
either way.

It is **not** forgiving about authorisation. Issuing an invitation mints a
credential, so ``invite_subject`` re-checks the caller itself rather than
trusting that whatever called it was gated — see ``_authorise``.
"""
from __future__ import annotations

import logging

from django.db import DatabaseError

from .identity import AccountError, describe_subject, ensure_account, fetch_subject
from .invitations import send_invitation
from .models import ROLE_ADMIN, ROLE_STAFF

logger = logging.getLogger("login")

#: Roles permitted to invite anybody at all.
_MAY_INVITE = frozenset({ROLE_ADMIN, ROLE_STAFF})


class InvitePermissionError(PermissionError):
    """The caller is not allowed to issue this invitation."""


def _authorise(inviter, target_role):
    """Check that ``inviter`` may issue an invitation conferring ``target_role``.

    Enforced here, at the point the credential is created, rather than only on
    the view. The three creation endpoints in ``learner_api`` are the reason:
    they are ``@csrf_exempt`` with no auth decorator of their own, so a check
    that lived only on the caller could be reintroduced-by-omission the next
    time an endpoint learns to invite. A privilege boundary should not depend on
    every call site remembering it exists.

    ``inviter`` is a ``LoginAccount`` or None (anonymous).
    """
    if inviter is None:
        raise InvitePermissionError(
            "You must be signed in to invite someone to the platform."
        )
    if not inviter.is_active:
        raise InvitePermissionError("Your account is not active.")
    if inviter.role not in _MAY_INVITE:
        raise InvitePermissionError(
            "Only staff and administrators can invite people to the platform."
        )
    # Only an admin can create another admin. Otherwise any staff member could
    # promote themselves by creating an "Admin"-position colleague at an address
    # they control — the role is derived from the Position field on a form they
    # are already allowed to submit.
    if target_role == ROLE_ADMIN and inviter.role != ROLE_ADMIN:
        raise InvitePermissionError(
            "Only an administrator can invite another administrator."
        )
    return True


def invite_subject(subject_type, subject_id, *, subject=None, inviter=None,
                   invited_by=None, ip=None, user_agent=None):
    """Ensure an account exists for a person and email them an invitation.

    ``inviter`` is the ``LoginAccount`` of the signed-in caller, or None for an
    anonymous request. It is **required** in practice: an anonymous caller is
    refused, because issuing an invitation creates a credential.

    Returns a small dict describing what happened; never raises. Shape:

        {"invited": bool, "emailSent": bool, "accountCreated": bool,
         "error": str | None, "expiresAt": str | None, "forbidden": bool}

    ``invited`` is True when an invitation row was written, whether or not the
    email itself went out — the link is real and can be re-sent. ``forbidden``
    is True when the caller was not allowed to invite, so the view can answer
    403 rather than reporting a generic failure.
    """
    result = {
        "invited": False,
        "emailSent": False,
        "accountCreated": False,
        "error": None,
        "expiresAt": None,
        "forbidden": False,
    }

    # Resolve the role this invitation would confer *before* creating anything,
    # so a refused invitation leaves no account behind.
    try:
        target = subject if subject is not None else fetch_subject(subject_type, subject_id)
        _, _, target_role = describe_subject(subject_type, target)
    except (ValueError, DatabaseError) as exc:
        result["error"] = str(exc)
        return result

    try:
        _authorise(inviter, target_role)
    except InvitePermissionError as exc:
        logger.warning(
            "Refused invitation for %s:%s (role=%s) from %s",
            subject_type, subject_id, target_role,
            inviter.email if inviter else "anonymous",
        )
        result["error"] = str(exc)
        result["forbidden"] = True
        return result

    try:
        account, created = ensure_account(subject_type, subject_id, subject=subject)
    except AccountError as exc:
        # The commonest case by far: the form was submitted with the invite
        # toggle on but no email address filled in.
        result["error"] = str(exc)
        return result
    except DatabaseError as exc:
        logger.exception("Could not create login account for %s:%s", subject_type, subject_id)
        result["error"] = f"Database error: {exc}"
        return result

    result["accountCreated"] = created

    try:
        invitation, sent, detail = send_invitation(
            account, invited_by=invited_by, ip=ip, user_agent=user_agent
        )
    except DatabaseError as exc:
        logger.exception("Could not create invitation for %s", account.email)
        result["error"] = f"Database error: {exc}"
        return result

    result["invited"] = True
    result["emailSent"] = sent
    result["expiresAt"] = invitation.expires_at.isoformat()
    if not sent:
        result["error"] = detail
    return result


def sync_account(subject_type, subject_id, *, subject=None):
    """Keep an existing login account's email/name/role in step with an edit.

    Called from the update paths of the creation forms. Does nothing when the
    person has no account yet — editing somebody who was never invited should
    not silently create a sign-in identity for them.
    """
    from .models import LoginAccount

    try:
        if not LoginAccount.objects.filter(
            subject_type=subject_type, subject_id=subject_id
        ).exists():
            return None
        account, _ = ensure_account(subject_type, subject_id, subject=subject)
        return account
    except (AccountError, DatabaseError):
        logger.exception("Could not sync login account for %s:%s", subject_type, subject_id)
        return None
