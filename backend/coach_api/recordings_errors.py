"""Safe calendar diagnostics. Never return Graph bodies, paths or identifiers."""
import re
from urllib.error import HTTPError, URLError


def calendar_failure(error):
    cause = error
    seen = set()
    while cause.__cause__ is not None and id(cause) not in seen:
        seen.add(id(cause))
        cause = cause.__cause__
    # The existing Graph transport wraps HTTPError and keeps its cause. Only
    # recognise these allowlisted provider codes; the raw message stays private.
    status = cause.code if isinstance(cause, HTTPError) else None
    diagnostics = str(error).split('; message=', 1)[0]
    unsupported = re.search(r'\bcode=(?:Error)?MailboxNotEnabledForRESTAPI\b', diagnostics)
    if status in (400, 404) and unsupported:
        return {'code': 'calendar_mailbox_unavailable', 'retryable': False}
    if status in (400, 404):
        return {'code': 'calendar_not_found' if status == 404 else 'calendar_request_rejected', 'retryable': False}
    if status in (401, 403):
        return {'code': 'calendar_access_denied', 'retryable': False}
    if status == 429:
        return {'code': 'calendar_throttled', 'retryable': True}
    if isinstance(cause, TimeoutError) or (isinstance(cause, URLError) and isinstance(cause.reason, TimeoutError)):
        return {'code': 'calendar_timeout', 'retryable': True}
    return {'code': 'calendar_read_failed', 'retryable': True}
