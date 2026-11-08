"""Safe public responses for genuine database failures.

A database exception's text can carry SQL, relation and constraint names,
parameter values (addresses, ids), hosts and connection details. None of it
belongs in an API response, and none of it belongs in a log line either. What
is kept is enough to diagnose: the operation, the exception class and the
SQLSTATE the server reported.

Only database failures are handled here. Validation, permission, token and
programming errors keep their own responses, and anything not listed in
``DATABASE_ERRORS`` keeps propagating rather than being reported as an outage.

Used explicitly by the views that opt in; there is no middleware or global
exception handler behind this.
"""
from __future__ import annotations

import re

import psycopg
from django.db import Error as DjangoDatabaseError
from django.http import JsonResponse

#: Django's base database error (``DatabaseError`` and its subclasses, plus
#: ``InterfaceError`` for a dropped or closed connection, which does not
#: subclass ``DatabaseError``), and the driver's own base class for a psycopg
#: error raised outside Django's cursor wrapper.
DATABASE_ERRORS = (DjangoDatabaseError, psycopg.Error)

_SQLSTATE = re.compile(r"[0-9A-Z]{5}")

#: Context a caller may attach to the log line. Anything else is dropped, so a
#: future caller cannot start logging an email address or a token by accident.
_CONTEXT_KEYS = ("kind", "learner_id")
_CONTEXT_TEXT = re.compile(r"[a-z_]{1,32}")


def safe_sqlstate(exc) -> str:
    """The five-character SQLSTATE of a driver error, or ``"unknown"``.

    psycopg errors carry it themselves; Django's wrappers carry the psycopg
    error as ``__cause__``. Anything that is not a well-formed code is not
    trusted into the log.
    """
    for candidate in (exc, getattr(exc, "__cause__", None)):
        value = getattr(candidate, "sqlstate", None)
        if isinstance(value, str) and _SQLSTATE.fullmatch(value):
            return value
    return "unknown"


def _context_value(value):
    if isinstance(value, bool):
        return "redacted"
    if isinstance(value, int):
        return value
    if isinstance(value, str) and _CONTEXT_TEXT.fullmatch(value):
        return value
    return "redacted"


def database_unavailable(operation, exc, *, message, logger, area, status=502, context=None):
    """Log one sanitised line for ``exc`` and return ``{"error": message}``.

    ``logger`` is the caller's own, so its records stay under the caller's name.
    The exception message and traceback are deliberately not logged.
    """
    fields = [
        f"operation={operation}",
        f"type={type(exc).__name__}",
        f"sqlstate={safe_sqlstate(exc)}",
    ]
    for key in _CONTEXT_KEYS:
        if context and key in context:
            fields.append(f"{key}={_context_value(context[key])}")
    logger.error("%s database failure: %s", area, " ".join(fields))
    return JsonResponse({"error": message}, status=status)
