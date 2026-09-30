"""Run directly with Python. No Django setup, database, credentials or network.

Covers the read-only attendee comparison: what it reports, what it refuses to
report, and -- the point of the feature -- that pressing it writes nothing to
Microsoft or to the LMS.
"""
import functools
import sys
import types
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent


class Response(dict):
    """Stands in for JsonResponse: the body, its status and its headers."""

    def __init__(self, data=None, status=200):
        super().__init__(data or {})
        self.status_code = status
        self.headers = {}

    def __setitem__(self, key, value):
        if isinstance(key, str) and key and key[0].isupper():
            self.headers[key] = value
        else:
            super().__setitem__(key, value)


class Forbidden(Exception):
    """Raised by the stub gate, so a test can prove the gate was applied."""


def stub_require_role(*roles):
    """The real decorator rejects a caller whose role is not listed. So does this."""
    def decorator(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            if getattr(request, 'role', None) not in roles:
                return Response({'error': 'Forbidden'}, 403)
            return view(request, *args, **kwargs)
        wrapped.allowed_roles = roles
        return wrapped
    return decorator


def install_stubs():
    package = types.ModuleType('curriculum_api')
    package.__path__ = [str(ROOT)]
    sys.modules['curriculum_api'] = package

    django = types.ModuleType('django')
    http = types.ModuleType('django.http')
    http.JsonResponse = Response
    views_pkg = types.ModuleType('django.views')
    decorators = types.ModuleType('django.views.decorators')
    http_decorators = types.ModuleType('django.views.decorators.http')
    http_decorators.require_GET = lambda view: view
    sys.modules.update({'django': django, 'django.http': http, 'django.views': views_pkg,
                        'django.views.decorators': decorators, 'django.views.decorators.http': http_decorators})

    httpx = types.ModuleType('httpx')

    class HTTPError(Exception):
        pass

    httpx.HTTPError = HTTPError
    sys.modules['httpx'] = httpx

    login = types.ModuleType('login')
    permissions = types.ModuleType('login.permissions')
    permissions.require_role = stub_require_role
    sys.modules.update({'login': login, 'login.permissions': permissions})

    coach = types.ModuleType('coach_api')
    coach_views = types.ModuleType('coach_api.views')
    coach_views.has_graph_credentials = lambda: True
    sys.modules.update({'coach_api': coach, 'coach_api.views': coach_views})
    return httpx.HTTPError


GraphTransportError = install_stubs()

from curriculum_api import teams_attendee_compare as compare  # noqa: E402


class CalendarStateError(RuntimeError):
    """The shared reader's failure type, as the real module raises it."""


def attendee(address, name=''):
    return {'emailAddress': {'address': address, 'name': name}, 'type': 'required'}


class CompareFixture(unittest.TestCase):
    #: The organizer owns the event and is never one of its own attendees.
    ORGANIZER = 'organizer@example.invalid'

    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.series = {
            'id': 'LIVE-1', 'status': 'active', 'organizer_email': self.ORGANIZER,
            'graph_event_id': 'master-1', 'calendar_series': [],
            'attendees': ['ahmed@example.invalid', 'sara@example.invalid'],
            'presenters': ['tutor@example.invalid'], 'co_organizers': [],
        }
        self.graph_attendees = [attendee('ahmed@example.invalid', 'Ahmed'),
                                attendee('sara@example.invalid', 'Sara'),
                                attendee('tutor@example.invalid', 'Tutor')]
        self.graph_organizer = self.ORGANIZER
        self.event_missing = False
        self.read_error = None
        self.reads = []
        self.writes = []
        self.rows = [self.series]
        self.install_module_stubs()

    # ------------------------------------------------------------ stubbing

    def install_module_stubs(self):
        views = types.ModuleType('curriculum_api.views')
        views.LIVE_SESSIONS_TABLE = 'live_sessions'
        views.clean_str = lambda value: str(value or '').strip()
        views.teams_meeting_default_organizer = lambda: ''
        views.teams_series_email_list = self.email_list
        views.authoring_fetch_all = self.fetch_rows
        weekly = types.ModuleType('curriculum_api.teams_weekly_calendar')
        weekly.stored_calendar_series = lambda series: list((series or {}).get('calendar_series') or [])
        cancellation = types.ModuleType('curriculum_api.teams_cancellation_checks')
        cancellation.CalendarStateError = CalendarStateError
        state = types.ModuleType('curriculum_api.teams_calendar_state')
        state.calendar_reader = self.calendar_reader
        for name, module in [('curriculum_api.views', views), ('curriculum_api.teams_weekly_calendar', weekly),
                             ('curriculum_api.teams_cancellation_checks', cancellation),
                             ('curriculum_api.teams_calendar_state', state)]:
            sys.modules[name] = module
            self.addCleanup(sys.modules.pop, name, None)

    @staticmethod
    def email_list(value):
        if isinstance(value, str):
            value = [value] if value else []
        return [str(item).strip().lower() for item in (value or []) if str(item).strip()]

    def fetch_rows(self, table, where_sql='', params=None, *args, **kwargs):
        assert table == 'live_sessions'
        return [row for row in self.rows if row['id'] == (params or [None])[0]]

    @contextmanager
    def calendar_reader(self):
        def read(path):
            # Anything that is not a plain GET of an event would be a write or
            # an expansion this feature has no business making.
            if 'PATCH' in path or 'POST' in path:
                self.writes.append(path)
            self.reads.append(path)
            if self.read_error is not None:
                raise self.read_error
            if self.event_missing:
                return None
            return {'id': 'master-1', 'isCancelled': False,
                    'organizer': {'emailAddress': {'address': self.graph_organizer, 'name': 'Organizer'}},
                    'attendees': list(self.graph_attendees)
                    if isinstance(self.graph_attendees, list) else self.graph_attendees}
        yield read

    # ------------------------------------------------------------- helpers

    def compare(self):
        return compare.compare_meeting_attendees('LIVE-1')

    def emails(self, rows):
        return [row['email'] for row in rows]


class ComparisonTests(CompareFixture):
    def test_an_identical_list_reports_a_match_and_names_nobody(self):
        result = self.compare()
        self.assertEqual(result['status'], 'match')
        self.assertEqual((result['lmsCount'], result['teamsCount'], result['matchingCount']), (3, 3, 3))
        self.assertEqual((result['extraOnTeams'], result['missingFromTeams']), ([], []))
        self.assertFalse(result['aliasPossible'])

    def test_somebody_added_outside_the_lms_is_reported_as_extra(self):
        self.graph_attendees.append(attendee('john@example.invalid', 'John Smith'))
        result = self.compare()
        self.assertEqual(result['status'], 'different')
        self.assertEqual(result['extraOnTeams'], [{'email': 'john@example.invalid', 'name': 'John Smith'}])
        self.assertEqual((result['extraCount'], result['missingCount'], result['teamsCount']), (1, 0, 4))
        self.assertFalse(result['aliasPossible'])

    def test_somebody_removed_outside_the_lms_is_reported_as_missing(self):
        self.graph_attendees = [item for item in self.graph_attendees
                                if item['emailAddress']['address'] != 'sara@example.invalid']
        result = self.compare()
        self.assertEqual(self.emails(result['missingFromTeams']), ['sara@example.invalid'])
        self.assertEqual((result['missingCount'], result['extraCount'], result['matchingCount']), (1, 0, 2))

    def test_one_removed_and_one_added_are_both_reported(self):
        """The case the publish gate's pairing hides, and the reason it is not reused.

        ``attendee_differences`` pairs any missing against any extra so that an
        alias rewrite cannot block a save. Here that would cancel a real removal
        against a real gate-crasher and report "everything matches" -- the exact
        drift this button exists to surface.
        """
        self.graph_attendees = [attendee('ahmed@example.invalid', 'Ahmed'),
                                attendee('tutor@example.invalid', 'Tutor'),
                                attendee('john@example.invalid', 'John Smith')]
        result = self.compare()
        self.assertEqual(self.emails(result['extraOnTeams']), ['john@example.invalid'])
        self.assertEqual(self.emails(result['missingFromTeams']), ['sara@example.invalid'])
        self.assertTrue(result['aliasPossible'])

    def test_capitalisation_and_whitespace_are_the_same_person(self):
        self.series['attendees'] = ['  Ahmed@Example.INVALID ', 'SARA@example.invalid']
        self.assertEqual(self.compare()['status'], 'match')

    def test_a_duplicated_microsoft_attendee_is_counted_once(self):
        self.graph_attendees.append(attendee('AHMED@example.invalid', 'Ahmed'))
        result = self.compare()
        self.assertEqual(result['status'], 'match')
        self.assertEqual(result['teamsCount'], 3)

    def test_the_organizer_is_not_missing_from_their_own_meeting(self):
        self.series['co_organizers'] = [self.ORGANIZER]
        result = self.compare()
        self.assertEqual(result['status'], 'match')
        self.assertEqual(result['lmsCount'], 3)

    def test_an_organizer_microsoft_names_differently_is_still_excluded(self):
        """Graph's own organizer address wins, because it is the event's truth."""
        self.graph_organizer = 'shared.calendar@example.invalid'
        self.series['presenters'] = ['tutor@example.invalid', 'shared.calendar@example.invalid']
        self.assertEqual(self.compare()['status'], 'match')

    def test_an_alias_answered_with_its_primary_address_is_shown_as_a_possible_pair(self):
        """Both spellings are shown, and the ambiguity is named rather than hidden.

        Microsoft stores an internal alias under its mailbox's primary address,
        so this is indistinguishable from a swap without asking the directory.
        Dropping the pair would silence a genuine gate-crasher; showing it with
        ``aliasPossible`` lets the reader tell the two apart themselves.
        """
        self.series['attendees'] = ['ahmed@example.invalid', 'finance@example.invalid']
        self.graph_attendees = [attendee('ahmed@example.invalid', 'Ahmed'),
                                attendee('accounts.payable@example.invalid', 'Accounts Payable'),
                                attendee('tutor@example.invalid', 'Tutor')]
        result = self.compare()
        self.assertTrue(result['aliasPossible'])
        self.assertEqual(self.emails(result['missingFromTeams']), ['finance@example.invalid'])
        self.assertEqual(self.emails(result['extraOnTeams']), ['accounts.payable@example.invalid'])

    def test_an_empty_or_malformed_microsoft_address_is_not_a_difference(self):
        self.graph_attendees.extend([attendee(''), attendee('   '), attendee('not-an-address'), {'type': 'required'}])
        self.assertEqual(self.compare()['status'], 'match')

    def test_every_weekday_series_is_read_and_its_people_counted_once(self):
        self.series['calendar_series'] = [{'day': 'Monday', 'eventId': 'master-1'},
                                          {'day': 'Thursday', 'eventId': 'master-2'}]
        result = self.compare()
        self.assertEqual(result['status'], 'match')
        self.assertEqual(sorted(path.split('/events/')[1].split('?')[0] for path in self.reads),
                         ['master-1', 'master-2'])

    def test_the_reported_time_is_the_moment_microsoft_was_read(self):
        result = self.compare()
        self.assertTrue(result['checkedAt'].endswith('Z'))
        gap = datetime.now(timezone.utc) - datetime.fromisoformat(result['checkedAt'].replace('Z', '+00:00'))
        self.assertLess(abs(gap.total_seconds()), 60)


class UnavailableTests(CompareFixture):
    def test_a_deleted_calendar_event_is_named_rather_than_guessed(self):
        self.event_missing = True
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'event_not_found')

    def test_a_refused_read_is_reported_as_a_permission_problem(self):
        error = CalendarStateError('Microsoft calendar status could not be verified (HTTP 403).')
        error.status_code = 403
        self.read_error = error
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'graph_forbidden')
        self.assertNotIn('403', str(caught.exception))

    def test_a_transport_failure_is_reported_without_microsoft_detail(self):
        self.read_error = GraphTransportError('connection reset by peer at 10.0.0.1')
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'graph_unavailable')
        self.assertNotIn('10.0.0.1', str(caught.exception))

    def test_a_malformed_attendee_response_is_not_read_as_an_empty_meeting(self):
        self.graph_attendees = 'everyone'
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'malformed_response')

    def test_a_meeting_with_no_published_roster_says_so_and_reads_nothing(self):
        self.series.update(attendees=[], presenters=[], co_organizers=[])
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'no_published_roster')
        self.assertEqual(self.reads, [])

    def test_a_meeting_with_no_calendar_event_is_refused_before_any_read(self):
        self.series['graph_event_id'] = ''
        with self.assertRaises(compare.AttendeeCompareError) as caught:
            self.compare()
        self.assertEqual(caught.exception.code, 'no_calendar_event')
        self.assertEqual(self.reads, [])

    def test_an_unknown_series_is_not_found(self):
        self.rows = []
        with self.assertRaises(LookupError):
            self.compare()


class EndpointTests(CompareFixture):
    def request(self, role='staff'):
        request = types.SimpleNamespace(method='GET', role=role)
        return compare.teams_meeting_attendee_comparison(request, 'LIVE-1')

    def test_a_learner_cannot_reach_the_comparison_by_typing_its_url(self):
        response = self.request(role='learner')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.reads, [])

    def test_the_gate_is_the_same_one_the_other_teams_endpoints_use(self):
        self.assertEqual(compare.teams_meeting_attendee_comparison.allowed_roles, ('admin', 'staff'))

    def test_staff_receive_the_comparison_and_it_is_never_cached(self):
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['status'], 'match')
        self.assertEqual(response.headers.get('Cache-Control'), 'no-store, private')

    def test_a_missing_event_reaches_the_browser_as_an_actionable_message(self):
        self.event_missing = True
        response = self.request()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response['code'], 'event_not_found')
        self.assertIn('could not be found', response['error'])

    def test_a_graph_failure_is_a_bad_gateway_with_no_microsoft_detail(self):
        self.read_error = GraphTransportError('token eyJhbGciOi... rejected')
        response = self.request()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('eyJhbGciOi', response['error'])

    def test_an_unknown_series_is_a_not_found(self):
        self.rows = []
        self.assertEqual(self.request().status_code, 404)

    def test_missing_graph_credentials_are_reported_rather_than_attempted(self):
        sys.modules['coach_api.views'].has_graph_credentials = lambda: False
        self.addCleanup(setattr, sys.modules['coach_api.views'], 'has_graph_credentials', lambda: True)
        response = self.request()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.reads, [])


class NoWriteTests(CompareFixture):
    """The comparison is a read. These are the tests that say so."""

    def test_only_event_reads_are_made_and_nothing_is_patched(self):
        self.graph_attendees.append(attendee('john@example.invalid', 'John'))
        self.compare()
        self.assertEqual(self.writes, [])
        self.assertEqual(len(self.reads), 1)
        self.assertTrue(self.reads[0].startswith('users/'))
        self.assertIn('/events/master-1?', self.reads[0])
        # No instance expansion, no online meeting, no attendance report.
        for forbidden in ('/instances', 'onlineMeetings', 'attendanceReports', '/calendars'):
            self.assertNotIn(forbidden, self.reads[0])

    def test_the_stored_roster_is_read_but_never_rewritten(self):
        before = {key: list(value) if isinstance(value, list) else value for key, value in self.series.items()}
        self.graph_attendees = [attendee('john@example.invalid', 'John')]
        self.compare()
        self.assertEqual(self.series, before)

    def test_the_comparison_never_calls_the_publishing_helpers(self):
        """A future edit that reached for `publish_attendees` would fail here."""
        source = (ROOT / 'teams_attendee_compare.py').read_text(encoding='utf-8')
        for forbidden in ('publish_attendees', "'PATCH'", "'POST'", "'DELETE'", 'microsoft_graph_request',
                          'invalidate_curriculum_cache', 'UPDATE ', 'INSERT '):
            self.assertNotIn(forbidden, source, f'{forbidden} has no place in a read-only comparison')


if __name__ == '__main__':
    unittest.main(verbosity=2)
