"""Contract checks for the canonical relation's existing Learner/Coach consumers."""
from unittest.mock import patch
from django.test import SimpleTestCase
from . import canonical_learning as canonical
from .ksb_domain import official_progress_relation, point_counts_sql
from coach_api import otjh_ksb


class CanonicalKsbConsumerTests(SimpleTestCase):
    def test_scoped_relation_starts_with_the_owned_progress_cte_and_keeps_rules(self):
        default = official_progress_relation()
        scoped = official_progress_relation(progress_relation='canonical')

        self.assertIn('FROM "Learner".ksb_learner_progress k', default)
        self.assertIn('JOIN "Learner".learner_progress_entries entry ON entry.id=k.progress_id', default)
        self.assertIn('AND entry.deleted_at IS NULL', default)
        self.assertIn('FROM canonical entry', scoped)
        self.assertIn('JOIN "Learner".ksb_learner_progress k ON k.progress_id=entry.id', scoped)
        self.assertNotIn('learner_progress_entries entry', scoped)
        self.assertNotIn('entry.deleted_at', scoped)
        for invariant in (
            'JOIN "Learner".learners owner ON owner.id=entry.learner_id',
            'd.standard_ref=version.standard_ref',
            'd.standard_version=version.standard_version',
            "k.is_excluded=false AND k.mapping_status='verified'",
            'owner.standard_ref=programme.standard_ref',
        ):
            self.assertIn(invariant, default)
            self.assertIn(invariant, scoped)

    def test_scoped_relation_name_is_not_an_open_sql_parameter(self):
        with self.assertRaisesMessage(ValueError, 'Unsupported progress relation'):
            official_progress_relation(progress_relation='untrusted_relation')

    def test_entries_scope_ksbs_before_the_large_relationship(self):
        owner = {'id': 407, 'enrolment_id': 285, 'progress_transfer_active': False}
        with patch.object(canonical, 'query', return_value=[]) as query, \
             patch.object(canonical, 'current_records', return_value=[]):
            self.assertEqual(canonical.entries_for(owner, lineage_only=True), [])
        sql, params = next(
            call.args for call in query.call_args_list
            if call.args[0].lstrip().startswith('WITH canonical AS')
        )
        self.assertEqual(params, [407])
        self.assertIn('FROM canonical entry', sql)
        self.assertNotIn('JOIN canonical p ON p.id=k.progress_id', sql)
        self.assertNotIn('FROM "Learner".learner_progress_entries entry', sql)

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
