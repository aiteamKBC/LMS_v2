"""The tutor-clash guard refuses what a save creates, not what it inherited.

No database, no Django, no transport: `tutor_schedule_conflicts_created` is
lifted out of views.py on its own and asked its question against a stubbed
`find_tutor_schedule_conflicts`, so what is under test here is the subtraction
itself -- which clashes survive into the refusal -- and nothing else.
"""
import ast
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def clash(module_id, name, *dates):
    return {'moduleCatalogueId': module_id, 'moduleName': name, 'startTime': '09:00',
            'endTime': '10:00', 'dates': list(dates)}


class TutorConflictScopeTests(unittest.TestCase):
    def setUp(self):
        self.v = types.ModuleType('curriculum_api.views')
        self.v.clean_str = lambda value: str(value if value is not None else '').strip()
        self.v.staff_assignment_key = lambda value: str(value if value is not None else '').strip().lower()
        self.v.tutor_conflict_context = lambda rows=None: {'stored': [], 'holidays': {}}
        # Keyed by the schedule asked about, so the stored schedule and the one
        # the save proposes can answer differently -- which is the whole point.
        self.answers = {}
        self.queries = []

        def find_tutor_schedule_conflicts(candidate, **kwargs):
            self.queries.append((candidate, kwargs))
            key = (self.v.staff_assignment_key(candidate.get('tutor_name')),
                   self.v.clean_str(candidate.get('sessions_number')))
            return [dict(item, dates=list(item['dates'])) for item in self.answers.get(key, [])]

        self.v.find_tutor_schedule_conflicts = find_tutor_schedule_conflicts
        names = {'tutor_schedule_conflicts_created'}
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), self.v.__dict__)
        self.created = self.v.tutor_schedule_conflicts_created

    def stored(self, weeks='10', tutor='Ay Haga'):
        return {'tutor_name': tutor, 'sessions_number': weeks}

    def proposed(self, weeks='11', tutor='Ay Haga'):
        return {'tutor_name': tutor, 'sessions_number': weeks, 'module_catalogue_id': 'MOD-4'}

    def test_extending_the_end_date_is_not_refused_for_a_clash_it_inherited(self):
        """The reported bug: week 10 -> 11 refused over a clash in week one."""
        self.answers[('ay haga', '10')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        self.answers[('ay haga', '11')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        self.assertEqual(self.created(self.stored(), self.proposed()), [])

    def test_a_clash_on_the_week_the_save_adds_is_still_refused(self):
        self.answers[('ay haga', '10')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        self.answers[('ay haga', '11')] = [clash('MOD-9', 'Ay Haga', '2026-09-17', '2026-12-03')]
        created = self.created(self.stored(), self.proposed())
        self.assertEqual([item['dates'] for item in created], [['2026-12-03']])
        # The inherited date is dropped from the clash, not the clash from the list.
        self.assertEqual(created[0]['moduleName'], 'Ay Haga')

    def test_moving_the_tutor_into_an_existing_clash_is_refused(self):
        """A booking under a name the save is changing to is new, every date of it."""
        self.answers[('ay haga', '10')] = []
        self.answers[('zara', '10')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        created = self.created(self.stored(), self.proposed(weeks='10', tutor='Zara'))
        self.assertEqual([item['dates'] for item in created], [['2026-09-17']])

    def test_a_module_with_no_stored_tutor_inherits_nothing(self):
        self.answers[('zara', '10')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        created = self.created({}, self.proposed(weeks='10', tutor='Zara'))
        self.assertEqual([item['dates'] for item in created], [['2026-09-17']])

    def test_a_clean_save_never_asks_what_it_inherited(self):
        self.assertEqual(self.created(self.stored(), self.proposed()), [])
        self.assertEqual(len(self.queries), 1)

    def test_the_baseline_is_asked_without_this_save_s_other_modules(self):
        """A clash with a module saved alongside this one is created, not inherited."""
        self.answers[('ay haga', '10')] = []
        self.answers[('ay haga', '11')] = [clash('MOD-7', 'Sibling', '2026-10-01')]
        pending = [{'module_catalogue_id': 'MOD-7'}]
        created = self.created(self.stored(), self.proposed(), pending=pending)
        self.assertEqual([item['dates'] for item in created], [['2026-10-01']])
        baseline_kwargs = self.queries[-1][1]
        self.assertEqual(baseline_kwargs.get('pending'), ())

    def test_both_questions_share_one_prepared_stored_state(self):
        self.answers[('ay haga', '10')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        self.answers[('ay haga', '11')] = [clash('MOD-9', 'Ay Haga', '2026-09-17')]
        self.created(self.stored(), self.proposed())
        contexts = [kwargs.get('context') for _candidate, kwargs in self.queries[1:]]
        self.assertTrue(contexts and all(item is contexts[0] for item in contexts))


if __name__ == '__main__':
    unittest.main()
