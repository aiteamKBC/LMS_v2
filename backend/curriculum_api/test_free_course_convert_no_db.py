"""Pure mapping test for the free-course -> programme week builder.

AST-loads only build_free_course_week_structure from views.py; no Django setup,
database or network. The builder leans on just parse_int/clean_str, injected here
as faithful minimal versions so the test stays free of view-module imports.
"""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).parent


def load_function(name, namespace):
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name]
    assert len(nodes) == 1, name
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), namespace)


def _parse_int(value, default=0):
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    text = str(value).strip()
    return int(text) if text.lstrip('-').isdigit() else default


def _clean_str(value):
    return '' if value is None else str(value).strip()


class FreeCourseWeekStructureTests(unittest.TestCase):
    def setUp(self):
        self.ns = {'parse_int': _parse_int, 'clean_str': _clean_str}
        load_function('build_free_course_week_structure', self.ns)
        self.build = self.ns['build_free_course_week_structure']

    def test_orders_weeks_and_copies_settings_verbatim_without_free_ids(self):
        source = [
            {'courseId': 'FREECOURSE-1', 'displayOrder': 1, 'weekNumber': 2, 'weekTitle': 'Second',
             'id': 'FREEWEEK-B', 'components': [
                 {'id': 'FREECOMP-2', 'type': 'quiz', 'title': 'Quiz', 'description': 'd',
                  'expectedOtjh': 3, 'points': 5, 'reflectionRequired': True, 'tutorValidationRequired': True,
                  'settings': {'linkedQuizId': '103', 'manualUnlock': True}}]},
            {'courseId': 'FREECOURSE-1', 'displayOrder': 0, 'weekNumber': 1, 'weekTitle': 'First',
             'id': 'FREEWEEK-A', 'components': [
                 {'id': 'FREECOMP-1', 'type': 'video', 'title': 'Intro', 'settings': {'videoUrl': 'http://x'}}]},
        ]
        weeks = self.build(source)

        # displayOrder ascending, so First comes before Second regardless of input order.
        self.assertEqual([week['title'] for week in weeks], ['First', 'Second'])
        # No free ids leak at the week or component level (fresh WEEK-/COMP- ids mint on save).
        self.assertNotIn('id', weeks[0])
        quiz = weeks[1]['components'][0]
        self.assertNotIn('id', quiz)
        # settings carried verbatim, so the linked quiz and manualUnlock survive the copy.
        self.assertEqual(quiz['settings'], {'linkedQuizId': '103', 'manualUnlock': True})
        self.assertEqual(quiz['type'], 'quiz')
        self.assertEqual(quiz['expectedOtjh'], 3)
        # KSB mappings always start empty on both weeks and components.
        self.assertEqual(quiz['ksbMappings'], [])
        for week in weeks:
            self.assertEqual(week['ksbMappings'], [])

    def test_missing_week_number_and_title_fall_back_by_position(self):
        weeks = self.build([{'courseId': 'C', 'components': []}])
        self.assertEqual(weeks[0]['weekNumber'], 1)
        self.assertEqual(weeks[0]['title'], 'Week 1')
        self.assertEqual(weeks[0]['components'], [])

    def test_non_dict_settings_become_empty_dict(self):
        weeks = self.build([{'courseId': 'C', 'weekTitle': 'W', 'components': [{'type': 'reading', 'settings': None}]}])
        self.assertEqual(weeks[0]['components'][0]['settings'], {})


class ModuleFreeCourseWeekTests(unittest.TestCase):
    """The reverse map: a module's weekStructure -> free-course week entries."""

    def setUp(self):
        self.ns = {'parse_int': _parse_int, 'clean_str': _clean_str}
        load_function('build_module_free_course_weeks', self.ns)
        self.build = self.ns['build_module_free_course_weeks']

    def test_weeks_share_course_id_and_copy_settings_without_ids(self):
        structure = {
            'title': 'HR Fundamentals', 'description': 'Intro', 'coverImage': 'http://c',
            'weekStructure': [
                {'weekNumber': 1, 'title': 'Week 1', 'components': [
                    {'id': 'COMP-1', 'type': 'video', 'title': 'Intro', 'expectedOtjh': 2, 'points': 0,
                     'settings': {'videoUrl': 'http://v'}}]},
                {'weekNumber': 2, 'title': 'Week 2', 'components': [
                    {'id': 'COMP-2', 'type': 'quiz', 'title': 'Quiz', 'expectedOtjh': 1,
                     'reflectionRequired': True, 'tutorValidationRequired': True,
                     'settings': {'linkedQuizId': '103', 'manualUnlock': True}}]},
            ],
        }
        weeks = self.build(structure, 'FREECOURSE-XYZ')

        # Every week entry shares the one course id + course metadata.
        self.assertEqual([w['courseId'] for w in weeks], ['FREECOURSE-XYZ', 'FREECOURSE-XYZ'])
        self.assertEqual([w['courseName'] for w in weeks], ['HR Fundamentals', 'HR Fundamentals'])
        self.assertEqual(weeks[0]['description'], 'Intro')
        self.assertEqual(weeks[0]['coverImageUrl'], 'http://c')
        self.assertEqual([w['weekTitle'] for w in weeks], ['Week 1', 'Week 2'])
        # No week or component ids leak (fresh FREEWEEK-/FREECOMP- mint on save).
        self.assertNotIn('id', weeks[0])
        quiz = weeks[1]['components'][0]
        self.assertNotIn('id', quiz)
        # Settings copied verbatim — linked quiz + manualUnlock survive.
        self.assertEqual(quiz['settings'], {'linkedQuizId': '103', 'manualUnlock': True})
        # No KSB mappings carried on either the week or the component.
        self.assertNotIn('ksbMappings', quiz)
        self.assertNotIn('ksbMappings', weeks[0])

    def test_missing_title_and_week_number_fall_back(self):
        weeks = self.build({'weekStructure': [{'components': []}]}, 'FREECOURSE-A')
        self.assertEqual(weeks[0]['courseName'], 'Untitled course')  # from empty title
        self.assertEqual(weeks[0]['weekNumber'], 1)
        self.assertEqual(weeks[0]['weekTitle'], 'Week 1')
        self.assertEqual(weeks[0]['components'], [])

    def test_no_weeks_returns_empty(self):
        self.assertEqual(self.build({'title': 'X', 'weekStructure': []}, 'FREECOURSE-A'), [])


if __name__ == '__main__':
    unittest.main()
