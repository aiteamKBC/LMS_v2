"""Prices are metadata: content, assignments and historical hours stay intact.

A free course's price is stored on its curriculum.free_courses row (joined on
module_catalogue_id), never on the module (free_course_pricing).
"""
import json
from decimal import Decimal

from django.db import IntegrityError, connection, transaction
from django.test import RequestFactory

from . import free_course_pricing
from . import views as v
from .tests import CurriculumPersistenceHarness
from . import tests_standalone_courses as standalone
from .tests_free_course_native_storage import prepare_native_authoring_fixture
from . import free_course_native_schema, learning_storage


class CoursePricingTests(CurriculumPersistenceHarness):
    def setUp(self):
        super().setUp()
        prepare_native_authoring_fixture()
        free_course_native_schema.detach(connection)
        self.addCleanup(learning_storage.reset)

    def create(self, **pricing):
        payload = {**standalone.StandaloneCourseTests.payload(self), **pricing}
        request = RequestFactory().post('/', json.dumps({
            **payload, 'moduleType': 'authoring', 'catalogueId': 'MOD-FREE',
        }), content_type='application/json')
        return v.curriculum_module_collection(request)

    def sale(self, module_id='MOD-FREE'):
        """The stored sale values of a module's free course (``{}`` when it has none)."""
        return free_course_pricing.stored({'module_catalogue_id': module_id, 'source_type': 'free_course'})

    def edit(self, **values):
        return v.curriculum_module_detail(RequestFactory().patch(
            '/', json.dumps(values), content_type='application/json'), 'MOD-FREE')

    def test_create_and_catalogue_return_exact_gbp_price(self):
        response = self.create(isForSale=True, price='49.99', currency='GBP')
        self.assertEqual(response.status_code, 201, response.content)
        stored = v.authoring_module_exists('MOD-FREE')
        self.assertEqual(self.sale()['price'], Decimal('49.99'))
        summary = v.authoring_catalogue_summaries()['MOD-FREE']
        compact = v.compact_module_list_rows([v.authoring_summary_catalogue_item(summary)])[0]
        for result in (json.loads(response.content)['module'], summary, compact):
            self.assertTrue(result['isForSale'])
            self.assertEqual(result['price'], '49.99')
            self.assertEqual(result['currency'], 'GBP')
        self.assertEqual(float(stored['total_otjh']), 2)

    def test_defaults_and_existing_courses_can_be_priced(self):
        response = self.create()
        self.assertFalse(json.loads(response.content)['module']['isForSale'])
        self.assertIsNone(self.sale().get('price'))
        response = self.edit(isForSale=True, price='125', currency='GBP')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content)['module']['price'], '125.00')

    def test_partial_edit_and_content_save_preserve_price_and_other_course(self):
        self.create(isForSale=True, price='49.99')
        v.save_module_authoring_structure('MOD-OTHER', {'title': 'Other course', 'isFreeCourse': True}, repair_links=False)
        response = self.edit(name='Renamed')
        self.assertEqual(response.status_code, 200, response.content)
        payload = v.get_authoring_structure_payload('MOD-FREE')
        payload['weekStructure'][0]['components'][0]['title'] = 'Edited reading'
        for field in ('isForSale', 'price', 'currency'):
            payload.pop(field)
        saved = v.save_module_authoring_structure('MOD-FREE', payload, repair_links=False)
        self.assertEqual(saved['price'], '49.99')
        self.assertEqual(saved['totalOtjh'], 2)
        self.assertIsNone(self.sale('MOD-OTHER').get('price'))

    def test_price_update_and_sale_disable_do_not_change_content(self):
        self.create(isForSale=True, price='49.99')
        before = v.get_authoring_structure_payload('MOD-FREE')['weekStructure']
        response = self.edit(price='75.50')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['price'], '75.50')
        response = self.edit(isForSale=False)
        self.assertEqual(response.status_code, 200, response.content)
        stored = self.sale()
        self.assertFalse(stored['is_for_sale'])
        self.assertIsNone(stored['price'])
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['weekStructure'], before)

    def test_invalid_price_is_rejected_without_changes(self):
        self.create(isForSale=True, price='49.99')
        before = (v.authoring_module_exists('MOD-FREE'), self.sale())
        for value in (None, '', '0', '-1', '1.001', 'NaN', 'Infinity', True, '1e2', '100000000', {}, []):
            with self.subTest(price=value):
                response = self.edit(price=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual((v.authoring_module_exists('MOD-FREE'), self.sale()), before)
        for values in ({'currency': 'USD'}, {'currency': None}, {'isForSale': 'true'}, {'isForSale': None}):
            response = self.edit(**values)
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual((v.authoring_module_exists('MOD-FREE'), self.sale()), before)

    def test_sale_requires_price_and_price_bounds_roundtrip(self):
        self.assertEqual(self.create(isForSale=True).status_code, 400)
        self.assertFalse(v.authoring_module_exists('MOD-FREE'))
        self.assertEqual(self.create(isForSale=True, price='0.01').status_code, 201)
        self.assertEqual(self.edit(price='99999999.99').status_code, 200)
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['price'], '99999999.99')

    def test_database_rejects_inconsistent_sale_metadata(self):
        self.create()
        # Prices are owned by the free-course table after the native cutover.
        table = 'curriculum.free_courses'
        for update in ('is_for_sale = true', 'price = 1', "currency = 'USD'"):
            with self.subTest(update=update), self.assertRaises(IntegrityError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(f"UPDATE {table} SET {update} WHERE content_ref = %s", ['MOD-FREE'])
