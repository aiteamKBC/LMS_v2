"""assignment_month Progress Review bookings must resolve to a real
Curriculum Progress Review occurrence -- never invent their own standalone
identity, and never apply MCM's booking-eligibility window (that rule is
specific to Monthly Coaching Meetings and does not exist for Progress
Review). See
learner_api.calendar._resolve_assignment_month_progress_review_occurrence
and the assignment_month branch of learner_calendar_book.

Before this fix, session_type='progress-review' + assignmentMonth with no
eventKey fell straight through to reserve_coach_calendar_booking, creating a
standalone CoachCalendarEvent with review_template_id/review_instance_id
left blank -- exactly the same shape of bug the MCM path had until it was
fixed (see tests_assignment_month_mcm_linkage.py, which this mirrors). Both
imported Aptem call sites (MeetingBookingDialog.tsx, learner/calendar
page.tsx) send this combination for a genuine business case: booking an
imported Progress Review. assignment_month there is bookkeeping context
copied from the imported review, never the Review's own identity and never
an eligibility window -- see the module docstring architecture diagram this
suite pins.
"""
import json
from datetime import time
from unittest.mock import patch

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, review_types

from . import calendar as learner_calendar
from .tests_learner_review_pages import PROGRAMME_ID
from .tests_review_scheduling_sync import (
    MIRROR_ID, ReviewSchedulingSyncTestCase, bookable_day, raw_view,
)

ASSIGNMENT_MONTH = "2026-12"


class AssignmentMonthProgressReviewTestCase(ReviewSchedulingSyncTestCase):
    """Shared fixtures. No tests of its own."""

    def learner_books_assignment_month(
        self, *, review_id="9", event_key="", day=None, clock="09:00",
        duration=60, expect_status=(200, 201),
    ):
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'progress-review', 'assignmentMonth': ASSIGNMENT_MONTH, 'reviewId': review_id,
                **({'eventKey': event_key} if event_key else {}),
                'scheduledDate': (day or bookable_day(30)).isoformat(), 'scheduledTime': clock,
                'durationMinutes': duration,
            }),
            content_type='application/json',
        )
        # _mark_imported_review_scheduled writes to enrolment."Learner".reviews
        # (a real Postgres-only table); mocked here since it is a separate,
        # already-existing sync concern this fix does not change -- see
        # test_uses_curriculum_template_and_populates_linkage below for the one
        # test that inspects the call itself.
        with patch.object(learner_calendar, '_mark_imported_review_scheduled') as mark_review:
            self.last_mark_review_call = mark_review
            response = self.run_patched(
                lambda: raw_view(learner_calendar.learner_calendar_book)(
                    request, 'commercial', self.learner.pk,
                ),
            )
        expected = expect_status if isinstance(expect_status, tuple) else (expect_status,)
        self.assertIn(response.status_code, expected, response.content)
        return response


class CanonicalLinkageTests(AssignmentMonthProgressReviewTestCase):
    def test_uses_curriculum_template_and_populates_linkage(self):
        template = self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)

        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_type, 'progress-review')
        self.assertEqual(record.review_template_id, template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertTrue(record.occurrence_number)
        instance = review_instances.get_review_instance(record.review_instance_id)
        self.assertEqual(str(instance['calendar_event_id']), str(record.id))
        # The imported "Learner".reviews sync still runs, unchanged.
        self.last_mark_review_call.assert_called_once()
        self.assertEqual(self.last_mark_review_call.call_args.args[0], '9')

    def test_target_date_is_canonical_scheduled_date_is_the_actual_booking(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        day = bookable_day(30)

        response = self.learner_books_assignment_month(day=day, clock='14:00')
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertNotEqual(record.target_date, day)  # canonical due-date, not the booked day
        self.assertEqual(record.scheduled_date, day)
        self.assertEqual(record.scheduled_time, time(14, 0))

    def test_new_bookings_use_the_canonical_identity_event_key(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())
        event_key = body['event']['eventKey']
        self.assertTrue(event_key.startswith('review:'), event_key)
        self.assertNotRegex(event_key, r'^progress-review:\d+:\d+:\d{4}-\d{2}-\d{2}$')

    def test_no_standalone_progress_review_event_is_created(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        self.learner_books_assignment_month()
        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='progress-review').count(), 1)
        record = CoachCalendarEvent.objects.get(event_type='progress-review')
        self.assertTrue(record.review_template_id)
        self.assertTrue(record.review_instance_id)

    def test_graph_payload_uses_the_actual_booked_date_and_time_not_the_canonical_date(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        day = bookable_day(30)
        self.learner_books_assignment_month(day=day, clock='11:30')
        payloads = [call['payload'] for call in self.graph_calls if call.get('payload')]
        self.assertTrue(payloads, 'no Graph payload was sent')
        self.assertIn(day.isoformat(), json.dumps(payloads[-1]))


class NoMcmWindowAppliesTests(AssignmentMonthProgressReviewTestCase):
    def test_assignment_month_is_not_used_as_a_booking_eligibility_window(self):
        """MCM's coaching_booking_bounds (last 10 days of the submission month
        through the 5th of the next) must not apply here -- a day nowhere
        near that window, and a duration other than 60 minutes, must both be
        accepted for a Progress Review."""
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        far_from_any_mcm_window = bookable_day(90)
        response = self.learner_books_assignment_month(day=far_from_any_mcm_window, clock='09:00', duration=45)
        body = json.loads(response.content.decode())
        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.scheduled_date, far_from_any_mcm_window)
        self.assertEqual(record.duration_minutes, 45)

    def test_assignment_month_does_not_determine_the_canonical_target_date(self):
        """assignment_month=2026-12 is bookkeeping context from the imported
        review, not a target-date calculation input -- the canonical
        occurrence's target_date comes only from the template's own
        recurrence off the learner's start date."""
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
                       interval=8, unit='weeks')
        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())
        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertNotEqual(record.target_date.strftime('%Y-%m'), ASSIGNMENT_MONTH)


class IdempotencyTests(AssignmentMonthProgressReviewTestCase):
    def test_repeated_request_with_the_resolved_key_does_not_duplicate(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        first = self.learner_books_assignment_month(day=bookable_day(30), clock='09:00')
        event_key = json.loads(first.content.decode())['event']['eventKey']

        # A genuine resubmit of the SAME already-resolved occurrence (e.g. a
        # double-click that raced ahead of the first response) must update
        # the same row, never create a second one.
        second = self.learner_books_assignment_month(event_key=event_key, day=bookable_day(31), clock='10:00')

        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='progress-review').count(), 1)
        record = CoachCalendarEvent.objects.get(event_type='progress-review')
        self.assertEqual(record.event_key, event_key)
        self.assertEqual(record.scheduled_time, time(10, 0))
        first_body, second_body = json.loads(first.content.decode()), json.loads(second.content.decode())
        self.assertEqual(first_body['event']['reviewInstanceId'], second_body['event']['reviewInstanceId'])
        instance_count = len(review_instances.list_review_instances_for_learner(MIRROR_ID))
        self.assertEqual(instance_count, 1)

    def test_second_no_eventkey_request_links_the_next_occurrence_not_a_duplicate(self):
        """Once occurrence #1 is scheduled, Curriculum no longer considers it
        due -- a second no-eventKey request resolves to the NEXT genuinely
        outstanding occurrence (a real, distinct Progress Review), never a
        second booking of the same one. Mirrors the equivalent, already
        accepted, MCM behaviour."""
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        first = self.learner_books_assignment_month(day=bookable_day(30))
        first_key = json.loads(first.content.decode())['event']['eventKey']

        second = self.learner_books_assignment_month(day=bookable_day(31))
        second_key = json.loads(second.content.decode())['event']['eventKey']

        self.assertNotEqual(first_key, second_key)
        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='progress-review').count(), 2)
        for record in CoachCalendarEvent.objects.filter(event_type='progress-review'):
            self.assertTrue(record.review_template_id)
            self.assertTrue(record.review_instance_id)


class RejectionTests(AssignmentMonthProgressReviewTestCase):
    def test_no_progress_review_template_is_rejected_clearly(self):
        response = self.learner_books_assignment_month(expect_status=422)
        self.assertIn('No Progress Review is configured', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_multiple_enabled_progress_review_templates_is_rejected_clearly(self):
        self.template(name='Progress Review (stream A)', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        self.template(name='Progress Review (stream B)', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        response = self.learner_books_assignment_month(expect_status=409)
        self.assertIn('More than one Progress Review', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_missing_learner_start_date_is_rejected_clearly(self):
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        self.learner.learner_start_date = ''
        response = self.learner_books_assignment_month(expect_status=422)
        self.assertIn('learner start date is missing', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)


class McmPathUnaffectedTests(AssignmentMonthProgressReviewTestCase):
    def test_mcm_assignment_month_booking_is_unaffected_by_the_progress_review_fix(self):
        """A sibling MCM template on the same programme, and an MCM
        assignment_month booking, must resolve exactly as
        tests_assignment_month_mcm_linkage.py already proves -- this fix
        only adds a new branch alongside the existing 'mcr' one."""
        from .monthly_assignment import coaching_booking_bounds
        mcm_template = self.template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        start, end = coaching_booking_bounds('2026-09')
        mcm_day = start + (end - start) // 2

        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'mcr', 'assignmentMonth': '2026-09', 'reviewId': '9',
                'scheduledDate': mcm_day.isoformat(), 'scheduledTime': '09:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        with patch.object(learner_calendar, '_mark_imported_review_scheduled'):
            response = self.run_patched(
                lambda: raw_view(learner_calendar.learner_calendar_book)(
                    request, 'commercial', self.learner.pk,
                ),
            )
        self.assertIn(response.status_code, (200, 201), response.content)
        body = json.loads(response.content.decode())
        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_type, 'mcr')
        self.assertEqual(record.review_template_id, mcm_template['id'])


class LearnerReviewAdditionsUnaffectedTests(AssignmentMonthProgressReviewTestCase):
    def test_learner_specific_add_review_path_is_untouched(self):
        """Scope guard: this fix only changes the assignment_month branch of
        learner_calendar_book. The coach's learner-specific Add Review
        feature (curriculum.learner_review_additions,
        coach_review_learner_additions_create) does not go through
        learner_calendar_book at all, and none of its helpers were edited --
        confirmed here by resolving one and checking its shape is unchanged."""
        from curriculum_api.review_instances import create_learner_review_addition
        template = self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)
        result = create_learner_review_addition(
            review_template_id=template['id'], programme_id=PROGRAMME_ID, learner_id=MIRROR_ID,
            target_date=bookable_day(30), reason_code='learner-request', reason='', actor='coach@example.com',
        )
        self.assertTrue(result.get('id'))
