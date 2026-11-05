"""Coach discovery/matching regressions: no Django, database or network."""
from copy import deepcopy
from datetime import date, datetime, time, timezone
from types import ModuleType
import sys
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

from coach_api.recordings_calendar import cancelled_bookings, compare_coach_calendar, load_coach_calendar


OWNER = 'coach@example.invalid'
START = datetime(2026, 10, 1, tzinfo=timezone.utc)
END = datetime(2026, 11, 1, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)
LINK = 'https://teams.microsoft.com/l/meetup-join/coaching'


def booking(**changes):
    return {'event_key': 'mcr:1:1', 'owner_email': OWNER, 'learner_id': 1,
            'event_type': 'mcr', 'graph_event_id': 'event-1', 'meeting_link': LINK,
            'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10),
            'duration_minutes': 60, 'status': 'scheduled', 'sync_state': 'synced', **changes}


def event(**changes):
    return {'id': 'event-1', 'subject': 'A title is not evidence of meeting type',
            'start': {'dateTime': '2026-10-20T09:00:00', 'timeZone': 'UTC'},
            'end': {'dateTime': '2026-10-20T10:00:00', 'timeZone': 'UTC'},
            'onlineMeeting': {'joinUrl': LINK},
            'attendees': [{'emailAddress': {'address': 'learner@example.invalid'}}], **changes}


class CoachCalendarMatchingTests(unittest.TestCase):
    def test_calendar_collection_keeps_all_types_including_non_teams_and_unknown_titles(self):
        titles = ['Monthly Coaching Meeting', 'Progress Review', 'Student Support',
                  'Catch-up', 'Employer discussion', 'Unfamiliar appointment', '']
        events = [event(id=f'event-{index}', subject=title, onlineMeeting={}, attendees=[])
                  for index, title in enumerate(titles)]
        result = self.compare(events=events, bookings=[])
        self.assertTrue(result['complete'])
        self.assertEqual(len(result['meetings']), len(events))
        self.assertEqual({row['calendarEventId']: row['title'] for row in result['meetings']},
                         {row['id']: row['subject'] for row in events})
        self.assertTrue(all(row['eventKey'] is None and row['learnerIds'] == [] for row in result['meetings']))

    def test_microsoft_cancellation_retains_title_and_explicit_sources(self):
        row = self.compare(events=[event(isCancelled=True)], bookings=[booking(sync_state='cancelled')])['meetings'][0]
        self.assertEqual(row['phase'], 'cancelled')
        self.assertEqual(row['cancellationSources'], ['microsoft', 'lms'])
        self.assertEqual(row['title'], event()['subject'])

    def test_saved_lms_cancellation_with_erased_time_uses_labelled_record_date(self):
        rows = cancelled_bookings([booking(scheduled_date=None, scheduled_time=None, sync_state='cancelled',
            updated_at=NOW)], self.learners, coach_email=OWNER, start=START, end=END)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['startsAt'])
        self.assertEqual(rows[0]['dateBasis'], 'record-updated')
        self.assertEqual(rows[0]['sources'], ['lms'])

    def test_not_scheduled_is_not_evidence_of_cancellation_or_another_coachs_data(self):
        rows = [booking(status='not-scheduled'), booking(sync_state='cancelled', owner_email='other@example.invalid')]
        self.assertEqual(cancelled_bookings(rows, self.learners, coach_email=OWNER, start=START, end=END), [])

    def test_cancellation_with_retained_time_is_scoped_by_session_not_later_update(self):
        rows = cancelled_bookings([booking(status='cancelled', updated_at=datetime(2027, 1, 1, tzinfo=timezone.utc))],
            self.learners, coach_email=OWNER, start=START, end=END)
        self.assertEqual(rows[0]['dateBasis'], 'session')
        self.assertIsNotNone(rows[0]['startsAt'])

    def test_student_support_booking_is_matched_without_title_guessing(self):
        row = self.compare(bookings=[booking(event_type='student-support')])['meetings'][0]
        self.assertEqual(row['family'], 'SUPPORT')

    def setUp(self):
        self.guard = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.guard.start(); self.addCleanup(self.guard.stop)
        self.learners = [{'id': 1, 'email': 'learner@example.invalid'}]

    def compare(self, events=None, bookings=None, **options):
        return compare_coach_calendar([event()] if events is None else events,
                                      [booking()] if bookings is None else bookings,
                                      self.learners, coach_email=OWNER,
                                      start=START, end=END, now=NOW, **options)

    def test_matches_saved_event_id_and_preserves_ended_vs_completion(self):
        result = self.compare()['meetings'][0]
        self.assertEqual((result['match'], result['phase'], result['family']), ('matched', 'ended', 'MCM'))
        self.assertEqual(result['learnerIds'], ['1'])
        self.assertNotIn('attendance', result)
        self.assertNotIn('ready', result)

    def test_teams_link_and_exact_occurrence_match_changed_calendar_id(self):
        result = self.compare(events=[event(id='copied-id')])
        self.assertEqual(result['meetings'][0]['match'], 'matched')
        self.assertEqual(result['lmsOnly'], [])

    def test_same_recurring_link_does_not_match_another_week(self):
        result = self.compare(events=[event(id='next-week',
            start={'dateTime': '2026-10-27T10:00:00Z'}, end={'dateTime': '2026-10-27T11:00:00Z'})])
        self.assertEqual(result['meetings'][0]['match'], 'external')
        self.assertEqual(result['meetings'][0]['phase'], 'upcoming')
        self.assertEqual(result['lmsOnly'][0]['eventKey'], 'mcr:1:1')

    def test_saved_event_with_changed_time_is_mismatch(self):
        result = self.compare(events=[event(end={'dateTime': '2026-10-20T10:30:00Z'})])
        self.assertEqual(result['meetings'][0]['match'], 'mismatch')
        self.assertEqual(result['lmsOnly'], [])

    def test_saved_event_with_changed_teams_room_is_mismatch(self):
        result = self.compare(events=[event(onlineMeeting={
            'joinUrl': 'https://teams.microsoft.com/l/meetup-join/other-room'})])
        self.assertEqual(result['meetings'][0]['match'], 'mismatch')

    def test_event_id_and_link_identifying_different_bookings_need_review(self):
        result = self.compare(bookings=[booking(), booking(event_key='mcr:1:2', graph_event_id='other')])
        self.assertEqual(result['meetings'][0]['match'], 'ambiguous')
        self.assertIsNone(result['meetings'][0]['eventKey'])

    def test_cancellation_is_separate_from_ended_and_must_agree(self):
        result = self.compare(events=[event(isCancelled=True)])['meetings'][0]
        self.assertEqual((result['phase'], result['match']), ('cancelled', 'mismatch'))
        result = self.compare(events=[event(isCancelled=True)], bookings=[booking(sync_state='cancelled')])
        self.assertEqual(result['meetings'][0]['match'], 'matched')

    def test_participant_time_match_stays_unconfirmed_and_has_no_family(self):
        result = self.compare(events=[event(id='unknown', onlineMeeting={})])['meetings'][0]
        self.assertEqual(result['match'], 'candidate')
        self.assertEqual(result['candidateEventKeys'], ['mcr:1:1'])
        self.assertIsNone(result['eventKey'])
        self.assertIsNone(result['family'])

    def test_conflicting_booking_identities_are_ambiguous(self):
        result = self.compare(bookings=[booking(), booking(event_key='mcr:1:2')])['meetings'][0]
        self.assertEqual(result['match'], 'ambiguous')
        self.assertIsNone(result['eventKey'])

    def test_duplicate_learner_email_never_chooses_arbitrary_student(self):
        self.learners.append({'id': 2, 'email': ' LEARNER@example.invalid '})
        result = self.compare(bookings=[])['meetings'][0]
        self.assertEqual(result['match'], 'ambiguous')
        self.assertEqual(result['learnerIds'], ['1', '2'])

    def test_calendar_event_without_lms_booking_or_learner_remains_visible_by_original_title(self):
        result = self.compare(events=[event(id='unlinked', subject='Team planning and support',
            onlineMeeting={}, attendees=[])], bookings=[])
        row = result['meetings'][0]
        self.assertEqual(row['title'], 'Team planning and support')
        self.assertEqual((row['match'], row['family'], row['eventKey'], row['learnerIds']),
                         ('external', None, None, []))

    def test_original_microsoft_private_title_is_preserved_without_inventing_learner_identity(self):
        row = self.compare(events=[event(id='private', subject='Private appointment', sensitivity='private',
            onlineMeeting={}, attendees=[])], bookings=[])['meetings'][0]
        self.assertEqual(row['title'], 'Private appointment')
        self.assertEqual(row['learnerIds'], [])

    def test_all_day_calendar_event_remains_visible(self):
        row = self.compare(events=[event(id='all-day', subject='Coach workshop', isAllDay=True,
            start={'dateTime': '2026-10-20T00:00:00Z'}, end={'dateTime': '2026-10-21T00:00:00Z'},
            onlineMeeting={}, attendees=[])], bookings=[])['meetings'][0]
        self.assertEqual(row['title'], 'Coach workshop')
        self.assertEqual(row['startsAt'], '2026-10-20T00:00:00+00:00')

    def test_unlinked_upcoming_and_cancelled_events_keep_their_actual_status(self):
        result = self.compare(events=[
            event(id='cancelled-no-student', subject='Team call', isCancelled=True, attendees=[]),
            event(id='future-no-student', subject='Planning', attendees=[],
                start={'dateTime': '2026-10-28T09:00:00Z'}, end={'dateTime': '2026-10-28T10:00:00Z'}),
        ], bookings=[])['meetings']
        self.assertEqual([(row['title'], row['phase']) for row in result], [('Team call', 'cancelled'), ('Planning', 'upcoming')])

    def test_other_coach_and_out_of_caseload_bookings_are_excluded(self):
        for record in (booking(owner_email='other@example.invalid'), booking(learner_id=2)):
            result = self.compare(bookings=[record])
            self.assertIsNone(result['meetings'][0]['eventKey'])
            self.assertEqual(result['lmsOnly'], [])

    def test_external_meeting_is_linked_to_invited_learner_without_type_guessing(self):
        result = self.compare(bookings=[])['meetings'][0]
        self.assertEqual(result['match'], 'external')
        self.assertEqual(result['learnerIds'], ['1'])
        self.assertIsNone(result['family'])

    def test_learner_organised_booking_is_identified_without_learner_in_attendees(self):
        result = self.compare(bookings=[], events=[event(attendees=[],
            organizer={'emailAddress': {'address': 'LEARNER@example.invalid'}})])
        self.assertEqual(result['meetings'][0]['learnerIds'], ['1'])
        self.assertEqual(result['meetings'][0]['match'], 'external')

    def test_duplicate_pages_do_not_duplicate_a_meeting(self):
        self.assertEqual(len(self.compare(events=[event(), event()])['meetings']), 1)

    def test_active_meeting_is_not_yet_ended(self):
        row = compare_coach_calendar([event()], [booking()], self.learners,
            coach_email=OWNER, start=START, end=END,
            now=datetime(2026, 10, 20, 9, 30, tzinfo=timezone.utc))['meetings'][0]
        self.assertEqual(row['phase'], 'in-progress')

    def test_uk_daylight_saving_is_not_the_machine_timezone(self):
        records = [booking(scheduled_date=date(2026, 10, 27))]
        result = self.compare(events=[event(start={'dateTime': '2026-10-27T10:00:00Z'},
            end={'dateTime': '2026-10-27T11:00:00Z'})], bookings=records)
        self.assertEqual(result['meetings'][0]['match'], 'matched')

    def test_unknown_event_timezone_is_incomplete_not_missing_booking(self):
        result = self.compare(events=[event(start={'dateTime': '2026-10-20T09:00:00', 'timeZone': 'unknown'})])
        self.assertFalse(result['complete'])
        self.assertEqual(result['invalidEvents'], 1)
        self.assertEqual(result['lmsOnly'], [])

    def test_malformed_calendar_row_does_not_report_lms_booking_as_missing(self):
        result = self.compare(events=[None])
        self.assertFalse(result['complete'])
        self.assertEqual(result['lmsOnly'], [])

    def test_absent_calendar_event_is_reported_without_mutating_booking(self):
        record = booking()
        original = deepcopy(record)
        result = self.compare(events=[], bookings=[record])
        self.assertEqual(result['lmsOnly'][0]['learnerId'], '1')
        self.assertEqual(record, original)

    def test_cancelled_and_unscheduled_bookings_are_not_missing_calendar_events(self):
        self.assertEqual(self.compare(events=[], bookings=[booking(status='cancelled'),
            booking(scheduled_time=None)])['lmsOnly'], [])

    def test_requires_bounded_timezone_aware_range(self):
        for start, end in ((START.replace(tzinfo=None), END), (END, START),
                           (START, datetime(2027, 1, 1, tzinfo=timezone.utc))):
            with self.assertRaises(ValueError):
                compare_coach_calendar([], [], [], coach_email=OWNER, start=start, end=end)


class CoachCalendarSourceTests(unittest.TestCase):
    def test_slow_pagination_stops_before_another_provider_request_without_returning_partial_events(self):
        self.graph.return_value = {'value': [event()], '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/users/coach/calendarView?$skip=1'}
        with patch('coach_api.recordings_calendar.monotonic', side_effect=[0, 0, 31]):
            with self.assertRaises(TimeoutError):
                load_coach_calendar(OWNER, START, END)
        self.assertEqual(self.graph.call_count, 1)

    def setUp(self):
        guard = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        guard.start(); self.addCleanup(guard.stop)
        transport = ModuleType('coach_api.views')
        transport.get_graph_settings = Mock(return_value={'base_url': 'https://graph.microsoft.com/v1.0'})
        transport.microsoft_graph_request = Mock(return_value={'value': [event()]})
        self.graph = transport.microsoft_graph_request
        modules = patch.dict(sys.modules, {'coach_api.views': transport})
        modules.start(); self.addCleanup(modules.stop)

    def test_uses_existing_app_transport_and_utc_calendar_view(self):
        self.assertEqual(load_coach_calendar(' COACH@example.invalid ', START, END), [event()])
        args, kwargs = self.graph.call_args
        self.assertEqual(args[0], 'GET')
        url = urlsplit(args[1])
        self.assertEqual(url.path, 'users/coach%40example.invalid/calendarView')
        self.assertEqual(parse_qs(url.query)['startDateTime'], [START.isoformat()])
        self.assertEqual(kwargs, {'extra_headers': {'Prefer': 'outlook.timezone="UTC"'}})

    def test_reads_all_pages_before_returning_any_calendar(self):
        self.graph.side_effect = [{'value': [], '@odata.nextLink':
            'https://graph.microsoft.com/v1.0/users/coach/calendarView?$skip=1'}, {'value': [event()]}]
        self.assertEqual(load_coach_calendar(OWNER, START, END), [event()])
        self.assertEqual(self.graph.call_count, 2)

    def test_graph_failure_is_not_converted_into_empty_calendar(self):
        self.graph.side_effect = RuntimeError('Graph unavailable')
        with self.assertRaises(RuntimeError):
            load_coach_calendar(OWNER, START, END)

    def test_incomplete_or_external_pagination_is_rejected(self):
        for response in ({}, {'value': [], '@odata.nextLink': 'https://other.invalid/calendar'}):
            self.graph.return_value = response
            with self.assertRaises(RuntimeError):
                load_coach_calendar(OWNER, START, END)


if __name__ == '__main__':
    unittest.main()
