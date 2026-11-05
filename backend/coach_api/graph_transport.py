"""Bounded Graph retries, limited to reads and identified event creation."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import random
import re
import time
from urllib import error, request as http
from urllib.parse import urlsplit


TRANSIENT = frozenset({408, 429, 502, 503, 504})


class GraphRequestError(RuntimeError):
    def __init__(self, message, *, status=None, retry_after=None, uncertain=False, request_id=''):
        super().__init__(message)
        self.status_code = status
        self.retry_after = retry_after
        self.uncertain = uncertain
        self.request_id = request_id


def retry_after_seconds(headers, now=None):
    value = str((headers or {}).get('Retry-After') or '').strip()
    if not value:
        return None
    try:
        if re.fullmatch(r'[0-9]+(?:\.[0-9]+)?', value):
            return float(value)
        when = parsedate_to_datetime(value)
        if when.tzinfo is None:
            return None
        return max(0.0, (when - (now or datetime.now(timezone.utc))).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return None


def retry_allowed(request):
    if request.get_method() == 'GET':
        return True
    if request.get_method() != 'POST':
        return False
    url = urlsplit(request.full_url)
    if url.scheme != 'https' or url.hostname != 'graph.microsoft.com':
        return False
    # A forward/invite, cancellation or onlineMeeting creation is never retried.
    if not re.fullmatch(r'/v1\.0/(?:users|groups)/[^/]+/(?:calendar/|calendars/[^/]+/)?events/?', url.path):
        return False
    try:
        body = json.loads(request.data or b'{}')
        identity = body.get('transactionId') if isinstance(body, dict) else None
        return isinstance(identity, str) and bool(identity.strip()) and len(identity) <= 255
    except (ValueError, TypeError, UnicodeError):
        return False


def read_graph_response(request, *, opener=None, sleep=None, clock=None, jitter=None, timeout=25):
    """Use the identical payload/transaction ID, at most three fresh connections.

    Long Retry-After values are returned to the caller rather than tying up a
    worker or retrying before Microsoft's requested delay. Mutations without a
    documented idempotency key retain the existing single-attempt behavior.
    """
    opener, sleep = opener or http.urlopen, sleep or time.sleep
    clock, jitter = clock or time.monotonic, jitter or random.random
    eligible, started, waited, uncertain = retry_allowed(request), clock(), 0.0, False
    mutation = request.get_method() not in ('GET', 'HEAD')
    for attempt in range(3):
        # A fresh Request/connection; bytes, headers and transaction ID stay put.
        outgoing = http.Request(request.full_url, data=request.data,
                                headers=dict(request.header_items()), method=request.get_method())
        try:
            with opener(outgoing, timeout=min(timeout, max(0.1, 60 - (clock() - started)))) as response:
                return response.read()
        except (error.HTTPError, error.URLError, TimeoutError) as exc:
            status = exc.code if isinstance(exc, error.HTTPError) else None
            uncertain |= mutation and (status is None or status >= 500 or status == 408)
            exc.graph_write_uncertain = uncertain
            exc.graph_attempts = attempt + 1
            if not eligible or (status is not None and status not in TRANSIENT) or attempt == 2:
                raise
            delay = retry_after_seconds(getattr(exc, 'headers', None))
            if delay is None:
                delay = (0.5 * 2 ** attempt) + 0.25 * jitter()
            if waited + delay > 8 or clock() - started + delay >= 60:
                raise
            if isinstance(exc, error.HTTPError):
                exc.close()
            sleep(delay)
            waited += delay


def html_error_details(detail, status):
    """Recognize the upstream queue failure without returning its HTML page."""
    if 'application request queue full' in str(detail).lower():
        return 'ApplicationRequestQueueFull', 'Microsoft is temporarily busy; its request queue is full.'
    if status in TRANSIENT:
        return 'ServiceUnavailable', 'Microsoft is temporarily unavailable.'
    return '', 'Microsoft could not complete the request.'
