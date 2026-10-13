"""Hermetic context cache, canonical mapping and bounded recent regressions."""
from concurrent.futures import ThreadPoolExecutor
from collections import defaultdict
from contextlib import ExitStack
from datetime import date, datetime, timezone
from inspect import unwrap
import json
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from learner_api.tests_attendance_lectures import register_row
from . import attendance_context as context, attendance_recent as recent
from .attendance_loading import coach_attendance_context
from .attendance_sessions import assigned_modules_by_source


def profiles(count=4):
    return [SimpleNamespace(id=i, _caseload_source=SimpleNamespace(id=900+i,
        username='Synthetic learner', email=f'learner{i}@example.test', aptem_id=100+i)) for i in range(1, count+1)]


class AttendanceContextTests(SimpleTestCase):
    def setUp(self):
        context.clear_context_cache()
        self.addCleanup(context.clear_context_cache)
        self.request = RequestFactory().get('/', {'programmeId': 'p', 'groupId': 'g'})
        self.owner = patch('coach_api.views.authenticated_coach_email', return_value='coach@example.test').start()
        self.addCleanup(patch.stopall)

    def test_combined_compact_shape_resolves_context_and_modules_once_and_stays_lazy(self):
        selected = profiles()
        placements = [{'id': str(p.id), 'name': 'Synthetic learner', 'email': p._caseload_source.email,
                       'enrollmentStatus': 'active'} for p in selected]
        occurrence = SimpleNamespace(id='occ', scheduled_start=datetime(2026, 9, 1, 9, tzinfo=timezone.utc), session_number=1)
        with patch('coach_api.attendance_loading.selected_context', return_value=(
                {str(p.id): p for p in selected}, placements, {'id': 'p', 'name': 'Programme'},
                {'id': 'g', 'name': 'Group', 'cohort': 'Cohort'})) as resolver, \
                patch.object(context, 'assigned_modules_by_source', return_value={p._caseload_source.id: ['m'] for p in selected}) as modules, \
                patch('coach_api.bulk_attendance.delivery_occurrences', return_value=[(occurrence, SimpleNamespace(title='Module'))]) as occurrences, \
                patch.object(context, 'recent_attendance', return_value={'1': [{'date': '2026-09-01', 'status': 'present'}]}), \
                patch('coach_api.attendance_loading.selected_rows', side_effect=AssertionError('eager selected session')):
            response = unwrap(coach_attendance_context)(self.request)
            again = unwrap(coach_attendance_context)(self.request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, again.content)
        payload = json.loads(response.content)
        self.assertEqual(set(payload), {'programme', 'group', 'learners', 'sessions'})
        self.assertEqual(set(payload['learners'][0]), {'id', 'name', 'email', 'status', 'recent'})
        self.assertEqual(set(payload['sessions'][0]), {'id', 'date', 'time', 'title'})
        resolver.assert_called_once()
        modules.assert_called_once_with(selected)
        occurrences.assert_called_once_with('p', 'g', profiles=selected, assigned_modules=['m'])

    def test_ttl_and_identity_programme_group_and_view_as_isolation(self):
        with patch.object(context, 'monotonic', return_value=0) as clock, \
                patch.object(context, 'build_context', side_effect=lambda *args: {'learners': []}) as build:
            context.load_context(self.request)
            clock.return_value = 59
            context.load_context(self.request)
            self.assertEqual(build.call_count, 1)
            clock.return_value = 61
            context.load_context(self.request)
            self.assertEqual(build.call_count, 2)
            for query in ({'programmeId': 'other', 'groupId': 'g'}, {'programmeId': 'p', 'groupId': 'other'}):
                context.load_context(RequestFactory().get('/', query))
            self.owner.return_value = 'another@example.test'
            context.load_context(self.request)
            self.request.coach_view_as = True
            self.request.coach_view_as_admin = SimpleNamespace(id=9)
            context.load_context(self.request)
            self.assertEqual(build.call_count, 6)

    def test_concurrent_identical_contexts_share_one_read(self):
        started, release = Event(), Event()
        def build(*args):
            started.set()
            self.assertTrue(release.wait(5))
            return {'learners': []}
        with patch.object(context, 'build_context', side_effect=build) as loader, ThreadPoolExecutor(2) as pool:
            first = pool.submit(context.load_context, self.request)
            self.assertTrue(started.wait(5))
            second = pool.submit(context.load_context, self.request)
            release.set()
            self.assertIs(first.result(), second.result())
            loader.assert_called_once()

    def test_failed_and_invalid_contexts_are_not_cached(self):
        from .bulk_attendance import BulkError
        with patch.object(context, 'build_context', side_effect=BulkError('Forbidden', 403)) as build:
            for _ in range(2):
                response = unwrap(coach_attendance_context)(self.request)
                self.assertEqual(response.status_code, 403)
            self.assertEqual(build.call_count, 2)

    def test_save_invalidation_cannot_repopulate_an_old_context(self):
        def build(*args):
            context.clear_context_cache()
            return {'learners': []}
        with patch.object(context, 'build_context', side_effect=build) as loader:
            context.load_context(self.request)
            context.load_context(self.request)
            self.assertEqual(loader.call_count, 2)

    def test_module_mapping_keeps_source_identity_and_has_no_title_predicate(self):
        with patch('coach_api.attendance_sessions.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [(901, 'm1'), (902, 'm2')]
            self.assertEqual(assigned_modules_by_source(profiles(2)), {901: ['m1'], 902: ['m2']})
            sql, params = cursor.execute.call_args.args
            self.assertIn('SELECT source.id,', sql)
            self.assertIn('UNION', sql)
            self.assertIn('WHERE id=ANY(%s)', sql)
            self.assertIn('cm.module_catalogue_id=assigned.module_id', sql)
            self.assertNotIn('title', sql)
            self.assertEqual(set(params[0]), {901, 902})


class RecentAttendanceTests(SimpleTestCase):
    def setUp(self):
        patch('socket.socket.connect', side_effect=AssertionError('No live network')).start()
        patch('coach_api.views.microsoft_graph_request', side_effect=AssertionError('No live Graph')).start()
        self.addCleanup(patch.stopall)

    def test_kbc_reader_uses_one_bounded_date_rank_query_and_retains_edited_fallback_identities(self):
        from learner_api import attendance
        raw = {'aptem_id': '101', 'key': '', 'date': date(2026, 9, 1), 'Attendance': 1,
               'attendance_status': 'present', 'module': 'Module', 'lecture_name': 'Session', 'day_rank': 40}
        with patch.object(attendance, '_kbc_attendance_connection_string', return_value='synthetic'), \
                patch.object(attendance.psycopg, 'connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [raw]
            result = attendance.fetch_kbc_attendance_rows_bulk([{'aptem_id': '101', 'learner_id': 901,
                'learner_name': 'Synthetic learner', 'learner_email': 'learner@example.test'}],
                recent_dates=8, correction_keys=['kbc-attendance-synthetic'])
            cursor.execute.assert_called_once()
            sql, params = cursor.execute.call_args.args
            self.assertIn('PARTITION BY "ID"::text', sql)
            self.assertIn('day_rank<=%s', sql)
            self.assertEqual(sql.count("coalesce(btrim(\"key\"::text),'')=''"), 2)
            self.assertEqual(params[-3], 9)
            self.assertEqual(result[0]['_day_rank'], 40)
            self.assertTrue(result[0]['session_id'].startswith('kbc-attendance-'))

    def load(self, count):
        selected = profiles(count)
        rows = [register_row(learner_id=p._caseload_source.id, session_id=f'kbc-{day}',
            session_date=date(2026, 9, day), attendance_status='present' if day % 2 else 'absent', _day_rank=7-day)
            for p in selected for day in range(1, 7)]
        with ExitStack() as stack:
            connections = stack.enter_context(patch.object(recent, 'connections'))
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            stack.enter_context(patch.object(recent.canonical, 'dict_rows', return_value=[]))
            kbc = stack.enter_context(patch.object(recent, 'fetch_kbc_attendance_rows_bulk', return_value=rows))
            teams = stack.enter_context(patch.object(recent, 'fetch_verified_teams_attendance_rows', side_effect=AssertionError('unscoped Teams read')))
            stack.enter_context(patch.object(recent.canonical, 'attendance_read_contract', side_effect=AssertionError('full history DTO')))
            managers = []
            for model in (recent.CoachAbsenceReport, recent.CoachAttendanceSourceAdjustment, recent.CoachManualAttendance, recent.LiveSessionAbsence):
                managers.append(stack.enter_context(patch.object(model, 'objects')))
                # MagicMock query chains iterate empty without touching SQLite.
            result = recent.recent_attendance(selected, {p._caseload_source.id: ['module'] for p in selected})
            kbc.assert_called_once()
            self.assertEqual(kbc.call_args.kwargs['recent_dates'], 8)
            teams.assert_not_called()
            self.assertEqual(cursor.execute.call_count, 2)
            for manager in managers:
                manager.filter.assert_called_once()
        return result

    def test_bulk_reads_are_constant_for_four_and_forty_and_recent_matches_canonical(self):
        for count in (4, 40):
            with self.subTest(count=count):
                result = self.load(count)
                self.assertEqual(len(result), count)
                for rows in result.values():
                    self.assertEqual(rows, [{'date': f'2026-09-{day:02d}',
                        'status': 'present' if day % 2 else 'absent'} for day in (6, 5, 4, 3)])

    def test_native_candidates_are_ranked_and_teams_reads_are_occurrence_scoped(self):
        selected = profiles(4)
        occurrence = register_row(source='microsoft-teams', session_id='wanted', enrolment_id=901,
            day_rank=1, scheduled_start=datetime(2026, 9, 1, 9, tzinfo=timezone.utc),
            scheduled_end=datetime(2026, 9, 1, 10, tzinfo=timezone.utc))
        state = tuple(defaultdict(factory) for factory in (dict, dict, dict, set, set))
        with patch.object(recent, 'fetch_kbc_attendance_rows_bulk', return_value=[]), \
                patch.object(recent, 'fetch_verified_teams_attendance_rows', return_value=[]) as teams, \
                patch.object(recent, 'connections') as connections, \
                patch.object(recent.canonical, 'dict_rows', return_value=[occurrence]):
            recent.recent_candidates(selected, {901: ['canonical-module']}, 8, state)
            sql = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value.execute.call_args.args[0]
            self.assertIn('dense_rank()', sql)
            self.assertIn('day_rank<=%s', sql)
            self.assertNotIn('jsonb_array_elements', sql)
            teams.assert_called_once()
            self.assertEqual(teams.call_args.kwargs['occurrence_ids'], ['wanted'])
            self.assertTrue(teams.call_args.kwargs['independent_learner_scope'])

    def test_deleted_recent_rows_expand_one_bulk_batch_and_old_correction_can_move_forward(self):
        selected = profiles(1)
        rows = [register_row(session_id=str(day), session_date=date(2026, 9, day)) for day in range(1, 11)]
        with patch.object(recent, 'connections'), patch.object(recent.canonical, 'dict_rows', return_value=[]), \
                patch.object(recent.CoachAbsenceReport, 'objects'), patch.object(recent.LiveSessionAbsence, 'objects'), \
                patch.object(recent.CoachManualAttendance, 'objects'), patch.object(recent.CoachAttendanceSourceAdjustment, 'objects'), \
                patch.object(recent, 'recent_candidates', side_effect=[
                    (defaultdict(list, {901: rows[-2:]}), defaultdict(list), defaultdict(list, {901: [date(2026, 9, 8)]})),
                    (defaultdict(list, {901: rows}), defaultdict(list), defaultdict(list))]) as candidates:
            result = recent.recent_attendance(selected, {})
            self.assertEqual(candidates.call_count, 2)
            self.assertEqual([call.args[2] for call in candidates.call_args_list], [8, 16])
            self.assertEqual([row['date'] for row in result['1']], ['2026-09-10', '2026-09-09', '2026-09-08', '2026-09-07'])

    def test_recent_preserves_recovery_confirmations_corrections_mirrors_and_manual_rows(self):
        selected = profiles(1)
        now = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
        native = [register_row(learner_id=901, source='microsoft-teams', session_id=key,
            session_date=date(2026, 9, day), attendance_status=status,
            scheduled_start=datetime(2026, 9, day, 9, tzinfo=timezone.utc),
            scheduled_end=datetime(2026, 9, day, 10, tzinfo=timezone.utc))
            for day, key, status in [(10, 'catchup', 'unmarked'), (11, 'original', 'absent'),
                (12, 'confirmed', 'absent'), (13, 'corrected', 'absent'), (14, 'deleted', 'present')]]
        legacy = register_row(learner_id=901, session_id='mirror', session_date=date(2026, 9, 13),
                              module_title=native[3]['module_title'])
        guest = register_row(learner_id=901, source='microsoft-teams', session_id='guest',
                              eligibility_reason='approved_recovery_guest', attendance_status='present')
        def edit(key, **extra):
            return SimpleNamespace(learner_id=1, source='microsoft-teams', source_id=key,
                session_date=None, module_name='', session_title='', updated_at=now, **extra)
        edits = [edit('corrected', status='present', is_deleted=False), edit('deleted', status='', is_deleted=True)]
        report = SimpleNamespace(learner_id=901, attendance_id=recent.canonical.report_id(native[1]),
            catchup_event_key='alternative:guest', session_date=date(2026, 9, 11))
        manual = SimpleNamespace(id=99, learner_id=1, session_date=date(2026, 9, 19), status='absent')
        confirmation = {'enrolment_id': 901, 'lecture_id': 'teams:confirmed-2026-09-12', 'seconds': 600, 'submitted_at': now}
        with ExitStack() as stack:
            stack.enter_context(patch.object(recent, 'connections'))
            stack.enter_context(patch.object(recent.canonical, 'dict_rows', return_value=[confirmation]))
            stack.enter_context(patch.object(recent.canonical.timezone, 'now', return_value=now))
            stack.enter_context(patch.object(recent, 'alternative_occurrence_id', return_value='guest'))
            adjustments = stack.enter_context(patch.object(recent.CoachAttendanceSourceAdjustment, 'objects'))
            adjustments.filter.return_value = edits
            reports = stack.enter_context(patch.object(recent.CoachAbsenceReport, 'objects'))
            reports.filter.return_value.only.return_value = [report]
            catchups = stack.enter_context(patch.object(recent.LiveSessionAbsence, 'objects'))
            catchups.filter.return_value.values_list.return_value = [(901, 'catchup')]
            manuals = stack.enter_context(patch.object(recent.CoachManualAttendance, 'objects'))
            manuals.filter.return_value.annotate.return_value.filter.return_value.only.return_value = [manual]
            stack.enter_context(patch.object(recent.canonical, 'normalize_native_occurrences', side_effect=lambda source, rows: rows))
            stack.enter_context(patch.object(recent, 'recent_candidates', return_value=(
                defaultdict(list, {901: [legacy, guest]}), defaultdict(list, {901: native}), defaultdict(list))))
            result = recent.recent_attendance(selected, {})
            self.assertEqual(result['1'], [{'date': '2026-09-19', 'status': 'absent'},
                {'date': '2026-09-13', 'status': 'present'}, {'date': '2026-09-12', 'status': 'present'},
                {'date': '2026-09-11', 'status': 'present'}])


