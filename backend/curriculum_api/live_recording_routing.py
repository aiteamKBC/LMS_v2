"""Original live recording routing and source identity; no application startup."""
import os
import uuid

from .bunny_stream import VideoImportError, library_secret, live_library_id

UPLOAD_FLAG = 'BUNNY_LIVE_RECORDING_UPLOADS_ENABLED'


def uploads_enabled():
    return os.environ.get(UPLOAD_FLAG, '').strip().lower() in ('true', '1', 'yes', 'on')


def require_live_credentials():
    library = live_library_id()
    if library == os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153').strip():
        raise VideoImportError('LiveSessions originals must use a separate library from curriculum materials.')
    if not library_secret(library, 'API_KEY'):
        raise VideoImportError('The LiveSessions library API key is not configured; no recording was uploaded.')
    if not library_secret(library, 'TOKEN_KEY'):
        raise VideoImportError('The LiveSessions playback security key is not configured; existing playback is unchanged.')
    return library


def new_recording_library():
    # Readiness can be deployed before the other original uploader is stopped.
    # The switch belongs to the coordinated single-owner cutover, not a module.
    if uploads_enabled():
        return require_live_credentials()
    return os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153').strip()


def tags_of(video):
    tags = video.get('metaTags') or []
    if not isinstance(tags, list):
        raise VideoImportError('The recording source metadata is unreadable; no second copy was created.')
    result = {}
    for item in tags:
        if not isinstance(item, dict) or not isinstance(item.get('property'), str):
            raise VideoImportError('The recording source metadata is unreadable; no second copy was created.')
        key, value = item['property'], str(item.get('value') or '')
        if key in result and result[key] != value:
            raise VideoImportError('The recording has conflicting source identities; review is required.')
        result[key] = value
    return result


def matches_source(video, scope):
    tags = tags_of(video)
    if tags.get('lms.occurrence_id') and tags.get('kbc_lms_occurrence_id') and tags['lms.occurrence_id'] != tags['kbc_lms_occurrence_id']:
        raise VideoImportError('The recording has conflicting session owners; review is required.')
    occurrence = str(scope.get('occurrence_id') or '')
    if not occurrence or (tags.get('lms.occurrence_id') or tags.get('kbc_lms_occurrence_id')) != occurrence:
        return False
    content_hash = str(scope.get('source_content_sha256') or '')
    remote_hash = tags.get('lms.source_content_sha256')
    if content_hash and remote_hash:
        if content_hash == remote_hash:
            return all(tags.get('lms.' + field) == str(scope.get(field) or '')
                       for field in ('series_id', 'module_id'))
        if tags.get('lms.recording_identity') == str(scope.get('recording_identity') or ''):
            raise VideoImportError('The bytes of this recording source changed; a version review is required.')
        return False
    identity = str(scope.get('recording_identity') or '')
    if identity and tags.get('lms.recording_identity') == identity:
        return all(not tags.get('lms.' + field) or tags['lms.' + field] == str(scope.get(field) or '')
                   for field in ('series_id', 'module_id'))
    if all(scope.get(field) and tags.get('lms.' + field) == str(scope[field])
           for field in ('series_id', 'module_id', 'graph_artifact_id')):
        return True
    # Historical peer IDs are usable only after a reviewed source mapping. An
    # occurrence, title, date or part number alone is never sufficient proof.
    peer = str(scope.get('verified_peer_recording_identity') or '')
    return bool(peer and scope.get('verified_peer_graph_artifact_id') == scope.get('graph_artifact_id')
                and tags.get('kbc_recording_identity') == peer)


def select_existing_recording(videos, scope):
    matches, unresolved = [], False
    for video in videos:
        if not isinstance(video, dict):
            raise VideoImportError('The LiveSessions inventory is unreadable.')
        tags = tags_of(video)
        occurrences = {value for value in (tags.get('lms.occurrence_id'), tags.get('kbc_lms_occurrence_id')) if value}
        if str(scope.get('occurrence_id') or '') not in occurrences:
            continue
        if len(occurrences) > 1:
            raise VideoImportError('The recording has conflicting session owners; review is required.')
        try:
            uuid.UUID(str(video.get('guid') or ''))
        except ValueError:
            raise VideoImportError('The existing LiveSessions recording has an invalid identity.') from None
        if matches_source(video, scope):
            matches.append(video)
        elif (scope.get('source_content_sha256') and not tags.get('lms.source_content_sha256')) or (
                not tags.get('lms.recording_identity') and not all(tags.get('lms.' + field)
                  for field in ('series_id', 'module_id', 'graph_artifact_id'))):
            unresolved = True
    if len(matches) > 1:
        raise VideoImportError('More than one LiveSessions video matches this source recording; no duplicate was uploaded.')
    if matches:
        return matches[0]
    if unresolved:
        raise VideoImportError('An existing LiveSessions recording needs source-identity reconciliation; no second copy was uploaded.')
    return None


def recording_inventory(client):
    rows = []
    for page in range(1, 101):
        result = client.request('GET', '/videos', params={'page': page, 'itemsPerPage': 100})
        items = result.get('items')
        if not isinstance(items, list):
            raise VideoImportError('The LiveSessions inventory is unreadable.')
        rows.extend(items)
        if len(items) < 100:
            return rows
    raise VideoImportError('The LiveSessions inventory is incomplete; no second copy was uploaded.')


def find_existing_recording(client, scope):
    return select_existing_recording(recording_inventory(client), scope)
