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

from .sessions import authenticate_request

logger = logging.getLogger("login")


class LoginSessionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            authenticate_request(request)
        except DatabaseError:
            logger.exception("Could not resolve login session")
            request.login_session = None
            request.login_account = None
        return self.get_response(request)
