from contextlib import ExitStack
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api.calendar_booking_only import (
    booking_only_candidates, booking_only_projection, unlinked_review_bookings,
)


def profile(**changes):
    return SimpleNamespace(**dict(dict(id=7, enrolment_id=107, learner_type='commercial',
        email='learner@example.invalid', coach_name='Coach'), **changes))


def booking(**changes):
    return SimpleNamespace(**dict(dict(pk=31, event_key='review:7:template:1',
        operation_id='operation-31', learner_id=7, learner_email='learner@example.invalid',
        idempotency_key='', event_type='mcr', review_template_id='template',
        review_instance_id='instance', occurrence_number=1, status='scheduled', sync_state='synced',
        graph_event_id='graph-31', meeting_link='https://example.invalid/meeting',
        graph_web_link='', scheduled_date=date(2026, 10, 20), scheduled_time=time(10)), **changes))


def event(record):
    return dict(eventKey=record.event_key, id=record.event_key, date='2026-10-20',
        source='mcr', type='coaching', status='scheduled', learner='Synthetic learner', startHour=10,
        reviewTemplateId='template', reviewInstanceId='instance', reviewResponses={'answer': 'saved'})


class BookingOnlyCandidateTests(SimpleTestCase):
    @patch('coach_api.reconciliation_links.active_links')
    @patch('curriculum_api.views.fetch_all')
    def test_legacy_key_with_profile_id_requires_exact_native_proof(self, fetch, links):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                row = booking(idempotency_key=f'learner-book:mcm:{kind}:107:2026-10:41')
                owner = profile(learner_type=kind)
                proof = dict(id='instance', learner_id=7, learner_kind=kind, calendar_event_id=31,
                             review_template_id='template', occurrence_number=1)
                fetch.return_value = [proof]
                links.return_value.values_list.return_value = []
                self.assertEqual(unlinked_review_bookings([row], [owner], {7}), [(row, owner)])
                self.assertEqual(fetch.call_args.args[1], ['instance'])
                self.assertEqual(booking_only_candidates([row], [owner], {7}), [])
                for mismatch in [dict(calendar_event_id=32), dict(learner_id=8),
                                 dict(review_template_id='other'), dict(occurrence_number=2),
                                 dict(learner_kind='other')]:
                    with self.subTest(mismatch=mismatch):
                        self.assertEqual(booking_only_candidates([row], [owner], {7},
                            native_instances=[{**proof, **mismatch}]), [])

    @patch('coach_api.reconciliation_links.active_links')
    @patch('curriculum_api.views.fetch_all')
    def test_old_email_requires_exact_saved_instance_and_calendar_identity(self, fetch, links):
        row = booking(learner_email='old@example.invalid')
        proof = dict(id='instance', learner_id=7, learner_kind='', calendar_event_id=31,
                     review_template_id='template', occurrence_number=1)
        fetch.return_value = [proof]
        links.return_value.values_list.return_value = []
        self.assertEqual(len(unlinked_review_bookings([row], [profile()], {7})), 1)
        self.assertEqual(fetch.call_args.args[1], ['instance'])
        for mismatch in [dict(calendar_event_id=32), dict(learner_id=8), dict(review_template_id='other'),
                         dict(occurrence_number=2), dict(learner_kind='apprenticeship')]:
            with self.subTest(mismatch=mismatch):
                self.assertEqual(booking_only_candidates([row], [profile()], {7},
                    native_instances=[{**proof, **mismatch}]), [])

    def test_requires_confirmed_native_booking_and_exact_aptem_owner(self):
        row, owner = booking(), profile()
        self.assertEqual(booking_only_candidates([row], [owner], {7}), [(row, owner)])
        self.assertEqual(booking_only_candidates([row], [owner], set()), [])
        self.assertEqual(booking_only_candidates([row], [profile(id=8)], {8}), [])
        self.assertEqual(booking_only_candidates([row], [profile(email='other@example.invalid')], {7}), [])
        self.assertEqual(booking_only_candidates([row], [owner, owner], {7}), [])

    def test_rejects_unconfirmed_cancelled_undated_or_non_review_rows(self):
        for change in [dict(status='cancelled'), dict(sync_state='pending'), dict(sync_state='failed'),
                       dict(graph_event_id=''), dict(meeting_link=''), dict(scheduled_date=None),
                       dict(scheduled_time=None), dict(status='not-scheduled'), dict(event_type='catch-up'),
                       dict(review_template_id='', review_instance_id='')]:
            with self.subTest(change=change):
                self.assertEqual(booking_only_candidates([booking(**change)], [profile()], {7}), [])

    def test_legacy_enrolment_id_is_not_confused_with_profile_id_or_kind(self):
        for kind in ('commercial', 'apprenticeship'):
            row = booking(learner_id=107, idempotency_key=f'learner-book:mcm:{kind}:107:2026-10:41')
            owner = profile(learner_type=kind)
            self.assertEqual(booking_only_candidates([row], [owner], {7}), [(row, owner)])
            self.assertEqual(booking_only_candidates([row], [profile(id=107, enrolment_id=207)], {107}), [])
            self.assertEqual(booking_only_candidates([row], [profile(learner_type='other')], {7}), [])

    def test_durable_identity_prevents_duplicate_projection(self):
        row = booking()
        for displayed in [dict(eventKey=row.event_key), dict(calendarEventKey=row.event_key),
                          dict(calendarEventId=str(row.pk)), dict(operationId=row.operation_id)]:
            with self.subTest(displayed=displayed):
                self.assertEqual(booking_only_candidates([row], [profile()], {7}, events=[displayed]), [])
        self.assertEqual(booking_only_candidates([row], [profile()], {7}, linked_keys=[row.event_key]), [])

    @patch('coach_api.reconciliation_links.active_links')
    def test_explicit_applied_reconciliation_is_never_replaced(self, links):
        links.return_value.values_list.return_value = [31]
        self.assertEqual(unlinked_review_bookings([booking()], [profile()], {7}), [])
        links.assert_called_once_with(calendar_event_id__in=[31])

    def test_projection_preserves_booking_and_does_not_mutate_review_or_record(self):
        row = booking()
        original = event(row)
        before = vars(row).copy()
        projected = booking_only_projection(original, row)
        self.assertTrue(projected['bookingOnly'])
        self.assertEqual(projected['calendarEventId'], '31')
        self.assertEqual(projected['eventKey'], row.event_key)
        self.assertEqual(projected['date'], original['date'])
        self.assertEqual(projected['meetingLink'], row.meeting_link)
        self.assertFalse(projected['hasReviewForm'])
        for key in ('reviewId', 'reviewTemplateId', 'reviewInstanceId', 'formEventKey'):
            self.assertIsNone(projected[key])
        self.assertEqual(original['reviewResponses'], {'answer': 'saved'})
        self.assertEqual(vars(row), before)


class BookingOnlyCalendarIntegrationTests(SimpleTestCase):
    def test_coach_only_calendar_opt_in_shows_booking_within_requested_window(self):
        from coach_api.views import collect_generated_timetable
        row, owner = booking(), profile()
        patches = {
            'coach_api.views.fetch_owner_active_learner_profiles': [],
            'coach_api.views.fetch_caseload_timetable_profiles': [owner],
            'coach_api.views.build_learner_profile_map': {7: owner},
            'coach_api.views.coach_staff_display_name': 'Coach',
            'coach_api.views.resolve_coach_review_events': dict(events=[], sourceCounts={},
                reviewGenerationIssues=[], aptemProfileIds={7}),
            'coach_api.views.fetch_standalone_event_records': [row],
            'coach_api.review_sources.load_imported_links': ({}, {}),
            'coach_api.views.curriculum_review_instances.reconcile_review_event_keys': {},
            'coach_api.views.review_type_fields_by_template': {},
            'coach_api.views.review_titles_by_template': {},
            'coach_api.views.build_catchup_calendar_event': event(row),
            'coach_api.views.build_timetable_summary': {},
        }
        with ExitStack() as stack:
            for name, result in patches.items():
                stack.enter_context(patch(name, return_value=result))
            stack.enter_context(patch('coach_api.views.assign_timetable_slots', side_effect=lambda items: items))
            links = stack.enter_context(patch('coach_api.reconciliation_links.active_links'))
            links.return_value.values_list.return_value = []
            options = dict(include_live_sessions=False, include_scheduler_queues=False)
            self.assertEqual(collect_generated_timetable('coach@example.invalid', **options)['events'], [])
            result = collect_generated_timetable('coach@example.invalid', start_date=date(2026, 10, 1),
                end_date=date(2026, 10, 31), include_unlinked_bookings=True, **options)
            self.assertEqual(len(result['events']), 1)
            self.assertTrue(result['events'][0]['bookingOnly'])
            self.assertEqual(collect_generated_timetable('coach@example.invalid', start_date=date(2026, 11, 1),
                end_date=date(2026, 11, 30), include_unlinked_bookings=True, **options)['events'], [])

    def test_learner_calendar_opt_in_does_not_change_shared_review_and_monthly_consumers(self):
        from learner_api.calendar import coaching_events_for_learner
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), ExitStack() as stack:
                row, owner = booking(), profile(learner_type=kind)
                learner = SimpleNamespace(pk=107, email=owner.email)
                for name, result in {
                    'learner_api.calendar.source_for_learner': SimpleNamespace(kind='aptem', aptem_id=700),
                    'learner_api.calendar.review_profile_for_source': owner,
                    'learner_api.calendar._belongs_to_current_cycle': True,
                    'learner_api.calendar._serialize_event': event(row),
                    'learner_api.imported_review_calendar.imported_events_for_learner': [],
                }.items():
                    stack.enter_context(patch(name, return_value=result))
                query = stack.enter_context(patch('learner_api.calendar.CoachCalendarEvent.objects.filter'))
                query.return_value.order_by.return_value = [row]
                links = stack.enter_context(patch('coach_api.reconciliation_links.active_links'))
                links.return_value.values_list.return_value = []
                self.assertEqual(coaching_events_for_learner(learner, owner), [])
                result = coaching_events_for_learner(learner, owner, include_unlinked_bookings=True)
                self.assertEqual(len(result), 1)
                self.assertTrue(result[0]['bookingOnly'])
                self.assertIsNone(result[0]['reviewTemplateId'])
