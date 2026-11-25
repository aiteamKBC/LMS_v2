"""Identity, history and retry guards for opted-in recurrence padding."""
import copy
from datetime import datetime, timezone
from unittest.mock import patch
from django.test import SimpleTestCase
from .study_week_teams import prune_study_week_fillers


class StudyWeekTeamsGuardTests(SimpleTestCase):
    def reset_transport(self):
        self.events = [{'id': 'AUTO-PADDING', 'type': 'occurrence', 'seriesMasterId': 'MASTER',
                        'start': {'dateTime': '2027-03-09T09:00:00Z', 'timeZone': 'UTC'}}]
        self.calls = []
        self.fail_delete = False
        self.paginated = False
        self.invalid_response = False
        self.targets = [{'start': datetime(2027, 3, 2, 9, tzinfo=timezone.utc)},
                        {'start': datetime(2027, 3, 16, 9, tzinfo=timezone.utc)}]
        self.authored_dates = ['2027-03-02', '2027-03-16']

    def setUp(self):
        self.reset_transport()
        clock = self.enterContext(patch('curriculum_api.study_week_teams.datetime'))
        clock.now.return_value = datetime(2026, 11, 16, tzinfo=timezone.utc)
        self.module = {'week_boundary_mode': 'calendar', 'weeks_number': 3}
        self.lookup = self.enterContext(patch('curriculum_api.views.authoring_module_exists', side_effect=lambda _id: self.module))
        self.enterContext(patch('curriculum_api.views.authoring_session_links_by_catalogue', side_effect=lambda ids: {
            ids[0]: [{'date': day, 'meetingScope': 'main'} for day in self.authored_dates]}))
        self.enterContext(patch('curriculum_api.views.module_session_plan_for_weeks', return_value={'weeks': [
            {'weekNumber': 2, 'startDate': '2027-03-08', 'endDate': '2027-03-14', 'holidayWeek': True}]}))
        self.enterContext(patch('curriculum_api.views.graph_timezone_iana', return_value='UTC'))

    def graph(self, method, path):
        self.calls.append((method, path))
        if method == 'GET':
            if self.invalid_response:
                return None
            return {'value': copy.deepcopy(self.events), **({'@odata.nextLink': 'synthetic-page'} if self.paginated else {})}
        if method == 'DELETE':
            if self.fail_delete:
                raise RuntimeError('Synthetic provider failure')
            self.events[:] = [event for event in self.events if not path.endswith('/' + event['id'])]
            return {}
        raise AssertionError('Padding cleanup must never create or reschedule a meeting')

    def prune(self, rows=(), **kwargs):
        return prune_study_week_fillers(self.graph, 'synthetic-owner', 'MASTER', 'MOD-SYNTHETIC', self.targets, {}, rows, **kwargs)

    def test_only_proven_automatic_holiday_occurrence_is_removed_and_re_read(self):
        removed, warnings = self.prune()
        self.assertEqual(removed, {'AUTO-PADDING'})
        self.assertEqual(warnings, [])
        self.assertEqual(self.events, [])
        self.assertEqual([method for method, _path in self.calls], ['GET', 'DELETE', 'GET'])

    def test_legacy_modules_remove_only_untracked_filler_between_reviewed_sessions(self):
        self.module['week_boundary_mode'] = None
        self.assertEqual(self.prune(), ({'AUTO-PADDING'}, []))
        self.assertEqual([method for method, _ in self.calls], ['GET', 'DELETE', 'GET'])

    def test_padding_outside_the_reviewed_date_range_is_preserved(self):
        self.events[0]['start']['dateTime'] = '2027-03-23T09:00:00Z'
        self.assertEqual(self.prune(), (set(), []))
        self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_an_authored_live_missing_from_a_partial_payload_is_preserved(self):
        self.authored_dates.append('2027-03-09')
        self.assertEqual(self.prune(), (set(), []))
        self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_legacy_cleanup_requires_the_reviewed_dates_to_match_authored_components(self):
        self.module['week_boundary_mode'] = None
        self.authored_dates = []
        self.assertEqual(self.prune(), (set(), []))
        self.assertEqual(self.calls, [])

    def test_an_untracked_second_meeting_on_a_reviewed_date_is_preserved(self):
        self.events[0]['start']['dateTime'] = '2027-03-02T15:00:00Z'
        self.assertEqual(self.prune(), (set(), []))
        self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_manual_exceptions_known_sessions_and_history_are_preserved(self):
        for variant in ('exception', 'tracked-id', 'tracked-date', 'requested-manual', 'past'):
            with self.subTest(variant=variant):
                self.reset_transport()
                rows = []
                if variant == 'exception': self.events[0]['type'] = 'exception'
                if variant == 'tracked-id': rows = [{'graph_event_id': 'AUTO-PADDING'}]
                if variant == 'tracked-date': rows = [{'scheduled_start': datetime(2027, 3, 9, 9, tzinfo=timezone.utc)}]
                if variant == 'requested-manual': self.targets.append({'start': datetime(2027, 3, 9, 9, tzinfo=timezone.utc)})
                if variant == 'past':
                    with patch('curriculum_api.study_week_teams.datetime') as clock:
                        clock.now.return_value = datetime(2028, 1, 1, tzinfo=timezone.utc)
                        self.assertEqual(self.prune(rows), (set(), []))
                else:
                    self.assertEqual(self.prune(rows), (set(), []))
                self.assertEqual(len(self.events), 1)
                self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_unknown_identity_and_incomplete_pages_fail_visibly_without_deleting(self):
        for variant in ('other-master', 'unknown-type', 'paginated', 'malformed'):
            with self.subTest(variant=variant):
                self.reset_transport()
                if variant == 'other-master': self.events[0]['seriesMasterId'] = 'OTHER'
                if variant == 'unknown-type': self.events[0].pop('type')
                if variant == 'paginated': self.paginated = True
                if variant == 'malformed': self.invalid_response = True
                removed, warnings = self.prune()
                self.assertEqual(removed, set())
                self.assertEqual(warnings[0]['code'], 'study_week_calendar_unverified')
                self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_people_only_cannot_cancel_a_date(self):
        removed, warnings = self.prune(allow_delete=False)
        self.assertEqual(removed, set())
        self.assertTrue(warnings)
        self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_pending_creation_can_retry_silently_only_when_the_provider_proves_nobody_is_invited(self):
        original = self.graph
        def transport(method, path):
            if method == 'GET' and path.endswith('?$select=id,attendees'):
                return {'id': 'MASTER', 'attendees': []}
            return original(method, path)
        self.assertEqual(prune_study_week_fillers(transport, 'synthetic-owner', 'MASTER', 'MOD-SYNTHETIC',
                         self.targets, {}, allow_delete=False, allow_uninvited_delete=True), ({'AUTO-PADDING'}, []))

    def test_missing_or_nonempty_provider_attendees_never_allow_a_silent_cancellation(self):
        for master in ({'id': 'MASTER'}, {'id': 'OTHER', 'attendees': []},
                       {'id': 'MASTER', 'attendees': [{'emailAddress': {'address': 'synthetic@example.invalid'}}]}):
            with self.subTest(master=master):
                self.reset_transport()
                original = self.graph
                def transport(method, path):
                    return master if method == 'GET' and path.endswith('?$select=id,attendees') else original(method, path)
                removed, warnings = prune_study_week_fillers(transport, 'synthetic-owner', 'MASTER', 'MOD-SYNTHETIC',
                    self.targets, {}, allow_delete=False, allow_uninvited_delete=True)
                self.assertEqual(removed, set())
                self.assertTrue(warnings)
                self.assertFalse(any(method == 'DELETE' for method, _ in self.calls))

    def test_failed_deletion_can_retry_without_creating_or_replacing_the_master(self):
        self.fail_delete = True
        removed, warnings = self.prune()
        self.assertEqual(removed, set())
        self.assertTrue(warnings)
        self.assertEqual(len(self.events), 1)
        self.fail_delete = False
        self.assertEqual(self.prune(), ({'AUTO-PADDING'}, []))
        self.assertEqual(self.prune(), (set(), []))

    def test_a_failed_second_page_cannot_delete_even_the_first_pages_padding(self):
        calls = []
        def paged(method, path):
            calls.append((method, path))
            if len(calls) == 1:
                return {'value': copy.deepcopy(self.events), '@odata.nextLink':
                    'https://graph.microsoft.com/v1.0/users/synthetic-owner/events/MASTER/instances?$skip=1'}
            raise RuntimeError('Synthetic later-page failure')
        removed, warnings = prune_study_week_fillers(paged, 'synthetic-owner', 'MASTER', 'MOD-SYNTHETIC', self.targets, {})
        self.assertEqual(removed, set())
        self.assertTrue(warnings)
        self.assertEqual([method for method, _ in calls], ['GET', 'GET'])
        self.assertEqual(len(self.events), 1)

    def test_partial_delete_failure_retries_only_the_remaining_padding(self):
        self.events.append({**copy.deepcopy(self.events[0]), 'id': 'SECOND-PADDING'})
        original = self.graph
        failed = False
        def partial(method, path):
            nonlocal failed
            if method == 'DELETE' and path.endswith('/SECOND-PADDING') and not failed:
                failed = True
                raise RuntimeError('Synthetic second deletion failure')
            return original(method, path)
        removed, warnings = prune_study_week_fillers(partial, 'synthetic-owner', 'MASTER', 'MOD-SYNTHETIC', self.targets, {})
        self.assertEqual(removed, {'AUTO-PADDING'})
        self.assertTrue(warnings)
        self.assertEqual([item['id'] for item in self.events], ['SECOND-PADDING'])
        self.assertEqual(self.prune(), ({'SECOND-PADDING'}, []))
        self.assertEqual(self.prune(), (set(), []))
