"""Actual count readers with explicit in-memory ports; no Django or database."""
import ast
import hashlib
import importlib
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from curriculum_api.catalogue.infrastructure import attachment_reads, content_counts
from curriculum_api.catalogue.infrastructure.component_count_sql import component_count_source

ORDINARY = '"curriculum"."components"'
NATIVE = '"curriculum"."free_authoring_components"'
MIXED = '"curriculum"."learning_components"'
INACTIVE = '"status" in (\'inactive\', \'archived\')'


def attachment_ports(source=ORDINARY):
    return dict(AUTHORING_COMPONENTS_TABLE='components', RETIRED_COMPONENT_TYPES={'retired'},
                deleted_sql_condition=Mock(return_value=f'({INACTIVE} or "deleted_at" is not null)'),
                ensure_module_authoring_tables=Mock(), fetch_all=Mock(return_value=[]),
                learning_read_table=Mock(return_value=source), logger=Mock(),
                quote_ident=lambda name: '"' + name + '"')


class ComponentCountContracts(unittest.TestCase):
    def test_historical_baseline_is_pinned_and_rejects_unrelated_edits(self):
        from curriculum_api.catalogue.tests.parity import component_count_contracts as contract
        self.assertEqual(hashlib.sha256(contract.REFERENCE_PATH.read_bytes()).hexdigest(),
                         '68415489ed6fd6b93ae8004d652f67fac033e02e6a45abdb149392a9a63448df')
        root = Path(attachment_reads.__file__).parents[2]
        for relative, entry in contract.REFERENCE['files'].items():
            current = ast.parse((root / relative).read_text())
            restored = contract.restore_tree(current, relative)
            self.assertEqual(contract.fingerprint(restored), entry['before_ast_sha256'])
            current.body.extend(ast.parse('unexpected_change = True').body)
            with self.assertRaisesRegex(AssertionError, 'Unreviewed count-reader edit'):
                contract.restore_tree(current, relative)

    def test_ordinary_attachment_sql_and_results_match_actual_pre_fix_source(self):
        from curriculum_api.catalogue.tests.parity.component_count_contracts import REFERENCE
        namespace = {}
        exec(compile(REFERENCE['files']['catalogue/infrastructure/attachment_reads.py']['before_source'],
                     '<pre-fix-attachment-reader>', 'exec'), namespace)
        before = attachment_ports()
        after = attachment_ports()
        for ports in (before, after):
            ports['fetch_all'].return_value = [{'catalogue_id': ' M ', 'total': '2'}]
        self.assertEqual(namespace['authoring_component_counts_by_catalogue'](**before),
                         attachment_reads.authoring_component_counts_by_catalogue(**after))
        self.assertEqual(before['fetch_all'].call_args_list, after['fetch_all'].call_args_list)

    def test_ordinary_source_and_predicate_are_unchanged(self):
        for source in (ORDINARY, '"components"'):
            for predicate in ('', 'not (' + INACTIVE + ')'):
                self.assertEqual(component_count_source(source, predicate), (source, predicate))

    def test_native_source_uses_only_its_deleted_timestamp(self):
        source, predicate = component_count_source(NATIVE, INACTIVE)
        self.assertEqual((source, predicate), (NATIVE, '"deleted_at" is null'))
        self.assertNotIn('status', source + predicate)
        self.assertNotIn(ORDINARY, source)

    def test_mixed_filters_before_union_and_keeps_duplicate_semantics(self):
        source, predicate = component_count_source(MIXED, 'not (' + INACTIVE + ')')
        ordinary, native = source.split(' union all ')
        self.assertIn(ORDINARY, ordinary)
        self.assertIn('not (' + INACTIVE + ')', ordinary)
        self.assertIn(NATIVE, native)
        self.assertIn('"deleted_at" is null', native)
        self.assertNotIn('status', native)
        self.assertEqual(predicate, '')
        self.assertNotIn('*', source)

    def test_no_predicate_does_not_create_invalid_where(self):
        source, _ = component_count_source(MIXED, '')
        self.assertIn(ORDINARY + ' union all ', source)

    def test_attachment_keeps_normalization_retired_filter_and_empty_results(self):
        ports = attachment_ports(MIXED)
        ports['fetch_all'].return_value = [
            {'catalogue_id': ' M\u3000', 'total': '3'}, {'catalogue_id': '', 'total': 5}]
        self.assertEqual(attachment_reads.authoring_component_counts_by_catalogue(**ports), {'M': 3})
        sql, params = ports['fetch_all'].call_args.args
        self.assertIn('type not in (%s)', sql)
        self.assertIn('coalesce("module_catalogue_id", \'\') <> \'\'', sql)
        self.assertEqual(params, ['retired'])
        ports['ensure_module_authoring_tables'].assert_called_once()
        ports['fetch_all'].return_value = []
        self.assertEqual(attachment_reads.authoring_component_counts_by_catalogue(**ports), {})

    def test_read_failure_is_not_reported_as_empty_counts(self):
        ports = attachment_ports()
        ports['fetch_all'].side_effect = RuntimeError('synthetic unavailable source')
        with self.assertRaisesRegex(RuntimeError, 'synthetic unavailable source'):
            attachment_reads.authoring_component_counts_by_catalogue(**ports)

    def test_setup_failure_stops_before_query(self):
        ports = attachment_ports()
        ports['ensure_module_authoring_tables'].side_effect = RuntimeError('setup failed')
        with self.assertRaisesRegex(RuntimeError, 'setup failed'):
            attachment_reads.authoring_component_counts_by_catalogue(**ports)
        ports['fetch_all'].assert_not_called()

    def test_content_reader_keeps_normalized_ksb_projection_and_code_deduplication(self):
        # These are the exact three lazy infrastructure dependencies. Execute
        # the actual function, with no AST replacement or Django initialization.
        package = 'curriculum_api.catalogue.infrastructure'
        database = ModuleType(package + '.database_reads')
        database.AUTHORING_COMPONENTS_TABLE = 'components'
        database.AUTHORING_KSB_MAPPINGS_TABLE = 'ksb_mappings'
        database.quote_ident = lambda name: '"' + name + '"'
        database.has_column = lambda table, column: True
        database.fetch_all = Mock(side_effect=[
            [{'module_catalogue_id': 'M', 'type': 'reading', 'row_count': 2},
             {'module_catalogue_id': 'M', 'type': 'retired', 'row_count': 9}],
            [{'module_catalogue_id': 'M', 'ksb_code': ' K1 '},
             {'module_catalogue_id': 'M', 'ksb_code': 'K1'},
             {'module_catalogue_id': 'M', 'ksb_code': ''}],
        ])
        ksb = ModuleType(package + '.ksb_read_store')
        ksb.relation = Mock(return_value='normalized_ksb_projection')
        authoring = ModuleType(package + '.authoring_sql')
        authoring.live_authoring_rows_sql = lambda table: ('not (' + INACTIVE + ')', [])
        doubles = {m.__name__: m for m in (database, ksb, authoring)}
        with patch.dict(sys.modules, doubles), patch.multiple(importlib.import_module(package),
                database_reads=database, ksb_read_store=ksb, create=True):
            result = content_counts.authoring_module_content_counts(
                learning_read_table=lambda table: MIXED,
                is_retired_component_type=lambda kind: kind == 'retired')
        self.assertEqual(result, ({'M': 2}, {'M': 1}))
        queries = [call.args[0] for call in database.fetch_all.call_args_list]
        self.assertIn('union all', queries[0])
        self.assertIn('from normalized_ksb_projection where not (' + INACTIVE + ')', queries[1])
        ksb.relation.assert_called_once_with(include_description=False)

    def test_sql_builder_has_no_runtime_dependencies(self):
        path = Path(attachment_reads.__file__).with_name('component_count_sql.py')
        tree = ast.parse(path.read_text())
        self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree)))


if __name__ == '__main__':
    unittest.main()
