"""Fully mocked checks, auto-discovered by CI's test*_no_db.py feature gate."""
import json
from copy import deepcopy
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import monthly_assignment, tests_monthly_assignment as assignment_fixtures


class ConfirmedAssignmentBookingTests(SimpleTestCase):
    def setUp(self):
        self.payload = {
            'learnerKind': 'commercial', 'learnerId': '101', 'activityId': 'COMP-1',
            'activityType': 'assignment', 'assignmentTopicId': '2',
            'monthlyAssignment': {'month': '2026-10', 'meetingKey': 'review:202:template:1'},
        }
        self.source = SimpleNamespace(pk=101, aptem_id='500')
        self.profile = SimpleNamespace(id=202, aptem_id=500)
        self.event = {
            'eventKey': 'review:202:template:1', 'calendarEventKey': 'review:202:template:1',
            'bookingOnly': True, 'reviewSource': 'unlinked-booking', 'source': 'mcr',
            'scheduledDate': '2026-11-06', 'scheduledTime': '12:00', 'status': 'scheduled',
        }
        self.models = {kind: MagicMock() for kind in ('commercial', 'apprenticeship')}
        for model in self.models.values():
            model.all_learners.filter.return_value.first.return_value = self.source
        self.patch('learner_api.calendar.SOURCE_MODELS', self.models)
        self.record = self.patch('learner_api.calendar._learner_calendar_record', return_value=None)
        self.events = self.patch('learner_api.calendar.coaching_events_for_learner', return_value=[self.event])
        self.profiles = self.patch('coach_api.review_sources.review_profile_for_source', return_value=self.profile)
        self.patch('learner_api.monthly_assignment.resubmission_booking_satisfied', return_value=False)

    def patch(self, target, *args, **kwargs):
        patcher = patch(target, *args, **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def test_confirmed_calendar_booking_counts_for_both_learner_types(self):
        original = deepcopy(self.payload)
        for kind in self.models:
            for status in ('scheduled', 'in-progress', 'completed', 'awaiting-signature'):
                with self.subTest(kind=kind, status=status):
                    self.payload['learnerKind'] = kind
                    self.event['status'] = status
                    self.assertTrue(monthly_assignment.booked_coaching(self.payload))
                    self.events.assert_called_with(self.source, self.profile, only_sources={'mcr'},
                                                   dates_only=True, include_unlinked_bookings=True)
        self.payload['learnerKind'] = original['learnerKind']
        self.assertEqual(self.payload, original)

    def test_unconfirmed_cancelled_wrong_type_or_wrong_identity_do_not_count(self):
        for changes in (
            {'status': 'cancelled'}, {'status': 'not-scheduled'}, {'status': 'pending'},
            {'scheduledDate': None}, {'scheduledTime': None}, {'source': 'progress-review'},
            {'source': 'review'}, {'bookingOnly': False}, {'bookingOnly': 1},
            {'reviewSource': 'curriculum'}, {'reviewSource': 'aptem'},
            {'eventKey': 'another-booking'}, {'calendarEventKey': 'another-booking'},
        ):
            with self.subTest(changes=changes):
                self.events.return_value = [{**self.event, **changes}]
                self.assertFalse(monthly_assignment.booked_coaching(self.payload))

    def test_missing_or_ambiguous_owned_calendar_booking_is_rejected(self):
        for events in ([], [self.event, self.event]):
            with self.subTest(count=len(events)):
                self.events.return_value = events
                self.assertFalse(monthly_assignment.booked_coaching(self.payload))

    def test_missing_source_profile_or_conflicting_aptem_identity_is_rejected(self):
        for profile in (None, SimpleNamespace(id=202, aptem_id=999)):
            with self.subTest(profile=profile):
                self.profiles.return_value = profile
                self.assertFalse(monthly_assignment.booked_coaching(self.payload))
        self.source.aptem_id = None
        self.profiles.return_value = SimpleNamespace(id=202, aptem_id=None)
        self.assertFalse(monthly_assignment.booked_coaching(self.payload))
        self.profiles.return_value = self.profile
        self.models['commercial'].all_learners.filter.return_value.first.return_value = None
        self.assertFalse(monthly_assignment.booked_coaching(self.payload))
        self.events.assert_not_called()

    def test_empty_key_cannot_select_another_existing_booking_automatically(self):
        self.payload['monthlyAssignment']['meetingKey'] = ''
        self.assertFalse(monthly_assignment.booked_coaching(self.payload))
        self.events.assert_not_called()

    def test_invalid_resolved_record_does_not_fall_back_to_another_calendar_source(self):
        self.record.return_value = SimpleNamespace(event_type='mcr', scheduled_date='2026-11-06', status='cancelled')
        self.assertFalse(monthly_assignment.booked_coaching(self.payload))
        self.events.assert_not_called()

    def test_confirmed_booking_is_inherited_without_rewriting_the_saved_topic(self):
        from .assignment_topics import inherit_coaching_booking
        rows = [('1', 'submitted_for_tutor_review', deepcopy(self.payload))]
        before = deepcopy(rows)
        self.payload['monthlyAssignment']['meetingKey'] = ''
        inherit_coaching_booking(self.payload, rows)
        self.assertEqual(self.payload['monthlyAssignment']['meetingKey'], self.event['eventKey'])
        self.assertEqual(rows, before)

    def test_assignment_check_endpoint_accepts_the_same_booking_as_the_calendar(self):
        payload = assignment_fixtures.MonthlyAssignmentTests.payload(self)
        payload.update(learnerId='101', assignmentTopicId='2')
        payload['monthlyAssignment'].update(self.payload['monthlyAssignment'])
        before = deepcopy(payload)
        # Keep evidence, KSB and deck checks independent of the meeting regression.
        with patch.object(monthly_assignment, 'approved_evidence_ids', return_value={'file-1'}), \
                patch.object(monthly_assignment, 'available_ksb_codes', return_value={'K1'}), \
                patch.object(monthly_assignment, 'valid_presentation', return_value=True):
            response = unwrap(monthly_assignment.check_assignment)(RequestFactory().post(
                '/', data=json.dumps(payload), content_type='application/json'))
        self.assertEqual(response.status_code, 200)
        checks = json.loads(response.content)['checks']
        self.assertEqual(len(checks), 13)
        self.assertTrue(all(check['passed'] for check in checks))
        self.assertEqual(payload, before)
