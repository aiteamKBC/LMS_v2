"""Attendance projections against private in-memory SQL fixtures; no live services."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api import monthly_logs as coach_logs
from old_otjh.service import ServiceError
from . import monthly_log_attendance as attendance, monthly_logs as logs
from .monthly_log_sources import row


class MonthlyLogAttendanceTests(SimpleTestCase):
    def setUp(self):
        # Every table is newly created in this connection's private RAM database.
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS curriculum;
            ATTACH DATABASE ':memory:' AS Learner;
            CREATE TABLE curriculum.live_session_learner_attendance (
                occurrence_id text,live_session_id text,module_catalogue_id text,learner_profile_id integer,
                attendance_status text,attended_seconds integer);
            CREATE TABLE curriculum.live_sessions (id text,module_catalogue_id text,status text);
            CREATE TABLE curriculum.modules (module_catalogue_id text PRIMARY KEY,title text);
            INSERT INTO curriculum.modules VALUES ('M1','Synthetic module'),('M2','Second module');
            CREATE TABLE curriculum.live_session_occurrences (
                id text,live_session_id text,session_number integer,scheduled_start text,scheduled_end text,status text);
            CREATE TABLE curriculum.components (id text,settings_json text);
            CREATE TABLE Learner.learners (id integer,aptem_id integer);
            INSERT INTO Learner.learners VALUES (70,7001),(80,8001);
            CREATE TABLE Learner.source_lms_attendance (source_key text,aptem_id integer);
            CREATE TABLE Learner.learner_progress_entries (
                source_payload text,time_tracking_session_ref text,module_ref text,component_ref text,
                curriculum_component_ref text,learner_id integer,deleted_at text,actual_seconds integer,
                source_system text,component_link_source text,kind text,submitted_at text,accepted boolean,actual_basis text);
            CREATE TABLE Learner.learner_monthly_signatures (
                id integer,learner_id integer,report_month text,signature_data text,review_confirmed boolean,signed_at text);
        ''')
        self.reader = self.enterContext(patch.object(attendance, 'query', side_effect=self.read))
        self.owner = {'id': 70, 'enrolment_id': 7, 'learner_type': 'apprenticeship'}
        self.learner = {'id': 7, 'name': 'Synthetic learner', 'programme': 'Programme',
                        '_canonical_profile': self.owner, '_profile': self.owner, '_view_as': False}
        self.now = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
        self.enterContext(patch.object(logs.timezone, 'now', return_value=self.now))

    def read(self, sql, params):
        self.assertTrue(sql.lstrip().upper().startswith('SELECT'))
        self.assertEqual(params, [self.owner['id']])
        if 'FROM curriculum.live_session_learner_attendance r' in sql:
            projection = "(o.scheduled_start AT TIME ZONE 'Europe/London')::date AS session_date"
            self.assertIn(projection, sql)
            self.assertNotIn('r.session_date', sql)
            # SQLite has no AT TIME ZONE; exercise the equivalent Python fallback.
            sql = sql.replace(projection, 'NULL AS session_date')
        if 'FROM "Learner".learner_progress_entries p' in sql:
            # Production deliberately transfers only the identity fields used
            # by represented(). SQLite fixtures retain the raw JSON columns so
            # the same matching rules can be exercised without PostgreSQL JSONB.
            self.assertIn("'original_source_ref',p.source_payload->'original_source_ref'", sql)
            self.assertIn("'teamsOccurrenceId',c.settings_json->'teamsOccurrenceId'", sql)
            start = sql.index('SELECT') + len('SELECT')
            marker = '\n        FROM "Learner".learner_progress_entries p'
            end = sql.index(marker)
            sql = (sql[:start]
                   + ' p.source_payload,p.time_tracking_session_ref,p.module_ref,'
                     'a.source_key AS kbc_attendance_key,c.settings_json '
                   + sql[end:])
        return [dict(record) for record in self.db.execute(sql.replace('%s', '?'), params)]

    def lecture(self, occurrence='O1', *, owner=70, status='present', start='2026-10-15T09:00:00+00:00',
                end='2026-10-15T11:00:00+00:00', module='M1', state='completed'):
        self.db.execute('INSERT INTO curriculum.live_sessions VALUES (?,?,?)',
                        [occurrence, module, 'active'])
        self.db.execute('INSERT INTO curriculum.live_session_occurrences VALUES (?,?,?,?,?,?)',
                        [occurrence, occurrence, 1, start, end, state])
        self.db.execute('INSERT INTO curriculum.live_session_learner_attendance VALUES (?,?,?,?,?,?)',
                        [occurrence, occurrence, module, owner, status, 240])

    def allocation(self, *, payload=None, session_ref='', settings=None, owner=70, seconds=3600,
                   deleted=None, accepted=True, basis=None):
        component = f'C{self.db.execute("SELECT count(*) FROM curriculum.components").fetchone()[0]}'
        self.db.execute('INSERT INTO curriculum.components VALUES (?,?)', [component, json.dumps(settings or {})])
        self.db.execute('''INSERT INTO Learner.learner_progress_entries
            (source_payload,time_tracking_session_ref,module_ref,component_ref,learner_id,actual_seconds,deleted_at,accepted,actual_basis)
            VALUES (?,?,?,?,?,?,?,?,?)''', [json.dumps(payload or {}), session_ref, 'M1', component,
                                           owner, seconds, deleted, accepted, basis])

    def signature(self, month='2026-10', *, rows=None, owner=70, ident=1, confirmed=True):
        capture = json.dumps({'rows': rows}) if rows is not None else 'data:image/png;base64,existing'
        self.db.execute('INSERT INTO Learner.learner_monthly_signatures VALUES (?,?,?,?,?,?)',
                        [ident, owner, month, capture, confirmed, f'2026-11-0{ident}'])

    def rows(self):
        return attendance.read_rows(self.owner, now=self.now)

    def test_present_uses_whole_lecture_and_lecture_date(self):
        self.lecture()
        item, = self.rows()
        self.assertEqual((item['actual_hours'], item['planned_hours']), (2, 2))
        self.assertEqual((item['activity_date'], item['reporting_month']), ('2026-10-15', '2026-10'))
        self.assertEqual(item['timestamp_label'], '10:00:00 - 12:00:00')
        self.assertEqual(item['source_ref'], 'attendance:O1')
        self.assertTrue(item['accepted'])
        self.assertEqual(self.rows(), [item])

    def test_module_title_uses_canonical_module_fk(self):
        self.lecture(module='M2')
        item, = self.rows()
        self.assertEqual(item['group_name'], 'Second module')
        self.assertTrue(item['title'].startswith('Second module'))

    def test_session_date_is_derived_from_occurrence_start_in_london(self):
        self.lecture()
        self.rows()
        sql = next(call.args[0] for call in self.reader.call_args_list
                   if 'FROM curriculum.live_session_learner_attendance r' in call.args[0])
        self.assertIn("(o.scheduled_start AT TIME ZONE 'Europe/London')::date AS session_date", sql)
        self.assertNotIn('r.session_date', sql)

    def test_owner_scope_for_both_learner_types_and_absence(self):
        self.lecture()
        self.lecture('other-learner', owner=80)
        self.lecture('absent', status='absent')
        self.signature(owner=80)
        self.allocation(owner=80, payload={'original_source_ref': 'attendance:O1'})
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.owner['learner_type'] = kind
                self.assertEqual([item['source_ref'] for item in self.rows()], ['attendance:O1'])

    def test_future_in_progress_cancelled_and_invalid_duration_are_not_credited(self):
        self.lecture('future', start='2026-11-08T09:00:00Z', end='2026-11-08T11:00:00Z')
        self.lecture('ongoing', start='2026-11-07T11:00:00Z', end='2026-11-07T13:00:00Z')
        self.lecture('cancelled', state='cancelled')
        self.lecture('bad', end='2026-10-15T08:00:00Z')
        self.lecture('missing', end=None)
        self.lecture('invalid-start', start='not-a-date')
        self.lecture('invalid-end', end='not-a-date')
        self.assertEqual(self.rows(), [])

    def test_shared_occurrence_counts_once_and_different_occurrence_survives(self):
        self.lecture()
        self.db.execute('''INSERT INTO curriculum.live_session_learner_attendance
            SELECT occurrence_id,live_session_id,'M2',learner_profile_id,attendance_status,attended_seconds
            FROM curriculum.live_session_learner_attendance''')
        self.lecture('O2')
        self.assertEqual(len(self.rows()), 2)
        self.assertEqual(sum(item['actual_hours'] for item in self.rows()), 4)

    def test_allocation_on_shared_module_prevents_duplicate_for_source_module(self):
        self.lecture()
        self.db.execute('''INSERT INTO curriculum.live_session_learner_attendance
            SELECT occurrence_id,live_session_id,'M2',learner_profile_id,attendance_status,attended_seconds
            FROM curriculum.live_session_learner_attendance''')
        self.allocation(settings={'teamsLiveSessionId': 'O1', 'teamsSessionNumber': 1})
        self.db.execute("UPDATE Learner.learner_progress_entries SET module_ref='M2'")
        self.assertEqual(self.rows(), [])

    def test_occurrence_date_is_used_instead_of_report_processing_time(self):
        self.lecture(start='2026-09-30T22:00:00Z', end='2026-10-01T00:00:00Z')
        item, = self.rows()
        self.assertEqual(item['reporting_month'], '2026-09')
        self.assertEqual(item['activity_date'], '2026-09-30')

    def test_unsigned_month_with_only_attendance_becomes_visible(self):
        self.lecture()
        with patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'activity_rows', return_value=[]), \
             patch.object(logs.canonical, 'targets', return_value={}):
            months = logs.current_months(self.learner, include_open=True)
        self.assertEqual(list(months), ['2026-10'])
        self.assertEqual(months['2026-10'][0]['actual_hours'], 2)

    def test_evidence_only_confirmation_does_not_suppress_full_lecture_hours(self):
        self.lecture()
        self.allocation(session_ref='teams:O1-2026-10-15', seconds=None)
        self.db.execute("UPDATE Learner.learner_progress_entries SET kind='activity_event'")
        self.assertEqual(self.rows()[0]['actual_hours'], 2)

    def test_unaccepted_zero_hours_do_not_hide_present_but_staff_correction_is_kept(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=0, accepted=False)
        self.assertEqual(self.rows()[0]['actual_hours'], 2)
        self.db.execute("UPDATE Learner.learner_progress_entries SET actual_basis='staff:module-progress'")
        self.assertEqual(self.rows(), [])

    def test_delayed_kbc_import_is_not_added_to_the_same_present_session_again(self):
        self.lecture()
        self.allocation(payload={'original_source_ref': 'att:known-key',
            'kbc_attendance': {'date': '2026-10-15', 'module': 'Synthetic module'}})
        self.db.execute("INSERT INTO Learner.source_lms_attendance VALUES ('known-key',7001)")
        self.assertEqual(self.rows(), [])
        # Date alone, an unvalidated key, or another module cannot consume a live session.
        self.db.execute('UPDATE Learner.source_lms_attendance SET aptem_id=8001')
        self.assertEqual(len(self.rows()), 1)
        self.db.execute('UPDATE Learner.source_lms_attendance SET aptem_id=7001')
        self.db.execute("UPDATE curriculum.modules SET title='Other module' WHERE module_catalogue_id='M1'")
        self.assertEqual(len(self.rows()), 1)

    def test_kbc_date_module_match_is_refused_for_multiple_live_occurrences(self):
        self.lecture()
        self.lecture('O2')
        self.allocation(payload={'original_source_ref': 'att:known-key',
            'kbc_attendance': {'date': '2026-10-15', 'module': 'Synthetic module'}})
        self.db.execute("INSERT INTO Learner.source_lms_attendance VALUES ('known-key',7001)")
        self.assertEqual(len(self.rows()), 2)

    def test_known_occurrence_allocations_and_zero_corrections_are_not_duplicated(self):
        self.lecture()
        cases = [
            {'payload': {'original_source_ref': 'attendance:O1'}},
            {'session_ref': 'teams:O1-2026-10-15'},
            {'payload': {'staff_time_entry': {'lecture_id': 'teams:O1-2026-10-15'}}, 'seconds': 0},
            {'settings': {'teamsOccurrenceId': 'O1'}},
            {'settings': {'legacySettings': {'teamsOccurrenceId': 'O1'}}},
            {'settings': {'teamsLiveSessionId': 'O1', 'teamsSessionNumber': 1}},
            {'settings': {'teamsLiveSessionId': 'O1', 'sessionDate': '2026-10-15'}},
        ]
        for case in cases:
            with self.subTest(case=case):
                self.db.execute('DELETE FROM Learner.learner_progress_entries')
                self.allocation(**case)
                self.assertEqual(self.rows(), [])

    def test_unlinked_different_occurrences_and_deleted_allocations_do_not_hide_attendance(self):
        self.lecture()
        self.allocation(payload={'title': 'Synthetic module'})
        self.allocation(settings={'teamsOccurrenceId': 'O2'})
        self.allocation(payload={'original_source_ref': 'attendance:O1'}, deleted='2026-10-16')
        self.assertEqual(len(self.rows()), 1)

    def test_uk_midnight_boundary_uses_london_calendar_date(self):
        self.lecture('boundary', start='2026-09-30T23:30:00Z', end='2026-10-01T01:30:00Z')
        item, = self.rows()
        self.assertEqual((item['activity_date'], item['reporting_month']), ('2026-10-01', '2026-10'))

    def test_dst_transitions_use_real_elapsed_duration(self):
        self.lecture('spring', start='2026-03-29T00:30:00Z', end='2026-03-29T02:30:00Z')
        self.lecture('autumn', start='2026-10-25T00:30:00Z', end='2026-10-25T02:30:00Z')
        spring, autumn = self.rows()
        self.assertEqual((spring['actual_hours'], spring['timestamp_label']), (2, '00:30:00 - 03:30:00'))
        self.assertEqual((autumn['actual_hours'], autumn['timestamp_label']), (2, '01:30:00 - 02:30:00'))

    def test_existing_signed_month_gets_no_new_attendance(self):
        self.lecture()
        self.signature()
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM Learner.learner_monthly_signatures').fetchone()[0], 1)

    def test_unconfirmed_capture_does_not_freeze_month(self):
        self.lecture()
        self.signature(confirmed=False)
        self.assertEqual(len(self.rows()), 1)

    def test_first_signature_keeps_attendance_after_register_changes_and_second_signature(self):
        self.lecture()
        reviewed = self.rows()
        original = deepcopy(reviewed)
        self.signature(rows=reviewed)
        self.db.execute("UPDATE curriculum.live_session_learner_attendance SET attendance_status='absent'")
        self.db.execute("UPDATE curriculum.live_session_occurrences SET scheduled_end='2026-10-15T14:00:00Z'")
        self.lecture('later-report')
        self.signature(rows=[{**reviewed[0], 'actual_hours': 99}], ident=2)
        self.assertEqual(self.rows(), original)
        self.assertEqual(reviewed, original)

    def test_a_later_capture_cannot_add_rows_to_an_already_signed_month(self):
        self.lecture()
        item, = self.rows()
        self.signature()
        self.signature(rows=[item], ident=2)
        self.assertEqual(self.rows(), [])

    def test_summary_detail_and_coach_year_include_the_same_attendance(self):
        self.lecture()
        learning = {**row('canonical:1', '2026-10-10', 'Reading', 'Reading', hours=1),
                    'reporting_month': '2026-10', 'progress_id': 1}
        record = {'id': 1, 'accepted': True, 'actual_seconds': 3600, 'ksbs': []}
        empty_lock = {'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}
        with patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'entries_for', return_value=[record]), \
             patch.object(logs.canonical, 'rows_for', return_value=[learning]), \
             patch.object(logs.canonical, 'activity_rows', return_value=[learning]), \
             patch.object(logs.canonical, 'targets_for', return_value={'2026-10': 10}), \
             patch.object(logs.canonical, 'targets', return_value={'2026-10': 10}), \
             patch.object(logs.canonical, 'signatures_for', return_value=[]), \
             patch.object(logs, 'signatures', return_value=[]), \
             patch.object(logs, 'lock_states', return_value={'2026-10': empty_lock}), \
             patch.object(logs, 'lock_state', return_value=empty_lock), \
             patch.object(logs.old_repo, 'query', return_value=[{'learner_start_date': None}]), \
             patch('learner_api.manual_time_corrections.annotate', side_effect=lambda _, report: report), \
             patch.object(coach_logs, 'pending_hour_records', return_value={70: []}), \
             patch.object(coach_logs, 'query', side_effect=[
                 [{'month': '2026-10', 'activities': 1, 'accepted_hours': 1}], []]):
            summary = logs.summary_data(self.learner, include_open=True)
            detail = logs.detail_data(self.learner, '2026-10', include_open=True)
            coach = coach_logs.project_year(self.learner, 2026)
        self.assertEqual(summary['months'][0]['actual_hours'], 3)
        self.assertEqual(summary['training_plan_totals']['accepted_hours'], 3)
        self.assertEqual((detail['row_count'], detail['actual_hours']), (2, 3))
        self.assertEqual((coach['months'][0]['activities'], coach['months'][0]['acceptedOtjhHours']), (2, 3))
        self.assertEqual(coach['summary']['acceptedOtjhHours'], 3)
        self.assertEqual(summary['training_plan_totals']['planned_hours'], 10)

    def test_content_preview_is_scoped_to_month_and_current_owner(self):
        self.lecture()
        item, = self.rows()
        with patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'content_row', side_effect=ServiceError('Missing', 'not_found', 404)):
            response = logs.content_response(self.learner, '2026-10', item['id'])
            self.assertIn('Full scheduled lecture hours', json.loads(response.content)['parts'][0]['html'])
            for month, ident in [('2026-09', item['id']), ('2026-10', item['id'] + 1)]:
                with self.assertRaises(ServiceError):
                    logs.content_response(self.learner, month, ident)
            self.owner['id'] = 80
            with self.assertRaises(ServiceError):
                logs.content_response(self.learner, '2026-10', item['id'])

    def test_content_does_not_mask_identity_or_source_failures(self):
        with patch.object(logs.canonical, 'enabled', return_value=True), \
             patch.object(logs.canonical, 'content_row', side_effect=ServiceError('Forbidden', 'forbidden', 403)):
            with self.assertRaises(ServiceError) as caught:
                logs.content_response(self.learner, '2026-10', 1)
        self.assertEqual(caught.exception.status, 403)
        self.reader.assert_not_called()
