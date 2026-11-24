"""Compatibility routing and original transport oracle; synthetic inputs only."""
from .catalogue.tests.parity.read_dependency_test_support import database_read_fixture, ksb_read_fixture
from .catalogue.tests.parity.read_dependency_test_support import authoring_read_fixture
from contextlib import contextmanager
import json
from pathlib import Path
import sys
from types import ModuleType
from unittest.mock import patch

from django.test import SimpleTestCase
from . import authoring_read_transport as transport, views
from .catalogue.infrastructure import authoring_transport as core

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/transport_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_transport():
    modules = {}
    for name, source in SNAPSHOT.items():
        full_name = 'curriculum_api.' + name
        module = ModuleType(full_name)
        module.__package__ = 'curriculum_api'
        exec(compile(source, '<original-' + name + '>', 'exec'), vars(module))
        modules[full_name] = module
    with patch.dict(sys.modules, modules):
        yield modules['curriculum_api.authoring_read_transport']


class TransportRouting(SimpleTestCase):
    def test_normalized_mapping_uses_projection_but_routed_sources_stay_routed(self):
        with database_read_fixture('authoring_table_name', side_effect=lambda table: 'physical.' + table), \
             ksb_read_fixture('read_source', return_value='normalized projection') as projection:
            for table, source, expected in (
                ('ksb_mappings', 'physical.ksb_mappings', 'normalized projection'),
                ('ksb_mappings', 'learning_ksb_mappings', 'learning_ksb_mappings'),
                ('ksb_mappings', 'native_mapping_view', 'native_mapping_view'),
                ('components', 'physical.components', 'physical.components'),
                ('components', 'native_components', 'native_components'),
            ):
                with authoring_read_fixture('learning_read_table', return_value=source):
                    self.assertEqual(transport._read_source(table), expected)
            projection.assert_called_once_with('ksb_mappings')

    def test_non_postgresql_retains_ordinary_reader_and_skips_schema_guard(self):
        with database_read_fixture('connection', vendor='sqlite'), \
             authoring_read_fixture('ensure_module_authoring_tables') as guard, \
             authoring_read_fixture('authoring_fetch_all', return_value=[{'id': 'A'}]) as read:
            with original_transport() as old:
                expected = old.compact_authoring_rows('components', 'id=%s', ['A'], 'id', columns=['id'], reuse_unchanged=True)
            actual = transport.compact_authoring_rows('components', 'id=%s', ['A'], 'id', columns=['id'], reuse_unchanged=True)
            self.assertEqual(actual, expected)
            self.assertEqual(read.call_args_list[0], read.call_args_list[1])
            guard.assert_not_called()

    def test_projection_and_reuse_selection_call_actual_new_owner(self):
        with database_read_fixture('connection', vendor='postgresql'), \
             authoring_read_fixture('ensure_module_authoring_tables') as guard, \
             ksb_read_fixture('read_columns', return_value={'id', 'description'}), \
             patch.object(core, '_compact_rows', return_value=[]) as compact, \
             patch.object(core, 'read_verified_rows', return_value=[]) as verified:
            transport.compact_authoring_rows('components', '', [], 'id', columns=['description'], reuse_unchanged=True)
            compact.assert_called_once()
            self.assertEqual(compact.call_args.args[4], ['description'])
            verified.assert_not_called()
            transport.compact_authoring_rows('components', '', [], 'id', columns=['id', 'missing', 'description'], reuse_unchanged=True)
            verified.assert_called_once()
            self.assertEqual(verified.call_args.args[4], ['id', 'description'])
            self.assertEqual(guard.call_count, 2)

    def test_no_shared_fields_uses_existing_complete_reader(self):
        with authoring_read_fixture('authoring_fetch_all', return_value=[{'id': 'A'}]) as read:
            actual = transport._compact_rows('weeks', 'id=%s', ['A'], 'id', ['id'])
            self.assertEqual(actual, [{'id': 'A'}])
            read.assert_called_once_with('weeks', 'id=%s', ['A'], 'id', columns=['id'])
