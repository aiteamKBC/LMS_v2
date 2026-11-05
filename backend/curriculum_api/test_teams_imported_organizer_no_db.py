"""Saved Microsoft organiser identity checks; execute only on an explicit Teams test request."""
import copy
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('imported_organizer_checks',
                                            Path(__file__).with_name('teams_imported_organizer.py'))
organizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(organizer)


class SavedOrganizerTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.context = {'Oid': '11111111-2222-3333-4444-555555555555', 'Tid': 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}
        self.series = {'id': 'LIVE-1', 'online_meeting_id': 'ONLINE-1', 'join_url': 'https://teams.microsoft.com/example',
                       'organizer_email': 'channel@example.invalid'}
        self.recording = {'meeting_id': 'ONLINE-1', 'organizer_id': self.context['Oid'],
                          'organizer_tenant_id': self.context['Tid'], 'organizer_name': '',
                          'evidence_at': '2026-10-09T12:00:00Z'}
        self.attendance = {'identity_id': self.context['Oid'], 'identity_tenant_id': self.context['Tid'],
                           'raw_role': 'Organizer', 'raw_email': 'Host@Example.invalid', 'raw_name': 'Original display name',
                           'email': 'incorrect-lms-alias@example.invalid', 'display_name': 'Resolved LMS name',
                           'evidence_at': '2026-10-09T11:00:00Z'}

    def report(self, recordings=None, attendance=None, context=None):
        return organizer.saved_organizer_report(self.series, context or self.context,
            {'recordings': [self.recording] if recordings is None else recordings,
             'attendance': [self.attendance] if attendance is None else attendance})

    def test_recording_owner_and_original_attendance_identify_saved_person_without_lms_aliases(self):
        before = copy.deepcopy((self.series, self.recording, self.attendance))
        result = self.report()
        self.assertEqual(result['status'], 'available')
        self.assertEqual(result['source'], 'saved_microsoft_records')
        self.assertEqual(result['person'], {'name': 'Original display name', 'email': 'host@example.invalid'})
        self.assertEqual(result['objectId'], self.context['Oid'])
        self.assertEqual(result['evidenceAt'], '2026-10-09T12:00:00Z')
        self.assertNotIn('verifiedAt', result)
        self.assertIn('saved evidence', result['message'])
        self.assertEqual(before, (self.series, self.recording, self.attendance))

    def test_attendance_role_alone_cannot_prove_series_organizer(self):
        result = self.report(recordings=[])
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('person', result)

    def test_wrong_meeting_recording_cannot_prove_owner(self):
        result = self.report(recordings=[{**self.recording, 'meeting_id': 'OTHER-MEETING'}])
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('person', result)

    def test_mismatched_recording_owner_or_tenant_is_ambiguous(self):
        for key in ('organizer_id', 'organizer_tenant_id'):
            with self.subTest(key=key):
                result = self.report(recordings=[self.recording, {**self.recording, key: 'different'}])
                self.assertEqual(result['status'], 'ambiguous')
                self.assertNotIn('person', result)

    def test_missing_join_tenant_cannot_confirm_recording_identity(self):
        self.assertEqual(self.report(context={'Oid': self.context['Oid']})['status'], 'unavailable')

    def test_unrelated_identity_and_presenter_role_are_not_the_organizer_name(self):
        for changed in ({'identity_id': 'other'}, {'raw_role': 'Presenter'}):
            with self.subTest(changed=changed):
                result = self.report(attendance=[{**self.attendance, **changed}])
                self.assertEqual(result['status'], 'partial')
                self.assertNotIn('person', result)
                self.assertEqual(result['objectId'], self.context['Oid'])

    def test_conflicting_original_emails_are_not_resolved_by_guessing(self):
        result = self.report(attendance=[self.attendance, {**self.attendance, 'raw_email': 'different@example.invalid'}])
        self.assertEqual(result['status'], 'ambiguous')
        self.assertNotIn('person', result)

    def test_saved_recording_identity_can_remain_partial_without_email(self):
        result = self.report(recordings=[{**self.recording, 'organizer_name': 'Microsoft name'}], attendance=[])
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(result['person'], {'name': 'Microsoft name', 'email': ''})

    def test_loader_uses_only_selects_scoped_to_exact_series_meeting_link_and_raw_identity(self):
        calls = []
        class Cursor:
            def __enter__(cursor):
                return cursor
            def __exit__(cursor, *args):
                return False
            def execute(cursor, sql, params):
                calls.append((sql, params))
                cursor.rows = [self.recording] if len(calls) == 1 else [self.attendance]
                cursor.fields = list(cursor.rows[0])
                cursor.description = [(field,) for field in cursor.fields]
            def fetchall(cursor):
                return [tuple(row[field] for field in cursor.fields) for row in cursor.rows]
        connection = types.SimpleNamespace(vendor='postgresql', cursor=Cursor)
        db = types.ModuleType('django.db')
        db.connection = connection
        with patch.dict(sys.modules, {'django': types.ModuleType('django'), 'django.db': db}):
            result = organizer.load_saved_organizer_evidence(self.series, self.context)
        self.assertEqual(len(result['recordings']), 1)
        self.assertEqual(len(calls), 2)
        for sql, params in calls:
            self.assertTrue(sql.lstrip().startswith('SELECT'))
            self.assertIn('o.live_session_id=%s', sql)
            self.assertEqual(params[:5], ['LIVE-1', 'ONLINE-1', 'ONLINE-1', self.series['join_url'], self.series['join_url']])
            self.assertNotIn('SELECT *', sql)
            self.assertNotIn('content_url', sql)
        self.assertIn("a.raw_data->>'emailAddress'", calls[1][0])
        self.assertNotIn('a.email', calls[1][0])
        self.assertEqual(calls[1][1][-1], self.context['Oid'])


if __name__ == '__main__':
    unittest.main()
