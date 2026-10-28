"""Real quiz reader with scripted SELECTs; no Django, network or learner writes."""
import ast
from copy import deepcopy
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

HERE = Path(__file__).resolve().parent
DEFAULT_SOURCE = HERE / 'learner_detail.py'
if not DEFAULT_SOURCE.exists():
    DEFAULT_SOURCE = HERE / 'learner_detail.after.py'
SOURCE = Path(os.environ.get('KBC_QUIZ_SCOPE_SOURCE', str(DEFAULT_SOURCE)))


class MobileQuizScopeTests(unittest.TestCase):
    def setUp(self):
        network_guard = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network_guard.start()
        self.addCleanup(network_guard.stop)
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.scope = {'connections': {'enrolment': connection}, 'DatabaseError': RuntimeError,
                      'logger': MagicMock(), '_s': lambda value: '' if value is None else str(value),
                      'visible_week_sql': lambda alias: 'true',
                      '_MODULE_ASSESSMENTS_WEEK_LABEL': 'Module assessments'}
        names = {'_resolve_week_ids', '_module_assessment_week_id', '_normalise_quiz_scope_value',
                 '_matching_module_ids_for_quiz_record', '_append_week_quizzes', '_display_quiz_title'}
        nodes = [node for node in ast.parse(SOURCE.read_text(encoding='utf-8')).body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), self.scope)
        self.modules = [('G1', 'Managing AI Projects', 'P1', 'Programme'),
                        ('G2', 'Managing AI Projects', 'P1', 'Programme')]
        self.native_weeks = [(f'{mid}-W{n:02}', mid, f'Week {n:02}')
                             for mid in ('G1', 'G2') for n in range(1, 15)]
        self.quizzes = []
        self.links = []
        self.current_authored = []
        self.historical_authored = []
        self.statements = []
        self.cursor.execute.side_effect = self.execute

    def execute(self, sql, params):
        compact = ' '.join(sql.split())
        self.assertTrue(compact.startswith(('SELECT', 'WITH')), compact)
        self.statements.append((compact, params))
        if 'SELECT module_catalogue_id, title FROM curriculum.modules' in compact:
            titles = set(params[0]); ids = set(params[1]) if len(params) > 1 else set()
            rows = [(mid, title) for mid, title, *_ in self.modules if title in titles or mid in ids]
        elif 'FROM curriculum.modules m' in compact:
            rows = [row for row in self.modules if row[0] in params[0]]
        elif 'FROM curriculum.weeks' in compact:
            rows = [row for row in self.native_weeks if row[1] in params[0]]
        elif 'FROM curriculum.quiz_course_links' in compact:
            rows = [row for row in self.links if row[1] in params[0]]
        elif 'AND week_id = ANY' in compact:
            rows = [row for row in self.quizzes if row[1] in params[0]]
        elif 'AND id = ANY' in compact:
            rows = [row for row in self.quizzes if row[0] in params[0]]
        elif 'AND lower(COALESCE(module' in compact:
            rows = [row for row in self.quizzes if row[8].lower() in params[0]]
        elif 'FROM curriculum.record_revisions' in compact:
            rows = list(self.historical_authored)
        elif 'FROM curriculum.quiz_component_links link' in compact:
            rows = list(self.current_authored)
        else:
            self.fail('Unexpected query: ' + compact)
        self.cursor.fetchall.return_value = rows

    def fixture(self):
        weeks = [{'moduleId': mid, 'module': 'Managing AI Projects', 'weekId': wid, 'week': title}
                 for wid, mid, title in self.native_weeks]
        components = []
        for module_index, mid in enumerate(('G1', 'G2'), 1):
            owned = [week for week in weeks if week['moduleId'] == mid]
            for i in range(804):
                kind = 'video' if i < 76 else 'podcast'
                components.append({**owned[i % 14], 'componentId': f'{mid}-MEDIA-{i}', 'type': kind,
                                   'component': f'Resource {i}', 'isQuiz': False})
            quiz_index = 0
            for n, point_count in enumerate([5] * 11 + [4] * 3, 1):
                for _ in range(point_count + 1):
                    quiz_index += 1; qid = module_index * 1000 + quiz_index
                    week = owned[n - 1]
                    self.quizzes.append((qid, week['weekId'], f'Quiz {qid}', 10, 60, 'Minutes', 'P1', 'Programme', mid))
                    self.links.append((qid, mid, week['weekId']))
                    components.append({**week, 'componentId': f'{mid}-QUIZ-{qid}', 'type': 'quiz',
                        'component': f'Quiz {qid}', 'isQuiz': True, 'quizMeta': {'quizId': qid},
                        'quizAttempts': [{'passed': True, 'score': 75}]})
            self.assertEqual(quiz_index, 81)
        for i in range(17):
            components.append({**weeks[14], 'componentId': f'G2-HISTORICAL-{i}',
                               'type': 'video' if i < 8 else 'podcast', 'isQuiz': False})
        return weeks, components

    def run_reader(self, weeks, components, **kwargs):
        return self.scope['_append_week_quizzes'](weeks, components,
            [{'moduleId': row[0]} for row in self.modules], strict=True, **kwargs)

    def test_same_titled_native_deliveries_keep_885_canonical_each_and_17_history(self):
        weeks, components = self.fixture()
        expected = deepcopy(components)
        next_weeks, result = self.run_reader(weeks, components)
        self.assertEqual(next_weeks, weeks)
        self.assertEqual(result, expected)
        self.assertEqual(len(result), 1787)
        self.assertEqual(sum(row['moduleId'] == 'G1' for row in result), 885)
        self.assertEqual(sum(row['moduleId'] == 'G2' for row in result), 902)
        self.assertTrue(all(row['componentId'] for row in result))
        owners = {week['weekId']: week['moduleId'] for week in next_weeks}
        self.assertTrue(all(owners[row['weekId']] == row['moduleId'] for row in result))

    def test_reversing_same_title_week_order_cannot_change_ownership(self):
        weeks, components = self.fixture()
        _, result = self.run_reader(list(reversed(weeks)), components)
        self.assertEqual(result, components)

    def test_native_flag_false_true_and_default_preserve_the_same_native_ids(self):
        weeks, components = self.fixture()
        for flag in (False, True):
            with self.subTest(native_week_ids=flag):
                self.assertEqual(self.run_reader(weeks, components, native_week_ids=flag), (weeks, components))

    def test_explicit_module_resolves_its_own_missing_week_id_despite_same_titles(self):
        weeks, components = self.fixture()
        weeks[0] = {key: value for key, value in weeks[0].items() if key != 'weekId'}
        _, result = self.run_reader(weeks, components)
        self.assertEqual(result, components)

    def test_legacy_title_only_rejects_duplicate_module_titles(self):
        legacy = [{'module': 'Managing AI Projects', 'week': 'Week 01'}]
        resolved = self.scope['_resolve_week_ids'](legacy)
        self.assertNotIn(('Managing AI Projects', 'Week 01'), resolved)

    def test_legacy_unique_module_and_week_still_resolve(self):
        self.modules = self.modules[:1]
        legacy = [{'module': 'Managing AI Projects', 'week': 'Week 01'}]
        self.assertEqual(self.scope['_resolve_week_ids'](legacy)[('Managing AI Projects', 'Week 01')], 'G1-W01')

    def test_legacy_duplicate_week_titles_inside_one_module_are_ambiguous(self):
        self.modules = self.modules[:1]
        self.native_weeks.append(('G1-ANOTHER-W01', 'G1', 'Week 01'))
        resolved = self.scope['_resolve_week_ids']([{'module': 'Managing AI Projects', 'week': 'Week 01'}])
        self.assertNotIn(('Managing AI Projects', 'Week 01'), resolved)

    def test_mixed_native_row_cannot_mask_ambiguous_missing_week_id(self):
        self.modules = self.modules[:1]
        self.native_weeks.append(('G1-ANOTHER-W01', 'G1', 'Week 01'))
        rows = [{'module': 'Managing AI Projects', 'moduleId': 'G1', 'week': 'Week 01', 'weekId': 'G1-W01'},
                {'module': 'Managing AI Projects', 'moduleId': 'G1', 'week': 'Week 01'},
                {'module': 'Managing AI Projects', 'week': 'Week 01'}]
        resolved = self.scope['_resolve_week_ids'](rows)
        self.assertNotIn(('moduleId', 'G1', 'Week 01'), resolved)
        self.assertNotIn(('Managing AI Projects', 'Week 01'), resolved)

    def test_legacy_lookup_failure_cannot_borrow_native_title_candidate(self):
        rows = [{'module': 'Managing AI Projects', 'moduleId': 'G1', 'week': 'Week 01', 'weekId': 'G1-W01'},
                {'module': 'Managing AI Projects', 'moduleId': 'G1', 'week': 'Week 01'},
                {'module': 'Managing AI Projects', 'week': 'Week 01'}]
        self.cursor.execute.side_effect = RuntimeError('scripted DB failure')
        self.assertEqual(self.scope['_resolve_week_ids'](rows), {})

    def test_existing_module_level_programme_title_assignment_contract_is_unchanged(self):
        modules = {row[0]: {'module': row[1], 'programmeId': row[2], 'programme': row[3]} for row in self.modules}
        match = self.scope['_matching_module_ids_for_quiz_record']
        self.assertEqual(set(match({'module': 'Managing AI Projects', 'programme_id': 'P1'}, modules, set())), {'G1', 'G2'})
        self.assertEqual(set(match({'module': 'Managing AI', 'programme_id': 'P1'}, modules, set())), {'G1', 'G2'})
        self.assertEqual(set(match({'module': 'Managing AI Projects'}, modules, {'G1', 'G2'})), {'G1', 'G2'})

    def test_title_assigned_module_level_assessment_remains_once_per_delivery_on_refresh(self):
        self.quizzes = [(77, '', 'Module assessment', 10, 60, 'Minutes', 'P1', 'Programme', 'Managing AI Projects')]
        next_weeks, result = self.run_reader([], [])
        self.assertEqual([(r['moduleId'], r['weekId'], r['quizMeta']['quizId']) for r in result], [
            ('G1', 'quiz-module-assessments::G1', 77), ('G2', 'quiz-module-assessments::G2', 77)])
        self.assertEqual(self.run_reader(next_weeks, result), (next_weeks, result))

    def test_explicit_shared_quiz_remains_visible_once_in_each_intended_module(self):
        weeks = [{'moduleId': mid, 'module': 'Managing AI Projects', 'weekId': f'{mid}-W01', 'week': 'Week 01'}
                 for mid in ('G1', 'G2')]
        self.quizzes = [(77, 'G1-W01', 'Shared quiz', 10, 60, 'Minutes', 'P1', 'Programme', 'G1')]
        self.links = [(77, 'G1', 'G1-W01'), (77, 'G2', 'G2-W01')]
        existing = {**weeks[0], 'componentId': 'KEEP-QUIZ-77', 'isQuiz': True, 'quizMeta': {'quizId': 77},
                    'quizAttempts': [{'passed': True, 'score': 100}]}
        _, result = self.run_reader(weeks, [existing])
        self.assertIs(result[0], existing)
        self.assertEqual([(row['moduleId'], row['weekId'], row['quizMeta']['quizId']) for row in result],
                         [('G1', 'G1-W01', 77), ('G2', 'G2-W01', 77)])
        self.assertIsNone(result[1]['componentId'])

    def test_unassigned_native_module_quiz_is_not_added_by_title(self):
        self.modules = self.modules[:1]
        weeks = [{'moduleId': 'G1', 'module': 'Managing AI Projects', 'weekId': 'G1-W01', 'week': 'Week 01'}]
        self.quizzes = [(99, 'G2-W01', 'Other delivery', 10, 60, 'Minutes', 'P1', 'Programme', 'G2')]
        self.links = [(99, 'G2', 'G2-W01')]
        self.assertEqual(self.run_reader(weeks, []), (weeks, []))

    def test_repeated_refresh_is_idempotent_and_keeps_all_existing_attempts(self):
        weeks, components = self.fixture()
        _, first = self.run_reader(weeks, components)
        _, second = self.run_reader(weeks, first)
        self.assertEqual(first, components)
        self.assertEqual(second, components)


if __name__ == '__main__':
    unittest.main()
