"""Synthetic Coach detail contract/parity tests. Real database access is forbidden."""
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone as utc
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from learner_api import attendance_lectures as canonical
from learner_api.tests_attendance_lectures import register_row
from . import attendance_detail as detail
from .attendance_projection import AttendancePaginationError
from .views import coach_attendance_details

NOW = datetime(2026, 10, 8, 12, tzinfo=utc.utc)


class CoachDetailProjectionTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(id=901, email='synthetic@example.test', username='Synthetic Learner')
        self.rows = [register_row(session_id=f'legacy-{i:03}', learner_id=901,
            session_date=date(2026, 8, 1) + timedelta(days=i),
            attendance_status='present' if i % 4 else 'absent') for i in range(43)]
        self.schedule = []
        self.manuals = []
        self.reports = []
        self.adjustments = []
        self.confirmations = {}
        self.completed = set()
        self.targets = {}
        for target, kwargs in (
            ('coach_api.attendance_detail.timezone.now', {'return_value': NOW}),
            ('coach_api.attendance_detail.historical_schedule', {'side_effect': lambda *_: deepcopy(self.schedule)}),
            ('coach_api.attendance_detail.historical_evidence', {'side_effect': lambda *_: deepcopy(self.rows)}),
            ('coach_api.attendance_detail.kbc_attendance_rows', {'side_effect': lambda *_: deepcopy(self.rows)}),
            ('learner_api.attendance_lectures.combined_attendance_rows', {'side_effect': lambda *_: deepcopy(self.rows)}),
            ('learner_api.attendance_confirmation.read_confirmations', {'side_effect': lambda *_: self.confirmations}),
            ('learner_api.attendance_lectures._completed_catchup_occurrences', {'side_effect': lambda *_: self.completed}),
            ('learner_api.attendance_lectures._approved_alternative_targets', {'side_effect': lambda *_: self.targets}),
            ('learner_api.attendance_lectures.read_native_components', {'return_value': ([], [])}),
            ('coach_api.attendance_detail.page_components', {'return_value': {}}),
            ('coach_api.models.CoachManualAttendance.objects', {}),
            ('coach_api.models.CoachAbsenceReport.objects', {}),
            ('coach_api.models.CoachAttendanceSourceAdjustment.objects', {}),
        ):
            patcher = patch(target, **kwargs)
            mock = patcher.start()
            self.addCleanup(patcher.stop)
            if 'ManualAttendance.objects' in target:
                self.manual_manager = mock
                mock.filter.return_value.only.side_effect = lambda *_: self.manuals
                mock.filter.return_value.__iter__.side_effect = lambda: iter(self.manuals)
            elif 'AbsenceReport.objects' in target:
                self.report_manager = mock
                mock.filter.return_value.order_by.side_effect = lambda *_: self.reports
                mock.filter.return_value.only.return_value.order_by.side_effect = lambda *_: self.reports
            elif 'SourceAdjustment.objects' in target:
                self.adjustment_manager = mock
                mock.filter.return_value.__iter__.side_effect = lambda: iter(self.adjustments)
        self.sync = patch('learner_api.catchup_outcomes.sync_catchup_outcomes', side_effect=AssertionError('GET must not settle catch-ups')).start()
        self.graph = patch('coach_api.views.microsoft_graph_request', side_effect=AssertionError('No live Teams reads')).start()
        patch('socket.create_connection', side_effect=AssertionError('Offline test only')).start()
        self.addCleanup(patch.stopall)

    def read(self, **params):
        return detail.detail_records(self.source, 42, params)

    def old(self, extra_schedule=None):
        with patch.object(canonical, 'read_native_occurrences', return_value=deepcopy(self.schedule + (extra_schedule or []))):
            return canonical.attendance_read_contract(self.source, learner_profile_id=42)

    def test_compact_fields_and_unchanged_full_history_summary(self):
        expected = self.old()
        actual = self.read()
        self.assertEqual(actual['summary'], {key: expected['summary'][key]
            for key in ('present', 'absent', 'sessions', 'attendanceRate')})
        self.assertEqual(set(actual), {'summary', 'records', 'pagination'})
        self.assertEqual(len(actual['records']), 20)
        for row in actual['records']:
            self.assertEqual(set(row), {'id', 'date', 'module', 'title', 'status', 'absenceReport'})
        self.assertEqual([row['date'] for row in actual['records']],
            [row['sessionDate'] for row in expected['history'][:20]])

    def test_pagination_covers_all_counted_records_once(self):
        pages = [self.read(page=page) for page in (1, 2, 3)]
        self.assertEqual([len(page['records']) for page in pages], [20, 20, 3])
        self.assertEqual([page['pagination']['hasMore'] for page in pages], [True, True, False])
        self.assertEqual(pages[1]['pagination'], {'page': 2, 'pageSize': 20, 'total': 43, 'hasMore': True})
        identities = [row['id'] for page in pages for row in page['records']]
        self.assertEqual(len(set(identities)), 43)
        self.assertEqual(self.read(page=4)['records'], [])
        self.assertEqual(len(self.read(pageSize=7)['records']), 7)

    def test_invalid_pagination_is_rejected_before_any_loading(self):
        for params in ({'page': 0}, {'page': 'bad'}, {'pageSize': 0}, {'pageSize': 101}):
            with self.subTest(params=params), self.assertRaises(AttendancePaginationError):
                self.read(**params)
        detail.historical_schedule.assert_not_called()

    def test_future_active_unmarked_and_invalid_records_never_enter_history(self):
        self.rows.extend([register_row(session_id='future', session_date=date(2026, 10, 9)),
            register_row(session_id='active', scheduled_start=NOW-timedelta(hours=1), scheduled_end=NOW+timedelta(hours=1)),
            register_row(session_id='unmarked', attendance_status='unmarked'),
            register_row(session_id='cancelled', attendance_status='cancelled')])
        actual = self.read(pageSize=100)
        self.assertEqual(actual['pagination']['total'], 43)
        self.assertTrue(all(row['status'] in {'present', 'absent'} for row in actual['records']))
        self.assertEqual(actual['summary'], {key: self.old()['summary'][key] for key in actual['summary']})

    def test_manual_and_source_ids_preserve_edit_delete_identity_including_colons(self):
        self.rows = [register_row(session_id='legacy:key')]
        self.manuals = [SimpleNamespace(id=9, session_date=date(2026, 9, 10), status='present', module_name='Manual', session_title='Manual session')]
        actual = self.read()
        self.assertEqual([row['id'] for row in actual['records']], ['coach-manual:9', 'kbc-attendance:legacy:key'])
        self.assertEqual(actual['summary']['sessions'], 2)

    def test_reports_are_scoped_to_selected_page_and_keep_latest_report(self):
        row = self.rows[-1]
        report_id = str(canonical.report_id(row))
        self.reports = [SimpleNamespace(id=7, attendance_id=report_id, status='submitted', evidence_image_url=''),
                        SimpleNamespace(id=8, attendance_id=report_id, status='approved', evidence_image_url='/evidence/synthetic')]
        actual = self.read(pageSize=1)
        self.report_manager.filter.assert_called_once_with(learner_id=901, attendance_id__in=[report_id])
        self.assertEqual(actual['records'][0]['absenceReport'], {'id': '8', 'status': 'approved', 'url': '/evidence/synthetic'})

    def test_empty_history_keeps_null_rate_and_does_not_query_reports(self):
        self.rows = []
        actual = self.read()
        self.assertEqual(actual['summary'], {'present': 0, 'absent': 0, 'sessions': 0, 'attendanceRate': None})
        self.assertEqual(actual['records'], [])
        self.report_manager.filter.assert_not_called()

    def test_canonical_confirmations_catchups_edits_and_deletions_keep_summary_parity(self):
        self.rows = []
        self.schedule = [register_row(source='microsoft-teams', session_id=key, learner_id=901,
            module_catalogue_id='module', session_date=date(2026, 9, 10), attendance_status='pending',
            scheduled_start=NOW-timedelta(days=28, hours=2), scheduled_end=NOW-timedelta(days=28))
            for key in ('confirmed', 'recovered', 'edited', 'deleted', 'unmarked')]
        self.confirmations = {'teams:confirmed-2026-09-10': {'seconds': 3600, 'submitted_at': NOW}}
        self.completed = {'recovered'}
        self.adjustments = [SimpleNamespace(source='microsoft-teams', source_id=key, is_deleted=deleted,
            session_date=None, module_name='', session_title='', status='absent', updated_at=NOW)
            for key, deleted in (('edited', False), ('deleted', True))]
        actual = self.read()
        expected = self.old()
        self.assertEqual(actual['summary'], {key: expected['summary'][key] for key in actual['summary']})
        self.assertEqual(actual['summary'], {'present': 2, 'absent': 1, 'sessions': 3, 'attendanceRate': 67})
        self.assertEqual({row['id'] for row in actual['records']}, {'microsoft-teams:confirmed', 'microsoft-teams:recovered', 'microsoft-teams:edited'})

    def test_get_projection_never_builds_full_contract_or_syncs_or_mutates(self):
        with patch.object(canonical, 'attendance_read_contract', side_effect=AssertionError('No full DTOs')), \
                patch.object(canonical, 'read_native_occurrences', side_effect=AssertionError('No future schedule')):
            self.read()
        self.sync.assert_not_called()
        self.graph.assert_not_called()
        for manager in (self.manual_manager, self.report_manager, self.adjustment_manager):
            manager.create.assert_not_called()
            manager.update_or_create.assert_not_called()
            manager.filter.return_value.update.assert_not_called()
            manager.filter.return_value.delete.assert_not_called()

    def test_approved_alternative_recovery_and_page_title_matching_keep_parity(self):
        self.schedule = [register_row(source='microsoft-teams', session_id='original', learner_id=901,
            module_catalogue_id='module', attendance_status='absent', session_date=date(2026, 9, 10),
            scheduled_start=NOW-timedelta(days=28, hours=2), scheduled_end=NOW-timedelta(days=28))]
        self.rows = [register_row(source='microsoft-teams', session_id='alternative', learner_id=901,
            attendance_status='present', eligibility_reason='approved_recovery_guest')]
        self.targets = {str(canonical.report_id(self.schedule[0])): 'alternative'}
        actual = self.read()
        expected = self.old()
        self.assertEqual(actual['summary'], {key: expected['summary'][key] for key in actual['summary']})
        self.assertEqual(actual['summary']['present'], 1)
        component = {'module_catalogue_id': 'module', 'type': 'live_session', 'title': 'Authored session title',
                     'settings': {'teamsOccurrenceId': 'original'}}
        detail.page_components.return_value = {'module': [component]}
        self.assertEqual(self.read()['records'][0]['title'], 'Authored session title')

    def test_matching_future_native_identity_keeps_legacy_mirror_eligibility_unchanged(self):
        self.rows = [register_row(session_date=date(2026, 10, 8), attendance_status='present')]
        self.schedule = [register_row(source='microsoft-teams', session_id='later-today',
            session_date=date(2026, 10, 8), attendance_status='upcoming',
            scheduled_start=NOW+timedelta(hours=2), scheduled_end=NOW+timedelta(hours=3))]
        actual = self.read()
        self.assertEqual(actual['summary'], {key: self.old()['summary'][key] for key in actual['summary']})
        self.assertEqual(actual['summary']['sessions'], 0)
        self.assertEqual(actual['records'], [])

    def test_legacy_ambiguity_warning_is_retained_only_when_visible(self):
        # Ambiguity is a verified table warning, not a duplicate status alias.
        self.rows = [register_row(legacy_ambiguity=['teams:one', 'teams:two'])]
        self.assertEqual(self.read()['records'][0]['legacyAmbiguity'], ['teams:one', 'teams:two'])

    def test_synthetic_old_new_json_size_and_response_parity(self):
        future = [register_row(source='microsoft-teams', session_id=f'future-{i}', learner_id=901,
            module_catalogue_id='module', attendance_status='upcoming', session_date=date(2026, 11, 1),
            scheduled_start=NOW+timedelta(days=24, hours=i), scheduled_end=NOW+timedelta(days=24, hours=i+1)) for i in range(60)]
        contract = self.old(extra_schedule=future)
        learner = {'id': '42', 'name': 'Synthetic Learner', 'email': 'synthetic@example.test', 'programme': 'Programme', 'cohort': 'Cohort', 'group': 'Group'}
        old = {'learner': {**learner, 'programmeId': 'p', 'groupId': 'g', 'programStatus': 'Active',
            'learnerType': 'commercial', 'enrolmentId': '901', 'learnerStartDate': None, 'learnerEndDate': None,
            'programmeStartDate': None, 'programmeEndDate': None, 'coachName': 'Coach'},
            'summary': contract['summary'], 'history': contract['history'],
            'recentAttendance': contract['recentAttendance'], 'sessions': contract['history']}
        new = {'learner': learner, 'coach': {'name': 'Coach', 'email': 'coach@example.test'}, 'tutor': None, **self.read()}
        before, after = len(JsonResponse(old).content), len(JsonResponse(new).content)
        reduction = round((before-after)/before*100, 2)
        self.assertGreater(reduction, 80)
        self.assertEqual(new['summary']['sessions'], old['summary']['sessions'])
        print(json.dumps({'fixture': '43 historical + 60 future, first page 20', 'old_json_bytes': before,
                          'new_json_bytes': after, 'reduction_percent': reduction}))


class HistoricalScheduleQueryTests(SimpleTestCase):
    def test_future_mirror_query_reads_only_identity_metadata_on_legacy_dates(self):
        source = SimpleNamespace(id=901, email='synthetic@example.test')
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('module', 'Module')]
        with patch.object(detail, 'connections', {'enrolment': connection}), \
                patch.object(canonical, 'dict_rows', side_effect=[[], []]), \
                patch.object(canonical, 'normalize_native_occurrences', return_value=[]):
            detail.historical_schedule(source, NOW, [register_row()])
        sql, params = cursor.execute.call_args.args
        self.assertIn('AND o.scheduled_end>%s', sql)
        self.assertIn('AT TIME ZONE %s)::date=ANY(%s)', sql)
        self.assertEqual(params[-1], [date(2026, 9, 1)])
        self.assertNotIn('join_url', sql)
        self.assertNotIn('live_session_attendance', sql)

    def test_evidence_loads_only_historical_occurrences_and_approved_recovery_targets(self):
        source = SimpleNamespace(id=901, email='synthetic@example.test')
        with patch.object(detail, 'kbc_attendance_rows', return_value=[]), \
                patch.object(canonical, '_approved_alternative_targets', return_value={'report': 'recovery-target'}), \
                patch.object(detail, 'fetch_verified_teams_attendance_rows', return_value=[]) as evidence:
            self.assertEqual(detail.historical_evidence(source, [{'session_id': 'historical'}]), [])
        evidence.assert_called_once_with(learner_emails=[source.email], occurrence_ids=['historical', 'recovery-target'])

    def test_future_schedule_is_excluded_in_sql_before_normalization(self):
        source = SimpleNamespace(id=901, email='synthetic@example.test')
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('module', 'Module')]
        with patch.object(detail, 'connections', {'enrolment': connection}), \
                patch.object(canonical, 'dict_rows', return_value=[]), \
                patch.object(canonical, 'normalize_native_occurrences', return_value=[]) as normalize:
            self.assertEqual(detail.historical_schedule(source, NOW), [])
        sql, params = cursor.execute.call_args.args
        self.assertIn('AND o.scheduled_end<=%s', sql)
        self.assertEqual(params, ['synthetic@example.test', ['module'], NOW])
        normalize.assert_called_once_with(source, [])


class DetailEndpointValidationTests(SimpleTestCase):
    @patch('coach_api.views.EnrolmentUser.all_learners')
    def test_source_projection_reads_only_requested_facts_with_stable_enrolment_bridge(self, sources):
        from .views import fetch_source_schedule_rows
        fields = ('id', 'email', 'learner_type')
        source = SimpleNamespace(id=901, email='synthetic@example.test', learner_type='commercial')
        sources.filter.return_value.only.return_value = [source]
        commercial, enrolment = fetch_source_schedule_rows([SimpleNamespace(id=42, enrolment_id=901)], fields=fields)
        sources.filter.assert_called_once_with(pk__in={901: 42})
        sources.filter.return_value.only.assert_called_once_with(*fields)
        self.assertEqual(commercial, {42: source})
        self.assertEqual(enrolment, {})

    @patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test')
    @patch('coach_api.views.fetch_attendance_caseload_rows')
    def test_bad_pagination_is_400_before_identity_loading(self, profiles, owner):
        request = RequestFactory().get('/coach_api/coach/attendance/details', {'learner_id': '42', 'page': 0})
        self.assertEqual(unwrap(coach_attendance_details)(request).status_code, 400)
        profiles.assert_not_called()

    @patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test')
    @patch('coach_api.views.fetch_attendance_caseload_rows', return_value=[])
    @patch('coach_api.views.fetch_source_schedule_rows')
    def test_unowned_learner_is_rejected_before_evidence(self, sources, profiles, owner):
        request = RequestFactory().get('/coach_api/coach/attendance/details', {'learner_id': '42'})
        self.assertEqual(unwrap(coach_attendance_details)(request).status_code, 404)
        sources.assert_not_called()
