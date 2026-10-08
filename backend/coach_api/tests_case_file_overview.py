"""Overview regressions using synthetic rows; no database or external writes."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api.case_file import build_overview, read_overview_learning, merge_overview_subjects
from learner_api import canonical_learning


class CaseFileOverviewTests(SimpleTestCase):
    def context(self, *, aptem=None):
        context = MagicMock()
        context.profile = SimpleNamespace(enrolment_id=201, aptem_id=aptem, start_date=None, end_date=None)
        context.source = SimpleNamespace(start_date='2026-01-01', end_date='2026-01-11')
        context.parallel.side_effect = lambda readers: {name: reader() for name, reader in readers.items()}
        context.payload.return_value = {'attendance': {'present': 1, 'sessions': 3}}
        return context

    def render(self, *, today=date(2026, 1, 6), actual=12, planned=100, subjects=None, activity=None):
        context = self.context(aptem='123' if activity else None)
        metrics = {'programme': {'completed': 1, 'total': 2, 'percent': 50, 'status': 'ready'},
                   'otjh': {'actual': actual, 'planned': planned, 'new': 0, 'historical': actual, 'completed_actual': actual},
                   'ksb': {'completed': 1, 'total': 4, 'percent': 25, 'historicalCompleted': 1}}
        with patch('coach_api.case_file.read_overview_learning', return_value=(metrics, activity)), \
             patch('learner_api.module_progress.canonical_module_progress', return_value=self.shared_rows(subjects or [], activity)), \
             patch('coach_api.views.timezone.localdate', return_value=today):
            result = build_overview(context)
        context.payload.assert_called_once_with('summary')
        return result

    @staticmethod
    def shared_rows(subjects, activity):
        from learner_api.module_progress import aggregate_module_progress
        detail = {'components': [], 'quizAttempts': []}
        progress = []
        historical = {'subjects': [], 'activities': []}
        for row in (activity or {}).get('subjects', []):
            historical['subjects'].append(row)
            historical['activities'].extend({'group_id': row['id'], 'activity_id': f"A{i}",
                'completed': i < row['completed']} for i in range(row['total']))
        for row in subjects:
            module_id = row['id'][8:]
            for i in range(row['total']):
                component_id = f"{module_id}:{i}"
                detail['components'].append({'moduleId': module_id, 'module': row['title'], 'componentId': component_id})
                if i < row['completed']:
                    progress.append({'kind': 'component', 'passed': None, 'component_ref': component_id})
        return aggregate_module_progress(historical, detail,
            [{'id': row['id'][8:], 'title': row['title']} for row in subjects], progress)

    def test_mid_programme_uses_paced_target_not_full_planned_hours(self):
        whole = self.render()['wholeProgrammeProgress']
        self.assertEqual(whole['otjh'], {'actual': 12, 'planned': 100, 'targetToDate': 50, 'percent': 24})
        self.assertEqual(whole['attendance'], {'present': 1, 'sessions': 3, 'percent': 33.33})
        self.assertEqual(set(whole), {'overall', 'attendance', 'otjh', 'ksb'})
        self.assertEqual(set(whole['overall']), {'completed', 'total', 'percent'})
        self.assertEqual(set(whole['ksb']), {'completed', 'total', 'percent'})

    def test_dates_zero_unavailable_and_cap_preserve_chart_rules(self):
        for today, actual, planned, target, percent in [
            (date(2025, 12, 31), 12, 100, 0, 0),
            (date(2026, 1, 11), 12, 100, 100, 12),
            (date(2026, 1, 20), 120, 100, 100, 100),
            (date(2026, 1, 6), None, 100, 50, None),
            (date(2026, 1, 6), 12, None, None, None),
            (date(2026, 1, 6), 12, 0, None, None),
        ]:
            with self.subTest(today=today, planned=planned, actual=actual):
                hours = self.render(today=today, actual=actual, planned=planned)['wholeProgrammeProgress']['otjh']
                self.assertEqual(hours['targetToDate'], target)
                self.assertEqual(hours['percent'], percent)
                self.assertEqual(hours['planned'], planned)

    def test_historical_records_deduplicate_and_suppress_only_mapped_native_module(self):
        activity = {'progress_basis': 'catalogue_activities',
                    'subjects': [{'id': 1, 'name': 'Recorded', 'module_id': 'M1', 'total': 4, 'completed': 1},
                                 {'id': 2, 'name': 'Unstarted', 'module_id': 'M3', 'total': 3, 'completed': 0}]}
        subjects = [{'id': 'current:M1', 'title': 'Mapped', 'total': 3, 'completed': 3},
                    {'id': 'current:M2', 'title': 'Native', 'total': 3, 'completed': 1}]
        rows = self.render(subjects=subjects, activity=activity)['programmeProgress']
        self.assertEqual(rows, [{'id': 'current:M2', 'title': 'Native', 'percent': 33.33},
                                {'id': 'legacy:1', 'title': 'Recorded', 'percent': 25},
                                {'id': 'legacy:2', 'title': 'Unstarted', 'percent': 0}])
        self.assertTrue(all(set(row) == {'id', 'title', 'percent'} for row in rows))
        self.assertEqual(self.render(subjects=subjects, activity=activity)['wholeProgrammeProgress'],
                         self.render(subjects=subjects)['wholeProgrammeProgress'])

    def test_same_title_is_not_a_module_link(self):
        activity = {'progress_basis': 'catalogue_activities', 'subjects': [
            {'id': 1, 'name': 'Same title', 'module_id': 'M1', 'total': 4, 'completed': 1}]}
        subjects = [{'id': 'current:M2', 'title': 'Same title', 'total': 2, 'completed': 0}]
        self.assertEqual(self.render(subjects=subjects, activity=activity)['programmeProgress'], [
            {'id': 'current:M2', 'title': 'Same title', 'percent': 0},
            {'id': 'legacy:1', 'title': 'Same title', 'percent': 25}])

    def test_native_dashboard_cards_include_retained_quizzes_and_require_a_pass(self):
        from learner_api.module_progress import aggregate_module_progress
        components = [
            {'moduleId': 'M1', 'module': 'Same', 'componentId': 'C1'},
            {'moduleId': 'M1', 'module': 'Same', 'componentId': 'C2'},
            {'moduleId': 'M1', 'module': 'Same', 'componentId': 'Q1', 'isQuiz': True,
             'quizMeta': {'quizId': 11}},
            {'moduleId': 'M2', 'module': 'Same', 'componentId': 'C3'},
        ]
        detail = {'components': components + [components[0]],
                  'retiredQuizComponents': [{'moduleId': 'M1', 'module': 'Same', 'componentId': 'old',
                                            'isQuiz': True, 'quizMeta': {'quizId': 10}}],
                  'quizAttempts': [{'quizId': 11, 'passed': False},
                                   {'quizId': 10, 'passed': True}, {'quizId': 10, 'passed': False}]}
        progress = [{'kind': 'component', 'component_ref': 'C1', 'passed': None},
                    {'kind': 'component', 'component_ref': 'C2', 'passed': False}]
        subjects = aggregate_module_progress(None, detail, [{'id': 'M1', 'title': 'Same'},
                                                  {'id': 'M2', 'title': 'Same'}], progress)
        self.assertEqual(subjects, [{'id': 'current:M1', 'title': 'Same', 'total': 4, 'completed': 2, 'percent': 50},
                                    {'id': 'current:M2', 'title': 'Same', 'total': 1, 'completed': 0, 'percent': 0}])
        self.assertEqual([row['percent'] for row in self.render(subjects=subjects)['programmeProgress']], [50, 0])

    def test_native_module_identity_cannot_fall_back_to_title(self):
        from learner_api.module_progress import aggregate_module_progress
        from old_otjh.service import ServiceError
        with self.assertRaises(ServiceError):
            aggregate_module_progress(None, {'components': [{'module': 'Same', 'componentId': 'C1'}],
                                   'quizAttempts': []}, [{'id': 'M1', 'title': 'Same'}], [])

    def test_native_reader_reuses_student_plan_and_retained_quiz_helpers(self):
        from learner_api.module_progress import read_native_progress
        profile = MagicMock()
        profile.progress_entries.using.return_value.exclude.return_value.values.return_value = []
        source = SimpleNamespace(pk=201, programme='Synthetic')
        components = [{'moduleId': 'M1', 'module': 'Module', 'componentId': 'C1'}]
        connection = MagicMock()
        with patch('learner_api.learning_plan.effective_training_plan', return_value=[{'moduleId': 'M1'}]), \
             patch('learner_api.mappers.get_training_plan', return_value=[]), \
             patch('learner_api.mappers.flatten_training_plan', return_value=([], [], [])), \
             patch('learner_api.learner_detail._resolve_from_master', return_value=(['Module'], [], components)) as resolve, \
             patch('learner_api.learner_detail._apply_programme_assignment_template', return_value=components), \
             patch('learner_api.learner_detail._append_week_quizzes', return_value=([], components)) as quizzes, \
             patch('learner_api.retained_quiz_progress.retain_quiz_progress') as retain, \
             patch('learner_api.student_activity._builder_subject_metadata', return_value=({}, {})), \
             patch('learner_api.student_activity._effective_current_subjects', return_value=[{'id': 'M1', 'title': 'Module'}]), \
             patch('django.db.connections', {'enrolment': connection}), \
             patch('learner_api.learner_detail.build_learner_detail', side_effect=AssertionError('must not invoke repair writes')):
            result = read_native_progress(source, profile)
        resolve.assert_called_once_with([], [], [], assigned_modules=[{'moduleId': 'M1'}], compact=True)
        quizzes.assert_called_once()
        retain.assert_called_once()
        self.assertEqual(result[:3], ({'components': components, 'quizAttempts': []}, [{'id': 'M1', 'title': 'Module'}], []))

    def test_verified_subject_merge_rule_is_unchanged(self):
        subjects = [{'id': 'legacy:1', 'source': 'legacy', 'title': 'Old', 'total': 2, 'completed': 1},
                    {'id': 'current:M1', 'title': 'Native', 'total': 2, 'completed': 2}]
        merged = merge_overview_subjects(subjects, {'moduleLinks': {'legacy:1': {'id': 'M1', 'title': 'Linked'}}})
        self.assertEqual([(r['id'], r['total'], r['completed']) for r in merged], [('legacy:1', 4, 3)])

    def test_canonical_records_are_loaded_once_and_reused_without_mutation(self):
        context = self.context(aptem='123')
        records = [{'id': 1, 'accepted': True, 'actual_seconds': 3600, 'ksbs': ['K1', 'K1']},
                   {'id': 2, 'accepted': False, 'actual_seconds': 7200, 'ksbs': ['K1'],
                    'sources': [{'source_system': 'old_lms', 'completed': True}]}]
        owner = {'id': 101, 'enrolment_id': 201, 'programme_planned_hours': 100}
        with patch.object(canonical_learning, 'require_profile', return_value=owner), \
             patch.object(canonical_learning, 'entries_for', return_value=records) as load, \
             patch.object(canonical_learning, 'source_subjects', return_value={}) as subjects:
            metrics, _activity = read_overview_learning(context)
        load.assert_called_once_with(owner, overview_only=True)
        subjects.assert_not_called()
        self.assertEqual(metrics['programme']['completed'], 2)
        self.assertEqual(metrics['programme']['total'], 2)
        self.assertEqual(metrics['otjh']['actual'], 1)
        self.assertEqual(metrics['otjh']['planned'], 100)
        self.assertEqual(metrics['ksb']['completed'], 1)
        self.assertEqual(metrics['ksb']['total'], 2)
        self.assertNotIn('completed', records[1])

    def test_compact_course_allocation_preserves_completion_and_skips_details(self):
        courses = [{'id': 1, 'source_course_ref': '1', 'source_course_title': 'Course', 'curriculum_module_ref': 'M1'}]
        catalogue = [{'source_course_ref': '1', 'source_activity_id': 'material:2',
                      'source_course_title': 'Course', 'source_activity_title': 'Activity'}]
        records = [{'id': 5, 'accepted': True, 'actual_seconds': 3600,
                    'sources': [{'source_system': 'old_lms', 'source_course_ref': '1', 'source_activity_id': 'material:2'}]}]
        full = canonical_learning.recorded_course_items(courses, catalogue, records)
        with patch.object(canonical_learning, 'recorded_activity_schedule', side_effect=AssertionError('unused dates')):
            compact = canonical_learning.recorded_course_items(courses, catalogue, records, overview_only=True)
        self.assertEqual([(r['activity_id'], r['completed']) for r in full[0]],
                         [(r['activity_id'], r['completed']) for r in compact[0]])
        self.assertEqual(set(compact[0][0]), {'activity_id', 'group_id', 'completed'})

    def test_native_counts_match_existing_aggregation_with_bounded_reads(self):
        from learner_api.overview_week import read_overview_subjects, merged_activities, summarise_plan
        assigned = [('M1', 'Module'), ('M2', 'Empty')]
        native = [{'id': 'C1', 'module_id': 'M1', 'module_title': 'Module', 'quiz_id': None},
                  {'id': 'C2', 'module_id': 'M1', 'module_title': 'Module', 'quiz_id': 'Q1'},
                  {'id': 'C3', 'module_id': 'M1', 'module_title': 'Module', 'quiz_id': None}]
        progress = [{'kind': 'component', 'passed': None, 'componentId': 'C1', 'quizId': None},
                    {'kind': 'quiz', 'passed': False, 'componentId': None, 'quizId': 'Q1'},
                    {'kind': 'quiz', 'passed': True, 'componentId': None, 'quizId': 'Q1'},
                    {'kind': 'component', 'passed': False, 'componentId': 'C3', 'quizId': None}]
        profile = MagicMock()
        values = profile.progress_entries.using.return_value.filter.return_value.exclude.return_value.values
        values.return_value = [{'kind': r['kind'], 'passed': r['passed'],
                                'component_ref': r['componentId'], 'quiz_ref': r['quizId']} for r in progress]
        cur = MagicMock()
        cur.fetchall.return_value = assigned
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cur
        with patch('learner_api.overview_week.connections', {'enrolment': connection}), \
             patch('learner_api.overview_week.rows', return_value=native):
            compact = read_overview_subjects(SimpleNamespace(pk=201), profile)
        full = summarise_plan(merged_activities([], native, progress, set(), {}), assigned)
        self.assertEqual(compact, [{key: r[key] for key in ('id', 'title', 'total', 'completed')} for r in full])
        self.assertEqual(cur.execute.call_count, 2)
        values.assert_called_once_with('kind', 'passed', 'component_ref', 'quiz_ref')

    def test_attendance_counts_only_projection_matches_full_register_summary(self):
        from learner_api.attendance import _summarize_attendance
        from datetime import datetime, timezone
        rows = [{'attendance_status': status, 'session_date': date(2026, 1, 1),
                 'minutes_late': 0, 'catchup_completed': False, 'updated_at': None,
                 'learner_id': 201, 'learner_name': 'Synthetic', 'learner_email': 'learner@example.test',
                 'session_id': index} for index, status in enumerate(['present', 'absent', 'unmarked'])]
        now = datetime(2026, 1, 6, tzinfo=timezone.utc)
        full = _summarize_attendance(rows, now=now)
        compact = _summarize_attendance(rows, now=now, overview_only=True)
        self.assertEqual(compact, {key: full[key] for key in ('present', 'sessions')})
        self.assertEqual(compact, {'present': 1, 'sessions': 2})

    def test_reused_totals_match_previous_bulk_loader_for_both_journal_modes(self):
        from copy import deepcopy
        owner = {'id': 101, 'enrolment_id': 201, 'aptem_id': None,
                 'email': 'learner@example.test', 'account_email': 'learner@example.test',
                 'account_record_id': 201, 'account_aptem_id': None,
                 'learner_type': 'commercial', 'programme_planned_hours': 100}
        records = [
            {'id': 1, 'accepted': True, 'actual_seconds': 3600, 'activity_status': '', 'ksbs': ['K1', 'K1']},
            {'id': 2, 'accepted': False, 'actual_seconds': 7200, 'activity_status': 'completed', 'ksbs': ['K1']},
            {'id': 3, 'accepted': False, 'actual_seconds': None, 'activity_status': 'submitted', 'ksbs': [],
             'sources': [{'source_system': 'old_lms', 'completed': True}]},
            {'id': 4, 'accepted': False, 'actual_seconds': 0, 'activity_status': 'failed', 'ksbs': ['S1']},
        ]
        def load(sql, params):
            if 'WITH canonical AS' in sql:
                return [{'payload': {key: value for key, value in r.items() if key not in ('ksbs', 'sources')},
                         'ksbs': r['ksbs'], 'sources': r.get('sources', []),
                         'segments': [], 'journal_routes': [], 'historical_components': []} for r in deepcopy(records)]
            if 'FROM "Learner".learners l' in sql:
                return [deepcopy(owner)]
            if 'FROM "Learner".learner_progress_entries p' in sql:
                return [{'owner_id': 101, **{key: value for key, value in r.items() if key not in ('ksbs', 'sources')}}
                        for r in deepcopy(records)]
            if 'learner_progress_ksbs' in sql:
                return [{'progress_id': r['id'], 'ksb_code': code} for r in records for code in r['ksbs']]
            if 'learner_activity_sources s' in sql:
                return [{'progress_id': r['id'], **source} for r in records for source in r.get('sources', [])]
            if any(name in sql for name in ('learner_activity_reporting_segments',
                                            'learner_progress_historical_components', 'learner_monthly_targets')):
                return []
            raise AssertionError(sql)
        for enabled in (False, True):
            with self.subTest(journal=enabled), \
                 patch.object(canonical_learning, 'query', side_effect=load), \
                 patch.object(canonical_learning, 'current_records', side_effect=lambda owner, records: records), \
                 patch.object(canonical_learning, 'current_records_bulk',
                              side_effect=lambda owners, records: {201: records[101]}), \
                 patch('learner_api.journal_sources.enabled', return_value=enabled):
                previous = canonical_learning.metrics_bulk([201], learner_workspace=True)[201]
                current, _ = read_overview_learning(self.context())
            for field in ('programme', 'otjh', 'ksb'):
                self.assertEqual(current[field], previous[field])
