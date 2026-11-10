"""No-database tests for the free-course catalogue save on the new database.

Covers the pure decisions in free_course_catalogue_store: which stored ids a
save keeps, when a row counts as changed, and how stored order and archived
weeks are preserved so an unchanged save writes nothing. The database writes
and the in-use refusal were exercised on a disposable Neon branch.
"""
from django.test import SimpleTestCase

from curriculum_api import free_course_catalogue_store as store


class WeekIdTests(SimpleTestCase):
    stored = {
        'FREEWLINK-MM-WEEK-1': {'course_id': 'FREECOURSE-MM-MOD-1'},
        'FREEWEEK-2026A': {'course_id': 'FREECOURSE-OTHER'},
    }

    def test_a_stored_week_of_the_same_course_keeps_its_id(self):
        module = {'weekId': 'FREEWLINK-MM-WEEK-1'}  # an edited draft sends no row id
        self.assertEqual(store._resolve_week_id(module, 'FREECOURSE-MM-MOD-1', self.stored, set()),
                         'FREEWLINK-MM-WEEK-1')

    def test_another_courses_week_is_not_taken_over(self):
        week = store._resolve_week_id({'id': 'FREEWEEK-2026A'}, 'FREECOURSE-MM-MOD-1', self.stored, set())
        self.assertNotEqual(week, 'FREEWEEK-2026A')
        self.assertTrue(week.startswith('FREEWEEK-'))

    def test_one_id_is_used_once_per_save(self):
        used = {'FREEWLINK-MM-WEEK-1'}
        week = store._resolve_week_id({'weekId': 'FREEWLINK-MM-WEEK-1'}, 'FREECOURSE-MM-MOD-1', self.stored, used)
        self.assertNotEqual(week, 'FREEWLINK-MM-WEEK-1')

    def test_template_ids_are_not_week_row_ids(self):
        week = store._resolve_week_id({'weekId': 'manual-week'}, 'FREECOURSE-NEW', self.stored, set())
        self.assertTrue(week.startswith('FREEWEEK-'))

    def test_real_course_ids_match_the_keep_pattern(self):
        for course_id in ('FREECOURSE-MM-MOD-202608220A19E33C5552', 'FREECOURSE-KBC-INC-M01-20260917',
                          'FREECOURSE-20261014112721309295C25544D98AFD'):
            self.assertTrue(store.COURSE_ID.match(course_id), course_id)


class ChangeDetectionTests(SimpleTestCase):
    def test_null_and_blank_text_are_the_same(self):
        self.assertFalse(store._changed({'description': ''}, {'description': None}))

    def test_json_text_compares_by_value(self):
        self.assertFalse(store._changed({'settings_json': '{"a": 1, "b": [2]}'}, {'settings_json': {'b': [2], 'a': 1}}))
        self.assertTrue(store._changed({'settings_json': '{"a": 2}'}, {'settings_json': {'a': 1}}))

    def test_decimal_hours_compare_as_numbers(self):
        from decimal import Decimal
        self.assertFalse(store._changed({'total_otjh': 4.0}, {'total_otjh': Decimal('4.00')}))

    def test_a_new_row_is_always_written(self):
        self.assertTrue(store._changed({'id': 'X'}, None))

    def test_settings_are_compared_by_the_postgres_jsonb_hash(self):
        # PostgreSQL prints jsonb keys by length, then bytes, with ', ' and ': '.
        # Checked against md5(settings_json::text) for all 816 rows of the new DB.
        self.assertEqual(store._jsonb_text({'bb': [1, 'é'], 'a': {'zz': None, 'y': True}}),
                         '{"a": {"y": true, "zz": null}, "bb": [1, "é"]}')
        stored = {'settings_md5': store._jsonb_md5('{"videoUrl": "x", "a": 1}')}
        self.assertFalse(store._changed({'settings_json': '{"a": 1, "videoUrl": "x"}'}, stored))
        self.assertTrue(store._changed({'settings_json': '{"a": 2, "videoUrl": "x"}'}, stored))


class StoredOrderTests(SimpleTestCase):
    def setUp(self):
        self.stored_courses = {'C1': {'display_order': 7}, 'C2': {'display_order': 3}}
        self.stored_weeks = {
            'W1': {'id': 'W1', 'course_id': 'C1', 'display_order': 10, 'week_number': 1, 'status': 'active'},
            'W2': {'id': 'W2', 'course_id': 'C1', 'display_order': 20, 'week_number': 2, 'status': 'active'},
            'WA': {'id': 'WA', 'course_id': 'C1', 'display_order': 30, 'week_number': 3, 'status': 'inactive',
                   'component_count': 4, 'total_otjh': 1.5},
        }

    def course(self):
        return {'display_order': 0, 'week_count': 2, 'component_count': 5, 'total_otjh': 2.0}

    def test_unchanged_sequence_keeps_stored_orders_and_counts_archived_weeks(self):
        courses = {'C1': self.course(), 'NEW': {'display_order': 1, 'week_count': 0, 'component_count': 0,
                                               'total_otjh': 0.0}}
        weeks = [{'id': 'W1', 'course_id': 'C1', 'display_order': 0}, {'id': 'W2', 'course_id': 'C1', 'display_order': 1}]
        store._keep_stored_order(courses, weeks, self.stored_courses, self.stored_weeks)
        self.assertEqual(courses['C1']['display_order'], 7)
        self.assertEqual(courses['NEW']['display_order'], 8)
        self.assertEqual([week['display_order'] for week in weeks], [10, 20])
        self.assertEqual((courses['C1']['week_count'], courses['C1']['component_count'], courses['C1']['total_otjh']),
                         (3, 9, 3.5))

    def test_a_reorder_renumbers_that_course(self):
        courses = {'C1': self.course()}
        weeks = [{'id': 'W2', 'course_id': 'C1', 'display_order': 0}, {'id': 'W1', 'course_id': 'C1', 'display_order': 1}]
        store._keep_stored_order(courses, weeks, self.stored_courses, self.stored_weeks)
        self.assertEqual([week['display_order'] for week in weeks], [0, 1])
