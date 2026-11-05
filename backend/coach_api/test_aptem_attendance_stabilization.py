"""Synthetic Graph -> real APTEM action -> snapshot write-boundary regressions.

No database/provider is used. The storage double captures actual report/tracker
arguments and supplies them on the next stored read; it does not implement SQL.
"""
import inspect
import json
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import timedelta
from urllib.error import HTTPError
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import tests_migrated_intelligence as fixtures
from . import views
from .migrated_intelligence_views import migrated_review_check_session
from .models import CoachCalendarEvent


FAMILIES = ('MCM', 'PR', 'PR_SKILLS_RADAR', 'PSP')
EXPECTED = [
    {'id': 'coach', 'role': 'coach', 'email': 'coach@example.invalid', 'displayName': 'Synthetic Coach'},
    {'id': 'learner', 'role': 'learner', 'email': 'learner@example.invalid', 'displayName': 'Synthetic Learner'},
]


class AptemAttendanceRefreshTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.base = '/users/synthetic-organizer/onlineMeetings/synthetic-meeting'
        self.organizer_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        self.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        self.event_override = None
        self.meeting_override = None

    def prepare(self, family):
        self.family = family
        fixture = fixtures.meeting()
        self.record = CoachCalendarEvent(id=7, event_key=fixtures.ID,
            idempotency_key=fixtures.ID, owner_email='coach@example.invalid', learner_id=42,
            event_type='mcr' if family == 'MCM' else 'progress-review', status='scheduled',
            graph_event_id=fixture.graph_event_id, graph_organizer_email='coach@example.invalid',
            meeting_link=fixture.meeting_link,
            sync_state='synced', scheduled_date=fixture.scheduled_date,
            scheduled_time=fixture.scheduled_time, duration_minutes=60)
        self.overlay = fixtures.review('scheduled')
        self.overlay.answers = {'saved': 'Keep Coach text', 'summary': ''}
        self.stored = {'artifacts': [], 'attendanceReports': [], 'attendanceTracker': {},
                       'attendance': {'expectedAttendees': EXPECTED}, 'errors': [], 'partial': False}
        self.writes = []
        self.reports = []
        self.details = {}
        self.attendance_error = None
        self.target_error_code = None
        self.transcripts = []
        self.collection_override = None

    def report(self, roles=('coach', 'learner'), *, key='report-1', days=0):
        raw = fixtures.graph_snapshot(attendance=True)['attendanceReports'][0]
        start = views.parse_graph_datetime(raw['meetingStartDateTime']) + timedelta(days=days)
        end = views.parse_graph_datetime(raw['meetingEndDateTime']) + timedelta(days=days)
        report = {'id': key, 'meetingStartDateTime': start.isoformat(),
                  'meetingEndDateTime': end.isoformat(), 'totalParticipantCount': len(roles)}
        detail = {**report, 'attendanceRecords': [
            {'id': role, 'emailAddress': EXPECTED[index]['email'],
             'identity': {'displayName': EXPECTED[index]['displayName']},
             'totalAttendanceInSeconds': 600, 'attendanceIntervals': []}
            for index, role in enumerate(('coach', 'learner')) if role in roles
        ]}
        return report, detail

    def graph(self, method, path, *args, **kwargs):
        self.assertEqual(method, 'GET')
        if path == 'users/coach%40example.invalid/events/' + self.record.graph_event_id:
            if self.target_error_code:
                raise RuntimeError('synthetic provider target failure') from HTTPError(
                    path, self.target_error_code, 'synthetic', {}, None)
            return deepcopy(self.event_override if self.event_override is not None else {
                'id': self.record.graph_event_id,
                'organizer': {'emailAddress': {'address': self.record.graph_organizer_email}},
                'onlineMeeting': {'id': 'synthetic-meeting', 'joinUrl': self.record.meeting_link},
            })
        if path.startswith('users/coach%40example.invalid/onlineMeetings?'):
            return deepcopy(self.meeting_override if self.meeting_override is not None else {
                'value': [{'id': 'synthetic-meeting', 'joinWebUrl': self.record.meeting_link,
                           'participants': {'organizer': {'identity': {'user': {
                               'id': self.organizer_id, 'tenantId': self.tenant_id}}}}}],
            })
        if path == 'users/coach%40example.invalid?$select=id':
            return {'id': self.organizer_id}
        if path == self.base + '/attendanceReports':
            if self.attendance_error:
                raise self.attendance_error
            if self.collection_override is not None:
                return deepcopy(self.collection_override)
            return {'value': deepcopy(self.reports)}
        if '/attendanceReports/' in path:
            key = path.split('/attendanceReports/')[1].split('?')[0]
            detail = self.details[key]
            if isinstance(detail, Exception):
                raise detail
            return deepcopy(detail)
        if path == self.base + '/transcripts':
            return {'value': deepcopy(self.transcripts)}
        self.assertIn(path, [self.base + '/transcripts', self.base + '/recordings'])
        return {'value': []}

    def persist(self, record, *, artifacts, attendance_reports, attendance_tracker, imported_refresh=None):
        self.assertIs(record, self.record)
        self.writes.append(deepcopy({'reports': attendance_reports, 'tracker': attendance_tracker}))
        self.stored = {
            'artifacts': artifacts, 'attendanceReports': deepcopy(attendance_reports),
            'attendanceTracker': deepcopy(attendance_tracker),
            'attendance': {'expectedAttendees': EXPECTED, **deepcopy(attendance_tracker)},
            'errors': [], 'partial': False, 'storage': {'stored': True},
        }
        return {'stored': True}

    def call(self, *, native=False):
        request = self.factory.post('/', data='{}', content_type='application/json')
        request.coach_email = self.record.owner_email
        before_answers = deepcopy(self.overlay.answers)
        definition = {
            'template': {'reviewTypeCode': 'aptem_psp'},
            'instance': {'id': self.record.event_key, 'learnerId': 42, 'status': 'scheduled'},
            'historicalReview': {'type': 'Personal Support Plan', 'status': 'scheduled'},
            'booking': {'eventKey': self.record.event_key, 'syncState': 'synced',
                        'meetingLink': self.record.meeting_link},
        }
        with ExitStack() as stack:
            # This synthetic snapshot fixture has no manually confirmed identity links.
            stack.enter_context(patch('coach_api.review_attendance_links.saved_links', return_value=[]))
            def mock(name, **kwargs):
                return stack.enter_context(patch(name, **kwargs))
            mock('coach_api.views.has_graph_credentials', return_value=True)
            mock('coach_api.views.coach_meeting_graph_target', return_value=(self.base, None))
            mock('coach_api.views.microsoft_graph_request', side_effect=self.graph)
            mock('coach_api.views.fetch_coach_meeting_transcript_content',
                 return_value={'transcript_text': 'Synthetic decisions', 'transcript_vtt': 'WEBVTT'})
            mock('curriculum_api.views.teams_online_meeting_owner_id',
                 return_value='coach@example.invalid')
            mock('curriculum_api.views.teams_meeting_base_path', return_value=self.base)
            duplicate_query = mock('coach_api.models.CoachCalendarEvent.objects.filter')
            duplicate_query.return_value.exclude.return_value.exists.return_value = False
            mock('coach_api.views.coach_meeting_expected_attendees', return_value=EXPECTED)
            mock('coach_api.views.stored_coach_meeting_snapshot', side_effect=lambda record: deepcopy(self.stored))
            mock('coach_api.views.persist_coach_meeting_snapshots', side_effect=self.persist)
            recap = mock('coach_api.views.ensure_coach_meeting_summary', return_value=None)
            ai = mock('coach_api.views.openai_meeting_summary')
            mock('coach_api.views.stored_coach_meeting_transcript_for_summary', return_value=None)
            transition = mock('coach_api.views.apply_teams_attendance_status_transition', return_value=False)
            if self.family == 'PSP' or native:
                mock('coach_api.views.coach_meeting_artifact_record', return_value=self.record)
                source = mock('coach_api.views._imported_review_definition', return_value=definition)
                response = inspect.unwrap(views.coach_timetable_event_artifacts)(request, self.record.event_key)
                if native:
                    source.assert_not_called()
                elif response.status_code in {200, 207}:
                    source.assert_called_once_with(self.record.owner_email, self.record.event_key)
            else:
                mock('coach_api.migrated_intelligence_views._association', return_value=(self.overlay, self.record, {}))
                mock('coach_api.migrated_intelligence_views._checked_lock', return_value=(self.overlay, self.record, None))
                mock('coach_api.migrated_intelligence_views.transaction.atomic', return_value=nullcontext())
                response = inspect.unwrap(migrated_review_check_session)(request, self.record.event_key)
                transition.assert_not_called()
                recap.assert_not_called()
            ai.assert_not_called()  # No transcript in these attendance-only fixtures.
        self.assertEqual(self.overlay.answers, before_answers)
        self.assertEqual(self.overlay.status, 'scheduled')
        self.assertEqual(self.record.status, 'scheduled')
        return response

    def load_report(self, **kwargs):
        report, detail = self.report(**kwargs)
        self.reports, self.details = [report], {report['id']: detail}

    def assert_attended(self, roles=('coach', 'learner'), *, seconds=600):
        rows = {r['role']: r for r in self.writes[-1]['tracker']['tracker']}
        for role in roles:
            self.assertEqual(rows[role]['status'], 'attended')
            self.assertEqual(rows[role]['totalAttendanceSeconds'], seconds)

    def test_coach_learner_and_both_are_persisted_without_form_mutation(self):
        for family in FAMILIES:
            for roles in (('coach',), ('learner',), ('coach', 'learner')):
                with self.subTest(family=family, roles=roles):
                    self.prepare(family)
                    self.load_report(roles=roles)
                    self.assertEqual(self.call().status_code, 200)
                    self.assert_attended(roles)

    def test_no_report_is_pending_and_late_report_updates_it(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.assertEqual(self.call().status_code, 200)
                self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
                self.load_report()
                self.assertEqual(self.call().status_code, 200)
                self.assert_attended()

    def test_empty_later_collection_preserves_verified_attendance(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.reports = []
                self.assertEqual(self.call().status_code, 200)
                self.assert_attended()
                self.assertEqual(len(self.writes[-1]['reports']), 1)

    def test_failed_later_collection_preserves_evidence_and_reports_error(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.attendance_error = RuntimeError('synthetic temporary failure')
                response = self.call()
                self.assertEqual(response.status_code, 207)
                self.assertTrue(json.loads(response.content)['errors'])
                self.assert_attended()

    def test_missing_records_do_not_replace_verified_report_with_absence(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.details['report-1'].pop('attendanceRecords')
                response = self.call()
                self.assert_attended()
                self.assertEqual(response.status_code, 207)

    def test_incomplete_expanded_records_preserve_last_complete_report(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.details['report-1']['attendanceRecords'] = self.details['report-1']['attendanceRecords'][:1]
                self.details['report-1']['attendanceRecords@odata.nextLink'] = self.base + '/attendanceReports/report-1/attendanceRecords?$skiptoken=next'
                response = self.call()
                self.assert_attended()
                self.assertEqual(response.status_code, 207)

    def test_early_report_from_verified_meeting_is_retained_for_imported_review(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report(days=-7)
                self.assertEqual(self.call().status_code, 200)
                if family == 'PSP':
                    self.assertEqual(self.writes[-1]['reports'], [])
                    self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
                else:
                    self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                    self.assert_attended()

    def test_multiple_reports_from_verified_meeting_remain_distinct(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                old, detail = self.report(key='old-report', days=-7)
                self.reports.append(old)
                self.details['old-report'] = detail
                self.assertEqual(self.call().status_code, 200)
                self.assertEqual([r['id'] for r in self.writes[-1]['reports']],
                                 ['report-1'] if family == 'PSP' else ['report-1', 'old-report'])
                self.assert_attended(seconds=600 if family == 'PSP' else 1200)

    def test_late_report_from_verified_meeting_is_retained(self):
        for family in FAMILIES[:3]:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report(days=7)
                self.assertEqual(self.call().status_code, 200)
                self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                self.assert_attended()

    def test_wrong_provider_meeting_identity_cannot_write_attendance(self):
        for conflict in ('event', 'meeting', 'organizer', 'tenant', 'ambiguous'):
            with self.subTest(conflict=conflict):
                self.prepare('PR')
                self.load_report()
                if conflict == 'event':
                    self.event_override = {'id': 'another-event'}
                elif conflict == 'organizer':
                    self.event_override = {'id': self.record.graph_event_id,
                        'organizer': {'emailAddress': {'address': 'other@example.invalid'}},
                        'onlineMeeting': {'joinUrl': self.record.meeting_link}}
                else:
                    if conflict == 'tenant':
                        self.record.meeting_link = (
                            'https://teams.microsoft.com/test?context=%7B%22Tid%22%3A%22'
                            + self.organizer_id + '%22%7D')
                    meeting = {'id': 'another-meeting' if conflict == 'meeting' else 'synthetic-meeting',
                        'joinWebUrl': self.record.meeting_link,
                        'participants': {'organizer': {'identity': {'user': {
                            'id': self.organizer_id, 'tenantId': self.tenant_id}}}}}
                    if conflict == 'tenant':
                        meeting['participants']['organizer']['identity']['user']['tenantId'] = self.tenant_id
                    self.meeting_override = {'value': [meeting, meeting] if conflict == 'ambiguous' else [meeting]}
                    if conflict == 'meeting':
                        self.event_override = {'id': self.record.graph_event_id,
                            'organizer': {'emailAddress': {'address': self.record.graph_organizer_email}},
                            'onlineMeeting': {'id': 'synthetic-meeting', 'joinUrl': self.record.meeting_link}}
                response = self.call()
                self.assertEqual(response.status_code, 409)
                self.assertEqual(self.writes, [])

    def test_provider_target_errors_fail_without_writing_attendance(self):
        for code, expected_status in ((403, 403), (404, 404), (429, 429)):
            with self.subTest(code=code):
                self.prepare('MCM')
                self.load_report()
                self.target_error_code = code
                response = self.call()
                self.assertEqual(response.status_code, expected_status)
                self.assertEqual(self.writes, [])

    def test_attendance_provider_errors_preserve_saved_evidence_independently(self):
        for code in (403, 404, 429):
            with self.subTest(code=code):
                self.prepare('PR')
                self.load_report()
                self.assertEqual(self.call().status_code, 200)
                saved = deepcopy(self.stored['attendanceReports'])
                failure = RuntimeError('synthetic attendance resource failure')
                failure.__cause__ = HTTPError(self.base + '/attendanceReports', code,
                                              'synthetic', {}, None)
                self.attendance_error = failure
                response = self.call()
                self.assertEqual(response.status_code, 207)
                self.assertEqual(self.stored['attendanceReports'], saved)
                self.assert_attended()

    def test_transcript_succeeds_while_attendance_timeout_preserves_old_report(self):
        self.prepare('PR')
        self.load_report()
        self.assertEqual(self.call().status_code, 200)
        old_reports = deepcopy(self.stored['attendanceReports'])
        self.attendance_error = TimeoutError('synthetic attendance timeout')
        self.transcripts = [{'id': 'segment-1', 'callId': 'call-1',
            'createdDateTime': old_reports[0]['meetingStartDateTime'],
            'endDateTime': old_reports[0]['meetingEndDateTime']}]
        response = self.call()
        self.assertEqual(response.status_code, 207)
        self.assertEqual(self.stored['attendanceReports'], old_reports)
        self.assertEqual([row['graph_artifact_id'] for row in self.stored['artifacts']], ['segment-1'])
        self.assertEqual(self.stored['artifacts'][0]['transcript_text'], 'Synthetic decisions')
        self.assert_attended()

    def test_changed_booking_identity_rejects_stale_saved_report(self):
        self.prepare('MCM')
        self.load_report()
        self.assertEqual(self.call().status_code, 200)
        saved = deepcopy(self.stored['attendanceReports'])
        old_link = self.record.meeting_link
        self.record.meeting_link = 'https://teams.microsoft.com/changed-booking'
        self.event_override = {'id': self.record.graph_event_id,
            'organizer': {'emailAddress': {'address': self.record.graph_organizer_email}},
            'onlineMeeting': {'id': 'synthetic-meeting', 'joinUrl': old_link}}
        write_count = len(self.writes)
        self.assertEqual(self.call().status_code, 409)
        self.assertEqual(len(self.writes), write_count)
        self.assertEqual(self.stored['attendanceReports'], saved)

    def test_duplicate_fetch_is_idempotent_for_tracker_durations(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                first = deepcopy(self.writes[-1])
                self.call()
                self.assertEqual(self.writes[-1], first)
                self.assert_attended()

    def test_duplicate_report_in_collection_is_not_double_counted(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.reports *= 2
                self.assertEqual(self.call().status_code, 200)
                self.assert_attended()
                self.assertEqual(len(self.writes[-1]['reports']), 1)

    def test_mismatched_report_detail_cannot_replace_selected_report(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.details['report-1']['id'] = 'unrelated-report'
                response = self.call()
                self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                self.assertEqual(response.status_code, 207)

    def test_incomplete_report_without_cache_is_pending_not_absent(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.details['report-1'].pop('attendanceRecords')
                response = self.call()
                self.assertEqual(self.writes[-1]['reports'], [])
                self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
                self.assertEqual(response.status_code, 207)

    def test_complete_empty_report_retains_existing_absence_semantics(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report(roles=())
                self.assertEqual(self.call().status_code, 200)
                self.assertEqual(len(self.writes[-1]['reports']), 1)
                self.assertTrue(all(r['status'] == 'absent' for r in self.writes[-1]['tracker']['tracker']))

    def test_reschedule_of_same_verified_meeting_retains_saved_attendance(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.call()
                self.record.scheduled_date -= timedelta(days=7)
                self.reports = []
                self.assertEqual(self.call().status_code, 200)
                if family == 'PSP':
                    self.assertEqual(self.writes[-1]['reports'], [])
                    self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
                else:
                    self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                    self.assert_attended()

    def test_partial_report_failure_preserves_other_verified_report(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report(roles=('coach',))
                report, detail = self.report(key='learner-report', roles=('learner',))
                self.reports.append(report)
                self.details[report['id']] = detail
                self.call()
                self.details[report['id']] = RuntimeError('synthetic detail failure')
                response = self.call()
                self.assert_attended()
                self.assertEqual(len(self.writes[-1]['reports']), 2)
                self.assertEqual(response.status_code, 207)

    def test_incomplete_collection_preserves_evidence_and_exposes_failure(self):
        for family in FAMILIES:
            for malformed in ({}, {'value': [], '@odata.nextLink': '/synthetic-next'},
                              {'value': [{'id': 'report-1'}], '@odata.nextLink': '/synthetic-next'}):
                with self.subTest(family=family, response=malformed):
                    self.prepare(family)
                    self.load_report()
                    self.call()
                    self.collection_override = malformed
                    response = self.call()
                    self.assert_attended()
                    self.assertEqual(response.status_code, 207)

    def test_native_incomplete_detail_keeps_default_processing(self):
        self.prepare('MCM')
        self.record.event_key = self.record.idempotency_key = 'mcr:42:synthetic-native'
        self.load_report()
        self.details['report-1'].pop('attendanceRecords')
        self.assertEqual(self.call(native=True).status_code, 200)
        self.assertEqual(len(self.writes[-1]['reports']), 1)
        self.assertTrue(all(r['status'] == 'absent' for r in self.writes[-1]['tracker']['tracker']))

    def test_report_collection_page_cannot_erase_unreturned_cached_report(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report(roles=('coach',))
                report, detail = self.report(key='learner-report', roles=('learner',))
                self.reports.append(report)
                self.details[report['id']] = detail
                self.call()
                self.collection_override = {'value': self.reports[:1], '@odata.nextLink': '/synthetic-next'}
                response = self.call()
                self.assert_attended()
                self.assertEqual(len(self.writes[-1]['reports']), 2)
                self.assertEqual(response.status_code, 207)

    def test_native_generic_refresh_keeps_existing_contract(self):
        self.prepare('MCM')
        self.record.event_key = self.record.idempotency_key = 'mcr:42:synthetic-native'
        self.load_report()
        self.call(native=True)
        self.reports = []
        self.assertEqual(self.call(native=True).status_code, 200)
        self.assertEqual(self.writes[-1]['reports'], [])
        self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
