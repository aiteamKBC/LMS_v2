from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import bulk_attendance_live_register as register


class BulkManualCompletionTests(SimpleTestCase):
    def setUp(self):
        self.rows = [{'id': 1, 'learner_profile_id': 7, 'occurrence_id': 'O1', 'live_session_id': 'S1', 'module_catalogue_id': 'M1'},
                     {'id': 2, 'learner_profile_id': 8, 'occurrence_id': 'O1', 'live_session_id': 'S1', 'module_catalogue_id': 'M1'}]
        sessions = patch.object(register.LiveSession, 'objects').start()
        sessions.using.return_value.filter.return_value.values_list.return_value = [('S1', 'M1')]
        self.manager = patch.object(register.LiveSessionLearnerAttendance, 'objects').start()
        self.manager.select_for_update.return_value.filter.return_value.values.return_value = self.rows
        self.corrections = patch('coach_api.models.CoachAttendanceSourceAdjustment.objects').start()
        self.transaction = patch.object(register.transaction, 'atomic', return_value=nullcontext()).start()
        patch.object(register.router, 'db_for_write', return_value='default').start()
        self.addCleanup(patch.stopall)

    def test_bulk_saves_completion_evidence_for_exact_learner_occurrences(self):
        result = register.save_live_attendance({1: 'present', 2: 'absent'}, actor='staff@example.invalid')
        self.assertEqual(result, [1, 2])
        calls = self.corrections.using.return_value.update_or_create.call_args_list
        self.assertEqual([(c.kwargs['learner_id'], c.kwargs['source_id'], c.kwargs['defaults']['status']) for c in calls],
                         [(7, 'O1', 'present'), (8, 'O1', 'absent')])
        self.assertEqual(calls[0].kwargs['defaults']['updated_by'], 'staff@example.invalid')
        self.assertEqual(calls[0].kwargs['source'], 'microsoft-teams')
        self.transaction.assert_called_once_with(using='default')
        # Only the final status changes: provider duration/report are evidence.
        self.assertEqual(set(self.manager.filter.return_value.update.call_args.kwargs), {'attendance_status', 'updated_at'})

    def test_missing_register_record_prevents_all_writes(self):
        with self.assertRaises(LookupError):
            register.save_live_attendance({1: 'present', 3: 'present'})
        self.manager.filter.return_value.update.assert_not_called()
        self.corrections.using.assert_not_called()

    def test_shared_correction_has_its_own_module_key(self):
        self.rows[1].update(learner_profile_id=7, module_catalogue_id='SHARED')
        register.save_live_attendance({1: 'present', 2: 'absent'})
        calls = self.corrections.using.return_value.update_or_create.call_args_list
        self.assertEqual([(c.kwargs['learner_id'], c.kwargs['source_id'], c.kwargs['defaults']['status']) for c in calls],
                         [(7, 'O1', 'present'), (7, 'O1:SHARED', 'absent')])

    def test_correction_failure_propagates_inside_the_register_transaction(self):
        from django.db import DatabaseError
        self.corrections.using.return_value.update_or_create.side_effect = DatabaseError('synthetic failure')
        with self.assertRaises(DatabaseError):
            register.save_live_attendance({1: 'present', 2: 'absent'})
        self.transaction.assert_called_once_with(using='default')


class BulkManualCompletionPersistenceTests(SimpleTestCase):
    """Use disposable in-memory tables; no migrations or external databases."""
    databases = {'default', 'enrolment'}

    def setUp(self):
        from django.db import connections
        from coach_api.models import CoachAttendanceSourceAdjustment, CoachManualAttendance
        from curriculum_api.models import ModuleAuthoringComponent, ModuleAuthoringModule
        from learner_api.models import EnrolmentUser, LearnerProfile
        self.tables = [
            ('default', EnrolmentUser, 'manual_completion_enrolments_test'),
            ('default', LearnerProfile, 'manual_completion_profiles_test'),
            ('default', register.LiveSession, 'manual_completion_sessions_test'),
            ('default', register.LiveSessionLearnerAttendance, 'manual_completion_register_test'),
            ('default', CoachAttendanceSourceAdjustment, 'manual_completion_adjustment_test'),
            ('default', CoachManualAttendance, 'manual_completion_coach_test'),
            ('enrolment', ModuleAuthoringModule, 'manual_completion_modules_test'),
            ('enrolment', ModuleAuthoringComponent, 'manual_completion_components_test'),
        ]
        for alias, model, table in self.tables:
            connection = connections[alias]
            if connection.vendor != 'sqlite' or not connection.is_in_memory_db():
                self.skipTest('Persistence fixtures require isolated in-memory SQLite.')
        for alias, model, table in self.tables:
            patcher = patch.object(model._meta, 'db_table', table)
            patcher.start()
            self.addCleanup(patcher.stop)
            with connections[alias].schema_editor() as schema:
                schema.create_model(model)
            self.addCleanup(self.drop_table, alias, model)
        self.now = datetime(2026, 10, 24, 12, tzinfo=timezone.utc)
        register.LiveSession.objects.create(id='S1', module_catalogue_id='M1',
                                           start_datetime=self.now, organizer_email='staff@example.invalid')
        self.register = register.LiveSessionLearnerAttendance.objects.create(
            occurrence_id='O1', live_session_id='S1', module_catalogue_id='M1',
            learner_profile_id=7, attendance_status='absent', calculated_at=self.now,
            attended_seconds=0, attendance_report_id='')
        ModuleAuthoringModule.objects.using('enrolment').create(module_catalogue_id='M1', title='Module one')
        ModuleAuthoringComponent.objects.using('enrolment').create(
            id='C1', module_catalogue_id='M1', week_id='W1', title='Lecture 1', type='live_session',
            settings_json={'teamsOccurrenceId': 'O1'}, expected_otjh=2.5, reflection_required=True,
            tutor_validation_required=True, workplace_evidence_required=True)
        self.corrections = CoachAttendanceSourceAdjustment.objects
        self.profile = SimpleNamespace(pk=7, enrolment_id=70, email='synthetic@example.invalid')
        self.schedule = [{'session_id': 'O1', 'module_catalogue_id': 'M1', 'live_session_id': 'S1',
                          'session_number': 1, 'session_date': self.now.date(),
                          'scheduled_end': self.now}]

    @staticmethod
    def drop_table(alias, model):
        from django.db import connections
        with connections[alias].schema_editor() as schema:
            schema.delete_model(model)

    def completion(self, profile=None):
        from learner_api.manual_attendance_completion import read_manual_completion
        with patch('learner_api.attendance_lectures.read_native_occurrences', return_value=self.schedule), \
             patch('learner_api.manual_attendance_completion.timezone.now', return_value=self.now + timedelta(days=1)):
            return read_manual_completion([{'componentId': 'C1', 'moduleId': 'M1'}], profile or self.profile)

    def test_save_read_retry_and_reversal_with_real_tables(self):
        for _ in range(2):
            register.save_live_attendance({self.register.pk: 'present'}, actor='staff@example.invalid')
        self.assertEqual(self.corrections.count(), 1)
        self.assertTrue(self.completion()[('C1', 'M1')][0])
        self.assertEqual(self.completion(SimpleNamespace(pk=8, enrolment_id=80)), {})
        self.register.refresh_from_db()
        self.assertEqual((self.register.attended_seconds, self.register.attendance_report_id), (0, ''))
        register.save_live_attendance({self.register.pk: 'absent'}, actor='staff@example.invalid')
        self.assertFalse(self.completion()[('C1', 'M1')][0])

    def test_shared_correction_preserves_the_source_module_with_real_tables(self):
        shared = register.LiveSessionLearnerAttendance.objects.create(
            occurrence_id='O1', live_session_id='S1', module_catalogue_id='M2',
            learner_profile_id=7, attendance_status='absent', calculated_at=self.now)
        register.save_live_attendance({self.register.pk: 'present', shared.pk: 'absent'})
        self.assertEqual(dict(self.corrections.values_list('source_id', 'status')),
                         {'O1': 'present', 'O1:M2': 'absent'})
        register.save_live_attendance({shared.pk: 'present'})
        self.register.refresh_from_db()
        shared.refresh_from_db()
        self.assertEqual((self.register.attendance_status, shared.attendance_status), ('present', 'present'))
        self.assertEqual(self.corrections.count(), 2)

    def test_saved_bulk_presence_projects_authored_hours_without_writing_progress(self):
        from learner_api.live_session_progress import read_live_credits, supplement_module_hours
        register.save_live_attendance({self.register.pk: 'present'}, actor='staff@example.invalid')
        source = SimpleNamespace(pk=70, _case_file_profile=self.profile)
        with patch('learner_api.attendance_lectures.read_native_occurrences', return_value=self.schedule), \
             patch('learner_api.manual_attendance_completion.timezone.now', return_value=self.now + timedelta(days=1)):
            credits = read_live_credits(source, components=[{'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session'}], register=[])
        self.assertEqual(len(credits), 1)
        self.assertEqual(credits[0]['hours'], 2.5)
        self.assertEqual(credits[0]['timeTrackingSource'], 'manual_attendance')
        self.assertEqual(supplement_module_hours({'M1': {'hours': {'actual': 0}}}, [], credits)['M1']['hours']['actual'], 2.5)
        self.assertEqual(self.corrections.count(), 1)

    def test_correction_failure_rolls_back_the_register_write(self):
        from django.db import DatabaseError
        from django.db.models.query import QuerySet
        with patch.object(QuerySet, 'update_or_create', side_effect=DatabaseError('synthetic failure')):
            with self.assertRaises(DatabaseError):
                register.save_live_attendance({self.register.pk: 'present'})
        self.register.refresh_from_db()
        self.assertEqual(self.register.attendance_status, 'absent')
        self.assertEqual(self.corrections.count(), 0)

    def test_existing_coach_manual_presence_and_delete_are_projected_on_read(self):
        from coach_api.models import CoachManualAttendance
        from learner_api.learner_detail import SOURCE_MODELS
        source = SimpleNamespace(id=70, email=self.profile.email, username='')
        record = CoachManualAttendance.objects.create(
            owner_email='coach@example.invalid', learner_id=7, enrolment_id=70,
            learner_name='Synthetic', session_date=self.now.date(), module_name='Module one',
            session_title='Lecture 1', status='present', created_by='coach@example.invalid')
        with patch.object(SOURCE_MODELS['commercial'], 'all_learners') as sources, \
             patch('learner_api.attendance_assignments.assigned_module_ids', return_value=['M1']):
            sources.filter.return_value.only.return_value.first.return_value = source
            self.assertTrue(self.completion()[('C1', 'M1')][0])
            from learner_api.manual_attendance_completion import read_manual_credit_evidence
            with patch('learner_api.attendance_lectures.read_native_occurrences', return_value=self.schedule), \
                 patch('learner_api.manual_attendance_completion.timezone.now', return_value=self.now + timedelta(days=1)):
                _, credits = read_manual_credit_evidence([{'componentId': 'C1', 'moduleId': 'M1'}], self.profile)
            self.assertEqual(credits[0]['hours'], 2.5)
            record.delete()
            self.assertEqual(self.completion(), {})
