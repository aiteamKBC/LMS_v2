"""Direct regression runner: stdlib only; no Django setup, DB or network."""
import os
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).parent
package = types.ModuleType('learner_api')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('learner_api', package)
from learner_api.linked_recordings import (  # noqa: E402
    read_remote_sessions, remote_links, resolve_linked_recordings,
)


def live(component_id='LS', module='M', **extra):
    return {'componentId': component_id, 'type': 'live_session', '_moduleId': module, 'teamsLiveSessionId': 'SERIES-1',
            'teamsSessionNumber': 4, 'sessionDate': '2026-11-03', **extra}


def recording(component_id='REC', link='LS', module='M', link_module='', **extra):
    return {'componentId': component_id, 'type': 'recording_placeholder', '_moduleId': module,
            'linkedLiveSessionComponentId': link, 'linkedLiveSessionModuleId': link_module,
            'recordingSeriesId': None, 'recordingSessionNumber': None, 'recordingDate': None, 'sessionDate': None, **extra}


def ids(weeks):
    return {week: [row['componentId'] for row in rows] for week, rows in weeks.items()}


class LinkedRecordingTests(unittest.TestCase):
    def test_linked_recording_plays_its_sessions_recording_on_its_date(self):
        rows = resolve_linked_recordings({'W1': [live(), recording()]}, merge=False)['W1']
        self.assertEqual(
            (rows[1]['recordingSeriesId'], rows[1]['recordingSessionNumber'], rows[1]['recordingDate'], rows[1]['sessionDate']),
            ('SERIES-1', 4, '2026-11-03', '2026-11-03'),
        )

    def test_a_link_reaches_another_week_of_the_same_module(self):
        weeks = resolve_linked_recordings({'W1': [live()], 'W5': [recording()]}, merge=False)
        self.assertEqual(weeks['W5'][0]['recordingSeriesId'], 'SERIES-1')
        merged = resolve_linked_recordings({'W1': [live()], 'W5': [recording()]}, merge=True)
        self.assertEqual(ids(merged), {'W1': ['LS'], 'W5': []})

    def test_same_ids_in_another_module_are_not_this_modules_session(self):
        weeks = {'W1': [live(module='OTHER')], 'W2': [recording(module='M')]}
        self.assertIsNone(resolve_linked_recordings(weeks, merge=False)['W2'][0]['recordingSeriesId'])

    def test_another_groups_session_is_played_and_never_merged_away(self):
        rec = recording(link='LS-B', link_module='MOD-B')
        self.assertEqual(remote_links({'W1': [rec]}), ['LS-B'])
        remote = {('MOD-B', 'LS-B'): {'teamsLiveSessionId': 'SERIES-B', 'teamsSessionNumber': 2, 'sessionDate': '2026-12-01'}}
        for merge in (False, True):
            row = resolve_linked_recordings({'W1': [rec]}, remote, merge=merge)['W1'][0]
            self.assertEqual((row['recordingSeriesId'], row['recordingSessionNumber'], row['recordingDate']),
                             ('SERIES-B', 2, '2026-12-01'))

    def test_a_link_naming_this_module_explicitly_is_local(self):
        rec = recording(link_module='M')
        self.assertEqual(remote_links({'W1': [live(), rec]}), [])
        self.assertEqual(ids(resolve_linked_recordings({'W1': [live(), rec]}, merge=True)), {'W1': ['LS']})

    def test_unlinked_and_broken_links_are_untouched(self):
        unlinked = recording('U', link='')
        broken = recording('S', link='GONE')
        reading = {'componentId': 'R', 'type': 'reading', '_moduleId': 'M'}
        pointing_at_reading = recording('P', link='R')
        for merge in (False, True):
            rows = resolve_linked_recordings({'W1': [reading, unlinked, broken, pointing_at_reading]}, merge=merge)['W1']
            self.assertEqual(rows, [reading, unlinked, broken, pointing_at_reading])

    def test_session_without_occurrence_gives_no_recording_source(self):
        rows = resolve_linked_recordings({'W1': [live(teamsSessionNumber=None), recording()]}, merge=False)['W1']
        self.assertIsNone(rows[1]['recordingSeriesId'])
        self.assertEqual(rows[1]['sessionDate'], '2026-11-03')

    def test_remote_sessions_are_read_by_id(self):
        cursor = mock.Mock()
        cursor.fetchall.return_value = [('MOD-B', 'LS-B', 'SERIES-B', '3', '2026-12-01'), ('MOD-B', 'LS-C', 'SERIES-B', '', '')]
        found = read_remote_sessions(cursor, ['LS-B', 'LS-C'])
        self.assertEqual(cursor.execute.call_args.args[1], [['LS-B', 'LS-C']])
        self.assertEqual(found[('MOD-B', 'LS-B')]['teamsSessionNumber'], 3)
        self.assertIsNone(found[('MOD-B', 'LS-C')]['teamsSessionNumber'])
        self.assertEqual(read_remote_sessions(cursor, []), {})

    def test_merge_is_off_unless_the_flag_says_true(self):
        weeks = {'W1': [live(), recording()]}
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('LEARNER_MERGE_LINKED_RECORDINGS', None)
            self.assertEqual(len(resolve_linked_recordings(weeks)['W1']), 2)
        with mock.patch.dict(os.environ, {'LEARNER_MERGE_LINKED_RECORDINGS': 'true'}):
            self.assertEqual(len(resolve_linked_recordings(weeks)['W1']), 1)


if __name__ == '__main__':
    unittest.main()
