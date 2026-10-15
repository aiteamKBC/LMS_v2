"""Standalone unittest with a dummy DB and mocked endpoint transport; no manage.py."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from django.conf import settings
if not settings.configured:
    settings.configure(SECRET_KEY='synthetic-test-only', DATABASES={'default': {'ENGINE': 'django.db.backends.dummy'}},
                       INSTALLED_APPS=['login'], USE_TZ=True, DEFAULT_CHARSET='utf-8')
if settings.DATABASES['default']['ENGINE'] != 'django.db.backends.dummy':
    raise RuntimeError('Dummy database required; never run against an application database.')
import django
django.setup()
from django.test import RequestFactory
from .recordings_day_policy import day_results
from .recordings_day import lecture_day_results
DATE = '2026-10-14'
START = DATE + 'T08:00:00Z'
SESSION = {'id': 'O', 'startsAt': START, 'reportReady': True, 'attendance': [
    {'email': 'a@example.invalid', 'name': 'Learner A', 'expected': True},
    {'email': 'b@example.invalid', 'name': 'Learner B', 'expected': True}],
    'artifacts': [{'id': 'R14', 'type': 'recording', 'state': 'ready'}, {'id': 'R13', 'type': 'recording', 'state': 'ready'}],
    'identityCheck': {'participants': [{'kind': 'staff', 'expectedEmail': 'coach@example.invalid', 'name': 'Coach', 'roles': ['Organiser'], 'accounts': []}]}}
def record(email='a@example.invalid', day=DATE, seconds=600, **kw):
    return {'id': 'ROW-' + email + day, 'email': email, 'role': 'attendee', 'total_attendance_seconds': seconds,
            'raw_data': {'attendanceReportId': day, 'attendanceReportStart': day + 'T08:00:00Z', 'attendanceReportEnd': day + 'T10:00:00Z'}, **kw}
class ProjectionTests(unittest.TestCase):
    def project(self, records, files=(), zone='UTC'):
        return day_results(copy.deepcopy(SESSION), records, files, DATE, zone)
    def test_assigned_only_and_other_day_never_counts(self):
        r = self.project([record(), record('b@example.invalid', '2026-10-13'), record('outsider@example.invalid'), record('coach@example.invalid')])
        self.assertEqual([(p['email'], p['status']) for p in r['attendance']], [('a@example.invalid', 'present'), ('b@example.invalid', 'absent')])
        self.assertEqual(r['reportCount'], 1)
        self.assertEqual(r['staff'][0]['status'], 'joined')
    def test_no_report_is_unknown_not_absent(self):
        r = self.project([record(day='2026-10-13')])
        self.assertFalse(r['reportReady'])
        self.assertEqual({p['status'] for p in r['attendance']}, {'pending'})
        self.assertEqual(r['staff'][0]['status'], 'unconfirmed')
    def test_missing_organizer_evidence_never_absent(self):
        self.assertEqual(self.project([record()])['staff'][0]['status'], 'unconfirmed')
    def test_existing_threshold_is_preserved(self):
        self.assertEqual(self.project([record(seconds=180)])['attendance'][0]['status'], 'absent')
        self.assertEqual(self.project([record(seconds=181)])['attendance'][0]['status'], 'present')
    def test_devices_not_double_counted(self):
        visit = {'joinDateTime': START, 'leaveDateTime': DATE + 'T08:10:00Z'}
        self.assertEqual(self.project([record(intervals=[visit]), record(intervals=[visit])])['attendance'][0]['seconds'], 600)
    def test_unresolved_identity_prevents_guessed_absence(self):
        self.assertEqual({p['status'] for p in self.project([record(email='')])['attendance']}, {'review'})
    def test_merged_reports_not_reused(self):
        row = record(); row['raw_data']['sourceAttendanceReportIds'] = ['A', 'B']
        self.assertFalse(self.project([row])['reportReady'])
    def test_files_follow_viewing_zone(self):
        files = [{'id': 'R14', 'created_datetime': '2026-10-13T23:30:00Z'}, {'id': 'R13', 'created_datetime': '2026-10-13T08:00:00Z'}]
        self.assertEqual([f['id'] for f in self.project([record()], files, 'Africa/Cairo')['artifacts']], ['R14'])
    def test_verified_alias_uses_assigned_learner(self):
        session = copy.deepcopy(SESSION); row = record('alias@example.invalid')
        session['identityCheck']['participants'].append({'kind': 'learner', 'expectedEmail': 'a@example.invalid',
            'accounts': [{'status': 'different-account', 'sourceRecordIds': [row['id']]}]})
        self.assertEqual(day_results(session, [row], [], DATE, 'UTC')['attendance'][0]['status'], 'present')
    def test_assigned_learner_is_not_removed_because_of_a_meeting_role(self):
        session = copy.deepcopy(SESSION)
        session['identityCheck']['participants'].append({'kind': 'staff', 'expectedEmail': 'a@example.invalid', 'roles': ['Co-organiser']})
        result = day_results(session, [record()], [], DATE, 'UTC')
        self.assertEqual(result['attendance'][0]['status'], 'present')
        self.assertEqual(len(result['attendance']), 2)
        self.assertNotIn('a@example.invalid', [p['email'] for p in result['staff']])
    def test_organizer_without_email_uses_confirmed_source_identity(self):
        session = copy.deepcopy(SESSION); row = record(email='', role='organizer')
        session['identityCheck']['participants'][0]['accounts'] = [{'sourceRecordIds': [row['id']]}]
        result = day_results(session, [row], [], DATE, 'UTC')
        self.assertEqual(result['staff'][0]['status'], 'joined')
        self.assertEqual(result['staff'][0]['seconds'], 600)
class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.query = {'moduleId': 'M', 'occurrenceId': 'O', 'date': DATE, 'timeZone': 'UTC'}
    def call(self, role='staff', query=None):
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role) if role else None):
            return lecture_day_results(RequestFactory().get('/day-results/', self.query if query is None else query), 'S', 2)
    @patch('curriculum_api.session_results.read')
    def test_forbidden_and_unauthenticated_do_not_read(self, read):
        for role in ['learner', 'employer', 'coach']:
            self.assertEqual(self.call(role).status_code, 403)
        self.assertEqual(self.call(None).status_code, 401)
        read.assert_not_called()
    def test_invalid_parameters(self):
        self.assertEqual(self.call(query={**self.query, 'timeZone': 'Invalid/Zone'}).status_code, 400)
        self.assertEqual(self.call(query={**self.query, 'moduleId': ''}).status_code, 400)
    @patch('curriculum_api.session_results.module_tutor_emails', return_value=[])
    @patch('curriculum_api.session_results.result_rows', side_effect=lambda *a, **k: [copy.deepcopy(SESSION)])
    @patch('curriculum_api.session_results.read', side_effect=[[{'id': 'S', 'module_catalogue_id': 'M'}], [record()], []])
    def test_allowed_exact_module_occurrence(self, read, results, tutors):
        response = self.call(); self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['date'], DATE)
        results.assert_called_once_with({'id': 'S', 'module_catalogue_id': 'M'}, session_number=2, identity=True, module_catalogue_id='M')
        self.assertTrue(all(call.args[0].lstrip().startswith('SELECT') for call in read.call_args_list))
    @patch('curriculum_api.session_results.result_rows', return_value=[SESSION])
    @patch('curriculum_api.session_results.read', return_value=[{'id': 'S'}])
    def test_wrong_occurrence_or_day_is_rejected(self, read, results):
        self.assertEqual(self.call(query={**self.query, 'occurrenceId': 'OTHER'}).status_code, 404)
        self.assertEqual(self.call(query={**self.query, 'date': '2026-10-13'}).status_code, 404)
