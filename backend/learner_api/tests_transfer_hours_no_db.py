"""Sanitized transfer-hour regressions: persistence and external IO are mocked.

Cases 1-5 reproduce the five reviewed Development scenarios using invented
identities/durations. No learner records, names or evidence bodies are fixtures.
"""
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical, progress_transfer_store as store
from .current_learning import merge_attempts
from .progress_transfer_policy import frozen_records, transfer_hour_records
from .tests_progress_transfer_no_db import item, saved
from . import tests_my_learning_no_db as catalogue_tests
from .tests_my_learning_no_db import component, metadata, native


def record(ident=1, seconds=3600, accepted=True, **extra):
    return dict(id=ident, learner_id=9, source_system='old_lms', actual_seconds=seconds,
                actual_basis='reviewed_source', accepted=accepted, completed=True,
                sources=[{'source_system': 'old_lms', 'source_course_ref': '50',
                          'source_activity_id': 'material:7'}], **extra)


class TransferHoursTests(SimpleTestCase):
    def project(self, current, snapshots, status, *, attempts=(), attendance=None):
        state = saved(status)
        state['records'] = snapshots
        original = deepcopy((current, state))
        with patch.object(canonical, 'query', return_value=[
                {'payload': row, 'sources': row.get('sources', [])} for row in current]), \
             patch.object(canonical, '_ksb_not_excluded', return_value='TRUE'), \
             patch.object(store, 'read_state', return_value=state), \
             patch.object(canonical, 'current_records', side_effect=lambda owner, rows: merge_attempts(rows, attempts)), \
             patch('learner_api.attendance_otjh.read_bulk', return_value={9: attendance or {
                 'lectures': [], 'protected': {}, 'frozen_rows': []}}):
            result = canonical.entries_for({'id': 9, 'enrolment_id': 7, 'progress_transfer_active': True})
        self.assertEqual((current, state), original)
        self.assertEqual(frozen_records(result, state), result)
        return result

    def hours(self, records):
        return canonical.metrics_from_records(records, {})['otjh']['actual']

    def test_case_1_current_acceptance_replaces_snapshot_approval(self):
        snapshot = record()
        for status in ('pending', 'approved'):
            for verdict in (False, None, True):
                with self.subTest(status=status, accepted=verdict):
                    current = {**snapshot, 'accepted': verdict, 'actual_basis': 'current_review'}
                    result = self.project([current], [snapshot], status)
                    self.assertEqual(self.hours(result), 1 if verdict is True else 0)
                    self.assertIs(result[0]['accepted'], verdict)
                    self.assertEqual(result[0]['actual_basis'], 'current_review')
                    self.assertTrue(result[0]['completed'])

    def test_case_2_missing_history_keeps_completion_without_inventing_time(self):
        snapshot = record(source_payload={'original_source_ref': 'la:50:7'})
        for status in ('pending', 'approved'):
            with self.subTest(status=status):
                result = self.project([], [snapshot], status)
                self.assertEqual(self.hours(result), 0)
                self.assertTrue(result[0]['completed'])
                self.assertTrue(result[0]['completion_only'])
                self.assertEqual(result[0]['source_payload'], snapshot['source_payload'])
                self.assertFalse(result[0]['accepted'])

    def test_case_3_missing_timing_snapshot_needs_a_current_authoritative_source(self):
        snapshot = record('subject:timing:50:material:7', seconds=1800)
        snapshot['actual_basis'] = 'legacy_activity_manual_time'
        snapshot['source_payload'] = {'subject_attempt_id': 'historical', 'studyTime': {
            'version': 1, 'verifiedSeconds': 1800}}
        for status in ('pending', 'approved'):
            with self.subTest(status=status):
                result = self.project([], [snapshot], status)
                self.assertEqual(self.hours(result), 0)
                self.assertEqual(result[0]['source_payload'], snapshot['source_payload'])
                self.assertTrue(result[0]['completed'])

    def test_case_4_revised_pdf_duration_and_cleared_time_win_over_snapshot(self):
        snapshot = record(seconds=3600, component_type='pdf')
        for status in ('pending', 'approved'):
            for seconds in (600, 0, None):
                with self.subTest(status=status, seconds=seconds):
                    current = {**snapshot, 'actual_seconds': seconds, 'actual_basis': 'reviewed_pdf_duration',
                               'reporting_month': '2026-11', 'segments': []}
                    historical = {**snapshot, 'segments': [{'actual_seconds': 3600}]}
                    result = self.project([current], [historical], status)
                    self.assertEqual(self.hours(result), round((seconds or 0) / 3600, 4))
                    self.assertEqual(result[0]['actual_seconds'], seconds)
                    self.assertEqual(result[0]['actual_basis'], 'reviewed_pdf_duration')
                    self.assertEqual(result[0]['reporting_month'], '2026-11')
                    self.assertEqual(result[0]['segments'], [])

    def test_case_5_current_approval_is_not_removed_by_a_rejected_snapshot(self):
        snapshot = record(accepted=False, seconds=0)
        missing = record('subject:timing:50:material:8', seconds=60)
        current = {**snapshot, 'accepted': True, 'actual_seconds': 900, 'actual_basis': 'current_review'}
        for status in ('pending', 'approved'):
            result = self.project([current], [snapshot, missing], status)
            self.assertEqual(self.hours(result), 0.25)
            self.assertTrue(all(row['completed'] for row in result))

    def test_missing_original_can_still_earn_verified_timer_hours_once(self):
        snapshot = record(seconds=7200)
        at = '2026-11-01T12:00:00+00:00'
        attempt = {'group_id': 50, 'activity_id': 7, 'completed': True, 'submitted_at': at,
                   'timed_attempts': [{'id': 'synthetic', 'completed': True, 'timing': {
                       'version': 1, 'verifiedSeconds': 900, 'submittedAt': at}}]}
        for status in ('pending', 'approved'):
            for current in ([], [record(99, seconds=1800)]):
                with self.subTest(status=status, canonical_replacement=bool(current)):
                    result = self.project(current, [snapshot], status, attempts=[attempt])
                    # The canonical retake/route policy decides whether the
                    # timer supplements existing history. Transfer adds none.
                    normal = canonical.progress_records_with_completion(current, merge_attempts(current, [attempt]))
                    self.assertEqual(self.hours(result), self.hours(normal))
                    self.assertGreater(self.hours(result), 0)
                    self.assertEqual(len({str(row['id']) for row in result}), len(result))

    def test_later_canonical_allocations_keep_hours_without_new_transfer_completion(self):
        snapshot = record()
        later = record(2, seconds=900)
        result = self.project([snapshot, later], [snapshot], 'pending')
        self.assertEqual(self.hours(result), 1.25)
        self.assertTrue(result[1]['hours_only'])
        self.assertEqual(canonical.metrics_from_records(result, {})['programme']['completed'], 1)

    def test_current_attendance_is_reconciled_before_historical_completion(self):
        from datetime import datetime, timezone
        snapshot = record(seconds=3600, module_ref='M1', component_ref='LIVE')
        start = datetime(2026, 11, 1, 10, tzinfo=timezone.utc)
        end = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)
        facts = {'protected': {}, 'frozen_rows': [], 'lectures': [{
            'occurrence_id': 'O1', 'learner_profile_id': 9, 'module_catalogue_id': 'M1',
            'module_title': 'Synthetic module', 'session_date': '2026-11-01',
            'start': start, 'end': end, 'component_ids': ['LIVE'], 'records': [snapshot]}]}
        for status in ('pending', 'approved'):
            result = self.project([snapshot], [snapshot], status, attendance=facts)
            self.assertEqual(self.hours(result), 2.5)
            self.assertEqual(result[0]['actual_basis'], 'live_attendance_credit')

    def test_course_cards_use_canonical_hours_instead_of_historical_totals(self):
        historical = item(hours_note='immutable historical estimate')
        historical['hours'] = 90
        canonical_rows = [record(seconds=600), record(2, seconds=900, module_ref='M1'),
                          record(3, seconds=7200, accepted=False)]
        for status in ('pending', 'approved'):
            meta = metadata()
            meta['replacement_courses'] = {'current:M1': 'legacy:50'}
            meta['progress_transfers'] = saved(status, [historical])['items']
            original = deepcopy(meta)
            cards, _ = catalogue_tests.MyLearningAggregateTests().cards(native([component()]),
                [{'source_course_ref': '50', 'source_course_title': 'Synthetic old course'}], [],
                meta=meta, records=canonical_rows, hours={'50': 0.4167})
            self.assertEqual(cards[0]['actualHours'], 0.4167)
            self.assertEqual(meta, original)
        allocated = transfer_hour_records(canonical_rows, historical)
        self.assertEqual(len(allocated), len(canonical_rows))
        self.assertEqual(self.hours(allocated), self.hours(canonical_rows))
