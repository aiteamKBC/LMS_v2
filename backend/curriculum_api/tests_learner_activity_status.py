"""Real SQL/rollback tests in a private in-memory SQLite database. No live DB."""
import importlib
import json
import sqlite3
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from old_otjh.service import ServiceError
from . import learner_activity_status as status
from learner_api.current_learning import project_current


class ActivityStatusTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            CREATE TABLE Created_users (id integer primary key);
            CREATE TABLE learners (id integer primary key);
            INSERT INTO Created_users VALUES (91);
            INSERT INTO learners VALUES (1);
            CREATE TABLE learner_progress_entries (
                id integer primary key autoincrement,learner_id integer,enrolment_id integer,
                entry_order integer,kind text,module_ref text,module_title text,week_ref text,
                component_ref text,curriculum_component_ref text,component_title text,component_type text,expected_otjh numeric,
                actual_seconds integer,actual_basis text,reporting_started_at timestamp,
                reporting_ended_at timestamp,reporting_month text,reporting_timestamp_label text,
                source_system text,canonical_activity_key text,component_link_source text,
                component_link_status text,accepted boolean,deleted_at timestamp,
                submitted_at timestamp,passed boolean,feedback text,ssot_updated_at timestamp,source_payload text,
                feed_kind text,feed_action text,feed_title text,time_tracking_source text,time_tracking_session_ref text,
                time_tracking_calculation text,claimed_seconds integer
            );
            CREATE TABLE live_sessions (id text,module_catalogue_id text,status text);
            CREATE TABLE live_session_occurrences (id text,live_session_id text,scheduled_start text,scheduled_end text,status text);
            CREATE TABLE live_session_learner_attendance (occurrence_id text,learner_profile_id integer,attendance_status text);
            CREATE TABLE live_session_attendance (occurrence_id text,email text,total_attendance_seconds integer);
            CREATE TABLE learner_monthly_locks (learner_id integer,report_month text,locked_at text,unlocked_at text);
            CREATE TABLE learner_monthly_signatures (learner_id integer,report_month text,review_confirmed boolean);
            CREATE TABLE manual_month_finalization_events (id integer,aptem_id integer,report_month text,event_type text);
            CREATE TABLE monthly_audit_signoffs (learner_id text,report_month text,review_confirmed boolean);
        ''')
        migration = importlib.import_module('curriculum_api.migrations.0070_learner_activity_display_overrides')
        wrapper = SimpleNamespace(vendor='sqlite', cursor=lambda: self.db)
        # Migration uses a cursor context manager; sqlite cursors do not.
        class CursorContext:
            def __enter__(inner): return self.db.cursor()
            def __exit__(inner, *args): pass
        migration.provision(None, SimpleNamespace(connection=SimpleNamespace(vendor='sqlite', cursor=CursorContext)))
        self.db.commit()
        self.owner = {'id': 1, 'enrolment_id': 91, 'start_date': '2026-01-01', 'end_date': '2026-12-31', 'aptem_id': 100}
        self.component = {'id': 'c1', 'type': 'reading', 'title': 'Synthetic reading', 'week_id': 'w1', 'expected_otjh': 1}
        self.actor = SimpleNamespace(id=7, email='coach@example.com')
        self.patches = [
            patch.object(status, 'connection', wrapper),
            patch.object(status, 'query', self.query),
            patch.object(status.schema_gate, 'require_tables'),
            patch.object(status, 'resolve', return_value=(self.owner, {'title': 'Module', 'module_catalogue_id': 'MOD-1'}, self.component)),
            patch.object(status.transaction, 'atomic', side_effect=lambda: self.db),
            patch('learner_api.working_hours_holidays.component_holiday_ranges', return_value=[]),
            patch('curriculum_api.views.invalidate_curriculum_cache'),
        ]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.addCleanup(self.db.close)

    def query(self, sql, params=()):
        values = [int(value) if type(value) is bool else value for value in params]
        cursor = self.db.execute(sql.replace('%s', '?'), values)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        for row in rows:
            if 'accepted' in row and row['accepted'] is not None: row['accepted'] = bool(row['accepted'])
        return rows

    def payload(self, target='completed'):
        records = status.load_records([1], ['c1'])
        override = self.query('SELECT * FROM learner_activity_display_overrides WHERE learner_id=1 AND component_id=\'c1\'')
        state = status.facts(records, override[0] if override else None)
        result = {'displayStatus': target, 'expectedRevision': state['revision'], 'snapshotHash': state['snapshotHash'], 'reason': 'Staff reviewed the activity.'}
        if target == 'completed': result.update(durationSeconds=3617, startedAt='2026-10-01T10:04:13+01:00')
        return result

    def save(self, payload): return status.save(self.actor, 'MOD-1', 1, 'c1', payload)

    def test_completed_creates_declared_hours_once_and_reload_keeps_status(self):
        state = self.save(self.payload())
        self.assertEqual(state['revision'], 1)
        self.assertEqual(state['displayStatus'], 'completed')
        rows = self.query('SELECT * FROM learner_progress_entries')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['actual_seconds'], 3617)
        self.assertEqual(rows[0]['actual_basis'], 'staff:module-progress')
        self.assertIsNone(rows[0]['passed'])
        self.assertIsNone(rows[0]['submitted_at'])
        self.assertEqual((datetime.fromisoformat(rows[0]['reporting_ended_at']) - datetime.fromisoformat(rows[0]['reporting_started_at'])).total_seconds(), 3617)
        self.save(self.payload())
        self.assertEqual(len(self.query('SELECT * FROM learner_progress_entries')), 1)

    def test_input_saves_only_date_and_duration_without_fabricated_times_or_a_reason_prompt(self):
        payload=self.payload()
        del payload['startedAt']; del payload['reason']
        payload.update(timeEntryMode='input',activityDate='2026-10-01')
        state=self.save(payload)
        row=self.query('SELECT * FROM learner_progress_entries')[0]
        self.assertEqual(row['reporting_month'],'2026-10')
        self.assertEqual(row['reporting_timestamp_label'],'Input')
        self.assertIsNone(row['reporting_started_at']); self.assertIsNone(row['reporting_ended_at'])
        self.assertEqual(state['activityDate'],'2026-10-01'); self.assertEqual(state['timeEntryMode'],'input')
        self.assertEqual(row['actual_seconds'],3617)
        state=self.save(self.payload('not_started'))
        self.assertEqual(state['activityDate'],'2026-10-01')
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries')[0],row)
        audit=self.query('SELECT reason,actor_id FROM learner_activity_display_audit ORDER BY revision')[0]
        self.assertEqual(audit['actor_id'],7); self.assertIn('input time entry',audit['reason'])

    def test_changing_to_input_clears_only_reporting_times_and_preserves_original_source_and_evidence_fields(self):
        self.save(self.payload())
        self.db.execute('UPDATE learner_progress_entries SET source_payload=?,submitted_at=?,feedback=?', [json.dumps({'evidence_id':'e1','original_date':'2026-09-20'}),'2026-10-01T10:00:00Z','Existing feedback'])
        self.db.commit()
        payload=self.payload(); del payload['startedAt']
        payload.update(timeEntryMode='input',activityDate='2026-10-02')
        self.save(payload)
        row=self.query('SELECT * FROM learner_progress_entries')[0]
        self.assertIsNone(row['reporting_started_at']); self.assertIsNone(row['reporting_ended_at'])
        metadata=json.loads(row['source_payload'])
        self.assertEqual(metadata['evidence_id'],'e1'); self.assertEqual(metadata['original_date'],'2026-09-20')
        self.assertEqual(row['submitted_at'],'2026-10-01T10:00:00Z'); self.assertEqual(row['feedback'],'Existing feedback')

    def test_input_refuses_invalid_dates_clocks_signed_months_and_extra_not_started_fields(self):
        base=self.payload(); del base['startedAt']; base['timeEntryMode']='input'
        for day in ('2026-02-30','2026-10-03','2027-01-01',None):
            with self.assertRaises(ServiceError): self.save({**base,'activityDate':day})
        with self.assertRaises(ServiceError): self.save({**base,'activityDate':'2026-10-01','startedAt':'2026-10-01T10:00:00Z'})
        with self.assertRaises(ServiceError): self.save({**self.payload('not_started'),'activityDate':'2026-10-01'})
        self.db.execute("INSERT INTO learner_monthly_signatures VALUES (1,'2026-10',true)");self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save({**base,'activityDate':'2026-10-01'})
        self.assertEqual(error.exception.code,'month_signed')

    def test_not_started_preserves_hours_and_all_original_progress_and_other_learner(self):
        self.save(self.payload())
        self.db.execute("INSERT INTO learner_progress_entries (learner_id,entry_order,component_ref,actual_seconds,accepted) VALUES (2,1,'c1',800,true)")
        self.db.commit()
        before = self.query('SELECT * FROM learner_progress_entries ORDER BY id')
        state = self.save(self.payload('not_started'))
        self.assertEqual(state['displayStatus'], 'not_started')
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries ORDER BY id'), before)
        self.assertAlmostEqual(state['acceptedOtjh'], 3617 / 3600)
        audit = self.query('SELECT * FROM learner_activity_display_audit ORDER BY revision')
        self.assertEqual(len(audit), 2)
        self.assertEqual(audit[1]['actor_id'], 7)
        self.assertEqual(json.loads(audit[1]['before_snapshot'])['progress'], json.loads(audit[1]['after_snapshot'])['progress'])

    def test_existing_unaccepted_result_and_feedback_are_preserved(self):
        self.db.execute("INSERT INTO learner_progress_entries (learner_id,entry_order,component_ref,component_type,actual_seconds,accepted,passed,feedback,reporting_month) VALUES (1,1,'c1','quiz',700,false,false,'Original feedback','2026-10')")
        self.db.commit()
        self.save(self.payload())
        row = self.query('SELECT * FROM learner_progress_entries')[0]
        self.assertFalse(row['accepted'])
        self.assertEqual(row['passed'], 0)
        self.assertEqual(row['feedback'], 'Original feedback')

    def test_stale_override_or_progress_cannot_overwrite(self):
        stale = self.payload()
        self.save(stale)
        with self.assertRaises(ServiceError) as failure: self.save(stale)
        self.assertEqual(failure.exception.code, 'record_changed')
        fresh = self.payload()
        self.db.execute('UPDATE learner_progress_entries SET feedback=\'Concurrent edit\''); self.db.commit()
        with self.assertRaises(ServiceError): self.save(fresh)
        self.assertEqual(len(self.query('SELECT * FROM learner_activity_display_audit')), 1)

    def test_audit_failure_rolls_back_both_progress_and_override(self):
        original = status.query
        def fail(sql, params=()):
            if 'INSERT INTO "learner_activity_display_audit"' in sql: raise DatabaseError('Audit unavailable')
            return original(sql, params)
        payload = self.payload()
        with patch.object(status, 'query', side_effect=fail), self.assertRaises(DatabaseError): self.save(payload)
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries'), [])
        self.assertEqual(self.query('SELECT * FROM learner_activity_display_overrides'), [])

    def test_signed_locked_and_finalized_months_refuse_hours_but_status_reset_is_safe(self):
        self.save(self.payload())
        self.db.execute("INSERT INTO learner_monthly_signatures VALUES (1,'2026-10',true)"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(self.payload())
        self.assertEqual(error.exception.code, 'month_signed')
        self.save(self.payload('not_started'))
        self.db.execute('DELETE FROM learner_monthly_signatures')
        self.db.execute("INSERT INTO learner_monthly_locks VALUES (1,'2026-10','2026-10-02',NULL)"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(self.payload())
        self.assertEqual(error.exception.code, 'month_locked')
        self.db.execute('DELETE FROM learner_monthly_locks')
        self.db.execute("INSERT INTO manual_month_finalization_events VALUES (1,100,'2026-10','finalized')"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(self.payload())
        self.assertEqual(error.exception.code, 'month_finalized')

    def test_attendance_holiday_invalid_duration_and_month_move_are_rejected(self):
        self.component['type'] = 'live_session'
        with self.assertRaises(ServiceError): self.save(self.payload())
        self.component['type'] = 'reading'
        for duration in (0, -1, 28801, True, 1.5):
            with self.assertRaises(ServiceError): self.save({**self.payload(), 'durationSeconds': duration})
        with patch('learner_api.working_hours_holidays.component_holiday_ranges', return_value=[{'start':'2026-10-01','end':'2026-10-01'}]), self.assertRaises(ServiceError): self.save(self.payload())
        self.save(self.payload())
        with self.assertRaises(ServiceError) as error: self.save({**self.payload(), 'startedAt':'2026-09-01T10:04:13+01:00'})
        self.assertEqual(error.exception.code, 'month_change')

    def test_permissions_require_actual_curriculum_grant_or_owned_coach_tutor(self):
        for grants, coach, tutor, expected in (
            ({'curriculum'}, '', '', True), ({'super-admin'}, '', '', True),
            ({'coach'}, 'coach@example.com', '', True), ({'coach'}, 'someone@example.com', '', False),
            ({'tutor'}, '', 'coach@example.com', True), ({'tutor'}, '', 'someone@example.com', False),
            (set(), 'coach@example.com', 'coach@example.com', False),
        ):
            with patch.object(status, '_accesses_of', return_value=grants):
                self.assertEqual(status.allowed(self.actor, {'coach_email': coach}, {'tutor_email': tutor}), expected)

    def test_bst_gmt_and_programme_boundaries(self):
        summer = status.interval({'durationSeconds': 1800, 'startedAt': '2026-07-01T09:00:00+01:00'}, self.owner)
        winter = status.interval({'durationSeconds': 1800, 'startedAt': '2026-01-02T09:00:00+00:00'}, self.owner)
        self.assertEqual(summer[1].astimezone(timezone.utc).hour, 8)
        self.assertEqual(winter[1].astimezone(timezone.utc).hour, 9)
        with self.assertRaises(ServiceError): status.interval({'durationSeconds': 1800, 'startedAt': '2025-12-31T10:00:00Z'}, self.owner)

    def test_manual_allocation_suppresses_only_its_native_retry_hours(self):
        at = datetime(2026, 1, 2, 10, tzinfo=timezone.utc)
        native = {'id': 1, 'learner_id': 1, 'component_ref': 'c1', 'component_link_source': 'direct', 'kind': 'component', 'submitted_at': at, 'time_taken':'10:00', 'accepted':True}
        manual = {**native, 'id': 2, 'source_system':'staff', 'actual_seconds': 1800, 'actual_basis':'staff:module-progress'}
        other = {**native, 'id':3, 'component_ref':'c2'}
        result = project_current([native, manual, other], {})
        self.assertEqual([row['id'] for row in result], [2, 3])
        self.assertEqual(native['time_taken'], '10:00')

    def test_missing_duration_is_unknown_and_native_submission_is_not_a_scheduled_interval(self):
        raw = {'id': 1, 'learner_id': 1, 'component_ref': 'c1', 'component_link_source': 'direct', 'kind':'component',
               'submitted_at': datetime(2026, 1, 2, 10, tzinfo=timezone.utc), 'accepted': True}
        state = status.facts([raw])
        self.assertIsNone(state['actualOtjh'])
        self.assertIsNone(state['acceptedOtjh'])
        self.assertIsNone(state['startedAt'])

    def test_enrichment_queries_are_bounded_and_unstarted_rows_and_log_totals_remain_consistent(self):
        payload = {'identifier':'MOD-1', 'otjhAchievement':{'learners':[{'learnerId':1,'plannedOtjh':100}]},
            'learnerActivityPlan':[{'learnerId':1,'componentId':f'c{i}','componentType':'reading'} for i in range(100)]}
        def bulk(sql, params=()):
            if 'learner_progress_entries' in sql: return [{'id':1,'learner_id':1,'component_ref':'c0','actual_seconds':3600,'accepted':True}]
            if 'learner_activity_display_overrides' in sql: return [{'learner_id':1,'component_id':'c0','revision':1,'display_status':'not_started'}]
            if 'learners' in sql: return [{'id':1,'coach_email':'coach@example.com'}]
            if 'modules' in sql: return [{'tutor_email':''}]
            return []
        with patch.object(status,'query',side_effect=bulk) as read, patch.object(status,'_accesses_of',return_value={'curriculum'}) as grants:
            status.enrich(payload,self.actor)
        self.assertEqual(read.call_count,4)
        self.assertEqual(grants.call_count,1)
        self.assertEqual(len(payload['learnerActivityPlan']),100)
        self.assertEqual(payload['learnerActivityPlan'][0]['displayStatus'],'not_started')
        self.assertEqual(payload['learnerActivityPlan'][1]['calculatedStatus'],'not_started')
        self.assertEqual(payload['activityLogOtjh']['achievedTotal'],1)

    def test_endpoint_denies_unauthenticated_and_unauthorized_roles_and_preserves_csrf(self):
        factory = RequestFactory()
        for role, grants, expected in [('learner',{'curriculum'},403),('employer',{'curriculum'},403),('staff',set(),403),('staff',{'coach'},200)]:
            account = SimpleNamespace(id=7,email='coach@example.com',role=role)
            with patch('login.permissions.authenticate_request',return_value=account), patch('login.permissions._accesses_of',return_value=grants):
                request=factory.get('/status/')
                request.login_account=account
                response=status.activity_status(request,'MOD-1',1,'c1')
                self.assertEqual(response.status_code,expected)
        with patch('login.permissions.authenticate_request',return_value=None):
            self.assertEqual(status.activity_status(factory.get('/status/'),'MOD-1',1,'c1').status_code,401)
        from django.middleware.csrf import CsrfViewMiddleware
        rejection=CsrfViewMiddleware(lambda request: None).process_view(factory.post('/status/',data={}),status.activity_status,(),{})
        self.assertEqual(rejection.status_code,403)
        self.assertFalse(getattr(status.activity_status,'csrf_exempt',False))

    def test_history_read_is_scoped_and_does_not_expose_recovery_snapshots(self):
        self.save(self.payload())
        self.actor.role='staff'
        with patch('login.permissions.authenticate_request',return_value=self.actor), patch('login.permissions._accesses_of',return_value={'curriculum'}):
            request=RequestFactory().get('/status/'); request.login_account=self.actor
            response=status.activity_status(request,'MOD-1',1,'c1')
        history=json.loads(response.content)['history']
        self.assertEqual(history[0]['displayStatus'],'completed')
        self.assertEqual(history[0]['actor_id'],7)
        self.assertNotIn('after_snapshot',history[0])
        self.assertNotIn('before_snapshot',history[0])

    def attendance_payload(self, mode='attended', date='2026-10-01'):
        self.component.update(type='live_session', settings_json={'teamsOccurrenceId': 'occ-1'})
        self.db.execute("INSERT INTO live_sessions SELECT 'series-1','MOD-1','scheduled' WHERE NOT EXISTS (SELECT 1 FROM live_sessions)")
        self.db.execute("INSERT INTO live_session_occurrences SELECT 'occ-1','series-1','2026-10-01T08:00:00Z','2026-10-01T10:30:00Z','scheduled' WHERE NOT EXISTS (SELECT 1 FROM live_session_occurrences)")
        self.db.commit()
        payload = self.payload()
        payload.pop('startedAt')
        return {**payload, 'attendanceMode': mode, 'timeEntryMode': 'input', 'activityDate': date}

    def test_attended_credits_fixed_150_minutes_once_and_preserves_raw_teams_and_other_learner(self):
        payload = self.attendance_payload()
        self.db.execute("INSERT INTO live_session_learner_attendance VALUES ('occ-1',1,'absent')")
        self.db.execute("INSERT INTO learner_progress_entries (learner_id,component_ref,actual_seconds,accepted) VALUES (2,'c1',600,true)")
        self.db.commit()
        result = self.save({**payload, 'durationSeconds': 1})
        self.assertEqual((result['actualOtjh'], result['acceptedOtjh'], result['attendanceMode']), (2.5, 2.5, 'attended'))
        rows = self.query('SELECT * FROM learner_progress_entries WHERE learner_id=1')
        self.assertEqual(len(rows), 2)
        allocation = next(row for row in rows if row['kind'] == 'staff_hours')
        confirmation = next(row for row in rows if row['kind'] == 'activity_event')
        self.assertEqual(allocation['reporting_timestamp_label'], 'attended')
        self.assertEqual(status.input_activity_date(allocation), '2026-10-01')
        self.assertIsNone(result['startedAt']); self.assertIsNone(result['endedAt'])
        self.assertFalse(confirmation['accepted']); self.assertIsNone(confirmation['actual_seconds'])
        self.assertEqual(confirmation['claimed_seconds'], 9000)
        self.assertEqual(confirmation['time_tracking_session_ref'], 'teams:occ-1-2026-10-01')
        self.save(self.attendance_payload())
        self.assertEqual(len(self.query('SELECT * FROM learner_progress_entries WHERE learner_id=1')), 2)
        self.save(self.payload('not_started'))
        self.assertEqual(status.facts(status.load_records([1], ['c1']))['acceptedOtjh'], 2.5)
        self.assertEqual(self.query('SELECT * FROM live_session_learner_attendance')[0]['attendance_status'], 'absent')
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries WHERE learner_id=2')[0]['actual_seconds'], 600)
        audit = self.query('SELECT * FROM learner_activity_display_audit ORDER BY id')[0]
        self.assertEqual(json.loads(audit['after_snapshot'])['attendanceConfirmations'][0]['claimed_seconds'], 9000)
        self.assertEqual(audit['actor_id'], 7)

    def test_recording_input_and_timestamp_use_declared_hours_without_asserting_presence(self):
        for mode in ('input', 'timestamp'):
            with self.subTest(mode=mode):
                payload = self.attendance_payload('recording')
                if mode == 'timestamp':
                    payload.pop('activityDate')
                    payload.update(timeEntryMode='timestamp', startedAt='2026-10-01T13:04:13+01:00')
                result = self.save(payload)
                self.assertEqual(result['actualOtjh'], 3617 / 3600)
                self.assertEqual(result['attendanceMode'], 'recording')
                self.assertEqual(result['timeEntryMode'], mode)
                self.assertEqual(self.query("SELECT * FROM learner_progress_entries WHERE feed_kind='attendance_confirmation'"), [])
        self.assertIsNotNone(result['endedAt'])

    def test_recording_rejects_double_credit_even_after_not_started_and_raw_attendance_is_present(self):
        self.save(self.attendance_payload())
        self.save(self.payload('not_started'))
        with self.assertRaises(ServiceError) as error: self.save(self.attendance_payload('recording'))
        self.assertEqual(error.exception.code, 'already_attended')
        self.db.execute('DELETE FROM learner_progress_entries'); self.db.commit()
        self.db.execute("INSERT INTO live_session_learner_attendance VALUES ('occ-1',1,'present')"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(self.attendance_payload('recording'))
        self.assertEqual(error.exception.code, 'already_attended')

    def test_attendance_requires_correct_occurrence_date_and_no_earlier_recording(self):
        with self.assertRaises(ServiceError): self.save(self.attendance_payload(date='2026-09-30'))
        with self.assertRaises(ServiceError): self.save(self.attendance_payload('recording', date='2026-09-30'))
        payload = self.attendance_payload()
        self.component['settings_json']['teamsOccurrenceId'] = 'other-module-occurrence'
        with self.assertRaises(ServiceError) as error: self.save(payload)
        self.assertEqual(error.exception.code, 'source_review_required')
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries'), [])

    def test_attendance_audit_failure_rolls_back_confirmation_and_hours(self):
        payload = self.attendance_payload()
        read = status.query
        def fail(sql, params=()):
            if 'INSERT INTO "learner_activity_display_audit"' in sql: raise DatabaseError('Audit unavailable')
            return read(sql, params)
        with patch.object(status, 'query', side_effect=fail), self.assertRaises(DatabaseError): self.save(payload)
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries'), [])
        self.assertEqual(self.query('SELECT * FROM learner_activity_display_overrides'), [])

    def test_previously_absent_allocation_is_credited_without_changing_result_evidence(self):
        payload = self.attendance_payload()
        self.db.execute("INSERT INTO learner_progress_entries (learner_id,entry_order,component_ref,kind,actual_seconds,accepted,feedback,reporting_month) VALUES (1,1,'c1','component',0,false,'Original evidence','2026-10')"); self.db.commit()
        result = self.save(self.attendance_payload())
        self.assertEqual(result['acceptedOtjh'], 2.5)
        allocation = status.load_records([1], ['c1'])[0]
        self.assertEqual(allocation['feedback'], 'Original evidence')

    def test_unlinked_lecture_uses_explicit_date_and_duplicate_occurrence_allocations_are_refused(self):
        payload = self.attendance_payload()
        self.component['settings_json'] = {}
        self.save(payload)
        event = self.query("SELECT * FROM learner_progress_entries WHERE feed_kind='attendance_confirmation'")[0]
        self.assertEqual(event['time_tracking_session_ref'], 'component:c1:2026-10-01')
        with self.assertRaises(ServiceError):
            self.save({**self.payload(), 'attendanceMode': 'attended', 'timeEntryMode': 'input', 'activityDate': '2026-10-02'})
        self.db.execute('DELETE FROM learner_progress_entries'); self.db.commit()
        payload = self.attendance_payload()
        source = status.encode({'original_source_ref': 'attendance:occ-1'})
        self.query('INSERT INTO learner_progress_entries (learner_id,component_ref,actual_seconds,accepted,source_payload) VALUES (1,\'c2\',9000,true,%s)', [source]); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(payload)
        self.assertEqual(error.exception.code, 'duplicate_attendance')

    def test_attendance_locked_month_is_rejected_before_confirmation_or_override(self):
        payload = self.attendance_payload()
        self.db.execute("INSERT INTO learner_monthly_locks VALUES (1,'2026-10','2026-10-02',NULL)"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save(payload)
        self.assertEqual(error.exception.code, 'month_locked')
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries'), [])
        self.assertEqual(self.query('SELECT * FROM learner_activity_display_overrides'), [])

    def test_attendance_enrichment_is_batched_and_respects_actor_ownership(self):
        payload = {'identifier': 'MOD-1', 'learnerActivityPlan': [
            {'learnerId': 1, 'componentId': f'c{i}', 'componentType': 'live_session'} for i in range(100)]}
        def bulk(sql, params=()):
            if 'components' in sql: return [{'id': f'c{i}', 'type': 'live_session', 'settings_json': {'sessionDate': '2026-10-01'}} for i in range(100)]
            if 'learners' in sql: return [{'id': 1, 'coach_email': 'another@example.com'}]
            return []
        with patch.object(status, 'query', side_effect=bulk) as read, patch.object(status, '_accesses_of', return_value={'coach'}):
            status.enrich(payload, self.actor)
        self.assertEqual(read.call_count, 6)
        self.assertTrue(all(not row['canChangeStatus'] for row in payload['learnerActivityPlan']))
        self.assertTrue(all(row['lectureDate'] == '2026-10-01' for row in payload['learnerActivityPlan']))

    def test_active_lecture_cannot_be_confirmed_as_attended_or_recording(self):
        class DuringLecture(datetime):
            @classmethod
            def now(cls, zone=None):
                return datetime(2026, 10, 1, 9, tzinfo=timezone.utc).astimezone(zone or timezone.utc)
        for mode in ('attended', 'recording'):
            payload = self.attendance_payload(mode)
            with patch.object(status, 'datetime', DuringLecture), self.assertRaises(ServiceError) as error:
                self.save(payload)
            self.assertIn('after the lecture has ended', str(error.exception))
        self.assertEqual(self.query('SELECT * FROM learner_progress_entries'), [])

    def test_series_link_needs_unique_occurrence_and_existing_confirmation_metadata_is_retained(self):
        payload = self.attendance_payload()
        self.component['settings_json'] = {'teamsLiveSessionId': 'series-1'}
        details = status.encode({'startsAt': '2026-10-01T08:00:00Z', 'ksbs': ['K1'], 'originalEvidence': 'Retain'})
        self.query('''INSERT INTO learner_progress_entries (learner_id,entry_order,kind,feed_kind,time_tracking_session_ref,
            claimed_seconds,time_tracking_calculation,submitted_at) VALUES (1,1,'activity_event','attendance_confirmation',
            'teams:occ-1-2026-10-01',7200,%s,'2026-10-01T11:00:00Z')''', [details]); self.db.commit()
        self.save(payload)
        event = self.query("SELECT * FROM learner_progress_entries WHERE feed_kind='attendance_confirmation'")[0]
        self.assertEqual(json.loads(event['time_tracking_calculation'])['originalEvidence'], 'Retain')
        self.assertEqual(json.loads(event['time_tracking_calculation'])['ksbs'], ['K1'])
        self.assertEqual(event['claimed_seconds'], 9000)
        self.db.execute("INSERT INTO live_session_occurrences VALUES ('occ-2','series-1','2026-10-02T08:00:00Z','2026-10-02T10:30:00Z','scheduled')"); self.db.commit()
        with self.assertRaises(ServiceError) as error: self.save({**self.payload(), 'attendanceMode': 'attended', 'timeEntryMode': 'input', 'activityDate': '2026-10-01'})
        self.assertEqual(error.exception.code, 'source_review_required')


class ActivityScopeTests(SimpleTestCase):
    def run_resolution(self, assigned=1, canonical=1, component=True, coach='coach@example.com'):
        actor=SimpleNamespace(email='coach@example.com')
        owner={'id':1,'enrolment_id':91,'coach_email':coach}
        def read(sql, params=()):
            if 'learners' in sql: return [owner]
            if 'modules' in sql: return [{'module_catalogue_id':'MOD-1'}]
            if 'components' in sql: return [{'id':'c1','module_catalogue_id':'MOD-1'}] if component else []
            return []
        with patch('curriculum_api.views.assigned_learners_for_scope',return_value=[{'id':assigned}]), \
             patch.object(status,'query',side_effect=read), \
             patch.object(status,'_accesses_of',return_value={'coach'}), \
             patch('learner_api.canonical_learning.require_profile',return_value={'id':canonical}):
            return status.resolve(actor,'MOD-1',1,'c1')

    def test_owned_assigned_learner_and_real_bridge_are_allowed(self):
        self.assertEqual(self.run_resolution()[0]['enrolment_id'],91)

    def test_other_learner_component_bridge_and_owner_are_refused(self):
        for options,code in [({'assigned':2},'not_found'),({'canonical':2},'identity_review_required'),({'component':False},'not_found'),({'coach':'other@example.com'},'forbidden')]:
            with self.assertRaises(ServiceError) as error: self.run_resolution(**options)
            self.assertEqual(error.exception.code,code)
