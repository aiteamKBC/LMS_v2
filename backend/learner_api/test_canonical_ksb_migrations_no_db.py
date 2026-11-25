"""Render the real migration graph without opening any database connection."""
from django.test import SimpleTestCase, override_settings
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.operations.special import SeparateDatabaseAndState


@override_settings(MIGRATION_MODULES={})
class CanonicalKsbMigrationStateTests(SimpleTestCase):
    def test_runtime_columns_match_read_only_development_evidence(self):
        import json
        from pathlib import Path
        from .models import KsbStandardVersion, KsbDefinition, SourceActivityKsbMapping, LearnerActivityKsbMapping, LearnerProgressKsb
        from curriculum_api.models import ModuleAuthoringKsbMapping
        evidence = json.loads((Path(__file__).resolve().parents[2] / 'specs/ksb-canonical-architecture/database-evidence.json').read_text(encoding='utf-8'))
        for model in (KsbStandardVersion,KsbDefinition,SourceActivityKsbMapping,LearnerActivityKsbMapping,LearnerProgressKsb,ModuleAuthoringKsbMapping):
            name = model._meta.db_table.replace('"','')
            actual = {row[0] for row in evidence['tables'][name]['columns']}
            columns = {field.column for field in model._meta.concrete_fields if field.column}
            self.assertEqual(columns - actual, set(), model._meta.label)

    def test_graph_renders_canonical_models_and_both_mapping_owners(self):
        loader = MigrationLoader(None)
        loader.graph.validate_consistency()
        state = loader.project_state()
        state.apps.check_models_ready()
        mapping = state.apps.get_model('curriculum_api', 'ModuleAuthoringKsbMapping')
        self.assertEqual(mapping._meta.db_table, 'curriculum"."ksb_component_mappings')
        self.assertTrue(mapping._meta.get_field('component').null)
        self.assertTrue(mapping._meta.get_field('template_component').null)
        self.assertEqual(mapping._meta.get_field('standard_ksb').column, 'standard_ksb_id')
        self.assertNotIn(('learner_api', 'ksbprofileversion'), state.models)
        self.assertNotIn(('learner_api', 'learnerksbassignment'), state.models)
        progress = state.apps.get_model('learner_api', 'LearnerProgressKsb')
        self.assertTrue(progress._meta.get_field('mapping_status').generated)
        self.assertEqual(progress._meta.get_field('standard_ksb').column, 'standard_ksb_id')
        for name in ('WeekTemplate', 'WeekTemplateComponent'):
            fields = {f.name for f in state.apps.get_model('curriculum_api', name)._meta.fields}
            self.assertNotIn('ksb_mappings', fields)

    def test_state_changes_have_no_database_ddl_or_backfill(self):
        loader = MigrationLoader(None)
        for key in (('learner_api', '0032_canonical_ksb_state'),
                    ('curriculum_api', '0099_canonical_ksb_state')):
            migration = loader.disk_migrations[key]
            self.assertEqual(len(migration.operations), 2)
            operation = migration.operations[1]
            self.assertIsInstance(operation, SeparateDatabaseAndState)
            self.assertEqual(operation.database_operations, [])
