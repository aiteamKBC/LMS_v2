"""Prices are metadata: content, assignments and historical hours stay intact."""
import json
from decimal import Decimal

from django.db import IntegrityError, connection, transaction
from django.test import RequestFactory

from . import views as v
from .tests import CurriculumPersistenceHarness
from . import tests_standalone_courses as standalone


class CoursePricingTests(CurriculumPersistenceHarness):
    def create(self, **pricing):
        payload = {**standalone.StandaloneCourseTests.payload(self), **pricing}
        request = RequestFactory().post('/', json.dumps({
            **payload, 'moduleType': 'authoring', 'catalogueId': 'MOD-FREE',
        }), content_type='application/json')
        return v.curriculum_module_collection(request)

    def edit(self, **values):
        return v.curriculum_module_detail(RequestFactory().patch(
            '/', json.dumps(values), content_type='application/json'), 'MOD-FREE')

    def test_create_and_catalogue_return_exact_gbp_price(self):
        response = self.create(isForSale=True, price='49.99', currency='GBP')
        self.assertEqual(response.status_code, 201, response.content)
        stored = v.authoring_module_exists('MOD-FREE')
        self.assertEqual(stored['price'], Decimal('49.99'))
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
        self.assertIsNone(v.authoring_module_exists('MOD-FREE')['price'])
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
        self.assertIsNone(v.authoring_module_exists('MOD-OTHER')['price'])

    def test_price_update_and_sale_disable_do_not_change_content(self):
        self.create(isForSale=True, price='49.99')
        before = v.get_authoring_structure_payload('MOD-FREE')['weekStructure']
        response = self.edit(price='75.50')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['price'], '75.50')
        response = self.edit(isForSale=False)
        self.assertEqual(response.status_code, 200, response.content)
        stored = v.authoring_module_exists('MOD-FREE')
        self.assertFalse(stored['is_for_sale'])
        self.assertIsNone(stored['price'])
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['weekStructure'], before)

    def test_invalid_price_is_rejected_without_changes(self):
        self.create(isForSale=True, price='49.99')
        before = v.authoring_module_exists('MOD-FREE')
        for value in (None, '', '0', '-1', '1.001', 'NaN', 'Infinity', True, '1e2', '100000000', {}, []):
            with self.subTest(price=value):
                response = self.edit(price=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(v.authoring_module_exists('MOD-FREE'), before)
        for values in ({'currency': 'USD'}, {'currency': None}, {'isForSale': 'true'}, {'isForSale': None}):
            response = self.edit(**values)
            self.assertEqual(response.status_code, 400, response.content)
            self.assertEqual(v.authoring_module_exists('MOD-FREE'), before)

    def test_sale_requires_price_and_price_bounds_roundtrip(self):
        self.assertEqual(self.create(isForSale=True).status_code, 400)
        self.assertFalse(v.authoring_module_exists('MOD-FREE'))
        self.assertEqual(self.create(isForSale=True, price='0.01').status_code, 201)
        self.assertEqual(self.edit(price='99999999.99').status_code, 200)
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['price'], '99999999.99')

    def test_database_rejects_inconsistent_sale_metadata(self):
        self.create()
        table = v.authoring_table_name(v.AUTHORING_MODULES_TABLE)
        for update in ('is_for_sale = true', 'price = 1', "currency = 'USD'"):
            with self.subTest(update=update), self.assertRaises(IntegrityError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(f"UPDATE {table} SET {update} WHERE module_catalogue_id = %s", ['MOD-FREE'])
