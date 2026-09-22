"""AST-loaded business-calendar checks: no Django setup, database, or network."""
import ast
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from zoneinfo import ZoneInfo


ENGLAND_HOLIDAYS = [
    {
        'id': 'england-and-wales:2026-12-25',
        'title': 'Christmas Day',
        'holiday_date': '2026-12-25',
        'division': 'england-and-wales',
    },
    {
        'id': 'local-closure',
        'label': 'College closure',
        'start_date': '2026-09-22',
        'end_date': '2026-09-22',
    },
]


class EnglandNonDeliveryCalendarTests(TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).with_name('views.py').read_text(encoding='utf-8')
        tree = ast.parse(source)
        names = {'england_non_delivery_reason', 'teams_non_delivery_reason'}
        selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        namespace = {
            'date': date,
            'datetime': datetime,
            'timedelta': timedelta,
            'timezone': timezone,
            'ZoneInfo': ZoneInfo,
            'NON_DELIVERY_WEEKEND_MESSAGE': 'Sessions and meetings can only be booked Monday to Friday.',
            'HOLIDAY_SOURCE_GOVUK': 'gov.uk',
            'parse_date': lambda value: value if isinstance(value, date) else date.fromisoformat(str(value)[:10]),
            'parse_graph_datetime': lambda value: datetime.fromisoformat(str(value).replace('Z', '+00:00')) if value else None,
            'parse_int': lambda value, fallback=0: int(value or fallback),
            'clean_str': lambda value: str(value or '').strip(),
            'holiday_row_source': lambda row: 'gov.uk' if row.get('division') or row.get('holiday_date') else 'authored',
            'holiday_date_set': cls.holiday_date_set,
            'get_holiday_rows_safe': lambda: (_ for _ in ()).throw(AssertionError('database access forbidden')),
        }
        exec(compile(ast.Module(body=selected, type_ignores=[]), str(Path(__file__).with_name('views.py')), 'exec'), namespace)
        cls.england_non_delivery_reason = staticmethod(namespace['england_non_delivery_reason'])
        cls.teams_non_delivery_reason = staticmethod(namespace['teams_non_delivery_reason'])

    @staticmethod
    def holiday_date_set(rows):
        result = set()
        for row in rows:
            start = date.fromisoformat(str(row.get('holiday_date') or row.get('start_date'))[:10])
            end = date.fromisoformat(str(row.get('end_date') or start)[:10])
            while start <= end:
                result.add(start)
                start += timedelta(days=1)
        return result

    def test_allows_an_ordinary_weekday(self):
        self.assertEqual(self.england_non_delivery_reason(date(2026, 9, 21), ENGLAND_HOLIDAYS), '')

    def test_blocks_saturday_and_sunday(self):
        for value in (date(2026, 9, 19), date(2026, 9, 20)):
            with self.subTest(value=value):
                self.assertIn('Monday to Friday', self.england_non_delivery_reason(value, ENGLAND_HOLIDAYS))

    def test_blocks_an_england_and_wales_bank_holiday_by_name(self):
        reason = self.england_non_delivery_reason(date(2026, 12, 25), ENGLAND_HOLIDAYS)
        self.assertIn('England and Wales bank holiday', reason)
        self.assertIn('Christmas Day', reason)

    def test_does_not_treat_an_authored_closure_as_a_national_holiday(self):
        self.assertEqual(self.england_non_delivery_reason(date(2026, 9, 22), ENGLAND_HOLIDAYS), '')

    def test_teams_targets_are_checked_in_the_england_business_timezone(self):
        reason = self.teams_non_delivery_reason(
            [{'session_number': 3, 'start': datetime(2026, 9, 18, 23, 30, tzinfo=timezone.utc)}],
            'Europe/London',
            ENGLAND_HOLIDAYS,
        )
        self.assertIn('Session 3', reason)
        self.assertIn('Monday to Friday', reason)


if __name__ == '__main__':
    import unittest
    unittest.main()
