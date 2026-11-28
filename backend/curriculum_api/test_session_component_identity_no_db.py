"""Session-to-component repair checks using synthetic rows and no database."""

import json
import sys
import types
import unittest
from contextlib import nullcontext
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from curriculum_api import session_component_identity as links


def occurrence(number, day, *, series='SERIES', module='MODULE', url='join-url'):
    return (module, series, 'GMT Standard Time', f'OCC-{number}', number,
            datetime(2026, 10, day, 8, tzinfo=timezone.utc), url, url,
            'meeting-id', 'meeting-id', f'event-{number}', '')


def component(name, day, **settings):
    return (name, {'sessionDate': f'2026-10-{day:02d}',
                   'liveSessionUrl': 'join-url', **settings}, 'join-url')


class SessionComponentIdentityTests(unittest.TestCase):
    def reconcile(self, occurrences, components, *, series='SERIES'):
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.return_value = ('MODULE',)
        cursor.fetchall.side_effect = [occurrences, components]
        cursor.rowcount = 1
        connection = types.SimpleNamespace(cursor=lambda: cursor)
        views = types.ModuleType('curriculum_api.views')
        views.invalidate_curriculum_cache = Mock()
        with patch.object(links, 'connections', {'default': connection}), \
                patch.object(links.transaction, 'atomic', nullcontext), \
                patch.dict(sys.modules, {'curriculum_api.views': views}):
            count = links.reconcile_component_links(series)
        updates = [call for call in cursor.execute.call_args_list
                   if call.args[0].lstrip().startswith('UPDATE curriculum.components')]
        return count, updates, cursor, views

    def test_local_day_uses_meeting_timezone_and_rejects_ambiguous_occurrences(self):
        rows = [occurrence(1, 6), occurrence(2, 13),
                occurrence(9, 13, series='OTHER')]
        mapping = links.occurrence_fallbacks(row[:6] for row in rows)
        self.assertEqual(mapping[('MODULE', '2026-10-06')]['teamsSessionNumber'], 1)
        self.assertNotIn(('MODULE', '2026-10-13'), mapping)

    def test_unique_booked_component_gets_only_its_missing_identity(self):
        count, updates, cursor, views = self.reconcile(
            [occurrence(1, 6), occurrence(2, 13)],
            [component('C1', 6), component('C2', 13, teamsLiveSessionId='SERIES')])
        self.assertEqual(count, 2)
        self.assertEqual([call.args[1][1] for call in updates], ['C1', 'C2'])
        self.assertEqual(json.loads(updates[1].args[1][0]), {
            'teamsLiveSessionId': 'SERIES', 'teamsSessionNumber': 2, 'teamsOccurrenceId': 'OCC-2'})
        self.assertIn('FOR UPDATE OF c', cursor.execute.call_args_list[2].args[0])
        self.assertIn("settings_json=COALESCE(settings_json,'{}'::jsonb) || %s::jsonb", updates[0].args[0])
        views.invalidate_curriculum_cache.assert_called_once_with()

    def test_does_not_guess_between_duplicates_or_conflicting_meetings(self):
        count, updates, _, views = self.reconcile(
            [occurrence(1, 6), occurrence(2, 13), occurrence(3, 20),
             occurrence(4, 21), occurrence(5, 22), occurrence(6, 23),
             occurrence(7, 24), occurrence(8, 25)],
            [component('DUP-1', 6), component('DUP-2', 6),
             component('OTHER-SERIES', 13, teamsLiveSessionId='OTHER'),
             component('ADDITIONAL', 20, teamsMeetingScope='additional'),
             component('OTHER-URL', 21, liveSessionUrl='different'),
             component('OTHER-MEETING', 22, teamsOnlineMeetingId='other-meeting'),
             component('ALREADY-LINKED', 23, teamsLiveSessionId='SERIES',
                       teamsSessionNumber=6, teamsOccurrenceId='OCC-6'),
             component('WRONG-EVENT', 24, teamsEventId='different'),
             component('WRONG-INSTANT', 25, sessionDateTimeUtc='2026-10-25T12:00:00Z')])
        self.assertEqual((count, updates), (0, []))
        views.invalidate_curriculum_cache.assert_not_called()

    def test_does_not_touch_a_different_series_or_unbooked_component(self):
        count, updates, _, _ = self.reconcile(
            [occurrence(1, 6), occurrence(2, 13, series='OTHER')],
            [component('C1', 6), component('C2', 13),
             ('NO-LINK', {'sessionDate': '2026-10-20'}, '')])
        self.assertEqual(count, 1)
        self.assertEqual([call.args[1][1] for call in updates], ['C1'])


if __name__ == '__main__':
    unittest.main()
