"""Site-wide announcement banners — login."Announcements".

    GET    /login_api/announcements/              live banners (public)
    GET    /login_api/admin/announcements/        every banner, newest first (admin)
    POST   /login_api/admin/announcements/        create (admin)
    PUT    /login_api/admin/announcements/<id>/   edit (admin)
    DELETE /login_api/admin/announcements/<id>/   remove (admin)

The public read is deliberately unauthenticated: a maintenance notice matters
most on the sign-in page, before anyone has a session. It returns only what is
live right now and only the fields the banner draws — the message is something
an administrator chose to show everyone, so there is nothing to scope.

Writes follow ``platform_admin``: ``require_role("admin")``, the custom-header
CSRF check, and a ``Login_audit`` row naming who changed what.
"""
from __future__ import annotations

import json
import re
import time

from django.db import DatabaseError, connections, router, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from .models import ROLE_ADMIN, Announcement, LoginAudit
from .permissions import require_role
from .platform_admin import _error, _iso, _reject_cross_site
from .security import client_ip, user_agent

MAX_MESSAGE_LENGTH = 500
#: A console list is read by a human; older rows remain in the table.
ADMIN_LIST_LIMIT = 200
_HEX_COLOR = re.compile(r"^#[0-9A-Fa-f]{6}$")

#: The normalised database (``NEW_ENDPOINT_URL``) dropped login."Announcements".
#: There nothing can be announced, so the banner read answers "none" instead of
#: failing on every page, and the console says the feature has no table. The
#: answer is held briefly so a table created later is picked up without a restart.
_TABLE_CHECK_TTL_SECONDS = 300.0
_table_check = {"at": None, "present": True}
_NO_TABLE_MESSAGE = "Announcements are not available on this database (login.\"Announcements\" is not present)."


def _table_present():
    now = time.monotonic()
    if _table_check["at"] is not None and now - _table_check["at"] < _TABLE_CHECK_TTL_SECONDS:
        return _table_check["present"]
    alias = router.db_for_read(Announcement) or "default"
    connection = connections[alias]
    if connection.vendor != "postgresql":
        return True
    try:
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass(%s) is not null", ['login."Announcements"'])
            present = bool(cursor.fetchone()[0])
    except DatabaseError:
        return True  # unknown: let the real query report the error
    _table_check.update(at=now, present=present)
    return present


def _public_json(row):
    return {
        "id": row.id,
        "message": row.message,
        "backgroundColor": row.background_color,
        "startsAt": _iso(row.starts_at),
        "endsAt": _iso(row.ends_at),
    }


def _admin_json(row, now):
    if now < row.starts_at:
        status = "scheduled"
    elif now < row.ends_at:
        status = "live"
    else:
        status = "ended"
    return {
        **_public_json(row),
        "status": status,
        "createdBy": row.created_by,
        "createdAt": _iso(row.created_at),
        "updatedAt": _iso(row.updated_at),
    }


def _parse_payload(request):
    """Validate a create/edit body. Returns ``(fields, None)`` or ``(None, error)``."""
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return None, _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return None, _error("Request body must be a JSON object.", 400)

    message = payload.get("message")
    message = message.strip() if isinstance(message, str) else ""
    if not message:
        return None, _error("Enter the announcement message.", 400)
    if len(message) > MAX_MESSAGE_LENGTH:
        return None, _error(f"Keep the message to {MAX_MESSAGE_LENGTH} characters or fewer.", 400)

    color = payload.get("backgroundColor")
    if not isinstance(color, str) or not _HEX_COLOR.match(color):
        return None, _error("Background colour must be a hex colour such as #1D4ED8.", 400)

    times = {}
    for key, label in (("startsAt", "start"), ("endsAt", "end")):
        raw = payload.get(key)
        value = parse_datetime(raw) if isinstance(raw, str) else None
        # A naive time would be read in the server's zone, not the author's.
        if value is None or timezone.is_naive(value):
            return None, _error(f"Enter a valid {label} date and time.", 400)
        times[key] = value
    if times["endsAt"] <= times["startsAt"]:
        return None, _error("The end must be after the start.", 400)

    return {
        "message": message,
        "background_color": color.upper(),
        "starts_at": times["startsAt"],
        "ends_at": times["endsAt"],
    }, None


def _audit(request, event, row):
    actor = request.login_account
    LoginAudit.objects.create(
        event=event,
        email=actor.email,
        account_id=actor.id,
        succeeded=True,
        reason=f"announcement #{row.id}",
        ip_address=client_ip(request),
        user_agent=user_agent(request),
    )


@never_cache
@require_GET
def active(request):
    if not _table_present():
        return JsonResponse({"announcements": []})
    now = timezone.now()
    try:
        rows = list(
            Announcement.objects
            .filter(starts_at__lte=now, ends_at__gt=now)
            .only("id", "message", "background_color", "starts_at", "ends_at")
            .order_by("starts_at", "id")
        )
    except DatabaseError:
        return _error("Announcements are unavailable.", 503)
    return JsonResponse({"announcements": [_public_json(r) for r in rows]})


@never_cache
@csrf_exempt
@require_http_methods(["GET", "POST"])
@require_role(ROLE_ADMIN)
def admin_list(request):
    if not _table_present():
        if request.method == "GET":
            return JsonResponse({"results": [], "available": False, "detail": _NO_TABLE_MESSAGE})
        return _error(_NO_TABLE_MESSAGE, 409)
    if request.method == "GET":
        try:
            rows = list(Announcement.objects.order_by("-starts_at", "-id")[:ADMIN_LIST_LIMIT])
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        now = timezone.now()
        return JsonResponse({"results": [_admin_json(r, now) for r in rows]})

    blocked = _reject_cross_site(request)
    if blocked:
        return blocked
    fields, error = _parse_payload(request)
    if error:
        return error
    try:
        with transaction.atomic(using="enrolment"):
            row = Announcement.objects.create(created_by=request.login_account.email, **fields)
            _audit(request, "admin_announcement_create", row)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    return JsonResponse(_admin_json(row, timezone.now()), status=201)


@never_cache
@csrf_exempt
@require_http_methods(["PUT", "DELETE"])
@require_role(ROLE_ADMIN)
def admin_detail(request, pk):
    blocked = _reject_cross_site(request)
    if blocked:
        return blocked
    if not _table_present():
        return _error(_NO_TABLE_MESSAGE, 409)

    fields = None
    if request.method == "PUT":
        fields, error = _parse_payload(request)
        if error:
            return error

    try:
        with transaction.atomic(using="enrolment"):
            row = Announcement.objects.select_for_update().filter(pk=pk).first()
            if row is None:
                return _error("That announcement no longer exists.", 404)
            if fields is None:
                _audit(request, "admin_announcement_delete", row)
                row.delete()
                return JsonResponse({"id": pk, "deleted": True})
            for name, value in fields.items():
                setattr(row, name, value)
            row.save(update_fields=[*fields, "updated_at"])
            _audit(request, "admin_announcement_update", row)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    return JsonResponse(_admin_json(row, timezone.now()))
