"""A generic MCM/PR booking request (no eventKey -- the learner used the
general "Book a Coach Session" picker instead of an official calendar card)
must resolve to the same canonical Curriculum occurrence the official card
would have, or be rejected outright. It must never create a standalone,
unlinked CoachCalendarEvent -- see learner_api.calendar._resolve_direct_cycle_event_key
and coach_api.views.require_review_template_for_first_linkage /
ensure_review_instance_for_calendar_record.
"""
import json
from datetime import time
from unittest.mock import patch

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import reviews, review_types

from . import calendar as learner_calendar
from .tests_review_scheduling_sync import (
    COACH_EMAIL,
    MIRROR_ID,
    ReviewSchedulingSyncTestCase,
    bookable_day,
    raw_view,
)


class DirectRequestHelpersMixin(ReviewSchedulingSyncTestCase):
    def learner_requests_generic(self, session_type, day, clock='10:00', expect_status=(200, 201)):
        """The generic booking-picker path: no eventKey at all."""
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': session_type,
                'scheduledDate': day.isoformat(), 'scheduledTime': clock, 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(learner_calendar.learner_calendar_book)(
                request, 'commercial', self.learner.pk,
            ),
        )
        expected = expect_status if isinstance(expect_status, tuple) else (expect_status,)
        self.assertIn(response.status_code, expected, response.content)
        return response

    def coach_schedules_with_real_standalone_records(self, event_key, day, clock='10:00', expect_status=200):
        """Like ReviewSchedulingSyncTestCase.coach_schedules, but WITHOUT the
        shared harness's blanket ``fetch_standalone_event_records -> []``
        mock, so an already-persisted CoachCalendarEvent row is looked up for
        real. Needed to exercise rescheduling a review whose template has
        since been archived: the harness's usual mock hides any stored row,
        which would make even an already-linked reschedule look like the
        occurrence vanished -- a test-harness artifact, not real behaviour.
        """
        patchers = [
            patcher for patcher in self.patches()
            if getattr(patcher, 'attribute', None) != 'fetch_standalone_event_records'
        ]
        for patcher in patchers:
            patcher.start()
        try:
            with patch('learner_api.calendar_connections.booking_conflicts', return_value=False):
                request = self.factory.post(
                    '/coach_api/coach/timetable/events/schedule',
                    data=json.dumps({
                        'eventKey': event_key, 'scheduledDate': day.isoformat(),
                        'scheduledTime': clock, 'durationMinutes': 60,
                    }),
                    content_type='application/json',
                )
                response = raw_view(coach_views.coach_timetable_schedule_event)(request)
        finally:
            for patcher in reversed(patchers):
                patcher.stop()
        self.assertEqual(response.status_code, expect_status, response.content)
        return json.loads(response.content.decode())


class GenericRequestResolvesSingleOccurrenceTests(DirectRequestHelpersMixin):
    def test_generic_mcm_request_links_to_the_one_due_occurrence(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        day = bookable_day(20)

        response = self.learner_requests_generic('mcr', day)
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_key, occurrence['eventKey'])
        self.assertEqual(record.review_template_id, template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_generic_pr_request_links_to_the_one_due_occurrence(self):
        template = self.template(
            name='Quarterly Progress Conversation',
            type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8,
        )
        occurrence = self.coach_occurrence('progress-review')
        day = bookable_day(25)

        response = self.learner_requests_generic('progress-review', day)
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_key, occurrence['eventKey'])
        self.assertEqual(record.review_template_id, template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)


class GenericRequestNoOccurrenceTests(DirectRequestHelpersMixin):
    def test_generic_mcm_request_with_no_curriculum_programme_is_rejected(self):
        """No enabled Review template exists at all for this learner's
        programme -- there is nothing official to link to."""
        day = bookable_day(20)
        response = self.learner_requests_generic('mcr', day, expect_status=404)
        self.assertIn('No official', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_generic_pr_request_with_no_curriculum_programme_is_rejected(self):
        day = bookable_day(20)
        response = self.learner_requests_generic('progress-review', day, expect_status=404)
        self.assertIn('No official', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)


class GenericRequestAmbiguousOccurrenceTests(DirectRequestHelpersMixin):
    def test_generic_mcm_request_ambiguous_across_two_templates_is_rejected(self):
        """Two enabled MCM Reviews on the same programme each have their own
        occurrence due at once -- the system must not guess which one the
        learner meant."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.template(name='Monthly Coaching (second stream)', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        day = bookable_day(20)

        response = self.learner_requests_generic('mcr', day, expect_status=409)
        self.assertIn('More than one', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_generic_request_does_not_confuse_many_future_dates_of_one_template_for_ambiguity(self):
        """A single Review recurs many times across the enrolment window --
        that must resolve unambiguously to the soonest one, not be rejected."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        day = bookable_day(20)
        self.learner_requests_generic('mcr', day, expect_status=(200, 201))
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)


class CoachSchedulingGuardTests(DirectRequestHelpersMixin):
    """coach_timetable_schedule_event must not reach status=scheduled for a
    review-driven event unless canonical linkage is guaranteed.

    Once a Review template is archived, Curriculum stops generating its
    occurrences at all -- so a NOT-yet-stored occurrence whose template gets
    archived simply disappears from the coach's generated timetable before
    anyone can schedule it (a 404 "not found", not a 409). That is itself
    already a correct outcome of the invariant: no unlinked row is ever
    created either way. The 409-producing guard added to
    ensure_review_instance_for_calendar_record / require_review_template_for_
    first_linkage is exercised directly below, at the point where it actually
    runs: an already-*persisted* (but not yet linked) row being scheduled
    while its template is unavailable.
    """

    def test_coach_cannot_schedule_mcm_once_its_template_is_archived_before_first_linkage(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        reviews.archive_review(template['id'], actor='test')

        request = self.factory.post(
            '/coach_api/coach/timetable/events/schedule',
            data=json.dumps({
                'eventKey': occurrence['eventKey'], 'scheduledDate': bookable_day(20).isoformat(),
                'scheduledTime': '10:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(coach_views.coach_timetable_schedule_event)(request),
        )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=occurrence['eventKey']).exists())

    def test_coach_cannot_schedule_progress_review_once_its_template_is_archived_before_first_linkage(self):
        template = self.template(
            name='Quarterly Progress Conversation',
            type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8,
        )
        occurrence = self.coach_occurrence('progress-review')
        reviews.archive_review(template['id'], actor='test')

        request = self.factory.post(
            '/coach_api/coach/timetable/events/schedule',
            data=json.dumps({
                'eventKey': occurrence['eventKey'], 'scheduledDate': bookable_day(20).isoformat(),
                'scheduledTime': '10:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(coach_views.coach_timetable_schedule_event)(request),
        )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=occurrence['eventKey']).exists())

    def test_ensure_review_instance_raises_instead_of_leaving_a_scheduled_unlinked_row(self):
        """Direct unit coverage of the guard itself: a review-driven row that
        is ALREADY persisted (review_template_id set) but not yet linked
        (review_instance_id still blank) -- e.g. scheduled the instant before
        its template was archived -- must raise rather than silently return,
        so a caller can never mistake a no-op for a successful link."""
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        record = CoachCalendarEvent.objects.create(
            event_key=occurrence['eventKey'], event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach One',
            learner_id=MIRROR_ID, learner_name='Test Learner', learner_email='learner@example.com',
            target_date=bookable_day(20), status=CoachCalendarEvent.STATUS_SCHEDULED,
            scheduled_date=bookable_day(20), scheduled_time=time(10, 0), duration_minutes=60,
            review_template_id=template['id'], occurrence_number=occurrence['occurrenceNumber'],
        )
        reviews.archive_review(template['id'], actor='test')

        with self.assertRaises(coach_views.ReviewTemplateUnavailableError):
            coach_views.ensure_review_instance_for_calendar_record(record, occurrence)

        record.refresh_from_db()
        self.assertFalse(record.review_instance_id)
        with self.assertRaises(coach_views.ReviewTemplateUnavailableError):
            coach_views.require_review_template_for_first_linkage(template['id'])

    def test_learner_generated_slot_booking_also_blocked_when_template_missing(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        reviews.archive_review(template['id'], actor='test')

        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'mcr', 'eventKey': occurrence['eventKey'],
                'scheduledDate': bookable_day(20).isoformat(), 'scheduledTime': '10:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(learner_calendar.learner_calendar_book)(
                request, 'commercial', self.learner.pk,
            ),
        )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=occurrence['eventKey']).exists())


class AlreadyLinkedTemplateArchivedTests(DirectRequestHelpersMixin):
    def test_already_linked_review_survives_its_template_being_archived_later(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        instance_id = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id
        self.assertTrue(instance_id)

        reviews.archive_review(template['id'], actor='test')

        # Rescheduling an already-linked row must not re-check the template.
        # (fetch_standalone_event_records is left un-mocked here so the
        # already-persisted, already-scheduled row is found for real --
        # the shared harness's blanket empty-list mock would otherwise hide
        # it too, which is a harness simplification, not real behaviour.)
        self.coach_schedules_with_real_standalone_records(occurrence['eventKey'], bookable_day(40), '15:00')
        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        self.assertEqual(record.review_instance_id, instance_id)
        self.assertEqual(record.review_template_id, template['id'])
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual(record.scheduled_date, bookable_day(40))

        self.learner_reschedules(occurrence['eventKey'], bookable_day(55), '09:30')
        record.refresh_from_db()
        self.assertEqual(record.review_instance_id, instance_id)
        self.assertEqual(record.scheduled_date, bookable_day(55))


class NonReviewBookingUnaffectedTests(DirectRequestHelpersMixin):
    def test_catch_up_booking_is_unaffected_by_the_review_linkage_guard(self):
        day = bookable_day(20)
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'catch-up',
                'scheduledDate': day.isoformat(), 'scheduledTime': '10:00', 'durationMinutes': 30,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(learner_calendar.learner_calendar_book)(
                request, 'commercial', self.learner.pk,
            ),
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        body = json.loads(response.content.decode())
        self.assertTrue(body.get('approvalRequired'))
        record = CoachCalendarEvent.objects.get(event_type='catch-up')
        self.assertFalse(record.review_template_id)
        self.assertFalse(record.review_instance_id)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_NOT_SCHEDULED)


class LegacyUnlinkedRowsUntouchedTests(DirectRequestHelpersMixin):
    def test_legacy_unlinked_row_is_not_silently_linked_or_modified(self):
        """A pre-existing unlinked mcr row (the historical bug's output) must
        not be auto-linked by this change -- that is a separate, explicit
        backfill decision, not something scheduling code does implicitly."""
        legacy = CoachCalendarEvent.objects.create(
            event_key='mcr:{}:1:2026-01-01'.format(MIRROR_ID), event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach One',
            learner_id=MIRROR_ID, learner_name='Test Learner', learner_email='learner@example.com',
            target_date=bookable_day(1), status=CoachCalendarEvent.STATUS_NOT_SCHEDULED,
            idempotency_key='learner-book:legacy-direct-request',
        )
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)

        legacy.refresh_from_db()
        self.assertFalse(legacy.review_template_id)
        self.assertFalse(legacy.review_instance_id)

        # A fresh generic request must resolve the CURRENT official occurrence
        # rather than touching or reusing the old unlinked row.
        response = self.learner_requests_generic('mcr', bookable_day(20))
        body = json.loads(response.content.decode())
        legacy.refresh_from_db()
        self.assertFalse(legacy.review_template_id)
        self.assertFalse(legacy.review_instance_id)
        self.assertNotEqual(body['event']['eventKey'], legacy.event_key)
        new_record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertTrue(new_record.review_template_id)
        self.assertTrue(new_record.review_instance_id)
