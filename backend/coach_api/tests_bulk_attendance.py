"""Hermetic Phase 3 regressions; no real learners, meetings or database writes."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch
import json
from inspect import unwrap

from django.test import SimpleTestCase, RequestFactory, TestCase
from django.db import DatabaseError, connections, transaction
from datetime import date, datetime, timedelta, timezone
from . import bulk_attendance as bulk


class BulkWriteTests(SimpleTestCase):
    def setUp(self):
        self.saved = {}
        self.profiles = {str(i): SimpleNamespace(id=i, _caseload_source=SimpleNamespace(id=i + 900)) for i in (42, 43)}
        self.rows = patch.object(bulk, 'current_row', side_effect=self.current).start()
        self.manager = patch.object(bulk.CoachAttendanceSourceAdjustment, 'objects').start()
        self.manager.update_or_create.side_effect = self.save
        self.addCleanup(patch.stopall)

    def current(self, profile, occurrence, **kwargs):
        return {'attendance_status': 'absent'}, self.saved.get((profile.id, occurrence)), 'version'

    def save(self, learner_id, source, source_id, defaults):
        self.assertEqual(source, 'microsoft-teams')
        self.saved[learner_id, source_id] = SimpleNamespace(**defaults)

    def write(self, records, occurrence='occ-1'):
        return bulk.write_records(self.profiles, occurrence, records, 'coach@example.test')

    def record(self, learner='42', status='present', version='version'):
        return {'learnerId': learner, 'status': status, 'version': version}

    def test_create_uses_correction_not_raw_evidence_or_manual_row(self):
        with patch('coach_api.models.CoachManualAttendance.objects') as manual, patch('coach_api.models.CoachAbsenceReport.objects') as reports:
            self.assertEqual(self.write([self.record()])[0]['action'], 'created')
            self.assertFalse(manual.mock_calls)
            self.assertFalse(reports.mock_calls)

    def test_update_only_status_preserves_existing_metadata(self):
        self.write([self.record()])
        self.assertEqual(self.write([self.record(status='absent')])[0]['action'], 'updated')
        self.assertEqual(self.saved[42, 'occ-1'].status, 'absent')
        self.assertNotIn('session_date', self.manager.update_or_create.call_args.kwargs['defaults'])

    def test_identical_retry_is_noop_even_with_old_version(self):
        self.write([self.record()])
        self.assertEqual(self.write([self.record(version='old')])[0]['action'], 'unchanged')
        self.assertEqual(self.manager.update_or_create.call_count, 1)
        self.assertEqual(len(self.saved), 1)

    def test_multiple_learners_mixed_statuses(self):
        self.write([self.record(), self.record('43', 'absent')])
        self.assertEqual(len(self.saved), 2)
        self.assertEqual(self.saved[43, 'occ-1'].status, 'absent')

    def test_same_day_occurrences_are_independent(self):
        self.write([self.record()], 'morning')
        self.write([self.record(status='absent')], 'afternoon')
        self.assertEqual(len(self.saved), 2)
        self.assertEqual(self.saved[42, 'morning'].status, 'present')

    def test_unauthorized_learner_rejects_whole_batch_before_write(self):
        with self.assertRaises(bulk.BulkError) as error:
            self.write([self.record(), self.record('999')])
        self.assertEqual(error.exception.status, 403)
        self.manager.update_or_create.assert_not_called()

    def test_stale_edit_rejects_whole_batch(self):
        with self.assertRaises(bulk.BulkError) as error:
            self.write([self.record(), self.record('43', version='old')])
        self.assertEqual(error.exception.status, 409)
        self.manager.update_or_create.assert_not_called()

    def test_duplicate_learner_rejected(self):
        with self.assertRaises(bulk.BulkError):
            self.write([self.record(), self.record()])
        self.manager.update_or_create.assert_not_called()

    def test_not_marked_is_not_a_destructive_clear(self):
        with self.assertRaises(bulk.BulkError):
            self.write([self.record(status='not_marked')])

    def test_absent_then_present_does_not_touch_reports(self):
        with patch('coach_api.models.CoachAbsenceReport.objects') as reports:
            self.write([self.record(status='absent')])
            self.write([self.record()])
            self.assertFalse(reports.mock_calls)


class BulkEndpointTests(SimpleTestCase):
    def request(self, **changes):
        payload = {'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': 'occ', 'records': [{'learnerId': '42', 'status': 'present', 'version': 'v'}], **changes}
        return RequestFactory().post('/coach_api/coach/attendance/bulk', json.dumps(payload), content_type='application/json')

    def call(self, request):
        # Bypass only the access wrapper in unit tests; production retains it.
        return unwrap(bulk.coach_bulk_attendance)(request)

    def setUp(self):
        for target, value in [('coach_api.views.authenticated_coach_email', 'coach@example.test'), ('coach_api.views.is_coach_view_as', False), ('coach_api.bulk_attendance.context_profiles', {'42': SimpleNamespace(id=42)}), ('coach_api.bulk_attendance.delivery_occurrences', [(SimpleNamespace(id='occ'), None)])]:
            mock = patch(target, return_value=value).start()
            if target.endswith('delivery_occurrences'):
                self.occurrences = mock
        patch('coach_api.bulk_attendance.transaction.atomic', side_effect=lambda **kwargs: nullcontext()).start()
        self.writer = patch('coach_api.bulk_attendance.write_records', return_value=[]).start()
        self.addCleanup(patch.stopall)

    def test_cancelled_or_outside_group_occurrence_rejected(self):
        self.occurrences.return_value = []
        self.assertEqual(self.call(self.request()).status_code, 409)
        self.writer.assert_not_called()

    def test_context_and_lock_are_required(self):
        self.assertEqual(self.call(self.request()).status_code, 200)
        self.occurrences.assert_called_once_with('p', 'g', 'occ', lock=True)

    def test_view_as_cannot_write(self):
        with patch('coach_api.views.is_coach_view_as', return_value=True):
            self.assertEqual(self.call(self.request()).status_code, 403)
        self.writer.assert_not_called()

    def test_missing_occurrence_rejected(self):
        self.assertEqual(self.call(self.request(sessionOccurrenceId='')).status_code, 400)

    def test_bad_json_rejected(self):
        request = RequestFactory().post('/', '[]', content_type='application/json')
        self.assertEqual(self.call(request).status_code, 400)


class BulkPersistenceTests(TestCase):
    """Exercise the existing unique constraint and rollback on isolated SQLite."""
    def setUp(self):
        self.profiles = {str(i): SimpleNamespace(id=i, _caseload_source=SimpleNamespace(id=900 + i)) for i in (42, 43)}
        self.register = patch.object(bulk, 'lecture_register', return_value=[{
            'source': 'microsoft-teams', 'session_id': 'morning', 'attendance_status': 'absent',
            'session_date': date(2026, 9, 1),
        }, {'source': 'microsoft-teams', 'session_id': 'afternoon', 'attendance_status': 'absent',
            'session_date': date(2026, 9, 1)}]).start()
        self.addCleanup(patch.stopall)

    def record(self, learner, status, occurrence='morning'):
        _, _, version = bulk.current_row(self.profiles[learner], occurrence)
        return {'learnerId': learner, 'status': status, 'version': version}

    def write(self, records, occurrence='morning'):
        with transaction.atomic():
            return bulk.write_records(self.profiles, occurrence, records, 'coach@example.test')

    def test_persist_create_retry_update_and_same_day_separation(self):
        request = [self.record('42', 'present'), self.record('43', 'absent')]
        self.write(request)
        self.write(request)
        self.assertEqual(bulk.CoachAttendanceSourceAdjustment.objects.count(), 2)
        self.write([self.record('42', 'absent')])
        self.write([self.record('42', 'present', 'afternoon')], 'afternoon')
        self.assertEqual(bulk.CoachAttendanceSourceAdjustment.objects.count(), 3)
        self.assertEqual(bulk.CoachAttendanceSourceAdjustment.objects.get(learner_id=42, source_id='morning').status, 'absent')

    def test_database_failure_rolls_back_entire_batch(self):
        records = [self.record('42', 'present'), self.record('43', 'absent')]
        manager = bulk.CoachAttendanceSourceAdjustment.objects
        original = manager.update_or_create
        calls = 0
        def fail_second(**kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise DatabaseError('synthetic failure')
            return original(**kwargs)
        with patch.object(manager, 'update_or_create', side_effect=fail_second):
            with self.assertRaises(DatabaseError):
                self.write(records)
        self.assertEqual(manager.count(), 0)

    def test_post_returns_replacement_occurrence_and_current_version_without_duplicate_corrections(self):
        def contract(source, learner_profile_id):
            adjustment = bulk.CoachAttendanceSourceAdjustment.objects.get(
                learner_id=learner_profile_id, source_id='morning')
            return {'history': [{'learnerId': str(learner_profile_id), 'source': 'microsoft-teams',
                                 'sourceId': 'morning', 'sessionId': 'teams:morning',
                                 'sessionDate': '2026-09-01', 'status': adjustment.status, 'counted': True}]}

        with patch.object(bulk, 'context_profiles', return_value=self.profiles), \
                patch.object(bulk, 'delivery_occurrences', return_value=[(SimpleNamespace(id='morning'), None)]), \
                patch.object(bulk, 'attendance_read_contract', side_effect=contract), \
                patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'), \
                patch('coach_api.views.is_coach_view_as', return_value=False):
            # No delivery writes: the endpoint's enrolment transaction is isolated
            # by a mock while the correction uses this TestCase's real SQLite DB.
            atomic = transaction.atomic
            with patch.object(bulk.transaction, 'atomic', side_effect=lambda **kw: nullcontext() if kw.get('using') == 'enrolment' else atomic()):
                for status in ('absent', 'present', 'absent'):
                    request = RequestFactory().post('/', json.dumps({
                        'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': 'morning',
                        'records': [self.record('42', status)],
                    }), content_type='application/json')
                    response = unwrap(bulk.coach_bulk_attendance)(request)
                    self.assertEqual(response.status_code, 200)
                    result = json.loads(response.content)['results'][0]
                    self.assertEqual(result['sessionOccurrenceId'], 'morning')
                    self.assertEqual(result['status'], status)
                    self.assertEqual(result['attendanceRecord']['status'], status)
                    self.assertEqual(result['attendanceRecord']['sessionId'], 'teams:morning')
                    self.assertEqual(result['version'], bulk.current_row(self.profiles['42'], 'morning')[2])
                    self.assertEqual(bulk.CoachAttendanceSourceAdjustment.objects.count(), 1)


class DeliveryValidationTests(SimpleTestCase):
    def test_filters_delivery_and_excludes_invalid_occurrences_and_series(self):
        with patch.object(bulk.ModuleAuthoringModule, 'objects') as modules, patch.object(bulk.LiveSession, 'objects') as sessions, patch.object(bulk.LiveSessionOccurrence, 'objects') as occurrences:
            module_query = modules.using.return_value.filter.return_value
            module_query.__iter__.return_value = [SimpleNamespace(module_catalogue_id='module', title='Module')]
            session_query = sessions.using.return_value.filter.return_value
            session_query.__iter__.return_value = [SimpleNamespace(id='series', status='active', module_catalogue_id='module')]
            occurrence_query = occurrences.using.return_value.filter.return_value
            occurrence_query.order_by.return_value = [SimpleNamespace(id=status, live_session_id='series', status=status) for status in ['scheduled', *sorted(bulk.INVALID)]]
            result = bulk.delivery_occurrences('programme', 'group')
            self.assertEqual([row.id for row, _ in result], ['scheduled'])
            modules.using.assert_called_once_with('enrolment')
            modules.using.return_value.filter.assert_called_once_with(programme_id='programme', group_id='group', deleted_at__isnull=True, is_programme_deleted=False)
            module_query.__iter__.return_value = [SimpleNamespace(module_catalogue_id='module', title='Module')]
            session_query.__iter__.return_value = [SimpleNamespace(id='series', status='superseded', module_catalogue_id='module')]
            self.assertEqual(bulk.delivery_occurrences('programme', 'group'), [])

    def test_missing_source_and_unassigned_occurrence_rejected(self):
        with self.assertRaises(bulk.BulkError):
            bulk.current_row(SimpleNamespace(id=42), 'occ')
        with patch.object(bulk, 'lecture_register', return_value=[]):
            with self.assertRaises(bulk.BulkError):
                bulk.current_row(SimpleNamespace(id=42, _caseload_source=SimpleNamespace(id=901)), 'occ')


class BulkPersistedOccurrenceReadTests(TestCase):
    """Real delivery lookup on isolated SQLite; synthetic learner evidence only.

    Run with config.settings_sqlite_test and Django's DiscoverRunner. These
    unmanaged tables live in a temporary attached schema, never a live database.
    """
    databases = {'default', 'enrolment'}
    delivery_models = (bulk.ModuleAuthoringModule, bulk.LiveSession, bulk.LiveSessionOccurrence)

    @classmethod
    def setUpClass(cls):
        connection = connections['enrolment']
        if connection.vendor != 'sqlite' or not connection.settings_dict['NAME'].startswith(('file:memorydb_', ':memory:')):
            raise RuntimeError('Persisted bulk read fixtures require an in-memory SQLite test database.')
        with connection.cursor() as cursor:
            cursor.execute("ATTACH DATABASE ':memory:' AS curriculum")
        with connection.schema_editor() as editor:
            for model in cls.delivery_models:
                editor.create_model(model)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        connection = connections['enrolment']
        with connection.schema_editor() as editor:
            for model in reversed(cls.delivery_models):
                editor.delete_model(model)
        with connection.cursor() as cursor:
            cursor.execute('DETACH DATABASE curriculum')

    def setUp(self):
        start = datetime(2026, 9, 1, 10, tzinfo=timezone.utc)
        for group in ('group-a', 'group-b'):
            module = bulk.ModuleAuthoringModule.objects.using('enrolment').create(
                module_catalogue_id=f'module-{group}', programme_id='programme', group_id=group, title='Synthetic module')
            series = bulk.LiveSession.objects.using('enrolment').create(
                id=f'series-{group}', module_catalogue_id=module.pk, organizer_email='coach@example.test')
            bulk.LiveSessionOccurrence.objects.using('enrolment').create(
                id=f'occurrence-{group}', live_session_id=series.pk, session_number=1,
                scheduled_start=start, scheduled_end=start + timedelta(hours=1))
        self.profiles = {str(i): SimpleNamespace(id=i, _caseload_source=SimpleNamespace(id=i + 900)) for i in (42, 43)}
        patch.object(bulk, 'context_profiles', return_value=self.profiles).start()
        patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test').start()
        patch.object(bulk, 'lecture_register', return_value=[{
            'source': 'microsoft-teams', 'session_id': 'occurrence-group-a', 'attendance_status': 'pending',
        }]).start()
        patch.object(bulk, 'attendance_read_contract', side_effect=lambda source, **kwargs: {
            'history': [{'source': 'microsoft-teams', 'sourceId': 'occurrence-group-a',
                         'status': 'present' if source.id == 942 else 'unmarked'}],
        }).start()
        self.addCleanup(patch.stopall)

    def get(self, occurrence=None):
        params = {'programmeId': 'programme', 'groupId': 'group-a'}
        if occurrence is not None:
            params['sessionOccurrenceId'] = occurrence
        request = RequestFactory().get('/coach_api/coach/attendance/bulk', params)
        return unwrap(bulk.coach_bulk_attendance)(request)

    def test_listed_persisted_id_round_trips_to_detail_with_eligible_statuses(self):
        listing = self.get()
        self.assertEqual(listing.status_code, 200)
        sessions = json.loads(listing.content)['sessions']
        self.assertEqual([row['id'] for row in sessions], ['occurrence-group-a'])
        detail = self.get(sessions[0]['id'])
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(json.loads(detail.content)['warnings'], [])
        learners = json.loads(detail.content)['learners']
        self.assertEqual([(row['learnerId'], row['status']) for row in learners],
                         [('42', 'present'), ('43', 'unmarked')])
        self.assertTrue(all(row['version'] for row in learners))

    def test_invalid_occurrence_is_rejected(self):
        self.assertEqual(self.get('missing-occurrence').status_code, 409)

    def test_other_group_occurrence_is_rejected(self):
        self.assertEqual(self.get('occurrence-group-b').status_code, 409)

    def test_cancelled_occurrence_is_not_listed_or_loadable(self):
        bulk.LiveSessionOccurrence.objects.using('enrolment').filter(pk='occurrence-group-a').update(status='cancelled')
        self.assertEqual(json.loads(self.get().content)['sessions'], [])
        self.assertEqual(self.get('occurrence-group-a').status_code, 409)

    def test_cancellation_between_list_and_detail_remains_a_conflict(self):
        occurrence = json.loads(self.get().content)['sessions'][0]['id']
        bulk.LiveSessionOccurrence.objects.using('enrolment').filter(pk=occurrence).update(status='superseded')
        self.assertEqual(self.get(occurrence).status_code, 409)

    def test_missing_learner_source_returns_valid_rows_and_warning(self):
        # A dangling Learner.learners.enrolment_id leaves this attachment None.
        # The occurrence still resolves: this is a learner-source data failure.
        self.profiles['43']._caseload_source = None
        self.profiles['43'].enrolment_id = 999
        occurrence = json.loads(self.get().content)['sessions'][0]['id']
        with self.assertLogs(bulk.log, level='WARNING') as logged:
            response = self.get(occurrence)
        entry = logged.records[0]
        self.assertEqual((entry.learner_profile_id, entry.enrolment_id, entry.programme_id, entry.group_id, entry.occurrence_id),
                         (43, 999, 'programme', 'group-a', occurrence))
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual([row['learnerId'] for row in payload['learners']], ['42'])
        self.assertEqual(payload['warnings'], [{'learnerProfileId': '43', 'code': 'learner_source_unavailable',
                                               'message': 'Attendance source unavailable for this learner.'}])

    def test_broken_source_post_rejects_whole_batch_without_writes(self):
        self.profiles['43']._caseload_source = None
        _, _, version = bulk.current_row(self.profiles['42'], 'occurrence-group-a')
        request = RequestFactory().post('/', json.dumps({
            'programmeId': 'programme', 'groupId': 'group-a', 'sessionOccurrenceId': 'occurrence-group-a',
            'records': [{'learnerId': '42', 'status': 'present', 'version': version},
                        {'learnerId': '43', 'status': 'absent', 'version': 'unused'}],
        }), content_type='application/json')
        with patch('coach_api.views.is_coach_view_as', return_value=False):
            response = unwrap(bulk.coach_bulk_attendance)(request)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(bulk.CoachAttendanceSourceAdjustment.objects.count(), 0)

    def test_no_authorized_context_is_forbidden(self):
        self.profiles.clear()
        self.assertEqual(self.get('occurrence-group-a').status_code, 403)

    def test_all_broken_sources_return_no_writable_rows_and_warnings(self):
        for profile in self.profiles.values():
            profile._caseload_source = None
        with self.assertLogs(bulk.log, level='WARNING'):
            response = self.get('occurrence-group-a')
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['learners'], [])
        self.assertEqual(len(payload['warnings']), 2)
