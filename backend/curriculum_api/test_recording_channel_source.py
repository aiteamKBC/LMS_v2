"""Exact channel ownership and real common verifier; no Microsoft/Bunny I/O."""
from copy import deepcopy
import unittest
from unittest.mock import Mock, patch

from . import recording_channel_source as channel

BASE = 'https://graph.microsoft.com/v1.0'
SOURCE = BASE + '/users/owner/onlineMeetings/meeting/recordings/recording/content'
THREAD = '19:channel@thread.tacv2'


class ChannelRecordingTests(unittest.TestCase):
    def setUp(self):
        self.item = {'id': 'file', 'name': 'recording.mp4', 'size': 200000,
                     'createdDateTime': '2026-11-27T08:55:31Z', 'file': {}}
        self.detail = {**self.item, 'parentReference': {'driveId': 'channel-drive'}, 'cTag': 'version-1',
                       '@microsoft.graph.downloadUrl': 'https://tenant.sharepoint.com/private?secret=opaque'}
        self.roots = [{'id': 'recordings', 'name': 'Recordings', 'folder': {}}]
        self.thread = THREAD
        self.provider = Mock(side_effect=self.get)
        self.index = Mock(return_value=[('other-team', '19:other@thread.tacv2'), ('correct-team', THREAD)])
        edges = patch('curriculum_api.session_cloud_archive._edges', return_value=(200000, b'first', b'last'))
        self.edges = edges.start(); self.addCleanup(edges.stop)

    def get(self, method, path):
        self.assertEqual(method, 'GET')
        if path == 'users/owner/onlineMeetings/meeting?$select=chatInfo':
            return {'chatInfo': {'threadId': self.thread}}
        if path == 'teams/correct-team/channels/19%3Achannel%40thread.tacv2/filesFolder':
            return {'id': 'channel-folder', 'parentReference': {'driveId': 'channel-drive'}}
        if path.startswith('drives/channel-drive/items/channel-folder/children?'):
            return {'value': deepcopy(self.roots)}
        if path.startswith('drives/channel-drive/items/recordings/children?'):
            return {'value': [deepcopy(self.item)]}
        if path == 'drives/channel-drive/items/file':
            return deepcopy(self.detail)
        raise AssertionError('Unexpected Graph path')

    def resolve(self, source=SOURCE):
        return channel.matched_channel_recording({'created_datetime': '2026-11-27T08:55:31Z'},
            'owner', source, 'synthetic-token', graph_get=self.provider, graph_base=BASE, cached_index=self.index)

    def test_channel_file_is_verified_against_graph_bytes_and_rechecked_version(self):
        url, identity = self.resolve()
        self.assertEqual(url, self.detail['@microsoft.graph.downloadUrl'])
        self.assertEqual(identity, {'drive': 'channel-drive', 'item': 'file', 'version': 'version-1', 'size': 200000})
        self.assertEqual(self.edges.call_count, 2)
        self.assertEqual(self.edges.call_args_list[0].kwargs, {'token': 'synthetic-token'})
        self.assertEqual(self.edges.call_args_list[1].kwargs, {})
        self.assertEqual(sum(call.args[1] == 'drives/channel-drive/items/file' for call in self.provider.call_args_list), 2)

    def test_other_channel_and_ambiguous_team_are_not_selected(self):
        for index in ([('other-team', 'other-channel')], [('team-a', THREAD), ('team-b', THREAD)]):
            with self.subTest(index=index):
                self.index.return_value = index
                self.assertFalse(self.resolve())
        self.edges.assert_not_called()

    def test_ordinary_meeting_does_not_scan_teams(self):
        self.thread = '19:meeting@thread.v2'
        self.assertFalse(self.resolve())
        self.index.assert_not_called(); self.edges.assert_not_called()

    def test_untrusted_recording_url_never_looks_up_a_channel(self):
        for source in (SOURCE.replace('graph.microsoft.com', 'example.invalid'), SOURCE + '?override=1', SOURCE + '#fragment'):
            self.assertFalse(self.resolve(source))
        self.provider.assert_not_called(); self.index.assert_not_called()

    def test_changed_file_drive_or_version_cannot_supply_a_source(self):
        self.detail['parentReference']['driveId'] = 'other-drive'
        with self.assertRaisesRegex(ValueError, 'verified channel drive'):
            self.resolve()
        self.detail['parentReference']['driveId'] = 'channel-drive'
        original = self.get
        reads = 0
        def get(method, path):
            nonlocal reads
            value = original(method, path)
            if path == 'drives/channel-drive/items/file':
                reads += 1
                if reads == 2: value['cTag'] = 'changed-version'
            return value
        self.provider.side_effect = get
        with self.assertRaisesRegex(ValueError, 'changed during source verification'):
            self.resolve()

    def test_wrong_bytes_and_same_size_ambiguity_never_supply_a_source(self):
        self.edges.side_effect = [(200000, b'first', b'last'), (200000, b'wrong', b'last')]
        self.assertFalse(self.resolve())
        self.edges.reset_mock(); self.edges.side_effect = None
        self.roots = [self.item, {**self.item, 'id': 'another-file'}]
        self.assertFalse(self.resolve())
        self.assertEqual(self.edges.call_count, 1)

    def test_channel_index_includes_all_membership_and_channel_pages(self):
        responses = [{'value': [{'id': 'team-a'}], '@odata.nextLink': BASE + '/next-teams'},
                     {'value': [{'id': 'team-b'}]},
                     {'value': [{'id': 'channel-a'}], '@odata.nextLink': BASE + '/next-channels'},
                     {'value': [{'id': 'channel-b'}]}, {'value': [{'id': 'channel-c'}]}]
        provider = Mock(side_effect=responses)
        self.assertEqual(channel.channel_index('owner', graph_get=provider, graph_base=BASE),
                         [('team-a', 'channel-a'), ('team-a', 'channel-b'), ('team-b', 'channel-c')])
        self.assertEqual(provider.call_count, 5)

    def test_incomplete_membership_scan_raises_instead_of_claiming_a_unique_channel(self):
        provider = Mock(side_effect=[{'value': [{'id': 'team'}]}, {'error': 'denied'}])
        with self.assertRaisesRegex(RuntimeError, 'incomplete collection'):
            channel.channel_index('owner', graph_get=provider, graph_base=BASE)
