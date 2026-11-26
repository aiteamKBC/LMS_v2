"""The learner Training Plan shows the curriculum's own timeline, holidays included.

A learner who only ever receives session dates cannot tell a bank holiday from a
mistake: the day the holiday falls on has to say so. ``attach_curriculum_slots``
gives every learner module the curriculum scheduler's slot spine, so a delivery
day a ticked holiday lands on stays a normal session in the learner's timeline
and simply names the holiday -- nothing is cancelled and nothing moves.

The point of these tests is that the learner surface has NO scheduling logic of
its own. Every assertion below is checked twice -- once against the learner
payload and once against ``build_module_session_plan`` directly -- so the two can
never drift. The only thing patched is the cohort's database read; the holiday
rules and the walk are the real ones.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import views
from learner_api.training_plan_dashboard import attach_curriculum_slots


#: Real England bank holidays, in the shape ``curriculum.england_holidays`` stores.
#: 4 May, 25 May and 31 August 2026 are Mondays; 3 April 2026 (Good Friday) is not.
HOLIDAY_ROWS = [
    {'id': 'england-and-wales:2026-04-03', 'title': 'Good Friday', 'holiday_date': '2026-04-03'},
    {'id': 'england-and-wales:2026-05-04', 'title': 'Early May bank holiday', 'holiday_date': '2026-05-04'},
    {'id': 'england-and-wales:2026-05-25', 'title': 'Spring bank holiday', 'holiday_date': '2026-05-25'},
]

#: Monday 13 April 2026 -- deliberately NOT a bank holiday, so week 1 delivers.
START = '2026-04-13'
COHORT = 'COHORT-1'


def module_row(catalogue_id='MOD-1', delivery='Monday', sessions=6, start=START):
    """A ``curriculum.modules`` row exactly as the dashboard's SELECT returns it."""
    return {
        'id': catalogue_id, 'cohort_id': COHORT, 'start_date': start,
        'session_week_day': delivery, 'sessions_number': sessions, 'weeks_number': sessions,
    }


def holidays(*, excluded=()):
    """The holidays this cohort applies, resolved by the curriculum's own rule."""
    return views.scheduling_holidays_from(HOLIDAY_ROWS, START, list(excluded))


def learner_module(row=None, *, excluded=(), week_count=None):
    """Run the real learner adapter with only the cohort's DB read patched."""
    row = row or module_row()
    resolved = {COHORT: holidays(excluded=excluded)}
    payload = {row['id']: {'id': row['id']}}
    with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value=resolved):
        attach_curriculum_slots(
            [row], payload,
            {row['id']: row['sessions_number'] if week_count is None else week_count},
        )
    return payload[row['id']]


def planner(row=None, *, excluded=()):
    """The same module straight from the scheduler, for the drift check."""
    row = row or module_row()
    return views.build_module_session_plan(
        row['start_date'], row['sessions_number'], row['session_week_day'], holidays(excluded=excluded),
    )


def spine(module):
    return [(slot['date'], slot['type'], slot['sessionNumber']) for slot in module['curriculumSlots']]


class TheLearnerAndTheCurriculumShareOneScheduler(SimpleTestCase):
    """Case 12: the learner payload IS the scheduler's output, not a copy of it."""

    def test_the_spine_is_identical_to_the_planner(self):
        self.assertEqual(learner_module()['curriculumSlots'], planner()['slots'])

    def test_the_end_dates_are_the_planners_own(self):
        module, plan = learner_module(), planner()

        self.assertEqual(module['effectiveEndDate'], plan['finalEndDate'])
        self.assertEqual(module['originalEndDate'], plan['originalEndDate'])

    def test_a_twice_weekly_module_agrees_too(self):
        row = module_row(delivery='Monday, Thursday', sessions=12)

        self.assertEqual(learner_module(row)['curriculumSlots'], planner(row)['slots'])

    def test_the_cohort_id_is_not_published_to_the_learner(self):
        # It is read so the scheduler can resolve holidays, and nothing else.
        self.assertNotIn('cohort_id', learner_module())


class AModuleWithNoHolidays(SimpleTestCase):
    """Case 1: a clean Monday module is unchanged by any of this."""

    def setUp(self):
        self.module = learner_module(excluded=[
            'england-and-wales:2026-05-04', 'england-and-wales:2026-05-25',
        ])

    def test_every_slot_delivers_a_session(self):
        self.assertEqual(
            spine(self.module),
            [
                ('2026-04-13', 'live-session', 1), ('2026-04-20', 'live-session', 2),
                ('2026-04-27', 'live-session', 3), ('2026-05-04', 'live-session', 4),
                ('2026-05-11', 'live-session', 5), ('2026-05-18', 'live-session', 6),
            ],
        )

    def test_no_slot_is_flagged(self):
        self.assertEqual([slot['cause'] for slot in self.module['curriculumSlots']], [''] * 6)

    def test_the_delivery_end_does_not_move(self):
        self.assertEqual(self.module['effectiveEndDate'], '2026-05-18')
        self.assertEqual(self.module['originalEndDate'], '2026-05-18')


class OneHolidayReachesTheLearnerAsAFlagOnItsOwnWeek(SimpleTestCase):
    """Cases 2, 3, 4, 5, 15."""

    def setUp(self):
        self.module = learner_module(excluded=['england-and-wales:2026-05-25'])

    def test_the_holiday_day_is_still_an_ordinary_delivered_slot(self):
        self.assertEqual(
            spine(self.module),
            [
                ('2026-04-13', 'live-session', 1), ('2026-04-20', 'live-session', 2),
                ('2026-04-27', 'live-session', 3),
                # Monday 4 May: still a live session, flagged rather than closed.
                ('2026-05-04', 'live-session', 4),
                ('2026-05-11', 'live-session', 5), ('2026-05-18', 'live-session', 6),
            ],
        )

    def test_the_holiday_details_reach_the_learner(self):
        flagged = next(slot for slot in self.module['curriculumSlots'] if slot['cause'] == 'holiday')
        holiday = flagged['holidays'][0]

        self.assertEqual(flagged['date'], '2026-05-04')
        self.assertEqual(flagged['sessionNumber'], 4)
        self.assertEqual(holiday['label'], 'Early May bank holiday')
        self.assertEqual(holiday['startDate'], '2026-05-04')
        self.assertEqual(holiday['type'], views.BANK_HOLIDAY_TYPE)

    def test_no_other_slot_is_flagged(self):
        flagged = [slot['date'] for slot in self.module['curriculumSlots'] if slot['cause'] == 'holiday']
        self.assertEqual(flagged, ['2026-05-04'])

    def test_the_delivery_end_does_not_move(self):
        self.assertEqual(self.module['originalEndDate'], '2026-05-18')
        self.assertEqual(self.module['effectiveEndDate'], '2026-05-18')

    def test_a_live_session_is_still_placed_on_the_holiday(self):
        delivered = [slot['date'] for slot in self.module['curriculumSlots'] if slot['type'] == 'live-session']
        self.assertIn('2026-05-04', delivered)


class AnExcludedHolidayIsInvisibleToTheLearner(SimpleTestCase):
    """Case 6: the cohort deny-list is honoured upstream, with nothing added here."""

    def setUp(self):
        self.module = learner_module(excluded=[
            'england-and-wales:2026-05-04', 'england-and-wales:2026-05-25',
        ])

    def test_no_slot_is_flagged(self):
        self.assertEqual([slot['cause'] for slot in self.module['curriculumSlots']], [''] * 6)

    def test_the_session_runs_on_the_unticked_day(self):
        delivered = [slot['date'] for slot in self.module['curriculumSlots'] if slot['type'] == 'live-session']
        self.assertIn('2026-05-04', delivered)

    def test_delivery_is_not_extended(self):
        self.assertEqual(self.module['effectiveEndDate'], self.module['originalEndDate'])

    def test_the_holiday_never_reaches_the_learner_payload(self):
        labels = [
            holiday['label']
            for slot in self.module['curriculumSlots'] for holiday in slot['holidays']
        ]
        self.assertEqual(labels, [])

    def test_an_exclusion_between_two_applied_holidays_removes_only_itself(self):
        # Case 8's awkward variant: 4 May excluded, 25 May still applied. Eight
        # sessions, so the run is long enough to reach the second holiday.
        module = learner_module(module_row(sessions=8), excluded=['england-and-wales:2026-05-04'])
        flagged = [slot['date'] for slot in module['curriculumSlots'] if slot['cause'] == 'holiday']

        self.assertEqual(flagged, ['2026-05-25'])
        # The excluded date delivers unflagged, and nothing about the run moves.
        self.assertIn('2026-05-04', [slot['date'] for slot in module['curriculumSlots'] if slot['type'] == 'live-session'])
        self.assertEqual(module['effectiveEndDate'], '2026-06-01')


class ConsecutiveAndSeparatedHolidays(SimpleTestCase):
    """Cases 7 and 8."""

    BACK_TO_BACK = [
        {'id': 'h-1', 'title': 'First closure', 'holiday_date': '2026-04-20'},
        {'id': 'h-2', 'title': 'Second closure', 'holiday_date': '2026-04-27'},
    ]

    def test_two_holidays_in_a_row_flag_their_own_slots(self):
        resolved = {COHORT: views.scheduling_holidays_from(self.BACK_TO_BACK, START)}
        payload = {'MOD-1': {'id': 'MOD-1'}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value=resolved):
            attach_curriculum_slots([module_row(sessions=4)], payload, {'MOD-1': 4})

        self.assertEqual(
            [(slot['date'], slot['type'], slot['cause'], slot['sessionNumber']) for slot in payload['MOD-1']['curriculumSlots']],
            [
                ('2026-04-13', 'live-session', '', 1),
                ('2026-04-20', 'live-session', 'holiday', 2),
                ('2026-04-27', 'live-session', 'holiday', 3),
                ('2026-05-04', 'live-session', '', 4),
            ],
        )

    def test_two_separated_holidays_flag_two_slots_and_move_nothing(self):
        module = learner_module(module_row(sessions=8))
        flagged = [slot['date'] for slot in module['curriculumSlots'] if slot['cause'] == 'holiday']

        self.assertEqual(flagged, ['2026-05-04', '2026-05-25'])
        self.assertEqual(module['originalEndDate'], '2026-06-01')
        self.assertEqual(module['effectiveEndDate'], '2026-06-01')


class TheLearnerTimelineLosesAndInventsNothing(SimpleTestCase):
    """Cases 13 and 14, over every holiday combination the cohort can produce."""

    def combinations(self):
        return [
            (),
            ('england-and-wales:2026-05-04',),
            ('england-and-wales:2026-05-25',),
            ('england-and-wales:2026-05-04', 'england-and-wales:2026-05-25'),
        ]

    def test_every_session_appears_exactly_once_in_order(self):
        for excluded in self.combinations():
            with self.subTest(excluded=excluded):
                module = learner_module(module_row(sessions=8), excluded=excluded)
                delivered = [slot for slot in module['curriculumSlots'] if slot['type'] == 'live-session']
                numbers = [slot['sessionNumber'] for slot in delivered]

                self.assertEqual(numbers, list(range(1, 9)), 'sessions missing, duplicated or reordered')
                dates = [slot['date'] for slot in delivered]
                self.assertEqual(len(set(dates)), len(dates), 'two sessions on one date')
                self.assertEqual(dates, sorted(dates))

    def test_the_spine_is_strictly_ordered_and_never_repeats_a_date(self):
        for excluded in self.combinations():
            with self.subTest(excluded=excluded):
                dates = [slot['date'] for slot in learner_module(module_row(sessions=8), excluded=excluded)['curriculumSlots']]

                self.assertEqual(dates, sorted(dates))
                self.assertEqual(len(set(dates)), len(dates))

    def test_slot_numbers_are_a_gapless_run_from_one(self):
        module = learner_module(module_row(sessions=8))
        self.assertEqual(
            [slot['slotNumber'] for slot in module['curriculumSlots']],
            list(range(1, len(module['curriculumSlots']) + 1)),
        )


class TwiceWeeklyDelivery(SimpleTestCase):
    """Case 9: a ticked holiday flags only the occurrence it falls on."""

    def setUp(self):
        self.row = module_row(delivery='Monday, Thursday', sessions=8)
        self.module = learner_module(self.row, excluded=['england-and-wales:2026-05-25'])

    def test_the_holiday_monday_is_the_only_flagged_slot(self):
        flagged = [slot['date'] for slot in self.module['curriculumSlots'] if slot['cause'] == 'holiday']
        self.assertEqual(flagged, ['2026-05-04'])

    def test_the_thursday_beside_it_is_untouched(self):
        after = next(slot for slot in self.module['curriculumSlots'] if slot['date'] == '2026-05-07')

        self.assertEqual(after['type'], 'live-session')
        self.assertEqual(after['cause'], '')
        self.assertEqual(after['day'], 'Thursday')

    def test_the_end_does_not_move(self):
        self.assertEqual(self.module['originalEndDate'], '2026-05-07')
        self.assertEqual(self.module['effectiveEndDate'], '2026-05-07')


class ModulesThatCannotBePlanned(SimpleTestCase):
    """A learner page must load for a module the scheduler cannot date."""

    def test_a_module_with_no_start_date_gets_an_empty_spine(self):
        row = {**module_row(), 'start_date': None}
        payload = {row['id']: {'id': row['id']}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value={}):
            attach_curriculum_slots([row], payload, {})

        self.assertEqual(payload[row['id']]['curriculumSlots'], [])
        self.assertEqual(payload[row['id']]['effectiveEndDate'], '')

    def test_a_failed_holiday_read_still_produces_a_module(self):
        row = module_row()
        payload = {row['id']: {'id': row['id']}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', side_effect=RuntimeError('cohort read down')):
            attach_curriculum_slots([row], payload, {row['id']: 6})

        # No holidays could be resolved, so nothing is flagged -- but the
        # learner still gets a dated timeline rather than a broken page.
        self.assertEqual(len(payload[row['id']]['curriculumSlots']), 6)
        self.assertEqual(payload[row['id']]['effectiveEndDate'], '2026-05-18')

    def test_a_module_the_payload_does_not_carry_is_skipped(self):
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value={}):
            attach_curriculum_slots([module_row()], {}, {})


class WeekContentReachesItsMatchingSlot(SimpleTestCase):
    """A taught slot carries ITS OWN authored week's content, not the module-wide aggregate.

    Learner Dashboard's weekly view needs a specific week's title and outcomes,
    not the module's flattened list -- so a live-session slot is matched to
    ``curriculum.weeks`` by its ``sessionNumber`` (the same content-week count).
    """

    def weeks_by_number(self, module_id, count=6):
        return {(module_id, n): {'id': f'W{n}', 'title': f'Authored week {n}', 'learningOutcomes': [f'Outcome {n}']}
                for n in range(1, count + 1)}

    def test_a_taught_slot_carries_its_own_week_content(self):
        row = module_row()
        resolved = {COHORT: holidays(excluded=['england-and-wales:2026-05-04', 'england-and-wales:2026-05-25'])}
        payload = {row['id']: {'id': row['id']}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value=resolved):
            attach_curriculum_slots([row], payload, {row['id']: row['sessions_number']}, self.weeks_by_number(row['id']))

        slots = {slot['sessionNumber']: slot for slot in payload[row['id']]['curriculumSlots']}
        self.assertEqual(slots[1]['weekId'], 'W1')
        self.assertEqual(slots[1]['weekTitle'], 'Authored week 1')
        self.assertEqual(slots[1]['learningOutcomes'], ['Outcome 1'])
        self.assertEqual(slots[6]['weekId'], 'W6')

    def test_a_reading_week_slot_is_never_enriched(self):
        row = module_row()
        resolved = {COHORT: holidays(excluded=['england-and-wales:2026-05-25'])}
        payload = {row['id']: {'id': row['id']}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value=resolved):
            attach_curriculum_slots([row], payload, {row['id']: row['sessions_number']}, self.weeks_by_number(row['id']))

        reading = next(slot for slot in payload[row['id']]['curriculumSlots'] if slot['type'] == 'reading-week')
        self.assertNotIn('weekId', reading)
        self.assertNotIn('weekTitle', reading)
        self.assertNotIn('learningOutcomes', reading)

    def test_a_slot_with_no_authored_week_is_left_exactly_as_the_scheduler_made_it(self):
        excluded = ['england-and-wales:2026-05-04', 'england-and-wales:2026-05-25']
        row = module_row()
        resolved = {COHORT: holidays(excluded=excluded)}
        payload = {row['id']: {'id': row['id']}}
        with patch.object(views, 'cohort_selected_holidays_by_cohort', return_value=resolved):
            attach_curriculum_slots([row], payload, {row['id']: row['sessions_number']}, {})

        self.assertEqual(payload[row['id']]['curriculumSlots'], planner(row, excluded=excluded)['slots'])
