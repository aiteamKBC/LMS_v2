from unittest import TestCase
from unittest.mock import patch

from learner_api import canonical_learning


class CanonicalMetricsBulkTests(TestCase):
    def run_bulk(self, enrolment_ids):
        owners = [
            {"id": 700 + index, "enrolment_id": enrolment_id, "aptem_id": 4000 + index, "learner_type": "apprenticeship"}
            for index, enrolment_id in enumerate(enrolment_ids)
        ]
        base = [
            {"learner_id": owner["id"], "payload": {"id": index + 1, "accepted": True, "actual_seconds": 3600, "completed": True},
             "ksbs": ["K1"], "segments": [], "sources": [], "historical_components": []}
            for index, owner in enumerate(owners)
        ]
        targets = [
            {"learner_id": owner["id"], "report_month": "2026-09", "target_hours": 10}
            for owner in owners
        ]
        aptem_by_enrolment = {owner["enrolment_id"]: owner["aptem_id"] for owner in owners}
        def load(sql, params):
            if 'FROM "Learner".learners l' in sql:
                return owners
            if 'FROM "Learner".learner_progress_entries p' in sql:
                learner_ids = set(params[0])
                return [item for item in base if item['learner_id'] in learner_ids]
            if 'learner_progress_ksbs' in sql:
                return [{"progress_id": item["payload"]["id"], "ksb_code": "K1"} for item in base]
            if 'learner_activity_reporting_segments' in sql or 'learner_activity_sources s' in sql or 'learner_progress_historical_components' in sql:
                return []
            if 'learning_reflection_submissions' in sql:
                return []
            if 'to_regclass' in sql:
                return [{"name": None}]
            if 'learner_monthly_targets' in sql:
                return targets
            raise AssertionError(sql)

        with patch.object(canonical_learning, "query", side_effect=load) as query:
            result = canonical_learning.metrics_bulk(aptem_by_enrolment)
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

    def test_query_count_is_constant_for_a_representative_caseload(self):
        one, one_count = self.run_bulk([10])
        many, many_count = self.run_bulk(list(range(10, 35)))
        self.assertEqual(one_count, 9)
        self.assertEqual(many_count, 13)
        self.assertEqual(len(one), 1)
        self.assertEqual(len(many), 25)
