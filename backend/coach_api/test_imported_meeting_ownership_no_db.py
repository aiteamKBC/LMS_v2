"""Offline behavior checks; physical uniqueness is exercised on local PostgreSQL."""
from types import SimpleNamespace
from contextlib import nullcontext
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .actual_session_resolution import VerifiedMeetingTarget
from .imported_meeting_inventory import classify_bookings
from .imported_meeting_ownership import (MeetingOwnershipError, enabled_for,
                                          require_activation_ready,
                                          required_for_record,
                                          resolve_verified_target)


class ImportedMeetingOwnershipOfflineTests(SimpleTestCase):
    @override_settings(APTEM_MEETING_OWNERSHIP_ENABLED=True)
    def test_only_supported_imported_families_are_gated(self):
        for source in ('Monthly Coaching Meeting', 'Progress Review',
                       'Progress Review (+ Skills Radar)'):
            with self.subTest(source=source):
                self.assertTrue(enabled_for({'reviewSource': 'aptem',
                                             'importedReviewType': source}))
        self.assertFalse(enabled_for({'reviewSource': 'curriculum',
                                      'importedReviewType': 'Progress Review'}))
        self.assertFalse(enabled_for({'reviewSource': 'aptem',
                                      'importedReviewType': 'Personal Support Plan'}))

    def test_gate_defaults_off(self):
        self.assertFalse(enabled_for({'reviewSource': 'aptem',
                                      'importedReviewType': 'Progress Review'}))

    @override_settings(APTEM_MEETING_OWNERSHIP_ENABLED=True)
    def test_cancel_family_resolver_preserves_psp(self):
        cursor = SimpleNamespace(execute=lambda *args: None,
                                 fetchall=lambda: [('Personal Support Plan',)])
        connection = SimpleNamespace(cursor=lambda: nullcontext(cursor))
        record = SimpleNamespace(event_key='imported-review:psp-1', learner_id=23)
        with patch('coach_api.imported_meeting_ownership.connections',
                   {'default': connection}):
            self.assertFalse(required_for_record(record))
            cursor.fetchall = lambda: [('Progress Review',)]
            self.assertTrue(required_for_record(record))

    @override_settings(APTEM_MEETING_OWNERSHIP_INVENTORY_APPROVED=False)
    def test_incomplete_inventory_blocks_before_graph(self):
        with patch('coach_api.imported_meeting_ownership.storage_ready', return_value=True):
            with self.assertRaises(MeetingOwnershipError) as caught:
                require_activation_ready()
        self.assertEqual(caught.exception.code, 'MEETING_OWNERSHIP_INVENTORY_PENDING')

    @override_settings(APTEM_MEETING_OWNERSHIP_INVENTORY_APPROVED=True)
    def test_missing_database_guards_block_before_graph(self):
        with patch('coach_api.imported_meeting_ownership.storage_ready', return_value=False):
            with self.assertRaises(MeetingOwnershipError) as caught:
                require_activation_ready()
        self.assertEqual(caught.exception.code, 'MEETING_OWNERSHIP_STORAGE_UNAVAILABLE')

    @override_settings(APTEM_MEETING_OWNERSHIP_INVENTORY_APPROVED=True)
    def test_unregistered_legacy_booking_blocks_activation(self):
        with patch('coach_api.imported_meeting_ownership.storage_ready', return_value=True), \
             patch('coach_api.imported_meeting_ownership.local_coverage_ready', return_value=False):
            with self.assertRaises(MeetingOwnershipError) as caught:
                require_activation_ready()
        self.assertEqual(caught.exception.code, 'MEETING_OWNERSHIP_LEGACY_UNREGISTERED')

    def test_provider_resolver_requires_verified_target(self):
        target = VerifiedMeetingTarget('path', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'online-1', 71, 'event-71', 'a' * 64)
        def verified(_record, *, identity_out):
            identity_out['target'] = target
            return 'path', None
        with patch('coach_api.imported_meeting_ownership.strict_imported_meeting_target',
                   side_effect=verified):
            self.assertIs(resolve_verified_target(SimpleNamespace()), target)
        with patch('coach_api.imported_meeting_ownership.strict_imported_meeting_target',
                   return_value=('', {'code': 'UNVERIFIED'})):
            with self.assertRaises(MeetingOwnershipError):
                resolve_verified_target(SimpleNamespace())

    def test_legacy_local_and_provider_conflicts_are_distinct(self):
        rows = [
            {'source_review_id': 1, 'calendar_event_id': 11,
             'graph_event_id': 'event-one', 'meeting_link': 'https://teams.test/one'},
            {'source_review_id': 2, 'calendar_event_id': 12,
             'graph_event_id': 'event-two', 'meeting_link': 'https://teams.test/two'},
        ]
        unknown = classify_bookings(rows, exhaustive=True)
        self.assertFalse(unknown['complete'])
        self.assertEqual(unknown['unresolved_count'], 2)
        same_provider = ('tenant', 'organizer', 'online')
        result = classify_bookings(rows, provider_identities={11: same_provider,
                                                               12: same_provider}, exhaustive=True)
        self.assertEqual(result['conflicts']['provider'], ((1, 2),))
        self.assertEqual(result['conflict_counts']['event'], 0)
        self.assertEqual(result['conflict_counts']['link'], 0)
        self.assertFalse(result['complete'])

    def test_unclaimed_booking_and_partial_inventory_never_certify_scope(self):
        rows = [{'source_review_id': 1, 'calendar_event_id': 11,
                 'graph_event_id': 'event-one', 'meeting_link': 'https://teams.test/one'}]
        provider = {11: ('tenant', 'organizer', 'online')}
        self.assertFalse(classify_bookings(rows, provider_identities=provider)['complete'])
        self.assertTrue(classify_bookings(rows, provider_identities=provider,
                                          exhaustive=True)['complete'])

    @override_settings(APTEM_MEETING_OWNERSHIP_ENABLED=True)
    def test_scheduling_does_not_call_graph_without_inventory(self):
        from .views import synchronize_reserved_calendar_event
        event = {'reviewSource': 'aptem', 'importedReviewType': 'Progress Review'}
        with patch('coach_api.imported_meeting_ownership.require_activation_ready',
                   side_effect=MeetingOwnershipError('MEETING_OWNERSHIP_INVENTORY_PENDING')), \
             patch('coach_api.views.sync_calendar_event_to_graph') as graph, \
             patch('coach_api.views.CoachCalendarEvent.objects') as calendar:
            with self.assertRaises(MeetingOwnershipError):
                synchronize_reserved_calendar_event(71, event)
        graph.assert_not_called()
        calendar.select_for_update.assert_not_called()

    @override_settings(APTEM_MEETING_OWNERSHIP_ENABLED=True)
    def test_cancellation_does_not_call_graph_without_inventory(self):
        from .views import LearnerCalendarConflict, cancel_reserved_calendar_event
        record = SimpleNamespace(pk=71, event_key='imported-review:source-42')
        with patch('coach_api.imported_meeting_ownership.required_for_record', return_value=True), \
             patch('coach_api.imported_meeting_ownership.require_activation_ready',
                   side_effect=MeetingOwnershipError('MEETING_OWNERSHIP_INVENTORY_PENDING')), \
             patch('coach_api.views.delete_calendar_event_from_graph') as graph:
            with self.assertRaises(LearnerCalendarConflict):
                cancel_reserved_calendar_event(record)
        graph.assert_not_called()
