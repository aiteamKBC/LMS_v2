"""No-database regressions for native Extra Activity -> Progress synchronization."""
import json
from copy import deepcopy
from datetime import date, datetime, timezone
from unittest.mock import patch

from django.test import SimpleTestCase

from old_otjh.service import ServiceError
from .extra_activity_progress import sync_locked_activity


class MemoryCursor:
    def __init__(self, *, owner, progress=None, evidence=None, definition_ids=None):
        self.owner = owner
        self.progress = deepcopy(progress)
        self.evidence = list(evidence or [])
        self.ksbs = []
        self.definition_ids = {'K1': 701} if definition_ids is None else definition_ids
        self.link = None
        self.description = []
        self.result = []
        self.rowcount = 0
        self.inserts = 0
        self.statements = []

    def execute(self, sql, params=()):
        self.statements.append(sql)
        normal = ' '.join(sql.lower().split())
        self.result = []
        self.description = []
        self.rowcount = 0
        if normal.startswith('select id,enrolment_id,learner_type from "learner".learners'):
            self.result = [(self.owner['id'], self.owner['enrolment_id'], self.owner['learner_type'])]
        elif normal.startswith('select id,learner_id,accepted,actual_seconds'):
            linked, source_system, source_id, canonical_key, _ = params
            row = self.progress
            if row and (row['id'] == linked or
                        (row['source_system'] == source_system and row['source_activity_id'] == source_id) or
                        row['canonical_activity_key'] == canonical_key):
                columns = ('id', 'learner_id', 'accepted', 'actual_seconds', 'reporting_month',
                           'activity_status', 'source_system', 'source_activity_id',
                           'canonical_activity_key', 'source_payload', 'deleted_at')
                self.description = [(name,) for name in columns]
                self.result = [tuple(row.get(name) for name in columns)]
        elif normal.startswith('select learner_id,deleted_at from "learner".learner_progress_entries'):
            if self.progress and self.progress['id'] == params[0]:
                self.result = [(self.progress['learner_id'], self.progress.get('deleted_at'))]
        elif normal.startswith('insert into "learner".learner_progress_entries'):
            self.inserts += 1
            progress_id = 500
            metadata = json.loads(params[10])
            self.progress = {
                'id': progress_id, 'learner_id': params[0], 'accepted': True,
                'actual_seconds': params[8], 'reporting_month': params[9],
                'activity_status': 'accepted', 'source_system': params[5],
                'source_activity_id': params[6], 'canonical_activity_key': params[7],
                'source_payload': metadata, 'deleted_at': None,
            }
            self.result = [(progress_id,)]
            self.rowcount = 1
        elif normal.startswith('update "learner".learner_progress_entries set'):
            progress_id, learner_id = params[12], params[13]
            if self.progress and self.progress['id'] == progress_id and self.progress['learner_id'] == learner_id:
                self.progress.update(
                    accepted=params[8], actual_seconds=params[9], reporting_month=params[10],
                    activity_status=params[7], source_system=params[4], source_activity_id=params[5],
                    canonical_activity_key=params[6],
                    source_payload={**self.progress.get('source_payload', {}), **json.loads(params[11])},
                )
                self.rowcount = 1
        elif normal.startswith('select position,ksb_code,ksb_definition_id,ksb_description'):
            columns = ('position', 'ksb_code', 'ksb_definition_id', 'ksb_description',
                       'source_type', 'source_id', 'classification', 'weight', 'weight_class')
            self.result = [tuple(row[column] for column in columns) for row in self.ksbs]
        elif 'from "learner".learner_ksb_assignments' in normal:
            self.result = [(self.owner['id'], code, definition_id)
                           for code, definition_id in self.definition_ids.items()]
        elif normal.startswith('delete from "learner".learner_progress_ksbs'):
            self.ksbs = []
        elif normal.startswith('insert into "learner".learner_progress_ksbs'):
            columns = ('progress_id', 'position', 'ksb_code', 'ksb_definition_id',
                       'ksb_description', 'source_type', 'source_id', 'classification',
                       'weight', 'weight_class')
            self.ksbs.append(dict(zip(columns, params)))
            self.rowcount = 1
        elif normal.startswith('select id,progress_entry_id from "learner".evidence_files'):
            self.result = list(self.evidence)
        elif normal.startswith('update "learner".evidence_files set'):
            progress_id = params[0]
            changed = sum(link is None for _, link in self.evidence)
            self.evidence = [(identity, progress_id if link is None else link)
                             for identity, link in self.evidence]
            self.rowcount = changed
        elif normal.startswith('update "learner".extra_activities set progress_entry_id'):
            self.link = params[0]
            self.rowcount = 1
        else:
            raise AssertionError(f'Unexpected SQL: {normal}')

    def fetchall(self):
        return list(self.result)

    def fetchone(self):
        return self.result[0] if self.result else None


class ExtraActivityProgressTests(SimpleTestCase):
    owner = {'id': 1109, 'enrolment_id': 678, 'learner_type': 'apprenticeship'}

    def activity(self, **changes):
        activity = {
            'id': '622d4aa2-5884-4be9-a5a7-5f6e81ad4b23',
            'learner_id': 1109, 'learner_kind': 'apprenticeship',
            'title': 'IPC London Masterclass', 'status': 'approved',
            'requested_minutes': 480, 'approved_minutes': 480,
            'activity_date': date(2026, 10, 5),
            'submitted_at': datetime(2026, 10, 5, 12, tzinfo=timezone.utc),
            'reviewed_at': datetime(2026, 10, 7, 9, tzinfo=timezone.utc),
            'reviewed_by': 'Progress Coach', 'progress_entry_id': None,
            'source_reflection_id': None,
            'reflection_payload': {'full_submission': {'ksbCodes': ['K1'], 'ksbWeights': {'K1': 2}}},
        }
        activity.update(changes)
        return activity

    def run_sync(self, cursor, activity):
        with patch('learner_api.manual_time_corrections.require_open_month') as open_month, \
             patch('learner_api.progress_cache.bump_learners') as bump, \
             patch('learner_api.monthly_actual_cache.sync_completed_hours') as completed, \
             patch('learner_api.monthly_actual_cache.refresh_learner') as refresh:
            result = sync_locked_activity(cursor, activity, self.owner)
        return result, open_month, bump, completed, refresh

    def test_new_approval_creates_one_linked_canonical_progress_and_refreshes_hours(self):
        cursor = MemoryCursor(owner=self.owner, evidence=[('file-1', None)])
        result, open_month, bump, completed, refresh = self.run_sync(cursor, self.activity())
        self.assertEqual(result, {'progress_entry_id': 500, 'changed': True})
        self.assertEqual(cursor.inserts, 1)
        self.assertEqual(cursor.link, 500)
        self.assertEqual(cursor.progress['learner_id'], 1109)
        self.assertEqual(cursor.progress['actual_seconds'], 28800)
        self.assertEqual(cursor.progress['reporting_month'], '2026-10')
        self.assertTrue(cursor.progress['accepted'])
        self.assertEqual(cursor.evidence, [('file-1', 500)])
        self.assertEqual(
            [(row['ksb_code'], row['weight'], row['ksb_definition_id']) for row in cursor.ksbs],
            [('K1', 2, 701)],
        )
        open_month.assert_called_once_with(self.owner, '2026-10')
        bump.assert_called_once_with([1109])
        completed.assert_called_once_with(1109, database='enrolment')
        refresh.assert_called_once_with(1109, database='enrolment')

    def test_repeat_or_concurrent_replay_reuses_the_same_progress(self):
        cursor = MemoryCursor(owner=self.owner)
        activity = self.activity()
        first, *_ = self.run_sync(cursor, activity)
        activity['progress_entry_id'] = first['progress_entry_id']
        second, open_month, bump, completed, refresh = self.run_sync(cursor, activity)
        self.assertEqual(second, {'progress_entry_id': 500, 'changed': False})
        self.assertEqual(cursor.inserts, 1)
        self.assertIn('FOR UPDATE', ''.join(cursor.statements))
        open_month.assert_not_called()
        bump.assert_not_called(); completed.assert_not_called(); refresh.assert_not_called()

    def test_duration_correction_updates_same_progress_without_duplicate_hours(self):
        cursor = MemoryCursor(owner=self.owner)
        activity = self.activity()
        self.run_sync(cursor, activity)
        activity.update(progress_entry_id=500, approved_minutes=420)
        result, open_month, *_ = self.run_sync(cursor, activity)
        self.assertEqual(result['progress_entry_id'], 500)
        self.assertEqual(cursor.inserts, 1)
        self.assertEqual(cursor.progress['actual_seconds'], 25200)
        self.assertEqual(cursor.ksbs[0]['ksb_definition_id'], 701)
        open_month.assert_called_once_with(self.owner, '2026-10')

    def test_missing_profile_definition_keeps_new_extra_activity_link_null(self):
        cursor = MemoryCursor(owner=self.owner, definition_ids={})

        self.run_sync(cursor, self.activity())

        self.assertIsNone(cursor.ksbs[0]['ksb_definition_id'])

    def test_selected_activity_month_controls_the_canonical_month(self):
        cursor = MemoryCursor(owner=self.owner)
        activity = self.activity(
            activity_date=date(2026, 11, 22),
            reflection_payload={'full_submission': {
                'monthlyAssignment': {'month': '2026-10'}, 'ksbCodes': [],
            }},
        )
        self.run_sync(cursor, activity)
        self.assertEqual(cursor.progress['reporting_month'], '2026-10')

    def test_withdrawal_removes_accepted_credit_and_preserves_progress_identity(self):
        cursor = MemoryCursor(owner=self.owner)
        activity = self.activity()
        self.run_sync(cursor, activity)
        activity.update(progress_entry_id=500, status='returned', approved_minutes=None)
        result, open_month, *_ = self.run_sync(cursor, activity)
        self.assertEqual(result['progress_entry_id'], 500)
        self.assertFalse(cursor.progress['accepted'])
        self.assertEqual(cursor.progress['activity_status'], 'returned')
        self.assertEqual(cursor.inserts, 1)
        open_month.assert_called_once_with(self.owner, '2026-10')

    def test_draft_and_pending_never_create_progress(self):
        for status in ('draft', 'pending'):
            with self.subTest(status=status):
                cursor = MemoryCursor(owner=self.owner)
                result, _, bump, completed, refresh = self.run_sync(
                    cursor, self.activity(status=status, approved_minutes=None),
                )
                self.assertEqual(result, {'progress_entry_id': None, 'changed': False})
                self.assertIsNone(cursor.progress)
                bump.assert_not_called(); completed.assert_not_called(); refresh.assert_not_called()

    def test_wrong_learner_or_conflicting_evidence_rolls_back_before_refresh(self):
        with self.assertRaisesRegex(ServiceError, 'canonical learner identity'):
            sync_locked_activity(MemoryCursor(owner=self.owner),
                                 self.activity(learner_id=999), self.owner)
        cursor = MemoryCursor(owner=self.owner, evidence=[('file-1', 99)])
        with patch('learner_api.manual_time_corrections.require_open_month'), \
             patch('learner_api.progress_cache.bump_learners') as bump:
            with self.assertRaisesRegex(ServiceError, 'evidence links'):
                sync_locked_activity(cursor, self.activity(), self.owner)
        bump.assert_not_called()

    def test_existing_colm_progress_968924_is_preserved_exactly(self):
        existing = {
            'id': 968924, 'learner_id': 1109, 'accepted': True,
            'actual_seconds': 28800, 'reporting_month': '2026-10',
            'activity_status': 'accepted', 'source_system': 'extra_activities',
            'source_activity_id': 'extra:622d4aa2-5884-4be9-a5a7-5f6e81ad4b23',
            'canonical_activity_key': 'extra_activities:622d4aa2-5884-4be9-a5a7-5f6e81ad4b23',
            'source_payload': {
                'extra_activity_id': '622d4aa2-5884-4be9-a5a7-5f6e81ad4b23',
                'activity_date': '2026-10-05', 'approved_minutes': 480,
                'reviewed_by': 'Progress Coach', 'reviewed_at': '2026-10-07T09:00:00+00:00',
            },
            'deleted_at': None,
        }
        cursor = MemoryCursor(owner=self.owner, progress=existing)
        before = deepcopy(cursor.progress)
        result, _, bump, completed, refresh = self.run_sync(
            cursor, self.activity(progress_entry_id=968924),
        )
        self.assertEqual(result, {'progress_entry_id': 968924, 'changed': False})
        self.assertEqual(cursor.progress, before)
        self.assertEqual(cursor.inserts, 0)
        bump.assert_not_called(); completed.assert_not_called(); refresh.assert_not_called()

