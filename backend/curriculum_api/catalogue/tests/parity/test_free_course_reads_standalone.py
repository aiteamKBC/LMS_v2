"""Original-source parity, pure query contracts and extraction boundary checks."""
import ast
import importlib.util
from contextlib import contextmanager
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
import unittest

from curriculum_api.catalogue.application import free_course_documents as documents
from curriculum_api.catalogue.application import free_course_queries as queries
from curriculum_api.catalogue.domain import free_course_revisions as revisions
from curriculum_api.catalogue.domain import free_course_integrity as policy
from curriculum_api.catalogue.tests.parity.free_course_read_oracle import (
    legacy_module, sources, synthetic_rows,
)


ROOT = Path(__file__).resolve().parents[3]


def memory_reads(rows):
    courses, weeks, components, quizzes, links = deepcopy(rows)
    calls = []

    def select(kind, rows, key, values):
        calls.append((kind, None if values is None else tuple(sorted(values))))
        return deepcopy([r for r in rows if values is None or r.get(key) in values])

    def link_rows(course_ids, quiz_ids):
        calls.append(('links', tuple(sorted(course_ids)), tuple(sorted(quiz_ids))))
        return deepcopy([r for r in links if r['free_course_id'] in course_ids
                         or (r['quiz_id'] in quiz_ids and r['free_course_week_id'] is not None)])

    @contextmanager
    def snapshot():
        calls.append('begin')
        try:
            yield
        finally:
            calls.append('end')

    catalogue = SimpleNamespace(
        FREE_COURSES_TABLE='free_courses', FREE_COURSE_WEEKS_TABLE='free_course_weeks',
        FREE_COMPONENTS_TABLE='free_programme_components',
        courses=lambda course_ids=None: select('courses', courses, 'id', course_ids),
        weeks=lambda course_ids=None: select('weeks', weeks, 'course_id', course_ids),
        components=lambda week_ids=None: select('components', components, 'free_module_id', week_ids),
    )
    require = lambda *tables: calls.append(('require', tables))
    return SimpleNamespace(
        free_course_catalogue=catalogue, schema_gate=SimpleNamespace(require_tables=require),
        require_catalogue_tables=lambda: require('free_courses'),
        _require_course_tables=lambda: require('free_courses', 'free_course_weeks',
                                              'free_programme_components', 'quizzes', 'quiz_course_links'),
        _read_snapshot=snapshot, _quiz_rows=lambda ids: select('quizzes', quizzes, 'id', ids),
        _quiz_link_rows=lambda course, ids: link_rows([course], ids),
        _quiz_link_rows_for_courses=link_rows, calls=calls,
    )


def old_queries(reads):
    old = legacy_module('free_course_authoring.py',
                        free_course_catalogue=reads.free_course_catalogue,
                        schema_gate=reads.schema_gate)
    # Functions share the compiled original namespace, not a rewritten policy.
    namespace = old.course_document.__globals__
    for name in ('_read_snapshot', '_quiz_rows', '_quiz_link_rows', '_quiz_link_rows_for_courses'):
        namespace[name] = getattr(reads, name)
    return old


class FreeCourseReadParityTests(unittest.TestCase):
    def compare(self, rows, name, *args, **kwargs):
        before, after = memory_reads(rows), memory_reads(rows)
        expected = getattr(old_queries(before), name)(*deepcopy(args), **kwargs)
        actual = getattr(queries, name)(*deepcopy(args), reads=after, **kwargs)
        self.assertEqual(actual, expected)
        self.assertEqual(after.calls, before.calls)
        return actual

    def test_catalogue_single_batched_and_snapshot_contracts(self):
        rows = synthetic_rows()
        self.compare(rows, 'catalogue_document')
        self.compare(rows, 'catalogue_with_documents')
        self.compare(rows, 'course_documents', rows[0])
        self.compare(rows, 'course_documents', [])
        for course in rows[0]:
            for snapshot in (True, False):
                self.compare(rows, 'course_document', ' ' + course['id'] + ' ', read_snapshot=snapshot)

    def test_invalid_settings_and_quiz_ownership_match_original(self):
        settings = [None, {}, 'bad json', '[]', [], {'linkedQuizId': True},
                    {'linkedQuizId': ' Q-A '}, {'linkedQuizId': 'MISSING'}]
        owners = [None, '', 'FW-A', 'FW-B']
        for value in settings:
            for owner in owners:
                for status in ('published', 'TRASH'):
                    with self.subTest(settings=value, owner=owner, status=status):
                        rows = synthetic_rows()
                        rows[2][0]['settings_json'] = value
                        rows[3][0].update(free_course_week_id=owner, status=status)
                        self.compare(rows, 'course_document', 'FC-A')

    def test_duplicate_missing_and_cross_course_relationships(self):
        for kind in ('week-id', 'component-id', 'link', 'order', 'week-owner',
                     'component-week', 'programme', 'normal-quiz', 'unreferenced', 'missing-quiz'):
            with self.subTest(kind=kind):
                rows = synthetic_rows()
                if kind == 'week-id': rows[1].append(deepcopy(rows[1][0]))
                elif kind == 'component-id': rows[2].append(deepcopy(rows[2][0]))
                elif kind == 'link': rows[4].append(dict(rows[4][0], id=2))
                elif kind == 'order': rows[2].append(dict(rows[2][0], id='CP-NEW'))
                elif kind == 'week-owner': rows[4][0]['free_course_id'] = 'FC-B'
                elif kind == 'component-week': rows[2][0]['free_module_id'] = 'MISSING'
                elif kind == 'programme': rows[2][0]['programme_id'] = 'NORMAL'
                elif kind == 'normal-quiz': rows[3][0].update(free_course_week_id=None, week_id='NORMAL'); rows[4].clear()
                elif kind == 'unreferenced': rows[2][0]['settings_json'] = {}
                elif kind == 'missing-quiz': rows[3].clear()
                self.compare(rows, 'catalogue_with_documents')

    def test_raw_document_projection_preserves_orphan_diagnostics_and_order(self):
        old = legacy_module('free_course_authoring.py')
        courses, weeks, components, quizzes, links = synthetic_rows()
        # Direct assembly must retain diagnostics for rows filtered out by normal readers.
        weeks += [dict(weeks[0], id='ORPHAN', course_id='OTHER', display_order=None)]
        components += [dict(components[0], id='ORPHAN', free_module_id='MISSING', display_order=None)]
        before = deepcopy((courses, weeks, components, quizzes, links))
        expected = old._assemble_course_document(courses[0], weeks, components,
                                                old._decode_components(components), links, quizzes)
        actual = documents._assemble_course_document(courses[0], weeks, components,
                                                    policy._decode_components(components), links, quizzes)
        self.assertEqual(actual, expected)
        self.assertEqual((courses, weeks, components, quizzes, links), before)

    def test_missing_and_invalid_ids_preserve_exception_contract(self):
        for identifier in ('', ' \t', 'bad\x00id', 'x' * 129, 'MISSING'):
            old = old_queries(memory_reads(synthetic_rows()))
            with self.assertRaises(Exception) as first:
                old.course_document(identifier)
            with self.assertRaises(type(policy.InvalidFreeCourseId()) if identifier != 'MISSING'
                                   else policy.FreeCourseNotFound) as second:
                queries.course_document(identifier, reads=memory_reads(synthetic_rows()))
            self.assertEqual(type(first.exception).__name__, type(second.exception).__name__)
            self.assertEqual(str(first.exception), str(second.exception))

    def test_failure_propagates_and_snapshot_exits(self):
        for modern in (False, True):
            reads = memory_reads(synthetic_rows())
            def fail(*args, **kwargs): raise RuntimeError('read failed')
            reads._quiz_rows = fail
            with self.assertRaisesRegex(RuntimeError, 'read failed'):
                if modern: queries.course_document('FC-A', reads=reads)
                else: old_queries(reads).course_document('FC-A')
            self.assertEqual(reads.calls[-1], 'end')

    def test_revision_values_and_rejections_match_original(self):
        old = legacy_module('free_course_authoring.py')
        for value in (None, Decimal('-0.000'), Decimal('1.230'), 1.25,
                      {'z': [False, 'أ', Decimal('3.00')], 'a': None}):
            self.assertEqual(revisions.canonical_json_bytes(value), old.canonical_json_bytes(value))
        for value in (float('nan'), float('inf'), Decimal('NaN')):
            with self.assertRaises(ValueError): old.canonical_value(value)
            with self.assertRaises(ValueError): revisions.canonical_value(value)

    def test_pure_layers_have_no_framework_or_infrastructure_dependency(self):
        for file in ('domain/free_course_integrity.py', 'domain/free_course_revisions.py',
                     'application/free_course_documents.py', 'application/free_course_queries.py'):
            tree = ast.parse((ROOT / 'catalogue' / file).read_text())
            imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            self.assertFalse(any(word in line for word in
                ('django', 'infrastructure', 'views', 'settings', 'psycopg', 'requests') for line in imports))

    def test_moved_readers_and_writer_bodies_are_original_source(self):
        originals = sources()
        def definitions(text):
            return {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(text).body
                    if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        before = definitions(originals['free_course_catalogue.py'])
        moved = definitions((ROOT / 'catalogue/infrastructure/free_course_rows.py').read_text())
        for name, node in moved.items(): self.assertEqual(node, before[name], name)
        before = definitions(originals['free_course_authoring.py'])
        moved = definitions((ROOT / 'catalogue/infrastructure/free_course_document_reads.py').read_text())
        for name, node in moved.items():
            if name != 'require_catalogue_tables': self.assertEqual(node, before[name], name)
        spec = importlib.util.spec_from_file_location('workflow_oracle', Path(__file__).with_name('free_course_workflows_oracle.py'))
        workflow_oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(workflow_oracle)
        current = workflow_oracle.authoring_definitions()
        for name in ('_course', '_active_module', '_reply', 'catalogue', '_forward_save', '_delta', 'authoring'):
            self.assertEqual(current[name], before[name], name)


if __name__ == '__main__':
    unittest.main()
