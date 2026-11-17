import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views
from curriculum_api import learner_assignments
from curriculum_api.learner_impact_summary import module_progress_dialog_summary


class ModuleProgressDialogSummaryTests(SimpleTestCase):
    def test_keeps_the_dialog_totals_but_drops_per_component_and_raw_source_rows(self):
        payload = {
            'scope': 'module', 'identifier': 'MOD-1', 'assignedLearners': [{'id': 1}],
            'assignedLearnerCount': 1, 'learnerKsbConsumption': [{'learnerId': 1}],
            'otjhAchievement': {'learners': []}, 'ksbAchievement': {},
            'moduleProgressBasis': 'current_activities',
            'activityLogProgress': {'learners': [], 'completedActivities': 0, 'totalActivities': 0, 'earlierRecords': 0},
            'activityLogOtjh': {'learners': [], 'achievedTotal': 0, 'plannedTotal': 0, 'source': 'Activity Log'},
            'learnerActivityPlan': [{'learnerId': 1, 'componentId': 'C-1'}],
            'learnerActivities': [{'learnerId': 1, 'progressId': 99}],
            'consumptionSources': {'progress': [{'progressId': 99}]},
            'coverage': {'items': [{'code': 'K1'}]},
        }

        summary = module_progress_dialog_summary(payload)

        self.assertEqual(summary['view'], 'module_progress_dialog')
        self.assertEqual(summary['activityLogProgress'], payload['activityLogProgress'])
        self.assertNotIn('learnerActivityPlan', summary)
        self.assertNotIn('learnerActivities', summary)
        self.assertNotIn('consumptionSources', summary)
        self.assertNotIn('coverage', summary)

    def test_module_endpoint_returns_the_compact_view_only_after_calculating_totals(self):
        payload = {
            'scope': 'module', 'identifier': 'MOD-1', 'assignedLearners': [],
            'assignedLearnerCount': 0, 'learnerKsbConsumption': [],
            'otjhAchievement': {'learners': []}, 'ksbAchievement': {},
            'activityLogProgress': {'learners': [], 'completedActivities': 0, 'totalActivities': 0, 'earlierRecords': 0},
            'activityLogOtjh': {'learners': [], 'achievedTotal': 0, 'plannedTotal': 0, 'source': 'Activity Log'},
            'learnerActivityPlan': [{'learnerId': 1, 'componentId': 'C-1'}],
            'consumptionSources': {'progress': [{'progressId': 99}]},
        }
        request = RequestFactory().get('/x', {'moduleProgress': '1', 'view': 'summary'})
        with mock.patch.object(views, 'scope_learner_ksb_impact_payload', return_value=(payload, None)), \
             mock.patch('curriculum_api.learner_activity_status.enrich') as enrich:
            response = views.curriculum_module_learner_ksb_impact(request, 'MOD-1')

        body = json.loads(response.content)
        enrich.assert_called_once_with(payload, None)
        self.assertEqual(body['view'], 'module_progress_dialog')
        self.assertNotIn('learnerActivityPlan', body)
        self.assertNotIn('consumptionSources', body)

    def test_assigned_only_request_uses_the_compact_module_roster(self):
        target = {'id': 'MOD-1', 'name': 'Module', 'scope': 'module', 'programmeName': 'Programme', 'moduleIds': ['MOD-1']}
        compact = {'target': target, 'learners': [{'id': '7', 'assigned': True}], 'totals': {'learnerCount': 1, 'assignedCount': 1}}
        request = RequestFactory().get('/x', {'assignedOnly': '1'})
        with mock.patch.object(learner_assignments, '_target', return_value=target), \
             mock.patch.object(learner_assignments, '_module_assigned_payload', return_value=compact) as payload:
            response = learner_assignments._handle(request, 'module', 'MOD-1')

        payload.assert_called_once_with(target)
        self.assertEqual(json.loads(response.content), compact)
