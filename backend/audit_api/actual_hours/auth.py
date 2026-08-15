"""Who is acting on an Actual Hours request.

The identity always comes from the **server side of the request** — the session
or a request header — never from the JSON body, so a replayed or hand-edited
payload cannot change who proposed or who decided.

Two identity modes
------------------
``named`` (default here)
    There is no login in front of this workspace: whoever opens the Learner
    Journal acts as an auditor and names themselves in the ``X-Audit-Actor``
    header. The name is required, recorded on every revision as
    ``named:<name>`` with ``proposed_by_source='named-header'``, and the
    proposer ≠ approver rule is enforced on those names in the service layer
    and by a database CHECK.

    Be clear-eyed about what this is: a **workflow control and an audit trail**,
    not authentication. A self-declared name cannot be verified, so the
    two-person rule here prevents mistakes and records who did what — it does
    not stop someone who wants to enter both names.

``django``
    Identity is a logged-in account holding ``audit_api.propose_actual_hours``
    or ``audit_api.approve_actual_hours``. This is the mode that makes the
    two-person rule a real control.

Mode selection: ``ACTUAL_HOURS_IDENTITY_MODE=named|django`` when set;
otherwise ``django`` if ``AUDIT_API_REQUIRE_AUTH`` is on, else ``named``. An
authenticated account holding the right permission is always preferred over a
header, so turning the login on later needs no code change.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from .service import ServiceError


PROPOSE_PERMISSION = "audit_api.propose_actual_hours"
APPROVE_PERMISSION = "audit_api.approve_actual_hours"

IDENTITY_MODE_ENV = "ACTUAL_HOURS_IDENTITY_MODE"
MODE_NAMED = "named"
MODE_DJANGO = "django"

_ACTOR_HEADER = "HTTP_X_AUDIT_ACTOR"
_SAFE_ACTOR = re.compile(r"^[\w .'@-]{2,120}$")


# The Learner Journal's Activity-log calculation runs without any auditor
# identity: the workspace has no login and the page asks for no name. Those runs
# are stamped with this actor so the revision history still says where a value
# came from, and the proposer-vs-approver rule does not apply to them — there is
# only one actor. A named or authenticated identity still outranks it.
WORKSPACE_ACTOR_KEY = "workspace:hours-test"
WORKSPACE_ACTOR_SOURCE = "workspace"


@dataclass(frozen=True)
class Auditor:
    key: str
    label: str
    source: str

    @property
    def is_authenticated_identity(self) -> bool:
        return self.source == "django"

    @property
    def may_decide(self) -> bool:
        """Approving/rejecting changes a real ``actual_hours`` value, so the
        identity has to be one this deployment accepts for decisions."""
        if self.is_authenticated_identity:
            return True
        if self.source == WORKSPACE_ACTOR_SOURCE:
            return True
        return self.source == "named-header" and identity_mode() == MODE_NAMED

    @property
    def enforces_two_person(self) -> bool:
        """False only for the unattended workspace actor, where a single actor
        both calculates and approves by design."""
        return self.source != WORKSPACE_ACTOR_SOURCE


def _auth_required() -> bool:
    return os.environ.get("AUDIT_API_REQUIRE_AUTH", "").lower() in {"1", "true", "yes"}


def identity_mode() -> str:
    configured = os.environ.get(IDENTITY_MODE_ENV, "").strip().lower()
    if configured in {MODE_NAMED, MODE_DJANGO}:
        return configured
    return MODE_DJANGO if _auth_required() else MODE_NAMED


def _named_actor(request) -> Auditor:
    actor = (request.META.get(_ACTOR_HEADER) or "").strip()
    if not actor:
        raise ServiceError(
            "Name the acting auditor before proposing or deciding.",
            status=403, code="actor_required",
        )
    if not _SAFE_ACTOR.match(actor):
        raise ServiceError("That auditor name is not valid.", status=400)
    return Auditor(key=f"named:{actor.casefold()}", label=actor, source="named-header")


def resolve_journal_actor(request, *, approving: bool = False) -> Auditor:
    """Identity for the Learner Journal Activity-log calculations.

    A logged-in auditor with the right permission wins; a name in the
    ``X-Audit-Actor`` header is used when one is supplied; otherwise the run is
    attributed to the workspace itself, because this page asks for no identity.
    """
    permission = APPROVE_PERMISSION if approving else PROPOSE_PERMISSION
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False) and user.has_perm(permission):
        label = user.get_username() or f"user {user.pk}"
        return Auditor(key=f"user:{user.pk}", label=label, source="django")

    actor = (request.META.get(_ACTOR_HEADER) or "").strip()
    if actor and _SAFE_ACTOR.match(actor):
        return Auditor(key=f"named:{actor.casefold()}", label=actor, source="named-header")

    return Auditor(key=WORKSPACE_ACTOR_KEY, label="HOURS-TEST workspace",
                   source=WORKSPACE_ACTOR_SOURCE)


def resolve_auditor(request, *, approving: bool = False) -> Auditor:
    """The acting auditor, or a ``ServiceError`` explaining the refusal."""
    permission = APPROVE_PERMISSION if approving else PROPOSE_PERMISSION
    mode = identity_mode()
    user = getattr(request, "user", None)
    authenticated = user is not None and getattr(user, "is_authenticated", False)

    # A real account with the right permission always wins, in either mode.
    if authenticated and user.has_perm(permission):
        label = user.get_username() or f"user {user.pk}"
        return Auditor(key=f"user:{user.pk}", label=label, source="django")

    if mode == MODE_DJANGO:
        if authenticated:
            raise ServiceError(f"This account does not hold {permission}.",
                               status=403, code="missing_permission")
        raise ServiceError("An authenticated auditor account is required.",
                           status=403, code="authentication_required")

    return _named_actor(request)
