"""Selected-occurrence parity and query scaling with synthetic DB transports.

The canonical readers run unchanged; only cursor/ORM execution is replaced.
SimpleTestCase forbids real DB access, and sockets/Graph are forbidden too.
Counts are evaluated mock queries, not production PostgreSQL measurements.
"""
from collections import defaultdict
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from time import perf_counter
import hashlib
import json

from django.db.models import Q
from django.test import SimpleTestCase, TestCase
from django.db import connections, DatabaseError

from learner_api import attendance_lectures as canonical, attendance, teams_attendance, attendance_confirmation
from learner_api import alternative_recovery
from curriculum_api import session_results
from . import attendance_selected as selected, bulk_attendance as bulk
from .attendance_timing import AttendanceTiming


class Query:
    """Small evaluated-query transport, retaining filters and projections."""
    def __init__(self, fixture, table, rows, predicates=(), fields=None, flat=False, mapping=False):
        self.fixture, self.table, self.rows = fixture, table, rows
        self.predicates, self.fields, self.flat, self.mapping = predicates, fields, flat, mapping

    def using(self, alias):
        return self

    def only(self, *fields):
        return self

    def order_by(self, *fields):
        return self

    def select_for_update(self):
        return self

    def filter(self, *conditions, **kwargs):
        return Query(self.fixture, self.table, self.rows, (*self.predicates, *conditions, Q(**kwargs)),
                     self.fields, self.flat, self.mapping)

    def exclude(self, *conditions, **kwargs):
        return self.filter(~Q(*conditions, **kwargs))

    def values(self, *fields):
        return Query(self.fixture, self.table, self.rows, self.predicates, fields, mapping=True)

    def values_list(self, *fields, flat=False):
        return Query(self.fixture, self.table, self.rows, self.predicates, fields, flat=flat)

    def first(self):
        return next(iter(self), None)

    def matches(self, row, predicate):
        if isinstance(predicate, Q):
            flags = [self.matches(row, child) for child in predicate.children]
            matched = any(flags) if predicate.connector == Q.OR else all(flags)
            return not matched if predicate.negated else matched
        key, expected = predicate
        lookup = key.split('__')[-1]
        field = key.rsplit('__', 1)[0] if lookup in {'in', 'isnull', 'exact', 'startswith'} else key
        actual = getattr(row, 'id' if field == 'pk' else field, None)
        if lookup == 'in':
            # Subqueries are part of the parent SQL, not separate queries.
            if isinstance(expected, Query):
                expected = [getattr(item, expected.fields[0]) for item in expected.rows
                            if all(expected.matches(item, pred) for pred in expected.predicates)]
            return str(actual) in {str(value) for value in expected}
        if lookup == 'isnull':
            return (actual is None) == expected
        if lookup == 'startswith':
            return str(actual or '').startswith(expected)
        return str(actual) == str(expected)

    def __iter__(self):
        self.fixture.queries.append(self.table)
        for row in self.rows:
            if not all(self.matches(row, pred) for pred in self.predicates):
                continue
            if self.fields is None:
                yield row
            elif self.mapping:
                yield {field: getattr(row, field) for field in self.fields}
            else:
                values = tuple(getattr(row, field) for field in self.fields)
                yield values[0] if self.flat else values


class EvidenceFixture:
    def __init__(self, count=4):
        self.now = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)
        self.start = self.now - timedelta(days=1, hours=3)
        self.profiles = [SimpleNamespace(id=i, full_name=f'Synthetic learner {i}',
            email=f'learner{i}@example.test', email_normalized=f'learner{i}@example.test',
            enrolment_id=900+i, coach_name='Synthetic coach', _caseload_source=SimpleNamespace(
                id=900+i, username=f'Synthetic learner {i}', email=f'learner{i}@example.test', aptem_id=100+i))
            for i in range(1, count+1)]
        self.modules = [SimpleNamespace(module_catalogue_id='module', title='Module', group_id='group', group_name='Group')]
        self.sessions = [SimpleNamespace(id='series', module_catalogue_id='module', module_title='Module', attendees=[])]
        self.occurrences = [SimpleNamespace(id='occ', live_session_id='series', actual_start=self.start,
            actual_end=self.start+timedelta(hours=1), scheduled_start=self.start,
            scheduled_end=self.start+timedelta(hours=1), attendance_report_id='report', session_number=1,
            artifacts_synced_at=self.now, updated_at=self.now)]
        self.assignments = [SimpleNamespace(module_ref='module', learner__email=profile.email) for profile in self.profiles]
        self.attendance, self.absences, self.reports, self.adjustments = [], [], [], []
        self.confirmations = []
        self.schedule_assigned = True
        self.unassigned_occurrences = set()
        self.queries, self.sql = [], []
        self.cursor = MagicMock()
        self.cursor.execute.side_effect = self.execute
        self.connection = MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor

    def execute(self, sql, params=()):
        self.sql.append((sql, params))
        self.queries.append('sql:' + ('native' if 'AS attended' in sql else
            'confirmation' if 'time_tracking_session_ref AS lecture_id' in sql else
            'assignment' if 'WITH source AS' in sql else 'other'))
        rows = []
        if 'AS attended' in sql:
            ids = params[0] if 'eligible.id AS enrolment_id' in sql else [profile._caseload_source.id
                for profile in self.profiles if canonical._key(profile.email) == params[0]]
            wanted = params[-1] if 'o.id=ANY(%s)' in sql else [row.id for row in self.occurrences]
            for source_id in (ids if self.schedule_assigned else []):
                for occurrence in self.occurrences:
                    if occurrence.id in wanted and occurrence.id not in self.unassigned_occurrences:
                        rows.append({'enrolment_id': source_id, 'session_id': occurrence.id,
                            'occurrence_id': occurrence.id, 'live_session_id': occurrence.live_session_id,
                            'module_catalogue_id': 'module', 'module_title': 'Module',
                            'scheduled_start': occurrence.scheduled_start, 'scheduled_end': occurrence.scheduled_end,
                            'updated_at': self.now, 'session_number': occurrence.session_number,
                            'join_url': '', 'attendance_report_id': occurrence.attendance_report_id,
                            'tutor_name': '', 'attended': False})
        elif 'WITH source AS' in sql:
            rows = [{'module_catalogue_id': 'module', 'title': 'Module'}]
        elif 'time_tracking_session_ref AS lecture_id' in sql:
            ids = params[0] if isinstance(params[0], list) else [params[0]]
            keys = params[2] if len(params) > 2 else None
            rows = [row for row in self.confirmations if row['enrolment_id'] in ids
                    and (keys is None or row['lecture_id'] in keys)]
        elif 'FROM curriculum.live_session_absences' in sql:
            rows = [vars(row) for row in self.absences if row.occurrence_id in params[0]
                    and row.learner_email in params[1]]
        elif 'FROM curriculum.live_session_learner_attendance' in sql:
            rows = []
        elif 'FROM curriculum.components' not in sql:
            raise AssertionError('Unexpected SQL in selected-occurrence audit')
        self.cursor.description = [(key,) for key in rows[0]] if rows else []
        self.cursor.fetchall.return_value = [tuple(row.values()) for row in rows]

    def __enter__(self):
        self.stack = ExitStack()
        self.stack.enter_context(patch('socket.socket.connect', side_effect=AssertionError('No network allowed')))
        self.graph = self.stack.enter_context(patch('coach_api.views.microsoft_graph_request', side_effect=AssertionError('No Graph allowed')))
        self.stack.enter_context(patch.object(canonical.timezone, 'now', return_value=self.now))
        for module in (canonical, selected, attendance_confirmation, session_results):
            self.stack.enter_context(patch.object(module, 'connections', {'enrolment': self.connection, 'default': self.connection}))
        models = {
            teams_attendance.LearnerProfile: self.profiles,
            teams_attendance.LiveSession: self.sessions,
            teams_attendance.LiveSessionOccurrence: self.occurrences,
            teams_attendance.ModuleAuthoringModule: self.modules,
            teams_attendance.LearnerTrainingPlanModule: self.assignments,
            teams_attendance.LiveSessionAttendance: self.attendance,
            teams_attendance.LiveSessionAttendanceAlias: [],
            teams_attendance.LiveSessionAttendanceIdentityLink: [],
            selected.CoachAbsenceReport: self.reports,
            selected.LiveSessionAbsence: self.absences,
            selected.CoachAttendanceSourceAdjustment: self.adjustments,
        }
        from .models import CoachManualAttendance
        models[CoachManualAttendance] = []
        for model, rows in models.items():
            self.stack.enter_context(patch.object(model, 'objects', Query(self, model.__name__, rows)))
        for profile in self.profiles:
            profile.progress_entries = Query(self, 'progress_entries', [])
        self.stack.enter_context(patch.object(attendance, '_kbc_attendance_connection_string', return_value='mock-only'))
        kbc_cursor = MagicMock()
        kbc_cursor.execute.side_effect = lambda *args: self.queries.append('kbc')
        kbc_cursor.fetchall.return_value = []
        kbc_connection = MagicMock()
        kbc_connection.cursor.return_value.__enter__.return_value = kbc_cursor
        connect = self.stack.enter_context(patch.object(attendance.psycopg, 'connect'))
        connect.return_value.__enter__.return_value = kbc_connection
        return self

    def __exit__(self, *args):
        self.graph.assert_not_called()
        return self.stack.__exit__(*args)

    def read(self):
        timing = AttendanceTiming()
        started = perf_counter()
        result = selected.selected_rows(self.profiles, 'occ', timing)
        timing.total_ms = (perf_counter() - started) * 1000
        return result, timing

    def legacy_read(self):
        """Snapshot of the previous endpoint's three full-register call sites."""
        result = {}
        timing = AttendanceTiming()
        started = perf_counter()
        for profile in self.profiles:
            source = profile._caseload_source
            with timing.stage('eligibility_full_register'):
                raw = canonical.lecture_register(source, learner_profile_id=profile.id, apply_adjustments=False)
            if not any(row.get('source') == 'microsoft-teams' and str(row['session_id']) == 'occ' for row in raw):
                continue
            with timing.stage('version_full_register'):
                _, _, version = bulk.current_row(profile, 'occ')
            with timing.stage('response_full_contract'):
                contract = canonical.attendance_read_contract(source, learner_profile_id=profile.id)
            row = next((row for row in contract['history'] if row['source'] == 'microsoft-teams' and row['sourceId'] == 'occ'), None)
            status = row['status'] if row else None
            result[str(profile.id)] = {'learnerId': str(profile.id),
                'status': status if status in {'present', 'absent'} else None,
                'absenceReport': row.get('absenceReport') if row else None, 'version': version}
        timing.total_ms = (perf_counter() - started) * 1000
        return result, timing


class SelectedAttendanceTests(SimpleTestCase):
    def test_bounded_queries_for_four_and_forty_and_full_response_parity(self):
        counts = []
        for count in (4, 40):
            with self.subTest(count=count), EvidenceFixture(count) as fixture:
                old, old_timing = fixture.legacy_read()
                before = len(fixture.queries)
                fixture.queries.clear()
                fixture.sql.clear()
                result, timing = fixture.read()
                after = len(fixture.queries)
                counts.append(after)
                self.assertEqual(result, old)
                self.assertEqual(len(result), count)
                self.assertNotIn('kbc', fixture.queries)
                self.assertEqual(fixture.queries.count('CoachAttendanceSourceAdjustment'), 1)
                self.assertEqual(fixture.queries.count('sql:native'), 1)
                self.assertEqual(fixture.queries.count('sql:confirmation'), 1)
                self.assertEqual(sum('o.id=ANY(%s)' in sql for sql, _ in fixture.sql), 1)
                self.assertEqual(next(params[-1] for sql, params in fixture.sql if 'AS attended' in sql), ['occ'])
                print('ATTENDANCE_AUDIT', json.dumps({'learners': count, 'mock_queries_before': before,
                    'mock_queries_after': after, 'old_stage_ms': {key: round(value['duration_ms'], 3)
                        for key, value in old_timing.stages.items()},
                    'old_total_ms': round(old_timing.total_ms, 3), 'new_total_ms': round(timing.total_ms, 3),
                    'new_stage_ms': {key: round(value['duration_ms'], 3) for key, value in timing.stages.items()}}))
        self.assertEqual(counts[0], counts[1])

    def test_version_digest_preserves_exact_old_inputs_and_ignores_unrelated_metadata(self):
        profile = SimpleNamespace(id=42, _caseload_source=SimpleNamespace(id=942))
        row = {'source': 'microsoft-teams', 'session_id': 'occ', 'attendance_status': 'absent',
               'effective_attendance_status': 'made_up', 'effective_attendance': 1}
        correction = SimpleNamespace(status='absent', is_deleted=False)
        expected = hashlib.sha256(json.dumps({
            'learner_profile_id': '42', 'session_occurrence_id': 'occ', 'raw_status': 'absent',
            'effective_status': 'present', 'effective_attendance': 1,
            'correction': {'status': 'absent', 'is_deleted': False},
        }, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        with patch.object(bulk, 'lecture_register', return_value=[row]), \
                patch.object(bulk.CoachAttendanceSourceAdjustment, 'objects') as objects:
            objects.filter.return_value.first.return_value = correction
            self.assertEqual(bulk.current_row(profile, 'occ')[2], expected)
        self.assertEqual(bulk.attendance_version(42, 'occ', {**row, 'calculated_at': 'later',
            'session_title': 'renamed', 'updated_at': 'later'}, correction), expected)
        for changed in ({'attendance_status': 'present'}, {'effective_attendance': 0},
                        {'effective_attendance_status': 'absent'}):
            self.assertNotEqual(bulk.attendance_version(42, 'occ', {**row, **changed}, correction), expected)
        correction.is_deleted = True
        self.assertNotEqual(bulk.attendance_version(42, 'occ', row, correction), expected)

    def test_unchanged_state_stable_and_other_occurrence_does_not_change_token(self):
        with EvidenceFixture() as fixture:
            first, _ = fixture.read()
            fixture.occurrences.append(SimpleNamespace(**{**vars(fixture.occurrences[0]), 'id': 'unrelated'}))
            second, _ = fixture.read()
            self.assertEqual(first, second)

    def test_unassigned_learner_is_excluded_without_history_or_per_learner_reads(self):
        with EvidenceFixture() as fixture:
            fixture.schedule_assigned = False
            result, _ = fixture.read()
            self.assertEqual(result, {})

    def test_correction_and_report_parity_including_deleted_correction(self):
        for status, deleted in [('present', False), ('absent', False), ('absent', True)]:
            with self.subTest(status=status, deleted=deleted), EvidenceFixture(1) as fixture:
                fixture.adjustments.append(SimpleNamespace(learner_id=1, source='microsoft-teams', source_id='occ',
                    status=status, is_deleted=deleted, session_date=None, module_name='', session_title='', updated_at=fixture.now))
                fixture.reports.append(SimpleNamespace(id=71, learner_id=901, learner_email=fixture.profiles[0].email,
                    attendance_id=int(canonical.report_id({'learner_id': 901, 'source': 'microsoft-teams', 'session_id': 'occ'})),
                    status='approved', evidence_image_url='https://example.test/evidence', recovery_method='', catchup_event_key=''))
                result, _ = fixture.read()
                old, _ = fixture.legacy_read()
                self.assertEqual(result, old)

    def test_catchup_and_confirmation_parity_and_relevant_changes_invalidate_version(self):
        with EvidenceFixture(1) as fixture:
            before, _ = fixture.read()
            fixture.absences.append(SimpleNamespace(occurrence_id='occ', source_learner_id=901,
                learner_email=fixture.profiles[0].email, recovery_method='catch-up', recovery_status='completed',
                recovery_reference='catch-up:synthetic'))
            recovered, _ = fixture.read()
            old, _ = fixture.legacy_read()
            self.assertEqual(recovered, old)
            self.assertEqual(recovered['1']['status'], 'present')
            self.assertNotEqual(before['1']['version'], recovered['1']['version'])
            fixture.absences.clear()
            fixture.occurrences[0].attendance_report_id = ''
            before, _ = fixture.read()
            fixture.confirmations.append({'enrolment_id': 901, 'lecture_id': 'teams:occ-2026-10-07',
                'seconds': 3600, 'submitted_at': fixture.now, 'details': ''})
            confirmed, _ = fixture.read()
            old, _ = fixture.legacy_read()
            self.assertEqual(confirmed, old)
            self.assertEqual(confirmed['1']['status'], 'present')
            # Preserve the existing token inputs: confirmations leave the raw
            # source status intact. Parity above includes the old digest.

    def test_old_version_from_detail_still_conflicts_after_selected_state_changes(self):
        with EvidenceFixture(1) as fixture:
            before, _ = fixture.read()
            fixture.adjustments.append(SimpleNamespace(learner_id=1, source='microsoft-teams', source_id='occ',
                status='present', is_deleted=False, session_date=None, module_name='', session_title='', updated_at=fixture.now))
            with self.assertRaises(bulk.BulkError) as error:
                bulk.write_records({'1': fixture.profiles[0]}, 'occ', [
                    {'learnerId': '1', 'status': 'absent', 'version': before['1']['version']}], 'coach@example.test')
            self.assertEqual(error.exception.status, 409)

    def evidence(self, fixture, email, *, occurrence='occ', name='Synthetic learner 1', seconds=240):
        return SimpleNamespace(id=f'row-{len(fixture.attendance)}', occurrence_id=occurrence,
            graph_record_id='', email=email, display_name=name, role='attendee',
            raw_data={}, total_attendance_seconds=seconds, intervals=[])

    def test_present_absent_and_threshold_evidence_match_old_response_and_version(self):
        with EvidenceFixture(2) as fixture:
            before, _ = fixture.read()
            fixture.attendance.append(self.evidence(fixture, fixture.profiles[0].email, seconds=181))
            fixture.attendance.append(self.evidence(fixture, fixture.profiles[1].email, seconds=180))
            result, _ = fixture.read()
            old, _ = fixture.legacy_read()
            self.assertEqual(result, old)
            self.assertEqual([row['status'] for row in result.values()], ['present', 'absent'])
            self.assertNotEqual(result['1']['version'], before['1']['version'])
            self.assertEqual(result['2']['version'], before['2']['version'])

    def test_email_less_matching_retains_previous_individual_identity_scope(self):
        with EvidenceFixture(2) as fixture:
            for profile in fixture.profiles:
                profile.full_name = 'Shared synthetic name'
            fixture.attendance.append(self.evidence(fixture, '', name='Shared synthetic name'))
            result, _ = fixture.read()
            old, _ = fixture.legacy_read()
            self.assertEqual(result, old)
            self.assertEqual([row['status'] for row in result.values()], ['present', 'present'])
            # Existing whole-roster callers keep their ambiguity protection.
            normal = teams_attendance.fetch_verified_teams_attendance_rows(
                learner_emails=[profile.email for profile in fixture.profiles], occurrence_ids=['occ'])
            self.assertEqual([row['attendance_status'] for row in normal], ['absent', 'absent'])

    def test_only_relevant_alternative_target_is_loaded_and_recovery_matches_old(self):
        with EvidenceFixture(1) as fixture:
            fixture.sessions.append(SimpleNamespace(id='guest-series', module_catalogue_id='guest-module',
                module_title='Guest module', attendees=[]))
            fixture.modules.append(SimpleNamespace(module_catalogue_id='guest-module', title='Guest module',
                group_id='other', group_name='Other group'))
            fixture.occurrences.append(SimpleNamespace(**{**vars(fixture.occurrences[0]),
                'id': 'alternative', 'live_session_id': 'guest-series'}))
            fixture.unassigned_occurrences.add('alternative')
            fixture.reports.append(SimpleNamespace(id=71, learner_id=901, learner_email=fixture.profiles[0].email,
                attendance_id=int(canonical.report_id({'learner_id': 901, 'source': 'microsoft-teams', 'session_id': 'occ'})),
                status='approved', evidence_image_url='', recovery_method='alternative', catchup_event_key='alternative:alternative'))
            fixture.attendance.append(self.evidence(fixture, fixture.profiles[0].email, occurrence='alternative'))
            result, _ = fixture.read()
            self.assertEqual(next(params[-1] for sql, params in fixture.sql if 'AS attended' in sql), ['alternative', 'occ'])
            old, _ = fixture.legacy_read()
            self.assertEqual(result, old)
            self.assertEqual(result['1']['status'], 'present')

    def test_future_active_and_unreported_occurrences_match_old_response(self):
        for offset in (timedelta(hours=1), timedelta(minutes=-30), timedelta(days=-1)):
            with self.subTest(offset=offset), EvidenceFixture(1) as fixture:
                occurrence = fixture.occurrences[0]
                occurrence.scheduled_start = fixture.now + offset
                occurrence.scheduled_end = occurrence.scheduled_start + timedelta(hours=1)
                occurrence.actual_end = None
                occurrence.attendance_report_id = ''
                result, _ = fixture.read()
                old, _ = fixture.legacy_read()
                self.assertEqual(result, old)
                self.assertIsNone(result['1']['status'])

    def test_unreported_occurrence_preserves_unavailable_recovery_ledger_behavior(self):
        with EvidenceFixture(1) as fixture:
            fixture.occurrences[0].attendance_report_id = ''
            with patch.object(selected.LiveSessionAbsence.objects, 'filter', side_effect=DatabaseError('synthetic outage')), \
                    patch.object(canonical.log, 'warning'):
                result, _ = fixture.read()
                old, _ = fixture.legacy_read()
            self.assertEqual(result, old)
            self.assertIsNone(result['1']['status'])


class SelectedIdentityQueryTests(TestCase):
    """Real deferred-field query counts, only on attached in-memory SQLite."""
    databases = {'default', 'enrolment'}

    @classmethod
    def setUpClass(cls):
        from learner_api.models import LearnerProfile
        connection = connections['enrolment']
        if connection.vendor != 'sqlite' or not str(connection.settings_dict['NAME']).startswith(('file:memorydb_', ':memory:')):
            raise RuntimeError('Identity query fixtures require in-memory SQLite.')
        cls.table_patch = patch.object(LearnerProfile._meta, 'db_table', 'selected_identity_fixture')
        cls.table_patch.start()
        with connection.schema_editor() as editor:
            editor.create_model(LearnerProfile)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        from learner_api.models import LearnerProfile
        super().tearDownClass()
        connection = connections['enrolment']
        with connection.schema_editor() as editor:
            editor.delete_model(LearnerProfile)
        cls.table_patch.stop()

    def test_non_aptem_placement_reads_have_no_deferred_query_for_four_or_forty_learners(self):
        from learner_api.models import LearnerProfile
        from coach_api import views
        for count in (4, 40):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('DELETE FROM selected_identity_fixture')
            # A plain QuerySet avoids audited manager hooks and save signals.
            from django.db.models import QuerySet
            QuerySet(LearnerProfile, using='enrolment').bulk_create([
                LearnerProfile(id=i, full_name=f'Synthetic learner {i}', email=f'learner{i}@example.test',
                    coach_email='coach@example.test', lifecycle_status='active', programme_status='active',
                    programme_id='p', cohort_id='c', cohort='Cohort', group_id='g', group_name='Group')
                for i in range(1, count+1)])
            group = {'group_id': 'g', 'programme_id': 'p', 'cohort_id': 'c', 'status': 'active'}
            with self.subTest(count=count), patch.object(views, 'authoring_fetch_all', return_value=[group]), \
                    patch.object(views, 'resolve_effective_aptem_ids', return_value=({}, set())):
                # Reproduce the previous deferred cohort field against a real
                # DB, then verify the production loader includes it up front.
                with self.assertNumQueries(1 + count, using='enrolment'):
                    previous = list(LearnerProfile.objects.using('enrolment').defer('cohort_id'))
                    placements = [{'id': str(profile.id), 'programmeId': 'p', 'groupId': 'g'} for profile in previous]
                    views.apply_curriculum_attendance_placements(placements, previous)
                with self.assertNumQueries(1, using='enrolment'):
                    profiles = views.fetch_attendance_caseload_rows('coach@example.test', include_plan=False)
                    placements = [{'id': str(profile.id), 'programmeId': 'p', 'groupId': 'g'} for profile in profiles]
                    views.apply_curriculum_attendance_placements(placements, profiles)
                self.assertEqual(len(placements), count)
                print('IDENTITY_QUERY_AUDIT', {'learners': count, 'sqlite_before': 1 + count, 'sqlite_after': 1})

    def test_stage_metrics_measure_queries_without_logging_sql_or_parameters(self):
        timing = AttendanceTiming()
        with patch('coach_api.attendance_timing.log.info') as log:
            with timing.request(), timing.stage('learner_identity'):
                with connections['enrolment'].cursor() as cursor:
                    cursor.execute('SELECT %s', ['private-synthetic-parameter'])
                    self.assertEqual(cursor.fetchone()[0], 'private-synthetic-parameter')
        self.assertEqual(timing.stages['learner_identity']['queries'], 1)
        self.assertGreater(timing.stages['learner_identity']['duration_ms'], 0)
        self.assertNotIn('private-synthetic-parameter', str(log.call_args))
