"""Lightweight Azure check for recordings already marked ready.

The normal Teams sync discovers new media. This reviewer only finds saved
recordings whose private copy disappeared and puts their series back in the
same leased queue; it never transfers a video itself.
"""

import logging
from datetime import datetime, timedelta, timezone

from azure.core.exceptions import ResourceNotFoundError
from django.db import connections, transaction

from .session_archive import storage_client


log = logging.getLogger(__name__)
REVIEW_SECONDS = 5 * 60
REVIEW_BUCKETS = 12  # One small slice each pass; every old recording hourly.


def queue_missing_recording(artifact_id, series_id, container, blob_name):
    """Mark a confirmed missing copy for repair unless another worker owns it."""
    with transaction.atomic(), connections['default'].cursor() as cursor:
        cursor.execute('''INSERT INTO curriculum.session_result_jobs(live_session_id)
            VALUES (%s) ON CONFLICT(live_session_id) DO NOTHING''', [series_id])
        cursor.execute('''SELECT r.status,r.container,r.blob_name,j.state
            FROM curriculum.session_result_archive r
            JOIN curriculum.live_session_artifacts a ON a.id=r.artifact_id
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            JOIN curriculum.session_result_jobs j ON j.live_session_id=o.live_session_id
            WHERE r.artifact_id=%s AND o.live_session_id=%s
            FOR UPDATE OF r,j SKIP LOCKED''', [artifact_id, series_id])
        row = cursor.fetchone()
        if (not row or row[0] != 'ready' or row[1] != container
                or row[2] != blob_name or row[3] == 'running'):
            return False
        cursor.execute('''UPDATE curriculum.session_result_archive
            SET status='failed',last_error='Saved recording is missing or empty in Azure; retry queued.',updated_at=now()
            WHERE artifact_id=%s''', [artifact_id])
        cursor.execute('''UPDATE curriculum.session_result_jobs
            SET state='queued',requested_at=now(),next_attempt_at=now(),attempts=0
            WHERE live_session_id=%s''', [series_id])
    return True


def review_ready_recordings(*, now=None, full=False):
    """HEAD a bounded time slice; transient Azure errors leave ready rows intact."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Review time must include a timezone.')
    now = now.astimezone(timezone.utc)
    bucket = int(now.timestamp() // REVIEW_SECONDS) % REVIEW_BUCKETS
    with connections['default'].cursor() as cursor:
        cursor.execute('''SELECT a.id,o.live_session_id,r.container,r.blob_name
            FROM curriculum.session_result_archive r
            JOIN curriculum.live_session_artifacts a ON a.id=r.artifact_id
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            WHERE r.status='ready' AND a.artifact_type='recording'
              AND (%s OR r.updated_at >= %s
                   OR mod(hashtext(a.id)::bigint + 2147483648, %s)=%s)
            ORDER BY a.id''', [full, now - timedelta(hours=6), REVIEW_BUCKETS, bucket])
        rows = cursor.fetchall()
    checked = repaired = errors = 0
    client = storage_client() if rows else None
    for artifact_id, series_id, container, blob_name in rows:
        checked += 1
        try:
            if not container or not blob_name:
                missing = True
            else:
                blob = client.get_blob_client(container, blob_name)
                try:
                    properties = blob.get_blob_properties(logging_enable=False)
                    # The archiver will choose another path and keep the old
                    # empty blob for investigation; it never overwrites media.
                    missing = properties.size == 0
                except ResourceNotFoundError:
                    missing = True
            if missing and queue_missing_recording(artifact_id, series_id, container, blob_name):
                repaired += 1
        except Exception as failure:
            errors += 1
            log.warning('Session recording review failed for %s (%s).', artifact_id, type(failure).__name__)
    return {'checked': checked, 'queued': repaired, 'errors': errors}
