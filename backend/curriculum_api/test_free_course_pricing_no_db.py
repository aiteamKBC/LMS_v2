"""Free-course pricing lives on curriculum.free_courses only, without a database.

Only a free course is ever for sale. On the old database a free course is also a
module, joined to its free_courses row by module_catalogue_id; its price is read
and written there, never on modules (whose sale columns are dropped). On the new
database the free-course catalogue save keeps the price per course. Nothing here
opens a connection.
"""
from decimal import Decimal
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import free_course_catalogue_store as store
from curriculum_api import free_course_pricing as pricing
from curriculum_api import views

LINKED = ['id', 'module_catalogue_id', 'course_name', 'is_for_sale', 'price', 'currency']
SELF_CONTAINED = ['id', 'course_name', 'is_for_sale', 'price', 'currency']
FREE = {'module_catalogue_id': 'MOD-FREE', 'source_type': 'free_course'}
PLAIN = {'module_catalogue_id': 'MOD-1', 'source_type': 'module_authoring'}


class FakeCursor:
    def __init__(self, rowcount):
        self.rowcount, self.calls = rowcount, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))


class ReadTests(SimpleTestCase):
    def test_a_list_without_a_free_course_reads_nothing(self):
        with mock.patch.object(views, 'fetch_all') as fetch:
            self.assertEqual(pricing.lookup([PLAIN]), {})
        fetch.assert_not_called()

    def test_free_courses_are_read_from_their_own_rows_in_one_query(self):
        stored = [{'module_catalogue_id': 'MOD-FREE', 'is_for_sale': True, 'price': Decimal('49.5'), 'currency': 'GBP'}]
        with mock.patch.object(views, 'column_names', return_value=LINKED), \
             mock.patch.object(views, 'fetch_all', return_value=stored) as fetch:
            prices = pricing.lookup([FREE, PLAIN])
        sql, params = fetch.call_args.args
        self.assertIn('free_courses', sql)
        self.assertEqual(params, ['MOD-FREE'])
        self.assertEqual(pricing.payload(FREE, prices), {'isForSale': True, 'price': '49.50', 'currency': 'GBP'})

    def test_a_plain_module_is_never_for_sale(self):
        # Even if a stale module row still carries the old mirror columns.
        self.assertEqual(pricing.payload({**PLAIN, 'is_for_sale': True, 'price': 9}, {}),
                         {'isForSale': False, 'price': None, 'currency': 'GBP'})

    def test_without_the_module_link_nothing_is_read(self):
        with mock.patch.object(views, 'column_names', return_value=SELF_CONTAINED), \
             mock.patch.object(views, 'fetch_all') as fetch:
            self.assertEqual(pricing.lookup([FREE]), {})
        fetch.assert_not_called()


class SaveTests(SimpleTestCase):
    def _save(self, values, rowcount=1, columns=LINKED):
        cursor = FakeCursor(rowcount)
        connection = mock.MagicMock()
        connection.cursor.return_value = cursor
        with mock.patch.object(views, 'column_names', return_value=columns), \
             mock.patch.object(pricing, 'connection', connection):
            result = pricing.save('MOD-FREE', values)
        return result, cursor

    def test_the_price_is_written_to_the_free_course_row(self):
        result, cursor = self._save({'is_for_sale': True, 'price': Decimal('10.00'), 'currency': 'GBP'})
        sql, params = cursor.calls[0]
        self.assertTrue(sql.startswith('update') and 'free_courses' in sql and 'where module_catalogue_id = %s' in sql)
        self.assertEqual(params, [True, Decimal('10.00'), 'GBP', 'MOD-FREE'])
        self.assertEqual(result, 1)

    def test_a_price_with_nowhere_to_go_fails_the_save(self):
        with self.assertRaises(pricing.FreeCoursePricingUnavailable):
            self._save({'is_for_sale': True, 'price': Decimal('10.00'), 'currency': 'GBP'}, rowcount=0)
        with self.assertRaises(pricing.FreeCoursePricingUnavailable):
            self._save({'is_for_sale': True, 'price': Decimal('10.00'), 'currency': 'GBP'}, columns=SELF_CONTAINED)

    def test_not_for_sale_with_nowhere_to_go_is_left_alone(self):
        result, _cursor = self._save({'is_for_sale': False, 'price': None, 'currency': 'GBP'}, rowcount=0)
        self.assertEqual(result, 0)


class ModuleSaveValuesTests(SimpleTestCase):
    def test_a_plain_module_cannot_be_put_on_sale(self):
        with self.assertRaises(views.ModuleAuthoringValidationError) as raised:
            views.free_course_sale_values({'isForSale': True, 'price': '5'}, PLAIN, False)
        self.assertEqual(raised.exception.errors[0]['path'], 'isForSale')

    def test_a_plain_module_save_stores_no_price(self):
        self.assertEqual(views.free_course_sale_values({'title': 'x'}, PLAIN, False),
                         {'is_for_sale': False, 'price': None, 'currency': 'GBP'})

    def test_a_free_course_keeps_its_stored_price_when_the_save_omits_it(self):
        stored = {'is_for_sale': True, 'price': Decimal('12.00'), 'currency': 'GBP'}
        with mock.patch.object(pricing, 'stored', return_value=stored):
            values = views.free_course_sale_values({'title': 'x'}, FREE, True)
        self.assertEqual(values, {'is_for_sale': True, 'price': Decimal('12.00'), 'currency': 'GBP'})

    def test_an_invalid_free_course_price_is_a_validation_error(self):
        with mock.patch.object(pricing, 'stored', return_value={}), \
             self.assertRaises(views.ModuleAuthoringValidationError) as raised:
            views.free_course_sale_values({'isForSale': True, 'price': '0'}, FREE, True)
        self.assertEqual(raised.exception.errors[0]['path'], 'price')


class CatalogueSaveTests(SimpleTestCase):
    """The new database's catalogue save keeps the price on each course row."""

    STORED = {'id': 'FREECOURSE-A', 'course_name': 'Excel', 'description': '', 'cover_image_url': '',
              'display_order': 0, 'week_count': 1, 'component_count': 0, 'total_otjh': 0,
              'is_for_sale': True, 'price': Decimal('20.00'), 'currency': 'GBP'}

    def _save(self, module):
        writes = {}

        def bulk(table, rows, columns):
            writes[table] = rows

        patches = [
            mock.patch.object(store, '_rows_many', return_value=([dict(self.STORED)], [], [])),
            mock.patch.object(store, '_bulk_upsert', side_effect=bulk),
            mock.patch.object(store, '_delete_ids'),
            mock.patch.object(store, 'refuse_in_use'),
            mock.patch.object(views, 'stored_module_cover_image', side_effect=lambda _id, url: url),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        store._save_catalogue('FREE-COURSES', [{'courseId': 'FREECOURSE-A', 'courseName': 'Excel', 'components': [], **module}])
        return writes.get(views.FREE_COURSES_TABLE) or []

    def test_an_omitted_price_is_kept(self):
        self.assertEqual(self._save({}), [])  # nothing about the course changed, so nothing is written

    def test_a_new_price_is_written_on_the_course(self):
        [row] = self._save({'isForSale': True, 'price': '35.5'})
        self.assertEqual((row['is_for_sale'], row['price'], row['currency']), (True, Decimal('35.50'), 'GBP'))

    def test_taking_a_course_off_sale_clears_its_price(self):
        [row] = self._save({'isForSale': False})
        self.assertEqual((row['is_for_sale'], row['price']), (False, None))

    def test_an_invalid_price_names_the_course(self):
        with self.assertRaises(ValueError) as raised:
            self._save({'isForSale': True, 'price': 'abc'})
        self.assertTrue(str(raised.exception).startswith('Excel: '))
