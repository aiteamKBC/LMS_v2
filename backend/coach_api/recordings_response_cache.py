"""Bounded, private response fingerprints; authorization remains in the API."""
from hashlib import sha256
import json
import logging

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)


def meeting_key(row):
    return json.dumps([row['coachEmail'], row['calendarEventId'], row['startsAt'], row['endsAt']], separators=(',', ':'), ensure_ascii=False)


def delta_payload(request, payload, identity, reference_epoch):
    """A missing/evicted cursor safely falls back to the complete current view."""
    key = 'coach-response:v1:' + sha256(json.dumps([settings.DATABASES, identity,
        payload['scope'], payload['sync']['directoryHash']], sort_keys=True, default=str).encode()).hexdigest()
    try:
        previous = cache.get(key) or []
    except Exception:
        previous = []
        log.warning('Coaching response cache unavailable; sending full snapshot.')
    hashes = {meeting_key(row): sha256(json.dumps([reference_epoch,
        {name: value for name, value in row.items() if name not in ('recordingsReference', 'analysisContext')}],
        sort_keys=True).encode()).hexdigest() for row in payload['meetings']}
    base = request.headers.get('If-None-Match', '').strip('"')
    old = next((item for item in previous if item['version'] == base), None)
    result = payload
    if request.headers.get('X-Coaching-Delta') == '1' and old:
        updated = [row for row in payload['meetings'] if old['hashes'].get(meeting_key(row)) != hashes[meeting_key(row)]]
        removed = [row_key for row_key in old['hashes'] if row_key not in hashes]
        if len(updated) <= max(1, len(payload['meetings']) // 2):
            result = {**payload, 'meetings': updated, 'delta': {'baseVersion': base, 'removedMeetingKeys': removed}}
    entry = {'version': payload['sync']['version'], 'hashes': hashes}
    try:
        cache.set(key, [entry] + [item for item in previous if item['version'] != entry['version']][:2], timeout=120)
    except Exception:
        log.warning('Coaching response cache unavailable; durable data retained.')
    return result
