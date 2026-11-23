"""Exercise installed Django's disk loader/executor without a database connection."""
import importlib
import itertools
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.test import override_settings


NAMES = (
    '0092_reconcile_development_video_capture',
    '0093_baseline_independent_free_course_storage',
    '0094_baseline_completed_free_course_cutover',
    '0095_baseline_attendance_provenance',
    '0096_preserve_qr_delete_restrict',
    '0097_baseline_free_course_metadata',
)
TARGET = ('learner_api', '0030_canonical_free_course_attempts')
MERGES = (
    ('curriculum_api', '0098_merge_reconciled_curriculum_heads'),
    ('engagement_api', '0015_merge_engagement_heads'),
)


def modules():
    return [importlib.import_module('curriculum_api.migrations.' + name) for name in NAMES]


def load(applied=None, replacements=True):
    # Only the recorder's I/O is mocked: Django imports the actual disk files,
    # resolves/replaces dependencies, and constructs the real migration graph.
    with override_settings(MIGRATION_MODULES={}):
        if applied is None:
            return MigrationLoader(None, replace_migrations=replacements)
        with patch.object(MigrationRecorder, 'applied_migrations', return_value=dict.fromkeys(applied)):
            return MigrationLoader(SimpleNamespace(alias='default'), replace_migrations=replacements)


def editor_for(module, rows=None, vendor='postgresql', alias='default'):
    editor = MagicMock()
    editor.connection.vendor = vendor
    editor.connection.alias = alias
    cursor = editor.connection.cursor.return_value.__enter__.return_value
    cursor.fetchall.side_effect = rows if rows is not None else [check[3] for check in module.CHECKS]
    return editor, cursor


class ReconciliationGraphTests(TestCase):
    def test_disk_graph_has_no_conflicts_and_excludes_retired_operations(self):
        loader = load()
        self.assertEqual(loader.detect_conflicts(), {})
        plan = loader.graph.forwards_plan(TARGET)
        for module in modules():
            self.assertIn(('curriculum_api', module.__name__.rsplit('.', 1)[1]), plan)
            self.assertNotIn(module.Migration.replaces[0], plan)
        self.assertTrue(set(MERGES).isdisjoint(plan))
        self.assertNotIn(('curriculum_api', '0079_qr_attendance') , loader.applied_migrations)
        self.assertNotIn(('curriculum_api', '0091_curriculum_video_source'), plan)
        self.assertNotIn(('curriculum_api', '0085_drop_modules_weeks_number'), plan)

    def test_target_and_full_model_states_match_original_graph(self):
        original, replaced = load(replacements=False), load()
        self.assertEqual(original.project_state([TARGET]).models, replaced.project_state([TARGET]).models)
        self.assertEqual(original.project_state().models, replaced.project_state().models)
        state = replaced.project_state([TARGET])
        video = state.apps.get_model('curriculum_api', 'CurriculumVideoChange')
        self.assertEqual(video._meta.get_field('target_id').max_length, 128)
        register = state.apps.get_model('curriculum_api', 'LiveSessionLearnerAttendance')
        self.assertTrue(register._meta.get_field('qr_attendance_id').null)
        self.assertEqual(register._meta.get_field('attendance_basis').default, 'teams')

    def test_all_64_original_history_combinations_select_single_replacements(self):
        originals = [m.Migration.replaces[0] for m in modules()]
        for flags in itertools.product((False, True), repeat=6):
            with self.subTest(flags=flags):
                applied = [key for key, flag in zip(originals, flags) if flag]
                loader = load(applied)
                for name, old, flag in zip(NAMES, originals, flags):
                    new = ('curriculum_api', name)
                    self.assertIn(new, loader.graph.nodes)
                    self.assertNotIn(old, loader.graph.nodes)
                    self.assertEqual(new in loader.applied_migrations, flag)
        # These combinations test selection only, not valid ancestor histories.

    def test_original_applied_skips_validation_and_replacement_only_is_not_enough(self):
        loader = load()
        new = ('curriculum_api', NAMES[0])
        old = loader.disk_migrations[new].replaces[0]
        ancestors = set(loader.graph.forwards_plan(new)) - {new}
        loaded = load(ancestors | {old})
        executor = object.__new__(MigrationExecutor)
        executor.loader = loaded
        self.assertEqual(executor.migration_plan([new]), [])
        with patch.object(MigrationRecorder, 'applied_migrations', return_value=dict.fromkeys(ancestors | {old})):
            loaded.check_consistent_history(SimpleNamespace(alias='default'))
        self.assertNotIn(new, load({new}).applied_migrations)

    def test_executor_records_both_names_and_backfills_already_applied_replacement(self):
        executor = object.__new__(MigrationExecutor)
        executor.loader = load()
        executor.recorder = MagicMock()
        for name in NAMES:
            new = ('curriculum_api', name)
            old = executor.loader.disk_migrations[new].replaces[0]
            executor.recorder.reset_mock()
            executor.record_migration(*new)
            self.assertEqual([c.args for c in executor.recorder.record_applied.call_args_list], [old, new])
        originals = {m.Migration.replaces[0] for m in modules()}
        executor.recorder.reset_mock()
        executor.recorder.applied_migrations.return_value = dict.fromkeys(originals)
        executor.check_replacements()
        self.assertEqual({c.args for c in executor.recorder.record_applied.call_args_list},
                         {('curriculum_api', n) for n in NAMES})

    def test_actual_executor_validates_before_recording_and_never_executes_ddl(self):
        loader = load()
        for module, name in zip(modules(), NAMES):
            for valid in (True, False):
                with self.subTest(name=name, valid=valid):
                    executor = object.__new__(MigrationExecutor)
                    executor.loader = loader
                    executor.recorder = MagicMock()
                    executor.progress_callback = None
                    editor, cursor = editor_for(module, None if valid else [[] for _ in module.CHECKS])
                    editor.deferred_sql = []
                    editor.collect_sql = False
                    executor.connection = editor.connection
                    executor.connection.schema_editor.return_value.__enter__.return_value = editor
                    key = ('curriculum_api', name)
                    state = loader.project_state([key], at_end=False)
                    migration = loader.disk_migrations[key]
                    if valid:
                        executor.apply_migration(state, migration)
                        self.assertEqual([c.args for c in executor.recorder.record_applied.call_args_list],
                                         [migration.replaces[0], key])
                        self.assertEqual(cursor.execute.call_count, len(module.CHECKS))
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'Canonical baseline mismatch'):
                            executor.apply_migration(state, migration)
                        executor.recorder.record_applied.assert_not_called()
                    editor.execute.assert_not_called()

    def test_merge_operations_empty_but_targeting_merge_pulls_unrelated_ancestors(self):
        loader = load()
        for key in MERGES:
            self.assertEqual(loader.disk_migrations[key].operations, [])
        self.assertIn(('curriculum_api', '0091_curriculum_video_source'),
                      loader.graph.forwards_plan(MERGES[0]))
        self.assertIn(('engagement_api', '0014_feedback_email_ticket_close'),
                      loader.graph.forwards_plan(MERGES[1]))

    def test_fresh_loader_and_sql_collection_do_not_emit_historical_ddl(self):
        loader = load()
        self.assertEqual(loader.applied_migrations, {})
        for name in NAMES:
            migration = loader.disk_migrations[('curriculum_api', name)]
            editor = MagicMock(collect_sql=True)
            editor.collected_sql = []
            state = loader.project_state([('curriculum_api', name)], at_end=False)
            migration.apply(state, editor, collect_sql=True)
            editor.execute.assert_not_called()
            editor.connection.cursor.assert_not_called()
            self.assertTrue(all(line.startswith('--') for line in editor.collected_sql))
            self.assertFalse(migration.operations[0].reversible)


class ReconciliationValidatorTests(TestCase):
    def test_every_contract_is_select_only_and_matches_frozen_baseline(self):
        for module in modules():
            editor, cursor = editor_for(module)
            module.validate(None, editor)
            editor.execute.assert_not_called()
            self.assertEqual(cursor.execute.call_count, len(module.CHECKS))
            for call in cursor.execute.call_args_list:
                self.assertTrue(call.args[0].lstrip().startswith('SELECT '))
                self.assertNotIn(';', call.args[0])

    def test_each_contract_fails_closed_on_drift(self):
        for module in modules():
            for index, (label, _, _, _) in enumerate(module.CHECKS):
                with self.subTest(module=module.__name__, contract=label):
                    rows = [check[3] for check in module.CHECKS]
                    rows[index] = [('unexpected schema',)]
                    editor, cursor = editor_for(module, rows)
                    with self.assertRaisesRegex(RuntimeError, 'Canonical baseline mismatch'):
                        module.validate(None, editor)
                    self.assertEqual(cursor.execute.call_count, index + 1)
                    editor.execute.assert_not_called()

    def test_empty_database_cannot_be_falsely_baselined(self):
        for module in modules():
            editor, _ = editor_for(module, [[] for _ in module.CHECKS])
            with self.assertRaisesRegex(RuntimeError, 'Canonical baseline mismatch'):
                module.validate(None, editor)

    def test_wrong_vendor_or_alias_fails_before_queries(self):
        for module in modules():
            for vendor, alias in [('sqlite', 'default'), ('postgresql', 'enrolment')]:
                editor, cursor = editor_for(module, vendor=vendor, alias=alias)
                with self.assertRaisesRegex(RuntimeError, 'Canonical PostgreSQL default'):
                    module.validate(None, editor)
                cursor.execute.assert_not_called()

    def test_restrict_writable_metadata_and_no_provenance_backfill(self):
        qr = modules()[4]
        self.assertIn('ON DELETE RESTRICT', str(qr.CHECKS))
        self.assertNotIn('ON DELETE CASCADE', str(qr.CHECKS))
        metadata = modules()[5]
        columns = next(rows for label, _, _, rows in metadata.CHECKS if label.endswith('columns') and 'weeks' in label)
        by_name = {row[0]: row for row in columns}
        for name in ('title', 'summary', 'learning_outcomes', 'status', 'holiday_note_enabled', 'holiday_note'):
            self.assertEqual(by_name[name][3], '')
        self.assertEqual(by_name['active_display_order'][3], 's')
        self.assertTrue(all('UPDATE ' not in sql and 'INSERT ' not in sql
                            for _, sql, _, _ in modules()[3].CHECKS))
