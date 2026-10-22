"""Persisted bulk attendance reads; database transports are synthetic and read-only."""
from datetime import datetime, timedelta, timezone
from contextlib import nullcontext
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone as django_timezone

from . import bulk_register as register, bulk_attendance as bulk
from .attendance_timing import AttendanceTiming


class BulkRegisterTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
        self.profiles = [
            SimpleNamespace(id=1, _caseload_source=SimpleNamespace(id=901, learner_type='commercial')),
            SimpleNamespace(id=2, _caseload_source=SimpleNamespace(id=902, learner_type='apprenticeship')),
        ]
        self.cursor = MagicMock()
        connections = patch.object(register, 'connections').start()
        connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = self.cursor
        self.corrections = patch.object(register.CoachAttendanceSourceAdjustment, 'objects').start()
        self.corrections.filter.return_value.__iter__.return_value = []
        self.corrections.filter.return_value.filter.return_value.__iter__.return_value = []
        self.corrections.filter.return_value.first.return_value = None
        self.corrections.filter.return_value.select_for_update.return_value.first.return_value = None
        self.reports = patch.object(register.CoachAbsenceReport, 'objects').start()
        self.reports.filter.return_value.order_by.return_value = []
        patch.object(register.timezone, 'now', return_value=self.now).start()
        self.legacy = patch.object(register.canonical, 'lecture_register',
                                  side_effect=AssertionError('Bulk must not recompute attendance')).start()
        self.addCleanup(patch.stopall)

    def row(self, learner=1, occurrence='occ-1', status='present', **overrides):
        return {
            'learner_profile_id': learner, 'occurrence_id': occurrence, 'live_session_id': 'series',
            'module_catalogue_id': 'module', 'attendance_status': status, 'updated_at': self.now,
            'attended_seconds': 0, 'attendance_report_id': '',
            'scheduled_start': self.now-timedelta(days=1, hours=1),
            'scheduled_end': self.now-timedelta(days=1),
            'session_number': 1, 'module_title': 'Synthetic module', **overrides,
        }

    def supply(self, rows):
        columns = list(rows[0]) if rows else list(self.row())
        self.cursor.description = [(column,) for column in columns]
        self.cursor.fetchall.return_value = [tuple(row[column] for column in columns) for row in rows]

    def correction(self, **overrides):
        return SimpleNamespace(
            **{'learner_id': 1, 'source': 'microsoft-teams', 'source_id': 'occ-1',
               'status': 'absent', 'is_deleted': False, 'session_date': None,
               'module_name': '', 'session_title': '', 'updated_at': self.now, **overrides})

    def test_table_status_is_authoritative_without_raw_report_or_duration(self):
        self.supply([self.row(), self.row(learner=2, status='absent')])
        contracts = register.group_contracts(self.profiles)
        self.assertEqual(contracts['1']['summary']['present'], 1)
        self.assertEqual(contracts['2']['summary']['absent'], 1)
        self.assertEqual(contracts['1']['summary']['sessions'], 1)
        self.legacy.assert_not_called()

    def test_delivery_membership_uses_profile_ids_and_returns_enrolment_keys(self):
        self.cursor.fetchall.return_value = [(1, 'module-a'), (2, 'module-b'), (999, 'outside')]
        self.assertEqual(register.saved_modules_by_source(self.profiles), {901: ['module-a'], 902: ['module-b']})
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('curriculum.live_session_learner_attendance', sql)
        self.assertEqual(params, [[1, 2]])
        self.assertEqual(register.saved_module_ids(self.profiles), ['module-a', 'module-b'])

    def test_scopes_read_to_profile_ids_and_exact_occurrence_and_locks_saved_row(self):
        self.supply([self.row()])
        register.register_rows(self.profiles, occurrence_id='occ-1', lock=True)
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('FROM curriculum.live_session_learner_attendance r', sql)
        self.assertIn('r.learner_profile_id=ANY(%s)', sql)
        self.assertIn('r.occurrence_id=%s', sql)
        self.assertIn('o.live_session_id=r.live_session_id', sql)
        self.assertIn('s.module_catalogue_id=r.module_catalogue_id', sql)
        self.assertIn('FOR UPDATE OF r', sql)
        self.assertEqual(params, [[1, 2], 'occ-1'])
        self.assertNotIn('kbc_attendance', sql)
        self.assertNotIn('FROM curriculum.live_session_attendance ', sql)

    def test_empty_or_unavailable_source_does_not_query(self):
        self.assertEqual(register.register_rows([]), {})
        self.assertEqual(register.register_rows([SimpleNamespace(id=1)]), {})
        self.cursor.execute.assert_not_called()

    def test_no_saved_row_means_empty_history_not_absence(self):
        self.supply([])
        contract = register.group_contracts(self.profiles)['1']
        self.assertEqual(contract['summary']['sessions'], 0)
        self.assertEqual(contract['summary']['absent'], 0)
        self.assertIsNone(contract['summary']['attendanceRate'])
        self.assertEqual(contract['recentAttendance'], [])
        self.assertEqual(register.selected_rows(self.profiles, 'occ-1', AttendanceTiming()), {})

    def test_same_day_occurrences_remain_separate_and_recent_keeps_latest_four(self):
        rows = [self.row(occurrence=f'occ-{i}', scheduled_start=self.now-timedelta(days=i+1),
                         scheduled_end=self.now-timedelta(days=i+1)+timedelta(hours=1))
                for i in range(5)]
        rows.append(self.row(occurrence='same-day', scheduled_start=rows[0]['scheduled_start']+timedelta(hours=2),
                             scheduled_end=rows[0]['scheduled_end']+timedelta(hours=2)))
        self.supply(rows)
        contract = register.group_contracts(self.profiles)['1']
        self.assertEqual(contract['summary']['sessions'], 6)
        self.assertEqual(contract['recentAttendance'][0]['sourceId'], 'same-day')
        chips = register.recent_attendance(self.profiles, {})['1']
        self.assertEqual(len(chips), 4)
        self.assertEqual(chips[0]['date'], chips[1]['date'])

    def test_future_and_in_progress_do_not_count_towards_totals(self):
        self.supply([
            self.row(),
            self.row(occurrence='future', scheduled_start=self.now+timedelta(days=1),
                     scheduled_end=self.now+timedelta(days=1, hours=1)),
            self.row(occurrence='active', scheduled_start=self.now-timedelta(minutes=10),
                     scheduled_end=self.now+timedelta(minutes=50)),
        ])
        self.assertEqual(register.group_contracts(self.profiles)['1']['summary']['sessions'], 1)

    def test_business_timezone_is_used_for_recent_date(self):
        self.supply([self.row(scheduled_start=datetime(2026, 10, 18, 23, 30, tzinfo=timezone.utc),
                             scheduled_end=datetime(2026, 10, 19, 0, 30, tzinfo=timezone.utc))])
        with django_timezone.override('Europe/London'):
            self.assertEqual(register.recent_attendance(self.profiles, {})['1'][0]['date'], '2026-10-19')

    def test_correction_affects_summary_recent_selected_and_single_reader_consistently(self):
        self.supply([self.row()])
        adjustment = self.correction()
        self.corrections.filter.return_value.__iter__.return_value = [adjustment]
        self.corrections.filter.return_value.filter.return_value.__iter__.return_value = [adjustment]
        self.corrections.filter.return_value.first.return_value = adjustment
        contract = register.learner_contract(self.profiles[0]._caseload_source, learner_profile_id=1)
        self.assertEqual(contract['summary']['absent'], 1)
        self.assertEqual(register.recent_attendance(self.profiles, {})['1'][0]['status'], 'absent')
        selected = register.selected_rows(self.profiles, 'occ-1', AttendanceTiming())['1']
        self.assertEqual(selected['status'], 'absent')
        self.assertEqual(selected['manualStatus'], 'absent')
        self.assertEqual(selected['version'], bulk.current_row(self.profiles[0], 'occ-1')[2])

    def test_reset_correction_returns_to_saved_table_status(self):
        self.supply([self.row(status='absent')])
        self.corrections.filter.return_value.__iter__.return_value = [self.correction(status='')]
        self.assertEqual(register.group_contracts(self.profiles)['1']['summary']['absent'], 1)

    def test_removed_correction_record_hides_row_without_adding_other_sources(self):
        self.supply([self.row()])
        self.corrections.filter.return_value.__iter__.return_value = [self.correction(is_deleted=True)]
        self.assertEqual(register.group_contracts(self.profiles)['1']['summary']['sessions'], 0)

    def test_sync_status_change_changes_version_and_missing_row_blocks_write(self):
        self.supply([self.row()])
        first = bulk.current_row(self.profiles[0], 'occ-1')[2]
        self.supply([self.row(status='absent')])
        self.assertNotEqual(first, bulk.current_row(self.profiles[0], 'occ-1')[2])
        self.supply([])
        with self.assertRaises(bulk.BulkError) as error:
            bulk.current_row(self.profiles[0], 'occ-1')
        self.assertEqual(error.exception.status, 409)

    def test_unavailable_table_fails_instead_of_falling_back_to_legacy(self):
        self.cursor.execute.side_effect = DatabaseError('synthetic unavailable table')
        with self.assertRaises(DatabaseError):
            register.group_contracts(self.profiles)
        self.legacy.assert_not_called()

    def test_group_query_count_is_constant_as_roster_grows(self):
        for count in (1, 40):
            with self.subTest(count=count):
                self.cursor.reset_mock()
                self.corrections.reset_mock()
                profiles = [SimpleNamespace(id=i, _caseload_source=SimpleNamespace(id=900+i))
                            for i in range(1, count+1)]
                self.supply([self.row(learner=i) for i in range(1, count+1)])
                self.assertEqual(len(register.group_contracts(profiles)), count)
                self.cursor.execute.assert_called_once()
                self.corrections.filter.assert_called_once()

    def test_context_recent_is_wired_to_saved_register(self):
        from . import attendance_context as context
        self.supply([self.row()])
        placement = {'id': '1', 'name': 'Synthetic learner', 'email': 'learner@example.test',
                     'enrollmentStatus': 'active'}
        with patch('coach_api.attendance_loading.selected_context', return_value=(
                {'1': self.profiles[0]}, [placement], {'id': 'p'}, {'id': 'g'})), \
             patch.object(context, 'assigned_modules_by_source', return_value={901: ['module']}), \
             patch.object(bulk, 'delivery_occurrences', return_value=[]):
            result = context.build_context(RequestFactory().get('/'), AttendanceTiming())
        self.assertEqual(result['learners'][0]['recent'], [{'date': '2026-10-19', 'status': 'present'}])
        self.legacy.assert_not_called()

    def test_post_refresh_and_reset_use_saved_register_and_existing_correction_storage(self):
        self.supply([self.row(status='absent')])
        saved = []
        query = self.corrections.filter.return_value
        query.__iter__.side_effect = lambda: iter(saved)
        query.filter.return_value.__iter__.side_effect = lambda: iter(saved)
        query.first.side_effect = lambda: saved[0] if saved else None
        query.select_for_update.return_value.first.side_effect = lambda: saved[0] if saved else None

        def save(**kwargs):
            if not saved:
                saved.append(self.correction())
            for key, value in kwargs['defaults'].items():
                setattr(saved[0], key, value)
            return saved[0], False

        self.corrections.update_or_create.side_effect = save
        with patch.object(bulk, 'context_profiles', return_value={'1': self.profiles[0]}), \
             patch.object(bulk, 'delivery_occurrences', return_value=[(SimpleNamespace(id='occ-1'), None)]), \
             patch.object(bulk.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()), \
             patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test'), \
             patch('coach_api.views.is_coach_view_as', return_value=False), \
             patch('coach_api.attendance_context.clear_context_cache'):
            for desired, expected in [('present', 'present'), ('reset', 'absent')]:
                version = bulk.current_row(self.profiles[0], 'occ-1')[2]
                request = RequestFactory().post('/', json.dumps({
                    'programmeId': 'p', 'groupId': 'g', 'sessionOccurrenceId': 'occ-1',
                    'records': [{'learnerId': '1', 'status': desired, 'version': version}],
                }), content_type='application/json')
                response = unwrap(bulk.coach_bulk_attendance)(request)
                self.assertEqual(response.status_code, 200, response.content)
                row = json.loads(response.content)['results'][0]
                self.assertEqual(row['status'], expected)
                self.assertEqual(row['attendanceRecord']['status'], expected)
                self.assertEqual(row['recent'][0]['status'], expected)
                self.assertEqual(row['version'], bulk.current_row(self.profiles[0], 'occ-1')[2])
        self.assertEqual(len(saved), 1)
        self.legacy.assert_not_called()
