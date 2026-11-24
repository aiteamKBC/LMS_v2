"""Catalogue source contracts with persistence and networking denied."""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db.models import Value
from django.test import SimpleTestCase

from .catalogue_source import CataloguePlan, read_catalogue_source
from .mappers import get_training_plan, stored_training_plan
from .models import SafeJSONField
from .my_learning import SOURCE_FIELDS


class CatalogueSourceTests(SimpleTestCase):
    def test_loader_keeps_source_identity_and_explicit_empty_plan_without_csv_reads(self):
        for training, learning in (([], [{'moduleId': 'IGNORED'}]),
                                   (None, []),
                                   ([{'moduleId': 'M1', 'assignmentMode': 'explicit'}], None)):
            model = Mock()
            class Source:
                pk = 7
                _catalogue_training_plan = training
                _catalogue_learning_plan = learning
                def __getattr__(self, name):
                    if name == '_canonical_training_plan':
                        raise AttributeError(name)
                    raise AssertionError(f'Unneeded deferred field: {name}')
            original = Source()
            model.all_learners.only.return_value.annotate.return_value.get.return_value = original
            source = read_catalogue_source(model, 7, SOURCE_FIELDS)
            self.assertIs(source, original)
            self.assertEqual(source.pk, 7)
            self.assertEqual(stored_training_plan(source), training if training is not None else learning)
            self.assertEqual(get_training_plan(source), stored_training_plan(source))
            model.all_learners.only.assert_called_once_with(*(field for field in SOURCE_FIELDS
                if field not in {'training_plan', 'learning_plan', 'modules', 'weeks', 'components'}))
            model.all_learners.only.return_value.annotate.return_value.get.assert_called_once_with(pk=7)

    def test_unsaved_plan_retains_legacy_csv_fallback(self):
        source = SimpleNamespace(pk=7, _catalogue_training_plan=None, _catalogue_learning_plan=None,
            modules='Legacy', weeks='Legacy\u00b7Week', components='Legacy\u00b7Week\u00b7Reading')
        model = Mock()
        model.all_learners.only.return_value.annotate.return_value.get.return_value = source
        result = get_training_plan(read_catalogue_source(model, 7, SOURCE_FIELDS))
        self.assertEqual(result, [{'moduleId': None, 'moduleTitle': 'Legacy', 'weeks': [
            {'weekId': None, 'weekTitle': 'Week', 'components': [
                {'componentId': None, 'componentTitle': 'Reading'}]}]}])

    def test_field_decoder_preserves_legacy_json_and_already_decoded_values(self):
        field = CataloguePlan(Value(None)).output_field
        self.assertIsInstance(field, SafeJSONField)
        for value in (None, [], {}, [{'moduleId': 'M1'}], 'invalid', '[{"moduleId":"M1"}]'):
            self.assertEqual(field.from_db_value(value, None, None),
                SafeJSONField().from_db_value(value, None, None))

    def test_postgres_expression_keeps_order_false_ids_and_bound_parameters(self):
        compiler = Mock()
        compiler.compile.return_value = ('%s', ['synthetic plan'])
        sql, params = CataloguePlan(Value(None)).as_postgresql(compiler, None)
        self.assertEqual(params, ['synthetic plan'] * 3)
        self.assertIn('ORDER BY position', sql)
        self.assertIn("THEN item-'weeks' ELSE item END", sql)
        for value in ('null', 'false', '0', '""', '[]', '{}'):
            self.assertIn("'"+value+"'::jsonb", sql)
        self.assertIn('ELSE %s END', sql)

    def test_sqlite_keeps_full_snapshots(self):
        compiler = Mock()
        compiler.compile.return_value = ('%s', ['full plan'])
        self.assertEqual(CataloguePlan(Value(None)).as_sqlite(compiler, None), ('%s', ['full plan']))


class CatalogueMappingScopeTests(SimpleTestCase):
    def read_scope(self, imported=False, shared_id=False):
        from . import my_learning as learning, my_learning_ksbs as ksbs
        from .tests_my_learning_no_db import component, native, metadata
        meta = metadata()
        meta.update(modules={}, free_course_module_ids=['FREE'])
        if imported:
            meta['imported_courses'] = {'current:FREE': 'legacy:50'}
        content = native([component('VISIBLE'), component('HIDDEN', 'FREE')],
            )
        content['retiredQuizComponents'] = [component('RETIRED', 'FREE')]
        if shared_id:
            content['retiredQuizComponents'].append(component('VISIBLE', 'FREE'))
        original = deepcopy(content)
        context = ([], [], [], content, [], [], set(), set(), {}, meta, [])
        with patch.object(learning, 'load_context', return_value=context), \
             patch.object(ksbs, 'read_card_ksb_mappings', return_value={}) as mappings, \
             patch.object(learning, 'assemble_cards', return_value=([], {})), \
             patch('learner_api.my_learning_activity.card_teaching_activity', return_value={}), \
             patch.object(learning.canonical, 'programme_planned_hours', return_value=0), \
             patch.object(learning.canonical, 'targets_for', return_value={}), \
             patch.object(learning, 'upcoming_links', return_value=[]):
            learning.read_catalogue(SimpleNamespace(pk=7, cohort='', group=''), 'commercial', {'id':9, 'name':'Synthetic'})
        self.assertEqual(content, original)  # Global identity facts were retained.
        projected = mappings.call_args.args[1]
        return projected

    def test_hidden_only_codes_are_skipped_after_global_reconciliation(self):
        projected = self.read_scope()
        self.assertEqual([c['componentId'] for c in projected['components']], ['VISIBLE'])
        self.assertEqual(projected['retiredQuizComponents'], [])

    def test_native_import_keeps_codes_for_visible_historical_continuations(self):
        projected = self.read_scope(imported=True)
        self.assertEqual([c['componentId'] for c in projected['components']], ['VISIBLE', 'HIDDEN'])
        self.assertEqual([c['componentId'] for c in projected['retiredQuizComponents']], ['RETIRED'])

    def test_shared_component_identity_keeps_all_placements(self):
        projected = self.read_scope(shared_id=True)
        self.assertEqual([c['componentId'] for c in projected['retiredQuizComponents']], ['VISIBLE'])
