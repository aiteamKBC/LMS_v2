"""Employer dashboard reads: owned OTJ, attendance, catalogue and saved status.

All database readers are mocked; no schema setup or external calls are needed.
"""
import json
from datetime import date
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from learner_api import employer_portal, module_progress


class EmployerDashboardMetricsTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="employer", subject_id=7)
        self.model = MagicMock()
        self.learners = [SimpleNamespace(pk=key, aptem_id=None, learner_type=kind, email=f'learner{key}@example.test')
                         for key, kind in ((101, 'commercial'), (102, 'apprenticeship'), (103, 'commercial'))]
        self.model.all_learners.filter.return_value.only.return_value = self.learners
        self.profiles = {key: {'id': key + 1000, 'enrolment_id': key, 'email': f'learner{key}@example.test', 'aptem_id': None} for key in (101, 102, 103)}
        self.statuses = {(1101, 101): 'At risk', (1102, 102): 'Need attention', (1103, 103): 'On track'}
        self.modules = {key: [{'completed': 1, 'total': 400}, {'completed': 0, 'total': 500}]
                        for key in (101, 102, 103)}
        self.hours = {
            key: {"planned": 200, "actual": actual, "start_date": date(2026, 10, 1), "end_date": date(2026, 11, 10)}
            for key, actual in ((101, 90), (102, 70), (103, 40))
        }
        self.saved_hours = {
            101: {'completed_hours': 90, 'planned_hours': 200},
            102: {'completed_hours': 70, 'planned_hours': 400},
            103: {'completed_hours': 0, 'planned_hours': 200},
        }
        self.home_progress = {
            101: {'actual': 12.5, 'submitted': 2, 'planned': 25, 'percent': 50},
            102: {'actual': 70, 'submitted': 0, 'planned': 400, 'percent': 17.5},
            103: {'actual': 0, 'submitted': 0, 'planned': 200, 'percent': 0},
        }
        self.attendance_rows = {key: [self.attendance_row('present'), self.attendance_row('late'),
                                     self.attendance_row('absent')] for key in (101, 102, 103)}
        patches = [
            patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
            patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=7), None)),
            patch.object(employer_portal, "SOURCE_MODELS", {"apprenticeship": self.model}),
            patch.object(employer_portal.timezone, "localdate", return_value=date(2026, 10, 21)),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        status_patch = patch.object(employer_portal.LearnerProfile.objects, 'filter')
        self.status_reader = status_patch.start()
        self.addCleanup(status_patch.stop)
        self.status_reader.return_value.values.side_effect = lambda *columns: [
            {**profile, **self.saved_hours[key], 'otjh_status': self.statuses.get((profile['id'], key))}
            for key, profile in self.profiles.items()
        ]
        home_patch = patch('learner_api.overview_week.read_week')
        self.home_reader = home_patch.start()
        self.home_reader.side_effect = lambda source, **kwargs: {
            'homeProgress': {'otjh': self.home_progress.get(source.pk)},
        }
        self.addCleanup(home_patch.stop)
        from learner_api import journal_sources
        self.metrics_source_modes = []

        def bulk_metrics(learner_ids, *, learner_workspace=False):
            self.metrics_source_modes.append(journal_sources.enabled())
            if not learner_workspace:
                raise AssertionError('Employer summary must use the learner workspace projection')
            return {learner_id: {'otjh': {
                'actual': self.home_progress[learner_id]['actual'],
                'completed_actual': self.home_progress[learner_id]['actual'],
                'planned': self.home_progress[learner_id]['planned'],
            }} for learner_id in learner_ids}

        metrics_patch = patch('learner_api.canonical_learning.metrics_bulk', side_effect=bulk_metrics)
        self.home_metrics_reader = metrics_patch.start()
        self.addCleanup(metrics_patch.stop)
        self.plan_fallbacks = {102: 313.5, 103: 464.7}
        fallback_patch = patch(
            'learner_api.training_plan_dashboard.plan_planned_hours',
            side_effect=lambda source, _owner: self.plan_fallbacks.get(source.pk),
        )
        self.plan_fallback_reader = fallback_patch.start()
        self.addCleanup(fallback_patch.stop)
        attendance_patch = patch('learner_api.attendance_lectures.lecture_register',
                                 side_effect=lambda source: self.attendance_rows[source.pk])
        self.attendance_reader = attendance_patch.start()
        self.addCleanup(attendance_patch.stop)

    @staticmethod
    def attendance_row(status, **values):
        return {'attendance_status': status, 'minutes_late': 0, 'catchup_completed': False,
                'session_date': date(2026, 1, 1), 'updated_at': None,
                'learner_email': 'learner@example.test', 'learner_id': 101,
                'learner_name': 'Test Learner', **values}

    def call(self, *, employer_id=7, method="get", error=None, section=None):
        with patch("learner_api.canonical_learning.profile", side_effect=lambda key: self.profiles.get(key)), \
                patch.object(module_progress, 'canonical_module_progress', side_effect=error or
                             (lambda source, profile: self.modules[source.pk])) as metrics, \
                patch("learner_api.canonical_learning.otjh_summary_bulk", return_value=self.hours) as hours:
            response = employer_portal.employer_dashboard_metrics(
                getattr(RequestFactory(), method)("/dashboard-metrics/", {"section": section} if section else {}), employer_id=employer_id,
            )
        return response, metrics, hours

    def test_uses_student_home_progress_and_total_plan_not_saved_snapshots(self):
        response, metrics, hours = self.call()
        self.model.all_learners.filter.assert_called_once_with(employer_id=7)
        self.assertEqual([call.args[0] for call in metrics.call_args_list], self.learners)
        self.assertEqual([(call.args[1].pk, call.args[1].enrolment_id) for call in metrics.call_args_list],
                         [(1101, 101), (1102, 102), (1103, 103)])
        self.status_reader.assert_called_once_with(enrolment_id__in=[101, 102, 103])
        self.status_reader.return_value.values.assert_called_once_with('id', 'enrolment_id', 'email', 'aptem_id', 'otjh_status')
        hours.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(set(body["learners"]), {"101", "102", "103"})
        self.assertEqual([row["risk"] for row in body["learners"].values()], ["at-risk", "need-attention", "on-track"])
        self.assertEqual(body["learners"]["101"]["programme"],
                         {"completed": 1, "total": 900, "percent": 0.11, "status": "ready"})
        self.assertEqual(set(body["learners"]["101"]), {"programme", "otjh", "attendance", "risk"})
        self.assertEqual(body['learners']['101']['otjh'], {'actual': 12.5, 'planned': 25, 'percent': 50})
        self.assertEqual(body['learners']['102']['otjh'], {'actual': 70, 'planned': 400, 'percent': 17.5})
        self.assertEqual(body['learners']['103']['otjh'], {'actual': 0, 'planned': 200, 'percent': 0})
        self.assertEqual(self.home_reader.call_count, 3)
        for learner in self.learners:
            self.home_reader.assert_any_call(learner, home_kind=learner.learner_type, home_summary=True)
        self.assertEqual([call.args[0] for call in self.attendance_reader.call_args_list], self.learners)
        self.assertEqual(body["asOf"], "2026-10-21")
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_missing_identity_stays_unavailable_even_with_saved_status(self):
        self.profiles = {}
        self.hours = {101: None}
        response, _, _ = self.call()
        for row in json.loads(response.content)["learners"].values():
            self.assertEqual(row, {"programme": None, "otjh": None, "attendance": None, "risk": "unavailable"})
        self.home_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_attendance_uses_shared_outcomes_and_excludes_unmarked_and_future_sessions(self):
        self.attendance_rows[101] += [
            self.attendance_row('unmarked'), self.attendance_row('catchup'),
            self.attendance_row('absent', effective_attendance_status='present', catchup_completed=True),
            self.attendance_row('present', session_date=date(2099, 1, 1)),
            self.attendance_row('present', occurrence_status='cancelled'),
        ]
        self.attendance_rows[102] = []
        self.attendance_rows[103] = [self.attendance_row('absent')]
        response, _, _ = self.call()
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['101']['attendance'],
                         {'sessions': 4, 'present': 3, 'absent': 1, 'late': 1, 'attendanceRate': 75})
        self.assertIsNone(rows['102']['attendance'])
        self.assertEqual(rows['103']['attendance'],
                         {'sessions': 1, 'present': 0, 'absent': 1, 'late': 0, 'attendanceRate': 0})

    def test_unavailable_home_progress_does_not_fall_back_to_saved_snapshots(self):
        self.home_progress[101] = None
        response, _, _ = self.call()
        rows = json.loads(response.content)['learners']
        self.assertIsNone(rows['101']['otjh'])
        self.assertEqual(rows['102']['otjh'], {'actual': 70, 'planned': 400, 'percent': 17.5})

    def test_new_metric_read_failures_are_visible_and_never_report_zero(self):
        for reader in (self.attendance_reader,):
            with self.subTest(reader=reader):
                original = reader.side_effect
                reader.side_effect = DatabaseError('synthetic metric source unavailable')
                response, _, _ = self.call()
                self.assertEqual(response.status_code, 503)
                self.assertIn('error', json.loads(response.content))
                reader.side_effect = original

    def test_saved_status_does_not_depend_on_monthly_targets_or_hours(self):
        self.hours = {}
        response, _, hours = self.call()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['risk'] for row in json.loads(response.content)['learners'].values()],
                         ['at-risk', 'need-attention', 'on-track'])
        hours.assert_not_called()

    def test_status_labels_accept_case_spacing_and_attention_variants(self):
        for value, expected in (
            (' On TRACK ', 'on-track'), ('ON_TRACK', 'on-track'),
            ('Needs attention', 'need-attention'), (' need   attention ', 'need-attention'),
            ('at-risk', 'at-risk'), ('AT RISK', 'at-risk'),
            (None, 'unavailable'), ('', 'unavailable'), ('  ', 'unavailable'),
            ('Unknown status', 'unavailable'),
        ):
            with self.subTest(value=value):
                self.statuses[(1101, 101)] = value
                response, _, _ = self.call()
                rows = json.loads(response.content)['learners']
                self.assertEqual(rows['101']['risk'], expected)
                self.assertEqual(rows['102']['risk'], 'need-attention')

    def test_summary_validates_email_and_aptem_before_exposing_saved_fields(self):
        original = dict(self.profiles[101])
        for changes in ({'email': 'different@example.test'}, {'email': ''}, {'aptem_id': '999'}):
            with self.subTest(changes=changes):
                self.profiles[101] = {**original, **changes}
                self.learners[0].aptem_id = '123'
                response, modules, _ = self.call(section='summary')
                self.assertEqual(response.status_code, 503)
                self.assertNotIn('learners', json.loads(response.content))
                modules.assert_not_called()

    def test_duplicate_profiles_are_rejected_instead_of_selecting_a_saved_status(self):
        self.profiles[104] = {**self.profiles[101], 'id': 9999}
        self.saved_hours[104] = self.saved_hours[101]
        response, modules, _ = self.call(section='summary')
        self.assertEqual(response.status_code, 503)
        modules.assert_not_called()

    def test_summary_reads_student_home_progress_without_catalogue_or_attendance(self):
        response, modules, hours = self.call(section='summary')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['learners']['101'], {
            'programme': None, 'attendance': None, 'risk': 'at-risk',
            'otjh': {'actual': 12.5, 'planned': 25, 'percent': 50},
        })
        self.model.all_learners.filter.return_value.only.assert_called_once_with(
            'id', 'email', 'aptem_id', 'programme', 'cohort', 'group', 'group_name',
            'programme_id', 'cohort_id', 'group_id', 'training_plan', 'learning_plan',
        )
        modules.assert_not_called()
        hours.assert_not_called()
        self.home_metrics_reader.assert_called_once_with([101, 102, 103], learner_workspace=True)
        self.assertEqual(self.metrics_source_modes, [True])
        self.home_reader.assert_not_called()
        from learner_api import journal_sources
        self.assertFalse(journal_sources.enabled())
        self.attendance_reader.assert_not_called()

    def test_summary_uses_exact_student_home_projection_when_bulk_result_is_missing(self):
        self.home_metrics_reader.side_effect = lambda _ids, **_kwargs: {}

        response, modules, hours = self.call(section='summary')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['learners']['101']['otjh'],
                         {'actual': 12.5, 'planned': 25, 'percent': 50})
        self.assertEqual(self.home_reader.call_count, 3)
        modules.assert_not_called()
        hours.assert_not_called()

    def test_summary_uses_group_plan_fallback_only_for_missing_ssot_target(self):
        self.home_progress[102]['planned'] = None
        self.home_progress[103]['planned'] = None

        response, modules, hours = self.call(section='summary')

        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['102']['otjh'], {'actual': 70, 'planned': 313.5, 'percent': 22.33})
        self.assertEqual(rows['103']['otjh'], {'actual': 0, 'planned': 464.7, 'percent': 0})
        self.assertEqual(self.plan_fallback_reader.call_count, 2)
        self.assertEqual({call.args[0].pk for call in self.plan_fallback_reader.call_args_list}, {102, 103})
        modules.assert_not_called()
        hours.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_summary_keeps_explicit_zero_target_without_fallback(self):
        self.home_progress[101]['planned'] = 0

        response, modules, hours = self.call(section='summary')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['learners']['101']['otjh'],
                         {'actual': 12.5, 'planned': 0, 'percent': None})
        self.plan_fallback_reader.assert_not_called()
        modules.assert_not_called()
        hours.assert_not_called()

    def test_missing_group_plan_does_not_discard_canonical_actual_hours(self):
        self.home_progress[102]['planned'] = None
        self.home_progress[103]['planned'] = None

        def fallback(source, _owner):
            if source.pk == 102:
                raise DatabaseError('synthetic plan lookup failure')
            return self.plan_fallbacks.get(source.pk)

        self.plan_fallback_reader.side_effect = fallback

        response, modules, hours = self.call(section='summary')

        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['102']['otjh'], {'actual': 70, 'planned': None, 'percent': None})
        self.assertEqual(rows['103']['otjh'], {'actual': 0, 'planned': 464.7, 'percent': 0})
        modules.assert_not_called()
        hours.assert_not_called()

    def test_programme_reads_independent_learners_concurrently(self):
        barrier = Barrier(3)

        def wait_for_other_learners(source, _profile):
            barrier.wait(timeout=5)
            return self.modules[source.pk]

        response, modules, hours = self.call(section='programme', error=wait_for_other_learners)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(modules.call_count, 3)
        self.assertEqual(json.loads(response.content)['learners']['101']['programme']['percent'], 0.11)
        hours.assert_not_called()
        self.home_reader.assert_not_called()
        self.home_metrics_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_programme_read_keeps_activity_calculation_without_loading_attendance(self):
        response, modules, _ = self.call(section='programme')
        self.assertEqual(json.loads(response.content)['learners']['101']['programme']['percent'], 0.11)
        self.assertEqual(modules.call_count, 3)
        self.home_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_progress_read_combines_student_home_and_programme_without_waiting_for_attendance(self):
        response, modules, hours = self.call(section='progress')
        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['101']['otjh'], {'actual': 12.5, 'planned': 25, 'percent': 50})
        self.assertEqual(rows['101']['programme']['percent'], 0.11)
        self.assertIsNone(rows['101']['attendance'])
        self.assertEqual(modules.call_count, 3)
        self.assertEqual(self.home_reader.call_count, 3)
        hours.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_status_read_returns_risk_without_waiting_for_learner_progress(self):
        response, modules, hours = self.call(section='status')
        self.assertEqual(response.status_code, 200)
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['101'], {
            'programme': None, 'otjh': None, 'attendance': None, 'risk': 'at-risk',
        })
        self.assertEqual(rows['102']['risk'], 'need-attention')
        modules.assert_not_called()
        self.home_reader.assert_not_called()
        hours.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_invalid_section_does_not_read_learner_data(self):
        response, modules, _ = self.call(section='invalid')
        self.assertEqual(response.status_code, 400)
        self.status_reader.assert_not_called()
        modules.assert_not_called()

    def test_legacy_saved_hours_do_not_override_student_home_progress(self):
        for actual, planned in ((0, 100), (125, 100), (3, 0), (None, 100),
                                (float('nan'), 100), (3, -1), (3, float('inf'))):
            with self.subTest(actual=actual, planned=planned):
                self.saved_hours[101] = {'completed_hours': actual, 'planned_hours': planned}
                response, _, _ = self.call(section='summary')
                value = json.loads(response.content)['learners']['101']['otjh']
                self.assertEqual(value, {'actual': 12.5, 'planned': 25, 'percent': 50})
                self.assertNotIn('NaN', response.content.decode())
                self.assertNotIn('Infinity', response.content.decode())

    def test_status_read_failure_is_visible(self):
        self.status_reader.side_effect = DatabaseError('synthetic status source unavailable')
        response, metrics, hours = self.call()
        self.assertEqual(response.status_code, 503)
        self.assertIn('error', json.loads(response.content))
        metrics.assert_not_called()
        hours.assert_not_called()

    def test_no_learners_has_no_fabricated_metrics(self):
        self.model.all_learners.filter.return_value.only.return_value = []
        response, metrics, hours = self.call()
        metrics.assert_not_called()
        hours.assert_not_called()
        self.status_reader.assert_not_called()
        self.assertEqual(json.loads(response.content)["learners"], {})
        self.home_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_unavailable_source_returns_an_error_not_zero_progress(self):
        response, _, hours = self.call(error=DatabaseError("synthetic unavailable source"))
        self.assertEqual(response.status_code, 503)
        self.assertIn("error", json.loads(response.content))
        hours.assert_not_called()

    def test_empty_catalogue_has_no_invented_completion_and_learners_are_independent(self):
        self.modules[101] = []
        self.modules[102] = [{'completed': 0, 'total': 12}]
        response, _, _ = self.call()
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['101']['programme'], {'completed': 0, 'total': 0, 'percent': None, 'status': 'empty'})
        self.assertEqual(rows['102']['programme'], {'completed': 0, 'total': 12, 'percent': 0, 'status': 'ready'})
        self.assertEqual(rows['103']['programme']['percent'], 0.11)

    def test_real_student_calculation_counts_unstarted_activities_and_retained_quizzes(self):
        self.model.all_learners.filter.return_value.only.return_value = self.learners[:1]
        source = self.learners[0]
        detail = {'components': [
            {'moduleId': 'm1', 'componentId': 'video'},
            {'moduleId': 'm1', 'componentId': 'unstarted'},
            {'moduleId': 'm2', 'componentId': 'unstarted-2'},
        ], 'retiredQuizComponents': [
            {'moduleId': 'm2', 'componentId': 'retained', 'isQuiz': True, 'quizMeta': {'quizId': 5}},
        ], 'quizAttempts': [{'quizId': 5, 'componentId': 'retained', 'passed': True}]}
        progress = [{'kind': 'video', 'component_ref': 'video', 'passed': None}]
        # Exercise the exact Student Home calculator; only its data readers are mocked.
        with patch('learner_api.canonical_learning.profile', return_value=self.profiles[101]), \
                patch('learner_api.canonical_learning.require_profile', return_value=self.profiles[101]), \
                patch('learner_api.canonical_learning.otjh_summary_bulk', return_value=self.hours), \
                patch.object(module_progress, 'read_native_progress', return_value=(detail, [], progress, {})), \
                patch('learner_api.live_session_progress.read_live_credits', return_value=[]):
            response = employer_portal.employer_dashboard_metrics(RequestFactory().get('/dashboard-metrics/'), employer_id=7)
            expected_modules = module_progress.canonical_module_progress(source, SimpleNamespace(pk=1101, enrolment_id=101))
        programme = json.loads(response.content)['learners']['101']['programme']
        self.assertEqual(programme, {'completed': 2, 'total': 4, 'percent': 50, 'status': 'ready'})
        self.assertEqual(programme['total'], sum(row['total'] for row in expected_modules))
        self.assertEqual(programme['completed'], sum(row['completed'] for row in expected_modules))

    def test_ownership_role_and_read_only_boundaries(self):
        for role, subject_id, employer_id, method, expected in (
            ("employer", 7, 8, "get", 404),
            ("learner", 101, 7, "get", 403),
            ("employer", 7, 7, "post", 405),
        ):
            with self.subTest(role=role, method=method):
                self.account = SimpleNamespace(role=role, subject_id=subject_id)
                response, metrics, hours = self.call(employer_id=employer_id, method=method)
                self.assertEqual(response.status_code, expected)
                metrics.assert_not_called()
                hours.assert_not_called()
                self.status_reader.assert_not_called()
                self.home_reader.assert_not_called()
                self.attendance_reader.assert_not_called()

    def test_staff_can_read_the_selected_employer(self):
        self.account = SimpleNamespace(role="staff", subject_id=None)
        response, _, _ = self.call()
        self.assertEqual(response.status_code, 200)

    def test_signed_out_cannot_read_dashboard(self):
        self.account = None
        response, metrics, _ = self.call()
        self.assertEqual(response.status_code, 401)
        metrics.assert_not_called()
        self.status_reader.assert_not_called()


class EmployerLearnerListProgressTests(SimpleTestCase):
    def test_list_progress_uses_one_canonical_batch_and_learner_plan_semantics(self):
        learners = [SimpleNamespace(pk=1526), SimpleNamespace(pk=1527), SimpleNamespace(pk=1528)]
        cards = [{'id': str(learner.pk)} for learner in learners]
        metrics = {
            1526: {'otjh': {'actual': 5, 'completed_actual': 5, 'planned': 568.73}},
            1527: {'otjh': {'actual': 3, 'completed_actual': 3, 'planned': 0}},
            1528: {'otjh': {'actual': 0, 'completed_actual': 0, 'planned': None}},
        }
        profile_query = patch.object(employer_portal.LearnerProfile.objects, 'filter')
        profile_filter = profile_query.start()
        profile_filter.return_value.values.return_value = [
            {'id': 1117, 'enrolment_id': 1526},
            {'id': 1118, 'enrolment_id': 1527},
            {'id': 1119, 'enrolment_id': 1528},
        ]
        self.addCleanup(profile_query.stop)
        bulk = patch('learner_api.canonical_learning.metrics_bulk', return_value=metrics)
        bulk_reader = bulk.start()
        self.addCleanup(bulk.stop)
        plan = patch('learner_api.training_plan_dashboard.plan_planned_hours', return_value=250)
        plan_reader = plan.start()
        self.addCleanup(plan.stop)

        employer_portal._attach_learner_otjh_progress(cards, learners)

        bulk_reader.assert_called_once_with([1526, 1527, 1528], learner_workspace=True)
        plan_reader.assert_called_once_with(learners[2], {'id': 1119, 'enrolment_id': 1528})
        self.assertEqual(cards, [
            {'id': '1526', 'otjhProgress': {'actual': 5, 'planned': 568.73, 'percent': 0.88}},
            {'id': '1527', 'otjhProgress': {'actual': 3, 'planned': 0, 'percent': None}},
            {'id': '1528', 'otjhProgress': {'actual': 0, 'planned': 250, 'percent': 0}},
        ])

    def test_unresolved_canonical_metric_stays_unavailable_in_initial_list(self):
        learners = [SimpleNamespace(pk=1526)]
        cards = [{'id': '1526'}]
        profile_query = patch.object(employer_portal.LearnerProfile.objects, 'filter')
        profile_filter = profile_query.start()
        profile_filter.return_value.values.return_value = []
        self.addCleanup(profile_query.stop)
        bulk = patch('learner_api.canonical_learning.metrics_bulk', return_value={1526: None})
        bulk_reader = bulk.start()
        self.addCleanup(bulk.stop)

        employer_portal._attach_learner_otjh_progress(cards, learners)

        self.assertEqual(cards, [{'id': '1526', 'otjhProgress': None}])
        bulk_reader.assert_called_once_with([1526], learner_workspace=True)

    def test_initial_portal_response_keeps_progress_and_rejects_other_employer(self):
        cards = [{'id': '1526', 'outstandingCount': 0,
                  'otjhProgress': {'actual': 5, 'planned': 568.73, 'percent': 0.88}}]
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='employer', subject_id=9)), \
                patch.object(employer_portal, '_employer_or_404', return_value=(SimpleNamespace(pk=9, id=9), None)), \
                patch.object(employer_portal, 'to_employer_row', return_value={'id': '9', 'name': 'Test employer'}), \
                patch.object(employer_portal, '_learner_cards', return_value=cards) as read_cards:
            response = employer_portal.employer_portal(RequestFactory().get('/employer-portal/9/'), employer_id=9)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['learners'][0]['otjhProgress']['percent'], 0.88)
            response = employer_portal.employer_portal(RequestFactory().get('/employer-portal/8/'), employer_id=8)
            self.assertEqual(response.status_code, 404)
            read_cards.assert_called_once_with(9)
