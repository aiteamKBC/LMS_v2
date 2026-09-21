"""Background-only import of Teams files into a private Azure container."""
import json
import logging
import os
import tempfile
from urllib.parse import quote

import httpx
from azure.core.exceptions import ResourceExistsError
from django.db import connections

from .session_results import read, result_rows
from .session_results_policy import archive_prefix, attendance_csv, transcript_text
from .session_media_policy import transcript_timing_ready
from .session_transcripts import parse_vtt_cues
from .session_transfer_progress import TransferProgress, byte_count

log = logging.getLogger(__name__)
CONTAINER = os.environ.get('AZURE_SESSION_RECORDINGS_CONTAINER', 'session-recordings')


def storage_client():
    from learner_api.evidence_storage import _service_client
    return _service_client()


def save_transcript_timing(artifact_id, raw):
    timeline = {'version': 1, 'cues': parse_vtt_cues(raw.decode('utf-8-sig', errors='replace'))}
    with connections['default'].cursor() as cursor:
        cursor.execute('''UPDATE curriculum.live_session_artifacts
            SET metadata=jsonb_set(coalesce(metadata::jsonb,'{}'::jsonb),'{lmsTranscriptTimeline}',%s::jsonb)
            WHERE id=%s AND artifact_type='transcript' ''', [json.dumps(timeline, ensure_ascii=False), artifact_id])


def provision_container():
    """Explicit operator setup only; never invoked by a read or sync request."""
    try:
        storage_client().create_container(CONTAINER)  # private: no public_access
    except ResourceExistsError:
        pass


def save_archive(artifact, name, *, text=None, state='ready', error=''):
    with connections['default'].cursor() as cursor:
        cursor.execute('''INSERT INTO curriculum.session_result_archive
            (artifact_id,occurrence_id,container,blob_name,status,transcript_text,last_error)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(artifact_id) DO UPDATE SET status=EXCLUDED.status,
              transcript_text=coalesce(EXCLUDED.transcript_text,session_result_archive.transcript_text),
              last_error=EXCLUDED.last_error,updated_at=now()''',
            [artifact['id'], artifact['occurrence_id'], CONTAINER, name, state, text, error])


def archive_series(series_id, *, lease_id=None):
    from coach_api.views import get_graph_settings, microsoft_graph_token
    from learner_api.evidence_storage import upload_blob
    from .views import teams_online_meeting_owner_id
    series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])[0]
    modules = read('SELECT group_id,group_name FROM curriculum.modules WHERE module_catalogue_id=%s', [series['module_catalogue_id']])
    occurrences = read('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s', [series_id])
    by_id = {row['id']: row for row in occurrences}
    artifacts = read('''SELECT a.*,r.status AS saved_status,r.blob_name AS saved_name FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id WHERE o.live_session_id=%s''', [series_id])
    errors = []
    client = storage_client()
    token = None
    for artifact in artifacts:
        if artifact['saved_status'] == 'ready':
            # Backfill timing for previously archived transcripts from Azure once.
            # Ready videos are never downloaded or uploaded again.
            if artifact['artifact_type'] == 'transcript' and not transcript_timing_ready(artifact):
                try:
                    raw = client.get_blob_client(CONTAINER, artifact['saved_name']).download_blob(offset=0, length=16 * 1024 * 1024 + 1).readall()
                    if len(raw) > 16 * 1024 * 1024:
                        raise ValueError('Transcript exceeds the supported size.')
                    save_transcript_timing(artifact['id'], raw)
                except Exception as failure:
                    log.warning('Transcript timing %s failed: %s', artifact['id'], type(failure).__name__)
                    errors.append(f"Could not prepare transcript timing for {artifact['id']}. Check worker logs.")
            continue
        occurrence = by_id[artifact['occurrence_id']]
        kind = artifact['artifact_type']
        if kind not in {'recording', 'transcript'}:
            continue
        prefix = archive_prefix(series, occurrence, modules[0] if modules else {})
        name = artifact['saved_name'] or f"{prefix}/{kind}-{artifact['id']}.{'mp4' if kind == 'recording' else 'vtt'}"
        save_archive(artifact, name, state='pending')
        progress = TransferProgress(series_id, artifact['id'], lease_id)
        progress.update('preparing')
        try:
            blob = client.get_blob_client(CONTAINER, name)
            text = None
            if not blob.exists():
                meeting_id = occurrence.get('online_meeting_id') or series['online_meeting_id']
                owner = teams_online_meeting_owner_id(series['organizer_email'], occurrence.get('join_url') or series['join_url'])
                if not meeting_id or not owner:
                    raise ValueError('The stored meeting identity is incomplete.')
                base = get_graph_settings()['base_url'].rstrip('/')
                path = f"users/{quote(owner, safe='')}/onlineMeetings/{quote(meeting_id, safe='')}/{kind}s/{quote(artifact['graph_artifact_id'], safe='')}/content"
                token = token or microsoft_graph_token()
                headers = {'Authorization': f'Bearer {token}'}
                if kind == 'transcript':
                    headers['Accept'] = 'text/vtt'
                # Disk-backed, bounded memory. No video buffers or transfer in a web request.
                with tempfile.TemporaryFile() as stream, httpx.Client(follow_redirects=True, timeout=120) as transport:
                    progress.update('downloading')
                    with transport.stream('GET', f'{base}/{path}', headers=headers) as response:
                        response.raise_for_status()
                        total = None if response.headers.get('Content-Encoding') not in (None, '', 'identity') else byte_count(response.headers.get('Content-Length')) or None
                        downloaded = 0
                        progress.update('downloading', 0, total, force=True)
                        for chunk in response.iter_bytes(1024 * 1024):
                            stream.write(chunk)
                            downloaded += len(chunk)
                            progress.update('downloading', downloaded, total)
                    progress.update('downloading', downloaded, total, force=True)
                    stream.seek(0)
                    if kind == 'transcript':
                        raw = stream.read(16 * 1024 * 1024 + 1)
                        if len(raw) > 16 * 1024 * 1024:
                            raise ValueError('Transcript exceeds the supported size.')
                        text = transcript_text(raw.decode('utf-8-sig', errors='replace'))
                        stream.seek(0)
                    try:
                        progress.update('uploading', 0, downloaded)
                        upload_blob(stream, CONTAINER, name, 'video/mp4' if kind == 'recording' else 'text/vtt', overwrite=False,
                                    upload_block_bytes=4 * 1024 * 1024, max_concurrency=2,
                                    progress_hook=progress.uploaded)
                    except ResourceExistsError:
                        pass  # a previous completed upload can outlive its worker lease
            progress.update('finalizing')
            if kind == 'transcript':
                if text is None:
                    raw = blob.download_blob(offset=0, length=16 * 1024 * 1024 + 1).readall()
                    if len(raw) > 16 * 1024 * 1024:
                        raise ValueError('Transcript exceeds the supported size.')
                    text = transcript_text(raw.decode('utf-8-sig', errors='replace'))
                client.get_blob_client(CONTAINER, name.rsplit('.', 1)[0] + '.txt').upload_blob(text.encode('utf-8'), overwrite=True)
                save_transcript_timing(artifact['id'], raw)
            save_archive(artifact, name, text=text)
        except Exception as failure:
            log.warning('Session artifact %s archive failed: %s', artifact['id'], type(failure).__name__)
            # Never persist a token-bearing URL or response body in user-visible errors.
            error = f"Could not archive {kind} {artifact['id']}. Check worker logs and storage access."
            save_archive(artifact, name, state='failed', error=error)
            errors.append(error)
    for session in result_rows(series):
        if not session['reportReady']:
            continue
        occurrence = by_id[session['id']]
        prefix = archive_prefix(series, occurrence, modules[0] if modules else {})
        try:
            client.get_blob_client(CONTAINER, prefix + '/attendance.csv').upload_blob(attendance_csv(session['attendance']).encode('utf-8'), overwrite=True)
            raw = read('SELECT raw_data FROM curriculum.live_session_attendance WHERE occurrence_id=%s', [session['id']])
            client.get_blob_client(CONTAINER, prefix + '/teams-attendance-original.json').upload_blob(json.dumps(raw, default=str).encode('utf-8'), overwrite=True)
        except Exception:
            errors.append(f"Could not archive attendance for session {session['sessionNumber']}.")
    return errors
