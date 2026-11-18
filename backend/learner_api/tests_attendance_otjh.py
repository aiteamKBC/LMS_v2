"""Real register reads in private SQLite plus cross-consumer hour regressions."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import attendance_otjh as policy, canonical_learning as canonical, monthly_logs
from . import tests_monthly_log_attendance as fixtures


class AttendanceOtjhTests(SimpleTestCase):
    setUp = fixtures.MonthlyLogAttendanceTests.setUp
    lecture = fixtures.MonthlyLogAttendanceTests.lecture
    allocation = fixtures.MonthlyLogAttendanceTests.allocation
    signature = fixtures.MonthlyLogAttendanceTests.signature

    def read(self, sql, params):
        self.assertTrue(sql.lstrip().upper().startswith('SELECT'))
        self.assertTrue(all(value in (70, 80, 'M1', 'M2') for value in params))
        records = [dict(record) for record in self.db.execute(sql.replace('%s', '?'), params)]
        for record in records:
            if record.get('accepted') is not None:
                record['accepted'] = bool(record['accepted'])
        return records

    def facts(self):
        return policy.read_bulk([self.owner], self.read, now=self.now)[70]

    def saved(self):
        return [dict(record, accepted=bool(record['accepted']), ksbs=[], sources=[], segments=[]) for record in
                self.db.execute('SELECT * FROM Learner.learner_progress_entries WHERE learner_id=70')]

    def hours(self, records):
        return canonical.metrics_from_records(records, {'2026-10': 10})['otjh']['actual']

    def test_presence_counts_once_in_ledger_chart_month_and_module_without_a_progress_save(self):
        self.lecture()
        self.db.execute("INSERT INTO curriculum.components VALUES ('C1','{\"teamsOccurrenceId\":\"O1\"}','M1','live_session')")
        before = list(self.db.iterdump())
        facts = self.facts()
        records = policy.projection([], facts)
        self.assertEqual(self.hours(records), 2.5)
        self.assertEqual(records[0]['component_ref'], 'C1')
        self.assertEqual(policy.aggregate_delta(facts, []), 9000)
        self.assertEqual(policy.monthly_deltas(facts, []), {'2026-10': {'hours': 2.5, 'submitted': 0, 'activities': 1}})
        with patch.object(canonical, 'query', return_value=[]):
            rows = canonical.rows_for(self.owner, records)
        self.assertEqual(rows[0]['actual_hours'], 2.5)
        self.assertEqual(monthly_logs.additional_attendance(self.learner, rows), [])
        from .dashboard_tabs import monthly_hours
        dashboard = monthly_hours(self.owner, records, {'2026-10': 10},
            current_month='2026-11', attendance=rows)
        self.assertEqual(dashboard['training_plan_totals']['accepted_hours'], 2.5)
        self.assertEqual(dashboard['months'][0]['actual_hours'], 2.5)
        self.assertEqual(list(self.db.iterdump()), before)
        self.assertEqual(policy.projection(records, facts), records)

    def test_current_single_and_bulk_charts_share_the_register_allocation(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=4517)
        owner = {**self.owner, 'email': 'synthetic@example.test', 'account_email': 'synthetic@example.test',
                 'account_record_id': 7, 'account_aptem_id': 7001, 'aptem_id': 7001}
        def read(sql, params):
            if 'WITH canonical AS' in sql:
                return [{'payload': record} for record in self.saved()]
            if 'u.id AS account_record_id' in sql:
                return [owner]
            if 'SUM(CASE WHEN actual_seconds' in sql:
                return [{'learner_id': 70, 'actual_seconds': 4517}]
            if 'learner_monthly_targets' in sql:
                return [{'learner_id': 70, 'report_month': '2026-10', 'target_hours': 10}]
            return self.read(sql, params)
        with patch.object(canonical, 'query', side_effect=read), \
             patch.object(canonical, 'current_records', side_effect=lambda owner, records: records), \
             patch.object(canonical, 'targets_for', return_value={'2026-10': 10}), \
             patch('learner_api.journal_sources.enabled', return_value=False), \
             patch('learner_api.canonical_hours.full_hour_projection_ids', return_value=set()), \
             patch('learner_api.canonical_hours.pending_hour_records', return_value={70: []}), \
             patch('coach_api.migrated_otjh.planned_hours_bulk', return_value={}):
            single = canonical.metrics(7, owner=owner)['otjh']
            bulk = canonical.otjh_summary_bulk([7])[7]
        self.assertEqual(single['actual'], 2.5)
        self.assertEqual(bulk['actual'], single['actual'])
        self.assertEqual(bulk['planned'], single['planned'])

    def transferred_entries(self, snapshot, *, selected=False):
        state = {'items': [{'courseRef': 'legacy:50'}], 'records': [snapshot]}
        owner = {**self.owner, 'progress_transfer_active': True}
        def read(sql, params):
            if 'WITH canonical AS' in sql:
                return [{'payload': record} for record in self.saved()]
            return self.read(sql, params)
        before = deepcopy(state)
        with patch.object(canonical, 'query', side_effect=read), \
             patch.object(canonical, 'current_records', side_effect=lambda owner, records: records), \
             patch('learner_api.progress_transfer_store.read_state', return_value=state):
            result = canonical.entries_for(owner, **({'entry_ids': [snapshot['id']]} if selected else {}))
        self.assertEqual(state, before)
        self.assertEqual(next(row for row in result if row['id'] == snapshot['id']), snapshot)
        return result

    def test_transfer_history_does_not_hide_new_attendance_from_programme_hours(self):
        self.lecture()
        self.lecture('OTHER', owner=80)
        snapshot = {'id': 91, 'source_system': 'old_lms', 'module_ref': '50', 'accepted': True,
                    'actual_seconds': 3600, 'ksbs': [], 'sources': [], 'segments': []}
        before = list(self.db.iterdump())
        result = self.transferred_entries(snapshot)
        self.assertEqual(self.hours(result), 3.5)
        self.assertEqual([row['id'] for row in result], [91, 'attendance:O1'])
        self.assertEqual(list(self.db.iterdump()), before)
        # The display supplement must recognise the newly shared allocation.
        from .live_session_progress import supplement_module_hours
        credits = [{'componentId': 'LIVE', 'moduleId': 'M1', 'hours': 2.5,
                    'occurrenceId': 'O1', 'verifiedSeconds': 240}]
        totals = {'M1': {'hours': {'actual': 2.5}}}
        self.assertEqual(supplement_module_hours(totals, result, credits), totals)

    def test_attendance_does_not_rewrite_an_allocation_in_a_transfer_snapshot(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=3600)
        snapshot = self.saved()[0]
        self.assertEqual(self.hours(self.transferred_entries(snapshot)), 1)

    def test_transfer_owner_still_respects_signed_months_and_selected_entry_reads(self):
        self.lecture()
        snapshot = {'id': 91, 'source_system': 'old_lms', 'module_ref': '50', 'accepted': True,
                    'actual_seconds': 3600, 'ksbs': [], 'sources': [], 'segments': []}
        self.assertEqual(self.transferred_entries(snapshot, selected=True), [snapshot])
        self.signature()
        self.assertEqual(self.transferred_entries(snapshot), [snapshot])

    def test_closed_month_keeps_activity_completed_without_adding_display_hours(self):
        from .live_session_progress import protect_credit_hours, supplement_component_progress, supplement_module_hours
        self.signature()
        credit = {'componentId': 'C1', 'moduleId': 'M1', 'hours': 2.5, 'occurrenceId': 'O1',
                  'verifiedSeconds': 7200, 'submittedAt': '2026-10-15T11:00:00Z', 'title': 'Synthetic lecture'}
        with patch('learner_api.live_session_progress._credit_profile', return_value=SimpleNamespace(pk=70)), \
             patch('old_otjh.repository.query', side_effect=self.read):
            credits = protect_credit_hours(SimpleNamespace(pk=7), [credit])
        self.assertTrue(credits[0]['otjhFrozen'])
        before = {'M1': {'hours': {'actual': 2}}}
        self.assertEqual(supplement_module_hours(before, [], credits), before)
        self.assertEqual(supplement_component_progress([], credits)[0]['reportedTime'], '0 minutes')

    def test_linked_recording_and_live_are_one_credit_but_other_module_is_independent(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=0)
        self.allocation(settings={'linkedLiveSessionComponentId': 'C0', 'linkedLiveSessionModuleId': 'M1'}, seconds=4517)
        self.db.execute("UPDATE curriculum.components SET type='recording_placeholder' WHERE id='C1'")
        self.assertEqual(self.hours(policy.projection(self.saved(), self.facts())), 2.5)
        self.db.execute("UPDATE Learner.learner_progress_entries SET module_ref='M2' WHERE component_ref='C1'")
        self.assertAlmostEqual(self.hours(policy.projection(self.saved(), self.facts())), 2.5 + 4517 / 3600, places=4)

    def test_presence_replaces_short_long_zero_and_duplicate_saved_time_once(self):
        self.lecture()
        for seconds in (0, 4500, 4517, 12600):
            with self.subTest(seconds=seconds):
                self.db.execute('DELETE FROM Learner.learner_progress_entries')
                self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=seconds)
                self.allocation(session_ref='teams:O1-2026-10-15', seconds=3600)
                records = self.saved()
                before = deepcopy(records)
                facts = self.facts()
                projected = policy.projection(records, facts)
                self.assertEqual(self.hours(projected), 2.5)
                self.assertEqual(policy.aggregate_delta(facts, []), 9000 - seconds - 3600)
                self.assertEqual(policy.projection(projected, facts), projected)
                self.assertEqual(records, before)

    def test_recording_without_presence_keeps_exact_entered_seconds(self):
        self.lecture(status='absent')
        for seconds in (0, 4517, 12600):
            with self.subTest(seconds=seconds):
                self.db.execute('DELETE FROM Learner.learner_progress_entries')
                self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=seconds)
                saved = self.saved()
                self.assertEqual(policy.projection(saved, self.facts()), saved)
                self.assertEqual(canonical.recorded_seconds(saved[0]), seconds)

    def test_presence_does_not_accept_pending_ksb_evidence_or_change_its_denominator(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=4500, accepted=False)
        saved = [{**self.saved()[0], 'ksbs': ['K1'], 'reporting_estimated': True}]
        projected = policy.projection(saved, self.facts())
        self.assertFalse(canonical.is_time_estimated(projected[0]))
        result = canonical.metrics_from_records(projected, {}, include_ksb_points=True)
        self.assertEqual(result['otjh']['actual'], 2.5)
        self.assertEqual((result['ksb']['completed'], result['ksb']['total']), (0, 1))
        self.assertFalse(result['ksb']['points'][0]['completed'])

    def test_owner_and_occurrence_scope_are_batched_for_both_learner_types(self):
        self.lecture()
        self.lecture('O2', owner=80)
        self.db.execute('''INSERT INTO curriculum.live_session_learner_attendance
            SELECT occurrence_id,live_session_id,'M2',learner_profile_id,session_date,attendance_status,attended_seconds
            FROM curriculum.live_session_learner_attendance WHERE learner_profile_id=70''')
        owners = [self.owner, {'id': 80, 'enrolment_id': 8, 'learner_type': 'commercial'}]
        with patch.object(self, 'read', wraps=self.read) as read:
            facts = policy.read_bulk(owners, read, now=self.now)
        self.assertEqual(read.call_count, 5)
        self.assertEqual([self.hours(policy.projection([], facts[ident])) for ident in (70, 80)], [2.5, 2.5])
        self.assertEqual(policy.projection([], facts[70])[0]['id'], 'attendance:O1')
        self.assertEqual(policy.projection([], facts[80])[0]['id'], 'attendance:O2')

    def test_signed_locked_finalized_and_audit_signed_months_keep_existing_hours(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=7200)
        self.db.execute("UPDATE Learner.learner_progress_entries SET reporting_month='2026-10'")
        cases = [
            ('learner_monthly_signatures', "INSERT INTO Learner.learner_monthly_signatures VALUES (1,70,'2026-10','{}',1,'2026-11-01')"),
            ('learner_monthly_locks', "INSERT INTO Learner.learner_monthly_locks VALUES (70,'2026-10','2026-11-01',NULL)"),
            ('manual_month_finalization_events', "INSERT INTO Learner.manual_month_finalization_events VALUES (1,7001,'2026-10','finalized')"),
            ('monthly_audit_signoffs', "INSERT INTO Learner.monthly_audit_signoffs VALUES ('7001','2026-10',1)"),
        ]
        for table, sql in cases:
            with self.subTest(table=table):
                self.db.execute(sql)
                before = list(self.db.iterdump())
                saved = self.saved()
                facts = self.facts()
                self.assertEqual(policy.projection(saved, facts), saved)
                self.assertEqual(self.hours(policy.projection(saved, facts)), 2)
                self.assertEqual(policy.aggregate_delta(facts, []), 0)
                self.assertEqual(monthly_logs.attendance_rows(self.learner), [])
                self.assertEqual(list(self.db.iterdump()), before)
                self.db.execute(f'DELETE FROM Learner.{table}')

    def test_old_signed_capture_retains_its_original_two_hours_after_register_correction(self):
        self.lecture()
        captured = monthly_logs.attendance_rows(self.learner)
        captured[0]['actual_hours'] = 2
        self.signature(rows=captured)
        self.db.execute("UPDATE curriculum.live_session_learner_attendance SET attendance_status='absent'")
        facts = self.facts()
        projected = policy.projection([], facts)
        self.assertEqual(self.hours(projected), 2)
        with patch.object(canonical, 'query', return_value=[]):
            rows = canonical.rows_for(self.owner, projected)
        self.assertEqual(rows, captured)
        self.assertEqual(monthly_logs.additional_attendance(self.learner, rows), [])

    def test_unlocked_and_reopened_months_use_current_policy(self):
        self.lecture()
        self.db.execute("INSERT INTO Learner.learner_monthly_locks VALUES (70,'2026-10','2026-11-01','2026-11-02')")
        self.db.execute("INSERT INTO Learner.manual_month_finalization_events VALUES (1,7001,'2026-10','finalized'),(2,7001,'2026-10','reopened')")
        self.assertEqual(self.hours(policy.projection([], self.facts())), 2.5)

    def test_an_allocation_in_a_signed_other_month_is_never_replaced_or_counted_twice(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=7200)
        self.db.execute("UPDATE Learner.learner_progress_entries SET reporting_month='2026-09'")
        self.signature(month='2026-09')
        saved = self.saved()
        self.assertEqual(policy.projection(saved, self.facts()), saved)

    def test_pending_direct_time_is_replaced_once_in_fast_aggregate(self):
        self.lecture()
        self.allocation(settings={'teamsOccurrenceId': 'O1'}, seconds=None, accepted=False)
        pending = [{**self.saved()[0], 'actual_seconds': 4517, 'accepted': True}]
        self.assertEqual(policy.aggregate_delta(self.facts(), pending), 9000 - 4517)

    def test_future_active_cancelled_and_invalid_occurrences_get_no_credit(self):
        for occurrence, kwargs in (
            ('future', {'start': '2026-11-08T09:00:00Z', 'end': '2026-11-08T11:00:00Z'}),
            ('active', {'start': '2026-11-07T11:00:00Z', 'end': '2026-11-07T13:00:00Z'}),
            ('cancelled', {'state': 'cancelled'}), ('bad', {'end': None}),
        ):
            self.lecture(occurrence, **kwargs)
        self.assertEqual(policy.projection([], self.facts()), [])
