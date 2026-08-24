"""A tutor may not be booked into two modules that run at the same time.

The rule these tests pin down is the one the calendar makes visible: two modules
conflict when they share a session date *and* their clock windows overlap on it.
Everything is asserted through the endpoints that actually assign a tutor rather
than against the helpers, because the whole point of the check is that no write
path is left without it -- a tutor reaches a module from the module page, the
group page, the staffing screen and the structure wizard.
"""

import json

from datetime import date
from unittest.mock import patch

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness, staff_directory, staff_user_row


class ClockAndSlotTests(CurriculumPersistenceHarness):
    """The primitives the rule is built from."""

    def test_stored_time_formats_all_parse(self):
        # session_start_time is only ever varchar, and four screens write it.
        self.assertEqual(views.parse_clock_minutes('10:00'), 600)
        self.assertEqual(views.parse_clock_minutes('1000'), 600)
        self.assertEqual(views.parse_clock_minutes('10.00'), 600)
        self.assertEqual(views.parse_clock_minutes('9:30 AM'), 570)
        self.assertEqual(views.parse_clock_minutes('1:15 PM'), 795)
        self.assertEqual(views.parse_clock_minutes('12:00 AM'), 0)
        self.assertEqual(views.parse_clock_minutes('12:00 PM'), 720)

    def test_unreadable_time_is_none_rather_than_zero(self):
        # Zero would read as midnight and silently overlap everything.
        for value in ('', 'lunchtime', '25:00', '10:99', None):
            self.assertIsNone(views.parse_clock_minutes(value), value)

    def test_a_module_with_no_authored_time_uses_the_calendar_fallback(self):
        self.assertEqual(views.module_time_window({}), (540, 600))

    def test_an_inverted_end_time_still_occupies_its_slot(self):
        # Treating it as zero-length would hide a real double-booking.
        window = views.module_time_window({'session_start_time': '14:00', 'session_end_time': '09:00'})
        self.assertEqual(window, (840, 900))

    def test_partial_overlap_counts_as_a_clash(self):
        left = {'sessions_number': 1, 'start_date': '2026-09-16', 'session_week_day': 'Wednesday',
                'session_start_time': '10:00', 'session_end_time': '12:00'}
        right = {**left, 'session_start_time': '11:00', 'session_end_time': '13:00'}
        self.assertEqual([item.isoformat() for item in views.module_slot_clash_dates(left, right)], ['2026-09-16'])

    def test_back_to_back_sessions_do_not_clash(self):
        left = {'sessions_number': 1, 'start_date': '2026-09-16', 'session_week_day': 'Wednesday',
                'session_start_time': '10:00', 'session_end_time': '12:00'}
        right = {**left, 'session_start_time': '12:00', 'session_end_time': '14:00'}
        self.assertEqual(views.module_slot_clash_dates(left, right), [])

    def test_same_slot_on_different_weeks_does_not_clash(self):
        left = {'sessions_number': 1, 'start_date': '2026-09-16', 'session_week_day': 'Wednesday',
                'session_start_time': '10:00', 'session_end_time': '12:00'}
        right = {**left, 'start_date': '2026-09-23'}
        self.assertEqual(views.module_slot_clash_dates(left, right), [])

    def test_ranges_that_overlap_only_partly_clash_on_the_shared_dates(self):
        left = {'sessions_number': 4, 'start_date': '2026-09-16', 'session_week_day': 'Wednesday',
                'session_start_time': '10:00', 'session_end_time': '12:00'}
        right = {**left, 'start_date': '2026-09-30', 'sessions_number': 4}
        shared = [item.isoformat() for item in views.module_slot_clash_dates(left, right)]
        self.assertEqual(shared, ['2026-09-30', '2026-10-07'])


class TutorConflictHarness(CurriculumPersistenceHarness):
    """Two modules in one group, both able to carry their own tutor and slot."""

    #: The people a picker can choose between. Curriculum reads its tutors from
    #: the staff directory, so a roster answer only ever covers staff users who
    #: hold tutor access -- these tests supply that directory rather than
    #: inventing tutors out of the names typed onto modules.
    TUTORS = ('Tutor Solo', 'Tutor Busy', 'Tutor Free', 'Tutor Other', 'Tutor One')

    def setUp(self):
        super().setUp()
        directory = staff_directory(*[
            staff_user_row(name, access='tutor', row_id=index + 1)
            for index, name in enumerate(self.TUTORS)
        ])
        patcher = patch('curriculum_api.views.fetch_staff_users_by_access', side_effect=directory)
        patcher.start()
        self.addCleanup(patcher.stop)

    def seed_group(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        return 'GROUP-DATA-1'

    def add_module(self, name, expect=200, **overrides):
        body = {
            'moduleName': name,
            'startDate': '2026-09-16',
            'sessionsNumber': 4,
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
            'tutor': 'Unassigned',
        }
        body.update(overrides)
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', body)
        self.assertEqual(response.status_code, expect, response.content)
        return response

    def catalogue_id(self, response):
        return response.json()['created'][0]['catalogueId']

    def module_row(self, catalogue_id):
        return self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', catalogue_id)


class ModuleAssignmentConflictTests(TutorConflictHarness):
    """`Modules -> Add Module` and `Modules -> select module -> edit Tutor`."""

    def test_the_scenario_the_rule_exists_for_is_refused(self):
        """Same tutor, same weekday, same hour, overlapping date ranges."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        response = self.add_module('Module Beta', expect=409, tutor='Tutor Solo')

        body = response.json()
        self.assertIn('Tutor Solo', body['error'])
        self.assertIn('Module Alpha', body['error'])
        conflict = body['tutorConflicts'][0]
        self.assertEqual(conflict['moduleName'], 'Module Alpha')
        self.assertEqual(conflict['startTime'], '10:00')
        # Every shared date is reported, not just the first.
        self.assertEqual(
            conflict['dates'],
            ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'],
        )

    def test_the_refused_module_is_not_left_half_written(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        self.add_module('Module Beta', expect=409, tutor='Tutor Solo')

        titles = {
            views.clean_str(row.get('title'))
            for row in views.safe_authoring_module_rows()
        }
        self.assertNotIn('Module Beta', titles)

    def test_a_second_module_in_the_same_request_is_checked_against_the_first(self):
        """Two new modules can clash with each other, not just with what exists."""
        self.seed_group()
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {
            'modules': [
                {'moduleName': 'Batch One', 'startDate': '2026-09-16', 'sessionsNumber': 2,
                 'weekDays': 'Wednesday', 'startTime': '10:00', 'endTime': '12:00', 'tutor': 'Tutor Solo'},
                {'moduleName': 'Batch Two', 'startDate': '2026-09-16', 'sessionsNumber': 2,
                 'weekDays': 'Wednesday', 'startTime': '10:00', 'endTime': '12:00', 'tutor': 'Tutor Solo'},
            ],
        })
        self.assertEqual(response.status_code, 409, response.content)
        # The first module of the batch rolls back with the second.
        titles = {views.clean_str(row.get('title')) for row in views.safe_authoring_module_rows()}
        self.assertNotIn('Batch One', titles)
        self.assertNotIn('Batch Two', titles)

    def test_editing_a_module_tutor_into_a_taken_slot_is_refused(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        second = self.catalogue_id(self.add_module('Module Beta'))

        response = self.patch_json(
            f'/curriculum_api/curriculum/modules/{second}/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertNotEqual(views.clean_str(self.module_row(second).get('tutor_name')), 'Tutor Solo')

    def test_moving_a_module_onto_a_taken_slot_is_refused(self):
        """The clash can be created by the date as easily as by the tutor."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        second = self.catalogue_id(self.add_module('Module Beta', startDate='2026-10-21', tutor='Tutor Solo'))

        response = self.patch_json(
            f'/curriculum_api/curriculum/modules/{second}/',
            {'startDate': '2026-09-16'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(views.format_date(self.module_row(second).get('start_date')), '2026-10-21')


class NonConflictingAssignmentTests(TutorConflictHarness):
    """The check has to stay quiet everywhere a tutor genuinely is free."""

    def setUp(self):
        super().setUp()
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')

    def test_a_different_tutor_is_free_in_the_same_slot(self):
        self.add_module('Module Beta', tutor='Tutor Other')

    def test_an_unassigned_module_is_never_checked(self):
        # 'Unassigned' is a stored value, not a person who can be double-booked.
        self.add_module('Module Beta', tutor='Unassigned')
        self.add_module('Module Gamma', tutor='')

    def test_a_different_weekday_is_free(self):
        self.add_module('Module Beta', tutor='Tutor Solo', weekDays='Thursday')

    def test_a_later_date_range_is_free(self):
        self.add_module('Module Beta', tutor='Tutor Solo', startDate='2026-10-22', weekDays='Thursday')

    def test_a_non_overlapping_time_on_the_same_day_is_free(self):
        self.add_module('Module Beta', tutor='Tutor Solo', startTime='13:00', endTime='15:00')

    def test_back_to_back_sessions_are_free(self):
        self.add_module('Module Beta', tutor='Tutor Solo', startTime='12:00', endTime='14:00')

    def test_a_module_with_no_sessions_books_nothing(self):
        self.add_module('Module Beta', tutor='Tutor Solo', sessionsNumber=0)


class ExistingConflictTests(TutorConflictHarness):
    """A clash already in the data must not freeze the module it is on.

    Deployments predate this check, and a module's content is authored through
    the same PATCH that carries its schedule. Refusing every save would leave
    those modules unable to be renamed or authored.
    """

    def seed_existing_clash(self):
        self.seed_group()
        first = self.catalogue_id(self.add_module('Module Alpha', tutor='Tutor Solo'))
        second = self.catalogue_id(
            self.add_module('Module Beta', tutor='Tutor Solo', allowTutorConflict=True)
        )
        return first, second

    def test_the_override_books_the_clash_deliberately(self):
        first, second = self.seed_existing_clash()
        self.assertEqual(views.clean_str(self.module_row(second).get('tutor_name')), 'Tutor Solo')
        self.assertNotEqual(first, second)

    def test_renaming_an_already_clashing_module_still_saves(self):
        _, second = self.seed_existing_clash()
        response = self.patch_json(
            f'/curriculum_api/curriculum/modules/{second}/',
            {'name': 'Module Beta Renamed'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(views.clean_str(self.module_row(second).get('title')), 'Module Beta Renamed')

    def test_moving_an_already_clashing_module_out_of_the_clash_saves(self):
        _, second = self.seed_existing_clash()
        response = self.patch_json(
            f'/curriculum_api/curriculum/modules/{second}/',
            {'startTime': '14:00', 'endTime': '16:00'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(views.clean_str(self.module_row(second).get('session_start_time')), '14:00')

    def test_a_third_module_moved_onto_the_existing_clash_is_still_refused(self):
        self.seed_existing_clash()
        self.add_module('Module Gamma', expect=409, tutor='Tutor Solo')


class GroupWideAssignmentConflictTests(TutorConflictHarness):
    """One tutor set against a whole group lands on every module in it."""

    def seed_group_with_overlapping_modules(self):
        self.seed_group()
        self.add_module('Module Alpha')
        self.add_module('Module Beta')
        # A module outside the group, already holding the slot.
        return 'GROUP-DATA-1'

    def test_assigning_a_tutor_to_a_group_whose_modules_overlap_is_refused(self):
        self.seed_group_with_overlapping_modules()
        response = self.patch_json(
            '/curriculum_api/curriculum/groups/GROUP-DATA-1/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        tutors = {
            views.clean_str(row.get('tutor_name'))
            for row in views.safe_authoring_module_rows()
        }
        self.assertNotIn('Tutor Solo', tutors)

    def test_the_group_patch_writes_nothing_when_the_tutor_is_refused(self):
        """The refusal comes before the group's own fields are updated."""
        self.seed_group_with_overlapping_modules()
        response = self.patch_json(
            '/curriculum_api/curriculum/groups/GROUP-DATA-1/',
            {'name': 'Renamed Group', 'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        self.assertEqual(views.clean_str(group.get('group_name')), 'Group A')

    def test_the_staffing_screen_is_refused_the_same_way(self):
        self.seed_group_with_overlapping_modules()
        response = self.patch_json(
            '/curriculum_api/curriculum/staffing/GROUP-DATA-1/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 409, response.content)

    def test_the_staffing_screen_still_writes_a_coach_alongside_a_free_tutor(self):
        self.seed_group()
        self.add_module('Module Alpha', startDate='2026-09-16', weekDays='Wednesday')
        response = self.patch_json(
            '/curriculum_api/curriculum/staffing/GROUP-DATA-1/',
            {'tutor': 'Tutor Solo', 'coach': 'Coach Two'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        self.assertEqual(views.clean_str(group.get('coach_name')), 'Coach Two')

    def test_a_group_whose_modules_run_in_sequence_takes_a_tutor(self):
        self.seed_group()
        self.add_module('Module Alpha', startDate='2026-09-16', sessionsNumber=2)
        self.add_module('Module Beta', startDate='2026-10-14', sessionsNumber=2)
        response = self.patch_json(
            '/curriculum_api/curriculum/groups/GROUP-DATA-1/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_reassigning_the_same_tutor_a_group_already_holds_is_not_refused(self):
        """Nothing moves, so an existing clash is not this save's doing."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        self.add_module('Module Beta', tutor='Tutor Solo', allowTutorConflict=True)
        response = self.patch_json(
            '/curriculum_api/curriculum/groups/GROUP-DATA-1/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 200, response.content)


class TreeSaveConflictTests(TutorConflictHarness):
    """The structure wizard writes a whole programme in one transaction."""

    def clashing_tree(self):
        payload = self.tree_payload()
        group = payload['cohorts'][0]['groups'][0]
        group['modules'] = [
            {
                'moduleName': 'Wizard Alpha',
                'catalogueId': 'MOD-WIZ-1',
                'startDate': '2026-09-16',
                'sessionsNumber': 2,
                'weekDays': 'Wednesday',
                'startTime': '10:00',
                'endTime': '12:00',
                'tutor': 'Tutor Solo',
            },
            {
                'moduleName': 'Wizard Beta',
                'catalogueId': 'MOD-WIZ-2',
                'startDate': '2026-09-16',
                'sessionsNumber': 2,
                'weekDays': 'Wednesday',
                'startTime': '10:00',
                'endTime': '12:00',
                'tutor': 'Tutor Solo',
            },
        ]
        return payload

    def test_a_wizard_save_that_double_books_is_refused(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.clashing_tree())
        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn('Tutor Solo', response.json()['error'])

    def test_the_whole_tree_rolls_back(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.clashing_tree())
        catalogue_ids = {
            views.clean_str(row.get('module_catalogue_id'))
            for row in views.safe_authoring_module_rows()
        }
        self.assertNotIn('MOD-WIZ-1', catalogue_ids)
        self.assertNotIn('MOD-WIZ-2', catalogue_ids)

    def test_the_same_tree_saves_once_the_modules_run_in_sequence(self):
        payload = self.clashing_tree()
        payload['cohorts'][0]['groups'][0]['modules'][1]['startDate'] = '2026-10-14'
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

    def test_resaving_an_unchanged_tree_is_not_refused_by_its_own_modules(self):
        """A re-save compares each module against the save, not against itself."""
        payload = self.clashing_tree()
        payload['cohorts'][0]['groups'][0]['modules'][1]['startDate'] = '2026-10-14'
        self.assertEqual(
            self.post_json('/curriculum_api/curriculum/programmes/tree/', payload).status_code,
            200,
        )
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)


class AvailabilityPreviewTests(TutorConflictHarness):
    """`POST /curriculum/preview/tutor-availability/` — ask before saving.

    The point of the endpoint is that a screen can answer "is this person free?"
    while the tutor is still being chosen, so it has to give the same verdict the
    save would, from the same rule.
    """

    SLOT = {
        'startDate': '2026-09-16',
        'sessionsNumber': 4,
        'weekDays': 'Wednesday',
        'startTime': '10:00',
        'endTime': '12:00',
    }

    def preview(self, **overrides):
        body = {**self.SLOT, **overrides}
        response = self.post_json('/curriculum_api/curriculum/preview/tutor-availability/', body)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_free_tutor_is_reported_available(self):
        self.seed_group()
        result = self.preview(tutor='Tutor Solo')
        self.assertTrue(result['available'])
        self.assertEqual(result['conflicts'], [])
        self.assertEqual(result['message'], '')

    def test_a_busy_tutor_is_reported_with_the_same_detail_the_save_would_give(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')

        result = self.preview(tutor='Tutor Solo')
        self.assertFalse(result['available'])
        self.assertEqual(result['conflicts'][0]['moduleName'], 'Module Alpha')
        self.assertEqual(
            result['conflicts'][0]['dates'],
            ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'],
        )
        self.assertIn('Tutor Solo', result['message'])

        # The verdict has to match what actually happens on save.
        self.add_module('Module Beta', expect=409, tutor='Tutor Solo')

    def test_the_slot_being_asked_about_is_described_back(self):
        self.seed_group()
        result = self.preview(tutor='Tutor Solo')
        self.assertEqual(result['startTime'], '10:00')
        self.assertEqual(result['endTime'], '12:00')
        self.assertEqual(len(result['sessionDates']), 4)
        self.assertTrue(result['bookable'])

    def test_a_slot_that_books_nothing_says_so(self):
        """Otherwise "everyone is free" reads as a meaningful all-clear."""
        self.seed_group()
        result = self.preview(tutor='Tutor Solo', sessionsNumber=0)
        self.assertFalse(result['bookable'])
        self.assertEqual(result['sessionDates'], [])

    def test_asking_without_a_tutor_answers_for_every_tutor_at_once(self):
        """This is what lets a picker mark the busy names."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        self.add_module('Module Gamma', tutor='Tutor Free', startTime='15:00', endTime='16:00')

        result = self.preview()
        verdicts = {item['tutor']: item['available'] for item in result['results']}
        self.assertFalse(verdicts['Tutor Busy'])
        self.assertTrue(verdicts['Tutor Free'])
        self.assertEqual(result['busyCount'], 1)
        self.assertGreaterEqual(result['availableCount'], 1)

    def test_a_module_is_not_reported_as_blocking_its_own_slot(self):
        """Re-opening a saved module must not show its own booking as a clash."""
        self.seed_group()
        first = self.catalogue_id(self.add_module('Module Alpha', tutor='Tutor Solo'))

        self.assertFalse(self.preview(tutor='Tutor Solo')['available'])
        self.assertTrue(self.preview(tutor='Tutor Solo', moduleCatalogueId=first)['available'])

    def test_an_unassigned_tutor_is_always_available(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        self.assertTrue(self.preview(tutor='Unassigned')['available'])

    def test_naming_a_module_is_enough_to_ask_about_its_own_slot(self):
        """A screen should not have to carry a module's weekday and times."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        second = self.catalogue_id(self.add_module('Module Beta'))

        response = self.post_json(
            '/curriculum_api/curriculum/preview/tutor-availability/',
            {'moduleCatalogueId': second},
        )
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        # The stored schedule was read, so the slot is the module's own.
        self.assertEqual(result['startTime'], '10:00')
        self.assertEqual(len(result['sessionDates']), 4)
        verdicts = {item['tutor']: item['available'] for item in result['results']}
        self.assertFalse(verdicts['Tutor Busy'])

    def test_the_module_can_be_named_by_any_id_a_screen_already_holds(self):
        """Screens carry several id forms; all of them must resolve here.

        Without this the lookup silently misses, the slot falls back to an empty
        one, and every tutor reads as free — a wrong all-clear rather than an
        error anyone would notice.
        """
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        catalogue_id = self.catalogue_id(self.add_module('Module Beta'))

        for identifier in (catalogue_id, f'catalogue-module-{catalogue_id}'):
            response = self.post_json(
                '/curriculum_api/curriculum/preview/tutor-availability/',
                {'moduleCatalogueId': identifier},
            )
            self.assertEqual(response.status_code, 200, response.content)
            result = response.json()
            self.assertTrue(result['bookable'], f'{identifier} did not resolve to a real slot')
            verdicts = {item['tutor']: item['available'] for item in result['results']}
            self.assertFalse(verdicts['Tutor Busy'], identifier)

    def test_an_unresolvable_module_is_an_error_not_a_clean_bill_of_health(self):
        """The dangerous failure here is a wrong all-clear, not an exception.

        An id the save would not have recognised leaves the slot empty, and an
        empty slot clashes with nothing — so every tutor would read as free.
        """
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        response = self.post_json(
            '/curriculum_api/curriculum/preview/tutor-availability/',
            {'moduleCatalogueId': 'MOD-DOES-NOT-EXIST'},
        )
        self.assertEqual(response.status_code, 404, response.content)

    def test_a_new_module_with_no_id_yet_still_previews_from_its_slot(self):
        """The create form has no module to name, only the slot being filled in."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        result = self.preview()
        self.assertTrue(result['bookable'])
        verdicts = {item['tutor']: item['available'] for item in result['results']}
        self.assertFalse(verdicts['Tutor Busy'])

    def test_an_edited_schedule_overrides_the_stored_one(self):
        """A form previewing a change must get the answer for the change."""
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Busy')
        second = self.catalogue_id(self.add_module('Module Beta'))

        response = self.post_json(
            '/curriculum_api/curriculum/preview/tutor-availability/',
            {'moduleCatalogueId': second, 'startTime': '15:00', 'endTime': '16:00'},
        )
        result = response.json()
        self.assertEqual(result['startTime'], '15:00')
        verdicts = {item['tutor']: item['available'] for item in result['results']}
        self.assertTrue(verdicts['Tutor Busy'])


class SessionCalendarConflictTests(TutorConflictHarness):
    """`PATCH /curriculum/sessions/<id>/` edits the module row directly.

    It never calls save_module_authoring_structure, so it would otherwise have
    been the one remaining way to book a tutor twice.
    """

    def session_id(self, catalogue_id, week=1):
        return f'module-{catalogue_id}-session-{week}'

    def test_moving_a_session_tutor_into_a_taken_slot_is_refused(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        second = self.catalogue_id(self.add_module('Module Beta'))

        response = self.patch_json(
            f'/curriculum_api/curriculum/sessions/{self.session_id(second)}/',
            {'tutor': 'Tutor Solo'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertNotEqual(views.clean_str(self.module_row(second).get('tutor_name')), 'Tutor Solo')

    def test_moving_a_session_time_onto_a_taken_slot_is_refused(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        second = self.catalogue_id(
            self.add_module('Module Beta', tutor='Tutor Solo', startTime='14:00', endTime='16:00')
        )

        response = self.patch_json(
            f'/curriculum_api/curriculum/sessions/{self.session_id(second)}/',
            {'startTime': '11:00', 'endTime': '13:00'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(views.clean_str(self.module_row(second).get('session_start_time')), '14:00')

    def test_moving_a_session_date_onto_a_taken_slot_is_refused(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        second = self.catalogue_id(
            self.add_module('Module Beta', tutor='Tutor Solo', startDate='2026-10-21')
        )

        response = self.patch_json(
            f'/curriculum_api/curriculum/sessions/{self.session_id(second)}/',
            {'date': '2026-09-16'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(views.format_date(self.module_row(second).get('start_date')), '2026-10-21')

    def test_a_session_edit_that_moves_nothing_contested_still_saves(self):
        self.seed_group()
        first = self.catalogue_id(self.add_module('Module Alpha', tutor='Tutor Solo'))
        response = self.patch_json(
            f'/curriculum_api/curriculum/sessions/{self.session_id(first)}/',
            {'startTime': '15:00', 'endTime': '17:00'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(views.clean_str(self.module_row(first).get('session_start_time')), '15:00')


class CrossGroupConflictTests(TutorConflictHarness):
    """A tutor's diary spans the whole curriculum, not one group."""

    def test_a_clash_with_another_programme_is_found(self):
        self.seed_group()
        self.add_module('Module Alpha', tutor='Tutor Solo')

        second_tree = self.tree_payload(
            programme_id='PROG-OTHER',
            cohort_id='COHORT-OTHER-1',
            group_id='GROUP-OTHER-1',
            module_id='MOD-OTHER-1',
        )
        second_tree['programme']['name'] = 'Other Programme'
        # The fixture's own module shares 'Tutor One' and the slot with the first
        # tree's, which the check would (correctly) refuse. This test is about a
        # later assignment, so the seed itself is left unassigned.
        other_group = second_tree['cohorts'][0]['groups'][0]
        other_group['tutor'] = 'Unassigned'
        other_group['modules'][0]['tutor'] = 'Unassigned'
        self.assertEqual(
            self.post_json('/curriculum_api/curriculum/programmes/tree/', second_tree).status_code,
            200,
        )

        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-OTHER-1/modules/', {
            'moduleName': 'Other Module',
            'startDate': '2026-09-16',
            'sessionsNumber': 4,
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
            'tutor': 'Tutor Solo',
        })
        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn('Module Alpha', response.json()['error'])

    def test_an_archived_module_releases_its_slot(self):
        self.seed_group()
        first = self.catalogue_id(self.add_module('Module Alpha', tutor='Tutor Solo'))
        deleted = self.client.delete(f'/curriculum_api/curriculum/modules/{first}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)

        self.add_module('Module Beta', tutor='Tutor Solo')


class HolidayShiftConflictTests(TutorConflictHarness):
    """A clash is about the day a session actually runs on.

    A cohort's ticked holidays move the sessions that land on them onto the next
    delivery day -- what the session list, the Teams series and the module form's
    own preview all show. Dating a schedule without them left the conflict check
    answering about a timetable nobody runs: it reported a clash on a closed day,
    and passed the real collision on the day the session had moved to.
    """

    #: One closed Wednesday, so a weekly Wednesday module runs a week longer.
    HOLIDAY_ROWS = [{
        'id': 2001,
        'label': 'Autumn close',
        'start_date': date(2026, 9, 23),
        'end_date': date(2026, 9, 23),
        'type': 'closure',
        'color': '',
    }]

    def tick_the_closed_wednesday(self, cohort_id='COHORT-DATA-1'):
        """Tick the holiday on the cohort the tree save has already written."""
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], {
            'cohort_id': cohort_id,
            'holiday_ids': views.json_db_value(['2001']),
        })

    def seed_open_group(self):
        """A group in another programme, whose cohort ticks nothing."""
        payload = self.tree_payload(
            programme_id='PROG-OPEN',
            cohort_id='COHORT-OPEN-1',
            group_id='GROUP-OPEN-1',
            module_id='MOD-OPEN-1',
        )
        payload['programme']['name'] = 'Open Programme'
        group = payload['cohorts'][0]['groups'][0]
        group['tutor'] = 'Unassigned'
        group['modules'][0]['tutor'] = 'Unassigned'
        self.assertEqual(
            self.post_json('/curriculum_api/curriculum/programmes/tree/', payload).status_code,
            200,
        )

    @patch('curriculum_api.views.get_holiday_rows')
    def test_the_day_a_session_shifted_onto_is_taken(self, holidays):
        """The clash the old dating passed as free."""
        holidays.return_value = self.HOLIDAY_ROWS
        self.seed_group()
        self.tick_the_closed_wednesday()
        # Four Wednesdays from 16 September, stepping over the closed 23rd, so the
        # last session runs on 14 October rather than 7 October.
        self.add_module('Module Alpha', tutor='Tutor Solo')

        self.add_module(
            'Module Beta',
            expect=409,
            startDate='2026-10-14',
            sessionsNumber=1,
            tutor='Tutor Solo',
        )

    @patch('curriculum_api.views.get_holiday_rows')
    def test_the_closed_day_itself_is_free(self, holidays):
        """The clash the old dating invented.

        The second module sits in a cohort that ticked nothing, so it really does
        run on the 23rd -- the day the first module now does not.
        """
        holidays.return_value = self.HOLIDAY_ROWS
        self.seed_group()
        self.tick_the_closed_wednesday()
        self.add_module('Module Alpha', tutor='Tutor Solo')
        self.seed_open_group()

        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-OPEN-1/modules/', {
            'moduleName': 'Open Module',
            'startDate': '2026-09-23',
            'sessionsNumber': 1,
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
            'tutor': 'Tutor Solo',
        })
        self.assertEqual(response.status_code, 200, response.content)

    @patch('curriculum_api.views.get_holiday_rows')
    def test_the_preview_dates_the_slot_the_way_the_save_will(self, holidays):
        """Otherwise the warning names dates the save would never have named."""
        holidays.return_value = self.HOLIDAY_ROWS
        self.seed_group()
        self.tick_the_closed_wednesday()
        self.add_module('Module Alpha', tutor='Tutor Solo')

        response = self.post_json('/curriculum_api/curriculum/preview/tutor-availability/', {
            'startDate': '2026-09-16',
            'sessionsNumber': 4,
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
            'cohortId': 'COHORT-DATA-1',
            'tutor': 'Tutor Solo',
        })
        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(
            result['sessionDates'],
            ['2026-09-16', '2026-09-30', '2026-10-07', '2026-10-14'],
        )
        self.assertFalse(result['available'])
        self.assertEqual(
            result['conflicts'][0]['dates'],
            ['2026-09-16', '2026-09-30', '2026-10-07', '2026-10-14'],
        )

    @patch('curriculum_api.views.get_holiday_rows')
    def test_holidays_the_caller_sends_are_used(self, holidays):
        """A form previewing a selection that is not stored yet still gets it right."""
        holidays.return_value = self.HOLIDAY_ROWS
        self.seed_group()

        response = self.post_json('/curriculum_api/curriculum/preview/tutor-availability/', {
            'startDate': '2026-09-16',
            'sessionsNumber': 4,
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
            'holidays': [{'label': 'Autumn close', 'startDate': '2026-09-23', 'endDate': '2026-09-23'}],
            'tutor': 'Tutor Solo',
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            response.json()['sessionDates'],
            ['2026-09-16', '2026-09-30', '2026-10-07', '2026-10-14'],
        )
