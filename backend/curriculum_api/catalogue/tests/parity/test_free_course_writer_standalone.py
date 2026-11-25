"""Original-source parity for the canonical writer extraction; no Django imports."""
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

from curriculum_api.catalogue.domain import free_course_authoring as policy
from curriculum_api.catalogue.application import free_course_authoring_mutations as commands

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/fixtures/free_course_writer_boundary.json'
SHA = '94138279cf457dcc9634ff3e68ac0b724409c052403a24abd1bf58fd08f8ce46'


def originals():
    raw = FIXTURE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SHA
    return json.loads(raw)['sources']


def definitions(text):
    return {node.name: node for node in ast.parse(text).body
            if isinstance(node, (ast.FunctionDef, ast.ClassDef))}


def dump(node):
    return ast.dump(node, include_attributes=False)


class Normalise(ast.NodeTransformer):
    """Undo only dependency binding and SQL movement, not business decisions."""
    def __init__(self, methods):
        self.methods = methods

    def visit_ImportFrom(self, node):
        if any(a.name == 'queue_saved_videos' for a in node.names):
            return None
        return node

    def visit_Call(self, node):
        node = self.generic_visit(node)
        name = ast.unparse(node.func)
        if name == 'storage.session':
            node.func = ast.parse('connection.cursor', mode='eval').body
        elif name == 'storage.atomic':
            node.func = ast.parse('transaction.atomic', mode='eval').body
        elif name == 'storage.require_mode':
            node.func = ast.Name(id='require_mode', ctx=ast.Load())
            node.args = [ast.Name(id='CANONICAL', ctx=ast.Load())]
        elif name.startswith('storage.'):
            node.func = ast.Name(id=node.func.attr, ctx=ast.Load())
        elif name == 'session.update_row':
            node.func = ast.Name(id='_update_row', ctx=ast.Load())
            node.args.insert(0, ast.Name(id='cursor', ctx=ast.Load()))
        elif name == 'clock':
            node.func = ast.parse('timezone.now', mode='eval').body
        elif name == 'store_cover':
            node.func = ast.Name(id='_stored_cover', ctx=ast.Load())
        if ast.unparse(node.func) == '_catalogue_revision':
            node.keywords = []
        return node

    def operation(self, call, target=None):
        method = self.methods[call.func.attr]
        self.assert_arguments(call, method)
        result = []
        for statement in deepcopy(method.body):
            if isinstance(statement, ast.Return):
                assert target is not None
                result.append(ast.Assign(targets=[target], value=statement.value))
            else:
                result.append(statement)
        return [CursorName().visit(statement) for statement in result]

    @staticmethod
    def assert_arguments(call, method):
        assert [ast.unparse(a) for a in call.args] == [a.arg for a in method.args.args[1:]]
        assert not call.keywords

    def visit_Expr(self, node):
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and ast.unparse(call.func.value) == 'session' and call.func.attr in self.methods:
            return self.operation(call)
        return self.generic_visit(node)

    def visit_Assign(self, node):
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and ast.unparse(call.func.value) == 'session' and call.func.attr in self.methods:
            return self.operation(call, node.targets[0])
        return self.generic_visit(node)

    def visit_With(self, node):
        node = self.generic_visit(node)
        for item in node.items:
            if isinstance(item.optional_vars, ast.Name) and item.optional_vars.id == 'session':
                item.optional_vars.id = 'cursor'
        # The adapter returns this SELECT result explicitly; the original read
        # it directly in the following if. No other assignments are folded.
        for index in range(len(node.body)-1, 0, -1):
            previous, current = node.body[index-1:index+1]
            if (isinstance(previous, ast.Assign) and ast.unparse(previous.targets[0]) == 'duplicate_order'
                    and isinstance(current, ast.If) and ast.unparse(current.test) == 'duplicate_order'):
                current.test = previous.value
                del node.body[index-1]
        return node


class CursorName(ast.NodeTransformer):
    def visit_Attribute(self, node):
        if ast.unparse(node) == 'self._cursor':
            return ast.Name(id='cursor', ctx=ast.Load())
        return self.generic_visit(node)


class FreeCourseWriterParity(unittest.TestCase):
    def test_pure_decisions_are_original_functions(self):
        before = definitions(originals()['free_course_authoring_mutations.py'])
        current = definitions((ROOT / 'domain/free_course_authoring.py').read_text())
        self.assertEqual(len(current), 16)
        for name, node in current.items():
            with self.subTest(name=name):
                self.assertEqual(dump(node), dump(before[name]))

    def test_create_update_delete_preserve_complete_statement_order(self):
        before = definitions(originals()['free_course_authoring_mutations.py'])
        after = definitions((ROOT / 'application/free_course_authoring_mutations.py').read_text())
        store = definitions((ROOT / 'infrastructure/free_course_commands.py').read_text())
        methods = {node.name: node for node in store['FreeCourseWriteSession'].body
                   if isinstance(node, ast.FunctionDef) and node.name not in {'__init__', 'update_row'}}
        self.assertEqual(len(methods), 18)
        for name in ('create_course', 'update_course', 'delete_course'):
            with self.subTest(name=name):
                expected = Normalise(methods).visit(deepcopy(before[name]))
                actual = Normalise(methods).visit(deepcopy(after[name]))
                actual.args = deepcopy(expected.args)  # Explicit injected capabilities only.
                self.assertEqual(dump(actual), dump(expected))

    def test_storage_helpers_keep_queries_and_parameters(self):
        before = definitions(originals()['free_course_authoring_mutations.py'])
        after = definitions((ROOT / 'infrastructure/free_course_commands.py').read_text())
        for name in ('_rows', '_course_rows', '_tree', '_ledger_row', '_purge_expired_idempotency', '_dependency_counts', '_update_row'):
            self.assertEqual(dump(before[name]), dump(after[name]), name)

    def test_alignment_decisions_and_identity_matching_are_unchanged(self):
        before = definitions(originals()['free_course_alignment.py'])
        after = definitions((ROOT / 'domain/free_course_alignment.py').read_text())
        for name in ('digest', 'Plan', 'build_plan'):
            self.assertEqual(dump(before[name]), dump(after[name]), name)

    def test_new_domain_and_application_import_only_inner_capabilities(self):
        for file in ('domain/free_course_authoring.py', 'domain/free_course_alignment.py',
                     'domain/free_course_catalogue.py', 'domain/free_course_identity.py',
                     'domain/free_course_revisions.py', 'application/free_course_authoring_mutations.py',
                     'application/free_course_policy.py'):
            tree = ast.parse((ROOT / file).read_text())
            imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            for entry in imports:
                self.assertFalse(any(word in entry for word in ('django', 'psycopg', '.api', 'infrastructure', 'views', 'requests', 'redis')), (file, entry))

    def test_clone_delegates_once_with_preserved_source_and_new_client_ids(self):
        source = {'title': 'Source', 'weekStructure': [{'id': 'W', 'components': [
            {'id': 'C', 'type': 'reading', 'title': 'Read', 'settings': {'readingContent': 'Keep'}}]}]}
        captured = []
        def create(payload, **kwargs):
            captured.append((payload, kwargs))
            return 'saved'
        self.assertEqual(commands.clone_normal_module(
            {'moduleCatalogueId': ' MOD ', 'expectedRevision': 'v1'}, staff_id=7, idempotency_key='clone:123456',
            read_structure=lambda ident: deepcopy(source) if ident == 'MOD' else None, create=create), 'saved')
        self.assertEqual(len(captured), 1)
        self.assertEqual(captured[0][0]['weeks'][0]['legacyCopiedFromWeekId'], 'W')
        self.assertEqual(captured[0][0]['weeks'][0]['components'][0]['settings'], {'readingContent': 'Keep'})
        self.assertEqual(source['weekStructure'][0]['components'][0]['id'], 'C')

    def test_validation_preserves_blank_idempotency_and_linked_quiz_failures(self):
        for value in (None, '', 'short', 'bad key:12345'):
            with self.assertRaises(policy.MutationError):
                policy.validate_idempotency_key(value)
        with self.assertRaises(policy.MutationError) as caught:
            policy._normalise_component({'type': 'quiz', 'title': 'Quiz', 'settings': {}}, index=0,
                                        existing={'type': 'quiz', 'settings_json': '{"linkedQuizId":"4"}'})
        self.assertEqual(caught.exception.code, 'linked_quiz_change_forbidden')


if __name__ == '__main__':
    unittest.main()
