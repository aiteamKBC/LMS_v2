"""Exercise the real planner with synthetic rows; no Django, database or network."""
import ast
import unittest
from pathlib import Path


class NumberedSessionHeaderTests(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'apply_module_session_plan_to_weeks')
        self.sessions = [
            {'sessionNumber': 1, 'date': '2026-10-03', 'day': 'Saturday'},
            {'sessionNumber': 2, 'date': '2026-10-10', 'day': 'Saturday'},
        ]
        context = {
            'module_week_delivery_slots': lambda *args, **kwargs: (
                [[self.sessions[0]], [self.sessions[1]]], self.sessions),
            'module_session_clock': lambda *args: ('09:00', '11:00', 120),
            'module_live_session_clock': lambda *args, **kwargs: ('09:00', '11:00', 120),
            'calendar_clock_to_utc_iso': lambda date, clock, zone: f'{date}T{clock}:00Z',
            'parse_int': lambda value, default: int(value or default),
            'clean_str': lambda value: str(value or '').strip(),
            'format_date': lambda value: str(value or ''),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'planner-under-test', 'exec'), context)
        self.apply = context[function.name]

    def weeks(self, number=1, **settings):
        return [
            {'id': 'orientation', 'components': []},
            {'id': 'teaching', 'components': [{
                'id': 'live-1', 'type': 'live-session',
                'settings': {'teamsSessionNumber': number, **settings},
            }]},
        ]

    def test_reordered_numbered_session_and_week_keep_the_same_date(self):
        result = self.apply({}, {}, self.weeks(), holidays=[])
        week = result[1]
        self.assertEqual(week['components'][0]['settings']['sessionDate'], '2026-10-03')
        self.assertEqual(week['sessionDate'], '2026-10-03')
        self.assertEqual(week['sessionDay'], 'Saturday')
        self.assertEqual(week['components'][0]['id'], 'live-1')

    def test_booked_numbered_session_keeps_its_confirmed_date_in_the_header(self):
        weeks = self.weeks(teamsLiveSessionId='meeting-1', sessionDate='2026-09-26',
                           sessionDay='Saturday', joinUrl='https://example.invalid/meeting-1')
        before = dict(weeks[1]['components'][0]['settings'])
        result = self.apply({}, {}, weeks, holidays=[])
        self.assertEqual(result[1]['components'][0]['settings'], before)
        self.assertEqual(result[1]['sessionDate'], '2026-09-26')

    def test_unnumbered_session_keeps_positional_behavior(self):
        result = self.apply({}, {}, self.weeks(number=0), holidays=[])
        self.assertEqual(result[1]['sessionDate'], '2026-10-10')
        self.assertEqual(result[1]['components'][0]['settings']['sessionDate'], '2026-10-10')

    def test_removed_session_number_falls_back_to_the_week_slot(self):
        result = self.apply({}, {}, self.weeks(number=99), holidays=[])
        self.assertEqual(result[1]['sessionDate'], '2026-10-10')
        self.assertEqual(result[1]['components'][0]['settings']['sessionDate'], '2026-10-10')

    def test_explicit_reschedule_updates_both_booked_session_and_header(self):
        self.sessions[0].update(date='2026-10-04', day='Sunday', rescheduled=True)
        result = self.apply({}, {}, self.weeks(teamsLiveSessionId='meeting-1',
                           sessionDate='2026-09-26', sessionDay='Saturday'), holidays=[])
        self.assertEqual(result[1]['sessionDate'], '2026-10-04')
        self.assertEqual(result[1]['sessionDay'], 'Sunday')
        self.assertEqual(result[1]['components'][0]['settings']['sessionDate'], '2026-10-04')


if __name__ == '__main__':
    unittest.main()
