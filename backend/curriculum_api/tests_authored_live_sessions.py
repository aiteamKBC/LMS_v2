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

    def test_a_session_keeps_its_own_clock_and_closes_on_its_own_duration(self):
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

    def test_a_live_session_with_no_date_is_not_placed_on_one(self):
        """A date nobody chose is not a date.

        The generated plan used to supply it, which put the session on the
        calendar and in the Teams series on a day the author never picked. It is
        reported as undated instead (the rail's "No date" mark).
        """
        self.components[1]['settings_json'] = {'sessionTime': '14:00', 'durationMinutes': 90}
        sessions = self.sessions()
        self.assertEqual([session['componentId'] for session in sessions], ['COMP-1', 'COMP-3'])
        self.assertEqual([session['date'] for session in sessions], ['2026-09-17', '2026-09-24'])

    def test_teams_expects_nothing_for_a_module_with_nothing_authored(self):
        self.components.clear()
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual(keys, [])

    def test_teams_never_expects_an_occurrence_for_an_undated_live_session(self):
        self.components[1]['settings_json'] = {'sessionTime': '14:00'}
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual([key[:10] for key in keys], ['2026-09-17', '2026-09-24'])

    # ------------------------------------------------------ the Teams verdict
    def test_teams_is_expected_to_hold_one_occurrence_per_live_session(self):
        keys, _plan = views.module_expected_teams_occurrence_keys(MODULE, [], {}, self.links())
        self.assertEqual(len(keys), 3)
        self.assertEqual([key[:10] for key in keys], ['2026-09-17', '2026-09-18', '2026-09-24'])

    def test_the_expected_instants_follow_each_components_own_clock(self):
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
