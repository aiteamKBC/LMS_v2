"""Execute the real Django migration, including resumable failure paths."""
from importlib import import_module
import unittest
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, connections, transaction
from django.db.migrations.state import ProjectState

from learner_api.models import LearnerProfile, LearnerProgressEntry, LearnerQuizAnswer
from .models import QuizPackage, QuizQuestion


migration = import_module('quiz_api.migrations.0005_learner_question_foreign_key')


def execute(sql, params=(), alias='default'):
    with connections[alias].cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall() if cursor.description else []


def apply_migration():
    instance = migration.Migration('0005_learner_question_foreign_key', 'quiz_api')
    with connections['default'].schema_editor(atomic=instance.atomic) as editor:
        instance.apply(ProjectState(), editor)


@unittest.skipUnless(getattr(settings, 'QUIZ_HISTORY_POSTGRES_TESTS', False), 'Use the isolated PostgreSQL runner')
class QuestionForeignKeyMigrationTests(unittest.TestCase):
    def setUp(self):
        execute(f'ALTER TABLE {migration.SOURCE} DROP CONSTRAINT {migration.CONSTRAINT}')
        self.addCleanup(self.restore)
        self.quiz = QuizPackage.objects.create(title='Migration fixture')
        self.question = QuizQuestion.objects.create(quiz=self.quiz, question_text='Retained question')
        self.learner = LearnerProfile.objects.create(full_name='Synthetic migration learner',
            email=uuid4().hex+'@example.invalid', lifecycle_status='active', completed_hours=15)
        self.progress = LearnerProgressEntry.objects.create(learner=self.learner, entry_order=1,
            kind='quiz', quiz_ref=str(self.quiz.pk), attempt=2, grade=0.8, passed=True,
            achieved_score=8, total_score=10, verified_seconds=600, time_taken='00:10:00')
        self.answer = LearnerQuizAnswer.objects.create(progress=self.progress, position=1,
            question_ref=self.question.pk, is_correct=True, earned=1,
            result_snapshot={'questionText':'Retained question'})

    def restore(self):
        execute(f'ALTER TABLE {migration.SOURCE} DROP CONSTRAINT IF EXISTS {migration.CONSTRAINT}')
        apply_migration()

    def constraint(self):
        return execute('''SELECT oid,convalidated,confupdtype,confdeltype,condeferrable
            FROM pg_constraint WHERE conrelid=%s::regclass AND conname=%s''',
            [migration.SOURCE,migration.CONSTRAINT])

    def snapshot(self):
        return [list(model.objects.order_by().values()) for model in
                (QuizPackage,QuizQuestion,LearnerProfile,LearnerProgressEntry,LearnerQuizAnswer)]

    def test_installs_exact_validated_fk_without_row_or_index_changes(self):
        before = self.snapshot()
        indexes = execute("SELECT indexrelid FROM pg_index WHERE indrelid=%s::regclass ORDER BY indexrelid", [migration.SOURCE])
        apply_migration()
        self.assertEqual(self.constraint()[0][1:], (True,'r','r',False))
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(execute("SELECT indexrelid FROM pg_index WHERE indrelid=%s::regclass ORDER BY indexrelid", [migration.SOURCE]), indexes)
        # Both actions specified in the request are enforced by PostgreSQL.
        for sql in (f'DELETE FROM {migration.TARGET} WHERE id=%s',
                    f'UPDATE {migration.TARGET} SET id=id+1000000 WHERE id=%s'):
            with self.assertRaises(IntegrityError), transaction.atomic():
                execute(sql, [self.question.pk])

    def test_retry_preserves_existing_constraint_identity(self):
        apply_migration()
        before = self.constraint()
        apply_migration()
        self.assertEqual(self.constraint(), before)

    def test_orphans_abort_before_ddl_without_repairing_history(self):
        LearnerQuizAnswer.objects.filter(pk=self.answer.pk).update(question_ref=9223372036854775806)
        try:
            before = self.snapshot()
            with self.assertRaisesRegex(RuntimeError, 'orphan question references'):
                apply_migration()
            self.assertFalse(self.constraint())
            self.assertEqual(self.snapshot(), before)
        finally:
            LearnerQuizAnswer.objects.filter(pk=self.answer.pk).update(question_ref=self.question.pk)

    def test_different_named_definition_is_rejected_without_replacement(self):
        execute(f'''ALTER TABLE {migration.SOURCE} ADD CONSTRAINT {migration.CONSTRAINT}
            FOREIGN KEY(question_ref) REFERENCES {migration.TARGET}(id) ON DELETE CASCADE''')
        before = self.constraint()
        with self.assertRaisesRegex(RuntimeError, 'differs from the requested definition'):
            apply_migration()
        self.assertEqual(self.constraint(), before)

    def test_unvalidated_fk_enforces_new_writes_and_retry_resumes_validation(self):
        no_orphans = migration._no_orphans
        calls = 0
        def fail_validation(cursor):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError('Simulated validation interruption')
            return no_orphans(cursor)
        with patch.object(migration, '_no_orphans', side_effect=fail_validation):
            with self.assertRaisesRegex(RuntimeError, 'Simulated validation'):
                apply_migration()
        before = self.constraint()[0]
        self.assertFalse(before[1])
        with self.assertRaises(IntegrityError), transaction.atomic(using='enrolment'):
            LearnerQuizAnswer.objects.create(progress=self.progress, position=2, question_ref=9223372036854775806)
        apply_migration()
        self.assertEqual(self.constraint()[0], (before[0],True,'r','r',False))

    def test_short_lock_timeout_leaves_history_untouched(self):
        before = self.snapshot()
        with transaction.atomic(using='enrolment'):
            execute(f'LOCK TABLE {migration.SOURCE} IN ACCESS EXCLUSIVE MODE', alias='enrolment')
            with self.assertRaisesRegex(RuntimeError, 'lock/statement timeout'):
                apply_migration()
        self.assertFalse(self.constraint())
        self.assertEqual(self.snapshot(), before)

    def test_missing_index_aborts_without_building_a_blocking_duplicate(self):
        execute('DROP INDEX "Learner".learner_quiz_answers_question_idx')
        try:
            with self.assertRaisesRegex(RuntimeError, 'index is missing or invalid'):
                apply_migration()
            self.assertFalse(self.constraint())
        finally:
            execute(f'CREATE INDEX learner_quiz_answers_question_idx ON {migration.SOURCE}(question_ref)')

    def test_wrong_column_type_aborts_without_changes(self):
        execute(f'ALTER TABLE {migration.SOURCE} ALTER COLUMN question_ref TYPE integer')
        try:
            with self.assertRaisesRegex(RuntimeError, 'expected BIGINT'):
                apply_migration()
            self.assertFalse(self.constraint())
        finally:
            execute(f'ALTER TABLE {migration.SOURCE} ALTER COLUMN question_ref TYPE bigint')

    def test_different_database_alias_is_rejected(self):
        other = dict(connections['enrolment'].settings_dict, NAME='not_the_curriculum_database')
        with patch.object(connections['enrolment'], 'settings_dict', other):
            with self.assertRaisesRegex(RuntimeError, 'same verified Development database'):
                apply_migration()
        self.assertFalse(self.constraint())
