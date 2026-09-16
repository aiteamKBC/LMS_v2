"""A ticked holiday flags the delivery day it lands on. It moves nothing.

The rule, in one sentence: every session runs on its own delivery day, the
module ends where its delivery pattern says it ends, and a ticked holiday on a
delivery day only names itself against that day's slot -- via `cause` and
`holidays` on the slot, and `skippedHolidays` on the session -- so a screen can
warn the author. What that week becomes (a reading week, a live session that
runs anyway, anything else) is an authoring decision, made on the week itself.

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


def slot_flags(plan):
    return [(slot['date'], slot['type'], slot['cause'], slot['sessionNumber']) for slot in plan['slots']]


class NoHolidayLeavesTheScheduleAlone(SimpleTestCase):
    """Case 1: nothing ticked, nothing flagged."""

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


class OneAppliedHolidayFlagsItsSlotAndMovesNothing(SimpleTestCase):
    """Case 2: the slot stays a live-session slot; only the flag is new."""

    def setUp(self):
        self.plan = plan_for(6, holidays=applied())

    def test_every_slot_is_still_a_live_session(self):
        self.assertEqual(
            [slot['date'] for slot in self.plan['slots']],
            ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'],
        )
        self.assertEqual([slot['type'] for slot in self.plan['slots']], ['live-session'] * 6)

    def test_the_flagged_slot_carries_the_holiday_that_caused_it(self):
        flagged = next(slot for slot in self.plan['slots'] if slot['date'] == '2027-05-03')

        self.assertEqual(flagged['cause'], 'holiday')
        self.assertEqual(flagged['day'], 'Monday')
        self.assertEqual(len(flagged['holidays']), 1)
        holiday = flagged['holidays'][0]
        self.assertEqual(holiday['label'], 'Early May bank holiday')
        self.assertEqual(holiday['startDate'], '2027-05-03')
        self.assertEqual(holiday['endDate'], '2027-05-03')
        self.assertEqual(holiday['type'], views.BANK_HOLIDAY_TYPE)
        self.assertEqual(holiday['id'], 'england-and-wales:2027-05-03')

    def test_every_other_slot_carries_no_holiday(self):
        for slot in self.plan['slots']:
            if slot['date'] == '2027-05-03':
                continue
            self.assertEqual(slot['cause'], '')
            self.assertEqual(slot['holidays'], [])

    def test_a_live_session_still_runs_on_the_holiday(self):
        # Nothing cancels it. The author decides what the week becomes; the
        # planner only states the clash.
        self.assertIn('2027-05-03', [session['date'] for session in self.plan['sessions']])

    def test_the_session_names_the_holiday_it_landed_on(self):
        session = next(item for item in self.plan['sessions'] if item['date'] == '2027-05-03')
        self.assertEqual(session['sessionNumber'], 5)
        self.assertEqual(session['slotDate'], '2027-05-03')
        self.assertEqual(session['skippedHolidays'], ['2027-05-03'])

    def test_every_other_session_carries_no_holiday(self):
        for session in self.plan['sessions']:
            if session['date'] == '2027-05-03':
                continue
            self.assertEqual(session['skippedHolidays'], [])

    def test_every_session_survives_in_its_original_order_and_date(self):
        numbers = [session['sessionNumber'] for session in self.plan['sessions']]
        self.assertEqual(numbers, [1, 2, 3, 4, 5, 6])
        dates = [session['date'] for session in self.plan['sessions']]
        self.assertEqual(dates, ['2027-04-05', '2027-04-12', '2027-04-19', '2027-04-26', '2027-05-03', '2027-05-10'])

    def test_the_delivery_end_does_not_move(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-05-10')
        self.assertEqual(self.plan['finalEndDate'], '2027-05-10')
        self.assertEqual(len(self.plan['slots']), len(self.plan['sessions']))


class AHolidayOffTheDeliveryDayChangesNothing(SimpleTestCase):
    """Case 3: a holiday the module never delivers on is inert."""

    def test_a_friday_closure_flags_no_monday(self):
        friday_only = [row for row in HOLIDAY_ROWS if row['holiday_date'] == '2027-04-16']
        plan = plan_for(6, holidays=[views.serialize_holiday_row(row) for row in friday_only])

        self.assertEqual(plan['skippedHolidays'], [])
        self.assertEqual([slot['type'] for slot in plan['slots']], ['live-session'] * 6)
        self.assertEqual([slot['cause'] for slot in plan['slots']], [''] * 6)
        self.assertEqual(plan['finalEndDate'], '2027-05-10')
        self.assertEqual(plan['originalEndDate'], plan['finalEndDate'])


class AnExcludedHolidayIsNotAFlag(SimpleTestCase):
    """Case 4: a holiday unticked for the cohort must not touch the schedule."""

    def setUp(self):
        self.plan = plan_for(6, holidays=applied(excluded=['england-and-wales:2027-05-03']))

    def test_the_session_runs_on_the_unticked_day(self):
        self.assertIn('2027-05-03', [session['date'] for session in self.plan['sessions']])

    def test_no_slot_is_flagged(self):
        self.assertEqual([slot['cause'] for slot in self.plan['slots']], [''] * 6)

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


class TwoAppliedHolidaysFlagTwoSlots(SimpleTestCase):
    """Case 5: the walk repeats; every flagged slot keeps its own date.

    Nine Mondays from 5 April 2027 reach both 3 May and 31 May, so a nine-
    session run is what it takes for both applied holidays to fall inside it.
    """

    def setUp(self):
        self.plan = plan_for(9, holidays=applied())

    def test_both_holiday_days_are_flagged(self):
        flagged = [slot['date'] for slot in self.plan['slots'] if slot['cause'] == 'holiday']
        self.assertEqual(flagged, ['2027-05-03', '2027-05-31'])

    def test_each_flagged_slot_names_its_own_holiday(self):
        named = {
            slot['date']: [holiday['label'] for holiday in slot['holidays']]
            for slot in self.plan['slots'] if slot['cause'] == 'holiday'
        }
        self.assertEqual(named, {
            '2027-05-03': ['Early May bank holiday'],
            '2027-05-31': ['Spring bank holiday'],
        })

    def test_no_session_is_lost_duplicated_or_reordered(self):
        dates = [session['date'] for session in self.plan['sessions']]
        self.assertEqual(len(dates), 9)
        self.assertEqual(len(set(dates)), 9)
        self.assertEqual(dates, sorted(dates))
        self.assertEqual(
            [session['sessionNumber'] for session in self.plan['sessions']],
            [1, 2, 3, 4, 5, 6, 7, 8, 9],
        )

    def test_a_session_still_runs_on_both_holidays(self):
        dates = {session['date'] for session in self.plan['sessions']}
        self.assertIn('2027-05-03', dates)
        self.assertIn('2027-05-31', dates)

    def test_the_end_does_not_move(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-05-31')
        self.assertEqual(self.plan['finalEndDate'], '2027-05-31')
        self.assertEqual(len(self.plan['slots']), 9)


class ConsecutiveHolidaysEachFlagTheirOwnWeek(SimpleTestCase):
    """Case 6: two Mondays in a row are two flagged weeks, not one moved run."""

    #: Two Mondays in a row.
    BACK_TO_BACK = [
        {'id': 'h-1', 'title': 'First closure', 'holiday_date': '2027-04-19'},
        {'id': 'h-2', 'title': 'Second closure', 'holiday_date': '2027-04-26'},
    ]

    def setUp(self):
        self.plan = plan_for(4, holidays=views.scheduling_holidays_from(self.BACK_TO_BACK, START))

    def test_both_holidays_flag_their_own_slot_in_sequence(self):
        self.assertEqual(
            slot_flags(self.plan),
            [
                ('2027-04-05', 'live-session', '', 1),
                ('2027-04-12', 'live-session', '', 2),
                ('2027-04-19', 'live-session', 'holiday', 3),
                ('2027-04-26', 'live-session', 'holiday', 4),
            ],
        )

    def test_each_session_names_only_its_own_holiday(self):
        self.assertEqual(self.plan['sessions'][2]['skippedHolidays'], ['2027-04-19'])
        self.assertEqual(self.plan['sessions'][2]['date'], '2027-04-19')
        self.assertEqual(self.plan['sessions'][3]['skippedHolidays'], ['2027-04-26'])
        self.assertEqual(self.plan['sessions'][3]['date'], '2027-04-26')


class AMultiDayPatternFlagsOnlyItsOwnClosedOccurrence(SimpleTestCase):
    """Case 7: a Mon+Thu module flags the Monday, leaves the Thursday alone."""

    #: Monday 19 April 2027.
    CLOSURE = [{'id': 'h-mon', 'title': 'Closed Monday', 'holiday_date': '2027-04-19'}]

    def setUp(self):
        self.plan = plan_for(
            6, delivery='Monday, Thursday',
            holidays=views.scheduling_holidays_from(self.CLOSURE, START),
        )

    def test_only_the_holiday_occurrence_is_flagged(self):
        session = self.plan['sessions'][4]
        self.assertEqual(session['date'], '2027-04-19')
        self.assertEqual(session['slotDate'], '2027-04-19')
        self.assertEqual(session['skippedHolidays'], ['2027-04-19'])

    def test_the_end_date_does_not_move(self):
        self.assertEqual(self.plan['originalEndDate'], '2027-04-22')
        self.assertEqual(self.plan['finalEndDate'], '2027-04-22')

    def test_the_flag_sits_on_the_holiday_occurrence_only(self):
        self.assertEqual(
            slot_flags(self.plan),
            [
                ('2027-04-05', 'live-session', '', 1),
                ('2027-04-08', 'live-session', '', 2),
                ('2027-04-12', 'live-session', '', 3),
                ('2027-04-15', 'live-session', '', 4),
                ('2027-04-19', 'live-session', 'holiday', 5),
                ('2027-04-22', 'live-session', '', 6),
            ],
        )


class SessionIdentityNeverMoves(SimpleTestCase):
    """Case 9: a session's date and number are the same whether or not it is flagged."""

    def test_the_run_is_identical_flagged_or_not(self):
        open_plan = plan_for(6, holidays=[])
        flagged_plan = plan_for(6, holidays=applied())
        open_dates = [session['date'] for session in open_plan['sessions']]
        flagged_dates = [session['date'] for session in flagged_plan['sessions']]

        self.assertEqual(open_dates, flagged_dates)
        self.assertEqual(
            [session['sessionNumber'] for session in flagged_plan['sessions']],
            [session['sessionNumber'] for session in open_plan['sessions']],
        )

    def test_every_slot_still_carries_a_session_number(self):
        plan = plan_for(8, holidays=applied())
        delivered = [slot['sessionNumber'] for slot in plan['slots']]
        self.assertEqual(delivered, [1, 2, 3, 4, 5, 6, 7, 8])


class TheEffectiveEndIsAlwaysTheLastDeliveredSession(SimpleTestCase):
    """Case 10: the end date the module is read by never moves for a holiday."""

    def test_the_final_end_date_is_the_last_session_date(self):
        for holidays in ([], applied(), applied(excluded=['england-and-wales:2027-05-03'])):
            plan = plan_for(8, holidays=holidays)
            self.assertEqual(plan['finalEndDate'], plan['sessions'][-1]['date'])
            self.assertEqual(plan['finalEndDate'], plan['slots'][-1]['date'])

    def test_the_end_is_identical_flagged_or_not(self):
        self.assertEqual(plan_for(8, holidays=applied())['finalEndDate'], plan_for(8, holidays=[])['finalEndDate'])
