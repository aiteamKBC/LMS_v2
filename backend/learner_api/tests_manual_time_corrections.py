"""Real scoped correction SQL in private in-memory SQLite; no live services."""
import json
import sqlite3
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory, override_settings
from old_otjh.service import ServiceError
from . import manual_time_corrections as edits, monthly_logs as logs
from .active_users import completed_hours_value_from_progress
from .current_learning import project_current


@override_settings(READ_MODEL_OUTBOX_ENABLED=False)
class ManualTimeCorrectionTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS Learner;
            ATTACH DATABASE ':memory:' AS enrolment;
            CREATE TABLE enrolment.Created_users(id INTEGER PRIMARY KEY);
            INSERT INTO enrolment.Created_users VALUES(7);
            CREATE TABLE Learner.learners(id INTEGER PRIMARY KEY);
            INSERT INTO Learner.learners VALUES(70);
            CREATE TABLE Learner.learner_progress_entries(
                id INTEGER PRIMARY KEY,learner_id,component_ref,component_type,kind,
                source_system,component_link_source,claimed_seconds,reported_time,time_taken,
                actual_seconds,actual_basis,source_payload,submitted_at,declared_completed_at,
                reporting_month,deleted_at,time_tracking_source,feed_detail,ssot_updated_at,
                verified_seconds,server_session_seconds,time_tracking_session_ref,time_tracking_calculation,
                started_at,accepted,passed,achieved_score,total_score,feedback);
            CREATE TABLE Learner.learner_activity_reporting_segments(id,progress_id,learner_id,reporting_month,actual_seconds);
            CREATE TABLE Learner.learning_reflection_submissions(id,progress_entry_id,learner_id,learner_kind,status,activity_type,actual_time_hours,full_submission,coach_feedback);
            CREATE TABLE Learner.learner_monthly_locks(learner_id,report_month,locked_at,unlocked_at);
            CREATE TABLE Learner.learner_monthly_signatures(learner_id,report_month,review_confirmed);
            CREATE TABLE Learner.manual_month_finalization_events(id,aptem_id,report_month,event_type);
            CREATE TABLE Learner.monthly_audit_signoffs(learner_id,report_month,review_confirmed);
        ''')
        row = dict(id=1, learner_id=70, component_ref='C1', component_type='reading', kind='component',
                   source_system='', component_link_source='direct', claimed_seconds=108000,
                   reported_time='1800 minutes', time_taken='1800:00', actual_seconds=None,
                   actual_basis=None, source_payload=json.dumps({'evidence': 'keep-original'}),
                   submitted_at='2026-10-01T10:00:00Z', reporting_month='2026-10',
                   time_tracking_source='signed_session_capped_visible_page:input', feed_detail='1800 minutes',
                   verified_seconds=317, server_session_seconds=600, time_tracking_session_ref='original-session',
                   time_tracking_calculation='original-calculation', started_at='2026-10-01T09:50:00Z',
                   accepted=True, passed=None, achieved_score=8, total_score=10, feedback='Original feedback')
        self.db.execute(f'INSERT INTO Learner.learner_progress_entries({",".join(row)}) VALUES({",".join("?" for _ in row)})', list(row.values()))
        self.db.execute('INSERT INTO Learner.learner_progress_entries SELECT 2,71,component_ref,component_type,kind,source_system,component_link_source,claimed_seconds,reported_time,time_taken,actual_seconds,actual_basis,source_payload,submitted_at,declared_completed_at,reporting_month,deleted_at,time_tracking_source,feed_detail,ssot_updated_at,verified_seconds,server_session_seconds,time_tracking_session_ref,time_tracking_calculation,started_at,accepted,passed,achieved_score,total_score,feedback FROM Learner.learner_progress_entries WHERE id=1')
        self.db.commit()
        self.owner = dict(id=70, enrolment_id=7, aptem_id=42, learner_type='apprenticeship', coach_email='coach@example.test')
        self.learner = {'id': 7, '_profile': self.owner}
        self.actor = SimpleNamespace(id=5)
        self.statements = []
        query = patch.object(edits.repository, 'query', side_effect=self.query)
        query.start(); self.addCleanup(query.stop)

    def query(self, sql, params=()):
        self.statements.append(sql)
        sql = sql.replace('actual_seconds::text', 'CAST(actual_seconds AS TEXT)')
        sql = sql.replace('s.id::text', 'CAST(s.id AS TEXT)')
        sql = sql.replace('jsonb_build_object', 'json_object')
        if '=ANY(%s)' in sql:
            sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('?' for _ in params[-1]) + ')')
            params = [*params[:-1], *params[-1]]
        cursor = self.db.execute(sql.replace('%s', '?'), params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        for row in rows:
            for key in ('accepted', 'passed'):
                if row.get(key) is not None:
                    row[key] = bool(row[key])
        return rows

    def row(self, ident=1):
        return self.query('SELECT * FROM Learner.learner_progress_entries WHERE id=%s', [ident])[0]

    def payload(self, seconds=1800):
        return dict(seconds=seconds, revision=edits.revision(self.row()), reason='Hours entered instead of minutes')

    def correct(self, payload=None, role='learner', month='2026-10', progress_id=1):
        payload = self.payload() if payload is None else payload
        with self.db:
            return edits.correct(self.learner, role, self.actor, month, progress_id, payload)

    def test_corrects_same_manual_row_and_keeps_timer_evidence_and_other_learner(self):
        before, other = self.row(), self.row(2)
        self.correct()
        after = self.row()
        self.assertEqual(after['claimed_seconds'], 1800)
        self.assertEqual(after['reported_time'], '30 minutes')
        self.assertEqual(after['time_taken'], '30:00')
        self.assertEqual(self.row(2), other)
        mutable = {'claimed_seconds', 'reported_time', 'time_taken', 'feed_detail', 'source_payload', 'ssot_updated_at'}
        self.assertEqual({k: v for k, v in after.items() if k not in mutable},
                         {k: v for k, v in before.items() if k not in mutable})
        self.assertEqual(self.query('SELECT count(*) AS n FROM Learner.learner_progress_entries')[0]['n'], 2)
        history = json.loads(after['source_payload'])
        self.assertEqual(history['evidence'], 'keep-original')
        self.assertEqual(history['manual_time_corrections'][0]['previous']['claimed_seconds'], 108000)
        self.assertEqual(history['manual_time_corrections'][0]['actor_id'], 5)
        self.assertAlmostEqual(project_current([after], {})[0]['actual_seconds'], 1800)

    def test_largest_attempt_rule_remains_and_correction_does_not_create_an_attempt(self):
        self.correct()
        first = self.row()
        later = {**first, 'id': 3, 'claimed_seconds': 300, 'reported_time': '5 minutes', 'submitted_at': '2026-10-01T11:00:00Z'}
        self.assertEqual(project_current([first, later], {})[0]['actual_seconds'], 1800)
        later['claimed_seconds'] = 3600
        self.assertEqual(project_current([first, later], {})[0]['actual_seconds'], 3600)
        self.assertAlmostEqual(completed_hours_value_from_progress([first, later]), 1)

    def test_correction_recalculates_learner_month_and_coach_totals_without_changing_plan_or_timer(self):
        from coach_api import monthly_logs as coach_logs, otjh_ksb
        from . import canonical_learning as canonical

        # Additional read-model columns only; every query stays in this private ledger.
        self.db.execute('ALTER TABLE Learner.learner_progress_entries ADD COLUMN quiz_ref')
        for column in ('component_ref', 'submitted_at', 'activity_title', 'module_title', 'ksb_codes'):
            self.db.execute(f'ALTER TABLE Learner.learning_reflection_submissions ADD COLUMN {column}')
        self.db.execute('ALTER TABLE Learner.learner_monthly_signatures ADD COLUMN signer_role')
        self.db.execute('CREATE TABLE Learner.learner_activity_documents(id,learner_id,progress_id,display_name,content_type,deleted_at)')
        self.db.create_function('GREATEST', 2, max)

        class BoolOr:
            value = False

            def step(self, value):
                self.value = self.value or bool(value)

            def finalize(self):
                return self.value

        self.db.create_aggregate('bool_or', 1, BoolOr)
        original, other = self.row(), self.row(2)
        stored = {**original, 'id': 3, 'component_ref': 'Other', 'actual_seconds': 36000,
                  'source_system': 'historical'}
        self.db.execute(f'INSERT INTO Learner.learner_progress_entries({",".join(stored)}) '
                        f'VALUES({",".join("?" for _ in stored)})', list(stored.values()))

        def totals():
            records = [{**row, 'ksbs': []} for row in self.query(
                'SELECT * FROM Learner.learner_progress_entries WHERE learner_id=%s', [70])]
            projected = canonical.progress_records_with_completion(records, project_current(records, {}))
            metrics = canonical.metrics_from_records(projected, {'2026-10': 100})['otjh']
            rows = canonical.rows_for(self.owner, projected)
            month = logs.month_state('2026-10', rows, [], 100, lock={
                'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None})
            year = coach_logs.project_year({**self.learner, 'name': 'Synthetic learner',
                'programme': 'Programme', '_canonical_profile': self.owner}, 2026)
            context = SimpleNamespace(profile=SimpleNamespace(enrolment_id=7), source=None)
            case = otjh_ksb.read_otjh(context, self.owner)
            return metrics, month, year, case

        with patch.object(canonical, 'query', side_effect=self.query), \
             patch.object(coach_logs, 'query', side_effect=self.query), \
             patch.object(canonical, 'targets_for', return_value={'2026-10': 100}), \
             patch.object(canonical, 'programme_planned_hours', return_value=100), \
             patch('coach_api.selectors.otjh.learner_programme_window', return_value=('2026-01-01', '2026-12-31')), \
             patch.object(otjh_ksb, 'read_chart_plan', return_value={}), \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 28)):
            for kind in ('commercial', 'apprenticeship'):
                for stored_seconds, retry_seconds, corrected in ((None, 300, 10.5), (None, 3600, 11), (108000, None, 10.5)):
                    with self.subTest(kind=kind, stored=stored_seconds, retry=retry_seconds):
                        self.owner['learner_type'] = kind
                        self.db.execute('DELETE FROM Learner.learner_progress_entries WHERE id=4')
                        self.db.execute('UPDATE Learner.learner_progress_entries SET claimed_seconds=108000, '
                                        'actual_seconds=?, reported_time=?, source_payload=? WHERE id=1',
                                        [stored_seconds, '1800 minutes', original['source_payload']])
                        if retry_seconds:
                            retry = {**original, 'id': 4, 'claimed_seconds': retry_seconds,
                                     'submitted_at': '2026-10-02T10:00:00Z'}
                            self.db.execute(f'INSERT INTO Learner.learner_progress_entries({",".join(retry)}) '
                                            f'VALUES({",".join("?" for _ in retry)})', list(retry.values()))
                        self.db.commit()
                        before = totals()
                        self.correct(role='coach')
                        after = totals()
                        for result, expected in ((before, 40), (after, corrected)):
                            metrics, month, year, case = result
                            self.assertEqual(metrics['actual'], expected)
                            self.assertEqual(month['actual_hours'], expected)
                            self.assertEqual(year['summary']['acceptedOtjhHours'], expected)
                            self.assertEqual(year['months'][0]['acceptedOtjhHours'], expected)
                            self.assertEqual(case['actualHours'], expected)
                            self.assertEqual(case['months'][0]['completedHours'], expected)
                            self.assertEqual(case['remainingHours'], max(0, case['targetToDateHours'] - expected))
                            self.assertEqual(metrics['planned'], 100)
                            self.assertEqual(year['summary']['trainingPlanHours'], 100)
                            self.assertEqual(case['plannedHours'], 100)
                        self.assertEqual(before[3]['targetToDateHours'], after[3]['targetToDateHours'])
                        self.assertAlmostEqual(after[3]['remainingHours'] - before[3]['remainingHours'], 40 - corrected)
                        self.assertEqual(before[2]['months'][0]['activities'], after[2]['months'][0]['activities'])
                        self.assertEqual(self.row(2), other)
                        for field in ('verified_seconds', 'server_session_seconds', 'time_tracking_session_ref', 'started_at'):
                            self.assertEqual(self.row()[field], original[field])

    def test_persisted_manual_allocation_and_single_segment_are_updated_together(self):
        self.db.execute('UPDATE Learner.learner_progress_entries SET actual_seconds=108000 WHERE id=1')
        self.db.execute("INSERT INTO Learner.learner_activity_reporting_segments VALUES(4,1,70,'2026-10',108000)")
        self.db.commit()
        self.correct()
        self.assertEqual(self.row()['actual_seconds'], 1800)
        self.assertEqual(self.query('SELECT actual_seconds FROM Learner.learner_activity_reporting_segments')[0]['actual_seconds'], 1800)

    def test_timer_imported_deleted_and_other_learner_entries_cannot_be_changed(self):
        for field, value in (('time_tracking_source', 'signed_session_capped_visible_page:timer'),
                             ('source_system', 'old_lms'), ('deleted_at', '2026-10-02')):
            before = self.row()
            self.db.execute(f'UPDATE Learner.learner_progress_entries SET {field}=? WHERE id=1', [value]); self.db.commit()
            changed = self.row()
            with self.assertRaises(ServiceError): self.correct()
            self.assertEqual(self.row(), changed)
            self.db.execute(f'UPDATE Learner.learner_progress_entries SET {field}=? WHERE id=1', [before[field]]); self.db.commit()
        with self.assertRaises(ServiceError): self.correct(progress_id=2)
        with self.assertRaises(ServiceError): self.correct(month='2026-09')

    def test_signed_locked_and_finalized_months_reject_without_changes(self):
        checks = [
            ("INSERT INTO Learner.learner_monthly_locks VALUES(70,'2026-10','locked',NULL)", 'learner_monthly_locks'),
            ("INSERT INTO Learner.learner_monthly_signatures VALUES(70,'2026-10',true)", 'learner_monthly_signatures'),
            ("INSERT INTO Learner.manual_month_finalization_events VALUES(1,42,'2026-10','finalized')", 'manual_month_finalization_events'),
            ("INSERT INTO Learner.monthly_audit_signoffs VALUES('42','2026-10',true)", 'monthly_audit_signoffs'),
        ]
        for statement, table in checks:
            before = self.row()
            self.db.execute(statement); self.db.commit()
            with self.assertRaises(ServiceError): self.correct()
            self.assertEqual(self.row(), before)
            self.db.execute(f'DELETE FROM Learner.{table}'); self.db.commit()

    def test_invalid_payloads_and_stale_revisions_do_not_write(self):
        for seconds in (True, 0, -1, 0.5, 2147483648, '30', None):
            with self.subTest(seconds=seconds), self.assertRaises(ServiceError): self.correct(self.payload(seconds))
        for extra in ({'revision': 'stale'}, {'reason': ''}, {'verified_seconds': 999}):
            payload = {**self.payload(), **extra}
            with self.assertRaises(ServiceError): self.correct(payload)
        self.assertFalse(any(sql.lstrip().startswith('UPDATE') for sql in self.statements))

    def test_second_save_using_stale_dialog_cannot_overwrite_first_correction(self):
        stale = self.payload(900)
        self.correct(self.payload(1800))
        with self.assertRaises(ServiceError): self.correct(stale)
        self.assertEqual(self.row()['claimed_seconds'], 1800)
        self.assertEqual(len(json.loads(self.row()['source_payload'])['manual_time_corrections']), 1)

    def test_linked_reflection_changes_only_time_and_preserves_marking_and_answers(self):
        content = {'actualTimeHours': '30', 'assignmentAnswer': 'Original answer', 'ksbCodes': ['K1']}
        self.db.execute('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?,?)',
                        ['R1', 1, '7', 'apprenticeship', 'accepted', 'reading', '30', json.dumps(content), 'Keep feedback'])
        self.db.commit()
        with self.assertRaises(ServiceError): self.correct()
        self.correct(role='coach')
        saved = self.query('SELECT * FROM Learner.learning_reflection_submissions')[0]
        self.assertEqual(saved['actual_time_hours'], '0.5')
        self.assertEqual(saved['status'], 'accepted')
        self.assertEqual(saved['coach_feedback'], 'Keep feedback')
        payload = json.loads(saved['full_submission'])
        self.assertEqual(payload['assignmentAnswer'], content['assignmentAnswer'])
        self.assertEqual(payload['ksbCodes'], ['K1'])

    def test_dated_assignment_or_ambiguous_segments_require_review(self):
        self.db.execute('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?,?)',
                        ['R1', 1, '7', 'apprenticeship', 'draft', 'assignment', '30',
                         json.dumps({'monthlyAssignment': {'timeEntries': [{'date': '2026-10-01', 'hours': 30}]}}), 'Keep feedback'])
        self.db.commit()
        before = self.row()
        with self.assertRaises(ServiceError): self.correct(role='coach')
        self.assertEqual(self.row(), before)
        self.db.execute('DELETE FROM Learner.learning_reflection_submissions')
        self.db.executemany('INSERT INTO Learner.learner_activity_reporting_segments VALUES(?,?,?,?,?)', [(1, 1, 70, '2026-10', 500), (2, 1, 70, '2026-10', 500)])
        self.db.commit()
        with self.assertRaises(ServiceError): self.correct()
        self.assertEqual(self.row(), before)

    def test_refresh_failure_rolls_back_duration_and_correction_history(self):
        before = self.row()
        with patch.object(edits, 'queue_refresh', side_effect=ServiceError('Unavailable')):
            with self.assertRaises(ServiceError): self.correct()
        self.assertEqual(self.row(), before)

    def test_read_controls_are_manual_only_and_do_not_change_signed_facts(self):
        report = {'source': 'lms', 'month': '2026-10', 'rows': [{'progress_id': 1, 'actual_hours': 30}], 'snapshot_digest': 'original'}
        original = deepcopy(report)
        shown = edits.annotate(self.learner, report)
        self.assertEqual(shown['rows'][0]['manual_time']['seconds'], 108000)
        self.assertEqual(shown['snapshot_digest'], 'original')
        self.assertEqual(report, original)
        self.assertEqual(edits.annotate(self.learner, {**report, 'student_signature': {'url': 'saved'}})['rows'], report['rows'])

    def test_pre_october_native_time_has_the_same_business_month_as_its_projection(self):
        self.db.execute("UPDATE Learner.learner_progress_entries SET submitted_at='2026-09-10T10:00:00Z',reporting_month=NULL WHERE id=1")
        self.db.commit()
        self.correct(month='2026-09')
        self.assertEqual(self.row()['claimed_seconds'], 1800)

    def test_commercial_learner_uses_its_own_kind_and_correction_history(self):
        self.owner['learner_type'] = 'commercial'
        result = self.correct(role='coach')
        self.assertEqual(result['learner_kind'], 'commercial')
        self.assertEqual(result['learner_id'], '7')
        self.assertEqual(json.loads(self.row()['source_payload'])['manual_time_corrections'][0]['actor_role'], 'coach')

    def test_rechecks_authorization_after_the_signing_locks_before_any_update(self):
        before = self.row()
        def deny():
            raise ServiceError('Learner not found.', 'not_found', 404)
        with self.db:
            with self.assertRaises(ServiceError):
                edits.correct(self.learner, 'coach', self.actor, '2026-10', 1, self.payload(), authorize=deny)
        self.assertEqual(self.row(), before)

    def test_already_amended_reflection_can_be_reconciled_without_a_new_attempt(self):
        self.db.execute('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?,?)',
                        ['R1', 1, '7', 'apprenticeship', 'submitted_for_tutor_review', 'reading', '0.5',
                         json.dumps({'actualTimeHours': '0.5', 'learningReflection': 'Keep original work'}), 'Keep feedback'])
        self.db.commit()
        self.correct()
        self.assertEqual(project_current([self.row()], {})[0]['actual_seconds'], 1800)
        saved = self.query('SELECT * FROM Learner.learning_reflection_submissions')[0]
        self.assertEqual(saved['status'], 'submitted_for_tutor_review')
        self.assertEqual(json.loads(saved['full_submission'])['learningReflection'], 'Keep original work')

    def test_different_submission_time_is_not_overwritten_by_an_ambiguous_link(self):
        self.db.execute('INSERT INTO Learner.learning_reflection_submissions VALUES(?,?,?,?,?,?,?,?,?)',
                        ['R1', 1, '7', 'apprenticeship', 'draft', 'reading', '2',
                         json.dumps({'actualTimeHours': '2'}), 'Keep feedback'])
        self.db.commit()
        before = self.row()
        with self.assertRaises(ServiceError): self.correct(role='coach')
        self.assertEqual(self.row(), before)

    def test_retained_audit_copy_or_staff_override_does_not_report_a_partial_correction(self):
        original = self.row()
        for updates in (
            {'source_system': 'new_lms', 'source_payload': json.dumps({'original_source_ref': 'progress:1'})},
            {'source_system': '', 'actual_basis': 'staff:module-progress', 'source_payload': '{}'},
        ):
            mirror = {**original, 'id': 3, 'actual_seconds': 108000, **updates}
            self.db.execute(f'INSERT INTO Learner.learner_progress_entries({",".join(mirror)}) VALUES({",".join("?" for _ in mirror)})', list(mirror.values()))
            self.db.commit()
            with self.assertRaises(ServiceError): self.correct(role='coach')
            self.assertEqual(self.row(), original)
            self.db.execute('DELETE FROM Learner.learner_progress_entries WHERE id=3'); self.db.commit()

    def test_noop_does_not_add_history_and_non_object_metadata_is_never_discarded(self):
        before = self.row()
        self.assertFalse(self.correct(self.payload(108000))['changed'])
        self.assertEqual(self.row(), before)
        self.db.execute('UPDATE Learner.learner_progress_entries SET source_payload=? WHERE id=1', [json.dumps(['preserve-this'])]); self.db.commit()
        before = self.row()
        with self.assertRaises(ServiceError): self.correct()
        self.assertEqual(self.row(), before)


class ManualTimeEndpointSecurityTests(SimpleTestCase):
    def test_new_endpoint_requires_authentication_and_csrf(self):
        factory = RequestFactory()
        with patch('login.permissions.authenticate_request', return_value=None):
            response = logs.correct_manual_time(factory.post('/manual-time/1/'), 7, '2026-10', 1)
            self.assertEqual(response.status_code, 401)
        from django.middleware.csrf import CsrfViewMiddleware
        rejection = CsrfViewMiddleware(lambda request: None).process_view(factory.post('/manual-time/1/'), logs.correct_manual_time, (), {})
        self.assertEqual(rejection.status_code, 403)
        self.assertFalse(getattr(logs.correct_manual_time, 'csrf_exempt', False))

    def test_scope_denies_another_learner_unassigned_coach_and_view_as_writes(self):
        owner = dict(id=70, enrolment_id=7, aptem_id=42, name='Example learner', programme='Example programme',
                     email='learner@example.test', coach_email='coach@example.test')
        request = RequestFactory().post('/manual-time/1/')
        request.login_account = SimpleNamespace(id=1, role='learner', subject_type='learner', subject_id=8, is_active=True)
        with self.assertRaises(ServiceError): logs.scope(request, 7)
        request.login_account = SimpleNamespace(id=1, role='staff', email='other@example.test')
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'other@example.test'}), patch.object(logs.canonical, 'require_profile', return_value=owner):
            with self.assertRaises(ServiceError): logs.scope(request, 7)
        request.login_account.role = 'admin'
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'admin'}), patch.object(logs.canonical, 'require_profile', return_value=owner), patch('coach_api.auth._requested_view_as_email', return_value='coach@example.test'):
            with self.assertRaises(ServiceError): logs.scope(request, 7)

    def test_owner_and_assigned_coach_keep_the_existing_write_scope(self):
        owner = dict(id=70, enrolment_id=7, aptem_id=42, name='Example learner', programme='Example programme',
                     email='learner@example.test', coach_email='coach@example.test')
        request = RequestFactory().post('/manual-time/1/')
        request.login_account = SimpleNamespace(id=1, role='learner', subject_type='learner', subject_id=7,
                                               is_active=True, email='learner@example.test')
        with patch.object(logs.canonical, 'require_profile', return_value=owner):
            self.assertEqual(logs.scope(request, 7)[1], 'learner')
        request.login_account = SimpleNamespace(id=2, role='staff', email='coach@example.test')
        with patch.object(logs.old, 'coach_actor', return_value={'role': 'coach', 'email': 'coach@example.test'}), patch.object(logs.canonical, 'require_profile', return_value=owner):
            self.assertEqual(logs.scope(request, 7)[1], 'coach')
