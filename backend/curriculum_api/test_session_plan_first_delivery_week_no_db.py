"""Week 1 is the week of the first delivery day: N weeks are N delivery weeks.

Pure planner calls with synthetic dates; no database rows, Graph or mail.
"""
from django.test import SimpleTestCase

from . import views


class FirstDeliveryWeekTests(SimpleTestCase):
    def plan(self, start, days, weeks):
        return views.build_module_session_plan(start, 0, days, holidays=[], week_count=weeks)

    def test_a_start_after_its_weeks_delivery_day_does_not_spend_a_week_on_nothing(self):
        # Sunday 4 Oct 2026, Wednesday group, five weeks: five Wednesdays, the
        # first on 7 Oct, numbered weeks 1-5 -- not four in weeks 2-5.
        plan = self.plan('2026-10-04', 'Wednesday', 5)
        self.assertEqual([s['date'] for s in plan['sessions']],
                         ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'])
        self.assertEqual([s['weekNumber'] for s in plan['sessions']], [1, 2, 3, 4, 5])
        self.assertEqual(plan['finalEndDate'], '2026-11-04')

    def test_a_mid_week_start_with_a_delivery_day_ahead_is_unchanged(self):
        # Wednesday 7 Oct start, Mon+Fri group: Friday 9 Oct is still in week 1,
        # so week 1 stays the start's own week and is simply shorter.
        plan = self.plan('2026-10-07', 'Monday, Friday', 2)
        self.assertEqual([(s['date'], s['weekNumber']) for s in plan['sessions']],
                         [('2026-10-09', 1), ('2026-10-12', 2), ('2026-10-16', 2)])

    def test_a_start_on_the_delivery_day_is_unchanged(self):
        plan = self.plan('2026-10-07', 'Wednesday', 2)
        self.assertEqual([(s['date'], s['weekNumber']) for s in plan['sessions']],
                         [('2026-10-07', 1), ('2026-10-14', 2)])
