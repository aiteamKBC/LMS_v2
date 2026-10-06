"""When a Teams occurrence may be deleted -- the real functions, no Django, no network.

`scheduledOccurrences` is a positive send list: "update these sessions on these
dates". It is NOT a desired state, so a date absent from it says nothing about
whether anybody wanted that meeting cancelled. A week routed to its own
additional meeting is absent. A week that simply is not part of this send is
absent. Reading absence as intent deleted live occurrences and had Exchange
email the whole cohort "Canceled: <module>".

These tests pin the rule that replaced it: the shift only ever REPORTS what it
has proved -- the slot a session moved off, or weekly filler no session
occupied -- and nothing removes even those. Each is handed to
`flag_teams_occurrence_leftovers`, which records it for a person to review and
makes no Microsoft call at all: only the explicit Cancel on that slot may send
the cancellation Exchange emails to everyone invited.
"""
import ast
import types
import unittest
import urllib.parse as urllib_parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent

#: Real implementations under test, plus the small pure helpers they lean on.
NAMES = {
    'apply_teams_occurrence_shifts', 'vacated_occurrence_keys', 'tracked_occurrence_keys',
    'flag_teams_occurrence_leftovers', 'teams_expanded_instances',
    'clean_str', 'parse_int', 'parse_graph_datetime', 'teams_calendar_minute_key',
}


def load():
    source = (ROOT / 'views.py').read_text(encoding='utf-8-sig')
    tree = ast.parse(source)
    namespace = types.ModuleType('occurrence-deletion-functions')
    namespace.__dict__.update(
        datetime=datetime, timedelta=timedelta, timezone=timezone, urllib_parse=urllib_parse,
        logger=types.SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None),
        time=types.SimpleNamespace(sleep=lambda _seconds: None),
        # Identity: the fake transport already answers in Graph's own shape.
        graph_event_utc=lambda item: item,
        # Only reached when a target has no instance at all; no test here does that.
        teams_single_occurrence_payload=lambda *a, **k: {},
        teams_standalone_occurrence_meeting=lambda *a, **k: {'warnings': []},
    )
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == 'GRAPH_SILENT_INVITE_HEADERS' for target in node.targets
        ):
            namespace.GRAPH_SILENT_INVITE_HEADERS = ast.literal_eval(node.value)
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    assert len(nodes) == len(NAMES), sorted(NAMES - {node.name for node in nodes})
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), namespace.__dict__)
    return namespace


def at(day, hour=11):
    """A UTC instant for a 2026 date, in the shape Graph answers with."""
    return datetime(2026, *day, hour, 0)


def instance(identifier, start, minutes=120):
    return {
        'id': identifier,
        'start': {'dateTime': start.isoformat(), 'timeZone': 'UTC'},
        'end': {'dateTime': (start + timedelta(minutes=minutes)).isoformat(), 'timeZone': 'UTC'},
    }


def target(session_number, start, minutes=120):
    return {'session_number': session_number, 'start': start, 'end': start + timedelta(minutes=minutes)}


def row(session_number, start, event_id='series-1'):
    """A persisted `live_session_occurrences` row -- the LMS's own occurrence identity."""
    return {
        'id': f'OCC-{session_number}', 'session_number': session_number,
        'scheduled_start': start, 'graph_event_id': event_id, 'status': 'scheduled',
    }


class FakeGraph:
    """Enough Microsoft to run the shift: list instances, move one, delete one."""

    def __init__(self, instances):
        self.instances = {item['id']: item for item in instances}
        self.calls = []

    def __call__(self, method, path, payload=None, extra_headers=None):
        self.calls.append((method, path, payload, extra_headers))
        if method == 'GET' and '/instances' in path:
            return {'value': list(self.instances.values())}
        if method == 'PATCH':
            identifier = urllib_parse.unquote(path.rsplit('/', 1)[-1])
            if identifier in self.instances and payload:
                self.instances[identifier].update({k: v for k, v in payload.items() if k in ('start', 'end')})
            return self.instances.get(identifier, {})
        if method == 'DELETE':
            self.instances.pop(urllib_parse.unquote(path.rsplit('/', 1)[-1]), None)
            return {}
        return {}

    @property
    def deleted(self):
        return [urllib_parse.unquote(path.rsplit('/', 1)[-1]) for method, path, _p, _h in self.calls if method == 'DELETE']


class OccurrenceDeletionTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.v = load()

    def shift(self, instances, targets, stored):
        """Run the real shift against a fake calendar; return (deletions, graph)."""
        graph = FakeGraph(instances)
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        with patch.dict('sys.modules', {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport}):
            warnings, _recreated, deletions = self.v.apply_teams_occurrence_shifts(
                'organizer%40example.invalid', 'series-1', 'Synthetic module',
                targets, ['learner@example.invalid'], None, stored,
            )
        self.assertEqual(warnings, [], warnings)
        # The shift itself never deletes: it only reports what it has proved.
        self.assertEqual(graph.deleted, [])
        return deletions, graph

    def run_deletions(self, deletions):
        """What the save does with the proved list now: flag it, delete nothing."""
        graph = FakeGraph([])
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = graph
        with patch.dict('sys.modules', {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport}):
            flagged = self.v.flag_teams_occurrence_leftovers(
                deletions, live_session_id='LIVE-1', module_catalogue_id='MOD-1', source='update_reconcile',
            )
        self.assertEqual(graph.calls, [], 'flagging a slot must never reach Microsoft')
        self.assertEqual([item['eventId'] for item in flagged], [item['instance_id'] for item in deletions])
        return graph.deleted

    # ------------------------------------------------------------------ A
    def test_a_week_moved_to_an_additional_meeting_is_never_deleted(self):
        """Sessions 1-4 on the module calendar; session 4 becomes an additional meeting."""
        starts = [at((9, 15)), at((9, 22)), at((9, 29)), at((10, 6))]
        instances = [instance(f'instance-{index + 1}', start) for index, start in enumerate(starts)]
        stored = [row(index + 1, start) for index, start in enumerate(starts)]
        # The main send now carries 1, 2, 3 only -- 4 is delivered by its own meeting.
        targets = [target(index + 1, start) for index, start in enumerate(starts[:3])]

        deletions, _graph = self.shift(instances, targets, stored)

        self.assertEqual(deletions, [], 'session 4 was proposed for deletion by its absence alone')
        self.assertEqual(self.run_deletions(deletions), [])

    # ------------------------------------------------------------------ B
    def test_an_existing_additional_session_is_untouched_by_a_main_update(self):
        """The additional week keeps its own Graph identity while the main calendar updates."""
        starts = [at((9, 15)), at((9, 22)), at((9, 29))]
        instances = [instance(f'instance-{index + 1}', start) for index, start in enumerate(starts)]
        stored = [row(index + 1, start) for index, start in enumerate(starts)]
        # Session 2 lives on its own additional meeting, under its own event id.
        stored[1] = row(2, starts[1], event_id='additional-event-2')
        targets = [target(1, starts[0]), target(3, starts[2])]

        deletions, graph = self.shift(instances, targets, stored)

        self.assertEqual(deletions, [])
        self.assertIn('instance-2', graph.instances)

    # ------------------------------------------------------------------ C
    def test_a_moved_session_retires_only_its_own_vacated_slot(self):
        """Session 3 moves off 29 Sept onto 13 Oct; nothing else is affected."""
        before, after = at((9, 29)), at((10, 13))
        instances = [
            instance('instance-1', at((9, 15))),
            instance('instance-2', at((9, 22))),
            instance('instance-3', before),
            instance('instance-4', at((10, 6))),
        ]
        stored = [row(1, at((9, 15))), row(2, at((9, 22))), row(3, before), row(4, at((10, 6)))]
        targets = [target(1, at((9, 15))), target(2, at((9, 22))), target(3, after), target(4, at((10, 6)))]

        deletions, _graph = self.shift(instances, targets, stored)

        # The instance Graph moved is the session; only a leftover twin on the old
        # date would be reported, and it is reported as that session's, by number.
        for deletion in deletions:
            self.assertEqual(deletion['reason'], 'stale_twin_of_moved_session')
            self.assertEqual(deletion['session_number'], 3)
            self.assertEqual(deletion['previous_start'], self.v.teams_calendar_minute_key(before))
        self.assertNotIn('instance-1', [item['instance_id'] for item in deletions])
        self.assertNotIn('instance-4', [item['instance_id'] for item in deletions])

    def test_only_the_moving_session_contributes_a_vacated_date(self):
        """`vacated_occurrence_keys` is the whole rule, so pin it directly."""
        stored = [row(1, at((9, 15))), row(2, at((9, 22))), row(3, at((9, 29)))]
        # Session 2 is absent from this send; session 3 is moving a week later.
        targets = [target(1, at((9, 15))), target(3, at((10, 6)))]

        vacated = self.v.vacated_occurrence_keys(targets, stored)

        self.assertEqual(list(vacated), [self.v.teams_calendar_minute_key(at((9, 29)))])
        self.assertEqual(vacated[self.v.teams_calendar_minute_key(at((9, 29)))]['session_number'], 3)
        # Session 2's date is owned, so absence alone can never retire it.
        self.assertIn(self.v.teams_calendar_minute_key(at((9, 22))), self.v.tracked_occurrence_keys(stored))

    # ------------------------------------------------------------------ D
    def test_omission_is_not_cancellation(self):
        """Microsoft holds A, B, C, D. The payload carries A, B, C. D survives."""
        starts = [at((9, 15)), at((9, 22)), at((9, 29)), at((10, 6))]
        instances = [instance(f'instance-{index + 1}', start) for index, start in enumerate(starts)]
        stored = [row(index + 1, start) for index, start in enumerate(starts)]
        targets = [target(index + 1, start) for index, start in enumerate(starts[:3])]

        deletions, graph = self.shift(instances, targets, stored)

        self.assertEqual(deletions, [])
        self.assertIn('instance-4', graph.instances)

    def test_a_slot_the_recurrence_invented_is_not_an_lms_session(self):
        """Weekly filler no session ever occupied is reported -- and still not removed.

        Graph materialises an instance in every weekly slot of a recurrence, so a
        gap in the plan leaves one behind. It has no LMS occurrence row, which is
        what tells it apart from a real session; but removing it still emails the
        whole cohort a cancellation, so it is flagged for a person instead.
        """
        instances = [
            instance('instance-1', at((9, 15))),
            instance('filler', at((9, 22))),
            instance('instance-3', at((9, 29))),
        ]
        stored = [row(1, at((9, 15))), row(3, at((9, 29)))]
        targets = [target(1, at((9, 15))), target(3, at((9, 29)))]

        deletions, _graph = self.shift(instances, targets, stored)

        self.assertEqual([item['instance_id'] for item in deletions], ['filler'])
        self.assertEqual(deletions[0]['reason'], 'recurrence_filler_never_an_lms_session')
        self.assertEqual(self.run_deletions(deletions), [])

    def test_no_deletion_reason_is_mere_absence(self):
        """Every reason names what was proved; none says "it was not in the array"."""
        allowed = {'stale_twin_of_moved_session', 'recurrence_filler_never_an_lms_session'}
        source = (ROOT / 'views.py').read_text(encoding='utf-8-sig')
        self.assertNotIn('missing_from_target_dates', source)
        instances = [instance('instance-1', at((9, 15))), instance('filler', at((9, 22)))]
        stored = [row(1, at((9, 15)))]
        deletions, _graph = self.shift(instances, [target(1, at((9, 15)))], stored)
        self.assertTrue(deletions)
        for deletion in deletions:
            self.assertIn(deletion['reason'], allowed)
            self.assertTrue(deletion['instance_id'])


if __name__ == '__main__':
    unittest.main()
