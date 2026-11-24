"""Contract checks for the canonical relation's existing Learner/Coach consumers."""
from unittest.mock import patch
from django.test import SimpleTestCase
from . import canonical_learning as canonical
from .ksb_domain import point_counts_sql
from coach_api import otjh_ksb


class CanonicalKsbConsumerTests(SimpleTestCase):
    def test_source_history_does_not_award_official_points(self):
        from .dashboard_metrics import point_codes
        self.assertEqual(point_codes([
            {'code':'K1','resolutionStatus':'verified','standardKsbId':2},
            {'code':'K2','resolutionStatus':'unresolved'},
            {'code':'K3','resolutionStatus':'ambiguous_or_incompatible'},
            {'code':'K4','mapping_status':'verified','is_excluded':True},
        ]),{'K1'})

    def test_coach_delegates_to_the_same_canonical_points_query(self):
        rows = [{'code':'K1','description':'Official knowledge','evidenceCount':3,
                 'completed':1,'pointsAchieved':2}]
        with patch.object(canonical,'query',return_value=rows) as query, \
             patch('learner_api.progress_cache.value',side_effect=lambda sql,scope,owner,read:read()):
            self.assertEqual(otjh_ksb.read_ksb_rows(1),rows)
        query.assert_called_once_with(point_counts_sql(),[1])

    def test_separate_metrics_keep_accepted_points_without_requiring_completion(self):
        # Same three eligible activities used by the isolated PostgreSQL test:
        # started/accepted, completed/accepted, completed/unaccepted.
        records = [
            {'id':1,'accepted':True,'activity_status':'started','actual_seconds':0,'ksbs':['K1','K1']},
            {'id':2,'accepted':True,'activity_status':'completed','actual_seconds':0,'ksbs':['K1']},
            {'id':3,'accepted':False,'activity_status':'completed','actual_seconds':0,'ksbs':['K1']},
        ]
        result = canonical.metrics_from_records(records,{})['ksb']
        self.assertEqual((result['completed'],result['total'],result['percent']),(2,3,66.67))
        coach = otjh_ksb.project_ksbs([{'code':'K1','description':'Official knowledge',
            'evidenceCount':3,'completed':1,'pointsAchieved':2}])['rows'][0]
        self.assertEqual((coach['pointsAchieved'],coach['totalPoints'],coach['progressPercent']),
                         (result['completed'],result['total'],result['percent']))
        self.assertEqual(coach['completed'],1)

    def test_database_failure_is_not_an_empty_success(self):
        with patch.object(canonical,'query',side_effect=RuntimeError('synthetic read failure')), \
             patch('learner_api.progress_cache.value',side_effect=lambda sql,scope,owner,read:read()):
            with self.assertRaisesRegex(RuntimeError,'synthetic read failure'):
                otjh_ksb.read_ksb_rows(1)
