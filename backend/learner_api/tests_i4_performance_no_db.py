from django.test import SimpleTestCase

from learner_api.assignment_topics import aggregate_statuses


class ReflectionStatusProjectionTests(SimpleTestCase):
    databases = set()

    def test_integer_history_count_preserves_existing_status_contract(self):
        legacy = aggregate_statuses([
            ("assignment", "A1", "rejected", [{"attempt": 1}, {"attempt": 2}]),
            ("assignment", "A1", "draft", []),
        ])
        projected = aggregate_statuses([
            ("assignment", "A1", "rejected", 2),
            ("assignment", "A1", "draft", 0),
        ])

        self.assertEqual(projected, legacy)
        self.assertEqual(projected, [{
            "activityType": "assignment",
            "activityId": "A1",
            "status": "rejected",
            "submissionCount": 3,
        }])

