"""The Course structure is the authority for a module's live sessions.

**One live-session component is one session.** The module drawer says how many
WEEKS a module has; the live sessions are whatever the author put inside them.
So the number of sessions a module delivers, the date each one runs on, the
number of Teams occurrences created for it and the number of join links written
back all come from the components -- never from ``sessions_number``, which no
longer decides anything about what a module delivers.

Nothing is invented: a module with no authored live sessions delivers none,
and a live session nobody has dated is not placed on a date of our choosing.
Both used to be filled in from ``sessions_number`` and the generated weekly
plan, which is the misleading-fallback shape this file exists to prevent
coming back.

These are ``SimpleTestCase``s on purpose: every database route is stubbed, so
the rule is pinned without a database, a migration or a Graph call. The stub
also asserts that the live-session filter runs in SQL, because reading every
component's ``settings_json`` is the 24 MB read this code has to avoid.
"""
from django.test import SimpleTestCase

from . import views


MODULE = {
    'module_catalogue_id': 'MOD-1',
    'title': 'Martech',
    'status': 'published',
    'cohort_id': 'COHORT-1',
    'cohort_name': 'C1',
    'group_id': 'GROUP-1',
    'group_name': 'G1',
    'programme_name': 'Marketing',
    # Deliberately larger than the authored live sessions below, so a test that
    # passes cannot be passing because the two happen to agree.
    'sessions_number': 6,
    'start_date': '2026-09-17',
    'session_week_day': 'Thursday',
    'session_start_time': '09:00',
    'session_end_time': '11:00',
}

WEEK_ROWS = [
    {'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'display_order': 1, 'week_number': 1, 'title': 'W1'},
    {'id': 'WEEK-2', 'module_catalogue_id': 'MOD-1', 'display_order': 2, 'week_number': 2, 'title': 'W2'},
    # No live session at all. A week is still a week -- its reading and its
    # assignment stand -- but it delivers nothing to put on a calendar.
    {'id': 'WEEK-3', 'module_catalogue_id': 'MOD-1', 'display_order': 3, 'week_number': 3, 'title': 'W3'},
]


def component(component_id, week_id, order, settings=None, component_type='live_session'):
    return {
        'id': component_id,
        'week_id': week_id,
        'module_catalogue_id': 'MOD-1',
        'type': component_type,
        'title': f'Live {component_id}',
        'display_order': order,
        'settings_json': settings or {},
        'live_sessions_link': '',
    }


#: Week 1 delivers twice, week 2 once, week 3 not at all.
COMPONENT_ROWS = [
    component('COMP-1', 'WEEK-1', 1, {'sessionDate': '2026-09-17', 'sessionTime': '09:00', 'durationMinutes': 120}),
    component('COMP-2', 'WEEK-1', 2, {'sessionDate': '2026-09-18', 'sessionTime': '14:00', 'durationMinutes': 90}),
    component('COMP-3', 'WEEK-2', 1, {'sessionDate': '2026-09-24', 'sessionTime': '09:00', 'durationMinutes': 120}),
]


class AuthoredLiveSessionSourceTests(SimpleTestCase):
    """Every dated view of a module counts and dates its live sessions the same."""

    #: A ticked holiday on session three's own day. It warns and moves nothing.
    HOLIDAYS = {'COHORT-1': [{'date': '2026-09-24', 'label': 'Autumn closure'}]}

    def setUp(self):
        self.components = [dict(row) for row in COMPONENT_ROWS]
        self._real_fetch_all = views.authoring_fetch_all
        views.authoring_fetch_all = self._fetch_all
        self.addCleanup(setattr, views, 'authoring_fetch_all', self._real_fetch_all)

    def _fetch_all(self, table, where_sql='', params=None, order_sql='', **kwargs):
        if table == views.AUTHORING_WEEKS_TABLE:
            return [dict(row) for row in WEEK_ROWS]
        if table == views.AUTHORING_COMPONENTS_TABLE:
            # Narrowing to live sessions in SQL is what makes reading
            # `settings_json` affordable here at all.
            self.assertIn('live_session', where_sql)
            return [dict(row) for row in self.components]
        if table == views.AUTHORING_MODULES_TABLE:
            return [dict(MODULE)]
        return []

    def links(self):
        return views.authoring_session_links_by_catalogue(['MOD-1']).get('MOD-1') or []

    # ------------------------------------------------------------- the links
    def test_one_link_per_live_session_not_per_week(self):
        links = self.links()
        # Three components across two weeks: the week that delivers twice owns
        # two of them, and the week that delivers none owns nothing.
        self.assertEqual([link['componentId'] for link in links], ['COMP-1', 'COMP-2', 'COMP-3'])
        self.assertEqual([link['weekId'] for link in links], ['WEEK-1', 'WEEK-1', 'WEEK-2'])

    def test_each_link_carries_the_components_own_schedule(self):
        links = self.links()
        self.assertEqual([link['date'] for link in links], ['2026-09-17', '2026-09-18', '2026-09-24'])
        self.assertEqual([link['startTime'] for link in links], ['09:00', '14:00', '09:00'])
        self.assertEqual([link['durationMinutes'] for link in links], [120, 90, 120])

    def test_a_component_that_is_not_a_live_session_is_never_a_session(self):
        self.components.append(component('COMP-READ', 'WEEK-3', 1, {'sessionDate': '2026-10-01'}, 'reading'))
        self.assertEqual([link['componentId'] for link in self.links()], ['COMP-1', 'COMP-2', 'COMP-3'])

    # ---------------------------------------------------------- the sessions
    def sessions(self):
        return views.build_sessions_from_authoring_modules([MODULE], self.HOLIDAYS)

    def test_the_module_delivers_exactly_its_authored_live_sessions(self):
        # Not the six its `sessions_number` still says.
        self.assertEqual(len(self.sessions()), 3)

    def test_every_session_runs_on_its_own_components_date(self):
        self.assertEqual(
            [session['date'] for session in self.sessions()],
            ['2026-09-17', '2026-09-18', '2026-09-24'],
        )

    def test_every_session_names_the_component_that_is_that_session(self):
        sessions = self.sessions()
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-1', 'COMP-2', 'COMP-3'])
        # The real week, so a join link written back reaches the row the author
        # is looking at rather than a synthetic `MOD-1-week-N`.
        self.assertEqual([session['weekId'] for session in sessions], ['WEEK-1', 'WEEK-1', 'WEEK-2'])

    def test_a_booked_session_keeps_its_own_clock_and_closes_on_its_own_duration(self):
        self.components[1]['settings_json'] = {
            **self.components[1]['settings_json'], 'teamsLiveSessionId': 'LIVE-1', 'teamsSessionNumber': 2,
        }
        self.assertEqual(
            [(session['startTime'], session['endTime']) for session in self.sessions()],
            [('09:00', '11:00'), ('14:00', '15:30'), ('09:00', '11:00')],
        )

    def test_a_holiday_on_a_session_date_warns_and_moves_nothing(self):
        sessions = self.sessions()
        self.assertEqual(sessions[2]['date'], '2026-09-24')
        self.assertEqual(sessions[2]['skippedHolidays'], ['2026-09-24'])
        self.assertEqual([sessions[0]['skippedHolidays'], sessions[1]['skippedHolidays']], [[], []])

    def test_removing_a_live_session_removes_the_session_it_delivered(self):
        self.components.pop()
        sessions = self.sessions()
        self.assertEqual(len(sessions), 2)
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-1', 'COMP-2'])

    def test_a_module_with_no_authored_live_sessions_delivers_none(self):
        """Nothing is invented for an unfinished module.

        `sessions_number` is still 6 here. Reading it as a schedule put six
        sessions on the calendar that no author had written, and then created
        six Teams meetings for them. The screens say the module has no live
        sessions instead (`ScheduleGap` in the module workspace).
        """
        self.components.clear()
        self.assertEqual(self.sessions(), [])

    def test_an_additional_live_session_with_no_date_is_not_placed_on_one(self):
        """A date nobody chose is not a date.

        COMP-2 is the SECOND live session of week 1 and this group delivers
        once a week, so the week's only slot is COMP-1's and this one has just
        what its author gave it. Undated it stays undated (the rail's "No date"
        mark) -- it may not fall back to its week, which would put two meetings
        on 17 Sep, nor to the generated plan, which is the stand-in this file
        exists to keep out.
        """
        self.components[1]['settings_json'] = {'sessionTime': '14:00', 'durationMinutes': 90}
        sessions = self.sessions()
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-1', 'COMP-3'])
        self.assertEqual([session['date'] for session in sessions], ['2026-09-17', '2026-09-24'])

    # ----------------------------------------------- planned vs additional
    #
    # A week owns one planned slot per delivery day its group runs, and its Nth
    # live session takes the Nth of them, matched in `(display_order, id)`
    # order -- the order every reader of these rows already asks for. This
    # module delivers on Thursday only, so each week has ONE slot: COMP-1 and
    # COMP-3 are planned, COMP-2 is the additional second session of week 1.
    # `TwoDeliveryDayTests` below covers a week with two slots.

    def test_a_planned_live_session_runs_on_its_slot_with_no_date_of_its_own(self):
        """The 0-sessions bug: dated weeks, and a Teams dialog that saw none.

        A live session's stored date is a copy of its week's, written when the
        structure is served and persisted only on the next save. Reading just
        that copy told the Teams calendar a freshly authored module had no
        session dates at all, while the Module Builder beside it listed every
        week with a date.
        """
        self.components[0]['settings_json'] = {'sessionTime': '09:00', 'durationMinutes': 120}
        self.components[2]['settings_json'] = {'sessionTime': '09:00', 'durationMinutes': 120}
        sessions = self.sessions()
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-1', 'COMP-2', 'COMP-3'])
        self.assertEqual(
            [session['date'] for session in sessions],
            ['2026-09-17', '2026-09-18', '2026-09-24'],
        )

    def test_a_stale_date_on_a_planned_session_does_not_outvote_its_slot(self):
        """The copy follows the plan; it is never a second opinion.

        Otherwise a module moved to another start date keeps its sessions -- and
        its Teams occurrences -- on the days it was first stamped with, while
        the week headers above them already read the new ones.
        """
        self.components[0]['settings_json'] = {
            **self.components[0]['settings_json'], 'sessionDate': '2026-08-06',
        }
        self.assertEqual([session['date'] for session in self.sessions()][0], '2026-09-17')

    def test_moving_the_week_moves_the_planned_session_and_leaves_the_additional_alone(self):
        """One week later: the planned session follows, the additional stays put."""
        later = {**MODULE, 'start_date': '2026-09-24'}
        sessions = views.build_sessions_from_authoring_modules([later], self.HOLIDAYS)
        self.assertEqual(
            [(session['componentId'], session['date']) for session in sessions],
            [('COMP-1', '2026-09-24'), ('COMP-2', '2026-09-18'), ('COMP-3', '2026-10-01')],
        )

    def test_a_booked_planned_session_keeps_the_date_microsoft_holds_it_on(self):
        """Only the reschedule flow moves a meeting real people were invited to."""
        self.components[0]['settings_json'] = {
            **self.components[0]['settings_json'],
            'sessionDate': '2026-08-06', 'teamsLiveSessionId': 'LIVE-1', 'teamsSessionNumber': 1,
        }
        self.assertEqual([session['date'] for session in self.sessions()][0], '2026-08-06')

    def test_teams_expects_nothing_for_a_module_with_nothing_authored(self):
        self.components.clear()
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual(keys, [])

    def test_teams_never_expects_an_occurrence_for_an_undated_additional_session(self):
        self.components[1]['settings_json'] = {'sessionTime': '14:00'}
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual([key[:10] for key in keys], ['2026-09-17', '2026-09-24'])

    # ------------------------------------------------------ the Teams verdict
    def test_teams_is_expected_to_hold_one_occurrence_per_live_session(self):
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual(len(keys), 3)
        self.assertEqual([key[:10] for key in keys], ['2026-09-17', '2026-09-18', '2026-09-24'])

    def test_the_expected_instants_keep_a_booked_components_own_clock(self):
        self.components[1]['settings_json'] = {
            **self.components[1]['settings_json'], 'teamsLiveSessionId': 'LIVE-1', 'teamsSessionNumber': 2,
        }
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        # 09:00 and 14:00 in the business zone during BST.
        self.assertEqual([key[11:] for key in keys], ['08:00', '13:00', '08:00'])

    def test_the_verdict_reads_the_same_dates_the_session_list_does(self):
        """The two must never be able to disagree.

        A calendar built from the components and a verdict computed from
        `sessions_number` would report every module as permanently out of sync,
        and pressing Update could never resolve it.
        """
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual([key[:10] for key in keys], [session['date'] for session in self.sessions()])


class PreferAuthoringModuleSessionsTests(SimpleTestCase):
    """A module with zero authored live sessions still belongs to the authoring system.

    Found live in the Teams Meetings page: a module with no live-session
    components at all showed a full generated calendar -- 14 sessions dated from
    ``sessions_number``, one per delivery day. `authoring_sessions` for that
    module is `[]`, and the merge used to read the module's authoring id from
    *that* list, so an empty list meant "the authoring system has no opinion
    here" and let the legacy training-row generator (`build_sessions`, which
    still reads `sessions_number`) fill the gap instead of leaving it empty.
    """

    TRAINING_SESSION = {'moduleCatalogueId': 'MOD-1', 'date': '2026-08-06', 'sessionNumber': 1}

    def test_a_catalogue_module_with_no_live_sessions_still_suppresses_the_legacy_ones(self):
        sessions = views.prefer_authoring_module_sessions(
            [self.TRAINING_SESSION], [], authoring_catalogue_ids=['MOD-1'],
        )
        self.assertEqual(sessions, [])

    def test_a_training_row_with_no_matching_authoring_module_is_left_alone(self):
        # A module never migrated into the authoring system: still legacy, still legitimate.
        sessions = views.prefer_authoring_module_sessions(
            [self.TRAINING_SESSION], [], authoring_catalogue_ids=['MOD-OTHER'],
        )
        self.assertEqual(sessions, [self.TRAINING_SESSION])

    def test_an_authored_session_still_wins_over_its_own_training_row(self):
        authored = {'moduleCatalogueId': 'MOD-1', 'date': '2026-09-17', 'componentId': 'COMP-1'}
        sessions = views.prefer_authoring_module_sessions(
            [self.TRAINING_SESSION], [authored], authoring_catalogue_ids=['MOD-1'],
        )
        self.assertEqual(sessions, [authored])

    def test_omitting_the_catalogue_ids_falls_back_to_the_old_behaviour(self):
        # Callers that do not yet know every authoring module id (there are
        # none left in this codebase, but the parameter is optional) keep the
        # previous behaviour rather than breaking outright.
        sessions = views.prefer_authoring_module_sessions([self.TRAINING_SESSION], [])
        self.assertEqual(sessions, [self.TRAINING_SESSION])


class LiveSessionFollowsItsWeekTests(SimpleTestCase):
    """A live session runs on the day its week runs on.

    The date stored on a live-session component is a copy of the plan's, not a
    second opinion, so it follows the plan whenever the plan moves -- a changed
    ``start_date``, a week dragged up the rail, a week inserted ahead of it.
    Keeping the first-stamped date instead let a week headed 09 Oct hold a
    session dated 30 Oct, and the session's date is the one
    ``authoring_session_links_by_catalogue`` hands to the calendar and to Teams.

    The one date this may not move is an occurrence Microsoft has confirmed.
    Real people hold an invitation to it, so it changes by asking Microsoft
    through the reschedule endpoint, never by a planner rewriting it underneath
    them.

    Mirrors ``applyModuleWeekSessionPlan`` in
    ``module-builder/moduleAuthoringData.ts``; the two walks must agree, or the
    builder's first render silently rewrites what this just sent.
    """

    # Thursdays. Week 1 of a module starting 2026-09-17 runs on 2026-09-17.
    MODULE = dict(MODULE)

    def _weeks(self, settings):
        return [{
            'id': 'WEEK-1', 'weekNumber': 1, 'title': 'W1',
            'components': [{'id': 'COMP-1', 'type': 'live-session', 'settings': dict(settings)}],
        }]

    def _apply(self, settings):
        weeks = views.apply_module_session_plan_to_weeks(self.MODULE, None, self._weeks(settings), holidays=[])
        return weeks[0]['components'][0]['settings'], weeks[0]

    def test_a_session_left_on_an_old_date_is_moved_onto_its_week(self):
        settings, week = self._apply({'sessionDate': '2026-10-08', 'sessionTime': '09:00'})
        self.assertEqual(settings['sessionDate'], '2026-09-17')
        # The week and the session name the same day: the disagreement that
        # started all of this is what this asserts away.
        self.assertEqual(settings['sessionDate'], week['sessionDate'])

    def test_the_stored_instant_is_re_derived_rather_than_left_behind(self):
        # Learner timelines and the programme calendar read this, so a stale one
        # goes on pointing at the old day after the date above has moved.
        settings, _week = self._apply({'sessionDate': '2026-10-08', 'sessionTime': '09:00'})
        self.assertTrue(settings['sessionDateTimeUtc'].startswith('2026-09-17'))

    def test_an_unbooked_session_inherits_the_delivery_clock_when_moved(self):
        # New meetings follow the assigned schedule, including old component defaults.
        settings, _week = self._apply({'sessionDate': '2026-10-08', 'sessionTime': '19:00', 'durationMinutes': 45})
        self.assertEqual(settings['sessionDate'], '2026-09-17')
        self.assertEqual(settings['sessionTime'], '09:00')
        self.assertEqual(settings['durationMinutes'], 120)

    def test_a_meeting_microsoft_has_confirmed_is_not_moved(self):
        settings, _week = self._apply({
            'sessionDate': '2026-10-08', 'sessionTime': '09:00',
            'teamsLiveSessionId': 'LIVE-1', 'teamsSessionNumber': 1,
        })
        self.assertEqual(settings['sessionDate'], '2026-10-08')

    def test_the_instant_this_writes_itself_is_not_mistaken_for_a_booking(self):
        # This stamp is written on every date this sets, so counting it as proof
        # of a Teams booking froze every date the planner had ever written --
        # which is exactly how the stale dates survived.
        settings, _week = self._apply({
            'sessionDate': '2026-10-08', 'sessionTime': '09:00',
            'sessionDateTimeUtc': '2026-10-08T08:00:00Z',
        })
        self.assertEqual(settings['sessionDate'], '2026-09-17')


#: A Mon+Fri group. Both delivery days are planned slots, so a week owns two.
TWO_DAY_MODULE = {
    'module_catalogue_id': 'MOD-2DAY',
    'title': 'Twice weekly',
    'cohort_id': 'COHORT-2',
    'cohort_name': 'C2',
    'group_id': 'GROUP-2',
    'group_name': 'G2',
    'programme_name': 'Marketing',
    'sessions_number': 9,
    'start_date': '2026-10-05',
    'session_week_day': 'Monday, Friday',
    'session_start_time': '09:00',
    'session_end_time': '11:00',
}

TWO_DAY_WEEK_ROWS = [
    {'id': 'W2D-1', 'module_catalogue_id': 'MOD-2DAY', 'display_order': 1, 'week_number': 1, 'title': 'W1'},
    {'id': 'W2D-2', 'module_catalogue_id': 'MOD-2DAY', 'display_order': 2, 'week_number': 2, 'title': 'W2'},
]


def two_day_component(component_id, week_id, order, settings=None):
    return {
        'id': component_id, 'week_id': week_id, 'module_catalogue_id': 'MOD-2DAY',
        'type': 'live_session', 'title': f'Live {component_id}', 'display_order': order,
        'settings_json': settings or {}, 'live_sessions_link': '',
    }


class TwoDeliveryDayTests(SimpleTestCase):
    """A week owns one planned slot per delivery day, paired by position.

    The Nth live session of a week takes the Nth delivery slot, in
    ``(display_order, id)`` order. A Mon+Fri group therefore plans BOTH of a
    week's first two live sessions and moves both when the week moves. Only a
    live session beyond the week's delivery days is additional, dated by its
    author or not at all.

    The slots are the scheduler's own and are never re-derived here:
    ``build_module_session_plan`` walks a date cursor and emits one per
    delivery day, so they arrive in calendar order with their closures already
    attached -- which is why a group listed Friday-first still delivers Monday
    first.
    """

    def setUp(self):
        # Week 1 holds three live sessions against two delivery days; week 2
        # holds one. So A and B are planned, C is additional, D is planned.
        self.components = [
            two_day_component('C2D-A', 'W2D-1', 1, {'sessionTime': '09:00', 'durationMinutes': 120}),
            two_day_component('C2D-B', 'W2D-1', 2, {'sessionTime': '09:00', 'durationMinutes': 120}),
            two_day_component('C2D-C', 'W2D-1', 3, {'sessionDate': '2026-10-07', 'sessionTime': '14:00'}),
            two_day_component('C2D-D', 'W2D-2', 1, {'sessionTime': '09:00', 'durationMinutes': 120}),
        ]
        self.holidays = {}
        real = views.authoring_fetch_all
        views.authoring_fetch_all = self._fetch_all
        self.addCleanup(setattr, views, 'authoring_fetch_all', real)

    def _fetch_all(self, table, where_sql='', params=None, order_sql='', **kwargs):
        if table == views.AUTHORING_WEEKS_TABLE:
            return [dict(row) for row in TWO_DAY_WEEK_ROWS]
        if table == views.AUTHORING_COMPONENTS_TABLE:
            self.assertIn('live_session', where_sql)
            return [dict(row) for row in self.components]
        if table == views.AUTHORING_MODULES_TABLE:
            return [dict(TWO_DAY_MODULE)]
        return []

    def dated(self, module=None):
        sessions = views.build_sessions_from_authoring_modules([module or TWO_DAY_MODULE], self.holidays)
        return [(session['componentId'], session['date']) for session in sessions]

    def test_each_delivery_day_of_the_week_is_a_planned_slot(self):
        # Monday 5 Oct and Friday 9 Oct: the week's first two live sessions
        # take one each, in delivery order, with no date of their own stored.
        self.assertEqual(self.dated()[:2], [('C2D-A', '2026-10-05'), ('C2D-B', '2026-10-09')])

    def test_a_third_live_session_keeps_its_own_manual_date(self):
        # The group does not deliver a third time that week, so C is additional
        # and runs on the Wednesday its author chose.
        self.assertEqual(dict(self.dated())['C2D-C'], '2026-10-07')

    def test_an_undated_third_live_session_stays_undated_and_never_reaches_teams(self):
        self.components[2]['settings_json'] = {'sessionTime': '14:00'}
        self.assertEqual(
            self.dated(),
            [('C2D-A', '2026-10-05'), ('C2D-B', '2026-10-09'), ('C2D-D', '2026-10-12')],
        )
        links = views.authoring_session_links_by_catalogue(['MOD-2DAY']).get('MOD-2DAY') or []
        keys, _plan = views.module_expected_teams_occurrence_keys(TWO_DAY_MODULE, [], {}, links)
        self.assertEqual([key[:10] for key in keys], ['2026-10-05', '2026-10-09', '2026-10-12'])

    def test_moving_the_week_moves_both_planned_sessions_to_their_own_new_days(self):
        # One week on: Monday 12 Oct and Friday 16 Oct. The additional session
        # is untouched -- it was put on 7 Oct deliberately.
        later = {**TWO_DAY_MODULE, 'start_date': '2026-10-12'}
        self.assertEqual(self.dated(later), [
            ('C2D-A', '2026-10-12'), ('C2D-B', '2026-10-16'),
            ('C2D-C', '2026-10-07'), ('C2D-D', '2026-10-19'),
        ])

    def test_stale_stored_dates_never_outvote_the_delivery_slots(self):
        self.components[0]['settings_json']['sessionDate'] = '2026-08-03'
        self.components[1]['settings_json']['sessionDate'] = '2026-08-07'
        self.assertEqual(self.dated()[:2], [('C2D-A', '2026-10-05'), ('C2D-B', '2026-10-09')])

    def test_a_booked_planned_session_is_not_moved_by_a_changed_delivery_slot(self):
        # B sits where Microsoft holds it; A, unbooked, still follows its slot.
        self.components[1]['settings_json'] = {
            'sessionDate': '2026-09-25', 'sessionTime': '09:00',
            'teamsLiveSessionId': 'LIVE-2', 'teamsSessionNumber': 2,
        }
        self.assertEqual(self.dated()[:2], [('C2D-A', '2026-10-05'), ('C2D-B', '2026-09-25')])

    def test_a_closure_is_read_off_the_scheduler_not_recalculated_here(self):
        # A ticked holiday on the Friday. The slot keeps its own date -- a
        # holiday warns, it never moves the run -- and the session says which
        # closure lands on it. Both facts come from the plan the scheduler
        # built, so nothing here does weekday arithmetic of its own.
        self.holidays = {'COHORT-2': [{'date': '2026-10-09', 'label': 'Autumn closure'}]}
        sessions = views.build_sessions_from_authoring_modules([TWO_DAY_MODULE], self.holidays)
        by_id = {session['componentId']: session for session in sessions}
        self.assertEqual(by_id['C2D-B']['date'], '2026-10-09')
        self.assertEqual(by_id['C2D-B']['skippedHolidays'], ['2026-10-09'])
        self.assertEqual(by_id['C2D-A']['skippedHolidays'], [])
