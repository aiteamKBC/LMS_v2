"""Run directly with Python: a group with no delivery day takes no tutor.

Production functions from views.py, loaded from source. No Django, no database.

The rule under test: a group holding a clock and no weekday has a slot nobody
can date -- its modules fall back to counting weeks off their start date and
every screen shows the delivery as empty. So there is nothing to place a tutor
on and nothing to check a clash against, and the assignment is refused with a
sentence naming the group the day has to be set on.

The other half of the same rule lives in `test_group_delivery_pattern_no_db`:
the module's own stored day must not stand in for the day its group lacks.
"""
import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
NAMES = {'clean_str', 'schedule_day_part', 'schedule_time_parts',
         'module_delivery_day_gap', 'tutor_assignment_delivery_day_error',
         'tutor_delivery_schedule'}


def load():
    namespace = {
        're': __import__('re'),
        'staff_assignment_key': lambda value: (
            '' if str(value or '').strip().lower() in ('', 'unassigned')
            else ' '.join(str(value).lower().split())
        ),
        # Stands in for the JsonResponse: the tests read the sentence and the
        # machine-readable parts, not the HTTP object.
        'json_error': lambda message, **extra: {'error': message, **extra},
        'safe_group_delivery_rows': lambda: {},
    }
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    assert len(nodes) == len(NAMES), NAMES - {node.name for node in nodes}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace


views = load()

DAYLESS = 'GROUP-DAYLESS'
DELIVERING = 'GROUP-DELIVERING'
UNSLOTTED = 'GROUP-UNSLOTTED'

GROUPS = {
    # The group in the report: a clock, and no weekday to hang it on.
    DAYLESS: {'group_id': DAYLESS, 'group_name': 'G2-Keith Customer Journey',
              'session_week_day': '', 'session_start_time': '09:00', 'session_end_time': '11:00'},
    DELIVERING: {'group_id': DELIVERING, 'group_name': 'G1-Keith Customer Journey',
                 'session_week_day': 'Wednesday', 'session_start_time': '09:00', 'session_end_time': '11:00'},
    # Never given a slot at all -- a different situation, and the module's own
    # pattern still answers there.
    UNSLOTTED: {'group_id': UNSLOTTED, 'group_name': 'Unscheduled Group',
                'session_week_day': '', 'session_start_time': '', 'session_end_time': ''},
}


def module(group_id, tutor='', day='Wednesday'):
    return {'module_catalogue_id': 'MOD-1', 'title': 'Customer Journey Optimisation',
            'group_id': group_id, 'tutor_name': tutor, 'session_week_day': day,
            'session_start_time': '09:00', 'session_end_time': '11:00', 'weekly_schedule': []}


def refusal(candidate, before=None):
    return views['tutor_assignment_delivery_day_error'](candidate, before=before, groups=GROUPS)


class DeliveryDayGapTests(unittest.TestCase):
    def test_a_clock_without_a_weekday_is_the_gap(self):
        self.assertEqual(
            views['module_delivery_day_gap'](module(DAYLESS), GROUPS)['group_id'], DAYLESS,
        )

    def test_a_group_that_delivers_has_no_gap(self):
        self.assertIsNone(views['module_delivery_day_gap'](module(DELIVERING), GROUPS))

    def test_a_group_never_given_a_slot_has_no_gap(self):
        # Nothing is missing: the module's own pattern is the answer here.
        self.assertIsNone(views['module_delivery_day_gap'](module(UNSLOTTED), GROUPS))

    def test_an_ungrouped_module_has_no_gap(self):
        self.assertIsNone(views['module_delivery_day_gap'](module(''), GROUPS))


class TutorAssignmentTests(unittest.TestCase):
    def test_assigning_a_tutor_is_refused_and_the_group_is_named(self):
        error = refusal(module(DAYLESS, tutor='Keith Rowland'), before=module(DAYLESS))
        self.assertIsNotNone(error)
        self.assertIn('G2-Keith Customer Journey', error['error'])
        self.assertIn('has no delivery day', error['error'])
        self.assertEqual(error['code'], 'missing_delivery_day')
        self.assertEqual(error['status'], 409)
        self.assertEqual(error['fields'], ['tutor'])
        self.assertEqual(error['groupId'], DAYLESS)

    def test_a_module_already_carrying_the_tutor_is_not_frozen(self):
        # Renaming or re-dating it must still save: the rule is that a booking
        # may not be MADE here, not that the module is stuck.
        self.assertIsNone(refusal(
            module(DAYLESS, tutor='Keith Rowland'),
            before=module(DAYLESS, tutor='Keith Rowland'),
        ))

    def test_changing_to_a_different_tutor_is_still_refused(self):
        self.assertIsNotNone(refusal(
            module(DAYLESS, tutor='Tutor One'),
            before=module(DAYLESS, tutor='Keith Rowland'),
        ))

    def test_clearing_the_tutor_is_allowed(self):
        for cleared in ('', 'Unassigned'):
            self.assertIsNone(refusal(
                module(DAYLESS, tutor=cleared), before=module(DAYLESS, tutor='Keith Rowland'),
            ), cleared)

    def test_a_group_that_delivers_takes_its_tutor(self):
        self.assertIsNone(refusal(module(DELIVERING, tutor='Keith Rowland'), before=module(DELIVERING)))

    def test_the_group_is_read_from_the_stored_module_when_the_save_omits_it(self):
        # Several save paths build a candidate from the fields they write, and a
        # module does not change group through any of them.
        candidate = {**module(DAYLESS, tutor='Keith Rowland'), 'group_id': ''}
        self.assertIsNotNone(refusal(candidate, before=module(DAYLESS)))


class ConflictCheckReadsTheSameRuleTests(unittest.TestCase):
    """The reported bug: the day nobody can see was still booking the tutor."""

    def test_a_dayless_group_leaves_the_schedule_with_no_day(self):
        resolved = views['tutor_delivery_schedule'](module(DAYLESS, tutor='Tutor One'), GROUPS)
        self.assertEqual(resolved['session_week_day'], '')
        self.assertEqual(resolved['weekly_schedule'], [])
        # Only the days go: the clock and the tutor are untouched.
        self.assertEqual(resolved['session_start_time'], '09:00')
        self.assertEqual(resolved['tutor_name'], 'Tutor One')

    def test_a_delivering_group_leaves_the_schedule_alone(self):
        stored = module(DELIVERING, tutor='Keith Rowland')
        self.assertIs(views['tutor_delivery_schedule'](stored, GROUPS), stored)

    def test_a_group_never_given_a_slot_leaves_the_schedule_alone(self):
        stored = module(UNSLOTTED, tutor='Keith Rowland')
        self.assertIs(views['tutor_delivery_schedule'](stored, GROUPS), stored)


if __name__ == '__main__':
    unittest.main()
