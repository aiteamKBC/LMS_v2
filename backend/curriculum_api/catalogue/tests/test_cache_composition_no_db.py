"""Actual owner identity and cache entry adapters; isolated Django runner only."""
import importlib
from unittest.mock import patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.application import cache_warming as payload_warming
from curriculum_api.catalogue.infrastructure import cache_warming as worker
from curriculum_api.catalogue.tests.parity.test_cache_composition_standalone import MANIFEST
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixtures
from curriculum_api.catalogue.tests.parity.cache_lifecycle_oracle import SNAPSHOT as LIFECYCLE_SNAPSHOT


class CacheCompositionRuntime(SimpleTestCase):
    def test_final_feature_exports_are_the_actual_decorated_owner_functions(self):
        from curriculum_api.catalogue.tests.parity.final_bindings_oracle import SNAPSHOT
        manifest = SNAPSHOT['manifest']
        for name, owner in {**manifest['functions'], **manifest['constants']}.items():
            self.assertIs(getattr(views, name), getattr(importlib.import_module('curriculum_api.' + owner), name), name)

    def test_final_feature_capabilities_bind_existing_runtime_objects(self):
        import ast
        from pathlib import Path
        from curriculum_api.catalogue.tests.parity.final_bindings_oracle import SNAPSHOT
        for name in SNAPSHOT['manifest']['modules']:
            owner = importlib.import_module('curriculum_api.' + name)
            for node in ast.parse(Path(owner.__file__).read_text(encoding='utf-8')).body:
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    for alias in node.names:
                        symbol = alias.asname or alias.name.split('.')[0]
                        self.assertIs(getattr(owner, symbol), getattr(views, symbol), (name, symbol))

    def test_relocated_lifecycle_and_overview_exports_keep_actual_owner_identity(self):
        manifest = LIFECYCLE_SNAPSHOT['manifest']
        for name, owner in {**manifest['functions'], **manifest['constants']}.items():
            self.assertIs(getattr(views, name), getattr(importlib.import_module('curriculum_api.' + owner), name), name)

    def test_all_new_composition_capabilities_resolve_to_the_existing_exports(self):
        import ast
        from pathlib import Path
        for name in ('cache_lifecycle', 'overview_composition'):
            owner = importlib.import_module('curriculum_api.catalogue.api.' + name)
            for node in ast.parse(Path(owner.__file__).read_text(encoding='utf-8')).body:
                if isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        symbol = alias.asname or alias.name
                        self.assertIs(getattr(owner, symbol), getattr(views, symbol), symbol)

    def test_startup_schedule_resolves_the_concrete_lifecycle_owner(self):
        import curriculum_api
        from curriculum_api import apps, read_model
        from curriculum_api.catalogue.api import cache_lifecycle
        config = apps.CurriculumApiConfig('curriculum_api', curriculum_api)
        with self.settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False), \
             patch.object(read_model, 'register_curriculum_home_read_model') as register, \
             patch.object(apps, 'reconciliation_command', return_value=False), \
             patch.object(apps, 'serves_curriculum_pages', return_value=True), \
             patch.object(config, 'log_cache_backend'), \
             patch.object(cache_lifecycle, 'schedule_curriculum_warm', return_value=False) as schedule:
            config.ready()
        register.assert_called_once_with()
        schedule.assert_called_once_with()

    def test_invalidation_binds_the_new_schedule_and_original_transaction(self):
        from curriculum_api.catalogue.infrastructure import cache_invalidation
        from curriculum_api.catalogue.api import cache_lifecycle
        with patch.object(cache_invalidation, 'invalidate_curriculum_cache', return_value='invalidated') as invalidate:
            self.assertEqual(views.invalidate_curriculum_cache('all'), 'invalidated')
        self.assertEqual(invalidate.call_args.args, ('all',))
        for name in ('_TABLE_EXISTS_CACHE', 'bump_shared_curriculum_epoch', 'logger', 'schema_compat', 'transaction'):
            self.assertIs(invalidate.call_args.kwargs[name], getattr(views, name))
        self.assertIs(invalidate.call_args.kwargs['schedule_curriculum_warm'], cache_lifecycle.schedule_curriculum_warm)

    def test_exports_keep_one_function_and_exception_identity(self):
        for name, owner in {**MANIFEST['functions'], **MANIFEST['classes']}.items():
            self.assertIs(getattr(views, name), getattr(importlib.import_module('curriculum_api.' + owner), name), name)

    def test_payload_entry_supplies_current_read_capabilities(self):
        with patch.object(payload_warming, 'warm_curriculum_caches', return_value='synthetic') as warm:
            self.assertEqual(views.warm_curriculum_caches(), 'synthetic')
        supplied = warm.call_args.kwargs
        for name in ('build_curriculum_payload', 'curriculum_read_scope', 'cached_curriculum_value',
                     'enrich_modules_with_authoring', 'enrich_programmes_with_module_counts'):
            self.assertIs(supplied[name], getattr(views, name))

    def test_schedule_entry_preserves_flag_and_callback(self):
        with patch.object(worker, 'schedule_curriculum_warm', return_value=False) as schedule:
            self.assertFalse(views.schedule_curriculum_warm())
        schedule.assert_called_once_with(enabled=views.CURRICULUM_WARM_ENABLED, run_warm_loop=views._curriculum_warm_loop)

    def test_loop_entry_supplies_current_payload_and_section_builders(self):
        with patch.object(worker, '_curriculum_warm_loop') as run:
            views._curriculum_warm_loop()
        run.assert_called_once_with(warm_curriculum_caches=views.warm_curriculum_caches,
            warm_programme_detail_sections=views.warm_programme_detail_sections,
            delay_seconds=views.CURRICULUM_WARM_DELAY_SECONDS)

    def test_no_duplicate_mutable_worker_state_in_views(self):
        for name in ('_CURRICULUM_WARM_RUNNING', '_CURRICULUM_WARM_REQUESTED', '_CURRICULUM_WARM_LOCK'):
            self.assertFalse(hasattr(views, name))
            self.assertTrue(hasattr(worker, name))

    def test_grouped_test_capabilities_restore_original_owner(self):
        from curriculum_api.catalogue.api import programme_detail_composition as detail
        original = views.build_programmes
        replacement = lambda *args, **kwargs: []
        with composition_fixtures(views, build_programmes=replacement):
            self.assertIs(views.build_programmes, replacement)
            self.assertIs(detail.build_programmes, replacement)
        self.assertIs(views.build_programmes, original)
        self.assertIs(detail.build_programmes, original)
