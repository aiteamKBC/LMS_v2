"""Business-day boundary regression tests; no Django setup, network or database."""
import ast
from datetime import date, datetime, time, timedelta
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo


class Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, **filters):
        def matches(row):
            for key, expected in filters.items():
                field, _, operation = key.partition('__')
                actual = row[field]
                if operation == 'in' and actual not in expected:
                    return False
                if operation == 'gte' and actual < expected:
                    return False
                if operation == 'lt' and actual >= expected:
                    return False
            return True
        return Query([row for row in self.rows if matches(row)])

    def values_list(self, field, flat=False):
        return Values(row[field] for row in self.rows)

    def only(self, *fields):
        return [SimpleNamespace(**row) for row in self.rows]


class Values(list):
    def distinct(self):
        return Values(dict.fromkeys(self))


class DayMembershipTests(unittest.TestCase):
    def test_local_midnight_and_dst_boundaries_include_saved_unmarked_rows(self):
        source = Path(__file__).with_name('bulk_attendance_live_register.py')
        tree = ast.parse(source.read_text(encoding='utf-8'))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'read_live_day_learner_ids')
        zone = ZoneInfo('Europe/London')
        # UK fall-back: this local date spans 25 hours, not 24.
        moments = ['2026-10-24T22:59:59+00:00', '2026-10-24T23:00:00+00:00',
                   '2026-10-25T23:59:59+00:00', '2026-10-26T00:00:00+00:00']
        occurrences = Query([{'id': index, 'scheduled_start': datetime.fromisoformat(moment)}
                             for index, moment in enumerate(moments)])
        registers = Query([{'occurrence_id': index, 'learner_profile_id': index,
                            'attendance_status': None if index == 2 else 'present'} for index in range(4)])
        profiles = Query([{'id': index, 'aptem_id': str(300 + index)} for index in range(4)])
        namespace = {
            'datetime': datetime, 'time': time, 'timedelta': timedelta,
            'timezone': SimpleNamespace(get_current_timezone=lambda: zone,
                                        make_aware=lambda moment, tz: moment.replace(tzinfo=tz)),
            'LiveSessionOccurrence': SimpleNamespace(objects=occurrences),
            'LiveSessionLearnerAttendance': SimpleNamespace(objects=registers),
            'LearnerProfile': SimpleNamespace(objects=profiles),
        }
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), namespace)
        coach = ModuleType('coach_api.views')
        coach.resolve_effective_aptem_ids = lambda rows: ({row.id: row.aptem_id for row in rows}, [])
        with patch.dict(sys.modules, {'coach_api.views': coach}):
            self.assertEqual(namespace['read_live_day_learner_ids'](date(2026, 10, 25)), {'301', '302'})
            self.assertEqual(namespace['read_live_day_learner_ids'](date(2020, 1, 2)), set())


if __name__ == '__main__':
    unittest.main()
