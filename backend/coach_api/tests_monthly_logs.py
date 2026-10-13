"""Synthetic read-only contracts. SimpleTestCase forbids database access."""
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory

from learner_api import canonical_learning as canonical
from learner_api import monthly_logs as existing
from old_otjh.service import ServiceError
from . import monthly_logs as logs


class MonthlyLogsProjectionTests(SimpleTestCase):
    def setUp(self):
        self.learner = {'id': 7, 'name': 'Synthetic learner', 'programme': 'Programme',
                        '_canonical_profile': {'id': 70, 'enrolment_id': 7, 'programme_id': 'P'}}

    def project(self, count):
        activities = [{'month': f'2026-{index:02}', 'activities': 2, 'accepted_hours': 1.5}
                      for index in range(1, count + 1)]
        signs = [{'month': '2026-01', 'learner_signed': True, 'coach_signed': False}]
        with patch.object(logs, 'query', side_effect=[activities, signs]) as reads, \
             patch.object(canonical, 'targets_for', return_value={row['month']: 3 for row in activities}) as targets, \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 12, 10)), \
             patch.object(canonical, 'entries_for', side_effect=AssertionError('Heavy entries hydration')), \
             patch.object(canonical, 'rows_for', side_effect=AssertionError('Heavy document hydration')):
            result = logs.project_year(self.learner, 2026)
        self.assertEqual(reads.call_count + targets.call_count, 3)
        self.assertEqual(targets.call_args.args, (self.learner['_canonical_profile'],))
        for call in reads.call_args_list:
            self.assertEqual(call.args[1], [70])
            self.assertNotRegex(call.args[0].upper(), r'\b(INSERT|UPDATE|DELETE|CREATE)\b')
            self.assertIn('GROUP BY', call.args[0])
        return result

    def test_one_and_twelve_months_use_three_projection_reads(self):
        self.assertEqual(len(self.project(1)['months']), 1)
        self.assertEqual(len(self.project(12)['months']), 12)

    def test_compact_values_match_existing_month_and_metrics_rules(self):
        result = self.project(12)
        records = [{'id': index, 'actual_seconds': 2700, 'accepted': True, 'ksbs': []}
                   for index in range(24)]
        metrics = canonical.metrics_from_records(records, {f'2026-{i:02}': 3 for i in range(1, 13)})['otjh']
        self.assertEqual(result['summary']['acceptedOtjhHours'], metrics['completed_actual'])
        self.assertEqual(result['summary']['trainingPlanHours'], metrics['planned'])
        self.assertEqual(result['summary']['coachSignatures'], {'completed': 0, 'total': 11})
        self.assertTrue(result['months'][-1]['isOpen'])
        self.assertTrue(result['months'][0]['learnerSigned'])
        self.assertFalse(result['months'][0]['coachSigned'])
        self.assertEqual(set(result['months'][0]), {'month', 'activities', 'acceptedOtjhHours', 'targetHours',
                                                  'isOpen', 'learnerSigned', 'coachSigned'})

    def test_year_filter_preserves_programme_totals_and_hides_future_months(self):
        activities = [{'month': '2025-12', 'activities': 2, 'accepted_hours': 5},
                      {'month': '2026-01', 'activities': 1, 'accepted_hours': 2},
                      {'month': None, 'activities': 1, 'accepted_hours': 3}]
        with patch.object(logs, 'query', side_effect=[activities, []]), \
             patch.object(canonical, 'targets_for', return_value={'2025-12': 10, '2026-12': 20}), \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 8)):
            result = logs.project_year(self.learner, 2026)
        self.assertEqual([month['month'] for month in result['months']], ['2026-01'])
        self.assertEqual(result['months'][0]['targetHours'], None)
        self.assertEqual(result['years'], [2025, 2026])
        self.assertEqual(result['summary']['acceptedOtjhHours'], 10)
        self.assertEqual(result['summary']['trainingPlanHours'], 30)

    def test_empty_targets_remain_unavailable(self):
        with patch.object(logs, 'query', side_effect=[[], []]), patch.object(canonical, 'targets_for', return_value={}):
            self.assertIsNone(logs.project_year(self.learner, 2026)['summary']['trainingPlanHours'])

    def test_year_endpoint_uses_existing_ownership_gate_and_one_projection(self):
        request = RequestFactory().get('/coach_api/coach/monthly-logs/7?year=2026')
        with patch.object(logs, 'require_coach'), patch.object(existing, 'scope', return_value=(self.learner, 'coach')) as scope, \
             patch.object(logs, 'project_year', return_value={'months': []}) as project:
            response = unwrap(logs.learner_year)(request, 7)
        self.assertEqual(json.loads(response.content), {'months': []})
        scope.assert_called_once_with(request, 7)
        project.assert_called_once_with(self.learner, 2026)

    def test_invalid_year_and_forbidden_learner_do_not_read_projection(self):
        with patch.object(logs, 'require_coach'), patch.object(logs, 'project_year') as project:
            with self.assertRaises(ServiceError):
                unwrap(logs.learner_year)(RequestFactory().get('/?year=bad'), 7)
            with patch.object(existing, 'scope', side_effect=ServiceError('Not found', 'not_found', 404)):
                with self.assertRaises(ServiceError):
                    unwrap(logs.learner_year)(RequestFactory().get('/?year=2026'), 8)
            project.assert_not_called()

    def test_monitor_and_learner_cannot_read_coach_routes(self):
        request = SimpleNamespace(login_account=SimpleNamespace(role='learner', is_active=True, subject_type='learner'))
        with self.assertRaises(ServiceError):
            logs.require_coach(request)
        with patch.object(logs, 'coach_actor', return_value={'role': 'monitor'}):
            with self.assertRaises(ServiceError):
                logs.require_coach(request)

    def test_compact_list_does_not_load_any_learner_summary(self):
        request = RequestFactory().get('/coach_api/coach/monthly-logs/learners?viewAsCoach=selected@example.invalid')
        with patch.object(logs, 'require_coach', return_value={'role': 'admin', 'email': 'admin@example.invalid'}), \
             patch.object(existing.sources, 'learners', return_value=[{'id': 7, 'name': 'Synthetic learner', 'programme': 'P'}]) as read, \
             patch.object(logs, 'project_year', side_effect=AssertionError('N+1')):
            result = json.loads(unwrap(logs.learners)(request).content)
        read.assert_called_once_with('selected@example.invalid', '')
        self.assertEqual(set(result['learners'][0]), {'id', 'name', 'programme', 'initials'})

    def test_coach_and_admin_view_as_preserve_ownership_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            for role, email, view_as, allowed in (
                ('coach', 'owner@example.invalid', '', True),
                ('coach', 'other@example.invalid', '', False),
                ('admin', 'admin@example.invalid', 'owner@example.invalid', True),
                ('admin', 'admin@example.invalid', 'other@example.invalid', False),
            ):
                with self.subTest(kind=kind, role=role, allowed=allowed):
                    request = RequestFactory().get('/coach_api/coach/monthly-logs/7',
                        {'year': '2026', 'perspective': 'learner', 'viewAsCoach': view_as})
                    request.login_account = SimpleNamespace(role='admin' if role == 'admin' else 'staff',
                                                           email=email, is_active=True, subject_type='staff')
                    owner = {**self.learner['_canonical_profile'], 'name': 'Synthetic learner', 'programme': 'P',
                             'coach_email': 'owner@example.invalid', 'aptem_id': None, 'learner_type': kind}
                    with patch.object(logs, 'coach_actor', return_value={'role': role, 'email': email}), \
                         patch.object(existing.old, 'coach_actor', return_value={'role': role, 'email': email}), \
                         patch.object(canonical, 'require_profile', return_value=owner), \
                         patch.object(logs, 'project_year', return_value={}) as projection:
                        if allowed:
                            self.assertEqual(unwrap(logs.learner_year)(request, 7).status_code, 200)
                            projection.assert_called_once()
                        else:
                            with self.assertRaises(ServiceError):
                                unwrap(logs.learner_year)(request, 7)
                            projection.assert_not_called()
