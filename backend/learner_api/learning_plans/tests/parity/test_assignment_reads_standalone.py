"""Frozen production source versus actual extracted declarations; no Django startup."""
import ast
from contextlib import nullcontext
import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from learner_api.learning_plans.domain import stored_plan

SNAPSHOT_PATH = Path(__file__).resolve().parents[1] / 'fixtures/legacy_snapshots/assignment_reads_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))
READER = 'learner_api/learning_plans/infrastructure/assignment_reads.py'


def declarations(current):
    if not current:
        return [ast.parse(entry['source']).body[0]
                for kind in ('functions', 'constants') for entry in SNAPSHOT[kind].values()]
    return [node for owner in sorted({entry['owner'] for entry in SNAPSHOT['functions'].values()})
            for node in ast.parse((BACKEND / owner).read_text(encoding='utf-8')).body
            if isinstance(node, (ast.FunctionDef, ast.Assign))]


def environment(current):
    """Explicit substitutes for every runtime dependency; never imports infrastructure."""
    env = dict(json=json, connection=SimpleNamespace(vendor='postgresql'),
               projection_call=lambda label, function, *args: function(*args),
               projection_operation=lambda label: nullcontext(),
               placement_ids=lambda learner: {'group_id': getattr(learner, 'group_id', '')},
               connections={}, read_sql=lambda sql, db: sql)
    exec(compile(ast.Module(body=copy.deepcopy(declarations(current)), type_ignores=[]),
                 '<actual-extracted-read-source>' if current else '<frozen-before-extraction>', 'exec'), env)
    return env


def outcome(function, *args, **kwargs):
    try:
        result = function(*args, **kwargs)
        return type(result), result
    except Exception as exc:
        return type(exc), str(exc)


class AssignmentReadParity(unittest.TestCase):
    def test_frozen_evidence_and_exact_function_constant_parity(self):
        self.assertEqual(hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '5e15bcdd1620dcf736de935feb646a9ac41883a0febd59a3d1d7d7237ec73113')
        old = {node.name if isinstance(node, ast.FunctionDef) else node.targets[0].id: ast.dump(node)
               for node in declarations(False)}
        new = {node.name if isinstance(node, ast.FunctionDef) else node.targets[0].id: ast.dump(node)
               for node in declarations(True)}
        self.assertEqual(new, old)
        self.assertEqual((len(SNAPSHOT['functions']), len(SNAPSHOT['constants'])), (12, 4))

    def test_import_closure_is_explicit_and_does_not_include_http_or_writers(self):
        tree = ast.parse((BACKEND / READER).read_text(encoding='utf-8'))
        imports = {node.module if isinstance(node, ast.ImportFrom) else node.names[0].name
                   for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))}
        self.assertEqual(imports, {'json', 'django.db', 'learner_api.placement_links',
            'learner_api.projection_performance', 'learner_api.learning_plans.domain.stored_plan',
            'curriculum_api.catalogue.infrastructure.course_storage_reads'})
        domain = ast.parse(Path(stored_plan.__file__).read_text(encoding='utf-8'))
        self.assertEqual([n.names[0].name for n in ast.walk(domain) if isinstance(n, ast.Import)], ['json'])
        self.assertFalse(any(isinstance(n, ast.ImportFrom) for n in ast.walk(domain)))
        counts = ast.parse((BACKEND / 'curriculum_api/learner_assignment_counts_sql.py').read_text(encoding='utf-8'))
        imports = [n for n in counts.body if isinstance(n, ast.ImportFrom) and any(a.asname == 'plans' for a in n.names)]
        self.assertEqual(len(imports), 1)
        self.assertEqual(imports[0].module, 'learner_api.learning_plans.infrastructure')
        self.assertEqual(imports[0].names[0].name, 'assignment_reads')

    def test_redirects_preserve_names_and_resolve_to_the_recorded_owner(self):
        for entry in SNAPSHOT['redirected_imports']:
            with self.subTest(consumer=entry['consumer'], symbol=entry['symbol']):
                tree = ast.parse((BACKEND / entry['consumer']).read_text(encoding='utf-8'))
                matches = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
                           and n.module == entry['owner']
                           and any(a.name == entry['owner_symbol'] and (a.asname or a.name) == entry['symbol'] for a in n.names)]
                self.assertTrue(matches)
                self.assertFalse(any(isinstance(n, ast.ImportFrom) and n.module == 'curriculum_api.views'
                                     for n in ast.walk(tree)))

    def test_saved_plan_precedence_empty_arrays_and_malformed_values(self):
        old = environment(False)
        values = [None, '', '{}', 'bad json', '[]', [], {}, 0, True,
                  '[{"moduleId":" A "}, null, 7]', [{'moduleId': 'B'}, None]]
        for training in values:
            for learning in values:
                source = SimpleNamespace(training_plan=training, learning_plan=learning)
                with self.subTest(training=training, learning=learning):
                    self.assertEqual(outcome(stored_plan.stored_training_plan, source),
                                     outcome(old['stored_training_plan'], source))

    def test_python_whitespace_and_identifier_coercion_are_unchanged(self):
        old = environment(False)
        for value in [None, 0, False, 17, '', ' \tA\n', '\u001c\u0085\u00a0A\u2003\u3000', [], {}]:
            self.assertEqual(outcome(stored_plan._s, value), outcome(old['_s'], value))

    def test_effective_plan_truth_table_and_canonical_cache(self):
        saved = [None, [], [{'moduleId': ' A '}], [{'moduleId': 'A'}, {'moduleId': 'A'}],
                 [{'moduleId': 'A', 'assignmentMode': 'explicit'}], [{'moduleId': ''}], [None]]
        for plan in saved:
            for group in ('', 'G'):
                for canonical in (False, True):
                    results = []
                    for current in (False, True):
                        env = environment(current)
                        reader = Mock(return_value=['A', 'B', 'B'])
                        env['_group_module_ids'] = reader
                        learner = SimpleNamespace(group_id=group, training_plan=plan, learning_plan=None)
                        if canonical:
                            learner._canonical_training_plan = plan
                        cache = {}
                        result = outcome(env['_effective_plan_ids'], learner, cache)
                        results.append((result, cache, reader.call_args_list))
                    with self.subTest(plan=plan, group=group, canonical=canonical):
                        self.assertEqual(results[0], results[1])

    def test_supplied_saved_plan_does_not_read_canonical_or_json_fields(self):
        for saved in (None, [], [{'moduleId': 'S', 'assignmentMode': 'explicit'}]):
            results = []
            for current in (False, True):
                env = environment(current)
                env['_group_module_ids'] = Mock(return_value=['G'])
                env['stored_training_plan'] = Mock(side_effect=AssertionError('unexpected JSON read'))
                source = SimpleNamespace(group_id='GROUP', _canonical_training_plan=[{'moduleId': 'C'}])
                results.append(outcome(env['_effective_plan_ids'], source, {}, saved_plan=saved))
            self.assertEqual(results[0], results[1])

    def test_group_id_precedence_manual_exclusion_and_duplicate_order(self):
        for group_id, group in [(' G ', 'old name'), ('', 'name'), ('', '')]:
            results = []
            for current in (False, True):
                env = environment(current)
                rows = Mock(return_value=[{'module_ids': ['A', 'MANUAL', 'A', ' B ']}])
                env['_rows'] = rows
                manual = Mock(return_value={'MANUAL'})
                env['_manual_roster_module_ids'] = manual
                result = env['_group_module_ids']('P', group, source='synthetic_source', group_id=group_id)
                results.append((result, rows.call_args_list, manual.call_args_list))
            self.assertEqual(results[0], results[1])

    def test_manual_lookup_failure_and_empty_input_preserve_existing_fallback(self):
        for values in ([], ['', None], [' A ', 'A', 'B']):
            results = []
            for current in (False, True):
                env = environment(current)
                rows = Mock(side_effect=RuntimeError('synthetic missing column'))
                env['_rows'] = rows
                results.append((env['_manual_roster_module_ids'](values), rows.call_args_list))
            self.assertEqual(results[0], results[1])

    def test_bulk_presets_keep_requested_empty_and_duplicate_pairs(self):
        results = []
        for current in (False, True):
            env = environment(current)
            rows = Mock(return_value=[{'programme': 'P', 'grp': 'G', 'module_ids': ['A', 'A', 'M']}])
            env['_rows'] = rows
            env['_manual_roster_module_ids'] = Mock(return_value={'M'})
            result = env['group_module_ids_bulk']([(' P ', 'G'), ('P', ''), ('P', 'G'), ('X', 'G')])
            results.append((result, rows.call_args_list))
        self.assertEqual(results[0], results[1])

    def test_group_cache_shared_and_missing_bridge_does_not_query(self):
        for current in (False, True):
            env = environment(current)
            reader = Mock(return_value=['A'])
            env['_group_module_ids'] = reader
            cache = {}
            self.assertEqual(env['_preset_ids_for'](SimpleNamespace(group_id=''), cache), [])
            reader.assert_not_called()
            for unused in range(2):
                self.assertEqual(env['_preset_ids_for'](SimpleNamespace(group_id='G'), cache), ['A'])
            reader.assert_called_once_with('', '', group_id='G')
            self.assertEqual(cache, {('group_id', 'G'): ['A']})

    def test_rows_preserve_alias_sql_routing_and_column_mapping(self):
        for current in (False, True):
            env = environment(current)
            cursor = Mock(db=object(), description=[('id',), ('name',)])
            cursor.fetchall.return_value = [(3, 'synthetic')]
            env['connections'] = {'default': SimpleNamespace(cursor=lambda: nullcontext(cursor))}
            route = Mock(return_value='routed SELECT')
            env['read_sql'] = route
            self.assertEqual(env['_rows']('SELECT', ['P']), [{'id': 3, 'name': 'synthetic'}])
            route.assert_called_once_with('SELECT', cursor.db)
            cursor.execute.assert_called_once_with('routed SELECT', ['P'])

    def test_request_cache_returns_original_object_or_fresh_empty_dictionary(self):
        for current in (False, True):
            env = environment(current)
            cache = {}
            self.assertIs(env['request_preset_cache'](SimpleNamespace(_plan_preset_cache=cache)), cache)
            self.assertEqual(env['request_preset_cache'](SimpleNamespace()), {})


if __name__ == '__main__':
    unittest.main()
