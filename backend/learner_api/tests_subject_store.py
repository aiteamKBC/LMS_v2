"""Course-scoped attempts must never complete a reused activity elsewhere."""
from contextlib import nullcontext
from copy import deepcopy
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import subject_store


class SubjectAttemptScopeTests(SimpleTestCase):
    def test_readiness_depends_only_on_the_attempt_relation(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (subject_store.ATTEMPTS,)

        self.assertTrue(subject_store.ready(cursor))

        cursor.execute.assert_called_once_with(
            'SELECT to_regclass(%s)', [subject_store.ATTEMPTS],
        )
        self.assertNotIn('subject_covers', cursor.execute.call_args.args[0])

    def test_reused_activity_keeps_independent_completion_scores_and_counts(self):
        items = [dict(group_id=group, source_activity_id=10, completed=False,
                      quiz_score=None, quiz_maximum_score=None) for group in (1, 2)]
        progress = [dict(group_id=1, activity_id=10, completed=True, best_percent=90, attempt_count=2)]
        first, second = subject_store.overlay_progress(deepcopy(items), progress)
        self.assertTrue(first['completed'])
        self.assertEqual(first['best_score_percent'], 90)
        self.assertEqual(first['new_attempt_count'], 2)
        self.assertFalse(second['completed'])
        self.assertIsNone(second['best_score_percent'])
        self.assertEqual(second['new_attempt_count'], 0)

    def test_unscoped_attempt_cannot_replace_historical_completion(self):
        item = dict(group_id=2, source_activity_id=10, completed=True,
                    quiz_score=8, quiz_maximum_score=10)
        result = subject_store.overlay_progress([item], [dict(activity_id=10, completed=True, best_percent=100)])[0]
        self.assertTrue(result['completed'])
        self.assertEqual(result['best_score_percent'], 80)
        self.assertEqual(result['new_attempt_count'], 0)

    def test_history_query_requires_the_requested_course_and_learner(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(subject_store, 'connections', {'enrolment': connection}), patch.object(subject_store, 'ready', return_value=True):
            subject_store.state(132, 4176, 10, group_id=2)
        sql, values = cursor.execute.call_args_list[1].args
        self.assertIn('group_id=%s AND activity_id=%s', sql)
        self.assertEqual(values, [132, 4176, 2, 10, 'material'])
        self.assertIn('GROUP BY group_id, activity_id', cursor.execute.call_args_list[0].args[0])
        self.assertFalse(any('subject_covers' in call.args[0] for call in cursor.execute.call_args_list))

    def test_history_without_course_is_not_returned(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(subject_store, 'connections', {'enrolment': connection}), patch.object(subject_store, 'ready', return_value=True):
            result = subject_store.state(132, 4176, 10)
        self.assertEqual(result['history'], [])
        self.assertEqual(result['covers'], {})
        self.assertEqual(cursor.execute.call_count, 1)

    def test_attempt_start_and_finish_work_without_a_cover_relation(self):
        cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value = nullcontext(cursor)
        definition = {'title': 'Synthetic activity', 'quiz': None, 'has_reading': False,
                      'available': True, 'catalogue_kind': 'material'}
        with patch.object(subject_store, 'connections', {'enrolment': connection}), \
             patch('learner_api.progress_transfer_store.lock_learner',
                   side_effect=lambda _: nullcontext(cursor)), \
             patch('learner_api.progress_transfer_store.assert_legacy_writable'), \
             patch('learner_api.subject_timing.completion_time', return_value=None):
            cursor.fetchone.return_value = (subject_store.ATTEMPTS,)
            attempt_id = subject_store.start(132, 4176, 50, 10, definition)
            self.assertIn('INSERT INTO "Learner".subject_activity_attempts',
                          cursor.execute.call_args_list[-1].args[0])

            cursor.reset_mock()
            cursor.fetchone.side_effect = [
                (subject_store.ATTEMPTS,),
                (definition, None, None, None, False),
            ]
            result = subject_store.finish(132, 4176, 50, 10, attempt_id, {}, True)

        self.assertTrue(result['completed'])
        sql = '\n'.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('UPDATE "Learner".subject_activity_attempts', sql)
        self.assertNotIn('subject_covers', sql)
