"""Source qualification tests; unmanaged source reads are explicit doubles."""
from contextlib import ExitStack
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .background_meeting_sync import imported_context
from .review_sources import ReviewIdentityConflict
from . import test_aptem_attendance_stabilization as fixtures


class BackgroundMeetingContextTests(SimpleTestCase):
    def setUp(self):
        fixture = fixtures.AptemAttendanceRefreshTests()
        fixture.prepare('MCM')
        self.record = fixture.record
        self.source = {'id': '99', 'type': 'Monthly Coaching Meeting', 'status': 'scheduled'}
        self.profile = SimpleNamespace(pk=42)
        self.overlay = SimpleNamespace(pk=8, event_key=self.record.event_key, learner_id=42,
            source_review_id=99, owner_email=self.record.owner_email, status='scheduled',
            completed_at=None, meeting_intelligence={})
        self.definition = {'instance': {'id': self.record.event_key, 'learnerId': 42},
                           'historicalReview': self.source}
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        def mock(name, **kw):
            return self.stack.enter_context(patch(name, **kw))
        self.link = mock('coach_api.background_meeting_sync.reconciliation_links.for_calendar', return_value=None)
        self.reader = mock('coach_api.views._imported_review_definition', return_value=self.definition)
        mock('learner_api.models.LearnerProfile.objects').filter.return_value.first.return_value = self.profile
        self.overlays = mock('coach_api.background_meeting_sync.ImportedReviewInstance.objects')
        self.overlays.filter.return_value.__getitem__.return_value = [self.overlay]
        self.booking = mock('coach_api.background_meeting_sync.booking_for_imported_review', return_value=self.record)
        self.meeting_profile = mock('coach_api.background_meeting_sync.meeting_profile', return_value=self.profile)
        self.effective = mock('coach_api.views.resolve_effective_aptem_ids', return_value=({42: 9000}, set()))
        connections = mock('coach_api.background_meeting_sync.connections')
        self.cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        self.cursor.fetchall.return_value = [(self.record.event_key.removeprefix('imported-review:'),)]

    def test_verified_families_and_post_completion_stages(self):
        for family, source_type in (('MCM', 'Monthly Coaching Meeting'), ('PR', 'Progress Review'),
                                   ('PR_SKILLS_RADAR', 'Progress Review (+ Skills Radar)'), ('PSP', 'Personal Support Plan')):
            for state in ('scheduled', 'in-progress', 'awaiting-signature', 'completed'):
                with self.subTest(family=family, state=state):
                    self.source['type'] = source_type
                    self.overlay.status = state
                    self.overlay.meeting_intelligence = {'reviewRevision': 2}
                    self.record.event_type = 'mcr' if family == 'MCM' else 'progress-review'
                    result = imported_context(self.record)
                    self.assertEqual((result['family'], result['status'], result['revision']), (family, state, 2))
        self.reader.assert_called_with(self.record.owner_email, self.record.event_key, pdf_only=True)

    def test_psp_source_booking_without_overlay_is_eligible(self):
        self.source['type'] = 'Personal Support Plan'
        self.record.event_type = 'progress-review'
        self.overlays.filter.return_value.__getitem__.return_value = []
        self.assertIsNone(imported_context(self.record)['overlayId'])

    def test_legacy_source_id_is_resolved_through_profile_not_equal_integer(self):
        self.record.event_key = 'learner-book:mcm:apprenticeship:200:2026-10:99'
        self.record.idempotency_key = self.record.event_key
        result = imported_context(self.record)
        self.assertEqual(result['profileId'], 42)
        self.cursor.execute.assert_called_once_with(
            'SELECT aptem_review_id FROM "Learner".reviews WHERE id = %s AND learner_id = %s', [99, 42])
        self.meeting_profile.assert_called_once_with(self.record)
        self.effective.assert_called_once_with([self.profile], strict=True)

    def test_explicit_native_and_generic_populations_retain_default_path(self):
        self.record.event_key = 'native:review:42'
        self.record.review_instance_id = 'REVI-synthetic'
        self.assertIsNone(imported_context(self.record))
        self.record.review_instance_id = None
        for kind in ('catchup', 'student-support', 'custom'):
            self.record.event_type = kind
            self.assertIsNone(imported_context(self.record))
        self.reader.assert_not_called()
        self.record.event_type = 'mcr'
        self.effective.return_value = ({}, set())
        self.assertIsNone(imported_context(self.record))

    def test_reconciled_native_key_uses_imported_source_and_overlay(self):
        self.record.event_key = 'native:review:42'
        self.record.review_instance_id = 'REVI-synthetic'
        self.link.return_value = SimpleNamespace(overlay=self.overlay)
        self.assertEqual(imported_context(self.record)['sourceReviewId'], '99')
        self.reader.assert_called_once_with(self.record.owner_email, self.overlay.event_key, pdf_only=True)

    def test_wrong_owner_profile_key_and_ambiguous_overlay_fail_closed(self):
        for field, value in (('owner_email', 'other@example.invalid'), ('learner_id', 200), ('event_key', 'imported-review:other')):
            with self.subTest(field=field):
                original = getattr(self.overlay, field)
                setattr(self.overlay, field, value)
                with self.assertRaises(ReviewIdentityConflict):
                    imported_context(self.record)
                setattr(self.overlay, field, original)
        self.overlays.filter.return_value.__getitem__.return_value = [self.overlay, deepcopy(self.overlay)]
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)

    def test_missing_source_invalid_family_and_booking_mismatch_fail_closed(self):
        self.reader.return_value = None
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)
        self.reader.return_value = self.definition
        self.source['type'] = 'Unsupported'
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)
        self.source['type'] = 'MCM'
        booking = deepcopy(self.record)
        booking.graph_event_id = 'another-event'
        self.booking.return_value = booking
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)

    def test_unqualified_legacy_and_conflicting_aptem_identity_fail_closed(self):
        self.record.event_key = 'historical:mcr'
        self.record.idempotency_key = ''
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)
        self.effective.return_value = ({}, {42})
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)
        self.meeting_profile.return_value = None
        with self.assertRaises(ReviewIdentityConflict):
            imported_context(self.record)
