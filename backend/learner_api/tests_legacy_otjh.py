"""Database-free coverage for hours on saved plans without component IDs."""
from decimal import Decimal
from unittest.mock import MagicMock, create_autospec, patch

from django.test import SimpleTestCase

from .learner_detail import _annotate_otjh, _otjh_by_legacy_title


class LegacyOtjhLookupTests(SimpleTestCase):
    def setUp(self):
        self.cursor = MagicMock()
        # Match the real cursor signature so duplicate SQL arguments cannot
        # silently pass through a permissive mock.
        self.cursor.execute = create_autospec(lambda sql, params=None: None)
        self.cursor.fetchall.side_effect = [
            [('MOD-1', 'Legacy module')],
            [('WEEK-1', 'MOD-1', 'Week 1 updated', 1)],
            [('WEEK-1', 'reading', 'Current first reading', Decimal('1.25')),
             ('WEEK-1', 'reading', 'Current second reading', Decimal('2.50'))],
        ]
        connections = self.enterContext(patch('learner_api.learner_detail.connections'))
        connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = self.cursor

    def test_renamed_weeks_and_readings_retain_their_hours_and_total(self):
        components = [
            {'module': 'Legacy module', 'week': 'Week 1 original', 'component': 'Reading · Original first'},
            {'module': 'Legacy module', 'week': 'Week 1 original', 'component': 'Reading · Original second'},
        ]
        annotated, total = _annotate_otjh(components)
        self.assertEqual([item['expectedOtjh'] for item in annotated], [1.25, 2.5])
        self.assertEqual(total, 3.75)

    def test_structured_components_do_not_use_the_legacy_lookup(self):
        self.assertEqual(_otjh_by_legacy_title([{'componentId': 'COMP-1', 'module': 'Current module'}]), {})
        self.cursor.execute.assert_not_called()
