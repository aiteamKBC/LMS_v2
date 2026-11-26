"""An additional week meeting keeps one session row, so its results can be synced."""
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import teams_week_meeting as week


class FakeViews(SimpleNamespace):
    def __init__(self, rows=None):
        super().__init__(LIVE_SESSION_OCCURRENCES_TABLE='live_session_occurrences', rows=list(rows or []),
                         updates=[], inserts=[])

    def clean_str(self, value):
        return str(value or '').strip()

    def parse_graph_datetime(self, value):
        return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None

    def authoring_fetch_all(self, table, where_sql='', params=None, order_sql='', **_):
        return [row for row in self.rows if row['live_session_id'] == params[0]]

    def update_authoring_rows(self, table, where_sql, params, payload):
        self.updates.append((params, payload))

    def authoring_upsert(self, table, keys, payload):
        self.inserts.append(payload)


START = datetime(2026, 9, 30, 9, 0)


class SaveWeekMeetingOccurrenceTests(SimpleTestCase):
    def test_creates_session_one_for_a_new_meeting(self):
        v = FakeViews()
        week.save_week_meeting_occurrence(v, 'LIVE-X', start=START, duration=90, join_url='https://j', event_id='E1')
        row = v.inserts[0]
        self.assertEqual((row['live_session_id'], row['session_number'], row['status']), ('LIVE-X', 1, 'scheduled'))
        self.assertEqual((row['scheduled_end'] - row['scheduled_start']).total_seconds(), 90 * 60)
        self.assertEqual(row['graph_event_id'], 'E1')

    def test_edit_moves_the_same_row_and_keeps_a_completed_session_completed(self):
        v = FakeViews([{'id': 'OCC-1', 'live_session_id': 'LIVE-X', 'session_number': 1, 'status': 'completed'}])
        week.save_week_meeting_occurrence(v, 'LIVE-X', start=START, duration=60, join_url='https://j', event_id='E1')
        self.assertEqual(v.inserts, [])
        params, payload = v.updates[0]
        self.assertEqual(params, ['OCC-1'])
        self.assertEqual(payload['status'], 'completed')
        self.assertEqual(payload['scheduled_start'], START)


class EnsureWeekMeetingOccurrenceTests(SimpleTestCase):
    def ensure(self, series, rows=()):
        v = FakeViews(rows)
        with mock.patch.multiple('curriculum_api.views', clean_str=v.clean_str,
                                 parse_graph_datetime=v.parse_graph_datetime,
                                 authoring_fetch_all=v.authoring_fetch_all,
                                 update_authoring_rows=v.update_authoring_rows,
                                 authoring_upsert=v.authoring_upsert, create=True):
            week.ensure_week_meeting_occurrence(series)
        return v

    def test_backfills_an_additional_meeting_without_a_session(self):
        v = self.ensure({'id': 'LIVE-X', 'status': 'week-meeting', 'start_datetime': START,
                         'duration_minutes': 60, 'join_url': 'https://j', 'graph_event_id': 'E1'})
        self.assertEqual(len(v.inserts), 1)
        self.assertEqual(v.inserts[0]['scheduled_start'], START)

    def test_never_touches_a_module_calendar_series(self):
        v = self.ensure({'id': 'LIVE-M', 'status': 'active', 'start_datetime': START})
        self.assertEqual((v.inserts, v.updates), ([], []))

    def test_leaves_an_existing_session_alone(self):
        v = self.ensure({'id': 'LIVE-X', 'status': 'week-meeting', 'start_datetime': START},
                        rows=[{'id': 'OCC-1', 'live_session_id': 'LIVE-X', 'session_number': 1, 'status': 'scheduled'}])
        self.assertEqual((v.inserts, v.updates), ([], []))
