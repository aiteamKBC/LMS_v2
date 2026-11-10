from django.test import SimpleTestCase, override_settings
from decimal import Decimal
from unittest.mock import MagicMock

from curriculum_api import free_course_authoring_mutations as mutations
from curriculum_api.free_course_writer_mode import CANONICAL, FROZEN, FreeCourseWriterDisabled, current_mode, require_mode


class FreeCourseMutationValidationTests(SimpleTestCase):
    def test_sale_metadata_reaches_canonical_update_columns(self):
        values = mutations._course_values({
            'courseName': 'Course', 'isForSale': True, 'price': '59.95', 'currency': 'GBP',
        })
        self.assertEqual(values['price'], Decimal('59.95'))
        self.assertTrue(values['is_for_sale'])
        self.assertEqual(values['currency'], 'GBP')
        cursor = MagicMock()
        mutations._update_row(cursor, 'free_courses', 'FREE-1', {}, values)
        sql, params = cursor.execute.call_args.args
        for column in ('is_for_sale', 'price', 'currency'):
            self.assertIn(column, sql)
        self.assertIn(Decimal('59.95'), params)
        self.assertEqual(params[-1], 'FREE-1')

    def test_disabling_sale_clears_price_and_invalid_prices_are_rejected(self):
        values = mutations._course_values({'courseName': 'Course', 'isForSale': False, 'price': '59.95'})
        self.assertIsNone(values['price'])
        for price in ('0', '-1', '100000000', 'NaN', 'invalid'):
            with self.subTest(price=price), self.assertRaises(mutations.MutationError):
                mutations._course_values({'courseName': 'Course', 'isForSale': True, 'price': price})

    def component(self, **overrides):
        return {
            "clientId": "component:one",
            "type": "reading",
            "title": "Read this",
            "settings": {},
            **overrides,
        }

    def week(self, **overrides):
        return {
            "clientId": "week:one",
            "title": "Week one",
            "status": "active",
            "components": [self.component()],
            **overrides,
        }

    def test_active_empty_week_is_rejected_but_inactive_empty_draft_is_allowed(self):
        with self.assertRaises(mutations.MutationError) as caught:
            mutations._validate_shape([self.week(components=[])])
        self.assertEqual(caught.exception.code, "active_week_empty")
        mutations._validate_shape([
            self.week(),
            self.week(clientId="week:two", title="Later", status="inactive", components=[]),
        ])

    def test_limits_are_enforced(self):
        with self.assertRaises(mutations.MutationError) as caught:
            mutations._validate_shape([self.week(components=[self.component(clientId=f"c:{index}") for index in range(101)])])
        self.assertEqual(caught.exception.code, "limit_exceeded")

    def test_client_ids_and_idempotency_keys_are_strict(self):
        seen = set()
        self.assertEqual(mutations._client_id("week:unique", seen, "clientId"), "week:unique")
        with self.assertRaises(mutations.MutationError):
            mutations._client_id("week:unique", seen, "clientId")
        self.assertEqual(mutations.validate_idempotency_key("create:12345678"), "create:12345678")
        with self.assertRaises(mutations.MutationError):
            mutations.validate_idempotency_key("short")

    def test_request_digest_is_deterministic_and_key_order_independent(self):
        left = mutations.request_digest({"b": [2, 1], "a": {"x": 1}})
        right = mutations.request_digest({"a": {"x": 1}, "b": [2, 1]})
        self.assertEqual(left, right)

    def test_component_type_change_is_forbidden(self):
        with self.assertRaises(mutations.MutationError) as caught:
            mutations._normalise_component(
                self.component(type="quiz"), index=0, existing={"type": "reading"}
            )
        self.assertEqual(caught.exception.code, "component_type_change_forbidden")

    def test_linked_quiz_cannot_be_changed_through_general_component_patch(self):
        with self.assertRaises(mutations.MutationError) as caught:
            mutations._normalise_component(
                self.component(settings={"linkedQuizId": "12"}),
                index=0,
                existing={"type": "reading", "settings_json": {"linkedQuizId": "11"}},
            )
        self.assertEqual(caught.exception.code, "linked_quiz_change_forbidden")


class FreeCourseWriterModeTests(SimpleTestCase):
    @override_settings(FREE_COURSE_AUTHORING_WRITE_MODE=FROZEN)
    def test_frozen_is_fail_closed(self):
        self.assertEqual(current_mode(), FROZEN)
        with self.assertRaises(FreeCourseWriterDisabled):
            require_mode(CANONICAL)

    @override_settings(FREE_COURSE_AUTHORING_WRITE_MODE=CANONICAL)
    def test_canonical_mode_allows_only_canonical_writer(self):
        require_mode(CANONICAL)
        with self.assertRaises(FreeCourseWriterDisabled):
            require_mode("legacy")
