from copy import deepcopy
from unittest.mock import patch
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase
from coach_api.recordings_response_cache import delta_payload, meeting_key


class ResponseDeltaTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()
        self.payload = {'scope': 'all', 'sync': {'directoryHash': 'roster', 'version': 'a'*64},
            'meetings': [{'coachEmail': 'coach@example.invalid', 'calendarEventId': str(index), 'startsAt': '2026-10-20T09:00:00Z',
                'endsAt': '2026-10-20T10:00:00Z', 'readyToAction': False, 'recordingsReference': 'old-token'} for index in range(3)]}

    def seed(self):
        return delta_payload(self.factory.get('/'), self.payload, ['staff-one', 'query'], 1)

    def request(self):
        return self.factory.get('/', HTTP_IF_NONE_MATCH='"'+'a'*64+'"', HTTP_X_COACHING_DELTA='1')

    def test_one_ready_recording_only_transfers_the_changed_meeting(self):
        self.seed()
        updated = deepcopy(self.payload)
        updated['sync']['version'] = 'b'*64
        updated['meetings'][1]['readyToAction'] = True
        updated['meetings'][0]['recordingsReference'] = 'renewed-token'
        result = delta_payload(self.request(), updated, ['staff-one', 'query'], 1)
        self.assertEqual([row['calendarEventId'] for row in result['meetings']], ['1'])
        self.assertEqual(result['delta'], {'baseVersion': 'a'*64, 'removedMeetingKeys': []})

    def test_removed_meetings_are_explicit_and_other_rows_are_not_downloaded(self):
        self.seed()
        updated = deepcopy(self.payload)
        updated['sync']['version'] = 'b'*64
        removed = updated['meetings'].pop()
        result = delta_payload(self.request(), updated, ['staff-one', 'query'], 1)
        self.assertEqual(result['meetings'], [])
        self.assertEqual(result['delta']['removedMeetingKeys'], [meeting_key(removed)])

    def test_another_user_roster_or_evicted_cursor_always_gets_a_full_response(self):
        self.seed()
        self.assertNotIn('delta', delta_payload(self.request(), self.payload, ['staff-two', 'query'], 1))
        changed = {**self.payload, 'sync': {**self.payload['sync'], 'directoryHash': 'changed-roster'}}
        self.assertNotIn('delta', delta_payload(self.request(), changed, ['staff-one', 'query'], 1))
        cache.clear()
        self.assertNotIn('delta', delta_payload(self.request(), self.payload, ['staff-one', 'query'], 1))

    def test_reference_renewal_sends_fresh_tokens_instead_of_retaining_expired_ones(self):
        self.seed()
        result = delta_payload(self.request(), self.payload, ['staff-one', 'query'], 2)
        self.assertNotIn('delta', result)
        self.assertEqual(len(result['meetings']), 3)

    def test_cache_failure_does_not_hide_the_current_full_snapshot(self):
        with patch.object(cache, 'get', side_effect=RuntimeError()), patch.object(cache, 'set', side_effect=RuntimeError()):
            self.assertEqual(self.seed(), self.payload)
