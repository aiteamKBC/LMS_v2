from __future__ import annotations

import functools
import hmac
import hashlib
import os
import time

from django.http import JsonResponse
from django.conf import settings

from login.identity import accesses_for_staff
from login.permissions import _forbidden, _unauthenticated
from login.sessions import authenticate_request
from learner_api.constants import ACCESS_INTEGRATIONS, ACCESS_SUPER_ADMIN
from learner_api.models import StaffUser


def service_signature_valid(request, *, secret, max_age=300):
    if not secret:
        return False
    timestamp = request.headers.get("X-Integration-Timestamp", "")
    signature = request.headers.get("X-Integration-Signature", "")
    try:
        age = abs(time.time() - int(timestamp))
    except (TypeError, ValueError):
        return False
    if age > max_age:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), f"{timestamp}.".encode() + request.body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def _staff_has_access(account):
    if account.role == "admin":
        return True
    if account.role != "staff" or account.subject_type != "staff":
        return False
    row = StaffUser.objects.filter(pk=account.subject_id).only("access", "access_extra").first()
    grants = accesses_for_staff(row) if row else frozenset()
    return ACCESS_SUPER_ADMIN in grants or ACCESS_INTEGRATIONS in grants


def integration_access(*, allow_employer=True, allow_service=False):
    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            if not getattr(settings, "BREATHE_INTEGRATIONS_ENABLED", False):
                return JsonResponse({"error": "The persistent Breathe connector is not enabled. The HR System demo remains available.", "code": "breathe_not_enabled"}, status=503)
            account = authenticate_request(request)
            if account is not None and (_staff_has_access(account) or (allow_employer and account.role == "employer")):
                request.integration_actor = account
                return view(request, *args, **kwargs)
            if allow_service and service_signature_valid(request, secret=os.environ.get("BREATHE_TRIGGER_SECRET", "")):
                request.integration_actor = None
                return view(request, *args, **kwargs)
            return _unauthenticated(request) if account is None else _forbidden({ACCESS_INTEGRATIONS})
        return wrapped
    return decorator
