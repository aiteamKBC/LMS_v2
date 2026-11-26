"""Opt-in, bounded imports of presenter files from the tracked meeting chat.

Files.ReadWrite.All and Chat.Read.All (or meeting-specific RSC) need existing
administrator consent. This worker never grants permissions or changes meetings.
"""
import base64
import hashlib
import json
import tempfile
from datetime import timedelta
from urllib.parse import quote

import requests

from .session_attachment_policy import AttachmentError, MAX_FILE_BYTES, instant, message_files, sharepoint_url, import_enabled, settings_payload
from .session_graph import graph_path


def bounded_messages(graph_get, thread_id, since, graph_base):
    path = (f'chats/{quote(thread_id, safe="")}/messages?$top=50&$orderby=lastModifiedDateTime desc'
            f'&$filter=lastModifiedDateTime gt {since.isoformat().replace("+00:00", "Z")}')
    output, seen = [], set()
    for _ in range(10):
        path = graph_path(path, graph_base)
        if path in seen:
            raise AttachmentError('Microsoft repeated a chat page. Attachment import needs retry.')
        seen.add(path)
        page = graph_get('GET', path)
        if not isinstance(page.get('value'), list):
            raise AttachmentError('Microsoft returned incomplete session attachments.')
        output.extend(page['value'])
        path = page.get('@odata.nextLink')
        if not path:
            return output
    raise AttachmentError('This meeting chat needs a scoped attachment review; no partial page was imported.')


def staff_addresses(series):
    result = {str(series.get('organizer_email') or '').strip()}
    for field in ('presenters', 'co_organizers'):
        values = series.get(field) or []
        if isinstance(values, str):
            try:
                values = json.loads(values)
            except ValueError:
                values = values.split(',')
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, dict):
                value = value.get('email') or value.get('emailAddress') or value.get('upn')
            if isinstance(value, str) and value.strip():
                result.add(value.strip())
    return sorted(result - {''})


def download_file(url, size):
    """A fresh preauthenticated Microsoft URL, no Graph bearer forwarded to storage."""
    if not sharepoint_url(url) or type(size) is not int or not 0 < size <= MAX_FILE_BYTES:
        raise AttachmentError('Microsoft returned an unsupported session file.')
    stream = tempfile.TemporaryFile()
    try:
        # Do not follow redirects or emit source URLs in logs/exceptions.
        with requests.get(url, stream=True, allow_redirects=False, timeout=(10, 60)) as response:
            if response.status_code != 200:
                raise AttachmentError('Microsoft could not download the session file.')
            received = 0
            for chunk in response.iter_content(64 * 1024):
                received += len(chunk)
                if received > size:
                    raise AttachmentError('Microsoft returned a different session file size.')
                stream.write(chunk)
            if received != size:
                raise AttachmentError('The session attachment download was incomplete.')
        stream.seek(0)
        return stream
    except Exception:
        stream.close()
        raise AttachmentError('Microsoft could not download a verified session attachment.') from None


def sync_series_attachments(series_id):
    if not import_enabled():
        return []
    if settings_payload()['storageProvider'] == 'unavailable':
        return ['Session attachment storage needs configuration.']
    from .session_attachments import save_file
    from django.utils import timezone
    from coach_api.views import get_graph_settings, microsoft_graph_request, microsoft_graph_token
    from .session_results import read
    from .views import live_session_meeting_groups
    series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])
    if not series:
        return []
    occurrences = read('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s', [series_id])
    now = timezone.now()
    recent = [o for o in occurrences if instant(o.get('scheduled_start'))
              and now - timedelta(days=14) <= instant(o['scheduled_start']) <= now + timedelta(hours=2)]
    if not recent:
        return []
    try:
        token = microsoft_graph_token()
        encoded = token.split('.')[1]
        roles = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4))).get('roles', [])
        if not set(roles) & {'Chat.Read.All', 'Chat.ReadWrite.All', 'ChatMessage.Read.Chat'}:
            raise AttachmentError('Automatic session attachments need Microsoft chat-read consent. Manual uploads remain available.')
        get = microsoft_graph_request
        presenters = set()
        addresses = staff_addresses(series[0])
        if len(addresses) > 50:
            raise AttachmentError('The session presenter list needs review before importing files.')
        for address in addresses:
            user = get('GET', f'users/{quote(address, safe="")}?$select=id')
            if user.get('id'):
                presenters.add(user['id'])
        errors, imported = [], 0
        for base, group in live_session_meeting_groups(series[0], recent):
            meeting = get('GET', base + '?$select=chatInfo')
            thread = (meeting.get('chatInfo') or {}).get('threadId')
            if not thread:
                continue
            since = min(instant(o['scheduled_start']) for o in group) - timedelta(hours=2)
            messages = bounded_messages(get, thread, since, get_graph_settings()['base_url'])
            candidates = message_files(messages, occurrences, presenters)
            group_ids = {o['id'] for o in group}
            for candidate in candidates:
                occurrence = candidate['occurrence']
                if occurrence['id'] not in group_ids:
                    continue
                reference = hashlib.sha256(json.dumps([thread, candidate['message_id'], candidate['attachment_id'],
                    next((m.get('lastModifiedDateTime') for m in messages if m.get('id') == candidate['message_id']), None)]).encode()).hexdigest()
                done = read('''SELECT a.id FROM curriculum.live_session_artifacts a
                    JOIN curriculum.session_result_archive r ON r.artifact_id=a.id AND r.occurrence_id=a.occurrence_id
                    WHERE a.occurrence_id=%s AND a.artifact_type='attachment' AND r.status='ready'
                    AND a.metadata #> '{lmsSessionAttachment,sourceReferences}' @> %s::jsonb''',
                    [occurrence['id'], json.dumps([reference])])
                if done:
                    continue
                if imported >= 20:
                    errors.append('More session attachments are waiting for the next worker run.')
                    return errors
                shared = 'u!' + base64.urlsafe_b64encode(candidate['url'].encode()).decode().rstrip('=')
                item = get('GET', f'shares/{shared}/driveItem')
                if not isinstance(item.get('file'), dict):
                    raise AttachmentError('A session reference is not a file.')
                # Only a newly resolved, short-lived URL is used, never persisted.
                with download_file(item.get('@microsoft.graph.downloadUrl'), item.get('size')) as stream:
                    save_file(occurrence, stream, candidate['name'], source_reference=reference)
                imported += 1
        return errors
    except AttachmentError as error:
        return [str(error)]
    except Exception:
        return ['Session attachment import needs retry. Check Microsoft file and chat permissions.']
