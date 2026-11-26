"""Historical reference capture with synthetic identities and mocked I/O."""
from copy import deepcopy
import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import capture_legacy_course_progress as capture
from learner_api.legacy_course_progress import public_reference


class HistoricalReferenceTests(unittest.TestCase):
    def setUp(self):
        self.owner = {'id': 7, 'enrolment_id': 11, 'source_learner_id': '22'}
        self.member = {'id': 1, 'enrolment_id': 11, 'source_learner_id': '22',
                       'source_course_ref': '50', 'source_payload': {'unrelated': 'preserved'}}
        self.at = '2026-10-30T12:00:00+00:00'

    def snapshot(self, percent=92):
        return capture.plan_references(self.owner, [self.member], {'50': percent}, self.at)[0][1]

    def test_zero_and_full_reference_preserve_source_percent_and_leave_inputs_unchanged(self):
        before = deepcopy((self.owner, self.member))
        for percent in (0, 11, 92, 97, 100):
            snapshot = self.snapshot(percent)
            expected = {'percent': percent, 'capturedAt': self.at}
            self.assertEqual(public_reference(snapshot, self.owner, self.member), expected)
            self.assertEqual(public_reference(json.dumps(snapshot), self.owner, self.member), expected)
        self.assertEqual((self.owner, self.member), before)

    def test_reference_cannot_cross_learner_enrolment_account_or_course(self):
        snapshot = self.snapshot()
        for key in ('learner_id', 'enrolment_id', 'source_learner_id', 'source_course_ref'):
            with self.subTest(key=key):
                self.assertIsNone(public_reference({**snapshot, key: '999'}, self.owner, self.member))

    def test_invalid_references_are_unavailable_never_zero_or_completion(self):
        snapshot = self.snapshot()
        for changes in ({'percent': True}, {'percent': -1}, {'percent': 101}, {'percent': float('nan')},
                        {'percent': '92'}, {'captured_at': None}, {'captured_at': '2026-10-30'},
                        {'basis': 'calculated'}, {'version': 2}):
            with self.subTest(changes=changes):
                self.assertIsNone(public_reference({**snapshot, **changes}, self.owner, self.member))
        for value in (None, [], 'broken', 'null'):
            self.assertIsNone(public_reference(value, self.owner, self.member))

    def test_existing_snapshot_is_immutable_when_live_progress_changes(self):
        snapshot = self.snapshot()
        member = {**self.member, 'source_payload': {'legacy_course_progress': snapshot}}
        self.assertEqual(capture.plan_references(self.owner, [member], {'50': 100}, self.at), [])
        self.assertEqual(member['source_payload']['legacy_course_progress']['percent'], 92)

    def test_source_identity_and_percentage_are_verified_before_planning(self):
        source = {'user_id': 22, 'email': 'source@example.test', 'course_id': 50, 'progress': 92}
        self.assertEqual(capture.verified_percentages([source], 22, 'SOURCE@example.test'), {'50': 92})
        for changes in ({'user_id': 23}, {'email': 'other@example.test'}, {'progress': None},
                        {'progress': True}, {'progress': 101}, {'course_id': 0}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                capture.verified_percentages([{**source, **changes}], 22, 'source@example.test')
        with self.assertRaises(ValueError):
            capture.verified_percentages([source, source], 22, 'source@example.test')
        with self.assertRaises(ValueError):
            capture.plan_references(self.owner, [{**self.member, 'enrolment_id': 12}], {'50': 92}, self.at)
        with self.assertRaises(ValueError):
            capture.plan_references(self.owner, [self.member], {}, self.at)

    def test_apply_only_adds_owned_membership_metadata_and_verifies_each_write(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.info = SimpleNamespace(host='isolated.example.test', dbname='synthetic')
        cursor = connection.cursor.return_value
        cursor.execute.return_value = cursor
        cursor.fetchall.side_effect = [[{**self.owner, 'source_email': 'source@example.test'}], [self.member]]
        def saved():
            return {'snapshot': cursor.execute.call_args.args[1][0].obj}
        cursor.fetchone.side_effect = saved
        target = capture.hashlib.sha256(b'isolated.example.test/synthetic').hexdigest()
        with patch.object(capture.psycopg, 'connect', return_value=connection), \
             patch.object(capture, 'database_url', return_value='synthetic'), \
             patch.object(capture, 'fetch_percentages', return_value={'50': 92}):
            result = capture.run(11, apply=True, expected_target=target)
        updates = [call.args for call in cursor.execute.call_args_list if call.args[0].startswith('UPDATE')]
        self.assertEqual(result['references_added'], 1)
        self.assertEqual(len(updates), 1)
        self.assertIn('learner_source_course_memberships', updates[0][0])
        self.assertIn('learner_id=%s AND enrolment_id=%s', updates[0][0])
        self.assertEqual(updates[0][1][1:], [1, 7, 11])
        self.assertIn('RETURNING', updates[0][0])


if __name__ == '__main__':
    unittest.main()
