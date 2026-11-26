"""Saved-evidence PDF regressions; run with backend/.venv Python. No DB/network."""
import io
import unittest
from unittest.mock import patch

from test_session_results_no_db import session_roster, session_runs
from curriculum_api.session_attendance_pdf import build_attendance_pdf, report_time
from pypdf import PdfReader


def sample_session(count=2):
    attendance = session_roster(['absent@example.invalid'], [
        {'id': str(index), 'email': f'learner{index}@example.invalid', 'display_name': f'Example Learner {index}',
         'intervals': [{'joinDateTime': '2026-09-16T09:00Z', 'leaveDateTime': '2026-09-16T09:10Z'},
                       {'joinDateTime': '2026-09-16T09:12Z', 'leaveDateTime': '2026-09-16T09:20Z'}]}
        for index in range(count)], complete=True)
    return {'sessionNumber': 6, 'title': 'Project planning - Example lecture', 'startsAt': '2026-09-17T09:00Z',
            'endsAt': '2026-09-17T11:00Z', 'reportReady': True,
            'runs': [{'startsAt': '2026-09-16T09:00Z', 'endsAt': '2026-09-16T09:20Z'}], 'attendance': attendance}


class AttendancePdfTests(unittest.TestCase):
    def test_pdf_contains_lecture_actual_times_reconnects_and_saved_status(self):
        pdf = PdfReader(io.BytesIO(build_attendance_pdf(sample_session())))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        for expected in ('Project planning', 'Session 6', '17/09/2026 10:00:00 BST',
                         '16/09/2026 10:12:00 BST', '18m 0s', 'Present', 'Absent', 'Example Learner 1'):
            self.assertIn(expected, text)

    def test_multiple_runs_keep_their_distinct_dates_and_deduplicate_reports(self):
        record = {'raw_data': {'attendanceReportStart': '2026-09-16T09:00Z', 'attendanceReportEnd': '2026-09-16T10:00Z'}}
        later = {'raw_data': {'attendanceReportStart': '2026-09-17T09:00Z', 'attendanceReportEnd': '2026-09-17T10:00Z'}}
        self.assertEqual(len(session_runs({}, [record, record, later])), 2)
        self.assertEqual(session_runs({}, []), [])

    def test_large_report_repeats_headers_and_keeps_final_participant(self):
        pdf = PdfReader(io.BytesIO(build_attendance_pdf(sample_session(45))))
        self.assertGreater(len(pdf.pages), 1)
        self.assertTrue(all('Participant' in page.extract_text() for page in pdf.pages))
        self.assertIn('Example Learner 44', ''.join(page.extract_text() for page in pdf.pages))
        self.assertTrue(all(f'Page {index}' in page.extract_text() for index, page in enumerate(pdf.pages, 1)))

    def test_html_is_literal_and_pending_does_not_become_absence(self):
        session = sample_session(0)
        session['title'] = '<img src="https://example.invalid/x">'
        session['reportReady'] = False
        session['attendance'] = session_roster(['waiting@example.invalid'], [], complete=False)
        text = PdfReader(io.BytesIO(build_attendance_pdf(session))).pages[0].extract_text()
        self.assertIn('<img src=', text)
        self.assertIn('Awaiting report', text)
        self.assertNotIn('Absent', text)
        self.assertIn('GMT', report_time('2026-10-25T01:30:00Z'))


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
