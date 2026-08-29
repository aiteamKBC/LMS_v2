"""Attach the login identity to every request.

Runs once per request so any view — including the existing ``learner_api`` and
``enrolment_api`` views — can read ``request.login_account`` without importing
the session machinery or paying for a second lookup.

It never rejects a request: authorisation belongs to the decorators in
``permissions.py``, and a middleware that blanket-401s would break the health
and login endpoints themselves.

Failures are swallowed. If the auth database is briefly unreachable, an
anonymous request must still be served rather than 500ing the whole site; the
protected views will then correctly refuse it as unauthenticated.
"""
from __future__ import annotations

import logging

from django.db import DatabaseError

from .sessions import RENEWED_UNTIL_ATTR, authenticate_request, refresh_session_cookie

logger = logging.getLogger("login")


class LoginSessionMiddleware:
    """Resolve the session inbound; extend its cookie outbound.

    The outbound half exists because a rolling session has two expiries that
    have to agree. ``authenticate_request`` may push ``Expires_at`` forward in
    the database, but the browser only keeps sending the cookie for as long as
    its own ``Max-Age`` says — so a renewal the response never carries back
    leaves the person signed out at the original time regardless. The request
    attribute is the whole of the signal between the two halves; see
    ``sessions.refresh_session_cookie`` for the guards that decide whether it is
    acted on.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            authenticate_request(request)
        except DatabaseError:
            logger.exception("Could not resolve login session")
            request.login_session = None
            request.login_account = None
            setattr(request, RENEWED_UNTIL_ATTR, None)

        response = self.get_response(request)

        try:
            refresh_session_cookie(request, response)
        except Exception:  # noqa: BLE001 - a cookie refresh must not 500 a good response
            logger.exception("Could not refresh the login session cookie")

        return response
