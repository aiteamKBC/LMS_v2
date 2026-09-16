"""Coach and Learner schedule the SAME Review occurrence, not two of them.

    Curriculum generated occurrence
        -> one CoachCalendarEvent (identity: event_key)
        -> one review_instance   (identity: template + learner + occurrence)
        -> Coach UI + Learner UI

Both sides write the same row through the same helpers, so whichever side
schedules, reschedules or cancels, the other sees that exact state. Nothing
here asserts "both use CoachCalendarEvent" and stops: every test drives the
real endpoints and then re-reads the OTHER side's calendar composition.

MCM, Progress Review and a custom Review Type all go through one path -- there
is no per-Review-type scheduling code to test separately, which is itself one
of the things asserted below.
"""
import json
from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory
from django.utils import timezone

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, review_types, reviews

from . import calendar as learner_calendar
from .booking_calendar import booking_date_restriction
from .tests_learner_review_pages import LearnerReviewPageTestCase, LEARNER_START, PROGRAMME_ID

MIRROR_ID = 248
COACH_EMAIL = 'coach@example.com'
LEARNER_EMAIL = 'learner@example.com'
OTHER_COACH_EMAIL = 'other-coach@example.com'

GRAPH_EVENT_ID = 'GRAPH-EVENT-1'
GRAPH_JOIN_URL = 'https://teams.example/join/1'
GRAPH_WEB_LINK = 'https://teams.example/event/1'


def raw_view(view):
    """The view function itself, past its auth/CSRF decorators.

    Authorization is not bypassed by ignoring it here -- it is asserted
    directly, on the ownership scopes that actually enforce it, in
    StrictAnchorAndOwnershipTests below.
    """
    while hasattr(view, '__wrapped__'):
        view = view.__wrapped__
    return view


def bookable_day(offset_days):
    """A date the booking rules actually accept: future, weekday, not a bank
    holiday. Computed rather than hard-coded so the suite does not rot."""
    day = timezone.localdate() + timedelta(days=offset_days)
    while booking_date_restriction(day) is not None:
        day += timedelta(days=1)
    return day


def enrolment_row():
    return SimpleNamespace(
        id=101, pk=101, email=LEARNER_EMAIL, username='Test Learner',
        learner_type='commercial',
        # learner_start_date is the Review recurrence anchor (see
        # coach_api.views.resolve_review_anchor_date); start_date is kept too
        # since resolve_schedule_window's WINDOW bound still reads it.
        learner_start_date=LEARNER_START.isoformat(), start_date=LEARNER_START.isoformat(),
        end_date='2027-08-09', practical_period_end_date='', apprenticeship_end_date='',
    )


def profile_row():
    return SimpleNamespace(
        id=MIRROR_ID, pk=MIRROR_ID, email=LEARNER_EMAIL, username='Test Learner',
        full_name='Test Learner', start_date=date(2026, 8, 3), end_date=date(2027, 8, 2),
        coach_name='Coach One', coach_email=COACH_EMAIL,
        programme='Review Pages Programme', programme_status='Active',
        cohort='Cohort A', group_name='Group A', learner_type='commercial',
        enrolment_id='101',
    )


class FakeManager:
    def __init__(self, row):
        self._row = row

    def filter(self, **kwargs):
        pk = kwargs.get('pk')
        return SimpleNamespace(first=lambda: self._row if str(pk) == str(self._row.pk) else None)


class ReviewSchedulingSyncTestCase(LearnerReviewPageTestCase):
    """Shared harness. No tests of its own."""

    def setUp(self):
        super().setUp()
        review_instances.provision_review_instance_tables()
        CoachCalendarEvent.objects.all().delete()
        self.factory = RequestFactory()
        self.learner = enrolment_row()
        self.mirror = profile_row()
        self.graph_calls = []

    # ------------------------------------------------------------- fixtures

    def template(self, *, name, type_code=None, type_name=None, interval=4, unit='weeks'):
        if type_code:
            review_type_id = review_types.get_review_type_by_code(type_code)['id']
        else:
            type_row, errors = review_types.create_review_type(type_name, actor='test')
            self.assertIsNone(errors, errors)
            review_type_id = type_row['id']
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name, 'enabled': True, 'reviewTypeId': review_type_id,
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01', 'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id)

    # -------------------------------------------------------------- patches

    def _graph_request(self, method, path, payload=None, **_kwargs):
        self.graph_calls.append({'method': method, 'path': path, 'payload': payload})
        if method == 'DELETE':
            return {}
        return {
            'id': GRAPH_EVENT_ID,
            'webLink': GRAPH_WEB_LINK,
            'onlineMeeting': {'joinUrl': GRAPH_JOIN_URL},
        }

    def patches(self, *, coach_email=COACH_EMAIL):
        """Everything outside the scheduling architecture itself: the caseload
        read, the enrolment lookup and Microsoft Graph. The real
        build_graph_event_payload / graph_organizer_mailbox still run, so the
        payload each side sends is a genuine observation."""
        return [
            patch.object(coach_views, 'fetch_owner_active_learner_profiles',
                         side_effect=lambda email: [self.mirror] if email == COACH_EMAIL else []),
            patch.object(coach_views, 'fetch_source_schedule_rows',
                         return_value=({MIRROR_ID: self.learner}, {})),
            patch.object(coach_views, 'coach_staff_display_name', return_value='Coach One'),
            patch.object(coach_views, 'build_learner_profile_map', return_value={MIRROR_ID: self.mirror}),
            patch.object(coach_views, 'fetch_standalone_event_records', return_value=[]),
            patch.object(coach_views, 'learner_employer_attendee',
                         return_value={'name': 'Acme Ltd', 'email': 'employer@example.com'}),
            patch.object(coach_views, 'has_graph_credentials', return_value=True),
            patch.object(coach_views, 'microsoft_graph_request', side_effect=self._graph_request),
            patch.object(coach_views, 'authenticated_coach_email', return_value=coach_email),
            patch.object(learner_calendar, 'SOURCE_MODELS',
                         {'commercial': SimpleNamespace(all_learners=FakeManager(self.learner))}),
            patch.object(learner_calendar, 'learner_profile_for_source', return_value=self.mirror),
            patch.object(learner_calendar, '_record_enrolment_review', return_value=None),
            patch.object(learner_calendar, '_cancel_enrolment_review', return_value=None),
        ]

    def __enter_patches(self, patchers):
        for patcher in patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def run_patched(self, fn, *, coach_email=COACH_EMAIL):
        patchers = self.patches(coach_email=coach_email)
        for patcher in patchers:
            patcher.start()
        try:
            with patch('learner_api.calendar_connections.booking_conflicts', return_value=False):
                return fn()
        finally:
            for patcher in reversed(patchers):
                patcher.stop()

    # ------------------------------------------------------------- the sides

    def coach_occurrence(self, source):
        """The first generated (unscheduled) occurrence on the Coach timetable."""
        payload = self.run_patched(lambda: coach_views.collect_generated_timetable(
            COACH_EMAIL, include_live_sessions=False, include_scheduler_queues=False,
        ))
        rows = sorted(
            (event for event in payload['events'] if event['source'] == source),
            key=lambda event: event['targetDate'],
        )
        self.assertTrue(rows, f'no generated {source} occurrence on the coach timetable')
        return rows[0]

    def coach_events(self):
        payload = self.run_patched(lambda: coach_views.collect_generated_timetable(
            COACH_EMAIL, include_live_sessions=False, include_scheduler_queues=False,
        ))
        return {event['eventKey']: event for event in payload['events']}

    def learner_events(self):
        """What the learner calendar, Monthly Coaching page and Progress Review
        page all render -- stored rows laid over the generated cycle."""
        events = self.run_patched(
            lambda: learner_calendar.coaching_events_for_learner(self.learner, self.mirror),
        )
        return {event['eventKey']: event for event in events}

    # ------------------------------------------------------------ the actions

    def coach_schedules(self, event_key, day, clock='10:00', expect_status=200):
        request = self.factory.post(
            '/coach_api/coach/timetable/events/schedule',
            data=json.dumps({
                'eventKey': event_key, 'scheduledDate': day.isoformat(),
                'scheduledTime': clock, 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(coach_views.coach_timetable_schedule_event)(request),
        )
        self.assertEqual(response.status_code, expect_status, response.content)
        return json.loads(response.content.decode())

    def learner_schedules(self, event_key, session_type, day, clock='10:00', expect_status=(200, 201)):
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': session_type, 'eventKey': event_key,
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
        return json.loads(response.content.decode())

    def learner_reschedules(self, event_key, day, clock):
        request = self.factory.patch(
            f'/learner_api/calendar/commercial/{self.learner.pk}/reschedule/',
            data=json.dumps({
                'eventKey': event_key, 'scheduledDate': day.isoformat(),
                'scheduledTime': clock, 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(learner_calendar.learner_calendar_reschedule)(
                request, 'commercial', self.learner.pk,
            ),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content.decode())

    def learner_cancels(self, event_key):
        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/cancel/',
            data=json.dumps({'eventKey': event_key}),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(learner_calendar.learner_calendar_cancel)(
                request, 'commercial', self.learner.pk,
            ),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content.decode())

    def coach_cancels(self, event_key):
        request = self.factory.post(
            '/coach_api/coach/timetable/events/action',
            data=json.dumps({'eventKey': event_key, 'action': 'cancel'}),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(coach_views.coach_timetable_event_action)(request),
        )
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content.decode())

    # ------------------------------------------------------------ assertions

    def assert_both_sides_agree(self, event_key, *, status, day, clock):
        """The heart of it: one occurrence, one state, read from both sides."""
        coach_event = self.coach_events().get(event_key)
        learner_event = self.learner_events().get(event_key)
        self.assertIsNotNone(coach_event, 'the Coach timetable lost the occurrence')
        self.assertIsNotNone(learner_event, 'the Learner calendar lost the occurrence')

        self.assertEqual(coach_event['status'], status)
        self.assertEqual(learner_event['status'], status)
        self.assertEqual(coach_event['scheduledDate'], day.isoformat() if day else None)
        self.assertEqual(learner_event['scheduledDate'], day.isoformat() if day else None)
        self.assertEqual(coach_event['scheduledTime'], clock)
        self.assertEqual(learner_event['scheduledTime'], clock)
        # Same durable identity, same Review, same instance, same meeting.
        self.assertEqual(coach_event['eventKey'], learner_event['eventKey'])
        self.assertEqual(coach_event['reviewTemplateId'], learner_event['reviewTemplateId'])
        self.assertEqual(coach_event['occurrenceNumber'], learner_event['occurrenceNumber'])
        self.assertEqual(coach_event['reviewInstanceId'], learner_event['reviewInstanceId'])
        self.assertEqual(coach_event['reviewTypeCode'], learner_event['reviewTypeCode'])
        self.assertEqual(coach_event['title'], learner_event['title'])
        self.assertEqual(coach_event['meetingLink'], learner_event['meetingLink'])
        return coach_event, learner_event

    def assert_one_occurrence(self, event_key, source):
        """E: the persisted row must SUPPRESS the generated occurrence, not sit
        beside it."""
        coach_rows = [e for e in self.coach_events().values() if e['source'] == source]
        learner_rows = [e for e in self.learner_events().values() if e['source'] == source]
        self.assertEqual(
            [e['eventKey'] for e in coach_rows].count(event_key), 1,
            'the Coach timetable shows the same occurrence twice',
        )
        self.assertEqual(
            [e['eventKey'] for e in learner_rows].count(event_key), 1,
            'the Learner calendar shows the same occurrence twice',
        )
        self.assertEqual(CoachCalendarEvent.objects.filter(event_key=event_key).count(), 1)

    def graph_payloads(self):
        return [call['payload'] for call in self.graph_calls if call['payload']]


class CoachToLearnerTests(ReviewSchedulingSyncTestCase):
    def test_1_coach_schedules_mcm_learner_sees_the_same_event(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        day = bookable_day(20)

        self.coach_schedules(occurrence['eventKey'], day)

        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        self.assertEqual(record.learner_id, MIRROR_ID)
        self.assertEqual(record.owner_email, COACH_EMAIL)
        self.assertEqual(record.review_template_id, template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertEqual(record.occurrence_number, occurrence['occurrenceNumber'])
        self.assertEqual(record.target_date.isoformat(), occurrence['targetDate'])
        self.assertEqual(record.scheduled_date, day)
        self.assertEqual(record.scheduled_time, time(10, 0))
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual(record.graph_event_id, GRAPH_EVENT_ID)

        coach_event, _learner = self.assert_both_sides_agree(
            occurrence['eventKey'], status='scheduled', day=day, clock='10:00',
        )
        self.assertEqual(coach_event['reviewInstanceId'], record.review_instance_id)
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')

    def test_3_coach_schedules_progress_review_learner_sees_it(self):
        self.template(name='Quarterly Progress Conversation',
                      type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8)
        occurrence = self.coach_occurrence('progress-review')
        day = bookable_day(25)
        self.coach_schedules(occurrence['eventKey'], day, '09:30')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='09:30')
        self.assert_one_occurrence(occurrence['eventKey'], 'progress-review')

    def test_5_coach_schedules_a_custom_review_type_learner_sees_it(self):
        self.template(name='Career Conversation', type_name='Career Review')
        occurrence = self.coach_occurrence('review')
        self.assertNotIn(occurrence['reviewTypeCode'], ('mcm', 'progress_review'))
        day = bookable_day(30)
        self.coach_schedules(occurrence['eventKey'], day, '13:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='13:00')
        self.assert_one_occurrence(occurrence['eventKey'], 'review')


class LearnerToCoachTests(ReviewSchedulingSyncTestCase):
    def test_2_learner_schedules_mcm_coach_sees_the_same_event(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        day = bookable_day(20)

        self.learner_schedules(occurrence['eventKey'], 'mcr', day, '11:00')

        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        # The learner's booking must carry the Curriculum linkage, or the coach
        # would see a booking that is no longer a Review.
        self.assertEqual(record.review_template_id, template['id'])
        self.assertEqual(record.occurrence_number, occurrence['occurrenceNumber'])
        self.assertTrue(record.review_instance_id)
        self.assertEqual(record.target_date.isoformat(), occurrence['targetDate'])
        self.assertEqual(record.owner_email, COACH_EMAIL)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual(record.graph_event_id, GRAPH_EVENT_ID)

        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='11:00')
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')

    def test_4_learner_schedules_progress_review_coach_sees_it(self):
        self.template(name='Quarterly Progress Conversation',
                      type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8)
        occurrence = self.coach_occurrence('progress-review')
        day = bookable_day(25)
        self.learner_schedules(occurrence['eventKey'], 'progress-review', day, '14:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='14:00')
        self.assert_one_occurrence(occurrence['eventKey'], 'progress-review')

    def test_6_learner_schedules_a_custom_review_type_coach_sees_it(self):
        """The custom type must need no scheduling code of its own."""
        self.template(name='Career Conversation', type_name='Career Review')
        occurrence = self.coach_occurrence('review')
        day = bookable_day(30)
        self.learner_schedules(occurrence['eventKey'], 'review', day, '15:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='15:00')
        self.assert_one_occurrence(occurrence['eventKey'], 'review')


class RescheduleSyncTests(ReviewSchedulingSyncTestCase):
    def test_7_coach_reschedules_learner_sees_the_new_slot(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        first, second = bookable_day(20), bookable_day(40)

        self.coach_schedules(occurrence['eventKey'], first, '10:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=first, clock='10:00')

        self.coach_schedules(occurrence['eventKey'], second, '14:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=second, clock='14:00')
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')

    def test_8_learner_reschedules_coach_sees_the_new_slot(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        first, second = bookable_day(20), bookable_day(45)

        self.coach_schedules(occurrence['eventKey'], first, '10:00')
        self.learner_reschedules(occurrence['eventKey'], second, '11:30')

        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=second, clock='11:30')
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')


class CancelSyncTests(ReviewSchedulingSyncTestCase):
    def test_9_coach_cancels_learner_state_matches(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        day = bookable_day(20)
        self.coach_schedules(occurrence['eventKey'], day)
        instance_id = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        self.coach_cancels(occurrence['eventKey'])

        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_NOT_SCHEDULED)
        self.assertIsNone(record.scheduled_date)
        self.assertIsNone(record.scheduled_time)
        # The Review itself survives: the programme still owes it.
        self.assertEqual(record.review_instance_id, instance_id)
        self.assertTrue(review_instances.get_review_instance(instance_id))

        self.assert_both_sides_agree(
            occurrence['eventKey'], status='not-scheduled', day=None, clock=None,
        )
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')

    def test_10_learner_cancels_coach_state_matches(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        day = bookable_day(20)
        self.learner_schedules(occurrence['eventKey'], 'mcr', day, '10:00')
        instance_id = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        self.learner_cancels(occurrence['eventKey'])

        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        # The SAME terminal state the coach's own cancel produces -- the slot is
        # released for rescheduling rather than closed as a cancelled booking.
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_NOT_SCHEDULED)
        self.assertEqual(record.review_instance_id, instance_id)

        self.assert_both_sides_agree(
            occurrence['eventKey'], status='not-scheduled', day=None, clock=None,
        )
        self.assert_one_occurrence(occurrence['eventKey'], 'mcr')

    def test_a_cancelled_review_can_be_scheduled_again_from_either_side(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        self.learner_cancels(occurrence['eventKey'])

        day = bookable_day(50)
        self.coach_schedules(occurrence['eventKey'], day, '09:00')
        self.assert_both_sides_agree(occurrence['eventKey'], status='scheduled', day=day, clock='09:00')


class ReviewInstanceIdentityTests(ReviewSchedulingSyncTestCase):
    def test_12_13_scheduling_from_both_sides_yields_one_instance(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')

        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        first = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        # The learner then moves it, and the coach moves it again. None of that
        # may mint a second instance.
        self.learner_reschedules(occurrence['eventKey'], bookable_day(40), '11:30')
        self.coach_schedules(occurrence['eventKey'], bookable_day(55), '16:00')
        second = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        self.assertEqual(first, second)
        # ...and both sides are handed that same id.
        coach_event, learner_event = self.assert_both_sides_agree(
            occurrence['eventKey'], status='scheduled', day=bookable_day(55), clock='16:00',
        )
        self.assertEqual(coach_event['reviewInstanceId'], first)
        self.assertEqual(learner_event['reviewInstanceId'], first)

        # The documented identity: (template, learner, occurrence number).
        found = review_instances.find_review_instance(
            template['id'], MIRROR_ID, occurrence['occurrenceNumber'],
        )
        self.assertEqual(found['id'], first)

    def test_12_a_learner_booking_after_a_coach_booking_reuses_the_instance(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')

        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        first = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id
        self.learner_schedules(occurrence['eventKey'], 'mcr', bookable_day(35), '10:00')
        second = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        self.assertEqual(first, second)
        self.assertEqual(CoachCalendarEvent.objects.filter(event_key=occurrence['eventKey']).count(), 1)

    def test_14_template_and_occurrence_number_survive_every_write(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')

        for action in (
            lambda: self.coach_schedules(occurrence['eventKey'], bookable_day(20)),
            lambda: self.learner_reschedules(occurrence['eventKey'], bookable_day(35), '12:00'),
            lambda: self.learner_cancels(occurrence['eventKey']),
            lambda: self.coach_schedules(occurrence['eventKey'], bookable_day(50), '09:00'),
        ):
            action()
            record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
            self.assertEqual(record.review_template_id, template['id'])
            self.assertEqual(record.occurrence_number, occurrence['occurrenceNumber'])
            self.assertEqual(record.target_date.isoformat(), occurrence['targetDate'])


class GraphParityTests(ReviewSchedulingSyncTestCase):
    def test_15_both_scheduling_paths_send_the_same_graph_event(self):
        self.template(name='Quarterly Progress Conversation',
                      type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8)
        occurrence = self.coach_occurrence('progress-review')
        day = bookable_day(20)

        self.coach_schedules(occurrence['eventKey'], day, '10:00')
        coach_payload = self.graph_payloads()[-1]
        coach_organizer = self.graph_calls[-1]['path']

        self.graph_calls = []
        self.learner_reschedules(occurrence['eventKey'], bookable_day(35), '10:00')
        learner_payload = self.graph_payloads()[-1]
        learner_organizer = self.graph_calls[-1]['path']

        def attendees(payload):
            return sorted(a['emailAddress']['address'] for a in payload.get('attendees', []))

        # Subject comes from the Review TEMPLATE name on both paths -- this used
        # to fall back to a per-event-type label when the learner rescheduled,
        # silently renaming the Teams meeting.
        self.assertEqual(coach_payload['subject'], learner_payload['subject'])
        self.assertIn('Quarterly Progress Conversation', coach_payload['subject'])
        # Rescheduling preserves the existing attendee list and Teams body.
        self.assertIn('employer@example.com', attendees(coach_payload))
        self.assertIn(LEARNER_EMAIL, attendees(coach_payload))
        self.assertNotIn('attendees', learner_payload)
        # Same organizer mailbox (the coach), same timezone, same meeting type.
        self.assertEqual(coach_organizer, learner_organizer)
        self.assertEqual(coach_payload['start']['timeZone'], learner_payload['start']['timeZone'])
        self.assertNotIn('isOnlineMeeting', learner_payload)
        self.assertNotIn('onlineMeetingProvider', learner_payload)

    def test_17_the_graph_subject_follows_a_template_rename(self):
        """No title matching: the Teams subject is whatever Curriculum calls
        the Review now, not a name any code recognises."""
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        self.assertIn('Monthly Learner Catch-up', self.graph_payloads()[-1]['subject'])

        _id, errors = reviews.update_review(template['id'], {'name': 'Renamed Review'}, actor='test')
        self.assertIsNone(errors, errors)

        self.graph_calls = []
        self.learner_reschedules(occurrence['eventKey'], bookable_day(35), '10:00')
        self.assertIn('Renamed Review', self.graph_payloads()[-1]['subject'])
        # Classification is untouched by the rename.
        self.assertEqual(self.coach_events()[occurrence['eventKey']]['reviewTypeCode'], 'mcm')


class StrictAnchorAndOwnershipTests(ReviewSchedulingSyncTestCase):
    def test_16_scheduling_never_recomputes_the_target_date(self):
        """J: the occurrence date came from Created_users.Start_date. Scheduling
        persists it; it must not be re-derived from the cohort-stamped mirror."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        expected_target = (LEARNER_START + timedelta(weeks=4)).isoformat()
        self.assertEqual(occurrence['targetDate'], expected_target)
        # The mirror's cohort date is a week earlier -- if it ever leaked in,
        # the target would move with it.
        self.assertNotEqual(self.mirror.start_date, LEARNER_START)

        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])
        self.assertEqual(record.target_date.isoformat(), expected_target)
        self.assertEqual(self.coach_events()[occurrence['eventKey']]['targetDate'], expected_target)
        self.assertEqual(self.learner_events()[occurrence['eventKey']]['targetDate'], expected_target)

        instance = review_instances.get_review_instance(record.review_instance_id)
        self.assertEqual(str(instance['target_date']), expected_target)

    def test_11_scheduling_does_not_leave_a_generated_duplicate(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        before = len([e for e in self.coach_events().values() if e['source'] == 'mcr'])

        self.coach_schedules(occurrence['eventKey'], bookable_day(20))

        coach_rows = [e for e in self.coach_events().values() if e['source'] == 'mcr']
        learner_rows = [e for e in self.learner_events().values() if e['source'] == 'mcr']
        self.assertEqual(len(coach_rows), before)
        self.assertEqual(len(learner_rows), before)
        keys = [e['eventKey'] for e in learner_rows]
        self.assertEqual(len(keys), len(set(keys)), 'the learner calendar duplicated an occurrence')

    def test_18_another_coach_cannot_schedule_this_learners_review(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        request = self.factory.post(
            '/coach_api/coach/timetable/events/schedule',
            data=json.dumps({
                'eventKey': occurrence['eventKey'],
                'scheduledDate': bookable_day(20).isoformat(),
                'scheduledTime': '10:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw_view(coach_views.coach_timetable_schedule_event)(request),
            coach_email=OTHER_COACH_EMAIL,
        )
        self.assertEqual(response.status_code, 404, response.content)
        self.assertFalse(CoachCalendarEvent.objects.filter(event_key=occurrence['eventKey']).exists())

    def test_18_a_learner_cannot_reach_another_learners_row_by_event_key(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))

        # The real ownership scope, unpatched: a learner whose profile/email do
        # not own the row resolves nothing, whatever event key they send.
        stranger = SimpleNamespace(id=999, pk=999, email='stranger@example.com')
        with patch.object(learner_calendar, 'SOURCE_MODELS',
                          {'commercial': SimpleNamespace(all_learners=FakeManager(stranger))}), \
             patch.object(learner_calendar, 'learner_profile_for_source', return_value=None):
            self.assertIsNone(
                learner_calendar._learner_calendar_record('commercial', 999, occurrence['eventKey']),
            )
