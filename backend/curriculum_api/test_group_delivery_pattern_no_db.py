"""Run directly with Python: the group states when a module's sessions run.

Production functions from views.py, loaded from source. No Django, no database.

The rule under test: the group is where a cohort is told when it meets, so the
delivery days and clock it states govern every module delivered to it. A
module's own stored pattern answers only where its group states none.
"""
import ast
import importlib.util
import unittest
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).parent
NAMES = {'clean_str', 'parse_date', 'schedule_time_parts', 'schedule_day_part', 'parse_clock_minutes',
         'json_db_value', 'module_delivery_row', 'module_session_clock', 'module_live_session_clock'}


def standalone(name):
    """A dependency-free sibling module, imported without the Django package."""
    spec = importlib.util.spec_from_file_location(f'_{name}', ROOT / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load():
    weekly = standalone('weekly_schedule')
    overrides = standalone('session_overrides')
    namespace = {
        'date': date, 'datetime': datetime, 're': __import__('re'), 'json': __import__('json'),
        'DEFAULT_SESSION_START_TIME': '09:00', 'DEFAULT_SESSION_END_TIME': '10:00',
        'module_weekly_schedule': weekly.module_weekly_schedule,
        'override_clock': overrides.override_clock,
        'parse_int': lambda value, default=0: int(value) if str(value or '').strip().lstrip('-').isdigit() else default,
        'clock_time_plus_minutes': lambda start, minutes: start,
    }
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace


views = load()
# G2 as it is stored: Thursday, 09:00-11:00.
GROUP = {'session_week_day': 'Thursday', 'session_start_time': '09:00', 'session_end_time': '11:00'}


class GroupFirstTests(unittest.TestCase):
    def clock(self, module, group=GROUP, session_date='2026-09-03'):
        return views['module_session_clock'](module, group, session_date)[:2]

    def test_the_group_states_the_day_and_clock_a_module_runs_to(self):
        # The module was authored to its own slot; the group has since moved.
        module = {'session_week_day': 'Monday', 'session_start_time': '14:00', 'session_end_time': '16:00'}
        resolved = views['module_delivery_row'](module, GROUP)
        self.assertEqual(resolved['session_week_day'], 'Thursday')
        self.assertEqual((resolved['session_start_time'], resolved['session_end_time']), ('09:00', '11:00'))
        self.assertEqual(self.clock(module), ('09:00', '11:00'))

    def test_a_module_answers_where_its_group_states_nothing(self):
        module = {'session_week_day': 'Monday', 'session_start_time': '14:00', 'session_end_time': '16:00'}
        for group in ({}, None, {'session_week_day': '', 'session_start_time': '', 'session_end_time': ''}):
            resolved = views['module_delivery_row'](module, group)
            self.assertEqual(resolved['session_week_day'], 'Monday', group)
            self.assertEqual(self.clock(module, group), ('14:00', '16:00'), group)

    def test_a_group_that_states_only_a_clock_leaves_the_module_its_days(self):
        module = {'session_week_day': 'Monday, Friday', 'session_start_time': '14:00', 'session_end_time': '16:00'}
        resolved = views['module_delivery_row'](module, {'session_start_time': '09:00', 'session_end_time': '11:00'})
        self.assertEqual(resolved['session_week_day'], 'Monday, Friday')
        self.assertEqual((resolved['session_start_time'], resolved['session_end_time']), ('09:00', '11:00'))

    def test_a_stale_per_weekday_slot_no_longer_outranks_the_group(self):
        # The bug this rule exists for: the module kept a copy of the clock the
        # group has since moved away from, and the copy won.
        module = {'weekly_schedule': [{'day': 'Thursday', 'startTime': '07:00', 'endTime': '09:00'}]}
        self.assertEqual(self.clock(module), ('09:00', '11:00'))

    def test_the_group_naming_its_days_replaces_a_module_weekday_table(self):
        module = {'weekly_schedule': [{'day': 'Monday', 'startTime': '14:00', 'endTime': '16:00'}]}
        resolved = views['module_delivery_row'](module, GROUP)
        # Kept, the Monday slot would quietly add back a day the group does not
        # deliver on -- and the plan reads its days from this table first.
        self.assertEqual(views['module_weekly_schedule'](resolved), [])
        self.assertEqual(resolved['session_week_day'], 'Thursday')

    def test_a_weekday_table_still_answers_where_the_group_states_no_clock(self):
        module = {'weekly_schedule': [{'day': 'Thursday', 'startTime': '07:00', 'endTime': '09:00'}]}
        self.assertEqual(self.clock(module, {}), ('07:00', '09:00'))

    def test_one_date_moved_on_purpose_is_not_taken_back_by_the_group(self):
        # A per-date exception is a decision about that date -- a session people
        # were told about -- not a pattern the group can overrule.
        module = {'session_overrides': {'1': {'date': '2026-09-03', 'startTime': '13:00',
                                              'endTime': '15:00', 'durationMinutes': 120}}}
        self.assertEqual(self.clock(module), ('13:00', '15:00'))
        # Every other date still runs to the group's clock.
        self.assertEqual(self.clock(module, session_date='2026-09-10'), ('09:00', '11:00'))

    def test_nothing_is_written_back_to_the_module_row(self):
        module = {'session_week_day': 'Monday', 'session_start_time': '14:00'}
        before = dict(module)
        views['module_delivery_row'](module, GROUP)
        self.assertEqual(module, before)


if __name__ == '__main__':
    unittest.main()
