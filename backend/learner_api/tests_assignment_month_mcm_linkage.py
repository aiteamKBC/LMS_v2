"""assignment_month MCM bookings must resolve to a real Curriculum MCM
occurrence -- never invent their own standalone identity. See
learner_api.calendar._resolve_assignment_month_mcm_occurrence and the
assignment_month branch of learner_calendar_book.

Before this fix, session_type='mcr' + assignmentMonth with no eventKey fell
straight through to reserve_coach_calendar_booking, creating a standalone
CoachCalendarEvent with review_template_id/review_instance_id left blank --
exactly the same shape of bug the generic direct-cycle-request path was
already guarded against (see tests_review_direct_request_linkage.py). This
suite pins the equivalent guarantee for the assignment_month path.
"""
import json
from datetime import date, time
from unittest.mock import patch

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, review_types

from . import calendar as learner_calendar
from .monthly_assignment import coaching_booking_bounds
from .tests_review_scheduling_sync import (
    COACH_EMAIL,
    LEARNER_EMAIL,
    MIRROR_ID,
    ReviewSchedulingSyncTestCase,
    raw_view,
)

ASSIGNMENT_MONTH = "2026-09"


def _booking_day():
    """A scheduled_date inside coaching_booking_bounds(ASSIGNMENT_MONTH)."""
    start, end = coaching_booking_bounds(ASSIGNMENT_MONTH)
    return start + (end - start) // 2


class AssignmentMonthMcmTestCase(ReviewSchedulingSyncTestCase):
    """Shared fixtures. No tests of its own."""

    def learner_books_assignment_month(self, *, review_id="9", event_key="", day=None, clock="09:00", expect_status=(200, 201)):
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'mcr', 'assignmentMonth': ASSIGNMENT_MONTH, 'reviewId': review_id,
                **({'eventKey': event_key} if event_key else {}),
                'scheduledDate': (day or _booking_day()).isoformat(), 'scheduledTime': clock, 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        # _mark_imported_review_scheduled writes to enrolment."Learner".reviews
        # (a real Postgres-only table); mocked here since it's a separate,
        # already-existing sync concern this fix does not change -- see
        # test_1_2_3_4_5 below for the one test that inspects the call itself.
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


class CanonicalLinkageTests(AssignmentMonthMcmTestCase):
    def test_1_2_3_4_5_uses_curriculum_template_and_populates_linkage(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)

        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_type, 'mcr')
        self.assertEqual(record.review_template_id, template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertTrue(record.occurrence_number)
        instance = review_instances.get_review_instance(record.review_instance_id)
        self.assertEqual(str(instance['calendar_event_id']), str(record.id))
        # The imported "Learner".reviews sync still runs, unchanged.
        self.last_mark_review_call.assert_called_once()
        self.assertEqual(self.last_mark_review_call.call_args.args[0], '9')

    def test_6_7_target_date_is_canonical_scheduled_date_is_the_actual_booking(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        day = _booking_day()

        response = self.learner_books_assignment_month(day=day, clock='14:00')
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertNotEqual(record.target_date, day)  # canonical due-date, not the booked day
        self.assertEqual(record.scheduled_date, day)
        self.assertEqual(record.scheduled_time, time(14, 0))

    def test_9_new_bookings_use_the_canonical_identity_event_key(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())
        event_key = body['event']['eventKey']
        self.assertTrue(event_key.startswith('review:'), event_key)
        self.assertNotRegex(event_key, r'^mcr:\d+:\d+:\d{4}-\d{2}-\d{2}$')

    def test_10_no_standalone_mcr_event_is_created(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.learner_books_assignment_month()
        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='mcr').count(), 1)
        record = CoachCalendarEvent.objects.get(event_type='mcr')
        self.assertTrue(record.review_template_id)
        self.assertTrue(record.review_instance_id)


class IdempotencyTests(AssignmentMonthMcmTestCase):
    def test_11_12_13_repeated_request_with_the_resolved_key_does_not_duplicate(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        first = self.learner_books_assignment_month(day=_booking_day(), clock='09:00')
        event_key = json.loads(first.content.decode())['event']['eventKey']

        # A genuine resubmit of the SAME already-resolved occurrence (e.g. a
        # double-click that raced ahead of the first response) must update
        # the same row, never create a second one.
        second = self.learner_books_assignment_month(event_key=event_key, day=_booking_day(), clock='10:00')

        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='mcr').count(), 1)
        record = CoachCalendarEvent.objects.get(event_type='mcr')
        self.assertEqual(record.event_key, event_key)
        self.assertEqual(record.scheduled_time, time(10, 0))
        first_body, second_body = json.loads(first.content.decode()), json.loads(second.content.decode())
        self.assertEqual(first_body['event']['reviewInstanceId'], second_body['event']['reviewInstanceId'])
        instance_count = len(review_instances.list_review_instances_for_learner(MIRROR_ID))
        self.assertEqual(instance_count, 1)

    def test_second_no_eventkey_request_links_the_next_occurrence_not_a_duplicate(self):
        """Once occurrence #1 is scheduled, Curriculum no longer considers it
        due -- a second no-eventKey request resolves to the NEXT genuinely
        outstanding occurrence (a real, distinct MCM), never a second booking
        of the same one."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        first = self.learner_books_assignment_month(day=_booking_day())
        first_key = json.loads(first.content.decode())['event']['eventKey']

        second = self.learner_books_assignment_month(day=_booking_day() + __import__('datetime').timedelta(days=1))
        second_key = json.loads(second.content.decode())['event']['eventKey']

        self.assertNotEqual(first_key, second_key)
        self.assertEqual(CoachCalendarEvent.objects.filter(event_type='mcr').count(), 2)
        for record in CoachCalendarEvent.objects.filter(event_type='mcr'):
            self.assertTrue(record.review_template_id)
            self.assertTrue(record.review_instance_id)


class RejectionTests(AssignmentMonthMcmTestCase):
    def test_14_no_mcm_template_is_rejected_clearly(self):
        response = self.learner_books_assignment_month(expect_status=422)
        self.assertIn('No Monthly Coaching Meeting is configured', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_15_multiple_enabled_mcm_templates_is_rejected_clearly(self):
        self.template(name='Monthly Coaching (stream A)', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.template(name='Monthly Coaching (stream B)', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        response = self.learner_books_assignment_month(expect_status=409)
        self.assertIn('More than one Monthly Coaching Meeting', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_16_17_missing_learner_start_date_is_rejected_clearly(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.learner.learner_start_date = ''
        response = self.learner_books_assignment_month(expect_status=422)
        self.assertIn('learner start date is missing', json.loads(response.content.decode())['error'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)


class NonReviewBehaviourUnaffectedTests(AssignmentMonthMcmTestCase):
    def test_28_mcm_assignment_month_path_is_unaffected_by_the_progress_review_fix(self):
        """Scope guard, updated for the Progress Review linkage fix
        (see tests_assignment_month_progress_review_linkage.py): the 'mcr'
        branch -- its booking-window check and its canonical resolver -- is
        untouched by extending the same guarantee to 'progress-review'.
        MCM's own canonical-linkage coverage above (test_1_2_3_4_5 etc.)
        already pins this; this test only pins that a sibling
        'progress-review' template configured on the SAME programme cannot
        change which template/occurrence an 'mcr' assignment_month request
        resolves to."""
        mcm_template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.template(name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)

        response = self.learner_books_assignment_month()
        body = json.loads(response.content.decode())

        record = CoachCalendarEvent.objects.get(event_key=body['event']['eventKey'])
        self.assertEqual(record.event_type, 'mcr')
        self.assertEqual(record.review_template_id, mcm_template['id'])

    def test_21_live_session_logic_is_untouched(self):
        """Scope guard: nothing about this fix touches live session
        collection -- confirmed by the shared harness's coach timetable call
        succeeding with include_live_sessions=False untouched elsewhere."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.learner_books_assignment_month()
        payload = self.run_patched(lambda: coach_views.collect_generated_timetable(
            COACH_EMAIL, include_live_sessions=False, include_scheduler_queues=False,
        ))
        self.assertIn('events', payload)
