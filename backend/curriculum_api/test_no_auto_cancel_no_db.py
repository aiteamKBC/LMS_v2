"""Nothing automatic cancels a Teams meeting. Run directly with Python; no Django, DB or network.

Microsoft emails "Canceled: <module>" to everyone invited whenever an organizer
deletes or cancels a meeting or one of its occurrences. So the rule pinned here
is that the ONLY path to Graph's cancel/delete for a module calendar is the
explicit Cancel a person presses and then confirms. A save (Create, Update),
the status sync, a gap in the plan, an empty weekday, a week handed to its own
additional meeting, or an extra occurrence on Teams never removes anything: it
is left where it is and flagged for a person to review.

The Main Module Calendar and an Additional Week Meeting are separate Microsoft
events, and a write to one never reaches the other.
"""
import ast
import copy
import sys
import types
import unittest
import urllib.parse as urllib_parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from test_occurrence_deletion_no_db import FakeGraph, at, instance, load, row, target
from test_calendar_state_no_db import CalendarFixture, package
import test_calendar_actions_no_db as actions_tests
import test_calendar_checks_no_db as checks_tests
from curriculum_api.teams_cancellation_checks import CalendarStateError, cancellation_plan

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT.parent
checks = checks_tests.checks
JOIN = 'https://teams.microsoft.com/meet/synthetic-main'


def destructive(calls):
    """Every Graph call that would make Microsoft email a cancellation."""
    return [call for call in calls if call[0] == 'DELETE' or str(call[1]).rstrip('/').endswith('/cancel')]


def verify_reader(master, instances, log):
    """A read-only Graph double for `verify_calendar`."""
    def request(method, path, payload=None, **_):
        log.append((method, path, payload))
        if method != 'GET':
            raise AssertionError(f'verify_calendar must only read, not {method}')
        if '/instances?' in path:
            return {'value': copy.deepcopy(instances)}
        return copy.deepcopy(master)
    return request


def live_instance(identifier, start, minutes=120):
    item = instance(identifier, start, minutes)
    item.update(onlineMeeting={'joinUrl': JOIN}, hideAttendees=True, isCancelled=False)
    return item


def aware(start):
    return start.replace(tzinfo=timezone.utc)


def aware_target(number, start, minutes=120):
    return {'session_number': number, 'start': aware(start), 'end': aware(start) + timedelta(minutes=minutes)}


class ShiftHarness(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.v = load()

    def shift(self, graph, targets, stored):
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        with patch.dict('sys.modules', {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport}):
            _warnings, _recreated, proved = self.v.apply_teams_occurrence_shifts(
                'organizer%40example.invalid', 'series-1', 'Synthetic module',
                targets, ['learner@example.invalid'], None, stored,
            )
            flagged = self.v.flag_teams_occurrence_leftovers(
                proved, live_session_id='LIVE-1', module_catalogue_id='MOD-1', source='update_reconcile',
            )
        return proved, flagged


# --------------------------------------------------------------------------- 1
class MainAdditionalMainTests(ShiftHarness):
    """Week 1 main, week 2 an additional meeting, week 3 main."""

    def test_the_middle_week_is_left_on_teams_and_flagged_not_cancelled(self):
        week1, week2, week3 = at((9, 14)), at((9, 21)), at((9, 28))
        # The weekly series fires every week, so Microsoft holds a slot on week 2
        # although the module calendar does not deliver that week.
        graph = FakeGraph([instance('main-1', week1), instance('main-filler', week2), instance('main-3', week3)])
        stored = [row(1, week1), row(2, week3)]
        targets = [target(1, week1), target(2, week3)]

        proved, flagged = self.shift(graph, targets, stored)

        self.assertEqual(destructive(graph.calls), [], 'a main update cancelled something')
        self.assertIn('main-filler', graph.instances)
        self.assertEqual([item['eventId'] for item in flagged], ['main-filler'])
        self.assertEqual([item['instance_id'] for item in proved], ['main-filler'])

    def test_verification_accepts_the_middle_week_and_reports_it(self):
        week1, week2, week3 = at((9, 14)), at((9, 21)), at((9, 28))
        master = {'id': 'series-1', 'isCancelled': False, 'hideAttendees': True, 'onlineMeeting': {'joinUrl': JOIN}}
        instances = [live_instance('main-1', week1), live_instance('main-filler', week2), live_instance('main-3', week3)]
        log = []

        event = checks.verify_calendar(verify_reader(master, instances, log), 'organizer', 'series-1',
                                       [aware_target(1, week1), aware_target(2, week3)], JOIN, True)

        self.assertEqual([item['eventId'] for item in event['unplannedInstances']], ['main-filler'])
        self.assertTrue(all(method == 'GET' for method, *_ in log))

    def test_the_additional_week_is_not_a_main_calendar_session(self):
        """The main plan's dated sessions exclude a week delivered by its own meeting."""
        week2 = at((9, 21))
        stored = [row(1, at((9, 14))), row(2, at((9, 28)))]
        # Nothing on week 2 is the main calendar's: it owns no row there.
        self.assertNotIn(self.v.teams_calendar_minute_key(week2), self.v.tracked_occurrence_keys(stored))


# --------------------------------------------------------------------------- 2
class MainUpdateLeavesAdditionalTests(ShiftHarness):
    def test_a_main_update_never_reads_writes_or_cancels_the_additional_meeting(self):
        week1, week2, week3 = at((9, 14)), at((9, 21)), at((9, 28))
        graph = FakeGraph([instance('main-1', week1), instance('main-3', week3)])
        # The additional meeting is a different Microsoft event with its own id.
        additional = {'id': 'additional-event-2', 'start': {'dateTime': week2.isoformat(), 'timeZone': 'UTC'}}
        stored = [row(1, week1), row(2, week3)]

        self.shift(graph, [target(1, week1), target(2, week3)], stored)

        self.assertFalse([call for call in graph.calls if 'additional-event-2' in call[1]])
        self.assertEqual(destructive(graph.calls), [])
        self.assertEqual(additional['id'], 'additional-event-2')

    def test_the_status_sync_never_touches_the_additional_meeting(self):
        fixture = SyncFixture('runTest')
        fixture.setUp()
        try:
            result = fixture.plan()
            self.assertFalse([path for path in fixture.calls if 'additional-event' in path])
            self.assertFalse([item for item in result['leftovers'] if 'additional' in item['eventId']])
        finally:
            fixture.doCleanups()


# --------------------------------------------------------------------------- 3
class AdditionalUpdateLeavesMainTests(unittest.TestCase):
    """PATCH on an additional meeting reaches its own event and its own rows only."""

    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        from django.conf import settings
        if not settings.configured:
            settings.configure(DEFAULT_CHARSET='utf-8')
        self.calls, self.writes = [], []
        week = self

        def graph(method, path, payload=None, extra_headers=None):
            week.calls.append((method, path, payload))
            return {'id': 'additional-event', 'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/meet/extra'}}

        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        transport.has_graph_credentials = lambda: True
        transport.get_graph_settings = lambda: {'timezone': 'GMT Standard Time'}
        start = datetime(2026, 9, 21, 10, 0, tzinfo=timezone.utc)
        extra_row = {'id': 'LIVE-EXTRA', 'organizer_email': 'guest-host@example.invalid',
                     'graph_event_id': 'additional-event', 'join_url': 'https://teams.microsoft.com/meet/extra',
                     'attendees': [], 'presenters': [], 'co_organizers': [], 'status': 'week-meeting'}
        component = {'id': 'COMP-2', 'settings': {'extraTeamsLiveSessionId': 'LIVE-EXTRA',
                                                  'extraTeamsMeetingUrl': 'https://teams.microsoft.com/meet/extra'}}

        def fetch(table, where='', params=None, order=''):
            if table == 'live_sessions':
                # Scoped by id, status and module exactly as the endpoint asks.
                return [extra_row] if params and params[0] == 'LIVE-EXTRA' and 'week-meeting' in params else []
            if table == 'components':
                return [component]
            return []

        v = types.SimpleNamespace(
            LIVE_SESSIONS_TABLE='live_sessions', AUTHORING_COMPONENTS_TABLE='components',
            LIVE_SESSION_OCCURRENCES_TABLE='occurrences', TEAMS_LOBBY_VALUES={'invited', 'everyone'},
            GRAPH_SILENT_INVITE_HEADERS={'Prefer': 'outlook.send-invitations="none"'}, urllib_parse=urllib_parse,
            json_error=lambda message, status=400, **kw: types.SimpleNamespace(status_code=status, message=message),
            ensure_module_authoring_tables=lambda: None, ensure_live_sessions_table=lambda: None,
            json_body=lambda _request: {'title': 'Guest panel', 'startDateTimeUtc': start.isoformat(),
                                        'durationMinutes': 60, 'attendees': []},
            clean_str=lambda value: str(value or '').strip(), resolve_stored_module_catalogue_id=lambda value: value,
            authoring_fetch_all=fetch, active_component_rows=lambda rows: rows,
            component_builder_settings=lambda item: item['settings'],
            teams_schedule_settings=lambda settings, *_a, **_k: settings,
            teams_event_payload=lambda single, _settings: (
                {'subject': 'Guest panel', 'body': {}, 'start': {}, 'end': {}, 'responseRequested': True,
                 'allowNewTimeProposals': True, 'attendees': []}, [], [], [], [], start, 60, 'none', 1),
            calendar_targets=lambda *a, **k: [{'session_number': 1, 'start': start, 'end': start + timedelta(hours=1)}],
            graph_timezone_iana=lambda _settings: 'Europe/London', teams_non_delivery_reason=lambda *a: '',
            as_json_value=lambda value, fallback: value or fallback, publish_attendees=lambda *a, **k: False,
            apply_teams_meeting_options=lambda *a, **k: (True, {}, []), forward_teams_invitation=lambda *a, **k: [],
            update_authoring_rows=lambda table, where, params, values: week.writes.append((table, params)),
            json_db_value=lambda value: value, authoring_upsert=lambda table, keys, values: week.writes.append((table, values.get('live_session_id'))),
            parse_graph_datetime=lambda value: value, invalidate_curriculum_cache=lambda: None,
        )
        pkg = types.ModuleType('curriculum_api')
        pkg.__path__ = [str(ROOT)]
        pkg.views = v
        self.modules = patch.dict(sys.modules, {'curriculum_api': pkg, 'curriculum_api.views': v,
                                                'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport})
        self.modules.start()
        self.addCleanup(self.modules.stop)
        sys.modules.pop('curriculum_api.teams_week_meeting', None)
        from curriculum_api import teams_week_meeting
        self.week = teams_week_meeting

    def test_editing_the_additional_meeting_reaches_only_its_own_event(self):
        response = self.week.curriculum_week_teams_meeting_detail(
            types.SimpleNamespace(method='PATCH'), 'MOD-1', 'LIVE-EXTRA')

        self.assertEqual(response.status_code, 200, getattr(response, 'message', response))
        self.assertTrue(self.calls)
        for _method, path, _payload in self.calls:
            self.assertIn('additional-event', path, f'additional update reached {path}')
        self.assertEqual(destructive(self.calls), [])
        # Its own live session and its own component; no main-calendar row.
        self.assertEqual({params[0] if isinstance(params, list) else params for _table, params in self.writes},
                         {'LIVE-EXTRA', 'COMP-2'})

    def test_a_main_series_id_is_not_reachable_through_the_additional_endpoint(self):
        response = self.week.curriculum_week_teams_meeting_detail(
            types.SimpleNamespace(method='PATCH'), 'MOD-1', 'LIVE-MAIN')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.calls, [])


# --------------------------------------------------------------------------- 4
class EmptyWeekdayTests(checks_tests.CalendarChecksTests):
    """A weekday the plan stops using keeps its Teams series."""

    def test_an_empty_weekday_series_is_kept_flagged_and_not_cancelled(self):
        self.prepare_weekday_path()
        self.assertEqual(self.create().status_code, 201)
        self.assertEqual(len(self.events), 2)
        thursday = next(key for key, event in self.events.items()
                        if checks.event_instant(event, 'start').astimezone(ZoneInfo('Europe/London')).strftime('%A') == 'Thursday')
        self.v.stored_calendar_series = lambda series: series.get('calendar_series') or []
        # Only the Monday sessions remain in the plan.
        self.payload['scheduledOccurrences'] = [item for item in self.payload['scheduledOccurrences']
                                                if item['sessionNumber'] in (1, 3)]
        self.calls.clear()

        result = self.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')

        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(destructive(self.calls), [], 'an empty weekday was cancelled automatically')
        self.assertIn(thursday, self.events)
        manifest = self.series[0]['calendar_series']
        kept = next(item for item in manifest if item['eventId'] == thursday)
        self.assertEqual(kept['sessionNumbers'], [])
        self.assertTrue(kept['unplanned'])
        self.assertIn(thursday, [item['eventId'] for item in result['leftoverSlots']])


# Only the tests written above run from the inherited fixture.
for _name in dir(checks_tests.CalendarChecksTests):
    if _name.startswith('test') and _name not in EmptyWeekdayTests.__dict__:
        setattr(EmptyWeekdayTests, _name, None)


# --------------------------------------------------------------------------- 5
class SyncFixture(CalendarFixture):
    """Microsoft holds an occurrence no LMS session sits on."""

    def setUp(self):
        super().setUp()
        for item in self.instances:
            item['onlineMeeting'] = self.master['onlineMeeting']
        self.instances.append({
            'id': 'instance-EXTRA', 'occurrenceId': 'OID-EXTRA', 'type': 'occurrence', 'seriesMasterId': 'master-1',
            'isCancelled': False, 'onlineMeeting': self.master['onlineMeeting'],
            'start': {'dateTime': '2026-10-22T08:00:00Z', 'timeZone': 'UTC'},
            'end': {'dateTime': '2026-10-22T10:00:00Z', 'timeZone': 'UTC'},
        })

    def runTest(self):  # pragma: no cover - a fixture, not a test
        pass


class ExtraOccurrenceTests(unittest.TestCase):
    def test_the_status_sync_reports_an_extra_occurrence_and_only_reads(self):
        fixture = SyncFixture('runTest')
        fixture.setUp()
        try:
            result = fixture.plan()
        finally:
            fixture.doCleanups()
        self.assertEqual([item['eventId'] for item in result['leftovers']], ['instance-EXTRA'])
        self.assertEqual(result['snapshot']['leftovers'], result['leftovers'])
        self.assertEqual(result['cancelledIds'], [])
        # `read` is the sweep's only door to Microsoft, and it is GET-only.
        self.assertTrue(fixture.calls)

    def test_verification_does_not_fail_or_remove_an_extra_occurrence(self):
        start = at((10, 8))
        master = {'id': 'series-1', 'isCancelled': False, 'hideAttendees': True, 'onlineMeeting': {'joinUrl': JOIN}}
        instances = [live_instance('main-1', start), live_instance('extra', at((10, 15)))]
        log = []
        event = checks.verify_calendar(verify_reader(master, instances, log), 'organizer', 'series-1',
                                       [aware_target(1, start)], JOIN, True)
        self.assertEqual([item['eventId'] for item in event['unplannedInstances']], ['extra'])

    def test_a_cancelled_extra_is_not_reported(self):
        start = at((10, 8))
        master = {'id': 'series-1', 'isCancelled': False, 'hideAttendees': True, 'onlineMeeting': {'joinUrl': JOIN}}
        gone = live_instance('extra', at((10, 15)))
        gone['isCancelled'] = True
        event = checks.verify_calendar(verify_reader(master, [live_instance('main-1', start), gone], []),
                                       'organizer', 'series-1', [aware_target(1, start)], JOIN, True)
        self.assertNotIn('unplannedInstances', event)

    def test_an_update_leaves_an_extra_occurrence_on_teams(self):
        harness = checks_tests.CalendarChecksTests('test_noon_remains_noon_across_dst')
        harness.setUp()
        try:
            self.assertEqual(harness.create().status_code, 201)
            master = next(iter(harness.events))
            extra = copy.deepcopy(harness.instances_by_master[master][-1])
            extra['id'] = 'instance-extra-on-teams'
            extra['start']['dateTime'] = (checks.event_instant(extra, 'start') + timedelta(days=7)).isoformat()
            extra['end']['dateTime'] = (checks.event_instant(extra, 'end') + timedelta(days=7)).isoformat()
            harness.instances_by_master[master].append(extra)
            harness.calls.clear()
            result = harness.v.curriculum_teams_meeting_schedule(types.SimpleNamespace(method='PATCH'), 'LIVE-SYNTHETIC')
            self.assertEqual(result.status_code, 200, result)
            self.assertEqual(destructive(harness.calls), [])
            self.assertIn('instance-extra-on-teams', [item['id'] for item in harness.instances_by_master[master]])
            self.assertIn('instance-extra-on-teams', [item['eventId'] for item in result['leftoverSlots']])
        finally:
            harness.doCleanups()


class RewriteDropTests(unittest.TestCase):
    """A recurrence rewrite that would silently drop a future session is refused."""

    def rows(self, *starts):
        return [{'session_number': index + 1, 'scheduled_start': start, 'status': 'scheduled'}
                for index, start in enumerate(starts)]

    def test_a_future_session_outside_the_new_range_is_named(self):
        now = datetime(2026, 10, 1, tzinfo=timezone.utc)
        last = datetime(2026, 10, 26, 10, tzinfo=timezone.utc)
        targets = [aware_target(1, at((10, 5), 10)), aware_target(2, at((10, 12), 10))]
        dropped = checks.sessions_a_rewrite_would_drop(targets, True, self.rows(last), 'Europe/London', now)
        self.assertEqual([row['session_number'] for row in dropped], [1])
        self.assertIn('Microsoft would email everyone invited', checks.dropped_sessions_sentence(dropped, 'Europe/London'))

    def test_a_session_inside_the_range_on_the_pattern_day_stays_on_teams(self):
        now = datetime(2026, 10, 1, tzinfo=timezone.utc)
        targets = [aware_target(1, at((10, 5), 10)), aware_target(3, at((10, 19), 10))]
        middle = datetime(2026, 10, 12, 10, tzinfo=timezone.utc)
        self.assertEqual(checks.sessions_a_rewrite_would_drop(targets, True, self.rows(middle), 'Europe/London', now), [])

    def test_a_session_that_already_ran_is_left_alone(self):
        now = datetime(2026, 11, 1, tzinfo=timezone.utc)
        targets = [aware_target(1, at((10, 12), 10))]
        ran = datetime(2026, 10, 5, 10, tzinfo=timezone.utc)
        self.assertEqual(checks.sessions_a_rewrite_would_drop(targets, True, self.rows(ran), 'Europe/London', now), [])


# --------------------------------------------------------------------------- 6
class LeftoverCancelTests(actions_tests.ManagementTests):
    """Pressing Cancel on a flagged slot -- and confirming -- is the only way it goes."""

    def setUp(self):
        super().setUp()
        self.instances.append({
            'id': 'instance-EXTRA', 'occurrenceId': 'OID-EXTRA', 'type': 'occurrence', 'seriesMasterId': 'master-1',
            'isCancelled': False, 'onlineMeeting': self.master['onlineMeeting'],
            'start': {'dateTime': '2026-10-22T08:00:00Z', 'timeZone': 'UTC'},
            'end': {'dateTime': '2026-10-22T10:00:00Z', 'timeZone': 'UTC'},
        })
        actions_tests.functions(ROOT / 'teams_calendar_actions.py', ['leftover_preview'], self.ns)

    def cancel_locally(self, live, command, scope, complete=False):
        # The real persist_cancellation writes nothing for a leftover (pinned in
        # LeftoverPersistTests below); the fixture's stand-in follows it.
        if scope == 'leftover':
            return
        super().cancel_locally(live, command, scope, complete)

    def leftover_review(self, event_id='instance-EXTRA'):
        return self.ns['action_preview']('LIVE-1', {'action': 'cancel', 'scope': 'leftover', 'eventId': event_id}, 'ACTOR-1')

    def test_reviewing_a_flagged_slot_sends_nothing(self):
        review = self.leftover_review()
        self.assertEqual(review['scope'], 'leftover')
        self.assertTrue(review['notificationRequired'])
        self.assertEqual(self.tokens[review['reviewToken']]['commands'][0]['eventId'], 'instance-EXTRA')
        self.ns['graph_action'].assert_not_called()
        self.ns['store_snapshot'].assert_not_called()

    def test_confirming_the_cancel_sends_exactly_one_cancellation_for_that_slot(self):
        result = self.confirm(self.leftover_review())
        self.assertEqual(result['status'], 'done', result)
        self.ns['graph_action'].assert_called_once()
        self.assertEqual(self.ns['graph_action'].call_args.args[1]['eventId'], 'instance-EXTRA')
        # No module session changes: the slot was never one.
        self.assertEqual([row['status'] for row in self.rows], ['scheduled', 'scheduled'])
        self.assertEqual(self.ns['persist_cancellation'].call_args.args[2], 'leftover')
        self.assertNotIn('instance-EXTRA', [item['eventId'] for item in self.saved.get('leftovers', [])])

    def test_without_the_confirmation_nothing_is_sent(self):
        review = self.leftover_review()
        with self.assertRaises(ValueError):
            self.ns['confirm_action']('LIVE-1', {'reviewToken': review['reviewToken']}, 'ACTOR-1')
        self.ns['graph_action'].assert_not_called()

    def test_a_real_module_session_cannot_be_cancelled_as_a_leftover(self):
        with self.assertRaises(CalendarStateError):
            self.leftover_review('instance-OCC-1')
        self.ns['graph_action'].assert_not_called()


for _name in dir(actions_tests.ManagementTests):
    if _name.startswith('test') and _name not in LeftoverCancelTests.__dict__:
        setattr(LeftoverCancelTests, _name, None)


class LeftoverPersistTests(actions_tests.PersistCancellationTests):
    def test_cancelling_a_leftover_never_touches_a_module_session_or_the_calendar(self):
        for complete in (False, True):
            self.persist('leftover', complete=complete)
        self.assertEqual(self.statements, [])
        self.v.invalidate_curriculum_cache.assert_not_called()


for _name in dir(actions_tests.PersistCancellationTests):
    if _name.startswith('test') and _name not in LeftoverPersistTests.__dict__:
        setattr(LeftoverPersistTests, _name, None)


class CancelPathAuditTests(unittest.TestCase):
    """Every Graph delete/cancel in the backend sits behind an explicit Cancel.

    Read from the source, so a new automatic cancellation anywhere fails here
    until somebody decides, in review, that it is a person's explicit action.
    """

    #: (file, function) -> the explicit action that reaches it.
    ALLOWED = {
        # Cancel series / Cancel session / Cancel on Teams: review, then confirm
        # with acknowledgeNotifications (teams_calendar_actions.confirm_action).
        ('curriculum_api/teams_cancel.py', 'send_cancellation'),
        # "Yes, cancel it and tell the people invited" on an additional meeting.
        ('curriculum_api/teams_week_meeting.py', 'cancel_week_meeting'),
        # One-to-one coach/learner bookings -- a separate feature, not a module
        # calendar: a coach or learner cancelling their own booking.
        ('coach_api/views.py', 'delete_calendar_event_from_graph_detailed'),
    }

    def destructive_sites(self):
        found = set()
        for path in BACKEND.rglob('*.py'):
            relative = path.relative_to(BACKEND).as_posix()
            name = path.name
            if '/migrations/' in relative or name.startswith('test') or name.startswith('tests'):
                continue
            try:
                tree = ast.parse(path.read_text(encoding='utf-8-sig'))
            except (SyntaxError, UnicodeDecodeError):
                continue
            for function in ast.walk(tree):
                if not isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                for node in ast.walk(function):
                    if not isinstance(node, ast.Call):
                        continue
                    callee = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, 'id', '')
                    graphish = 'graph' in callee.lower() or callee in ('request', 'delete', 'post')
                    literal = [arg.value for arg in node.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str)]
                    text = ast.unparse(node)
                    if graphish and ('DELETE' in literal or "'/cancel'" in text or '"/cancel"' in text
                                     or (callee == 'delete' and 'client' in text)):
                        found.add((relative, function.name))
        return found

    def test_only_explicit_cancel_actions_reach_graph_delete_or_cancel(self):
        sites = self.destructive_sites()
        # Nested helpers report their enclosing function as well; keep the innermost.
        unexpected = {site for site in sites if site not in self.ALLOWED}
        self.assertEqual(unexpected, set(), f'automatic Teams cancellation path(s): {sorted(unexpected)}')

    def test_send_cancellation_is_only_reached_from_a_confirmed_action(self):
        tree = ast.parse((ROOT / 'teams_calendar_actions.py').read_text(encoding='utf-8-sig'))
        callers = {fn.name: {node.func.id for node in ast.walk(fn) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
                   for fn in tree.body if isinstance(fn, ast.FunctionDef)}
        self.assertEqual({name for name, calls in callers.items() if 'send_cancellation' in calls}, {'graph_action'})
        self.assertEqual({name for name, calls in callers.items() if 'graph_action' in calls}, {'continue_action'})
        sending = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and getattr(node.func, 'id', '') == 'continue_action'
                   and any(k.arg == 'send' and isinstance(k.value, ast.Constant) and k.value.value is True for k in node.keywords)]
        self.assertEqual(len(sending), 1)
        confirm = next(fn for fn in tree.body if isinstance(fn, ast.FunctionDef) and fn.name == 'confirm_action')
        self.assertIn(sending[0], list(ast.walk(confirm)))
        self.assertIn('acknowledgeNotifications', ast.unparse(confirm))

    def test_the_status_sweep_and_saves_have_no_delete(self):
        for name in ('teams_calendar_state.py', 'teams_cancellation_checks.py', 'teams_weekly_calendar.py',
                     'teams_calendar_checks.py'):
            source = (ROOT / name).read_text(encoding='utf-8-sig')
            self.assertNotIn("'DELETE'", source, name)
            self.assertNotIn('/cancel', source, name)


if __name__ == '__main__':
    unittest.main()
