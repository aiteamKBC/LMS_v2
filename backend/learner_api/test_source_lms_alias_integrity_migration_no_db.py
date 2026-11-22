"""Database-free checks for the source LMS alias integrity migration."""
import importlib
import unittest
from unittest.mock import MagicMock, patch


migration = importlib.import_module(
    'learner_api.migrations.0028_source_lms_alias_profile_aptem_integrity'
)


class SourceLmsAliasIntegrityMigrationTests(unittest.TestCase):
    def test_cleaned_database_validates_replacement_without_writes(self):
        editor = MagicMock()
        editor.connection.vendor = 'postgresql'
        cursor = editor.connection.cursor.return_value.__enter__.return_value
        for validated in (True, False):
            with self.subTest(validated=validated), patch.object(migration, '_relation', side_effect=[1, None, 2]):
                cursor.reset_mock()
                cursor.fetchone.return_value = (validated,)
                if validated:
                    migration.apply_schema(None, editor)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'lack validated'):
                        migration.apply_schema(None, editor)
                cursor.execute.assert_called_once()
                sql = cursor.execute.call_args.args[0]
                self.assertTrue(sql.startswith('SELECT EXISTS'))
                self.assertEqual(cursor.execute.call_args.args[1],
                                 ['"Last_audit".learner_lms_aliases', True, True, 'r'])
                self.assertIn('convalidated', sql)

    def test_replacement_fk_keeps_exact_identity_and_action_checks(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (True,)
        self.assertTrue(migration._has_equivalent_alias_fk(
            cursor, relation='"Last_audit".learner_lms_aliases',
            require_validated=True, update_action='r'))
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['"Last_audit".learner_lms_aliases', True, True, 'r'])
        for clause in (
            "con.conrelid=%s::regclass",
            "con.confrelid='\"Learner\".learners'::regclass",
            "con.contype='f'", "(NOT %s OR con.convalidated)",
            "con.conkey=ARRAY[", "con.confkey=ARRAY[",
            "attrelid=con.conrelid AND attname='learner_profile_id'",
            "attrelid=con.conrelid AND attname='aptem_id'",
            "attrelid=con.confrelid AND attname='id'",
            "attrelid=con.confrelid AND attname='aptem_id'",
            "con.confdeltype='r' AND con.confupdtype=%s",
        ):
            self.assertIn(clause, sql)

    def test_legacy_fk_still_requires_no_action_by_default(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (False,)
        self.assertFalse(migration._has_equivalent_alias_fk(cursor))
        self.assertEqual(cursor.execute.call_args.args[1],
                         ['"Learner".source_lms_learner_aliases', False, True, 'a'])

    def test_exact_constraints_and_actions(self):
        self.assertEqual(migration.PARENT_CONSTRAINT, 'learners_id_aptem_identity_uniq')
        self.assertEqual(migration.ALIAS_CONSTRAINT, 'source_alias_profile_aptem_fk')
        self.assertIn('UNIQUE (id, aptem_id)', migration.ADD_PARENT_SQL)
        self.assertIn('FOREIGN KEY (learner_profile_id, aptem_id)', migration.ADD_ALIAS_SQL)
        self.assertIn('REFERENCES "Learner".learners (id, aptem_id)', migration.ADD_ALIAS_SQL)
        self.assertIn('ON DELETE RESTRICT ON UPDATE NO ACTION', migration.ADD_ALIAS_SQL)
        self.assertIn('NOT VALID', migration.ADD_ALIAS_SQL)
        self.assertIn('VALIDATE CONSTRAINT source_alias_profile_aptem_fk', migration.VALIDATE_ALIAS_SQL)

    def test_migration_does_not_replace_existing_alias_guards(self):
        sql = migration.ADD_PARENT_SQL + migration.ADD_ALIAS_SQL + migration.VALIDATE_ALIAS_SQL
        self.assertNotIn('source_alias_canonical_fk', sql)
        self.assertNotIn('source_alias_learner_profile_fk', sql)
        self.assertNotIn('source_alias_one_primary_uniq', sql)

    def test_dependency_preserves_chain(self):
        self.assertEqual(
            migration.Migration.dependencies,
            [('learner_api', '0027_free_course_progress_state')],
        )


if __name__ == '__main__':
    unittest.main()
