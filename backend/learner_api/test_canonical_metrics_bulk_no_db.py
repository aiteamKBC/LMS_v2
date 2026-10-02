from unittest import TestCase
from unittest.mock import patch

from learner_api import canonical_learning, current_learning


class CanonicalMetricsBulkTests(TestCase):
    def run_bulk(self, enrolment_ids, source_payload=None, *, learner_workspace=False,
                 programme_plan=576, source_completed=False, include_ksb_points=False):
        owners = [
            {"id": 700 + index, "enrolment_id": enrolment_id, "aptem_id": 4000 + index,
             "learner_type": "apprenticeship", "email": f"learner-{index}@example.test",
             "account_record_id": enrolment_id, "account_email": f"learner-{index}@example.test",
             "account_aptem_id": 4000 + index, "programme_id": 1,
             "programme_planned_hours": programme_plan}
            for index, enrolment_id in enumerate(enrolment_ids)
        ]
        base = [
            {"owner_id": owner["id"], "id": index + 1, "accepted": True,
             "actual_seconds": 3600, "completed": True, "source_payload": source_payload or {}}
            for index, owner in enumerate(owners)
        ]
        if source_completed:
            for item in base:
                item.update(accepted=False, completed=False, actual_seconds=0)
        targets = [
            {"learner_id": owner["id"], "report_month": "2026-09", "target_hours": 10}
            for owner in owners
        ]
        def load(sql, params):
            if 'FROM "Learner".learners l' in sql:
                return owners
            if 'FROM "Learner".learner_progress_entries p' in sql:
                learner_ids = set(params[0])
                return [item for item in base if item['owner_id'] in learner_ids]
            if 'learner_progress_ksbs' in sql:
                return [{"progress_id": item["id"], "ksb_code": "K1"} for item in base]
            if 'learner_activity_sources s' in sql:
                return [{"progress_id": item["id"], "source_id": item["id"],
                         "source_system": "old_lms", "completed": True} for item in base] if source_completed else []
            if 'learner_activity_reporting_segments' in sql or 'learner_progress_historical_components' in sql:
                return []
            if 'learning_reflection_submissions' in sql:
                return []
            if 'to_regclass' in sql:
                return [{"name": None}]
            if 'learner_monthly_targets' in sql:
                return targets
            raise AssertionError(sql)

        with patch.object(canonical_learning, "query", side_effect=load) as query, \
             patch.object(current_learning, "query", query):
            result = canonical_learning.metrics_bulk(enrolment_ids, learner_workspace=learner_workspace, include_ksb_points=include_ksb_points)
        return result, query.call_count

    def test_bulk_contract_matches_single_dashboard_calculator(self):
        result, count = self.run_bulk([10])
        expected = canonical_learning.metrics_from_records(
            [{"id": 1, "accepted": True, "actual_seconds": 3600, "completed": True,
              "ksbs": ["K1"], "segments": [], "sources": [], "historical_components": []}],
            {"2026-09": 10},
        )
        self.assertEqual(result[10], expected)
        self.assertEqual(count, 9)

    def test_list_source_payload_does_not_break_caseload_metrics(self):
        result, _ = self.run_bulk([10], ["synthetic-evidence-a", "synthetic-evidence-b"])
        self.assertEqual(result[10]["otjh"]["actual"], 1)

    def test_query_count_is_constant_for_a_representative_caseload(self):
        one, one_count = self.run_bulk([10])
        many, many_count = self.run_bulk(list(range(10, 35)))
        self.assertEqual(one_count, 9)
        self.assertEqual(many_count, 9)
        self.assertEqual(len(one), 1)
        self.assertEqual(len(many), 25)

    def test_workspace_bulk_uses_programme_plan_instead_of_monthly_targets(self):
        result, count = self.run_bulk([10, 11], learner_workspace=True)
        self.assertEqual(result[10]['otjh']['planned'], 576)
        self.assertEqual(result[11]['aptem_planned_total'], 576)
        self.assertEqual(count, 9)

    def test_workspace_plan_validation_matches_the_single_learner_reader(self):
        for value in (None, 'invalid', -1, float('inf'), float('nan'), 0, '576.12345'):
            with self.subTest(value=value):
                result, _ = self.run_bulk([10], learner_workspace=True, programme_plan=value)
                with patch.object(canonical_learning, 'profile', return_value={'programme_planned_hours': value}):
                    expected = canonical_learning.programme_planned_hours(10)
                self.assertEqual(result[10]['otjh']['planned'], expected)

    def test_workspace_bulk_preserves_completed_sources_excluded_from_hours(self):
        result, _ = self.run_bulk([10], learner_workspace=True, source_completed=True)
        self.assertEqual(result[10]['programme']['completed'], 1)
        self.assertEqual(result[10]['otjh']['actual'], 0)
        self.assertEqual(result[10]['ksb']['completed'], 0)


class CanonicalKsbPointTests(TestCase):
    def test_points_expand_the_exact_pairs_counted_by_the_headline(self):
        records = [
            {'id': 1, 'accepted': True, 'actual_seconds': 0, 'component_title': 'First activity',
             'ksbs': ['K1', 'K1', 'S1']},
            {'id': 2, 'accepted': False, 'completed': True, 'component_title': 'Second activity',
             'ksbs': ['K1']},
            {'id': 'reflection:3', 'accepted': True, 'actual_seconds': 0, 'ksbs': ['B1.1']},
            {'id': 4, 'accepted': True, 'actual_seconds': 0, 'ksbs': []},
        ]
        payload = canonical_learning.metrics_from_records(records, {}, include_ksb_points=True)
        points = payload['ksb']['points']
        self.assertEqual(len(points), payload['ksb']['total'])
        self.assertEqual(sum(p['completed'] for p in points), payload['ksb']['completed'])
        self.assertEqual([(p['activityId'], p['code']) for p in points],
                         [('1', 'K1'), ('1', 'S1'), ('2', 'K1'), ('reflection:3', 'B1.1')])
        self.assertFalse(points[2]['completed'])
        self.assertEqual(points[2]['title'], 'Second activity')
        self.assertIsNone(points[2]['completedAt'])
        self.assertNotIn('points', canonical_learning.metrics_from_records(records, {})['ksb'])

    def test_bulk_point_rows_are_scoped_to_the_verified_learner(self):
        result, count = CanonicalMetricsBulkTests().run_bulk([10, 11], learner_workspace=True, include_ksb_points=True)
        self.assertEqual(count, 9)
        self.assertEqual(result[10]['ksb']['points'][0]['activityId'], '1')
        self.assertEqual(result[11]['ksb']['points'][0]['activityId'], '2')
        for payload in result.values():
            self.assertEqual(len(payload['ksb']['points']), payload['ksb']['total'])
