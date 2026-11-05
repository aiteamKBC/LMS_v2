from datetime import date
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, override_settings

from coach_api import views
from .calendar import _serialize_live_session_event
from .calendar_shared_delivery import apply_shared_calendar_slot, read_shared_calendar_slots


def delivery(**changes):
    return {
        'teamsLiveSessionId': 'SOURCE-SERIES', 'teamsOccurrenceId': 'SOURCE-OCC-9',
        'teamsSessionNumber': 9, 'sessionDateTimeUtc': '2026-10-28T12:00:00+00:00',
        'durationMinutes': 120, 'liveSessionUrl': 'https://teams.example.test/shared',
        **changes,
    }


@override_settings(TIME_ZONE='Europe/London')
class SharedCalendarSlotTests(SimpleTestCase):
    def test_only_unambiguous_assigned_cards_are_resolved(self):
        cards = [
            {'id': 'C1', 'module_catalogue_id': 'ASSIGNED', 'week_id': 'W1'},
            {'id': 'OTHER', 'module_catalogue_id': 'OTHER', 'week_id': 'W2'},
            {'id': 'C3', 'module_catalogue_id': 'ASSIGNED', 'week_id': 'W3'},
            {'id': 'C4', 'module_catalogue_id': 'ASSIGNED', 'week_id': 'W3'},
        ]
        with patch('learner_api.calendar_shared_delivery.read_shared_live_delivery', return_value={'C1': delivery()}) as read:
            self.assertEqual(read_shared_calendar_slots(['ASSIGNED'], cards), {'W1': delivery()})
        read.assert_called_once_with(['ASSIGNED'], ['C1'])

    def test_empty_assignments_do_not_query(self):
        with patch('learner_api.calendar_shared_delivery.read_shared_live_delivery') as read:
            self.assertEqual(read_shared_calendar_slots([], [{'id': 'C', 'module_catalogue_id': 'M', 'week_id': 'W'}]), {})
            self.assertEqual(read_shared_calendar_slots(['M'], []), {})
        read.assert_not_called()

    def test_lookup_failure_remains_visible(self):
        with patch('learner_api.calendar_shared_delivery.read_shared_live_delivery', side_effect=DatabaseError('Unavailable')):
            with self.assertRaises(DatabaseError):
                read_shared_calendar_slots(['M'], [{'id': 'C', 'module_catalogue_id': 'M', 'week_id': 'W'}])

    def test_preserves_assigned_event_identity_and_uses_booked_occurrence(self):
        original = {'id': 'live-session-ASSIGNED-2', 'eventKey': 'live-session-ASSIGNED-2',
                    'module': 'Assigned module', 'title': 'Assigned lesson', 'sequence': 2,
                    'meetingLink': '', 'occurrenceId': None}
        updated = apply_shared_calendar_slot(original, delivery())
        for key in ('id', 'eventKey', 'module', 'title', 'sequence'):
            self.assertEqual(updated[key], original[key])
        payload = _serialize_live_session_event(updated)
        self.assertEqual(payload['meetingLink'], delivery()['liveSessionUrl'])
        self.assertEqual(payload['occurrenceId'], 'SOURCE-OCC-9')
        self.assertEqual(payload['scheduledDate'], '2026-10-28')
        self.assertEqual(payload['scheduledTime'], '12:00')
        self.assertEqual(payload['durationMinutes'], 120)
        self.assertEqual(original['meetingLink'], '')

    def test_utc_day_boundary_and_dst_end_use_business_clock(self):
        event = apply_shared_calendar_slot({}, delivery(sessionDateTimeUtc='2026-10-24T23:30:00+00:00'))
        self.assertEqual(event['date'], '2026-10-25')
        self.assertEqual(event['timeLabel'], '00:30 - 01:30')
        self.assertEqual(event['durationMinutes'], 120)

    def test_existing_link_or_occurrence_is_never_replaced(self):
        for event in ({'meetingLink': 'https://teams.example.test/direct'}, {'occurrenceId': 'OWN-OCC'}):
            self.assertIs(apply_shared_calendar_slot(event, delivery()), event)

    def test_missing_source_link_is_not_fabricated(self):
        event = {'meetingLink': ''}
        self.assertIs(apply_shared_calendar_slot(event, delivery(liveSessionUrl='')), event)


@override_settings(TIME_ZONE='Europe/London')
class LearnerSharedCalendarIntegrationTests(SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.weeks = [dict(id=f'W{i}', module_catalogue_id='ASSIGNED', week_number=i + 1,
                           title=f'Lesson {i}', library_state='') for i in range(4)]
        self.components = [dict(id=f'C{i}', module_catalogue_id='ASSIGNED', week_id=f'W{i}',
                                type='live_session', live_sessions_link='', library_state='') for i in (0, 1, 3)]
        self.series, self.occurrences = [], []
        self.row = {'id': 'ASSIGNED', '_meta': {'module_catalogue_id': 'ASSIGNED', 'cohort_id': 'CO'},
                    'module_name': 'Assigned module', 'start_date': date(2026, 10, 7), 'sessions_number': 4,
                    'session_week_day': 'Wednesday', 'session_start_time': '09:00', 'session_end_time': '10:00'}
        def fetch(table, *args, **kwargs):
            self.assertFalse(kwargs.get('ensure_tables', True))
            if table == views.AUTHORING_COMPONENTS_TABLE:
                self.assertNotIn('settings_json', kwargs['columns'])
                return [{key: row.get(key) for key in kwargs['columns']} for row in self.components]
            return {views.AUTHORING_WEEKS_TABLE: self.weeks, views.AUTHORING_COMPONENTS_TABLE: self.components,
                    views.LIVE_SESSIONS_TABLE: self.series, views.LIVE_SESSION_OCCURRENCES_TABLE: self.occurrences}[table]
        patches = [
            patch('coach_api.views.authoring_fetch_all', side_effect=fetch),
            patch('coach_api.views.authoring_modules_as_training_rows', return_value=[self.row]),
            patch('coach_api.views.get_program_config_rows', return_value=[]),
            patch('coach_api.views.programme_identity', return_value={'name': 'Programme', 'sourceId': 'P'}),
            patch('coach_api.views.actual_cohort_identity', return_value={'id': 'CO', 'name': 'Cohort'}),
            patch('coach_api.views.actual_group_identity', return_value={'id': 'G', 'name': 'Group'}),
            patch('coach_api.views.fetch_cohort_selected_holidays', return_value=[]),
            patch('learner_api.calendar_shared_delivery.read_shared_live_delivery', return_value={'C1': delivery()}),
        ]
        self.mocks = [item.start() for item in patches]
        for item in patches:
            self.addCleanup(item.stop)

    def collect(self, **kwargs):
        return views.collect_live_session_events('', '', require_coach_access=False,
                                                  learner_module_ids=['ASSIGNED'], include_past=True, **kwargs)

    def test_shared_source_link_reaches_learner_calendar_after_a_reading_week(self):
        events = self.collect()
        self.assertEqual(len(events), 3)
        event = next(event for event in events if event['id'] == 'live-session-ASSIGNED-2')
        self.assertEqual(event['occurrenceId'], 'SOURCE-OCC-9')
        self.assertEqual(_serialize_live_session_event(event)['meetingLink'], delivery()['liveSessionUrl'])
        self.assertEqual(event['date'], '2026-10-28')
        self.assertEqual(event['startHour'], 12)
        self.assertFalse(events[0]['meetingLink'])
        self.assertFalse(events[2]['meetingLink'])
        self.assertEqual(self.mocks[-1].call_args.args, (['ASSIGNED'], ['C0', 'C1', 'C3']))

    def test_date_filter_uses_moved_source_date(self):
        events = self.collect(start_date=date(2026, 10, 28), end_date=date(2026, 10, 28))
        self.assertIn('live-session-ASSIGNED-2', [event['id'] for event in events])
        self.assertNotIn('live-session-ASSIGNED-2', [event['id'] for event in self.collect(end_date=date(2026, 10, 20))])

    def test_unassigned_module_is_not_resolved_or_returned(self):
        events = views.collect_live_session_events('', '', require_coach_access=False,
                                                    learner_module_ids=['OTHER'], include_past=True)
        self.assertEqual(events, [])
        self.mocks[-1].assert_not_called()

    def test_coach_path_does_not_resolve_learner_shared_links(self):
        with patch('coach_api.views.coach_has_live_session_access', return_value=True), \
                patch('coach_api.views.fetch_official_assigned_groups', return_value=[{'group_id': 'G'}]), \
                patch('coach_api.views.live_session_matches_assigned_group', return_value=True):
            events = views.collect_live_session_events('coach@example.test', 'Coach', include_past=True)
        self.assertEqual(len(events), 3)
        self.assertTrue(all(not event['meetingLink'] for event in events))
        self.mocks[-1].assert_not_called()

    def test_existing_component_override_is_preserved(self):
        self.components[1]['live_sessions_link'] = 'https://teams.example.test/override'
        event = self.collect()[1]
        self.assertEqual(event['meetingLink'], 'https://teams.example.test/override')
        self.assertIsNone(event['occurrenceId'])

    def test_owned_series_is_preserved(self):
        self.series.append({'id': 'OWN', 'module_catalogue_id': 'ASSIGNED', 'join_url': 'https://teams.example.test/own'})
        self.assertTrue(all(event['meetingLink'].endswith('/own') for event in self.collect()))

    def test_multiple_planned_sessions_do_not_duplicate_a_single_shared_occurrence(self):
        with patch('coach_api.views.delivery_days_per_week', return_value=2):
            self.assertTrue(all(event['occurrenceId'] is None for event in self.collect()))
