"""The workspace modules section reads component text only when it decides something.

Synthetic rows only; nothing here reaches a database.
"""
import copy
import json
import random
from contextlib import ExitStack
from unittest.mock import patch

from django.test import SimpleTestCase

from . import programme_workspace_reads, views

TEXT = ('title', 'description', views.REFLECTION_QUESTION_COLUMN)


def component(component_id, week_id, *, title='', description='', question=''):
    return {
        'id': component_id, 'weekId': week_id, 'type': 'reading',
        'title': title, 'description': description, 'reflectionQuestion': question,
        'expectedOtjh': 1.0, 'ksbMappings': [], 'settings': {},
    }


def candidate(key, weeks, **fields):
    return {'moduleCatalogueId': key, 'weekStructure': weeks, **fields}


def blanked(items):
    items = copy.deepcopy(items)
    for item in items:
        for week in item.get('weekStructure') or []:
            for entry in week.get('components') or []:
                entry.update(title='', description='', reflectionQuestion='')
    return items


def outline(items):
    """What the workspace keeps of a selection: no components at all."""
    result = []
    for item in items:
        item = {key: value for key, value in item.items() if key != 'weekStructure'}
        result.append(item)
    return result


class ComponentTextCancelsTests(SimpleTestCase):
    fields = views.PROGRAMME_MODULE_IDENTITY_FIELDS

    def test_same_components_under_one_key_cancel(self):
        weeks = [{'id': 'W1', 'components': [component('C1', 'W1', title='A long title')]}]
        items = [candidate('M1', copy.deepcopy(weeks), status='published'), candidate('M1', copy.deepcopy(weeks), status='draft')]
        self.assertTrue(programme_workspace_reads.component_text_cancels(items, self.fields))

    def test_different_components_under_one_key_do_not(self):
        items = [
            candidate('M1', [{'id': 'W1', 'components': [component('C1', 'W1')]}]),
            candidate('M1', [{'id': 'W1', 'components': []}]),
        ]
        self.assertFalse(programme_workspace_reads.component_text_cancels(items, self.fields))
        # A module with no weeks at all against one with components.
        self.assertFalse(programme_workspace_reads.component_text_cancels(
            [candidate('M1', []), candidate('M1', [{'id': 'W1', 'components': [component('C1', 'W1')]}])], self.fields,
        ))

    def test_top_level_components_never_cancel(self):
        items = [{'moduleCatalogueId': 'M1', 'components': [{'id': 'X'}]}]
        self.assertFalse(programme_workspace_reads.component_text_cancels(items, self.fields))

    def test_distinct_keys_are_never_compared(self):
        items = [
            candidate('M1', [{'id': 'W1', 'components': [component('C1', 'W1')]}]),
            candidate('M2', []),
            {'name': '', 'weekStructure': []},
        ]
        self.assertTrue(programme_workspace_reads.component_text_cancels(items, self.fields))

    def test_keys_fall_back_to_the_name_as_selection_does(self):
        items = [
            {'name': 'Module', 'weekStructure': [{'id': 'W1', 'components': [component('C1', 'W1')]}]},
            {'title': 'module', 'weekStructure': []},
        ]
        self.assertFalse(programme_workspace_reads.component_text_cancels(items, self.fields))

    def test_selection_is_unchanged_by_blanking_whenever_text_cancels(self):
        rng = random.Random(20261019)
        decided = set()
        for _trial in range(400):
            weeks = [
                {'id': f'W{w}', 'title': f'Week {w}', 'components': [
                    component(f'C{w}{c}', f'W{w}',
                              title='t' * rng.randint(0, 40),
                              description=rng.choice(['', 'd' * rng.randint(0, 400), 'é' * rng.randint(0, 50)]),
                              question='q' * rng.randint(0, 30))
                    for c in range(rng.randint(0, 3))
                ]}
                for w in range(rng.randint(0, 3))
            ]
            # Two representations whose other fields differ by a few characters,
            # so the comparison sits close to its margin.
            first = candidate('M1', copy.deepcopy(weeks), status='published', notes='n' * rng.randint(0, 20))
            second = candidate('M1', copy.deepcopy(weeks), status='draft', notes='n' * rng.randint(0, 20), extra='x' * rng.randint(0, 5))
            items = [first, second] if rng.random() < .5 else [second, first]
            self.assertTrue(programme_workspace_reads.component_text_cancels(items, self.fields))
            full = views.unique_curriculum_items(copy.deepcopy(items), self.fields)
            lean = views.unique_curriculum_items(blanked(items), self.fields)
            self.assertEqual(outline(full), outline(lean))
            decided.add(json.dumps(outline(full), sort_keys=True)[:60])
        # Both outcomes occurred, so the property was exercised, not vacuous.
        self.assertGreater(len(decided), 1)

    def test_text_can_decide_when_components_differ_which_is_why_it_falls_back(self):
        rich_text = candidate('M1', [{'id': 'W1', 'components': [component('C1', 'W1', description='d' * 500)]}], status='a')
        # A bare representation whose richness sits between the two scores
        # the text-bearing one has with and without its text.
        target = (views.curriculum_item_richness(blanked([rich_text])[0]) + views.curriculum_item_richness(rich_text)) // 2
        bare = candidate('M1', [], status='b')
        bare['status'] += 'x' * (target - views.curriculum_item_richness(bare))
        full = views.unique_curriculum_items(copy.deepcopy([rich_text, bare]), self.fields)
        lean = views.unique_curriculum_items(blanked([rich_text, bare]), self.fields)
        self.assertNotEqual(outline(full), outline(lean))
        self.assertFalse(programme_workspace_reads.component_text_cancels([rich_text, bare], self.fields))


class TextlessChildRowsTests(SimpleTestCase):
    def setUp(self):
        self.reads = []
        rows = {
            views.AUTHORING_COMPONENTS_TABLE: [{'id': 'C1', 'module_catalogue_id': 'M1', 'week_id': 'W1', 'type': 'reading'}],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [],
        }

        def compact(table, where_sql, params, order_sql, *, columns=None, reuse_unchanged=False):
            self.reads.append((table, tuple(columns or ())))
            return copy.deepcopy(rows.get(table, []))

        stack = self.enterContext(ExitStack())
        stack.enter_context(patch('curriculum_api.authoring_read_transport.compact_authoring_rows', side_effect=compact))
        stack.enter_context(patch.object(views, 'live_authoring_rows_sql', return_value=('', [])))
        stack.enter_context(patch.object(views, 'authoring_fetch_all', return_value=[]))

    def test_textless_read_asks_for_no_text_and_blanks_it_identically(self):
        shared = programme_workspace_reads.programme_structure_child_rows(['M1'], component_text=False)
        component_columns = dict(self.reads)[views.AUTHORING_COMPONENTS_TABLE]
        for column in TEXT:
            self.assertNotIn(column, component_columns)
        self.assertEqual(
            set(component_columns),
            set(views.CATALOGUE_SUMMARY_COMPONENT_COLUMNS) - set(TEXT),
        )
        self.assertEqual({column: shared['components'][0][column] for column in TEXT}, dict.fromkeys(TEXT, ''))

    def test_default_read_keeps_every_summary_column(self):
        programme_workspace_reads.programme_structure_child_rows(['M1'])
        self.assertEqual(dict(self.reads)[views.AUTHORING_COMPONENTS_TABLE], tuple(views.CATALOGUE_SUMMARY_COMPONENT_COLUMNS))


class WorkspaceCandidateFallbackTests(SimpleTestCase):
    def run_candidates(self, *, cancels, config=None):
        calls = []

        def child_rows(ids, component_text=True):
            calls.append(component_text)
            return {'components': [], 'mappings': [], 'modules': [], 'weeks': [], 'text': component_text}

        with patch.object(programme_workspace_reads, 'programme_structure_child_rows', side_effect=child_rows), \
                patch.object(programme_workspace_reads, 'component_text_cancels', return_value=cancels), \
                patch.object(views, 'programme_authoring_module_rows', return_value=[{'module_catalogue_id': 'M1'}]), \
                patch.object(views, 'enrich_curriculum_modules_with_authoring_details',
                             side_effect=lambda modules, child_rows: [{'from': 'enrich', 'text': child_rows['text']}]), \
                patch.object(views, 'programme_authoring_modules',
                             side_effect=lambda programme, config, module_rows, child_rows: [{'from': 'authoring', 'text': child_rows['text']}]), \
                patch.object(views, 'programme_config_modules', return_value=[]):
            result = views.programme_workspace_module_candidates([{'moduleCatalogueId': 'M1'}], {'id': 'P1'}, config)
        return calls, result

    def test_cancelling_text_is_never_read(self):
        calls, result = self.run_candidates(cancels=True)
        self.assertEqual(calls, [False])
        self.assertEqual({item['text'] for item in result}, {False})

    def test_a_deciding_text_is_read_and_the_textless_candidates_discarded(self):
        calls, result = self.run_candidates(cancels=False)
        self.assertEqual(calls, [False, True])
        self.assertEqual({item['text'] for item in result}, {True})

    def test_config_stored_modules_keep_the_full_read(self):
        calls, result = self.run_candidates(cancels=True, config={'modules': [{'moduleCatalogueId': 'M9'}]})
        self.assertEqual(calls, [True])
        self.assertEqual({item['text'] for item in result}, {True})
