from datetime import datetime
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from coach_api.live_session_outcomes import annotate_live_session_outcomes

NOW = timezone.make_aware(datetime(2026, 9, 26, 12, 0))


def learner_session(occurrence, start='09:00', status='scheduled'):
    return {'source': 'live-session', 'occurrenceId': occurrence, 'status': status,
            'scheduledDate': '2026-09-26', 'scheduledTime': start, 'durationMinutes': 120}


class LiveSessionOutcomeTests(SimpleTestCase):
    def test_learner_calendar_uses_that_learners_attendance(self):
        events = [learner_session('OCC-1'), learner_session('OCC-2'), learner_session('OCC-3', start='11:00')]
        with patch('coach_api.live_session_outcomes._present_occurrences', return_value={'OCC-1'}) as present:
            annotate_live_session_outcomes(events, learner_profile_id=7, learner_email='l@example.test', now=NOW)
        self.assertEqual([e['meetingOutcome'] for e in events], ['completed', 'ended', None])
        self.assertEqual(present.call_args.args[0], {'OCC-1', 'OCC-2'})
        self.assertEqual(present.call_args.kwargs, {'learner_profile_id': 7, 'learner_email': 'l@example.test'})

    def test_coach_calendar_reads_start_hour_skips_cancelled_and_ends_untracked(self):
        events = [
            {'source': 'live-session', 'occurrenceId': 'OCC-1', 'status': 'scheduled',
             'date': '2026-09-26', 'startHour': 9.0, 'durationMinutes': 120},
            {'source': 'live-session', 'occurrenceId': 'OCC-2', 'status': 'cancelled',
             'date': '2026-09-26', 'startHour': 9.0, 'durationMinutes': 120},
            {'source': 'live-session', 'occurrenceId': None, 'status': 'scheduled',
             'date': '2026-09-26', 'startHour': 9.0, 'durationMinutes': 120},
            {'source': 'mcr', 'status': 'scheduled'},
        ]
        with patch('coach_api.live_session_outcomes._present_occurrences', return_value=set()) as present:
            annotate_live_session_outcomes(events, now=NOW)
        self.assertEqual([e.get('meetingOutcome') for e in events[:3]], ['ended', None, 'ended'])
        self.assertEqual(present.call_args.args[0], {'OCC-1'})
        self.assertNotIn('meetingOutcome', events[3])
        self.assertEqual(present.call_args.kwargs, {'learner_profile_id': None, 'learner_email': ''})
