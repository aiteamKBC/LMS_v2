"""Account for the explicit native-KSB fix in historical source guards only.

No runtime test uses restored source. Both fingerprints and exact changed lines
are checked before reconstructing the pre-fix architecture snapshot.
"""
import ast
import hashlib
import json
from pathlib import Path

REFERENCE_PATH = Path(__file__).parents[1] / 'fixtures/native_ksb_preparation_fix.json'
REFERENCE = json.loads(REFERENCE_PATH.read_text(encoding='utf-8'))
CURRENT_FILE = 'catalogue/infrastructure/free_course_native_schema.py'


def original_imports(tree):
    """Undo only the reviewed import relocation for historical source hashes."""
    replacements = [
        ('from curriculum_api.catalogue.infrastructure.free_course_contract import COLUMNS\n'
         'from curriculum_api.catalogue.infrastructure.free_course_contract import NATIVE_VIEWS',
         'from .free_course_contract import COLUMNS, NATIVE_VIEWS'),
        ('from curriculum_api.catalogue.infrastructure.learning_relations import TABLES\n'
         'from curriculum_api.catalogue.infrastructure.learning_relations import REFERENCES\n'
         'from curriculum_api.catalogue.infrastructure.learning_relations import REFERENCE_VIEWS',
         'from .catalogue.infrastructure.learning_relations import TABLES, REFERENCES, REFERENCE_VIEWS'),
        ('from curriculum_api.catalogue.infrastructure.ksb_placement_reads import relation as ksb_placement_relation',
         'from .catalogue.infrastructure.ksb_placement_reads import relation as ksb_placement_relation'),
        ('from curriculum_api.learning_storage import reset', 'from .learning_storage import reset'),
    ]
    class Imports(ast.NodeTransformer):
        def generic_visit(self, node):
            node = super().generic_visit(node)
            for _, value in ast.iter_fields(node):
                if not isinstance(value, list):
                    continue
                for after, before in replacements:
                    expected = ast.parse(after).body
                    for index in range(len(value) - len(expected) + 1):
                        actual = value[index:index+len(expected)]
                        if all(isinstance(n, ast.AST) for n in actual) and [ast.dump(n) for n in actual] == [ast.dump(n) for n in expected]:
                            value[index:index+len(expected)] = ast.parse(before).body
                            break
            return node
    return Imports().visit(tree)


def fingerprint(tree):
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()


def restore_tree(tree, relative):
    if relative not in {REFERENCE['file'], CURRENT_FILE} or getattr(tree, '_native_ksb_fix_restored', False):
        return tree
    tree = original_imports(tree)
    assert fingerprint(tree) == REFERENCE['after_sha256'], 'Unreviewed native KSB change'
    lines = ast.unparse(tree).splitlines()
    for edit in reversed(REFERENCE['edits']):
        start, stop = edit['start'], edit['start'] + len(edit['after'])
        assert lines[start:stop] == edit['after'], 'Invalid native KSB delta'
        lines[start:stop] = edit['before']
    restored = ast.parse('\n'.join(lines))
    assert fingerprint(restored) == REFERENCE['before_sha256'], 'Invalid native KSB baseline'
    restored._native_ksb_fix_restored = True
    return restored
