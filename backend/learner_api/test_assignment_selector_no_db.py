"""Guarded characterization of real assignment bodies, without Django startup.

AST loading checks rule/query construction with explicit IO doubles. It does
not verify Django imports, SQL execution, actor permissions or HTTP contracts.
Run directly from the repository root with python -B and this file's path.
"""
import ast
from contextlib import nullcontext
from copy import deepcopy
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


BACKEND = Path(__file__).resolve().parent.parent
OWNER_PATH = BACKEND / 'learner_api' / 'selectors' / 'assignments.py'
FUNCTIONS = (
    '_group_preset_rows', '_module_ids_from_column', '_manual_roster_module_ids',
    'group_module_ids_bulk', '_group_module_ids', 'learner_group_module_ids',
    '_preset_ids_for', 'request_preset_cache', '_effective_plan_ids',
    'effective_training_plan',
)
CONSTANTS = ('GROUP_PRESET_SOURCE', 'GROUP_PRESET_SQL',
             'GROUP_PRESET_BULK_SQL', 'GROUP_PRESET_BY_ID_SQL')
ALIASES = ('_effective_plan_ids', 'effective_training_plan', 'request_preset_cache',
           'group_module_ids_bulk', '_group_module_ids', 'learner_group_module_ids')


def forbidden(*args, **kwargs):
    raise RuntimeError('Unmocked IO is forbidden in assignment characterization')


def guard(event, args):
    if event == 'import' and args[0].split('.')[0] in {'django', 'psycopg', 'psycopg2', 'sqlite3'}:
        raise RuntimeError('Django/database startup forbidden')
    if event.startswith('socket.') and event != 'socket.__new__':
        raise RuntimeError('Network forbidden')
    if event == 'open':
        path, mode, flags = args
        if str(path).replace(chr(92), '/').split('/')[-1].startswith('.env'):
            raise RuntimeError('Environment file reads forbidden')
        if isinstance(mode, str) and any(char in mode for char in 'wax+'):
            raise RuntimeError('Writes forbidden')
        if isinstance(flags, int) and flags & (1 | 2 | 64 | 512 | 1024):
            raise RuntimeError('Writes forbidden')
    if event in {'subprocess.Popen', 'os.system'}:
        raise RuntimeError('Subprocess forbidden')


sys.addaudithook(guard)


def definitions(path, names, scope):
    """Execute only named real definitions; never imports or arbitrary setup."""
    tree = ast.parse(path.read_text(encoding='utf-8'))
    nodes = []
    found = set()
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            nodes.append(node)
            found.add(node.name)
        elif isinstance(node, ast.Assign):
            selected = [target.id for target in node.targets
                        if isinstance(target, ast.Name) and target.id in names]
            if selected:
                ast.literal_eval(node.value)
                nodes.append(node)
                found.update(selected)
    if found != set(names):
        raise AssertionError(('Missing real definitions', set(names) - found))
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)


def owner_facts():
    codec = {'__name__': 'guarded_stored_plan_codec'}
    definitions(BACKEND / 'learner_api' / 'mappers.py', (
        '_s', '_as_list', '_maybe_json', '_split_csv', '_legacy_plan_from_csv',
        'stored_training_plan', 'get_training_plan',
    ), codec)
    placement = {'__name__': 'guarded_placement',
                 'EnrolmentUser': type('UnusedEnrolmentModel', (), {}),
                 'LearnerProfile': SimpleNamespace(objects=SimpleNamespace(using=forbidden))}
    definitions(BACKEND / 'learner_api' / 'placement_links.py', (
        'FIELDS', '_CACHE', '_NAME_FIELDS', '_s', '_id', 'placement_ids',
    ), placement)
    owner = ModuleType('guarded_real_assignment_definitions')
    owner.__dict__.update(
        json=json, _s=codec['_s'], stored_training_plan=codec['stored_training_plan'],
        get_training_plan=codec['get_training_plan'], placement_ids=placement['placement_ids'],
        connection=SimpleNamespace(vendor='postgresql', cursor=forbidden),
        projection_call=lambda _label, function, *args: function(*args),
        projection_operation=lambda _label: nullcontext(),
    )
    definitions(OWNER_PATH, (*FUNCTIONS, *CONSTANTS, '_rows'), owner.__dict__)
    return owner


def learner(saved=None, **fields):
    return SimpleNamespace(pk=71, programme='P', group='G', training_plan=saved,
                           learning_plan=fields.pop('learning_plan', None), **fields)


class AssignmentSelectorTests(unittest.TestCase):
    def setUp(self):
        self.owner = owner_facts()

    def test_absent_empty_explicit_and_inherited_order(self):
        for saved, expected, queries in (
            (None, ['B', 'C'], 1), ([], [], 0),
            ([{'moduleId': 'A', 'assignmentMode': 'explicit'}], ['A'], 0),
            ([{'moduleId': 'A'}], ['A', 'B', 'C'], 1),
            ([{'moduleId': 'C'}, {'moduleId': 'A'}], ['C', 'A', 'B'], 1),
        ):
            with self.subTest(saved=saved), patch.object(self.owner, '_preset_ids_for', return_value=['B', 'C']) as preset:
                self.assertEqual(self.owner._effective_plan_ids(learner(saved), {}), expected)
                self.assertEqual(preset.call_count, queries)

    def test_explicit_empty_precedence_and_invalid_entries(self):
        source = learner([], learning_plan=[{'moduleId': 'OTHER'}])
        with patch.object(self.owner, '_preset_ids_for', side_effect=forbidden):
            self.assertEqual(self.owner._effective_plan_ids(source, {}), [])
            source.training_plan = ['invalid', None, {'moduleId': ' X ', 'assignmentMode': 'explicit'}]
            self.assertEqual(self.owner._effective_plan_ids(source, {}), ['X'])

    def test_json_and_malformed_storage_keep_existing_precedence(self):
        source = learner('not-json', learning_plan='[{"moduleId":"B","assignmentMode":"explicit"}]')
        with patch.object(self.owner, '_preset_ids_for', side_effect=forbidden):
            self.assertEqual(self.owner._effective_plan_ids(source, {}), ['B'])
            source.training_plan = '[]'
            self.assertEqual(self.owner._effective_plan_ids(source, {}), [])

    def test_saved_duplicates_and_preset_order_are_not_silently_normalized(self):
        with patch.object(self.owner, '_preset_ids_for', return_value=['B', 'B']):
            self.assertEqual(self.owner._effective_plan_ids(learner([{'moduleId': 'A'}, {'moduleId': 'A'}]), {}),
                             ['A', 'A', 'B', 'B'])

    def test_snapshot_keeps_source_identity_and_does_not_mutate_saved_rows(self):
        saved = [{'moduleId': 'CROSS', 'sourceId': 'legacy:9', 'weeks': [{'weekId': 'W'}]}]
        before = deepcopy(saved)
        with patch.object(self.owner, '_preset_ids_for', return_value=['CROSS', 'NEW']):
            self.assertEqual(self.owner.effective_training_plan(learner(saved)), [*saved, {'moduleId': 'NEW'}])
        self.assertEqual(saved, before)

    def test_snapshot_decodes_saved_plan_once(self):
        source = learner('[{"moduleId":"M","assignmentMode":"explicit"}]')
        with patch.object(self.owner, 'stored_training_plan', wraps=self.owner.stored_training_plan) as decode:
            self.assertEqual(self.owner.effective_training_plan(source), [{'moduleId': 'M', 'assignmentMode': 'explicit'}])
        self.assertEqual(decode.call_count, 1)

    def test_legacy_title_representation_is_not_converted_to_an_identity(self):
        source = learner(None, modules='Previous', weeks='', components='')
        with patch.object(self.owner, '_preset_ids_for', return_value=['NEW']):
            result = self.owner.effective_training_plan(source)
        self.assertEqual(result, [{'moduleId': None, 'moduleTitle': 'Previous', 'weeks': []}, {'moduleId': 'NEW'}])

    def test_request_cache_is_reused_only_when_installed(self):
        source = learner()
        first = self.owner.request_preset_cache(source)
        self.assertEqual(first, {})
        self.assertIsNot(first, self.owner.request_preset_cache(source))
        self.assertFalse(hasattr(source, '_plan_preset_cache'))
        source._plan_preset_cache = first
        self.assertIs(self.owner.request_preset_cache(source), first)

    def test_group_id_cache_and_name_fallback_preserve_request_scope(self):
        source = learner(None, group_id='GRP', programme_id='PROG', cohort_id='COH')
        cache = {}
        with patch.object(self.owner, '_group_module_ids', return_value=['M']) as lookup:
            self.assertEqual(self.owner._effective_plan_ids(source, cache), ['M'])
            self.assertEqual(self.owner._effective_plan_ids(source, cache), ['M'])
            lookup.assert_called_once_with('', '', group_id='GRP')
        self.assertEqual(cache, {('group_id', 'GRP'): ['M']})
        with patch.object(self.owner, '_group_module_ids', return_value=['NEXT']) as lookup:
            self.assertEqual(self.owner._effective_plan_ids(learner(), {}), ['NEXT'])
            lookup.assert_called_once_with('P', 'G')

    def test_missing_preset_and_lookup_errors_are_not_reinterpreted(self):
        with patch.object(self.owner, '_group_module_ids', side_effect=ValueError('lookup unavailable')):
            with self.assertRaisesRegex(ValueError, 'lookup unavailable'):
                self.owner._effective_plan_ids(learner(), {})
        with patch.object(self.owner, '_group_module_ids', return_value=[]):
            self.assertEqual(self.owner._effective_plan_ids(learner(), {}), [])

    def test_column_decoding_retains_raw_list_order(self):
        for raw, expected in ((None, []), ('bad', []), ('{}', []),
                              ('[" B ", "A", "A", ""]', ['B', 'A', 'A', ''])):
            self.assertEqual(self.owner._module_ids_from_column(raw), expected)

    def test_name_query_fields_parameters_and_rank(self):
        with patch.object(self.owner, '_rows', return_value=[{'module_ids': ['A', 'MANUAL']}]) as query, \
                patch.object(self.owner, '_manual_roster_module_ids', return_value={'MANUAL'}):
            self.assertEqual(self.owner._group_module_ids('P', 'G'), ['A'])
        sql, params = query.call_args.args
        self.assertEqual(params, ['G', 'P', 'P'])
        self.assertIn('SELECT module_ids', sql)
        self.assertIn('deleted_at IS NULL', sql)
        self.assertIn('COALESCE(is_programme_deleted, FALSE) = FALSE', sql)
        self.assertRegex(sql, r"(?s)jsonb_array_length.*DESC,\s*updated_at DESC NULLS LAST,\s*created_at DESC NULLS LAST,\s*group_id\s*LIMIT 1")

    def test_stable_group_id_query_never_substitutes_name(self):
        with patch.object(self.owner, '_rows', return_value=[{'module_ids': ['M']}]) as query, \
                patch.object(self.owner, '_manual_roster_module_ids', return_value=set()):
            self.assertEqual(self.owner._group_module_ids('WRONG', 'OLD', group_id='GRP'), ['M'])
        self.assertEqual(query.call_args.args[1], ['GRP'])
        self.assertIn('WHERE group_id = %s', query.call_args.args[0])
        self.assertNotIn('group_name', query.call_args.args[0])

    def test_learner_group_lookup_uses_real_placement_helper(self):
        source = learner(None, group_id='GRP', programme_id='PROG', cohort_id='COH')
        with patch.object(self.owner, '_group_module_ids', return_value=['M']) as lookup:
            self.assertEqual(self.owner.learner_group_module_ids(source), ['M'])
        lookup.assert_called_once_with('P', 'G', group_id='GRP')

    def test_manual_lookup_is_one_parameterized_read_and_explicit_assignment_survives(self):
        with patch.object(self.owner, '_rows', return_value=[{'module_catalogue_id': 'M'}]) as query:
            self.assertEqual(self.owner._manual_roster_module_ids([' M ', 'M', '', 'N']), {'M'})
        self.assertEqual(query.call_count, 1)
        self.assertEqual(query.call_args.args[1], ['M', 'N'])
        self.assertIn('FROM curriculum.modules', query.call_args.args[0])
        self.assertIn("COALESCE(learner_roster_mode, 'inherited') = 'manual'", query.call_args.args[0])
        with patch.object(self.owner, '_preset_ids_for', side_effect=forbidden):
            self.assertEqual(self.owner._effective_plan_ids(learner([{'moduleId': 'M', 'assignmentMode': 'explicit'}]), {}), ['M'])

    def test_manual_lookup_empty_and_failure_contract(self):
        with patch.object(self.owner, '_rows', side_effect=forbidden) as query:
            self.assertEqual(self.owner._manual_roster_module_ids([]), set())
            query.assert_not_called()
            self.assertEqual(self.owner._manual_roster_module_ids(['M']), set())

    def test_bulk_pairs_have_one_group_and_one_manual_read(self):
        rows = [{'programme': 'P', 'grp': 'G', 'module_ids': ['B', 'A', 'MANUAL']}]
        with patch.object(self.owner, '_rows', return_value=rows) as query, \
                patch.object(self.owner, '_manual_roster_module_ids', return_value={'MANUAL'}) as manual:
            result = self.owner.group_module_ids_bulk([('P', 'G'), ('P', 'G'), ('P', 'NONE'), ('P', '')])
        self.assertEqual(result, {('P', 'G'): ['B', 'A'], ('P', 'NONE'): [], ('P', ''): []})
        self.assertEqual(query.call_count, 1)
        self.assertEqual(query.call_args.args[1], [['P', 'P'], ['G', 'NONE']])
        self.assertIn('SELECT DISTINCT ON (p.programme, p.grp)', query.call_args.args[0])
        manual.assert_called_once_with(['B', 'A', 'MANUAL'])

    def test_bulk_empty_has_no_io_and_failures_propagate(self):
        with patch.object(self.owner, '_rows', side_effect=ValueError('unavailable')) as query:
            self.assertEqual(self.owner.group_module_ids_bulk([('P', '')]), {('P', ''): []})
            query.assert_not_called()
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                self.owner.group_module_ids_bulk([('P', 'G')])

    def test_module_growth_does_not_add_per_module_reads(self):
        for count in (1, 10, 100):
            ids = [f'M{i}' for i in range(count)]
            with self.subTest(count=count), patch.object(self.owner, '_rows', return_value=[{'module_ids': ids}]) as query, \
                    patch.object(self.owner, '_manual_roster_module_ids', return_value=set()) as manual:
                self.assertEqual(self.owner._group_module_ids('P', 'G'), ids)
                self.assertEqual(query.call_count, 1)
                manual.assert_called_once_with(ids)
            pairs = [('P', f'G{i}') for i in range(count)]
            rows = [{'programme': programme, 'grp': group, 'module_ids': ids}
                    for programme, group in pairs]
            with self.subTest(learners=count), \
                    patch.object(self.owner, '_rows', side_effect=[rows, []]) as query:
                result = self.owner.group_module_ids_bulk(pairs)
                self.assertEqual(result, {pair: ids for pair in pairs})
                self.assertEqual(query.call_count, 2)
                self.assertEqual(query.call_args_list[0].args[1],
                                 [['P'] * count, sorted(group for _, group in pairs)])
                self.assertEqual(query.call_args_list[1].args[1], ids)

    def test_cursor_executor_preserves_parameters_row_mapping_and_instrumentation(self):
        cursor = MagicMock()
        cursor.description = [('module_ids',)]
        cursor.fetchall.return_value = [(['M'],)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(self.owner, 'connection', connection), \
                patch.object(self.owner, 'projection_operation', return_value=nullcontext()) as operation:
            self.assertEqual(self.owner._rows('SELECT module_ids WHERE group_id=%s', ['G']), [{'module_ids': ['M']}])
        cursor.execute.assert_called_once_with('SELECT module_ids WHERE group_id=%s', ['G'])
        operation.assert_called_once_with('assignment_query')

    def test_legacy_aliases_are_direct_and_keep_canonical_globals(self):
        tree = ast.parse((BACKEND / 'learner_api' / 'learning_plan.py').read_text(encoding='utf-8'))
        if OWNER_PATH.name == 'learning_plan.py':
            names = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
            self.assertTrue(set(ALIASES) <= names)
        else:
            aliases = [item for node in tree.body if isinstance(node, ast.ImportFrom)
                       and node.module == 'selectors.assignments' for item in node.names]
            self.assertEqual({item.name for item in aliases}, set(ALIASES))
            self.assertTrue(all(item.asname is None for item in aliases))
            self.assertFalse(set(FUNCTIONS) & {node.name for node in tree.body if isinstance(node, ast.FunctionDef)})
        legacy = SimpleNamespace(**{name: getattr(self.owner, name) for name in ALIASES})
        captured = legacy._effective_plan_ids
        self.assertIs(captured, self.owner._effective_plan_ids)
        self.assertIs(captured.__globals__, self.owner.__dict__)
        with patch.object(self.owner, '_preset_ids_for', return_value=['M']):
            self.assertEqual(captured(learner(), {}), ['M'])
        with patch.object(legacy, '_effective_plan_ids', return_value=['MOCK']):
            self.assertIsNot(legacy._effective_plan_ids, captured)
            self.assertIs(captured, self.owner._effective_plan_ids)
        self.assertIs(legacy._effective_plan_ids, captured)
        with patch.object(self.owner, '_effective_plan_ids', return_value=['NEW']):
            self.assertIs(legacy._effective_plan_ids, captured)
            self.assertIsNot(self.owner._effective_plan_ids, captured)
        # Internal lookups belong to the defining owner even through old aliases.
        with patch.object(legacy, '_group_module_ids', return_value=['OLD']) as old_lookup, \
                patch.object(self.owner, '_group_module_ids', return_value=['CANONICAL']) as lookup:
            self.assertEqual(captured(learner(), {}), ['CANONICAL'])
        old_lookup.assert_not_called()
        lookup.assert_called_once_with('P', 'G')

    def test_all_seven_safety_denials(self):
        events = [('import', ('django',)), ('import', ('psycopg',)), ('socket.connect', ()),
                  ('open', ('.env', 'r', 0)), ('open', ('forbidden.txt', 'w', 1)),
                  ('subprocess.Popen', ())]
        for event, args in events:
            with self.subTest(event=event, args=args), self.assertRaises(RuntimeError):
                sys.audit(event, *args)
        with self.assertRaisesRegex(RuntimeError, 'Unmocked IO'):
            forbidden()


if __name__ == '__main__':
    unittest.main(verbosity=2)
