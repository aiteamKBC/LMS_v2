"""Locked-write guards and persisted metadata with synthetic, isolated services."""
from contextlib import ExitStack, nullcontext, contextmanager
from copy import deepcopy
import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase
from old_otjh.service import ServiceError
from . import active_users
from .models import LearnerProfile, LearnerProgressEntry


class ActivityTimeWriteGuardsTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def save(self, *, previous=3600, expected=3600, current=1200, frozen=False, historical=False, mode='add', attendance=None):
        old = {'kind': 'component', 'componentId': 'C1', 'claimedSeconds': previous,
               'timeTrackingSource': 'signed:input', 'submittedAt': '2026-10-01T10:00:00Z'}
        history = [old] if attendance is None else []
        original_history = deepcopy(history)
        # 38.30 is the official total (imported hours included); a save must not rewrite it.
        learner = SimpleNamespace(pk=7, enrolment_id=19, aptem_id=42, username='Synthetic learner',
                                  training_plan_progress=history, save=Mock(), completed_hours=38.3)
        record = {'kind': 'component', 'componentType': 'reading', 'componentId': 'C1',
                  'claimedSeconds': current, 'verifiedSeconds': 12, 'timeTrackingSource': 'signed:input',
                  'retakeTimeChoice': mode, 'retakePreviousSeconds': expected,
                  'retakeTimeReason': 'Correct an incorrectly entered duration' if mode == 'correct' else None,
                  'submittedAt': '2026-10-02T10:00:00Z'}
        create = Mock(side_effect=lambda **fields: (history.append(deepcopy(record)), SimpleNamespace(pk=11))[1])
        cursor = MagicMock()
        connection = MagicMock(vendor='sqlite'); connection.cursor.return_value.__enter__.return_value = cursor
        with ExitStack() as stack:
            stack.enter_context(patch.object(active_users, 'component_reference_state', return_value=('active', None)))
            stack.enter_context(patch.object(active_users, '_component_learning_context', return_value={
                'componentType': 'reading' if attendance is None else 'live_session'}))
            if attendance is not None:
                stack.enter_context(patch('learner_api.activity_time_history.attendance_baseline', return_value=attendance))
            stack.enter_context(patch.object(active_users.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()))
            stack.enter_context(patch.object(active_users.transaction, 'on_commit'))
            stack.enter_context(patch.object(active_users, 'connections', {'enrolment': connection}))
            stack.enter_context(patch.object(active_users.LearnerProfile.objects, 'select_for_update', return_value=SimpleNamespace(get=lambda **kwargs: learner)))
            stack.enter_context(patch.object(active_users.LearnerProgressEntry.objects, 'filter', return_value=SimpleNamespace(aggregate=lambda **kwargs: {'value': 1})))
            stack.enter_context(patch.object(active_users, '_create_progress_entry', create))
            stack.enter_context(patch.object(active_users.LearnerProgressKsb.objects, 'bulk_create'))
            stack.enter_context(patch('old_otjh.repository.query', return_value=[{
                'source_system': 'journal' if historical else '', 'actual_basis': None,
                'reporting_month': '2026-10', 'submitted_at': '2026-10-01T10:00:00Z'}]))
            def check_month(owner, month, mode):
                if frozen and mode == 'correct':
                    raise ServiceError('This monthly log is signed.', 'month_signed', 409)
            check = stack.enter_context(patch('learner_api.manual_time_corrections.require_activity_time_month', side_effect=check_month))
            try:
                saved = active_users.save_progress_record(learner, record)
                return saved, learner, record, create, cursor, check
            except ValueError:
                self.assertFalse(create.called, 'A rejected time decision must not insert an attempt')
                self.assertEqual(history, original_history)
                raise

    def test_rechecks_current_time_after_the_learner_lock(self):
        with self.assertRaisesRegex(ValueError, 'saved activity time changed'):
            self.save(previous=7200, expected=3600)

    def test_addition_above_the_limit_cannot_reach_storage(self):
        with self.assertRaisesRegex(ValueError, '9 hours'):
            self.save(previous=21600, expected=21600, current=10800)

    def test_signed_corrections_and_imported_history_are_not_replaced(self):
        with self.assertRaisesRegex(ValueError, 'signed'):
            self.save(frozen=True, mode='correct')
        with self.assertRaisesRegex(ValueError, 'historical or staff-reviewed'):
            self.save(historical=True)

    def test_signed_month_can_receive_add_and_retry_as_new_attempts(self):
        for mode, current, counted in [('add', 1200, 4800), ('retry', 1200, 3600), ('retry', 7200, 7200)]:
            with self.subTest(mode=mode, current=current):
                saved, learner, record, create, cursor, check = self.save(frozen=True, mode=mode, current=current)
                self.assertEqual(record['countedSeconds'], counted)
                self.assertEqual(learner.completed_hours, 38.3)
                learner.save.assert_not_called()
                self.assertEqual(len(learner.training_plan_progress), 2)
                self.assertEqual(learner.training_plan_progress[0]['claimedSeconds'], 3600)
                create.assert_called_once()
                self.assertEqual(check.call_args.args[2], mode)
                self.assertFalse(any('signature' in call.args[0].lower() for call in cursor.execute.call_args_list))

    def test_success_stores_the_choice_and_keeps_official_hours_with_separate_timer_evidence(self):
        saved, learner, record, create, cursor, check = self.save(current=3600)
        self.assertEqual(saved.pk, 11); self.assertEqual(record['countedSeconds'], 7200)
        self.assertEqual(record['verifiedSeconds'], 12)
        self.assertEqual(learner.completed_hours, 38.3)
        learner.save.assert_not_called()
        create.assert_called_once(); check.assert_called_once()
        calls = cursor.execute.call_args_list
        self.assertIn('Created_users', calls[0].args[0])
        metadata = next(call for call in calls if 'source_payload=' in call.args[0])
        self.assertEqual(json.loads(metadata.args[1][0]), {'retakeTimeChoice': 'add', 'retakePreviousSeconds': 3600})
        self.assertEqual(metadata.args[1][1:], [11, 7])

    def test_first_reflection_adds_to_attendance_and_persists_the_authoritative_baseline(self):
        _, learner, record, create, cursor, _ = self.save(attendance=7200, expected=7200, current=1800)
        self.assertEqual(record['countedSeconds'], 9000)
        self.assertEqual(record['claimedSeconds'], 1800)
        self.assertEqual(record['verifiedSeconds'], 12)
        self.assertEqual(learner.completed_hours, 38.3)
        learner.save.assert_not_called()
        create.assert_called_once()
        metadata = next(call for call in cursor.execute.call_args_list if 'source_payload=' in call.args[0])
        self.assertEqual(json.loads(metadata.args[1][0]), {'retakeTimeChoice': 'add', 'retakePreviousSeconds': 7200})

    def test_changed_attendance_baseline_under_the_lock_rejects_without_inserting(self):
        with self.assertRaisesRegex(ValueError, 'saved activity time changed'):
            self.save(attendance=9000, expected=7200, current=1800)


class ActivityTimeMetadataReadTests(SimpleTestCase):
    def test_reopening_reads_the_saved_choice_without_loading_evidence_payloads(self):
        db = sqlite3.connect(':memory:'); self.addCleanup(db.close)
        db.executescript('''ATTACH DATABASE ':memory:' AS Learner;
            CREATE TABLE Learner.learner_progress_entries(id,learner_id,source_payload);
            INSERT INTO Learner.learner_progress_entries VALUES(11,7,'{"retakeTimeChoice":"add","retakePreviousSeconds":7200,"evidence":"private synthetic evidence"}');''')
        profile = LearnerProfile(id=7)
        entry = LearnerProgressEntry(id=11, learner=profile, kind='component', component_ref='C1', claimed_seconds=1200)
        entry._state.adding = False; entry._state.db = 'enrolment'
        entry._prefetched_objects_cache = {'ksb_links': [], 'quiz_answers': []}
        profile._prefetched_objects_cache = {'progress_entries': [entry]}
        statements = []
        @contextmanager
        def cursor():
            class Adapter:
                def execute(self, sql, params):
                    statements.append(sql); self.result = db.execute(sql.replace('%s', '?'), params)
                def fetchall(self): return self.result.fetchall()
            yield Adapter()
        connection = SimpleNamespace(vendor='sqlite', cursor=cursor)
        with patch('learner_api.models.connections', {'enrolment': connection}):
            records = profile.training_plan_progress
        self.assertEqual(records[0]['retakeTimeChoice'], 'add')
        self.assertEqual(records[0]['retakePreviousSeconds'], 7200)
        self.assertEqual(records[0]['claimedSeconds'], 1200)
        self.assertNotIn('source_payload', records[0]); self.assertNotIn('evidence', records[0])
        self.assertEqual(len(statements), 1)
        self.assertIn('learner_id=', statements[0])
