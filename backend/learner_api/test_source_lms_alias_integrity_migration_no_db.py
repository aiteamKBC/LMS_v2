"""Database-free checks for the source LMS alias integrity migration."""
import importlib
import unittest


migration = importlib.import_module(
    'learner_api.migrations.0028_source_lms_alias_profile_aptem_integrity'
)


class SourceLmsAliasIntegrityMigrationTests(unittest.TestCase):
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
