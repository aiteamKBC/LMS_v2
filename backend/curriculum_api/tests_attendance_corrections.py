import json
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase, RequestFactory, TestCase
from . import attendance_corrections as api


class AttendanceCorrectionTests(SimpleTestCase):
    def setUp(self):
        self.profile = SimpleNamespace(id=7, enrolment_id=70)
        self.profile_manager = patch.object(api.LearnerProfile, 'objects').start()
        self.profile_manager.select_for_update.return_value.get.return_value = self.profile
        self.manager = patch.object(api.CoachAttendanceSourceAdjustment, 'objects').start()
        self.manager.select_for_update.return_value.filter.return_value.first.return_value = None
        self.source = patch.dict(api.SOURCE_MODELS, {'commercial': SimpleNamespace(all_learners=SimpleNamespace(
            filter=lambda **kwargs: SimpleNamespace(first=lambda: SimpleNamespace(id=70))))}).start()
        patch.object(api, 'assigned_module_ids', return_value=['module']).start()
        self.native = patch.object(api, 'read_native_occurrences', return_value=[{'session_id': 'occ'}]).start()
        self.roster = [{'learner_profile_id': 7, 'learner_email': 'learner@example.invalid'}]
        self.occurrence = SimpleNamespace(id='occ', scheduled_end=datetime.now(timezone.utc) - timedelta(hours=1))
        self.manager.update_or_create.side_effect = self.save
        self.saved = None
        self.addCleanup(patch.stopall)

    def save(self, **kwargs):
        self.saved = SimpleNamespace(pk=1, updated_at='new-version', **kwargs['defaults'])
        return self.saved, True

    def write(self, **changes):
        return api.save_correction('module', self.occurrence, 'occ', self.roster,
            {'action': 'present', 'learnerProfileId': 7, 'version': api.correction_state(None)['version'], **changes},
            'staff@example.invalid')

    def test_present_is_saved_only_as_correction(self):
        result = self.write()
        self.assertEqual(result['manualStatus'], 'present')
        self.assertEqual(self.manager.update_or_create.call_args.kwargs, {
            'learner_id': 7, 'source': 'microsoft-teams', 'source_id': 'occ',
            'defaults': {'status': 'present', 'is_deleted': False, 'owner_email': 'staff@example.invalid', 'updated_by': 'staff@example.invalid'}})

    def test_other_learner_cannot_be_changed(self):
        with self.assertRaises(api.CorrectionError) as error:
            self.write(learnerProfileId=8)
        self.assertEqual(error.exception.status, 403)
        self.manager.update_or_create.assert_not_called()

    def test_stale_edit_is_rejected(self):
        with self.assertRaises(api.CorrectionError) as error:
            self.write(version='old')
        self.assertEqual(error.exception.status, 409)
        self.manager.update_or_create.assert_not_called()

    def test_assignment_change_and_future_session_are_rejected(self):
        with patch.object(api, 'assigned_module_ids', return_value=[]):
            with self.assertRaises(api.CorrectionError):
                self.write()
        self.occurrence.scheduled_end = datetime.now(timezone.utc) + timedelta(hours=1)
        with self.assertRaises(api.CorrectionError):
            self.write()
        self.manager.update_or_create.assert_not_called()

    def test_shared_delivery_uses_learner_occurrence_key_not_owner_key(self):
        self.native.return_value = [{'session_id': 'occ:module'}]
        with self.assertRaises(api.CorrectionError):
            self.write()
        api.save_correction('module', self.occurrence, 'occ:module', self.roster,
            {'action': 'absent', 'learnerProfileId': 7, 'version': api.correction_state(None)['version']}, 'staff@example.invalid')
        self.assertEqual(self.manager.update_or_create.call_args.kwargs['source_id'], 'occ:module')

    def test_reset_preserves_metadata_and_clears_only_status(self):
        saved = SimpleNamespace(pk=1, status='present', is_deleted=False, updated_at='before', module_name='Custom title')
        self.manager.select_for_update.return_value.filter.return_value.first.return_value = saved
        result = self.write(action='reset', version=api.correction_state(saved)['version'])
        self.assertIsNone(result['manualStatus'])
        self.assertEqual(self.manager.update_or_create.call_args.kwargs['defaults']['status'], '')
        self.assertNotIn('module_name', self.manager.update_or_create.call_args.kwargs['defaults'])
        self.manager.delete.assert_not_called()

    def test_reset_retry_is_idempotent(self):
        self.write(action='reset', version='old')
        self.manager.update_or_create.assert_not_called()

    def test_real_write_retry_is_idempotent(self):
        self.manager.select_for_update.return_value.filter.return_value.first.return_value = SimpleNamespace(
            pk=1, status='present', is_deleted=False, updated_at='new')
        self.write(version='old')
        self.manager.update_or_create.assert_not_called()


class AttendanceCorrectionAccessTests(SimpleTestCase):
    def test_cancelled_and_foreign_module_sessions_are_rejected(self):
        with patch.object(api.LiveSession, 'objects') as series, patch.object(api.LiveSessionOccurrence, 'objects') as occurrences, \
                patch.object(api.ModuleAuthoringModule, 'objects') as modules, patch.object(api, 'module_roster') as roster, \
                patch('curriculum_api.session_results.replaced_module_register_rows', return_value=[]):
            series.using.return_value.filter.return_value.first.return_value = SimpleNamespace(status='active', module_catalogue_id='owner')
            occurrence = SimpleNamespace(id='occ', status='cancelled')
            occurrences.using.return_value.filter.return_value.__getitem__.return_value = [occurrence]
            with self.assertRaises(api.CorrectionError):
                api.session_context('s', 1, 'foreign')
            occurrence.status = 'completed'
            modules.using.return_value.filter.return_value.first.return_value = SimpleNamespace()
            with self.assertRaises(api.CorrectionError):
                api.session_context('s', 1, 'foreign')
            roster.assert_not_called()

    def test_roles_and_csrf_are_enforced(self):
        for role in ['learner', 'employer']:
            with self.subTest(role=role), patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role)):
                request = RequestFactory().post('/', '{}', content_type='application/json')
                self.assertEqual(api.session_attendance_correction(request, 'series', 1).status_code, 403)
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(api.session_attendance_correction(RequestFactory().get('/'), 'series', 1).status_code, 401)
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')):
            request = RequestFactory().post('/', '{}', content_type='application/json')
            self.assertEqual(api.session_attendance_correction(request, 'series', 1).status_code, 403)

    def test_view_as_and_malformed_payload_do_not_write(self):
        with patch.object(api, 'save_correction') as save:
            for body, query, expected in [('{}', '?viewAsCoach=test@example.invalid', 403), ('[]', '', 400), ('{', '', 400)]:
                request = RequestFactory().post('/'+query, body, content_type='application/json')
                self.assertEqual(unwrap(api.session_attendance_correction)(request, 'series', 1).status_code, expected)
            save.assert_not_called()

    def test_authorized_staff_write_records_actual_actor(self):
        request = RequestFactory().post('/', json.dumps({'action': 'present'}), content_type='application/json')
        request.login_account = SimpleNamespace(email='real-staff@example.invalid')
        with patch.object(api.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()), \
                patch.object(api, 'session_context', return_value=('m', SimpleNamespace(), 'o', [])), \
                patch.object(api, 'save_correction', return_value={'manualStatus': 'present'}) as save, \
                patch('coach_api.attendance_context.clear_context_cache'):
            self.assertEqual(unwrap(api.session_attendance_correction)(request, 'series', 1).status_code, 200)
            self.assertEqual(save.call_args.args[-1], 'real-staff@example.invalid')


class AttendanceCorrectionPersistenceTests(TestCase):
    def test_staff_save_and_reset_keep_other_learners_and_source_metadata(self):
        manager = api.CoachAttendanceSourceAdjustment.objects
        other = manager.create(learner_id=8, source='microsoft-teams', source_id='occ',
            owner_email='coach@example.invalid', updated_by='coach@example.invalid', status='absent')
        saved = manager.create(learner_id=7, source='microsoft-teams', source_id='occ',
            owner_email='coach@example.invalid', updated_by='coach@example.invalid', status='absent', module_name='Saved title')
        source = SimpleNamespace(id=70)
        occurrence = SimpleNamespace(id='occ', scheduled_end=datetime.now(timezone.utc) - timedelta(hours=1))
        with patch.object(api.LearnerProfile, 'objects') as profiles, \
                patch.dict(api.SOURCE_MODELS, {'commercial': SimpleNamespace(all_learners=SimpleNamespace(
                    filter=lambda **kwargs: SimpleNamespace(first=lambda: source)))}), \
                patch.object(api, 'assigned_module_ids', return_value=['module']), \
                patch.object(api, 'read_native_occurrences', return_value=[{'session_id': 'occ'}]):
            profiles.select_for_update.return_value.get.return_value = SimpleNamespace(id=7, enrolment_id=70)
            result = api.save_correction('module', occurrence, 'occ', [{'learner_profile_id': 7}],
                {'action': 'present', 'learnerProfileId': 7, 'version': api.correction_state(saved)['version']}, 'staff@example.invalid')
            self.assertEqual(result['manualStatus'], 'present')
            api.save_correction('module', occurrence, 'occ', [{'learner_profile_id': 7}],
                {'action': 'reset', 'learnerProfileId': 7, 'version': result['version']}, 'staff@example.invalid')
        saved.refresh_from_db(); other.refresh_from_db()
        self.assertEqual((saved.status, saved.module_name, saved.updated_by), ('', 'Saved title', 'staff@example.invalid'))
        self.assertEqual(other.status, 'absent')
        self.assertEqual(manager.count(), 2)
