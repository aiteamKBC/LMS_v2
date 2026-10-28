"""Teams calls on a session's link that were not that session are told, with their dates. No database, no network.

Run directly: ``python -B backend/curriculum_api/test_off_schedule_runs_no_db.py``.

The attendance sync already ignores a call that finished before the session, began
long after it, or was one person checking the room. Teams still lists such a call
as the meeting having been held on its own day, so every screen showing the session
says so. What is pinned here is the one list those screens read.
"""
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
sys.path.insert(0, str(ROOT))

from curriculum_api import teams_calendar_integrity as integrity  # noqa: E402

UTC = timezone.utc
SESSION = datetime(2026, 11, 1, 14, 0, tzinfo=UTC)


def row(start=SESSION, number=1, live='LIVE-1'):
    return {'id': f'OCC-{number}', 'live_session_id': live, 'session_number': number,
            'scheduled_start': start.replace(tzinfo=None), 'scheduled_end': (start + timedelta(hours=2)).replace(tzinfo=None),
            'status': 'scheduled'}


def logged(run_start, run_end, number=1, live='LIVE-1', reason='before_session'):
    return {'event_type': integrity.EVENT_PREMATURE_RUN, 'live_session_id': live, 'session_number': number,
            'detail': {'scheduledStart': SESSION.isoformat(), 'runStart': run_start.isoformat(),
                       'runEnd': run_end.isoformat(), 'reason': reason}}


TEST_CALL = (datetime(2026, 10, 26, 11, 40, tzinfo=UTC), datetime(2026, 10, 26, 11, 52, tzinfo=UTC))


class OffScheduleRunTests(unittest.TestCase):
    def test_a_test_call_before_the_session_is_listed_with_both_dates(self):
        runs = integrity.off_schedule_runs(row(), [logged(*TEST_CALL)])
        self.assertEqual(runs, [{'runStartUtc': '2026-10-26T11:40:00+00:00', 'runEndUtc': '2026-10-26T11:52:00+00:00',
                                 'scheduledStartUtc': integrity.iso(SESSION), 'reason': 'before_session'}])

    def test_moving_the_session_is_judged_on_its_new_time(self):
        # Moved to 30 October: still after the call, still not this session.
        moved = row(datetime(2026, 10, 30, 14, 0, tzinfo=UTC))
        self.assertEqual([item['reason'] for item in integrity.off_schedule_runs(moved, [logged(*TEST_CALL)])],
                         ['before_session'])
        # Moved onto the call itself: no longer a call on another day, so nothing is said.
        onto = row(datetime(2026, 10, 26, 11, 30, tzinfo=UTC))
        self.assertEqual(integrity.off_schedule_runs(onto, [logged(*TEST_CALL)]), [])

    def test_a_call_long_after_the_session_is_listed(self):
        late = (SESSION + timedelta(days=2), SESSION + timedelta(days=2, hours=1))
        self.assertEqual([item['reason'] for item in integrity.off_schedule_runs(row(), [logged(*late, reason='after_session')])],
                         ['after_session'])

    def test_a_short_test_open_keeps_its_logged_reason(self):
        inside = (SESSION + timedelta(minutes=5), SESSION + timedelta(minutes=8))
        self.assertEqual([item['reason'] for item in integrity.off_schedule_runs(row(), [logged(*inside, reason='test_open')])],
                         ['test_open'])

    def test_each_call_once_however_many_workers_logged_it(self):
        events = [logged(*TEST_CALL), logged(*TEST_CALL), logged(*TEST_CALL)]
        self.assertEqual(len(integrity.off_schedule_runs(row(), events)), 1)

    def test_another_session_or_calendar_is_never_mixed_in(self):
        events = [logged(*TEST_CALL, number=2), logged(*TEST_CALL, live='LIVE-OTHER')]
        self.assertEqual(integrity.off_schedule_runs(row(), events), [])

    def test_other_events_and_unfinished_calls_are_ignored(self):
        events = [{**logged(*TEST_CALL), 'event_type': integrity.EVENT_COMPLETED},
                  {**logged(*TEST_CALL), 'detail': {'runStart': TEST_CALL[0].isoformat(), 'runEnd': ''}}]
        self.assertEqual(integrity.off_schedule_runs(row(), events), [])

    def test_calendar_health_lists_them_on_the_session(self):
        series = {'id': 'LIVE-1', 'join_url': 'https://teams.microsoft.com/l/meetup-join/synthetic'}
        session = integrity.classify_session(series, {**row(), 'graph_event_id': 'EVT', 'join_url': series['join_url']},
                                             events=[logged(*TEST_CALL)], snapshot={}, checked_at=None,
                                             now=datetime(2026, 10, 26, 12, tzinfo=UTC))
        self.assertEqual([item['reason'] for item in session['offScheduleRuns']], ['before_session'])


if __name__ == '__main__':
    unittest.main()
