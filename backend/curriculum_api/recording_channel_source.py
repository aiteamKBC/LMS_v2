"""Find a channel recording in that exact channel's SharePoint files folder.

Channel meetings do not store recordings in the organiser's OneDrive. The
provider's meeting thread, joined-team membership and filesFolder identify the
folder. The usual size, edge-byte and immutable-version checks still decide
whether any MP4 is safe to hand to Bunny.
"""
import re
from urllib.parse import quote, unquote, urlsplit

from .session_graph import collection
from .session_cloud_archive import matched_recording_download


def channel_index(owner, *, graph_get, graph_base):
    teams = collection(graph_get, f'users/{quote(owner, safe="")}/joinedTeams?$select=id', graph_base)
    output = []
    for team in teams:
        if not team.get('id'):
            raise ValueError('Microsoft returned an incomplete team identity.')
        channels = collection(graph_get, f'teams/{quote(team["id"], safe="")}/channels?$select=id', graph_base)
        output.extend((team['id'], channel['id']) for channel in channels if channel.get('id'))
    return output


def matched_channel_recording(artifact, organizer, source, token, *, graph_get, graph_base, cached_index):
    parsed = urlsplit(source)
    path = re.fullmatch(r'/v1\.0/(users/([^/]+)/onlineMeetings/[^/]+)/recordings/[^/]+/content', parsed.path)
    if (parsed.scheme != 'https' or parsed.netloc != 'graph.microsoft.com'
            or parsed.query or parsed.fragment or not path):
        return False
    owner = unquote(path[2])
    meeting = graph_get('GET', path[1] + '?$select=chatInfo')
    thread = (meeting.get('chatInfo') or {}).get('threadId') or ''
    if not thread.endswith('@thread.tacv2'):
        return False
    matches = {team for team, channel in cached_index(owner) if channel == thread}
    if len(matches) != 1:
        return False
    team = next(iter(matches))
    folder = graph_get('GET', f'teams/{quote(team, safe="")}/channels/{quote(thread, safe="")}/filesFolder')
    drive = (folder.get('parentReference') or {}).get('driveId')
    if not folder.get('id') or not drive:
        raise ValueError('The channel files folder identity is incomplete.')

    def children(identifier):
        return collection(graph_get, f'drives/{quote(drive, safe="")}/items/{quote(identifier, safe="")}/children?'
                          '$select=id,name,size,createdDateTime,file,folder&$top=200', graph_base)

    roots = children(folder['id'])
    items = [item for item in roots if isinstance(item.get('file'), dict)]
    for item in roots:
        if isinstance(item.get('folder'), dict) and str(item.get('name') or '').casefold() == 'recordings':
            items.extend(children(item['id']))
    # Adapt only the verified folder's item IDs to the common verifier. It still
    # re-reads each selected DriveItem and checks the version after byte probes.
    identities = {item['id'] for item in items if item.get('id')}
    prefix = f'users/{quote(organizer, safe="")}/drive/'

    def channel_get(method, requested):
        if requested.startswith(prefix + 'root:/Recordings:/children?'):
            return {'value': items}
        item_prefix = prefix + 'items/'
        if requested.startswith(item_prefix):
            item_id = unquote(requested[len(item_prefix):])
            if item_id not in identities:
                raise ValueError('The recording item is outside its verified channel.')
            detail = graph_get(method, f'drives/{quote(drive, safe="")}/items/{quote(item_id, safe="")}')
            if (detail.get('parentReference') or {}).get('driveId') != drive:
                raise ValueError('The recording moved outside its verified channel drive.')
            return detail
        raise ValueError('Unexpected channel recording lookup.')

    return matched_recording_download(artifact, organizer, source, token, graph_get=channel_get,
                                      graph_base=graph_base, include_identity=True)
