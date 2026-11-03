"""Native review meeting context uses the exact authorized calendar association."""
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views
from .models import CoachCalendarEvent


class NativeReviewMeetingContextTests(SimpleTestCase):
    def setUp(self):
        self.instance = {'id': 'REVI-1', 'calendar_event_id': 17, 'learner_id': 42,
                         'coach_email': 'coach@example.invalid'}

    def test_calendar_lookup_scopes_instance_learner_and_owner(self):
        with patch.object(CoachCalendarEvent.objects, 'filter') as lookup:
            views._review_instance_calendar_record(self.instance)
        lookup.assert_called_once_with(pk=17, review_instance_id='REVI-1', learner_id=42,
                                       owner_email__iexact='coach@example.invalid')

    def test_form_exposes_only_linked_teams_booking(self):
        meeting = CoachCalendarEvent(event_key='native:1', event_type='review', status='scheduled',
            meeting_link='https://example.invalid/meeting', graph_web_link='')
        with patch.object(views.curriculum_review_instances, 'review_instance_form_definition',
                          return_value={'template': {}, 'sections': []}), \
             patch.object(views.LearnerProfile.objects, 'filter') as profiles, \
             patch.object(views, '_review_instance_calendar_record', return_value=meeting), \
             patch.object(views, '_review_instance_meeting_summary_source', return_value=None):
            profiles.return_value.only.return_value.first.return_value = None
            result = views._coach_review_instance_definition(self.instance)
        self.assertEqual(result['calendarMeeting']['eventKey'], 'native:1')
        self.assertEqual(result['calendarMeeting']['source'], 'review')

    def test_unlinked_or_no_link_does_not_expose_meeting(self):
        for meeting in (None, CoachCalendarEvent(event_key='native:1', meeting_link='', graph_web_link='')):
            with self.subTest(meeting=meeting), \
                 patch.object(views.curriculum_review_instances, 'review_instance_form_definition',
                              return_value={'template': {}, 'sections': []}), \
                 patch.object(views.LearnerProfile.objects, 'filter') as profiles, \
                 patch.object(views, '_review_instance_calendar_record', return_value=meeting), \
                 patch.object(views, '_review_instance_meeting_summary_source', return_value=None):
                profiles.return_value.only.return_value.first.return_value = None
                self.assertNotIn('calendarMeeting', views._coach_review_instance_definition(self.instance))
