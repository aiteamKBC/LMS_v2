"""Course category and migration regressions; SQLite in memory, no Django/network."""
import ast
import contextlib
import sqlite3
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from curriculum_api.course_types import CourseTypeError, course_types_for_modules, normalise_course_type

ROOT = Path(__file__).parent


def load_function(file, name, namespace):
    tree = ast.parse(file.read_text(encoding='utf-8-sig'))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(file), 'exec'), namespace)
    return namespace[name]


class CourseTypesTests(unittest.TestCase):
    def test_accepts_only_the_two_course_categories(self):
        self.assertEqual(normalise_course_type(' Apprentices '), 'apprentices')
        self.assertEqual(normalise_course_type('free'), 'free')
        for invalid in ('paid', 'programme', '', None, [], 'apprenticeship'):
            with self.subTest(invalid=invalid), self.assertRaises(CourseTypeError):
                normalise_course_type(invalid)

    def test_legacy_edits_preserve_type_and_new_courses_default_to_free(self):
        rows = [{'courseId': 'A'}, {'courseId': 'B'}, {'title': 'New course'}]
        self.assertEqual(course_types_for_modules(rows, {'A': 'apprentices', 'B': 'free'}), {0: 'apprentices', 1: 'free', 2: 'free'})

    def test_explicit_change_is_allowed_and_mixed_weeks_are_rejected(self):
        self.assertEqual(course_types_for_modules([{'courseId': 'A', 'courseType': 'free'}], {'A': 'apprentices'}), {0: 'free'})
        with self.assertRaises(CourseTypeError):
            course_types_for_modules([{'courseId': 'A', 'courseType': 'free'}, {'courseId': 'A', 'courseType': 'apprentices'}], {})

    def save_namespace(self, existing=()):
        writes, deletes = [], Mock(return_value=(set(), set()))
        ns = {
            'clean_str': lambda value: str(value or '').strip(),
            'transaction': SimpleNamespace(atomic=contextlib.nullcontext),
            'free_programme_fetch_all': lambda *args, **kwargs: list(existing),
            'FREE_COURSES_TABLE': 'courses', 'FREE_PROGRAMME_MODULES_TABLE': 'weeks',
            'FREE_PROGRAMME_COMPONENTS_TABLE': 'components', 'AUTHORING_WEEKS_TABLE': 'authoring_weeks',
            'course_types_for_modules': course_types_for_modules,
            'delete_free_programme_data': deletes, 'authoring_delete': Mock(),
            'free_programme_course_id': lambda module, used: f'C{len(used) + 1}',
            'free_programme_module_id': lambda programme, module, index: f'FW{index}',
            'stored_module_cover_image': lambda course, cover: cover,
            'free_programme_week_payload': lambda course, module, index: {'id': f'W{index}', 'week_number': index + 1, 'title': 'Week'},
            'active_components_payload': lambda rows: rows,
            'component_expected_otjh_minutes': lambda row: 0, 'otjh_hours_from_minutes': lambda minutes: minutes / 60,
            'authoring_upsert': Mock(), 'json_db_value': lambda value: value,
            'free_programme_upsert': lambda table, keys, values: writes.append((table, values.copy())),
            'invalidate_curriculum_cache': Mock(), 'get_free_programme_modules_payload': lambda programme: [],
        }
        return load_function(ROOT / 'views.py', 'save_free_programme_modules', ns), writes, deletes

    def test_save_keeps_category_of_omitted_legacy_field(self):
        save, writes, _ = self.save_namespace([{'id': 'A', 'course_type': 'apprentices'}])
        save('FREE-COURSES', {'modules': [{'courseId': 'A', 'title': 'Existing', 'components': []}]})
        self.assertEqual([row['course_type'] for table, row in writes if table == 'courses'], ['apprentices'])

    def test_same_named_new_courses_of_different_types_stay_separate(self):
        save, writes, _ = self.save_namespace()
        save('FREE-COURSES', {'modules': [{'title': 'Shared name', 'courseType': kind} for kind in ('free', 'apprentices')]})
        courses = [row for table, row in writes if table == 'courses']
        self.assertEqual(len(courses), 2)
        self.assertEqual({row['course_type'] for row in courses}, {'free', 'apprentices'})

    def test_invalid_type_does_not_delete_or_write_existing_content(self):
        save, writes, deletes = self.save_namespace()
        with self.assertRaises(CourseTypeError):
            save('FREE-COURSES', {'modules': [{'courseType': 'invalid'}]})
        deletes.assert_not_called()
        self.assertEqual(writes, [])

    def test_response_and_import_round_trip_retain_course_type(self):
        namespace = {
            'clean_str': lambda value: str(value or '').strip(),
            'parse_int': lambda value, fallback: int(value) if value is not None else fallback,
            'parse_float': lambda value, fallback: float(value) if value is not None else fallback,
            'as_json_value': lambda value, fallback: value if value is not None else fallback,
        }
        response = load_function(ROOT / 'views.py', 'free_programme_module_response', namespace)
        to_input = load_function(ROOT / 'views.py', '_free_module_response_to_input', {})
        for course, expected in (({'id': 'A', 'course_type': 'apprentices'}, 'apprentices'), ({'id': 'F'}, 'free')):
            with self.subTest(course=course):
                row = response({'id': 'W1', 'course_id': course['id']}, [], course)
                self.assertEqual(row['courseType'], expected)
                self.assertEqual(to_input(row)['courseType'], expected)

    def test_migration_preserves_rows_defaults_free_and_rejects_invalid_values(self):
        with contextlib.closing(sqlite3.connect(':memory:')) as db:
            db.execute('create table free_courses (id text primary key, course_name text)')
            db.execute("insert into free_courses values ('C1', 'Existing course')")
            connection = SimpleNamespace(vendor='sqlite', cursor=lambda: contextlib.closing(db.cursor()))
            provision = load_function(ROOT / 'migrations/0072_course_type.py', 'provision', {})
            provision(None, SimpleNamespace(connection=connection))
            provision(None, SimpleNamespace(connection=connection))
            self.assertEqual(db.execute('select id, course_name, course_type from free_courses').fetchall(), [('C1', 'Existing course', 'free')])
            db.execute("insert into free_courses values ('C2', 'Apprentices course', 'apprentices')")
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("insert into free_courses values ('C3', 'Invalid', 'paid')")


if __name__ == '__main__':
    unittest.main()
