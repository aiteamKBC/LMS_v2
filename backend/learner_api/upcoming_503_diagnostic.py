"""Temporary, opt-in file diagnostic for the Training Plan ``upcoming`` 503.

Enable only on a local DEBUG process with
``LMS_UPCOMING_503_FILE_DIAGNOSTIC=1``.  Each process writes its own file under
the operating-system temporary directory, so Django's runserver reloader and
parallel development processes never share a handler or output stream.

This module deliberately records no exception text or traceback.  A PostgreSQL
primary message is retained only for the small allow-list of SQLSTATEs that
unambiguously identify missing schema objects.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import re
import tempfile
import threading
import traceback

from django.conf import settings

from login.errors import safe_sqlstate


_ENABLE_ENV = "LMS_UPCOMING_503_FILE_DIAGNOSTIC"
_SCHEMA_PRIMARY_PATTERNS = {
    "42703": re.compile(r'column [A-Za-z0-9_$."-]+ does not exist'),
    "42P01": re.compile(r'relation "[A-Za-z0-9_$.-]+" does not exist'),
    "42704": re.compile(r'(?:type|collation) "[A-Za-z0-9_$.-]+" does not exist'),
    "42883": re.compile(r'function [A-Za-z0-9_$."-]+\([A-Za-z0-9_$., \[\]-]*\) does not exist'),
}
_SAFE_STAGE = re.compile(r"[a-z0-9_-]{1,64}")
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
_WRITE_LOCK = threading.Lock()


def diagnostic_log_path(pid=None):
    """The per-process local file used when the diagnostic is enabled."""
    process_id = os.getpid() if pid is None else int(pid)
    return Path(tempfile.gettempdir()) / "kbc-lms" / f"upcoming-503-{process_id}.log"


def _project_location(error):
    """Return only the innermost repository-relative frame and line."""
    for frame in reversed(traceback.extract_tb(error.__traceback__)):
        try:
            relative = Path(frame.filename).resolve().relative_to(_BACKEND_ROOT)
        except (OSError, ValueError):
            continue
        if ".venv" in relative.parts:
            continue
        return f"{relative.as_posix()}:{frame.lineno}"
    return "unknown"


def _schema_primary(error, sqlstate):
    pattern = _SCHEMA_PRIMARY_PATTERNS.get(sqlstate)
    if pattern is None:
        return None
    cause = getattr(error, "__cause__", None) or error
    primary = getattr(getattr(cause, "diag", None), "message_primary", None)
    if not isinstance(primary, str):
        return None
    # One bounded line matching a PostgreSQL missing-schema-object form. This
    # second allow-list prevents a dynamic identifier containing user data from
    # entering the file even when PostgreSQL classified it as a schema error.
    primary = re.sub(r"[\x00-\x1f\x7f]+", " ", primary).strip()[:300]
    return primary if pattern.fullmatch(primary) else None


def capture_upcoming_database_error(error, *, stage):
    """Append one sanitised JSON event, or do nothing unless explicitly enabled.

    Diagnostic failures are swallowed so this temporary facility can never
    replace or alter the endpoint's existing generic 503 response.
    """
    if not settings.DEBUG or os.environ.get(_ENABLE_ENV) != "1":
        return None
    try:
        sqlstate = safe_sqlstate(error)
        safe_stage = str(stage or "").strip().casefold()
        payload = {
            "event": "learner_upcoming_database_error",
            "exception_class": type(error).__name__,
            "sqlstate": sqlstate,
            "stage": safe_stage if _SAFE_STAGE.fullmatch(safe_stage) else "unknown",
            "location": _project_location(error),
        }
        primary = _schema_primary(error, sqlstate)
        if primary is not None:
            payload["postgres_primary"] = primary

        path = diagnostic_log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Per-PID paths isolate processes; the lock serialises threads inside
        # one Django process. A fresh handler avoids persistent logger mutation.
        with _WRITE_LOCK:
            handler = logging.FileHandler(path, mode="a", encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
            logger = logging.getLogger(f"{__name__}.file")
            logger.setLevel(logging.ERROR)
            logger.propagate = False
            logger.addHandler(handler)
            try:
                logger.error(json.dumps(payload, ensure_ascii=True, separators=(",", ":")))
            finally:
                logger.removeHandler(handler)
                handler.close()
        return path
    except Exception:
        return None
