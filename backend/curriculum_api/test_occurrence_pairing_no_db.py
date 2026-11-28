"""Run directly with Python: session rows keep their date when a session is added.

Production functions from views.py, an in-memory occurrence table that enforces
the real UNIQUE (live_session_id, session_number) key, no Django or database.
"""
import ast
import contextlib
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).parent
NAMES = {'clean_str', 'parse_graph_datetime', 'teams_calendar_minute_key', 'occurrence_session_number',
         'pair_planned_occurrences', 'scheduled_live_session_occurrences', 'replace_live_session_occurrences'}


class Table:
    """curriculum.live_session_occurrences, as far as these writes can tell."""

    def __init__(self, rows):
        self.rows = {row['id']: dict(row) for row in rows}

    def check(self):
        keys = [(row['live_session_id'], row['session_number']) for row in self.rows.values()]
        assert len(keys) == len(set(keys)), f'UNIQUE (live_session_id, session_number) violated: {sorted(keys)}'

    def fetch(self, _table, _where, params, *_args, **_kwargs):
        return [dict(row) for row in self.rows.values() if row['live_session_id'] == params[0]]

    def update(self, _table, _where, params, values):
        self.rows[params[0]].update(values)
        self.check()

    def upsert(self, _table, _conflict, values):
        assert values['id'] not in self.rows
        self.rows[values['id']] = dict(values)
        self.check()


def load(table):
    namespace = {'datetime': datetime, 'timedelta': timedelta, 'timezone': timezone, 'uuid': uuid,
                 'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences', 'ensure_live_session_tracking_tables': lambda: None,
                 'authoring_fetch_all': table.fetch, 'update_authoring_rows': table.update, 'authoring_upsert': table.upsert,
                 'transaction': type('T', (), {'atomic': staticmethod(contextlib.nullcontext)})}
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace


def thursday(week):
    """09:00 Cairo on the Thursdays from 3 Sept 2026 (06:00 UTC while Egypt is on summer time)."""
    return datetime(2026, 9, 3, 6) + timedelta(weeks=week)


def instant(value):
    """Stored rows are naive UTC; planned ones carry their offset."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def stored(number, week, status='scheduled'):
    return {'id': f'OCC-{number}', 'live_session_id': 'LIVE-1', 'session_number': number,
            'scheduled_start': thursday(week), 'scheduled_end': thursday(week) + timedelta(hours=2),
            'status': status, 'graph_event_id': 'EVENT', 'join_url': 'https://teams.microsoft.com/l/meetup-join/x'}


def plan(weeks):
    return {'scheduledOccurrences': [{'sessionNumber': index + 1, 'durationMinutes': 120,
                                      'startDateTimeUtc': thursday(week).replace(tzinfo=timezone.utc).isoformat()}
                                     for index, week in enumerate(weeks)]}


class OccurrencePairingTests(unittest.TestCase):
    def replace(self, table, weeks):
        views = load(table)
        payload = plan(weeks)
        start = thursday(weeks[0]).replace(tzinfo=timezone.utc)
        return views['replace_live_session_occurrences']('LIVE-1', payload, start, 120, 'weekly', len(weeks),
                                                         event_id='EVENT', join_url='https://teams.microsoft.com/l/meetup-join/x')

    def test_adding_a_missing_week_keeps_every_booked_row_on_its_own_date(self):
        # Teams held weeks 0-3 and 5-9 as sessions 1-9; the plan adds week 4 (1 Oct).
        weeks_held = [0, 1, 2, 3, 5, 6, 7, 8, 9]
        table = Table([stored(number, week, 'completed' if number <= 2 else 'scheduled')
                       for number, week in enumerate(weeks_held, start=1)])
        before = {row['id']: instant(row['scheduled_start']) for row in table.rows.values()}
        self.replace(table, list(range(10)))
        live = sorted((row for row in table.rows.values() if row['status'] != 'cancelled'), key=lambda row: instant(row['scheduled_start']))
        self.assertEqual([row['session_number'] for row in live], list(range(1, 11)))
        # Every row people were invited to still runs when it did -- only renumbered.
        for occurrence_id, start in before.items():
            self.assertEqual(instant(table.rows[occurrence_id]['scheduled_start']), start)
        new = [row for row in live if row['id'] not in before]
        self.assertEqual([instant(row['scheduled_start']) for row in new], [instant(thursday(4))])
        self.assertEqual(table.rows['OCC-5']['session_number'], 6)
        self.assertEqual(table.rows['OCC-1']['status'], 'completed')

    def test_a_genuine_move_keeps_the_row_that_shares_its_number(self):
        table = Table([stored(1, 0), stored(2, 1), stored(3, 2)])
        self.replace(table, [0, 1, 3])
        self.assertEqual(instant(table.rows['OCC-3']['scheduled_start']), instant(thursday(3)))
        self.assertEqual(len(table.rows), 3)

    def test_a_dropped_date_is_not_in_plan_never_cancelled_and_steps_off_a_number_now_needed(self):
        table = Table([stored(1, 0), stored(2, 1), stored(3, 2)])
        self.replace(table, [0, 2])
        # Out of the plan, but nobody pressed Cancel: 'superseded', never 'cancelled'.
        self.assertEqual(table.rows['OCC-2']['status'], 'superseded')
        self.assertEqual(table.rows['OCC-3']['session_number'], 2)
        self.assertEqual(instant(table.rows['OCC-3']['scheduled_start']), instant(thursday(2)))
        self.assertNotIn(table.rows['OCC-2']['session_number'], (1, 2))

    def test_unchanged_plan_writes_the_same_rows(self):
        table = Table([stored(1, 0), stored(2, 1)])
        self.replace(table, [0, 1])
        self.assertEqual({row['id']: row['session_number'] for row in table.rows.values()}, {'OCC-1': 1, 'OCC-2': 2})
        self.assertTrue(all(row['status'] == 'scheduled' for row in table.rows.values()))


if __name__ == '__main__':
    unittest.main()
