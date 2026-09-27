from datetime import datetime
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from coach_api.meeting_outcomes import annotate_meeting_outcomes

NOW = timezone.make_aware(datetime(2026, 9, 26, 12, 0))


def event(key, source='mcr', status='scheduled', day='2026-09-26', start='10:00', minutes=60):
    return {'eventKey': key, 'source': source, 'status': status,
            'scheduledDate': day, 'scheduledTime': start, 'durationMinutes': minutes}


class MeetingOutcomeTests(SimpleTestCase):
    def annotate(self, events, attended=()):
        with patch('coach_api.meeting_outcomes.learner_attended_event_keys',
                   return_value=set(attended)) as lookup:
            annotate_meeting_outcomes(events, now=NOW)
        return lookup

    def test_elapsed_meeting_is_ended_unless_the_learner_attended(self):
        events = [event('mcr:1'), event('support:2', source='student-support', status='in-progress')]
        self.annotate(events, attended={'support:2'})
        self.assertEqual([e['meetingOutcome'] for e in events], ['ended', 'completed'])

    def test_upcoming_and_unbooked_meetings_have_no_outcome(self):
        events = [event('mcr:1', start='11:30'), event('pr:2', source='progress-review', start=None),
                  event('pr:3', source='progress-review', status='not-scheduled')]
        lookup = self.annotate(events)
        self.assertEqual([e['meetingOutcome'] for e in events], [None, None, None])
        lookup.assert_not_called()

    def test_review_lifecycle_and_live_sessions_keep_their_own_status(self):
        events = [event('pr:1', source='progress-review', status='awaiting-signature'),
                  event('mcr:2', status='completed'), event('mcr:3', status='cancelled'),
                  event('live:4', source='live-session')]
        self.annotate(events)
        self.assertEqual([e['meetingOutcome'] for e in events], [None, None, None, None])

    def test_auto_completed_catchup_shows_whether_the_learner_attended(self):
        events = [event('catch-up:1', source='catch-up', status='completed'),
                  event('catch-up:2', source='catch-up', status='completed')]
        self.annotate(events, attended={'catch-up:2'})
        self.assertEqual([e['meetingOutcome'] for e in events], ['ended', 'completed'])
