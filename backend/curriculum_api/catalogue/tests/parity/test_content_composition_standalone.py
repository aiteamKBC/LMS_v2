"""Current source and pure behavior, compared with frozen task-start code."""
import ast
import hashlib
import inspect
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import content_composition_oracle as oracle
from curriculum_api.catalogue.domain import archive_policy, content_values, values, component_types
from curriculum_api.catalogue.infrastructure import archive_sql


def original_policy():
    env = dict(truthy=values.truthy, INACTIVE_STATUSES=archive_policy.INACTIVE_STATUSES,
               _default_is_retired_component_type=component_types.is_retired_component_type)
    for key in ('curriculum_names.py:is_inactive', 'archive_state.py:row_inactive'):
        exec(compile(oracle.SNAPSHOT['original_functions'][key], '<task-start>', 'exec'), env)
    env['archive_state'] = SimpleNamespace(row_inactive=env['row_inactive'])
    for name in ('row_has_deleted_at', 'programme_deleted_row', 'active_week_rows', 'active_mapping_rows'):
        exec(compile(oracle.SNAPSHOT['original_functions']['views.py:' + name], '<task-start>', 'exec'), env)
    exec(compile(oracle.SNAPSHOT['original_functions']['catalogue/domain/content_values.py:active_component_rows'],
                 '<task-start>', 'exec'), env)
    return env


def outcome(function, *args, **kwargs):
    try:
        return ('value', function(*args, **kwargs))
    except Exception as error:
        return ('error', type(error), str(error))


class ContentCompositionContracts(unittest.TestCase):
    def test_snapshot_and_exact_reviewed_source_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '57ac90ba672536abaea789a247cd3fc46dbcb4d4a510faf3a9b064f85cd2e274')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8-sig'))
            from curriculum_api.catalogue.tests.parity.workspace_composition_oracle import restore_tree
            tree = restore_tree(tree, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree.body],
                             entry['after'], relative)
            restored = oracle.restore_tree(tree, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body],
                             entry['order'], relative)

    def test_historical_query_bodies_after_explicit_count_compatibility_fix(self):
        from curriculum_api.catalogue.tests.parity.component_count_contracts import restore_tree as restore_count_fix
        replacements = {
            'database_reads.AUTHORING_COMPONENTS_TABLE': 'AUTHORING_COMPONENTS_TABLE',
            'database_reads.AUTHORING_KSB_MAPPINGS_TABLE': 'AUTHORING_KSB_MAPPINGS_TABLE',
            **{'database_reads.' + key: key for key in
               ('fetch_all', 'has_column', 'quote_ident', 'authoring_table_name')},
            '_default_clean_str': 'clean_str', '_default_parse_int': 'parse_int',
            '_default_is_retired_component_type': 'is_retired_component_type',
        }
        class Restore(ast.NodeTransformer):
            def visit_Attribute(self, node):
                text = ast.unparse(node)
                return ast.Name(id=replacements[text], ctx=ast.Load()) if text in replacements else node
            def visit_Name(self, node):
                return ast.Name(id=replacements.get(node.id, node.id), ctx=node.ctx)
        for relative, name in (
            ('catalogue/infrastructure/content_counts.py', 'authoring_module_content_counts'),
            ('catalogue/infrastructure/grouped_content.py', 'grouped_catalogue_content_rows'),
            ('catalogue/domain/content_values.py', 'active_component_rows'),
        ):
            current = next(n for n in restore_count_fix(ast.parse((ROOT / relative).read_text()), relative).body
                           if isinstance(n, ast.FunctionDef) and n.name == name)
            previous = ast.parse(oracle.SNAPSHOT['original_functions'][relative + ':' + name]).body[0]
            if name == 'authoring_module_content_counts':
                self.assertEqual([ast.unparse(n) for n in current.body if isinstance(n, ast.ImportFrom)],
                                 ['from . import database_reads, ksb_read_store as ksb_mapping_placement',
                                  'from .authoring_sql import live_authoring_rows_sql'])
                current.body = [n for n in current.body if not isinstance(n, ast.ImportFrom)]
            self.assertEqual([ast.dump(n) for n in previous.body],
                             [ast.dump(n) for n in Restore().visit(current).body], name)

    def test_pure_rules_import_no_runtime_or_api(self):
        for relative in ('catalogue/domain/archive_policy.py', 'catalogue/domain/content_values.py'):
            tree = ast.parse((ROOT / relative).read_text())
            for n in ast.walk(tree):
                if isinstance(n, (ast.Import, ast.ImportFrom)):
                    text = ast.unparse(n)
                    self.assertFalse(any(x in text for x in
                        ('views', 'django', 'infrastructure', 'settings', 'requests', 'psycopg')))
        for relative in ('catalogue_summary_reads.py', 'ksb_stats_reads.py',
                         'catalogue/infrastructure/content_counts.py',
                         'catalogue/infrastructure/grouped_content.py'):
            self.assertNotIn('views', (ROOT / relative).read_text())

    def test_row_policy_signatures_still_match_public_callers(self):
        old = original_policy()
        for name in ('row_has_deleted_at', 'programme_deleted_row', 'active_week_rows', 'active_mapping_rows'):
            self.assertEqual(inspect.signature(getattr(archive_policy, name)), inspect.signature(old[name]))
        signature = inspect.signature(content_values.active_component_rows)
        self.assertEqual(list(signature.parameters), ['rows', 'is_retired_component_type', 'programme_deleted_row'])
        self.assertIs(signature.parameters['programme_deleted_row'].default, archive_policy.programme_deleted_row)
        self.assertIs(signature.parameters['is_retired_component_type'].default, component_types.is_retired_component_type)

    def test_archive_sql_is_the_original_code_and_retains_null_semantics(self):
        env = {'STATUS_TABLES': archive_sql.STATUS_TABLES}
        for name in ('uses_status', 'live_sql', 'inactive_sql'):
            source = oracle.SNAPSHOT['original_functions']['archive_state.py:' + name]
            old = ast.parse(source).body[0]
            new = ast.parse(inspect.getsource(getattr(archive_sql, name))).body[0]
            self.assertEqual(ast.dump(old), ast.dump(new))
            exec(compile(source, '<task-start-sql>', 'exec'), env)
        for table in ('modules', 'weeks', 'ksb_mappings', 'module_details', 'unknown', ''):
            self.assertEqual(archive_sql.uses_status(table), env['uses_status'](table))
        for alias in ('', 'm', 'm.', 'source_row'):
            self.assertEqual(archive_sql.live_sql(alias), env['live_sql'](alias))
            self.assertEqual(archive_sql.inactive_sql(alias), env['inactive_sql'](alias))
            self.assertNotIn('coalesce', archive_sql.live_sql(alias).lower())

    def test_domain_predicates_relocate_exact_bodies_without_new_restrictions(self):
        for name, source_file in (('is_inactive', 'curriculum_names.py'), ('row_inactive', 'archive_state.py'),
                                 ('row_has_deleted_at', 'views.py'), ('programme_deleted_row', 'views.py'),
                                 ('active_week_rows', 'views.py'), ('active_mapping_rows', 'views.py')):
            source = oracle.SNAPSHOT['original_functions'][source_file + ':' + name]
            if name == 'row_has_deleted_at':
                source = source.replace('archive_state.row_inactive(row)', 'row_inactive(row)')
            self.assertEqual(ast.dump(ast.parse(source).body[0]),
                             ast.dump(ast.parse(inspect.getsource(getattr(archive_policy, name))).body[0]))


ROWS = [None, {}, {'type': 'reading'}, {'type': 'quiz'}, {'type': 'workplace_evidence'},
        {'deleted_at': '2030-01-01'}, {'deleted_at': ''}, {'isDeleted': True},
        {'isProgrammeDeleted': 'true'}, {'isProgrammeDeleted': 'false'},
        {'is_deleted': True}, {'is_programme_deleted': True}]
ROWS += [{'type': 'reading', 'status': status} for status in
         (None, '', 'active', 'planned', 'draft', 'published', 'inactive', 'archived',
          ' INACTIVE ', '\tArchived\n', 0, False, 'withdrawn')]


class ArchiveBehaviorParity(unittest.TestCase):
    pass


def case(row):
    def test(self):
        old = original_policy()
        for name in ('row_has_deleted_at', 'programme_deleted_row'):
            self.assertEqual(outcome(old[name], row), outcome(getattr(archive_policy, name), row), name)
        rows = [row, {'type': 'reading', 'status': 'active'}, row]
        for name in ('active_week_rows', 'active_mapping_rows'):
            self.assertEqual(outcome(old[name], rows), outcome(getattr(archive_policy, name), rows), name)
        self.assertEqual(outcome(old['active_component_rows'], rows, programme_deleted_row=old['programme_deleted_row']),
                         outcome(content_values.active_component_rows, rows))
    return test


for index, row in enumerate(ROWS):
    setattr(ArchiveBehaviorParity, f'test_row_{index:02d}', case(row))


if __name__ == '__main__':
    unittest.main()
