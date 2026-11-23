"""Attempt retries, history ownership and archive-safe completion without DB I/O."""
from contextlib import contextmanager, nullcontext
from itertools import cycle
from unittest import TestCase
from unittest.mock import MagicMock, patch

from . import free_course_attempts as attempts


@contextmanager
def empty_attempt_storage():
    """Existing endpoint tests exercise the real save flow with an empty attempt store."""
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.side_effect = cycle([(501,), ('COMP',), None])
    with patch.object(attempts, 'connections', {'enrolment': connection}), \
         patch.object(attempts.transaction, 'atomic', side_effect=lambda **_: nullcontext()):
        yield cursor


class FreeCourseAttemptTests(TestCase):
    result = {'componentId':'COMP','grade':100,'passed':True,'passingGrade':80,'breakdown':[]}

    def call(self, cursor, *, passed=True):
        return attempts.save(501,'FREE','COMP','a5388485-1e31-424b-b59c-d02de33cf2ef',
                             {'id':7},{'1':11},dict(self.result,passed=passed))

    def test_canonical_attempt_is_saved_without_legacy_identity_or_hours(self):
        with empty_attempt_storage() as cursor, patch.object(attempts,'save_completion',return_value=True) as completion:
            self.assertTrue(self.call(cursor)['passed'])
        sql = '\n'.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('free_component_ref,source_activity_snapshot',sql)
        self.assertNotIn('learner_progress_entries',sql)
        insert = next(call for call in cursor.execute.call_args_list if 'INSERT' in call.args[0])
        self.assertNotIn('group_id',insert.args[0])
        self.assertEqual(insert.args[1][1:3],[501,'COMP'])
        completion.assert_called_once()

    def test_retry_returns_original_saved_score_without_regrading_writes(self):
        with empty_attempt_storage() as cursor, patch.object(attempts,'save_completion') as completion:
            cursor.fetchone.side_effect = [(501,),('COMP',),(501,'COMP',{'1':11},{'freeCourseResult':self.result},'2026-11-22')]
            self.assertEqual(self.call(cursor),self.result)
        completion.assert_not_called()
        self.assertFalse(any('INSERT' in call.args[0] for call in cursor.execute.call_args_list))

    def test_reused_attempt_id_cannot_overwrite_another_owner_or_answers(self):
        for owner, answers in ((502,{'1':11}),(501,{'1':12})):
            with empty_attempt_storage() as cursor, patch.object(attempts,'save_completion') as completion:
                cursor.fetchone.side_effect = [(501,),('COMP',),(owner,'COMP',answers,{'freeCourseResult':self.result},'2026-11-22')]
                with self.assertRaises(ValueError): self.call(cursor)
            completion.assert_not_called()

    def test_revoked_assignment_blocks_even_a_retry(self):
        with empty_attempt_storage() as cursor:
            cursor.fetchone.side_effect = [(501,),None]
            with self.assertRaises(LookupError): self.call(cursor)
        self.assertFalse(any('INSERT' in call.args[0] for call in cursor.execute.call_args_list))

    def test_withdrawn_learner_is_rechecked_under_lock_before_any_attempt(self):
        with empty_attempt_storage() as cursor, patch.object(attempts, 'save_completion') as completion:
            cursor.fetchone.side_effect = [None]
            with self.assertRaises(LookupError):
                self.call(cursor)
        completion.assert_not_called()
        sql = cursor.execute.call_args.args[0]
        self.assertIn('FOR UPDATE', sql)
        self.assertIn("coalesce(lifecycle_status,'')", sql)
        self.assertIn("coalesce(programme_status,'')", sql)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_archived_completion_failure_propagates_out_of_transaction(self):
        with empty_attempt_storage() as cursor, patch.object(attempts,'save_completion',return_value=False):
            with self.assertRaises(LookupError): self.call(cursor)

    def test_failed_attempt_preserves_score_without_writing_completion(self):
        with empty_attempt_storage() as cursor, patch.object(attempts,'save_completion') as completion:
            self.assertFalse(self.call(cursor,passed=False)['passed'])
        completion.assert_not_called()
        self.assertTrue(any('INSERT' in call.args[0] for call in cursor.execute.call_args_list))

    def test_compatibility_submission_key_is_stable_and_owner_scoped(self):
        key = attempts.submission_id(None,501,'COMP',7,{'1':11})
        self.assertEqual(key,attempts.submission_id(None,501,'COMP',7,{'1':11}))
        self.assertNotEqual(key,attempts.submission_id(None,502,'COMP',7,{'1':11}))
        with self.assertRaises(ValueError): attempts.submission_id('invalid',501,'COMP',7,{})
