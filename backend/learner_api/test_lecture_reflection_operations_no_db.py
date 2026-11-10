"""Operation replay and snapshots require no database or external services."""
from copy import deepcopy
from unittest import TestCase
from .lecture_reflection_operations import preserve_time_history, replayed_receipt, requested_operation

ID = '00000000-0000-4000-8000-000000000001'


class ReflectionOperationTests(TestCase):
    def body(self):
        return {'additionalReflectionSeconds': 1200, 'reflectionTimeOperation': {'id': ID, 'choice': 'correct',
            'reason': 'The original writing time was incorrect.', 'expectedReflectionSeconds': 1800, 'expectedProgressEntryId': 10}}

    def receipt(self):
        return {'operationId': ID, 'choice': 'correct', 'inputSeconds': 1200, 'seconds': 1200,
            'progressEntryId': 11, 'countedSeconds': 8400, 'reason': self.body()['reflectionTimeOperation']['reason']}

    def test_replaying_an_older_action_returns_its_original_result_without_changing_current_history(self):
        stored = {'lectureReflectionTimeHistory': [self.receipt()], 'lectureReflectionTime': {
            'operationId': '00000000-0000-4000-8000-000000000002', 'progressEntryId': 12, 'seconds': 1800}}
        before = deepcopy(stored)
        self.assertEqual(replayed_receipt(self.body(), stored), self.receipt())
        self.assertEqual(stored, before)
        body = self.body(); body['additionalReflectionSeconds'] = 1800
        with self.assertRaisesRegex(ValueError, 'different values'):
            replayed_receipt(body, stored)

    def test_only_an_explicit_new_action_can_append_history_and_snapshot_the_original_document(self):
        old = {'lectureReflectionTime': {'progressEntryId': 10, 'seconds': 1800}, 'learningReflection': 'Original reflection',
            'evidenceFiles': ['synthetic.txt']}
        before = deepcopy(old)
        incoming = {'lectureReflectionTimeHistory': ['forged'], 'lectureReflectionAttempts': ['forged']}
        preserve_time_history(incoming, old, self.receipt(), status='submitted_for_tutor_review', feedback='Original feedback')
        self.assertEqual(len(incoming['lectureReflectionTimeHistory']), 2)
        snapshot = incoming['lectureReflectionAttempts'][0]
        self.assertEqual(snapshot['content']['learningReflection'], 'Original reflection')
        self.assertEqual(snapshot['content']['evidenceFiles'], ['synthetic.txt'])
        self.assertEqual(snapshot['coachFeedback'], 'Original feedback')
        self.assertEqual(old, before)

    def test_old_clients_and_repeated_drafts_cannot_erase_or_duplicate_history(self):
        stored = {'lectureReflectionTime': self.receipt(), 'lectureReflectionTimeHistory': [self.receipt()],
            'lectureReflectionAttempts': [{'status': 'submitted_for_tutor_review', 'content': {'learningReflection': 'Original'}}]}
        for _ in range(3):
            incoming = {}
            preserve_time_history(incoming, stored, self.receipt(), status='draft')
            self.assertEqual(incoming['lectureReflectionTimeHistory'], stored['lectureReflectionTimeHistory'])
            self.assertEqual(incoming['lectureReflectionAttempts'], stored['lectureReflectionAttempts'])

    def test_invalid_operation_cannot_be_treated_as_a_new_time_action(self):
        for changed in ({'id': 'bad'}, {'choice': 'unknown'}, {'expectedProgressEntryId': True}, {'expectedReflectionSeconds': -1}, {'reason': ''}):
            body = self.body(); body['reflectionTimeOperation'].update(changed)
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                requested_operation(body)

    def test_generic_manual_editor_cannot_replace_a_reflection_decision_and_its_lecture_baseline(self):
        from .manual_time_corrections import manual_record
        record = dict(id=11, submitted_at='2026-11-10T12:00:00Z', kind='component', component_link_source='direct',
            claimed_seconds=8400, time_tracking_source='lecture_reflection:input')
        self.assertFalse(manual_record(record))
        self.assertTrue(manual_record({**record, 'time_tracking_source': 'signed:input'}))
