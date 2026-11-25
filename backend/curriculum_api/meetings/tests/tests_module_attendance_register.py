"""Real read SQL against synthetic SQLite data; no application database."""
from copy import deepcopy
from datetime import datetime, timezone
import sqlite3
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from curriculum_api.module_attendance_register import read_attendance
from curriculum_api import learner_activity_status as status

NOW = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)


class ModuleAttendanceRegisterTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            CREATE TABLE live_sessions (id text PRIMARY KEY,module_catalogue_id text,status text);
            CREATE TABLE live_session_occurrences (id text PRIMARY KEY,live_session_id text,
                session_number integer,scheduled_start text,scheduled_end text,status text);
            CREATE TABLE live_session_learner_attendance (occurrence_id text,live_session_id text,
                module_catalogue_id text,learner_profile_id integer,learner_email text,
                attendance_status text,attended_seconds integer,first_join_at text,last_leave_at text);
            CREATE TABLE learner_monthly_signatures (learner_id integer,report_month text,signature_data text,
                review_confirmed boolean,signed_at text,id integer);
            CREATE TABLE learner_monthly_locks (learner_id integer,report_month text,locked_at text,unlocked_at text);
            CREATE TABLE manual_month_finalization_events (id integer,aptem_id integer,report_month text,event_type text);
            CREATE TABLE monthly_audit_signoffs (learner_id text,report_month text,review_confirmed boolean);
            CREATE TABLE learners (id integer,aptem_id integer);
            INSERT INTO live_sessions VALUES ('S1','M1','active'),('OTHER','M2','active');
            INSERT INTO live_session_occurrences VALUES
                ('O1','S1',1,'2026-10-14T08:00:00Z','2026-10-14T10:00:00Z','completed'),
                ('O2','S1',2,'2026-10-21T08:00:00Z','2026-10-21T10:00:00Z','completed'),
                ('FOREIGN','OTHER',1,'2026-10-14T08:00:00Z','2026-10-14T10:00:00Z','completed');
        ''')
        self.plan = [{'learnerId': 11, 'componentId': 'C1', 'componentType': 'live_session'}]
        self.components = {'C1': {'id': 'C1', 'type': 'live_session',
                                  'settings_json': {'teamsOccurrenceId': 'O1'}}}

    def read(self, sql, params=()):
        return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params).fetchall()]

    @staticmethod
    def table(name, schema='Learner'):
        return f'"{name}"'

    def register(self, learner=11, occurrence='O1', series='S1', module='M1', outcome='present'):
        self.db.execute('INSERT INTO live_session_learner_attendance VALUES (?,?,?,?,?,?,?,?,?)',
            [occurrence, series, module, learner, 'guest-alias@example.test', outcome,
             7200 if outcome == 'present' else 0, '2026-10-14T08:00:00Z', '2026-10-14T10:00:00Z'])

    def project(self, *, now=NOW):
        return read_attendance(self.plan, self.components, 'M1', self.read, self.table, now=now)

    def test_resolved_guest_is_present_without_email_lookup_or_progress(self):
        self.register()
        before = list(self.db.iterdump())
        row = self.project()[('11', 'C1')]
        self.assertEqual(row['status'], 'present')
        self.assertEqual(row['attendedSeconds'], 7200)
        self.assertEqual(row['occurrenceId'], 'O1')
        self.assertEqual(row['sessionDate'], '2026-10-14')
        self.assertEqual(list(self.db.iterdump()), before)

    def test_absence_and_missing_register_are_distinct(self):
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unmarked')
        self.register(outcome='absent')
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'absent')

    def test_signed_month_preserves_oth_but_attendance_still_completes_the_activity(self):
        self.register()
        self.db.execute("INSERT INTO learner_monthly_signatures VALUES (11,'2026-10','{}',1,'2026-11-01',1)")
        record = {'id': 5, 'learner_id': 11, 'component_ref': 'C1', 'module_ref': 'M1',
                  'kind': 'component', 'accepted': True, 'actual_seconds': 7200, 'reporting_month': '2026-10'}
        payload = self.enrich([record])
        row = payload['learnerActivityPlan'][0]
        self.assertEqual(row['displayStatus'], 'completed')
        self.assertNotIn('creditedOtjh', row['registerAttendance'])
        self.assertEqual(payload['moduleProgressOtjh']['achievedTotal'], 2)

    def test_other_profile_module_occurrence_and_wrong_series_do_not_supply_attendance(self):
        self.register(learner=111)  # Enrolment/profile numbers are independent.
        self.register(module='M2')
        self.register(occurrence='O2')
        self.register(series='OTHER')
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unmarked')

    def test_shared_meeting_uses_only_the_destination_modules_register(self):
        self.components['C1']['settings_json'] = {'teamsOccurrenceId': 'FOREIGN'}
        self.register(occurrence='FOREIGN', series='OTHER', module='M2')
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unlinked')
        self.register(occurrence='FOREIGN', series='OTHER', outcome='absent')
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'absent')

    def test_session_number_and_legacy_identifiers_are_supported_without_cross_week_matching(self):
        self.register()
        self.components['C1']['settings_json'] = {'teamsLiveSessionId': 'S1', 'teamsSessionNumber': 2}
        row = self.project()[('11', 'C1')]
        self.assertEqual((row['occurrenceId'], row['status']), ('O2', 'unmarked'))
        self.components['C1']['settings_json'] = {'legacySettings': {'teamsOccurrenceId': 'O1'}}
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'present')

    def test_ambiguous_or_stale_link_is_not_replaced_by_a_name_or_date_guess(self):
        self.register()
        self.components['C1']['settings_json'] = {'teamsLiveSessionId': 'S1'}
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unlinked')
        self.components['C1']['settings_json'] = {'teamsOccurrenceId': 'REMOVED', 'sessionDate': '2026-10-14'}
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unlinked')
        self.components['C1']['settings_json'] = {'sessionDate': '2026-10-14'}
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'present')

    def test_future_active_and_cancelled_sessions_cannot_show_absence_or_completion(self):
        self.register(outcome='absent')
        for instant, expected in [('2026-10-14T07:00:00+00:00', 'upcoming'),
                                  ('2026-10-14T09:00:00+00:00', 'in_progress')]:
            self.assertEqual(self.project(now=datetime.fromisoformat(instant))[('11', 'C1')]['status'], expected)
        self.db.execute("UPDATE live_session_occurrences SET status='cancelled' WHERE id='O1'")
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'cancelled')

    def test_duplicate_register_results_do_not_choose_an_arbitrary_attendance(self):
        self.register()
        self.register(outcome='absent')
        self.assertEqual(self.project()[('11', 'C1')]['status'], 'unmarked')

    def test_read_is_batched_and_no_register_is_needed_for_non_attendance_activities(self):
        self.register()
        plan = [{**self.plan[0], 'learnerId': i} for i in range(1, 101)]
        with patch.object(self, 'read', wraps=self.read) as read:
            result = read_attendance(plan, self.components, 'M1', read, self.table, now=NOW)
        self.assertEqual(read.call_count, 3)  # Register plus batched signature/lock protection.
        self.assertEqual(len(result), 100)
        self.assertEqual(result[('11', 'C1')]['status'], 'present')
        self.assertEqual(result[('12', 'C1')]['status'], 'unmarked')
        with patch.object(self, 'read', side_effect=AssertionError('Unexpected read')) as read:
            self.assertEqual(read_attendance([{**self.plan[0], 'componentType': 'reading'}],
                                             self.components, 'M1', read, self.table), {})

    def test_enrichment_keeps_manual_completion_and_hours_separate_from_registered_absence(self):
        self.register(outcome='absent')
        record = {'id': 5, 'learner_id': 11, 'component_ref': 'C1', 'module_ref': 'M1',
                  'kind': 'component', 'source_system': 'synthetic', 'accepted': True,
                  'completed': True, 'actual_seconds': 4500, 'source_payload': {}}
        before = deepcopy(record)
        payload = self.enrich([record], [{'learner_id': 11, 'component_id': 'C1', 'display_status': 'completed', 'revision': 1}])
        row = payload['learnerActivityPlan'][0]
        self.assertEqual(row['registerAttendance']['status'], 'absent')
        self.assertEqual(row['displayStatus'], 'completed')
        self.assertEqual(row['logState']['acceptedOtjh'], 1.25)
        self.assertEqual(record, before)

    def enrich(self, records=(), overrides=(), learner_type='commercial'):
        learner_ids = sorted({row['learnerId'] for row in self.plan})
        def read(sql, params=()):
            if 'learner_monthly_signatures' in sql or 'learner_monthly_locks' in sql:
                return self.read(sql, params)
            if 'FROM "live_session_occurrences"' in sql:
                return self.read(sql, params)
            if 'learner_activity_display_overrides' in sql:
                return overrides
            if 'FROM "learners"' in sql:
                return [{'id': ident, 'enrolment_id': ident + 100, 'learner_type': learner_type} for ident in learner_ids]
            if 'FROM "modules"' in sql:
                return [{'module_catalogue_id': 'M1'}]
            if 'FROM "components"' in sql:
                return list(self.components.values())
            return []
        payload = {'identifier': 'M1', 'learnerActivityPlan': deepcopy(self.plan),
                   'otjhAchievement': {'learners': [{'learnerId': ident, 'plannedOtjh': 6} for ident in learner_ids]}}
        with patch.object(status.schema_gate, 'require_tables'), patch.object(status, 'table', self.table), \
             patch.object(status, 'load_records', return_value=records), patch.object(status, 'query', side_effect=read):
            status.enrich(payload, None)
        return payload

    def test_present_always_credits_150_minutes_regardless_of_raw_duration(self):
        self.register()
        for seconds in (0, 181, 7200, 12600):
            with self.subTest(seconds=seconds):
                self.db.execute('UPDATE live_session_learner_attendance SET attended_seconds=?', [seconds])
                before = list(self.db.iterdump())
                row = self.project()[('11', 'C1')]
                self.assertEqual(row['creditedOtjh'], 2.5)
                self.assertEqual(row['attendedSeconds'], seconds)
                self.assertEqual(list(self.db.iterdump()), before)

    def test_present_completes_activity_and_counts_even_with_an_old_not_started_override(self):
        self.register()
        self.plan += [{'learnerId': 11, 'componentId': 'READ', 'componentType': 'reading'},
                      {**self.plan[0], 'learnerId': 12}]
        overrides = [{'learner_id': 11, 'component_id': 'C1', 'display_status': 'not_started', 'revision': 1}]
        before = deepcopy(overrides)
        payload = self.enrich(overrides=overrides)
        lecture, reading, other_learner = payload['learnerActivityPlan']
        self.assertEqual((lecture['displayStatus'], lecture['calculatedStatus']), ('completed', 'completed'))
        self.assertEqual(lecture['statusSource'], 'attendance_register')
        self.assertFalse(lecture['canChangeStatus'])
        self.assertEqual(lecture['logState']['displayStatus'], 'not_started')
        self.assertEqual(reading['displayStatus'], 'not_started')
        self.assertEqual(other_learner['displayStatus'], 'not_started')
        self.assertEqual(payload['activityLogProgress']['completedActivities'], 1)
        self.assertEqual(payload['moduleProgressOtjh']['achievedTotal'], 2.5)
        self.assertEqual(overrides, before)

    def test_duplicate_activities_credit_one_lecture_once_for_each_learner(self):
        self.register()
        self.register(learner=12)
        self.register(occurrence='O2')
        self.components['C2'] = {**self.components['C1'], 'id': 'C2'}
        self.components['C3'] = {'id': 'C3', 'type': 'live_session', 'settings_json': {'teamsOccurrenceId': 'O2'}}
        self.plan += [{**self.plan[0], 'componentId': cid} for cid in ('C2', 'C3')]
        self.plan += [{**self.plan[0], 'learnerId': 12}]
        rows = self.project()
        self.assertEqual(rows[('11', 'C1')]['creditedOtjh'], 2.5)
        self.assertEqual(rows[('11', 'C2')]['creditedOtjh'], 0)
        self.assertEqual(rows[('11', 'C3')]['creditedOtjh'], 2.5)
        self.assertEqual(rows[('12', 'C1')]['creditedOtjh'], 2.5)
        self.assertEqual(self.enrich()['moduleProgressOtjh']['achievedTotal'], 7.5)

    def test_presence_replaces_saved_lecture_hours_without_changing_ledger_or_other_learner(self):
        self.register()
        self.plan += [{'learnerId': 11, 'componentId': 'READ', 'componentType': 'reading'},
                      {**self.plan[0], 'learnerId': 12}]
        records = [{'id': ident, 'learner_id': learner, 'component_ref': component, 'module_ref': 'M1',
                    'kind': 'staff_hours', 'source_system': 'staff', 'accepted': True, 'actual_seconds': seconds,
                    'source_payload': {'staff_time_entry': {'attendance_mode': 'recording'}}}
                   for ident, learner, component, seconds in [(1, 11, 'C1', 4500), (2, 11, 'READ', 900), (3, 12, 'C1', 1800)]]
        before = deepcopy(records)
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                payload = self.enrich(records, learner_type=kind)
                self.assertEqual([row['achievedOtjh'] for row in payload['moduleProgressOtjh']['learners']], [2.75, .5])
                self.assertEqual(payload['moduleProgressOtjh']['achievedTotal'], 3.25)
                self.assertEqual(payload['activityLogOtjh']['achievedTotal'], 2)
                self.assertEqual(payload['learnerActivityPlan'][0]['logState']['actualOtjh'], 1.25)
        self.assertEqual(records, before)

    def test_registered_absence_keeps_exact_entered_recording_time(self):
        self.register(outcome='absent')
        for seconds in (1800, 4517, 12600):
            with self.subTest(seconds=seconds):
                record = {'id': 1, 'learner_id': 11, 'component_ref': 'C1', 'module_ref': 'M1',
                          'kind': 'staff_hours', 'source_system': 'staff', 'accepted': True,
                          'actual_seconds': seconds, 'source_payload': {'staff_time_entry': {'attendance_mode': 'recording'}}}
                payload = self.enrich([record])
                row = payload['learnerActivityPlan'][0]
                self.assertEqual(row['registerAttendance']['status'], 'absent')
                self.assertNotIn('creditedOtjh', row['registerAttendance'])
                self.assertEqual(row['logState']['actualOtjh'], seconds / 3600)
                self.assertEqual(payload['moduleProgressOtjh']['achievedTotal'], seconds / 3600)

    def test_missing_saved_lecture_allocation_does_not_hide_verified_live_credit(self):
        self.register()
        record = {'id': 1, 'learner_id': 11, 'component_ref': 'C1', 'module_ref': 'M1',
                  'kind': 'component', 'source_system': 'synthetic', 'accepted': True, 'actual_seconds': None}
        payload = self.enrich([record])
        self.assertEqual(payload['activityLogOtjh']['unallocatedAcceptedRecords'], 1)
        self.assertEqual(payload['moduleProgressOtjh']['unallocatedAcceptedRecords'], 0)
        self.assertEqual(payload['moduleProgressOtjh']['achievedTotal'], 2.5)
        self.plan += [{'learnerId': 11, 'componentId': 'READ', 'componentType': 'reading'}]
        payload = self.enrich([record, {**record, 'id': 2, 'component_ref': 'READ'}])
        self.assertEqual(payload['moduleProgressOtjh']['unallocatedAcceptedRecords'], 1)

    def test_non_present_outcomes_never_receive_automatic_hours(self):
        for row in self.project().values():
            self.assertNotIn('creditedOtjh', row)
        self.register(outcome='absent')
        self.assertNotIn('creditedOtjh', self.project()[('11', 'C1')])
        self.db.execute("UPDATE live_session_learner_attendance SET attendance_status='present'")
        for instant in ('2026-10-14T07:00:00+00:00', '2026-10-14T09:00:00+00:00'):
            self.assertNotIn('creditedOtjh', self.project(now=datetime.fromisoformat(instant))[('11', 'C1')])
        self.db.execute("UPDATE live_session_occurrences SET status='cancelled' WHERE id='O1'")
        self.assertNotIn('creditedOtjh', self.project()[('11', 'C1')])

    def test_failed_read_is_visible_instead_of_fabricating_absence(self):
        with patch.object(self, 'read', side_effect=DatabaseError('synthetic failure')) as read:
            with self.assertRaises(DatabaseError):
                read_attendance(self.plan, self.components, 'M1', read, self.table)
