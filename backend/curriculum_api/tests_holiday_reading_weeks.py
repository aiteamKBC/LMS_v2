"""A holiday consumes the delivery slot it lands on.

The rule, in one sentence: a delivery day the cohort has closed keeps its place
in the curriculum as a READING WEEK with no live session in it, and the session
that was due there -- with every session behind it, in order -- moves down to
the next open delivery slot. Nothing is cancelled, nothing is reordered, and the
module's delivery end date therefore moves out by exactly one delivery slot per
closure, measured in the module's own delivery pattern rather than in weeks.

These assert against ``build_module_session_plan`` itself, which is the single
planner every dated view of a module ends in -- the /session-plan/ endpoint, the
Teams series, the tutor conflict check, the structure payload and the module
form's own preview. Testing it here is testing all of them.
"""

from django.test import SimpleTestCase

from curriculum_api import views


#: Two real England bank holidays either side of a Monday-delivered module.
#: 3 May 2027 and 31 May 2027 are both Mondays, so both land on a delivery day.
HOLIDAY_ROWS = [
    {'id': 'england-and-wales:2027-05-03', 'title': 'Early May bank holiday', 'holiday_date': '2027-05-03'},
    {'id': 'england-and-wales:2027-05-31', 'title': 'Spring bank holiday', 'holiday_date': '2027-05-31'},
    # A Friday inside the module's period: nothing delivers on a Friday here.
    {'id': 'england-and-wales:2027-04-16', 'title': 'Invented Friday closure', 'holiday_date': '2027-04-16'},
]

#: Monday 5 April 2027.
START = '2027-04-05'


def applied(*, excluded=()):
    """The holidays a cohort starting on START actually applies."""
    return views.scheduling_holidays_from(HOLIDAY_ROWS, START, list(excluded))


def plan_for(sessions, *, delivery='Monday', holidays=None):
    return views.build_module_session_plan(START, sessions, delivery, holidays)


def slot_types(plan):
    return [(slot['date'], slot['type'], slot['sessionNumber']) for slot in plan['slots']]


class NoHolidayLeavesTheScheduleAlone(SimpleTestCase):
    """Case 1: nothing closed, nothing changed."""

    def test_every_slot_delivers_a_session(self):
        plan = plan_for(6, holidays=[])

        self.assertEqual(
            [session['date'] for session in plan['sessions']],
            ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'],
        )
        self.assertEqual(len(plan['slots']), 6)
        self.assertEqual([slot['type'] for slot in plan['slots']], ['live-session'] * 6)
        self.assertEqual(plan['skippedHolidays'], [])

    def test_the_end_date_does_not_move(self):
        plan = plan_for(6, holidays=[])

        self.assertEqual(plan['finalEndDate'], '2027-05-10')
        self.assertEqual(plan['originalEndDate'], plan['finalEndDate'])

    def test_a_session_runs_on_the_slot_it_was_due_on(self):
        for session in plan_for(6, holidays=[])['sessions']:
            self.assertEqual(session['slotDate'], session['date'])
            self.assertEqual(session['skippedHolidays'], [])


class OneAppliedHolidayBecomesAReadingWeek(SimpleTestCase):
    """Case 2: the closure keeps its curriculum slot and gives up its session."""

    def setUp(self):
        self.plan = plan_for(6, holidays=applied())

    def test_the_closed_slot_stays_in_the_curriculum_as_a_reading_week(self):
        self.assertEqual(
            slot_types(self.plan),
            [
                ('2027-04-05', 'live-session', 1),
                ('2027-04-12', 'live-session', 2),
                ('2027-04-19', 'live-session', 3),
                ('2027-04-26', 'live-session', 4),
                # Monday 3 May: the curriculum week is still here, and it is a
                # reading week rather than a gap.
                ('2027-05-03', 'reading-week', None),
                ('2027-05-10', 'live-session', 5),
                ('2027-05-17', 'live-session', 6),
            ],
        )

    def test_the_reading_week_carries_the_holiday_that_caused_it(self):
        reading = next(slot for slot in self.plan['slots'] if slot['type'] == 'reading-week')

        self.assertEqual(reading['cause'], 'holiday')
        self.assertEqual(reading['day'], 'Monday')
        self.assertEqual(len(reading['holidays']), 1)
        holiday = reading['holidays'][0]
        self.assertEqual(holiday['label'], 'Early May bank holiday')
        self.assertEqual(holiday['startDate'], '2027-05-03')
        self.assertEqual(holiday['endDate'], '2027-05-03')
        self.assertEqual(holiday['type'], views.BANK_HOLIDAY_TYPE)
        self.assertEqual(holiday['id'], 'england-and-wales:2027-05-03')

    def test_no_live_session_runs_on_the_closed_day(self):
        self.assertNotIn('2027-05-03', [session['date'] for session in self.plan['sessions']])

    def test_the_displaced_session_moves_to_the_next_open_slot(self):
        # Session 5 was due on the closed Monday and now runs on the next one.
        session = self.plan['sessions'][4]
        self.assertEqual(session['sessionNumber'], 5)
        self.assertEqual(session['slotDate'], '2027-05-03')
        self.assertEqual(session['date'], '2027-05-10')
        self.assertEqual(session['skippedHolidays'], ['2027-05-03'])

    def test_every_session_survives_in_its_original_order(self):
        numbers = [session['sessionNumber'] for session in self.plan['sessions']]
        self.assertEqual(numbers, [1, 2, 3, 4, 5, 6])
        dates = [session['date'] for session in self.plan['sessions']]
        self.assertEqual(dates, sorted(dates))
        self.assertEqual(len(set(dates)), len(dates))

    def test_the_delivery_end_moves_by_exactly_one_slot(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-05-10')
        self.assertEqual(self.plan['finalEndDate'], '2027-05-17')
        # One closure, one extra curriculum slot.
        self.assertEqual(len(self.plan['slots']), len(self.plan['sessions']) + 1)


class AHolidayOffTheDeliveryDayChangesNothing(SimpleTestCase):
    """Case 3: a closure the module never delivers on is inert."""

    def test_a_friday_closure_moves_no_monday(self):
        friday_only = [row for row in HOLIDAY_ROWS if row['holiday_date'] == '2027-04-16']
        plan = plan_for(6, holidays=[views.serialize_holiday_row(row) for row in friday_only])

        self.assertEqual(plan['skippedHolidays'], [])
        self.assertEqual([slot['type'] for slot in plan['slots']], ['live-session'] * 6)
        self.assertEqual(plan['finalEndDate'], '2027-05-10')
        self.assertEqual(plan['originalEndDate'], plan['finalEndDate'])


class AnExcludedHolidayIsNotAClosure(SimpleTestCase):
    """Case 4: a holiday unticked for the cohort must not touch the schedule."""

    def setUp(self):
        self.plan = plan_for(6, holidays=applied(excluded=['england-and-wales:2027-05-03']))

    def test_the_session_runs_on_the_unticked_day(self):
        self.assertIn('2027-05-03', [session['date'] for session in self.plan['sessions']])

    def test_no_reading_week_is_created(self):
        self.assertEqual([slot['type'] for slot in self.plan['slots']], ['live-session'] * 6)

    def test_nothing_shifts_and_the_end_date_holds(self):
        self.assertEqual(self.plan['skippedHolidays'], [])
        self.assertEqual(self.plan['finalEndDate'], '2027-05-10')
        self.assertEqual(self.plan['originalEndDate'], '2027-05-10')

    def test_the_deny_list_is_what_removes_it(self):
        # The exclusion happens where the cohort resolves its holidays, so the
        # planner is never told about the unticked date at all.
        labels = [item['label'] for item in applied(excluded=['england-and-wales:2027-05-03'])]
        self.assertNotIn('Early May bank holiday', labels)
        self.assertIn('Spring bank holiday', labels)


class TwoAppliedHolidaysCostTwoSlots(SimpleTestCase):
    """Case 5: the walk repeats, and the end date moves twice."""

    def setUp(self):
        self.plan = plan_for(8, holidays=applied())

    def test_both_closed_days_are_reading_weeks(self):
        reading = [slot['date'] for slot in self.plan['slots'] if slot['type'] == 'reading-week']
        self.assertEqual(reading, ['2027-05-03', '2027-05-31'])

    def test_each_reading_week_names_its_own_holiday(self):
        named = {
            slot['date']: [holiday['label'] for holiday in slot['holidays']]
            for slot in self.plan['slots'] if slot['type'] == 'reading-week'
        }
        self.assertEqual(named, {
            '2027-05-03': ['Early May bank holiday'],
            '2027-05-31': ['Spring bank holiday'],
        })

    def test_no_session_is_lost_duplicated_or_reordered(self):
        dates = [session['date'] for session in self.plan['sessions']]
        self.assertEqual(len(dates), 8)
        self.assertEqual(len(set(dates)), 8)
        self.assertEqual(dates, sorted(dates))
        self.assertEqual(
            [session['sessionNumber'] for session in self.plan['sessions']],
            [1, 2, 3, 4, 5, 6, 7, 8],
        )

    def test_no_session_lands_on_either_closure(self):
        dates = {session['date'] for session in self.plan['sessions']}
        self.assertNotIn('2027-05-03', dates)
        self.assertNotIn('2027-05-31', dates)

    def test_the_end_moves_by_two_delivery_slots(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-05-24')
        self.assertEqual(self.plan['finalEndDate'], '2027-06-07')
        self.assertEqual(len(self.plan['slots']), 10)


class ConsecutiveClosuresKeepWalking(SimpleTestCase):
    """Case 6: the slot a session was pushed onto is closed as well."""

    #: Two Mondays in a row.
    BACK_TO_BACK = [
        {'id': 'h-1', 'title': 'First closure', 'holiday_date': '2027-04-19'},
        {'id': 'h-2', 'title': 'Second closure', 'holiday_date': '2027-04-26'},
    ]

    def setUp(self):
        self.plan = plan_for(4, holidays=views.scheduling_holidays_from(self.BACK_TO_BACK, START))

    def test_both_closures_are_reading_weeks_in_sequence(self):
        self.assertEqual(
            slot_types(self.plan),
            [
                ('2027-04-05', 'live-session', 1),
                ('2027-04-12', 'live-session', 2),
                ('2027-04-19', 'reading-week', None),
                ('2027-04-26', 'reading-week', None),
                ('2027-05-03', 'live-session', 3),
                ('2027-05-10', 'live-session', 4),
            ],
        )

    def test_the_session_carries_both_dates_it_stepped_over(self):
        self.assertEqual(self.plan['sessions'][2]['skippedHolidays'], ['2027-04-19', '2027-04-26'])
        self.assertEqual(self.plan['sessions'][2]['date'], '2027-05-03')

    def test_no_session_is_placed_on_either_closure(self):
        dates = {session['date'] for session in self.plan['sessions']}
        self.assertFalse(dates & {'2027-04-19', '2027-04-26'})


class AMultiDayPatternShiftsByItsOwnNextSlot(SimpleTestCase):
    """Case 7: a Mon+Thu module moves by one occurrence, not by seven days."""

    #: Monday 19 April 2027.
    CLOSURE = [{'id': 'h-mon', 'title': 'Closed Monday', 'holiday_date': '2027-04-19'}]

    def setUp(self):
        self.plan = plan_for(
            6, delivery='Monday, Thursday',
            holidays=views.scheduling_holidays_from(self.CLOSURE, START),
        )

    def test_the_shift_is_the_next_delivery_occurrence(self):
        # Session 5 was due Monday 19 April; the next DELIVERY slot is Thursday
        # 22 April -- three days later, not seven.
        session = self.plan['sessions'][4]
        self.assertEqual(session['slotDate'], '2027-04-19')
        self.assertEqual(session['date'], '2027-04-22')

    def test_the_end_date_moves_by_one_occurrence_not_a_week(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-04-22')
        self.assertEqual(self.plan['finalEndDate'], '2027-04-26')

    def test_the_reading_week_sits_on_the_closed_occurrence(self):
        self.assertEqual(
            slot_types(self.plan),
            [
                ('2027-04-05', 'live-session', 1),
                ('2027-04-08', 'live-session', 2),
                ('2027-04-12', 'live-session', 3),
                ('2027-04-15', 'live-session', 4),
                ('2027-04-19', 'reading-week', None),
                ('2027-04-22', 'live-session', 5),
                ('2027-04-26', 'live-session', 6),
            ],
        )


class SessionIdentitySurvivesTheShift(SimpleTestCase):
    """Case 9: the session due before a closure is the same session after it."""

    def test_the_run_is_the_unclosed_run_with_the_closure_taken_out(self):
        open_plan = plan_for(6, holidays=[])
        closed_plan = plan_for(6, holidays=applied())
        open_slots = [session['date'] for session in open_plan['sessions']]
        closed_slots = [session['slotDate'] for session in closed_plan['sessions']]

        # Every session keeps the curriculum position it was authored against;
        # only where it RUNS changed.
        self.assertEqual(open_slots, closed_slots)
        self.assertEqual(
            [session['sessionNumber'] for session in closed_plan['sessions']],
            [session['sessionNumber'] for session in open_plan['sessions']],
        )

    def test_a_reading_week_consumes_no_session_number(self):
        plan = plan_for(8, holidays=applied())
        delivered = [slot['sessionNumber'] for slot in plan['slots'] if slot['type'] == 'live-session']
        self.assertEqual(delivered, [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertTrue(all(
            slot['sessionNumber'] is None
            for slot in plan['slots'] if slot['type'] == 'reading-week'
        ))


class TheEffectiveEndIsTheLastDeliveredSession(SimpleTestCase):
    """Case 10: the end date the module is read by is where delivery lands."""

    def test_the_final_end_date_is_the_last_session_date(self):
        for holidays in ([], applied(), applied(excluded=['england-and-wales:2027-05-03'])):
            plan = plan_for(8, holidays=holidays)
            self.assertEqual(plan['finalEndDate'], plan['sessions'][-1]['date'])
            self.assertEqual(plan['finalEndDate'], plan['slots'][-1]['date'])

    def test_the_end_moves_one_slot_per_closure_and_no_further(self):
        closures = len(plan_for(8, holidays=applied())['skippedHolidays'])
        open_plan = plan_for(8 + closures, holidays=[])

        # "Two slots later" means exactly the slot two further down the module's
        # own delivery pattern -- which is what an unclosed run of that length
        # ends on.
        self.assertEqual(plan_for(8, holidays=applied())['finalEndDate'], open_plan['finalEndDate'])
