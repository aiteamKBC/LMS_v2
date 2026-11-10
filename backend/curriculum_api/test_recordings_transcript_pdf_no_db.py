"""CI-discovered lecture PDFs: isolated SQLite reads, synthetic content, no network."""
from io import BytesIO
import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from pypdf import PdfReader
from login import permissions
from . import recordings_transcript_pdf as api

SCOPE = {'moduleId': 'M1', 'seriesId': 'S1', 'occurrenceId': 'O1'}


class LectureTranscriptPdfTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE curriculum.modules(module_catalogue_id TEXT,title TEXT,tutor_name TEXT,
                programme_name TEXT,cohort_name TEXT,group_name TEXT);
            CREATE TABLE curriculum.live_sessions(id TEXT,module_catalogue_id TEXT);
            CREATE TABLE curriculum.live_session_occurrences(id TEXT,live_session_id TEXT,scheduled_start TEXT,scheduled_end TEXT);
            CREATE TABLE curriculum.live_session_artifacts(id TEXT,occurrence_id TEXT,artifact_type TEXT,metadata TEXT,created_datetime TEXT);
            CREATE TABLE curriculum.session_result_archive(artifact_id TEXT,occurrence_id TEXT,status TEXT,transcript_text TEXT);
            INSERT INTO curriculum.modules VALUES('M1','Synthetic lecture','Synthetic Tutor','Synthetic programme','Cohort A','Group A');
            INSERT INTO curriculum.modules VALUES('M2','Other lecture','Other Tutor','Other programme','Cohort B','Group B');
            INSERT INTO curriculum.live_sessions VALUES('S1','M1'),('S2','M2');
            INSERT INTO curriculum.live_session_occurrences VALUES('O1','S1','2026-11-02T10:00:00Z','2026-11-02T11:00:00Z'),
                ('O2','S1','2026-11-03T10:00:00Z','2026-11-03T11:00:00Z'),
                ('O3','S2','2026-11-02T10:00:00Z','2026-11-02T11:00:00Z');''')
        self.part('T1', 'O1', 'Opening saved speech')
        self.part('T2', 'O1', 'Final saved speech')
        self.part('OTHER', 'O2', 'Another occurrence speech')
        self.part('OTHER-GROUP', 'O3', 'Another group speech')
        self.read = self.enterContext(patch.object(api, 'read', side_effect=lambda sql, params=():
            [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params)]))
        self.account = SimpleNamespace(role='staff', subject_type='staff', subject_id=1)
        self.auth = self.enterContext(patch.object(permissions, 'authenticate_request', side_effect=lambda request: self.account))
        self.access = self.enterContext(patch.object(permissions, '_accesses_of', return_value=frozenset({'curriculum'})))

    def part(self, artifact_id, occurrence, text, status='ready', metadata=None):
        self.db.execute('INSERT INTO curriculum.live_session_artifacts VALUES(?,?,?,?,?)',
                        [artifact_id, occurrence, 'transcript', json.dumps(metadata or {}), artifact_id])
        self.db.execute('INSERT INTO curriculum.session_result_archive VALUES(?,?,?,?)',
                        [artifact_id, occurrence, status, text])

    def get(self, scope=None):
        return api.lecture_transcript(RequestFactory().get('/', scope or SCOPE))

    def test_pdf_includes_every_saved_part_and_only_the_selected_lecture(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertIn('tutor-session-transcript.pdf', response['Content-Disposition'])
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
        for expected in ('Full Transcript', 'Synthetic lecture', 'Tutor: Synthetic Tutor', 'Group A',
                         'Opening saved speech', 'Final saved speech', 'Tutor Session'):
            self.assertIn(expected, text)
        self.assertNotIn('Another occurrence speech', text)
        self.assertNotIn('Another group speech', text)
        self.assertNotIn('Coach:', text)

    def test_existing_timeline_preserves_speaker_and_cue_times(self):
        self.db.execute('UPDATE curriculum.live_session_artifacts SET metadata=? WHERE id=?',
            [json.dumps({'lmsTranscriptTimeline': {'version': 1, 'cues': [
                {'start': -0.5, 'end': 1, 'speaker': 'Synthetic Tutor', 'text': 'Early saved speech'},
                {'start': 62.125, 'end': 65.25, 'speaker': 'Synthetic Tutor', 'text': 'Opening saved speech'}]}}), 'T1'])
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(self.get().content)).pages)
        self.assertIn('00:01:02.125 - 00:01:05.250', text)
        self.assertIn('-00:00:00.500 - 00:00:01.000', text)
        self.assertIn('Opening saved speech', text)
        self.assertIn('Final saved speech', text)

    def test_module_series_and_occurrence_must_belong_together(self):
        for key in SCOPE:
            with self.subTest(key=key):
                self.assertEqual(self.get({**SCOPE, key: 'OTHER'}).status_code, 404)
        self.assertEqual(self.get({**SCOPE, 'moduleId': 'M2'}).status_code, 404)
        self.assertEqual(self.get({**SCOPE, 'occurrenceId': 'O3'}).status_code, 404)

    def test_missing_and_incomplete_parts_are_explicit_and_never_an_empty_pdf(self):
        self.db.execute("DELETE FROM curriculum.live_session_artifacts WHERE occurrence_id='O1'")
        response = self.get()
        self.assertEqual(response.status_code, 404)
        self.assertIn('No saved transcript', json.loads(response.content)['error'])
        self.part('PENDING', 'O1', 'Still saving', status='pending')
        self.assertEqual(self.get().status_code, 409)
        self.db.execute("UPDATE curriculum.session_result_archive SET status='ready',transcript_text='' WHERE artifact_id='PENDING'")
        self.assertEqual(self.get().status_code, 409)

    def test_denies_unauthenticated_learners_employers_and_staff_without_access_before_read(self):
        self.auth.return_value = None
        self.auth.side_effect = None
        self.assertEqual(self.get().status_code, 401)
        for role in ('learner', 'employer'):
            self.auth.return_value = SimpleNamespace(role=role)
            self.assertEqual(self.get().status_code, 403)
        self.auth.return_value = self.account
        for access in ('coach', 'tutor', 'enrolment', ''):
            self.access.return_value = frozenset({access})
            self.assertEqual(self.get().status_code, 403)
        self.read.assert_not_called()
        self.access.return_value = frozenset({'super-admin'})
        self.assertEqual(self.get().status_code, 200)

    def test_invalid_scope_and_database_or_render_failures_remain_recoverable(self):
        for value in ('', 'x' * 129):
            self.assertEqual(self.get({**SCOPE, 'moduleId': value}).status_code, 400)
        self.read.assert_not_called()
        with patch.object(api, 'read', side_effect=DatabaseError('private detail')):
            response = self.get()
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private detail', response.content.decode())
        with patch('coach_api.recordings_pdf.lecture_transcript_pdf', side_effect=ValueError('private detail')):
            response = self.get()
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private detail', response.content.decode())
