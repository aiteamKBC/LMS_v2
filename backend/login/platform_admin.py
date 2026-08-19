"""Read models for the Super Admin console — /login_api/admin/*.

Why this module exists
----------------------
The admin workspace used to render entirely from fixtures in the SPA: invented
tenants, invented integrations, invented delivery counts. Nothing on those
screens could be acted on, because nothing on them came from a table. These
endpoints replace the fixtures with the platform's own records, so every number
the console shows is one somebody can go and verify.

Scope is deliberately narrow: **counts and lists that already exist**. Where the
platform has no concept — there is one provider, not a tenant estate; there is no
rules engine behind "automations" — the answer is to delete the screen, not to
invent an endpoint. So the surface here is small on purpose:

    GET  /login_api/admin/overview/    headline counts across login + enrolment
    GET  /login_api/admin/accounts/    sign-in accounts, filterable, paginated
    POST /login_api/admin/accounts/<id>/   suspend / restore / unlock
    GET  /login_api/admin/audit/       login."Login_audit", filterable, paginated
    GET  /login_api/admin/roles/       the four real roles + live member counts
    GET  /login_api/admin/email-log/   invitation + reset delivery attempts
    GET  /login_api/admin/system/      subsystem readiness (no secret values)
    GET  /login_api/admin/documents/   enrolment."Enrolment_Documents", paginated
    GET  /login_api/admin/curriculum/  programmes and cohorts with enrolment counts

Everything is ``require_role("admin")``: these read across every learner, every
employer and the whole auth audit, which is a strictly wider blast radius than
``staff_only`` is meant to cover.

Aggregates use raw SQL on the ``enrolment`` connection rather than the ORM. The
counts span four schemas (``login``, ``enrolment``, ``curriculum``, ``Learner``)
whose tables are all ``managed = False`` and have no FKs between them, so there
is no join for the ORM to express. One round trip of scalar subqueries also beats
a dozen ``.count()`` calls over a Neon connection with real latency.

Every statement runs inside ``transaction.atomic`` — see ``_optional_scalars``
for why that is load-bearing rather than decorative.
"""
from __future__ import annotations

import json

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from . import email_azure
from .identity import permissions_for
from .models import (
    EVENT_LOGIN,
    ROLE_ADMIN,
    ROLE_EMPLOYER,
    ROLE_LEARNER,
    ROLE_STAFF,
    Invitation,
    LoginAccount,
    LoginAudit,
    PasswordReset,
)
from .permissions import require_role
from .security import client_ip, user_agent

#: Page size ceiling for the list endpoints. A console table is read by a human;
#: anything past this is an export job, not a page view.
MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


def _error(message, status, code=None):
    payload = {"error": message}
    if code:
        payload["code"] = code
    return JsonResponse(payload, status=status)


def _reject_cross_site(request):
    """Same CSRF stance as ``login.views`` — a custom header no cross-origin
    form post can set. Kept identical so the SPA client speaks one dialect."""
    if request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return _error("Missing X-Requested-With header.", 403, code="csrf")
    return None


def _paging(request):
    """Read ``page``/``pageSize``, clamped. Bad input pages from the top rather
    than 400-ing: a console table should not blank out over a stray query string."""
    try:
        page = max(1, int(request.GET.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        size = int(request.GET.get("pageSize", DEFAULT_PAGE_SIZE))
    except (TypeError, ValueError):
        size = DEFAULT_PAGE_SIZE
    size = max(1, min(size, MAX_PAGE_SIZE))
    return page, size


def _iso(value):
    return value.isoformat() if value else None


def _scalars(sql, params=None):
    """Run one statement of scalar subqueries and return it as a dict."""
    with connections["enrolment"].cursor() as cur:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        row = cur.fetchone()
    return dict(zip(cols, row)) if row else {}


def _rows(sql, params=None):
    with connections["enrolment"].cursor() as cur:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _scalars_or_raise(sql, params=None):
    """``_scalars`` in a savepoint, re-raising so the caller can report the error.

    Used where a failure is worth surfacing (the login schema is this app's own —
    if it is missing, saying so beats showing zeros) but must still leave the
    connection usable for the rest of the request.
    """
    with transaction.atomic(using="enrolment"):
        return _scalars(sql, params)


def _optional_scalars(sql, params=None):
    """``_scalars`` that yields {} instead of raising when the tables are missing.

    The curriculum and Learner schemas are populated by separate provisioning
    steps. A console that 500s because a cohort table has not been created yet
    is worse than one that shows the counts it does have, so a failure here
    degrades to "unavailable" and the caller omits those cards.

    The ``atomic`` block is load-bearing, not decoration. Postgres aborts the
    surrounding transaction on a failed statement, and nothing else runs on that
    connection until it is unwound — so without this, one missing table takes out
    every later query on the request, including the session lookup, and the
    caller gets a 401 instead of a partial answer. ``atomic`` opens a savepoint
    and releases it on the way out, which unwinds only this statement and works
    whether or not a transaction is already open (it always is under TestCase,
    where a bare ``rollback()`` would itself raise).
    """
    try:
        with transaction.atomic(using="enrolment"):
            return _scalars(sql, params)
    except DatabaseError:
        return {}


def _optional_rows(sql, params=None):
    """``_rows`` inside a savepoint, degrading to ``(error, [])`` on failure.

    Returns ``(error, rows)``. Same reasoning as ``_optional_scalars``: a table
    that has not been provisioned is a deployment fact, not a request failure,
    and answering 200-with-nothing lets the console say "this deployment has no
    document store" instead of showing the operator a generic 502.
    """
    try:
        with transaction.atomic(using="enrolment"):
            return None, _rows(sql, params)
    except DatabaseError as exc:
        return str(exc), []


# ---------------------------------------------------------------------------
# Overview — the dashboard's numbers
# ---------------------------------------------------------------------------

@require_GET
@require_role(ROLE_ADMIN)
def overview(request):
    """Headline platform counts, all from real tables.

    Grouped by the schema each number comes from so the SPA can drop a whole
    section when its source is unavailable rather than rendering zeros — a zero
    and an unknown mean very different things on a control console.
    """
    now = timezone.now()

    # --- login schema: accounts, sessions, invitations -------------------
    # Savepointed like the rest: if this fails, the connection must survive for
    # the sections below (and for the session lookup on the way out).
    try:
        accounts = _scalars_or_raise(
            """
            SELECT
              (SELECT count(*) FROM login."Login_accounts")                                   AS total,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Is_active")                 AS active,
              (SELECT count(*) FROM login."Login_accounts" WHERE NOT "Is_active")             AS suspended,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Password_hash" <> '')       AS with_password,
              (SELECT count(*) FROM login."Login_accounts"
                 WHERE "Locked_until" IS NOT NULL AND "Locked_until" > now())                 AS locked,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Role" = 'admin')            AS admins,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Role" = 'staff')            AS staff,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Role" = 'employer')         AS employers,
              (SELECT count(*) FROM login."Login_accounts" WHERE "Role" = 'learner')          AS learners,
              (SELECT count(*) FROM login."Login_accounts"
                 WHERE "Last_login_at" IS NOT NULL AND "Last_login_at" > now() - interval '30 days')
                                                                                              AS active_30d,
              (SELECT count(*) FROM login."Login_sessions"
                 WHERE "Revoked_at" IS NULL AND "Expires_at" > now())                         AS live_sessions,
              (SELECT count(*) FROM login."Invitations"
                 WHERE "Used_at" IS NULL AND "Expires_at" > now())                            AS pending_invites,
              (SELECT count(*) FROM login."Invitations"
                 WHERE "Used_at" IS NULL AND "Expires_at" <= now())                           AS expired_invites,
              (SELECT count(*) FROM login."Invitations" WHERE "Send_error" IS NOT NULL)       AS failed_invites
            """
        )
        login_ok = True
        login_error = None
    except DatabaseError as exc:
        accounts, login_ok, login_error = {}, False, str(exc)

    # --- login audit: 24h authentication activity ------------------------
    audit = _optional_scalars(
        """
        SELECT
          (SELECT count(*) FROM login."Login_audit" WHERE "Created_at" > now() - interval '24 hours')
                                                                                    AS events_24h,
          (SELECT count(*) FROM login."Login_audit"
             WHERE "Event" = %s AND "Succeeded" AND "Created_at" > now() - interval '24 hours')
                                                                                    AS signins_24h,
          (SELECT count(*) FROM login."Login_audit"
             WHERE "Event" = %s AND NOT "Succeeded" AND "Created_at" > now() - interval '24 hours')
                                                                                    AS failed_signins_24h,
          (SELECT count(DISTINCT "Account_id") FROM login."Login_audit"
             WHERE "Event" = %s AND "Succeeded" AND "Created_at" > now() - interval '7 days')
                                                                                    AS distinct_signins_7d
        """,
        [EVENT_LOGIN, EVENT_LOGIN, EVENT_LOGIN],
    )

    # --- enrolment schema: the people themselves -------------------------
    # NOTE: Created_users." Status" genuinely has a leading space in the column
    # name (see learner_api.models.EnrolmentUser). Quoted exactly, not trimmed.
    people = _optional_scalars(
        """
        SELECT
          (SELECT count(*) FROM enrolment."Created_users")                                    AS learners_total,
          (SELECT count(*) FROM enrolment."Created_users" WHERE "Learner_type" = 'apprenticeship')
                                                                                              AS apprenticeship,
          (SELECT count(*) FROM enrolment."Created_users" WHERE "Learner_type" = 'commercial')
                                                                                              AS commercial,
          (SELECT count(*) FROM enrolment."Created_users" WHERE lower(coalesce(" Status", '')) = 'active')
                                                                                              AS learners_active,
          (SELECT count(*) FROM enrolment."Staff_users")                                      AS staff_total,
          (SELECT count(*) FROM enrolment."Employers")                                        AS employers_total,
          (SELECT count(*) FROM enrolment."Organisations")                                    AS organisations_total
        """
    )

    documents = _optional_scalars(
        """
        SELECT
          (SELECT count(*) FROM enrolment."Enrolment_Documents")                              AS total,
          (SELECT count(DISTINCT "Doc_type") FROM enrolment."Enrolment_Documents")            AS doc_types,
          (SELECT count(*) FROM enrolment."Enrolment_Documents" WHERE "Signed")               AS signed,
          (SELECT count(*) FROM enrolment."Enrolment_Documents"
             WHERE "Generated_at" > now() - interval '30 days')                               AS last_30d
        """
    )

    curriculum_counts = _optional_scalars(
        """
        SELECT
          (SELECT count(DISTINCT name) FROM curriculum.programmes
             WHERE coalesce(is_archived, false) = false)                                      AS programmes,
          (SELECT count(DISTINCT cohort_name) FROM curriculum.cohorts
             WHERE cohort_name IS NOT NULL AND cohort_name <> '')                             AS cohorts,
          (SELECT count(*) FROM curriculum.modules)                                           AS modules
        """
    )

    delivery = _optional_scalars(
        """
        SELECT
          (SELECT count(*) FROM "Learner"."Active_users")                                     AS active_learners,
          (SELECT count(*) FROM "Learner"."Unactive_users")                                   AS inactive_learners
        """
    )

    return JsonResponse({
        "generatedAt": _iso(now),
        "accounts": {
            "available": login_ok,
            "error": login_error,
            "total": accounts.get("total", 0),
            "active": accounts.get("active", 0),
            "suspended": accounts.get("suspended", 0),
            "withPassword": accounts.get("with_password", 0),
            # An account that exists but has never set a password is an
            # invitation that was never completed — worth surfacing separately
            # from "suspended", because the fix is different.
            "neverSignedIn": max(accounts.get("total", 0) - accounts.get("with_password", 0), 0),
            "locked": accounts.get("locked", 0),
            "activeLast30d": accounts.get("active_30d", 0),
            "liveSessions": accounts.get("live_sessions", 0),
            "byRole": {
                ROLE_ADMIN: accounts.get("admins", 0),
                ROLE_STAFF: accounts.get("staff", 0),
                ROLE_EMPLOYER: accounts.get("employers", 0),
                ROLE_LEARNER: accounts.get("learners", 0),
            },
        },
        "invitations": {
            "pending": accounts.get("pending_invites", 0),
            "expired": accounts.get("expired_invites", 0),
            "failed": accounts.get("failed_invites", 0),
        },
        "authActivity": {
            "available": bool(audit),
            "events24h": audit.get("events_24h", 0),
            "signIns24h": audit.get("signins_24h", 0),
            "failedSignIns24h": audit.get("failed_signins_24h", 0),
            "distinctSignIns7d": audit.get("distinct_signins_7d", 0),
        },
        "people": {
            "available": bool(people),
            "learners": people.get("learners_total", 0),
            "apprenticeship": people.get("apprenticeship", 0),
            "commercial": people.get("commercial", 0),
            "learnersActive": people.get("learners_active", 0),
            "staff": people.get("staff_total", 0),
            "employers": people.get("employers_total", 0),
            "organisations": people.get("organisations_total", 0),
        },
        "documents": {
            "available": bool(documents),
            "total": documents.get("total", 0),
            "docTypes": documents.get("doc_types", 0),
            "signed": documents.get("signed", 0),
            "last30d": documents.get("last_30d", 0),
        },
        "curriculum": {
            "available": bool(curriculum_counts),
            "programmes": curriculum_counts.get("programmes", 0),
            "cohorts": curriculum_counts.get("cohorts", 0),
            "modules": curriculum_counts.get("modules", 0),
        },
        "delivery": {
            "available": bool(delivery),
            "activeLearners": delivery.get("active_learners", 0),
            "inactiveLearners": delivery.get("inactive_learners", 0),
        },
    })


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

def _staff_access_map(accounts):
    """{subject_id: access} for the staff accounts in this page of results.

    One query for the page rather than one per row: the accounts list is the
    console's busiest table and an N+1 here is felt immediately.
    """
    ids = [a.subject_id for a in accounts if a.subject_type == "staff"]
    if not ids:
        return {}
    from learner_api.models import StaffUser

    try:
        with transaction.atomic(using="enrolment"):
            rows = StaffUser.objects.filter(pk__in=ids).values_list("pk", "access")
        return {pk: (access or "").strip().lower() for pk, access in rows}
    except DatabaseError:
        # The list is still worth showing without the grants.
        return {}


def _account_json(account, now, access_map=None):
    locked = bool(account.locked_until and account.locked_until > now)
    return {
        # The staff access grant, so the console can show and edit it without a
        # second request per row. "" for non-staff subjects and for staff whose
        # access has not been set yet.
        "access": (access_map or {}).get(account.subject_id, "")
        if account.subject_type == "staff" else "",
        "id": account.id,
        "email": account.email,
        "displayName": account.display_name or "",
        "role": account.role,
        "subjectType": account.subject_type,
        "subjectId": account.subject_id,
        "isActive": account.is_active,
        "hasPassword": bool(account.password_hash),
        "locked": locked,
        "lockedUntil": _iso(account.locked_until),
        "failedAttempts": account.failed_attempts,
        "lastLoginAt": _iso(account.last_login_at),
        "lastLoginIp": account.last_login_ip,
        "passwordSetAt": _iso(account.password_set_at),
        "createdAt": _iso(account.created_at),
        # Derived so the table can badge a row without four client-side rules.
        "status": (
            "suspended" if not account.is_active
            else "locked" if locked
            else "invited" if not account.password_hash
            else "active"
        ),
    }


@require_GET
@require_role(ROLE_ADMIN)
def accounts(request):
    """List sign-in accounts.

    Filters: ``role``, ``status`` (active|suspended|locked|invited), ``q`` over
    email and display name. This is the only place in the product that shows who
    can actually sign in — the user directory elsewhere lists *people*, which is
    a different set: a learner with no invitation has a row there and none here.
    """
    page, size = _paging(request)
    qs = LoginAccount.objects.all()

    role = (request.GET.get("role") or "").strip().lower()
    if role:
        qs = qs.filter(role=role)

    term = (request.GET.get("q") or "").strip()
    if term:
        from django.db.models import Q
        qs = qs.filter(Q(email__icontains=term) | Q(display_name__icontains=term))

    now = timezone.now()
    status = (request.GET.get("status") or "").strip().lower()
    if status == "active":
        qs = qs.filter(is_active=True).exclude(password_hash="")
    elif status == "suspended":
        qs = qs.filter(is_active=False)
    elif status == "invited":
        qs = qs.filter(password_hash="")
    elif status == "locked":
        qs = qs.filter(locked_until__gt=now)

    try:
        with transaction.atomic(using="enrolment"):
            total = qs.count()
            rows = list(qs.order_by("-id")[(page - 1) * size: page * size])
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    access_map = _staff_access_map(rows)
    return JsonResponse({
        "count": total,
        "page": page,
        "pageSize": size,
        "results": [_account_json(a, now, access_map) for a in rows],
    })


@csrf_exempt
@require_POST
@require_role(ROLE_ADMIN)
def account_action(request, pk):
    """Suspend, restore or unlock one account.

    The three writes the console legitimately owns. Deliberately *not* here:
    changing an account's role. Role is recomputed from the person's enrolment
    row by ``identity.ensure_account`` on every request, so a value written here
    would be silently reverted — the honest place to change it is the staff form.
    """
    blocked = _reject_cross_site(request)
    if blocked:
        return blocked

    try:
        payload = json.loads(request.body.decode("utf-8")) if request.body else {}
    except (ValueError, UnicodeDecodeError) as exc:
        return _error(f"Invalid JSON body: {exc}", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    action = (payload.get("action") or "").strip().lower()
    if action not in {"suspend", "restore", "unlock", "resend-invitation"}:
        return _error(
            "action must be one of: suspend, restore, unlock, resend-invitation.", 400
        )

    try:
        account = LoginAccount.objects.filter(pk=pk).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if account is None:
        return _error("Account not found.", 404)

    actor = getattr(request, "login_account", None)

    if action == "resend-invitation":
        # Re-issue and re-send. `send_invitation` supersedes any earlier unused
        # invitation, so the previous link dies rather than leaving two live —
        # the same guarantee the original send made.
        #
        # Offered from the access log because that is where a failed send is
        # actually noticed: a transient DNS or mail outage leaves an
        # "Invitation sent — failed" row and an account nobody can reach, and
        # re-running the creation form would be the wrong fix.
        if account.password_set_at:
            return _error(
                "That account has already set a password — send a password reset instead.",
                400,
                code="already_onboarded",
            )
        try:
            from .invitations import send_invitation

            _, sent, detail = send_invitation(
                account,
                invited_by=actor.email if actor else "admin",
                ip=client_ip(request),
                user_agent=user_agent(request),
            )
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)

        if not sent:
            # Reported as a failure so the console can say so plainly; the
            # invitation row exists either way and can be re-sent again.
            return _error(
                f"Could not send the invitation: {detail}", 502, code="send_failed"
            )
        return JsonResponse({
            "ok": True,
            "resent": True,
            "sentTo": account.email,
            "account": _account_json(account, timezone.now(), _staff_access_map([account])),
        })
    # An admin suspending themselves would lock the console's own door with no
    # way back through the UI. Cheap guard, and the failure mode is expensive.
    if action == "suspend" and actor is not None and actor.id == account.id:
        return _error("You cannot suspend your own account.", 400, code="self_suspend")

    if action == "suspend":
        account.is_active = False
        fields = ["is_active"]
        # Sessions outlive the flag otherwise: authenticate_request checks the
        # account, but revoking here makes the effect immediate and auditable.
        try:
            with transaction.atomic(using="enrolment"):
                account.sessions.filter(revoked_at__isnull=True).update(revoked_at=timezone.now())
        except DatabaseError:
            pass
    elif action == "restore":
        account.is_active = True
        account.failed_attempts = 0
        account.locked_until = None
        fields = ["is_active", "failed_attempts", "locked_until"]
    else:  # unlock
        account.failed_attempts = 0
        account.locked_until = None
        fields = ["failed_attempts", "locked_until"]

    try:
        account.save(update_fields=fields)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    # Recorded in the same trail as sign-ins, so an admin action and its effect
    # sit next to each other when somebody asks why an account stopped working.
    try:
        with transaction.atomic(using="enrolment"):
            LoginAudit.objects.create(
                event=f"admin_{action}",
                email=account.email,
                account_id=account.id,
                succeeded=True,
                reason=f"by {actor.email}" if actor else "by admin",
                ip_address=client_ip(request),
                user_agent=user_agent(request),
            )
    except DatabaseError:
        pass

    return JsonResponse({"account": _account_json(account, timezone.now(), _staff_access_map([account]))})


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

#: Events that describe something a human should look at twice. Used only to
#: colour the row; the audit table itself records no severity.
_ELEVATED_EVENTS = {"admin_suspend", "admin_restore", "admin_unlock", "password_changed"}


@require_GET
@require_role(ROLE_ADMIN)
def audit(request):
    """The authentication audit trail — login."Login_audit", newest first.

    Filters: ``event``, ``outcome`` (success|failure), ``q`` over email, ``days``.
    This is a real append-only log: failed attempts against addresses with no
    account are in here too, which is exactly what makes it worth reading.
    """
    page, size = _paging(request)
    qs = LoginAudit.objects.all()

    event = (request.GET.get("event") or "").strip()
    if event:
        qs = qs.filter(event=event)

    outcome = (request.GET.get("outcome") or "").strip().lower()
    if outcome == "success":
        qs = qs.filter(succeeded=True)
    elif outcome == "failure":
        qs = qs.filter(succeeded=False)

    term = (request.GET.get("q") or "").strip()
    if term:
        qs = qs.filter(email__icontains=term)

    try:
        days = int(request.GET.get("days", 0))
    except (TypeError, ValueError):
        days = 0
    if days > 0:
        qs = qs.filter(created_at__gt=timezone.now() - timezone.timedelta(days=days))

    try:
        with transaction.atomic(using="enrolment"):
            total = qs.count()
            rows = list(qs.order_by("-id")[(page - 1) * size: page * size])
            # Drives the filter dropdown from what the log actually contains, so
            # a new event name never needs a matching change in the SPA.
            events = sorted(LoginAudit.objects.values_list("event", flat=True).distinct())
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "count": total,
        "page": page,
        "pageSize": size,
        "eventTypes": events,
        "results": [{
            "id": r.id,
            "event": r.event,
            "email": r.email,
            "accountId": r.account_id,
            "succeeded": r.succeeded,
            "reason": r.reason,
            "ipAddress": r.ip_address,
            "userAgent": r.user_agent,
            "createdAt": _iso(r.created_at),
            "severity": (
                "critical" if not r.succeeded and r.event == EVENT_LOGIN
                else "warning" if r.event in _ELEVATED_EVENTS or not r.succeeded
                else "info"
            ),
        } for r in rows],
    })


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------

#: The four roles the platform actually authorises on, with what each is for.
#: Sourced from models.ROLE_CHOICES — this is a description of the real gate in
#: permissions.require_role, not a configurable RBAC store.
_ROLE_DESCRIPTIONS = {
    ROLE_ADMIN: "Full platform access, including account management and this console.",
    ROLE_STAFF: "Delivery and enrolment staff — learner and employer records, no account management.",
    ROLE_EMPLOYER: "Employer portal only — their own learners and documents to sign.",
    ROLE_LEARNER: "The learner's own record, plan, evidence and documents.",
}

#: Which staff positions collapse into which role, mirroring identity.py.
_ROLE_SOURCES = {
    ROLE_ADMIN: 'enrolment."Staff_users" with Position = Admin',
    ROLE_STAFF: 'enrolment."Staff_users" — every other position',
    ROLE_EMPLOYER: 'enrolment."Employers"',
    ROLE_LEARNER: 'enrolment."Created_users"',
}

_ROLE_ORDER = (ROLE_ADMIN, ROLE_STAFF, ROLE_EMPLOYER, ROLE_LEARNER)


@require_GET
@require_role(ROLE_ADMIN)
def roles(request):
    """The real roles, their permissions and live member counts.

    There is no role editor because there is no role table: ``require_role`` and
    ``_PERMISSIONS`` in ``identity.py`` are the authority, and a screen that let
    an admin "create a role" would produce a value nothing in the codebase
    checks. So this endpoint reports; it does not configure.
    """
    counts = {}
    try:
        with transaction.atomic(using="enrolment"):
            for role in _ROLE_ORDER:
                base = LoginAccount.objects.filter(role=role)
                counts[role] = {
                    "total": base.count(),
                    "active": base.filter(is_active=True).exclude(password_hash="").count(),
                    "invited": base.filter(password_hash="").count(),
                    "suspended": base.filter(is_active=False).count(),
                }
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    # Every permission any role holds — the columns of the console's matrix.
    all_permissions = sorted({p for role in _ROLE_ORDER for p in permissions_for(role)})

    return JsonResponse({
        "generatedAt": _iso(timezone.now()),
        "permissions": all_permissions,
        "results": [{
            "id": role,
            "name": role.capitalize(),
            "description": _ROLE_DESCRIPTIONS[role],
            "source": _ROLE_SOURCES[role],
            "permissions": permissions_for(role),
            "counts": counts.get(role, {}),
        } for role in _ROLE_ORDER],
    })


# ---------------------------------------------------------------------------
# Email delivery
# ---------------------------------------------------------------------------

@require_GET
@require_role(ROLE_ADMIN)
def email_log(request):
    """Every transactional email this platform sends, and whether it landed.

    The platform sends exactly two kinds of mail — invitations and password
    resets — and both tables record ``Sent_at`` and ``Send_error``. That is the
    whole delivery story, so this endpoint is the honest version of the old
    "notification delivery" panel with its invented SMS and WhatsApp channels.
    """
    page, size = _paging(request)
    status = (request.GET.get("status") or "").strip().lower()
    kind = (request.GET.get("kind") or "").strip().lower()

    def collect(model, label):
        if kind and kind != label:
            return []
        qs = model.objects.all()
        if status == "failed":
            qs = qs.filter(send_error__isnull=False)
        elif status == "delivered":
            qs = qs.filter(send_error__isnull=True, sent_at__isnull=False)
        elif status == "pending":
            qs = qs.filter(used_at__isnull=True)
        # Over-read to the end of the requested page so the merged, re-sorted
        # list below is still correct at the boundary without a UNION.
        return [{
            "id": f"{label}-{r.id}",
            "kind": label,
            "email": r.email,
            "accountId": r.account_id,
            "sentAt": _iso(r.sent_at),
            "usedAt": _iso(r.used_at),
            "expiresAt": _iso(r.expires_at),
            "createdAt": _iso(r.created_at),
            "error": r.send_error,
            "status": (
                "failed" if r.send_error
                else "accepted" if r.used_at
                else "delivered" if r.sent_at
                else "queued"
            ),
            "_sort": r.created_at,
        } for r in qs.order_by("-id")[: page * size]]

    try:
        with transaction.atomic(using="enrolment"):
            merged = collect(Invitation, "invitation") + collect(PasswordReset, "reset")
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    stats = _optional_scalars(
        """
        SELECT
          (SELECT count(*) FROM login."Invitations" WHERE "Sent_at" IS NOT NULL)     AS invites_sent,
          (SELECT count(*) FROM login."Invitations" WHERE "Send_error" IS NOT NULL)  AS invites_failed,
          (SELECT count(*) FROM login."Password_resets" WHERE "Sent_at" IS NOT NULL) AS resets_sent,
          (SELECT count(*) FROM login."Password_resets" WHERE "Send_error" IS NOT NULL)
                                                                                     AS resets_failed,
          (SELECT count(*) FROM login."Invitations"
             WHERE "Created_at" > now() - interval '30 days')                        AS invites_30d,
          (SELECT count(*) FROM login."Password_resets"
             WHERE "Created_at" > now() - interval '30 days')                        AS resets_30d
        """
    )

    merged.sort(key=lambda r: r["_sort"] or timezone.now(), reverse=True)
    window = merged[(page - 1) * size: page * size]
    for row in window:
        row.pop("_sort", None)

    sent = stats.get("invites_sent", 0) + stats.get("resets_sent", 0)
    failed = stats.get("invites_failed", 0) + stats.get("resets_failed", 0)

    return JsonResponse({
        "count": len(merged),
        "page": page,
        "pageSize": size,
        "stats": {
            "sent": sent,
            "failed": failed,
            "last30d": stats.get("invites_30d", 0) + stats.get("resets_30d", 0),
            "invitations": stats.get("invites_sent", 0),
            "resets": stats.get("resets_sent", 0),
            # Null rather than a misleading 100% when nothing has been sent.
            "deliveryRate": round((sent - failed) / sent * 100, 1) if sent else None,
        },
        "transport": {
            "configured": email_azure.is_configured(),
            "missing": email_azure.missing_settings(),
        },
        "results": window,
    })


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@require_GET
@require_role(ROLE_ADMIN)
def documents(request):
    """Every generated compliance document, newest first.

    The per-learner document API (``enrolment_api.documents``) answers "what does
    this learner have"; the console needs the opposite view — what exists across
    the platform, and how much of it is still unsigned. Filters: ``docType``,
    ``signed`` (yes|no), ``q`` over learner name and document name.
    """
    page, size = _paging(request)

    where, params = [], []
    doc_type = (request.GET.get("docType") or "").strip()
    if doc_type:
        where.append('"Doc_type" = %s')
        params.append(doc_type)

    signed = (request.GET.get("signed") or "").strip().lower()
    if signed == "yes":
        where.append('COALESCE("Signed", false) = true')
    elif signed == "no":
        where.append('COALESCE("Signed", false) = false')

    term = (request.GET.get("q") or "").strip()
    if term:
        where.append('("Learner_name" ILIKE %s OR "Doc_name" ILIKE %s)')
        params += [f"%{term}%", f"%{term}%"]

    clause = f"WHERE {' AND '.join(where)}" if where else ""

    error, counted = _optional_rows(
        f'SELECT count(*) AS n FROM enrolment."Enrolment_Documents" {clause}', params
    )
    total = counted[0]["n"] if counted else 0

    _, rows = _optional_rows(
        f'''SELECT id, "Learner_kind", "Learner_id", "Learner_name", "Doc_type",
                   "Doc_name", "Container", "Size_bytes", "Signed",
                   "Generated_at", "Learner_signed_at", "Employer_signed_at"
            FROM enrolment."Enrolment_Documents" {clause}
            ORDER BY "Generated_at" DESC NULLS LAST
            LIMIT %s OFFSET %s''',
        params + [size, (page - 1) * size],
    )
    _, type_rows = _optional_rows(
        'SELECT DISTINCT "Doc_type" FROM enrolment."Enrolment_Documents" '
        'WHERE "Doc_type" IS NOT NULL ORDER BY "Doc_type"'
    )

    return JsonResponse({
        "available": error is None,
        "error": error,
        "count": total,
        "page": page,
        "pageSize": size,
        "docTypes": [r["Doc_type"] for r in type_rows],
        "results": [{
            "id": str(r["id"]),
            "learnerKind": r["Learner_kind"],
            "learnerId": r["Learner_id"],
            "learnerName": r["Learner_name"],
            "docType": r["Doc_type"],
            "docName": r["Doc_name"],
            "container": r["Container"],
            "sizeBytes": r["Size_bytes"],
            "signed": bool(r["Signed"]),
            "generatedAt": _iso(r["Generated_at"]),
            "learnerSignedAt": _iso(r["Learner_signed_at"]),
            "employerSignedAt": _iso(r["Employer_signed_at"]),
        } for r in rows],
    })


# ---------------------------------------------------------------------------
# Curriculum
# ---------------------------------------------------------------------------

@require_GET
@require_role(ROLE_ADMIN)
def curriculum(request):
    """Programmes and cohorts, each with how many learners are actually on it.

    The counts come from ``enrolment."Created_users"`` rather than the curriculum
    tables, because a programme existing and a programme being used are different
    facts and the console should show both — an authored programme with no
    learners is exactly the thing worth noticing.
    """
    error, programmes = _optional_rows(
        '''SELECT p.name AS name,
                  (SELECT count(*) FROM curriculum.cohorts c
                     WHERE c.programme_name = p.name OR c.programme_id = p.programme_id)
                                                                    AS cohort_count,
                  (SELECT count(*) FROM curriculum.modules m
                     WHERE m.programme_id = p.programme_id)         AS module_count,
                  (SELECT count(*) FROM enrolment."Created_users" u
                     WHERE u."Programme" = p.name)                  AS learner_count
           FROM (SELECT DISTINCT COALESCE(NULLIF(name,''), programme_id) AS name, programme_id
                 FROM curriculum.programmes
                 WHERE COALESCE(is_archived, false) = false) p
           WHERE p.name IS NOT NULL
           ORDER BY p.name'''
    )

    programme_filter = (request.GET.get("programme") or "").strip()
    cohort_sql = '''
        SELECT c.cohort_name AS name,
               COALESCE(NULLIF(c.programme_name,''), c.programme_id) AS programme,
               (SELECT count(*) FROM enrolment."Created_users" u
                  WHERE u."Cohort" = c.cohort_name)                  AS learner_count,
               min(c.start_date) AS start_date, max(c.end_date) AS end_date
        FROM curriculum.cohorts c
        WHERE c.cohort_name IS NOT NULL AND c.cohort_name <> ''
    '''
    params = []
    if programme_filter:
        cohort_sql += " AND (c.programme_name = %s OR c.programme_id = %s)"
        params += [programme_filter, programme_filter]
    cohort_sql += " GROUP BY c.cohort_name, c.programme_name, c.programme_id ORDER BY c.cohort_name"
    # Cohort dates are optional columns on some deployments; the programme list
    # is still worth returning without them.
    _, cohorts = _optional_rows(cohort_sql, params)

    return JsonResponse({
        "available": error is None,
        "error": error,
        "programmes": [{
            "name": r["name"],
            "cohorts": r["cohort_count"],
            "modules": r["module_count"],
            "learners": r["learner_count"],
        } for r in programmes],
        "cohorts": [{
            "name": r["name"],
            "programme": r["programme"],
            "learners": r["learner_count"],
            "startDate": _iso(r["start_date"]) if r.get("start_date") else None,
            "endDate": _iso(r["end_date"]) if r.get("end_date") else None,
        } for r in cohorts],
    })


# ---------------------------------------------------------------------------
# System status
# ---------------------------------------------------------------------------

#: Subsystems this deployment genuinely has, and the env var(s) that switch each
#: on. Reports whether a name is set — never the value. The alternates mirror the
#: fallbacks the consuming modules themselves accept (e.g. coach_api reads either
#: MICROSOFT_CLIENT_ID or CLIENTID), so this agrees with what actually runs.
_SUBSYSTEMS = [
    ("database", "Enrolment database (Neon)", "Learner, enrolment and auth records", ()),
    ("email", "Azure email", "Invitations and password resets", ()),
    ("blob", "Azure Blob Storage", "Generated compliance documents",
     ("AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_ACCOUNT")),
    ("graph", "Microsoft Graph", "Teams meetings and Outlook calendar sync",
     ("MICROSOFT_CLIENT_ID", "CLIENTID")),
    ("openai", "AI provider", "Reflection proofreading and transcription",
     ("AZURE_OPENAI_API_KEY", "OPENAI_API_KEY")),
]


@require_GET
@require_role(ROLE_ADMIN)
def system(request):
    """Readiness of each subsystem this deployment actually depends on.

    Replaces the old integrations screen's invented Aptem / Power BI / DocuSign /
    CRM tiles. A subsystem is "configured" when its settings are present — that
    is a fact this process can establish without making a call to anyone; it is
    not a claim that the remote end is healthy, and the SPA labels it as such.
    """
    import os

    checks = []
    for key, name, purpose, env_vars in _SUBSYSTEMS:
        if key == "database":
            try:
                with transaction.atomic(using="enrolment"):
                    with connections["enrolment"].cursor() as cur:
                        cur.execute("SELECT 1")
                        cur.fetchone()
                configured, detail = True, "Connected"
            except DatabaseError as exc:
                configured, detail = False, str(exc)[:200]
        elif key == "email":
            configured = email_azure.is_configured()
            detail = "Configured" if configured else f"Missing: {', '.join(email_azure.missing_settings())}"
        else:
            configured = any(os.environ.get(v, "").strip() for v in env_vars)
            detail = "Configured" if configured else f"Not set: {' or '.join(env_vars)}"

        checks.append({
            "id": key,
            "name": name,
            "purpose": purpose,
            "configured": configured,
            "detail": detail,
        })

    return JsonResponse({
        "generatedAt": _iso(timezone.now()),
        "checks": checks,
        "configuredCount": sum(1 for c in checks if c["configured"]),
        "totalCount": len(checks),
    })
