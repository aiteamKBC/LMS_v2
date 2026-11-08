"""The holiday calendar on calendar_holidays: shapes, cohort choices, GOV.UK mirror.

Nothing here opens a connection: the cursor is a recording double.
"""
from datetime import date
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import calendar_holidays as ch


class Cursor:
    def __init__(self, answers=None):
        self.answers = list(answers or [])
        self.statements = []
        self.rowcount = 1
        self._result = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.statements.append((' '.join(sql.split()), list(params or [])))
        self._result = self.answers.pop(0) if self.answers else []

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None


class Connection:
    vendor = 'postgresql'

    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


def patched(cursor):
    return mock.patch.object(ch, 'connection', Connection(cursor))


OFFICIAL_ROW = ('england:england-and-wales:2026-12-25', 'england_official', 'england-and-wales:2026-12-25',
                'Christmas Day', date(2026, 12, 25), date(2026, 12, 25), 'bank-holidays', None, '', False,
                'england-and-wales', True, None, None, None)
LOCAL_ROW = ('local:1113', 'local', '1113', 'Staff training', date(2026, 11, 2), date(2026, 11, 3), 'Events',
             '#123456', 'note', False, None, None, None, None, None)


class ShapeTests(SimpleTestCase):
    def test_both_kinds_come_back_in_their_own_shape_and_id(self):
        cursor = Cursor([[OFFICIAL_ROW, LOCAL_ROW]])
        with patched(cursor):
            official, local = ch.rows()
        self.assertEqual((official['id'], official['title'], official['holiday_date']),
                         ('england-and-wales:2026-12-25', 'Christmas Day', date(2026, 12, 25)))
        self.assertNotIn('label', official)
        self.assertEqual((local['id'], local['label'], local['type'], local['end_date']),
                         ('1113', 'Staff training', 'Events', date(2026, 11, 3)))
        # A withdrawn bank holiday kept only for a cohort's choice is not in the calendar.
        self.assertIn('not (source_kind = %s and is_archived)', cursor.statements[0][0])


class CohortChoiceTests(SimpleTestCase):
    def test_a_save_replaces_the_choices_and_the_returned_row_shows_them(self):
        cursor = Cursor([
            [],  # cohort_choices: nothing stored yet
            [],  # delete
            [('1113', 'local:1113'), ('england-and-wales:2026-12-25', 'england:england-and-wales:2026-12-25')],
        ])
        row = {'cohort_id': 'C-1', 'holiday_ids': ['stale']}
        with patched(cursor), mock.patch.object(ch, 'in_use', return_value=True):
            ch.store_cohort_choices({'holiday_ids': ['1113', 'GONE'],
                                     'excluded_holiday_ids': ['england-and-wales:2026-12-25']}, [row])
        self.assertEqual(row['holiday_ids'], ['1113'])
        self.assertEqual(row['excluded_holiday_ids'], ['england-and-wales:2026-12-25'])
        inserts = [params for sql, params in cursor.statements if sql.startswith('insert into')]
        self.assertEqual(inserts, [['C-1', 'local:1113', True, False],
                                   ['C-1', 'england:england-and-wales:2026-12-25', False, True]])

    def test_a_save_without_holiday_lists_writes_nothing(self):
        cursor = Cursor()
        with patched(cursor), mock.patch.object(ch, 'in_use', return_value=True):
            ch.store_cohort_choices({'cohort_name': 'A', 'cohort_id': 'C-1'}, [])
        self.assertEqual(cursor.statements, [])

    def test_choices_are_put_on_cohort_rows(self):
        cursor = Cursor([[('C-1', '1113', True, False), ('C-1', '1101', False, True)]])
        rows = [{'cohort_id': 'C-1'}, {'cohort_id': 'C-2'}]
        with patched(cursor), mock.patch.object(ch, 'in_use', return_value=True):
            ch.attach_cohort_choices(rows)
        self.assertEqual((rows[0]['holiday_ids'], rows[0]['excluded_holiday_ids']), (['1113'], ['1101']))
        self.assertEqual((rows[1]['holiday_ids'], rows[1]['excluded_holiday_ids']), ([], []))

    def test_off_the_calendar_table_nothing_is_read(self):
        cursor = Cursor()
        rows = [{'cohort_id': 'C-1'}]
        with patched(cursor), mock.patch.object(ch, 'in_use', return_value=False):
            ch.attach_cohort_choices(rows)
        self.assertNotIn('holiday_ids', rows[0])
        self.assertEqual(cursor.statements, [])


class MirrorTests(SimpleTestCase):
    def test_a_withdrawn_date_a_cohort_names_is_archived_not_deleted(self):
        cursor = Cursor()
        with patched(cursor), mock.patch.object(ch.transaction, 'atomic', return_value=mock.MagicMock()):
            ch.apply_official({'2026-12-28': {}}, [], [], [{'date': '2026-12-26'}], 'england-and-wales')
        sqls = [sql for sql, _ in cursor.statements]
        self.assertTrue(sqls[0].startswith('delete from "curriculum"."calendar_holidays" h'))
        self.assertIn('not exists (select 1 from "curriculum"."cohort_calendar_holidays" c', sqls[0])
        self.assertTrue(sqls[1].startswith('update "curriculum"."calendar_holidays" set is_archived = true'))

    def test_an_added_date_is_upserted_so_a_withdrawn_one_comes_back(self):
        cursor = Cursor()
        item = {'id': 'england-and-wales:2026-12-28', 'title': 'Boxing Day', 'date': '2026-12-28',
                'notes': 'Substitute day', 'bunting': True}
        with patched(cursor), mock.patch.object(ch.transaction, 'atomic', return_value=mock.MagicMock()):
            ch.apply_official({'2026-12-28': item}, [item], [], [], 'england-and-wales')
        sql, params = cursor.statements[0]
        self.assertIn('on conflict (source_kind, source_record_id) do update', sql)
        self.assertIn('is_archived = false', sql)
        self.assertEqual(params[:3], ['england:england-and-wales:2026-12-28', 'england_official',
                                      'england-and-wales:2026-12-28'])
