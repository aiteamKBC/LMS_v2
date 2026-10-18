"""Output guard: no learner/staff personal data in anything a tool returns.

Keys are compared after lower-casing and removing ``_``, ``-`` and spaces, so
``learnerEmail``, ``email_address`` and ``Post Code`` all match. Strict mode (DEBUG,
the test branch, the test runner) fails the tool call; production strips the keys
and logs only where they were found. Extra keys: ``MCP_PII_EXTRA_KEYS`` (comma list).
"""
import logging
import os
import re

from django.conf import settings

logger = logging.getLogger("mcp_api")

#: A key containing any of these is personal data.
PII_FRAGMENTS = ("email", "phone", "postcode", "address", "nationalinsurance", "ninumber", "dateofbirth")
#: A key equal to one of these is personal data (too short to match inside other words).
PII_EXACT = ("dob", "ni", "mobile")


class PiiLeak(Exception):
    def __init__(self, path):
        super().__init__(f"personal data key at {path}")
        self.path = path


def _normalise(key):
    return re.sub(r"[\s_\-]", "", str(key)).lower()


def _extra():
    raw = os.environ.get("MCP_PII_EXTRA_KEYS", "")
    return {_normalise(k) for k in raw.split(",") if k.strip()}


def is_pii_key(key, extra=frozenset()):
    norm = _normalise(key)
    return norm in PII_EXACT or norm in extra or any(f in norm for f in PII_FRAGMENTS)


def find_pii(obj, path="result", extra=None):
    """Paths of every personal-data key in ``obj``."""
    extra = _extra() if extra is None else extra
    found = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            here = f"{path}.{key}"
            if is_pii_key(key, extra):
                found.append(here)
            else:
                found.extend(find_pii(value, here, extra))
    elif isinstance(obj, (list, tuple)):
        for index, value in enumerate(obj):
            found.extend(find_pii(value, f"{path}[{index}]", extra))
    return found


def assert_no_pii(obj):
    found = find_pii(obj)
    if found:
        raise PiiLeak(found[0])


def strip_pii(obj, extra=None):
    extra = _extra() if extra is None else extra
    if isinstance(obj, dict):
        return {k: strip_pii(v, extra) for k, v in obj.items() if not is_pii_key(k, extra)}
    if isinstance(obj, (list, tuple)):
        return [strip_pii(v, extra) for v in obj]
    return obj


def strict():
    return bool(
        settings.DEBUG
        or getattr(settings, "USE_SECURITY_TEST_BRANCH", False)
        or getattr(settings, "RUN_APP_ON_TEST_BRANCH", False)
    )


def guard(obj):
    """Return ``obj`` safe to send: raise in strict mode, strip and log otherwise."""
    found = find_pii(obj)
    if not found:
        return obj
    if strict():
        raise PiiLeak(found[0])
    logger.warning("MCP output contained personal-data keys; stripped (%d at e.g. %s).", len(found), found[0])
    return strip_pii(obj)
