"""Managed synthetic ORM publication tests; PostgreSQL acceptance remains separate."""
import json
from django.test import TestCase
from coach_api import views
from coach_api import test_migrated_summary_binding as fixtures


class CheckSessionPublicationTests(TestCase):
    setUp = fixtures.MigratedBindingFlowTests.setUp
    check = fixtures.MigratedBindingFlowTests.check

    def test_new_segment_during_ai_cannot_first_fill_old_result(self):
        def changed():
            views.stored_coach_meeting_transcript_for_summary.return_value = {
                'artifactId': 'artifact-one,artifact-two', 'text': 'New final decisions'}
        response, provider = self.check(during_generation=changed)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['code'], 'SUMMARY_SUPERSEDED')
        self.assertNotIn('recap', self.overlay.answers)
        self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)
        provider.assert_called_once()

    def test_cancelled_calendar_rejected_before_providers(self):
        self.calendar.status = 'cancelled'; self.calendar.save(update_fields=['status'])
        response, provider = self.check()
        self.assertEqual(response.status_code, 409)
        self.assertNotIn('recap', self.overlay.answers)
        provider.assert_not_called()
