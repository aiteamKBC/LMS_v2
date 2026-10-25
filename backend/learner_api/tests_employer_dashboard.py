"""Employer dashboard reads: owned OTJ, attendance, catalogue and saved status.

All database readers are mocked; no schema setup or external calls are needed.
"""
import json
from datetime import date
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
        self.addCleanup(home_patch.stop)
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

    def test_uses_only_owned_profiles_and_saved_otj_status_instead_of_recalculating(self):
        response, metrics, hours = self.call()
        self.model.all_learners.filter.assert_called_once_with(employer_id=7)
        self.assertEqual([call.args[0] for call in metrics.call_args_list], self.learners)
        self.assertEqual([(call.args[1].pk, call.args[1].enrolment_id) for call in metrics.call_args_list],
                         [(1101, 101), (1102, 102), (1103, 103)])
        self.status_reader.assert_called_once_with(enrolment_id__in=[101, 102, 103])
        self.status_reader.return_value.values.assert_called_once_with('id', 'enrolment_id', 'email', 'aptem_id', 'completed_hours', 'planned_hours', 'otjh_status')
        hours.assert_not_called()
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(set(body["learners"]), {"101", "102", "103"})
        self.assertEqual([row["risk"] for row in body["learners"].values()], ["at-risk", "need-attention", "on-track"])
        self.assertEqual(body["learners"]["101"]["programme"],
                         {"completed": 1, "total": 900, "percent": 0.11, "status": "ready"})
        self.assertEqual(set(body["learners"]["101"]), {"programme", "otjh", "attendance", "risk"})
        self.assertEqual(body['learners']['101']['otjh'], {'actual': 90, 'planned': 200, 'percent': 45})
        self.assertEqual(body['learners']['102']['otjh'], {'actual': 70, 'planned': 400, 'percent': 17.5})
        self.assertEqual(body['learners']['103']['otjh'], {'actual': 0, 'planned': 200, 'percent': 0})
        self.home_reader.assert_not_called()
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

    def test_missing_planned_hours_preserve_completed_hours_without_inventing_percentage(self):
        self.saved_hours[101] = {'completed_hours': 12.5, 'planned_hours': None}
        response, _, _ = self.call()
        rows = json.loads(response.content)['learners']
        self.assertEqual(rows['101']['otjh'], {'actual': 12.5, 'planned': None, 'percent': None})
        self.assertEqual(rows['102']['otjh']['percent'], 17.5)

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

    def test_summary_reads_saved_totals_without_catalogue_home_or_attendance(self):
        response, modules, hours = self.call(section='summary')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['learners']['101'], {
            'programme': None, 'attendance': None, 'risk': 'at-risk',
            'otjh': {'actual': 90, 'planned': 200, 'percent': 45},
        })
        self.model.all_learners.filter.return_value.only.assert_called_once_with('id', 'email', 'aptem_id', 'learner_type')
        modules.assert_not_called()
        hours.assert_not_called()
        self.home_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_programme_read_keeps_activity_calculation_without_loading_attendance(self):
        response, modules, _ = self.call(section='programme')
        self.assertEqual(json.loads(response.content)['learners']['101']['programme']['percent'], 0.11)
        self.assertEqual(modules.call_count, 3)
        self.home_reader.assert_not_called()
        self.attendance_reader.assert_not_called()

    def test_invalid_section_does_not_read_learner_data(self):
        response, modules, _ = self.call(section='invalid')
        self.assertEqual(response.status_code, 400)
        self.status_reader.assert_not_called()
        modules.assert_not_called()

    def test_saved_hours_preserve_zero_missing_and_above_plan(self):
        for actual, planned, percent in ((0, 100, 0), (125, 100, 125), (3, 0, None),
                                         (None, 100, None), (float('nan'), 100, None),
                                         (3, -1, None), (3, float('inf'), None)):
            with self.subTest(actual=actual, planned=planned):
                self.saved_hours[101] = {'completed_hours': actual, 'planned_hours': planned}
                response, _, _ = self.call(section='summary')
                value = json.loads(response.content)['learners']['101']['otjh']
                self.assertEqual(value['percent'], percent)
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
