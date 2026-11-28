"""Synthetic input-hour repair tests; all writes use isolated in-memory SQLite."""
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import json
import sqlite3
import unittest

from psycopg.types.json import Jsonb

from scripts.repair_assignment_submitted_hours import HISTORY, apply_plan, build_plan, plan_row, serial

COMPONENT = 'synthetic-assignment'
COHORT = 'Synthetic October cohort'


def example(native=False):
    content = {'learnerId': '101', 'learnerKind': 'commercial', 'activityId': COMPONENT,
               'submissionOrigin': 'learner', 'assignmentTimeSource': 'input', 'actualTimeHours': '1',
               'monthlyAssignment': {'timeEntries': [{'date': '2026-09-20', 'hours': '1'}]},
               'assignmentAttemptHistory': [{'status': 'needs_revision', 'content': {'actualTimeHours': '.5'}}]}
    saved = {'id': 'submission-1', 'learner_id': '101', 'learner_kind': 'commercial', 'activity_id': COMPONENT,
             'activity_type': 'assignment', 'status': 'accepted', 'actual_time_hours': '11:00',
             'submitted_at': '2026-09-21T12:00:00+00:00', 'full_submission': content,
             'reviewed_at': '2026-09-22T12:00:00+00:00', 'coach_feedback': 'Saved decision'}
    progress = {'id': 1, 'learner_id': 201, 'component_ref': COMPONENT, 'component_link_source': 'direct',
                'actual_seconds': None if native else 660,
                'actual_basis': '' if native else 'repair:approved_assignment',
                'source_system': '' if native else 'new_lms', 'accepted': True, 'deleted_at': None,
                'reporting_month': '2026-09', 'submitted_at': '2026-09-21T12:00:00+00:00',
                'claimed_seconds': 3600, 'verified_seconds': 660, 'time_taken': '11:00',
                'ssot_updated_at': '2026-10-31T12:00:00+00:00',
                'source_payload': {'original_evidence': 'keep', 'activity_hours_repairs': [
                    {'marking_id': 'submission-1', 'after': {'actual_seconds': 660}}]}}
    return {'submission': saved, 'progress': [progress], 'profile_id': 201, 'learner_name': 'Synthetic learner',
            'identity_valid': True, 'profile_cohort': COHORT, 'catalogue_cohort': COHORT, 'enrolment_cohort': COHORT,
            'protected_months': [], 'accepted_submissions': 1}


class MemoryConnection:
    def __init__(self, row):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        for table, values in (('learning_reflection_submissions', row['submission']),
                              ('learner_progress_entries', row['progress'][0])):
            columns = ','.join(f'"{key}" ' + ('INTEGER' if isinstance(value, (int, bool)) else 'TEXT')
                               for key, value in values.items())
            self.db.execute(f'CREATE TABLE Learner.{table} ({columns})')
            self.db.execute(f'INSERT INTO Learner.{table} VALUES ({",".join("?" for _ in values)})',
                            [json.dumps(v, sort_keys=True) if isinstance(v, dict) else v for v in values.values()])
        self.db.commit()

    def execute(self, statement, params):
        cursor = self.db.execute(statement.replace('%s', '?'),
                                 [json.dumps(v.obj, sort_keys=True) if isinstance(v, Jsonb) else v for v in params])
        class Result:
            def fetchone(self):
                result = cursor.fetchone()
                if result is None:
                    return None
                result = dict(result)
                for key in ('source_payload', 'full_submission'):
                    if result.get(key) is not None:
                        result[key] = json.loads(result[key])
                return result
        return Result()

    def read(self, table):
        return self.execute(f'SELECT * FROM Learner.{table}', []).fetchone()


class SubmittedHoursRepairTests(unittest.TestCase):
    def test_postgres_typed_readback_matches_the_original_json_snapshot(self):
        self.assertEqual(serial({'hours': Decimal('1.50'),
                                 'at': datetime(2026, 9, 20, 12, 0, 0, 120000, tzinfo=timezone.utc)}),
                         {'hours': 1.5, 'at': '2026-09-20T12:00:00.12+00:00'})

    def test_entered_hour_wins_only_with_matching_daily_claim_and_saved_timing(self):
        row = example()
        original = deepcopy(row)
        change, reason = plan_row(row, COMPONENT, COHORT)
        self.assertIsNone(reason)
        self.assertEqual((change['old_seconds'], change['seconds']), (660, 3600))
        self.assertEqual(row, original)
        row['progress'][0]['verified_seconds'] = 900
        self.assertEqual(plan_row(row, COMPONENT, COHORT)[1], 'timer_overwrite_not_proven')

    def test_input_can_be_more_than_one_hour_without_a_fixed_default(self):
        row = example()
        row['submission']['full_submission']['actualTimeHours'] = '1.15'
        row['submission']['full_submission']['monthlyAssignment']['timeEntries'][0]['hours'] = '1.15'
        row['progress'][0]['claimed_seconds'] = 4140
        self.assertEqual(plan_row(row, COMPONENT, COHORT)[0]['seconds'], 4140)

    def test_other_owner_cohort_activity_and_unapproved_submission_are_not_changed(self):
        for field, value in [('identity_valid', False), ('catalogue_cohort', 'Other cohort')]:
            row = example()
            row[field] = value
            self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])
        for field, value in [('learnerId', 'other'), ('activityId', 'other'), ('assignmentTimeSource', 'timer')]:
            row = example()
            row['submission']['full_submission'][field] = value
            self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])
        row = example()
        row['submission']['status'] = 'submitted_for_tutor_review'
        self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])

    def test_signed_months_and_protected_history_remain_unchanged(self):
        for field, value in [('protected_months', ['2026-09']), ('transfer_active', True), ('has_segments', True),
                             ('accepted_submissions', 2), ('progress', [])]:
            row = example()
            row[field] = value
            self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])
        row = example()
        row['progress'].append(deepcopy(row['progress'][0]))
        self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])

    def test_conflicting_dates_or_totals_require_review(self):
        for key, value in [('date', '2027-05-20'), ('date', 'invalid'), ('hours', '2')]:
            row = example()
            row['submission']['full_submission']['monthlyAssignment']['timeEntries'][0][key] = value
            self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])

    def test_recorded_zero_staff_hours_and_other_repairs_remain_authoritative(self):
        for key, value in [('actual_seconds', 0), ('actual_basis', 'staff:module-progress'), ('source_system', 'aptem')]:
            row = example()
            row['progress'][0][key] = value
            self.assertIsNone(plan_row(row, COMPONENT, COHORT)[0])

    def test_apply_preserves_timer_dates_decision_and_attempt_history_and_is_idempotent(self):
        for native in (False, True):
            with self.subTest(native=native):
                row = example(native)
                connection = MemoryConnection(row)
                self.addCleanup(connection.db.close)
                plan = build_plan([row], COMPONENT, COHORT)
                with connection.db:
                    apply_plan(connection, plan, [row])
                submission = connection.read('learning_reflection_submissions')
                progress = connection.read('learner_progress_entries')
                self.assertEqual(submission, {**row['submission'], 'actual_time_hours': '1'})
                self.assertEqual(progress['actual_seconds'], None if native else 3600)
                for key in ('claimed_seconds', 'verified_seconds', 'time_taken', 'submitted_at', 'reporting_month', 'accepted'):
                    self.assertEqual(progress[key], row['progress'][0][key])
                history = progress['source_payload'][HISTORY]
                self.assertEqual(history[0]['previous_submitted_hours'], '11:00')
                self.assertEqual(history[0]['plan'], plan['fingerprint'])
                self.assertEqual(progress['source_payload']['activity_hours_repairs'], row['progress'][0]['source_payload']['activity_hours_repairs'])
                self.assertEqual(build_plan([{**row, 'submission': submission, 'progress': [progress]}], COMPONENT, COHORT)['changes'], [])

    def test_concurrent_progress_change_rolls_back_the_submission_update(self):
        row = example()
        connection = MemoryConnection(row)
        self.addCleanup(connection.db.close)
        plan = build_plan([row], COMPONENT, COHORT)
        connection.db.execute('UPDATE Learner.learner_progress_entries SET actual_seconds=900')
        connection.db.commit()
        with self.assertRaisesRegex(ValueError, 'Progress changed'):
            with connection.db:
                apply_plan(connection, plan, [row])
        self.assertEqual(connection.read('learning_reflection_submissions')['actual_time_hours'], '11:00')
        self.assertEqual(connection.read('learner_progress_entries')['actual_seconds'], 900)

    def test_changed_form_changes_the_fingerprint_and_cannot_use_an_old_plan(self):
        row = example()
        plan = build_plan([row], COMPONENT, COHORT)
        row['submission']['coach_feedback'] = 'A later reviewed decision'
        self.assertNotEqual(build_plan([row], COMPONENT, COHORT)['fingerprint'], plan['fingerprint'])
        connection = MemoryConnection(row)
        self.addCleanup(connection.db.close)
        with self.assertRaisesRegex(ValueError, 'Evidence differs'):
            with connection.db:
                apply_plan(connection, plan, [row])


if __name__ == '__main__':
    unittest.main()
