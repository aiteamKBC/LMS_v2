"""D01 namespace collisions; synthetic rows and no permitted database access."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api.models import EnrolmentUser, LearnerProfile
from .models import CoachCalendarEvent
from . import views


class MeetingProfileIdentityTests(SimpleTestCase):
    def setUp(self):
        self.reset_rows()
        self.lookup = self.enterContext(patch.object(LearnerProfile.objects, 'filter', side_effect=self.profiles))
        source_query = self.enterContext(patch.object(EnrolmentUser.all_learners, 'filter'))
        source_query.return_value.first.side_effect = lambda: self.source

    def reset_rows(self):
        self.profile = SimpleNamespace(id=800, pk=800, enrolment_id=200, aptem_id=9000,
            coach_email='coach@example.invalid', learner_type='apprenticeship', full_name='Expected Learner', email='learner@example.invalid')
        self.collision = SimpleNamespace(id=200, pk=200, enrolment_id=999, aptem_id=9999,
            coach_email='coach@example.invalid', full_name='Unrelated Person', email='unrelated@example.invalid')
        self.source = SimpleNamespace(id=200, pk=200, aptem_id='9000', learner_type='apprenticeship')
        self.record = CoachCalendarEvent(id=7, event_key='legacy-booking', learner_id=200,
            owner_email='coach@example.invalid', event_type='progress-review',
            idempotency_key='learner-book:progress-review:apprenticeship:200:2026-10:3000')

    def profiles(self, **kwargs):
        if 'enrolment_id' in kwargs or 'aptem_id' in kwargs:
            return [self.profile] if self.profile else []
        query = MagicMock()
        row = self.collision if kwargs.get('id', kwargs.get('pk')) == 200 else self.profile
        query.first.return_value = row
        query.only.return_value.first.return_value = row
        return query

    def test_colliding_legacy_enrolment_id_resolves_stable_profile(self):
        self.assertIs(views.coach_meeting_record_learner(self.record), self.profile)
        self.assertFalse(any(call.kwargs.get('id') == 200 or call.kwargs.get('pk') == 200 for call in self.lookup.call_args_list))

    def test_legacy_row_already_using_profile_id_resolves_same_identity(self):
        self.record.learner_id = 800
        self.assertIs(views.coach_meeting_record_learner(self.record), self.profile)

    def test_missing_conflicting_or_unowned_bridge_never_falls_back_to_collision(self):
        for change in ('missing', 'conflict', 'owner', 'row', 'family', 'kind'):
            with self.subTest(change=change):
                self.reset_rows()
                if change == 'missing': self.profile = None
                if change == 'conflict': self.profile.aptem_id = 12345
                if change == 'owner': self.profile.coach_email = 'other@example.invalid'
                if change == 'row': self.record.learner_id = 123
                if change == 'family': self.record.event_type = 'mcr'
                if change == 'kind': self.source.learner_type = 'commercial'
                self.assertIsNone(views.coach_meeting_record_learner(self.record))

    def test_canonical_profile_booking_remains_supported(self):
        self.record.idempotency_key = ''
        self.record.event_key = 'progress-review:800:1:2026-10-24'
        self.record.learner_id = 800
        self.assertIs(views.coach_meeting_record_learner(self.record), self.profile)

    def test_commercial_legacy_bridge_is_source_qualified(self):
        self.record.idempotency_key = self.record.idempotency_key.replace('apprenticeship', 'commercial')
        self.source.learner_type = self.profile.learner_type = 'commercial'
        self.assertIs(views.coach_meeting_record_learner(self.record), self.profile)

    def test_pr_employer_uses_resolved_profile_but_keeps_stored_participant(self):
        self.record.learner_name = 'Historical Learner'
        self.record.learner_email = 'historical@example.invalid'
        with patch.object(views, 'resolve_caseload_source_row', return_value=self.source), \
                patch.object(views, 'learner_employer_attendee', return_value={'name': 'Manager', 'email': 'manager@example.invalid'}) as employer:
            people = views.coach_meeting_expected_attendees(self.record)
        employer.assert_called_once_with(self.profile, self.source)
        learner = next(row for row in people if row['role'] == 'learner')
        self.assertEqual(learner['email'], 'historical@example.invalid')
        self.assertEqual(learner['name'], 'Historical Learner')

    def test_unknown_legacy_key_never_assumes_profile_namespace(self):
        self.record.idempotency_key = 'learner-book:opaque-old-key'
        self.assertIsNone(views.coach_meeting_record_learner(self.record))

    def test_native_reverse_link_authorizes_profile_even_after_coach_reassignment(self):
        self.record.learner_id = 800
        self.record.review_instance_id, self.record.review_template_id = 'REVI-synthetic', 'REV-template'
        self.profile.coach_email = 'new-coach@example.invalid'
        instance = dict(calendar_event_id=7, learner_id=800, coach_email=self.record.owner_email, review_template_id='REV-template')
        with patch.object(views.curriculum_review_instances, 'get_review_instance', return_value=instance):
            self.assertIs(views.coach_meeting_record_learner(self.record), self.profile)
            for key, value in [('learner_id', 999), ('calendar_event_id', 123), ('coach_email', 'other@example.invalid')]:
                with patch.object(views.curriculum_review_instances, 'get_review_instance', return_value={**instance, key: value}):
                    self.assertIsNone(views.coach_meeting_record_learner(self.record))

    def test_duplicate_stable_bridges_fail_closed(self):
        self.lookup.side_effect = None
        self.lookup.return_value = [self.profile, self.collision]
        self.assertIsNone(views.coach_meeting_record_learner(self.record))
