from copy import deepcopy
from unittest import TestCase
from group_previous_learning_display import group_payload


class DisplayGroupTests(TestCase):
    def test_preserves_all_unrelated_payload_and_does_not_claim_equivalence(self):
        payload = {'source_learner_id': '3', 'history': [1, 2]}
        before = deepcopy(payload)
        updated = group_payload(payload, 'M1', [{'moduleId': 'M1'}])
        self.assertEqual(payload, before)
        self.assertEqual(updated['history'], before['history'])
        self.assertIs(updated['learning_display_group']['completion_equivalence'], False)

    def test_unassigned_module_is_rejected(self):
        with self.assertRaises(ValueError):
            group_payload({}, 'M2', [{'moduleId': 'M1'}])

    def test_idempotent_and_conflicting_group_cannot_be_overwritten(self):
        payload = group_payload({}, 'M1', [{'moduleId': 'M1'}])
        self.assertEqual(group_payload(payload, 'M1', '[{"moduleId":"M1"}]'), payload)
        with self.assertRaises(ValueError):
            group_payload(payload, 'M2', [{'moduleId': 'M2'}])

    def test_invalid_payload_is_not_cleared(self):
        with self.assertRaises(ValueError):
            group_payload([], 'M1', [{'moduleId': 'M1'}])
