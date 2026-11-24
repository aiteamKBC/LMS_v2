"""Real owner imports and synthetic calendar contracts; isolated runner only."""
import importlib
from unittest.mock import patch

from django.test import SimpleTestCase
from . import views, country_calendars, delivery_calendar, delivery_dashboard, calendar_read_rows
from .catalogue.infrastructure import country_calendar_reads, delivery_calendar_runtime, calendar_display, calendar_row_runtime
from .catalogue.api import delivery_dashboard as dashboard
from .catalogue.tests.parity.test_calendar_composition_standalone import MANIFEST


class CalendarCompositionRuntime(SimpleTestCase):
    def test_all_77_exports_reference_actual_owners(self):
        for name, owner in MANIFEST['functions'].items():
            self.assertIs(getattr(views, name), getattr(importlib.import_module('curriculum_api.' + owner), name), name)

    def test_calendar_compatibility_exports_keep_single_identity(self):
        for facade, owner, names in [
            (country_calendars, country_calendar_reads, ('CalendarUnavailable', 'saved_calendars', 'cache_status', 'holidays_for_period')),
            (delivery_calendar, delivery_calendar_runtime, ('module_policy', 'policy_holidays', 'module_holidays', 'policy_write', 'date_non_delivery_reason')),
            (delivery_calendar, calendar_display, ('display_cohort_holidays',)),
            (calendar_read_rows, calendar_row_runtime, ('live_rows',)),
            (delivery_dashboard, dashboard, ('build_calendar_snapshot', 'build_overview', 'calendar_sessions')),
        ]:
            for name in names:
                self.assertIs(getattr(facade, name), getattr(owner, name), name)

    def test_calendar_errors_are_scoped_to_the_affected_cohort(self):
        def read(ids):
            if ids == ['BAD']:
                raise country_calendars.CalendarUnavailable('Synthetic missing calendar')
            return {ids[0]: [{'date': '2026-11-23'}]}
        with patch.object(calendar_display, 'cohort_selected_holidays_by_cohort', side_effect=read) as query:
            result = calendar_display.display_cohort_holidays(['GOOD', 'BAD', 'GOOD'])
        self.assertEqual(result, {'GOOD': [{'date': '2026-11-23'}], 'BAD': [{'_calendarError': 'Synthetic missing calendar'}]})
        self.assertEqual(query.call_count, 2)

    def test_unexpected_calendar_errors_are_not_swallowed(self):
        with patch.object(calendar_display, 'cohort_selected_holidays_by_cohort', side_effect=ValueError('invalid policy')):
            with self.assertRaisesRegex(ValueError, 'invalid policy'):
                calendar_display.display_cohort_holidays(['BAD'])

    def test_inherited_selection_is_not_reapplied_or_refetched(self):
        selected = [{'date': '2026-11-23'}]
        with patch.object(delivery_calendar_runtime, 'module_policy', return_value={'country': 'US'}), \
             patch.object(delivery_calendar_runtime, 'read_policy', return_value=None), \
             patch.object(delivery_calendar_runtime, 'get_holiday_rows_safe') as read:
            result = delivery_calendar_runtime.module_holidays({'cohort_id': 'C'}, selected)
        self.assertEqual(result, selected)
        self.assertIsNot(result, selected)
        read.assert_not_called()

    def test_country_read_error_remains_visible_to_planning(self):
        with patch.object(delivery_calendar_runtime, 'holidays_for_period', side_effect=country_calendars.CalendarUnavailable('Synthetic expired calendar')):
            with self.assertRaisesRegex(country_calendars.CalendarUnavailable, 'Synthetic expired calendar'):
                delivery_calendar_runtime.policy_holidays({'country': 'US', 'observePublicHolidays': True}, '2026-11-23', None, [])

    def test_policy_encoding_refuses_missing_schema_without_writing(self):
        with patch.object(delivery_calendar_runtime, 'merge_policy', return_value={'country': 'US'}), \
             patch.object(delivery_calendar_runtime, 'has_column', return_value=False), \
             patch.object(delivery_calendar_runtime, 'holidays_for_period') as read:
            with self.assertRaisesRegex(ValueError, 'migration 0090'):
                delivery_calendar_runtime.policy_write({'calendarPolicy': {}}, {}, 'modules')
        read.assert_not_called()
