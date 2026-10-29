"""Behavioral regression tests with a disposable in-memory SQLite register."""
import ast
import sqlite3
import unittest
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).parent


def functions(filename, names, namespace):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8-sig'))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=selected, type_ignores=[]), filename, 'exec'), namespace)
    return namespace


class SharedRegisterTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 29, tzinfo=timezone.utc)
        ns = functions('session_results_policy.py', {'instant'}, {'datetime': datetime, 'timezone': timezone})
        self.project = functions('shared_session_register.py', {'project_shared_attendance'},
                                 {'defaultdict': defaultdict, 'instant': ns['instant']})['project_shared_attendance']
        self.upsert = functions('live_session_register.py', {'register_params', 'upsert_live_session_register'},
                                {'REGISTER_TABLE': 'register'})['upsert_live_session_register']
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('''CREATE TABLE register (
            occurrence_id text, live_session_id text, module_catalogue_id text,
            learner_profile_id integer, learner_email text, learner_name text,
            attendance_status text, recovery_status text, attended_seconds integer,
            attendance_report_id text, first_join_at text, last_leave_at text,
            calculated_at text, updated_at text,
            UNIQUE(occurrence_id,learner_profile_id,module_catalogue_id))''')

    def session(self, **changes):
        person = {'email': 'learner@example.invalid', 'name': 'Synthetic learner',
                  'rawStatus': 'present', 'seconds': 300, 'recoveryStatus': 'none',
                  'intervals': [{'joinedAt': '2026-10-28T12:00:00Z', 'leftAt': '2026-10-28T12:05:00Z'}]}
        person.update(changes)
        return {'id': 'O', 'reportReady': True,
                'attendanceCandidates': [{'email': person['email'], 'learnerProfileId': 7}],
                'attendance': [person]}

    def project_rows(self, module='SHARED', session=None, corrections=None):
        return self.project(module, 'SOURCE-SERIES', [session or self.session()], {'O': 'REPORT'},
                            corrections or {}, self.now)

    def save(self, rows):
        db = self.db
        class Cursor:
            def executemany(self, sql, params):
                # SQLite spells a named PostgreSQL constraint as its columns.
                # Keep the same three-column uniqueness enforced by this fixture.
                sql = sql.replace('ON CONFLICT ON CONSTRAINT curriculum_live_learner_attendance_uniq',
                                  'ON CONFLICT (occurrence_id, learner_profile_id, module_catalogue_id)')
                db.executemany(sql.replace('%s', '?'), [tuple(
                    value.isoformat() if isinstance(value, datetime) else value for value in row) for row in params])
        return self.upsert(Cursor(), rows)

    def test_same_learner_and_meeting_have_independent_module_records(self):
        self.save(self.project_rows('SOURCE'))
        original = self.db.execute("SELECT * FROM register WHERE module_catalogue_id='SOURCE'").fetchone()
        self.save(self.project_rows())
        self.save(self.project_rows(session=self.session(rawStatus='absent', seconds=0)))
        self.assertEqual(self.db.execute('SELECT count(*) FROM register').fetchone()[0], 2)
        self.assertEqual(self.db.execute("SELECT * FROM register WHERE module_catalogue_id='SOURCE'").fetchone(), original)
        self.assertEqual(self.db.execute("SELECT attendance_status FROM register WHERE module_catalogue_id='SHARED'").fetchone()[0], 'absent')

    def test_completed_report_preserves_manual_decision_and_recovery(self):
        rows = self.project_rows(session=self.session(rawStatus='absent', seconds=0, recoveryStatus='requested'),
                                 corrections={('O', 7): 'present'})
        self.assertEqual((rows[0]['attendance_status'], rows[0]['attended_seconds'], rows[0]['recovery_status']),
                         ('present', 0, 'requested'))
        self.assertEqual(self.project_rows(session=self.session(rawStatus='absent', seconds=0))[0]['attendance_status'], 'absent')

    def test_unfinished_reports_and_unresolved_identities_are_not_absences(self):
        session = self.session()
        session['reportReady'] = False
        self.assertEqual(self.project_rows(session=session), [])
        self.assertEqual(self.project_rows(session=self.session(rawStatus='review', seconds=0)), [])
        self.assertEqual(self.project('SHARED', 'S', [self.session()], {}, {}, self.now), [])

    def test_unassigned_and_ambiguous_profiles_are_not_saved(self):
        session = self.session()
        session['attendanceCandidates'] = []
        self.assertEqual(self.project_rows(session=session), [])
        session['attendanceCandidates'] = [{'email': 'learner@example.invalid', 'learnerProfileId': value} for value in [7, 8]]
        self.assertEqual(self.project_rows(session=session), [])

    def test_evidence_identity_and_intervals_are_retained(self):
        row = self.project_rows()[0]
        self.assertEqual((row['occurrence_id'], row['live_session_id'], row['attendance_report_id']),
                         ('O', 'SOURCE-SERIES', 'REPORT'))
        self.assertEqual((row['last_leave_at']-row['first_join_at']).total_seconds(), 300)


if __name__ == '__main__':
    unittest.main(verbosity=2)
