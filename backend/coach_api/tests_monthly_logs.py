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
        self.enterContext(patch('learner_api.canonical_hours.full_hour_projection_ids', return_value=set()))
        self.enterContext(patch('learner_api.attendance_otjh.read_bulk', side_effect=lambda owners, read:
            {int(o['id']): {'lectures': [], 'protected': {}, 'frozen_rows': []} for o in owners}))
        self.learner = {'id': 7, 'name': 'Synthetic learner', 'programme': 'Programme',
                        '_canonical_profile': {'id': 70, 'enrolment_id': 7, 'programme_id': 'P'}}
        self.pending_read = self.enterContext(patch.object(logs, 'pending_hour_records', return_value={70: []}))
        self.attendance_read = self.enterContext(patch.object(existing, 'attendance_rows', return_value=[]))

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
        self.pending_read.assert_called_with([self.learner['_canonical_profile']])
        self.assertEqual(reads.call_count + targets.call_count, 3)
        self.assertEqual(targets.call_args.args, (self.learner['_canonical_profile'],))
        for call in reads.call_args_list:
            self.assertEqual(call.args[1], [70])
            self.assertNotRegex(call.args[0].upper(), r'\b(INSERT|UPDATE|DELETE|CREATE)\b')
            self.assertIn('GROUP BY', call.args[0])
        return result

    def test_one_and_twelve_months_use_three_projection_reads_and_one_supplement_read(self):
        self.assertEqual(len(self.project(1)['months']), 1)
        self.assertEqual(len(self.project(12)['months']), 12)
        self.assertEqual(self.pending_read.call_count, 2)

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

    def test_corrected_retakes_and_frozen_history_match_learner_months_and_coach_totals(self):
        from coach_api.otjh_ksb import read_hour_totals
        from learner_api.dashboard_tabs import monthly_hours

        # The canonical read has already reconciled the retake and preserved
        # the closed month's allocation. SQL alone still sees the old hour.
        records = [
            {'id': 1, 'reporting_month': '2026-09', 'accepted': True, 'actual_seconds': 7200},
            {'id': 2, 'reporting_month': '2026-10', 'accepted': True, 'actual_seconds': 6300},
            {'id': 'attendance:O1', 'reporting_month': '2026-10', 'accepted': True, 'actual_seconds': 9000},
            {'id': 3, 'reporting_month': '2026-10', 'accepted': False, 'actual_seconds': 3600},
            {'id': 4, 'reporting_month': None, 'accepted': True, 'actual_seconds': 900,
             'component_title': 'Undated activity'},
        ]
        targets = {'2026-09': 10, '2026-10': 10}
        def read(sql, params):
            self.assertEqual(params, [70])
            if 'learner_monthly_signatures' in sql:
                return [{'month': '2026-09', 'learner_signed': True, 'coach_signed': True}]
            return [{'month': '2026-10', 'activities': 1, 'accepted_hours': 1}]

        with patch('learner_api.canonical_hours.full_hour_projection_ids', return_value={70}), \
             patch('coach_api.otjh_ksb.full_hour_projection_ids', return_value={70}), \
             patch.object(canonical, 'entries_for', return_value=records), \
             patch.object(canonical, 'targets_for', return_value=targets), \
             patch.object(logs, 'query', side_effect=read), \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 28)):
            result = logs.project_year(self.learner, 2026)
            coach_totals = read_hour_totals(self.learner['_canonical_profile'])
            learner_months = monthly_hours(self.learner['_canonical_profile'], records, targets,
                                          current_month='2026-10')
        self.assertEqual(result['summary']['acceptedOtjhHours'], 6.5)
        self.assertEqual(result['summary']['acceptedOtjhHours'], sum(row['completed'] for row in coach_totals))
        self.assertEqual(result['summary']['acceptedOtjhHours'], learner_months['training_plan_totals']['accepted_hours'])
        self.assertEqual({row['month']: row['acceptedOtjhHours'] for row in result['months']},
                         {'2026-09': 2, '2026-10': 4.25})
        self.assertEqual(result['unallocatedActivities'], [
            {'id': 4, 'title': 'Undated activity', 'actual_hours': .25, 'actual_hours_recorded': True}])
        self.pending_read.assert_not_called()

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

    def test_unallocated_json_text_matches_decoded_rows_for_each_learner(self):
        # PostgreSQL's configured JSON text loader also applies to jsonb_agg.
        # Keep undated credit and known/unknown actual time exactly as stored.
        for owner_id, enrolment_id, kind in ((70, 7, 'commercial'), (80, 8, 'apprenticeship')):
            owner = {'id': owner_id, 'enrolment_id': enrolment_id, 'programme_id': 'P', 'learner_type': kind}
            learner = {**self.learner, 'id': enrolment_id, '_canonical_profile': owner}
            undated = [
                {'id': owner_id * 10, 'title': 'Synthetic undated activity',
                 'actual_hours': 1.25, 'actual_hours_recorded': True},
                {'id': owner_id * 10 + 1, 'title': 'Synthetic unknown time',
                 'actual_hours': 0, 'actual_hours_recorded': False},
            ]
            outputs = []
            for encoded in (False, True):
                with self.subTest(kind=kind, encoded=encoded):
                    activities = [
                        {'month': '', 'activities': 2, 'accepted_hours': 1.25,
                         'unallocated_activities': json.dumps(undated) if encoded else undated},
                        {'month': '2026-10', 'activities': 1, 'accepted_hours': 2,
                         'unallocated_activities': None},
                    ]
                    with patch.object(logs, 'query', side_effect=[activities, []]) as reads, \
                         patch.object(logs, 'pending_hour_records', return_value={owner_id: []}), \
                         patch.object(canonical, 'targets_for', return_value={'2026-10': 5}), \
                         patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 31)):
                        result = logs.project_year(learner, 2026)
                    self.assertEqual(result['unallocatedActivities'], undated)
                    self.assertEqual(result['summary']['acceptedOtjhHours'], 3.25)
                    self.assertEqual(result['summary']['trainingPlanHours'], 5)
                    self.assertEqual([row['month'] for row in result['months']], ['2026-10'])
                    self.assertEqual(result['months'][0]['acceptedOtjhHours'], 2)
                    for call in reads.call_args_list:
                        self.assertEqual(call.args[1], [owner_id])
                        self.assertNotRegex(call.args[0].upper(), r'\b(INSERT|UPDATE|DELETE|CREATE)\b')
                    outputs.append(result)
            self.assertEqual(outputs[0], outputs[1])

    def test_empty_unallocated_json_preserves_month_totals(self):
        for value in (None, [], '[]', 'null'):
            with self.subTest(value=value), \
                 patch.object(logs, 'query', side_effect=[[
                     {'month': '2026-10', 'activities': 1, 'accepted_hours': 2,
                      'unallocated_activities': value}], []]), \
                 patch.object(canonical, 'targets_for', return_value={}), \
                 patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 31)):
                result = logs.project_year(self.learner, 2026)
                self.assertEqual(result['unallocatedActivities'], [])
                self.assertEqual(result['summary']['acceptedOtjhHours'], 2)
                self.assertIsNone(result['summary']['trainingPlanHours'])

    def test_unallocated_review_keeps_unknowns_and_excludes_already_projected_saves(self):
        unknown = {'id': 1, 'title': 'Undated activity', 'actual_hours': 0, 'actual_hours_recorded': False}
        native = {**unknown, 'id': 2, 'title': 'Current native save'}
        activities = [{'month': '', 'activities': 2, 'accepted_hours': 0,
                       'unallocated_activities': [unknown, native]}]
        with patch.object(logs, 'query', side_effect=[activities, []]), \
             patch.object(logs, 'pending_hour_records', return_value={70: [
                 {'id': 2, 'reporting_month': '2026-09', 'actual_seconds': 1800, 'accepted': True}]}), \
             patch.object(canonical, 'targets_for', return_value={}), \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 31)):
            result = logs.project_year(self.learner, 2026)
        self.assertEqual(result['unallocatedActivities'], [unknown])
        self.assertEqual([month['month'] for month in result['months']], ['2026-09'])
        self.assertEqual(result['summary']['acceptedOtjhHours'], .5)

    def test_supplement_keeps_native_counts_and_excludes_native_extra_reflection_rows(self):
        records = [
            {'id': 2, 'reporting_month': '2026-10', 'actual_seconds': 900, 'accepted': True},
        ]
        with patch.object(logs, 'query', side_effect=[[{'month': '2026-10', 'activities': 3, 'accepted_hours': 1}], []]), \
             patch.object(logs, 'pending_hour_records', return_value={70: records}), \
             patch.object(canonical, 'targets_for', return_value={'2026-10': 10}), \
             patch.object(logs.timezone, 'localdate', return_value=date(2026, 10, 28)):
            result = logs.project_year(self.learner, 2026)
        self.assertEqual(result['summary']['acceptedOtjhHours'], 1.25)
        self.assertEqual(result['months'][0]['acceptedOtjhHours'], 1.25)
        self.assertEqual(result['months'][0]['activities'], 3)
        self.assertEqual(result['summary']['trainingPlanHours'], 10)

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
