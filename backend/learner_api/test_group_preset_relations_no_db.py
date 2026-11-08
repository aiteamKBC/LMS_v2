"""Execute preset reads on a minimal FK schema, with no application database.

SQLite supplies the fixture database; only PostgreSQL JSON syntax is adapted.
The tables deliberately omit the removed copied names and deletion columns.
"""
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import learning_plan as plans


class GroupPresetRelationsTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.db.executescript('''
            CREATE TABLE curriculum.programmes (programme_id TEXT PRIMARY KEY, name TEXT);
            CREATE TABLE curriculum.groups (group_id TEXT PRIMARY KEY, group_name TEXT,
                programme_id TEXT, created_at TEXT, updated_at TEXT);
            CREATE TABLE curriculum.modules (module_catalogue_id TEXT PRIMARY KEY,
                group_id TEXT, learner_roster_mode TEXT);
            INSERT INTO curriculum.programmes VALUES ('P1', 'Renamed programme'), ('P2', 'Other');
            INSERT INTO curriculum.groups VALUES
                ('G1', 'Shared name', 'P1', '2026-01-01', '2026-01-01'),
                ('G2', 'Shared name', 'P2', '2026-01-01', '2026-01-01'),
                ('G3', 'Empty', 'P1', '2026-01-01', '2026-01-01');
            INSERT INTO curriculum.modules VALUES
                ('M1', 'G1', 'inherited'), ('M2', 'G2', 'inherited'),
                ('MANUAL', 'G1', 'manual');
        ''')
        self.calls = []
        self.enterContext(patch.object(plans, '_rows', side_effect=self.rows))
        self.enterContext(patch.object(plans.connection, 'vendor', 'postgresql'))

    def rows(self, sql, params):
        self.calls.append((sql, params))
        if 'SELECT DISTINCT ON' in sql:
            # SQLite equivalent of Postgres unnest + DISTINCT ON: the same
            # partition and ordering select the first candidate for each pair.
            self.db.execute('CREATE TEMP TABLE IF NOT EXISTS requested (programme TEXT, grp TEXT)')
            self.db.execute('DELETE FROM requested')
            self.db.executemany('INSERT INTO requested VALUES (?, ?)', zip(*params))
            tail = sql.split('FROM unnest(%s::text[], %s::text[]) AS p(programme, grp)', 1)[1]
            joins, order = tail.rsplit('\nORDER BY\n', 1)
            sql = ('SELECT programme, grp, module_ids FROM (SELECT p.programme, p.grp, g.module_ids, '
                   'ROW_NUMBER() OVER (PARTITION BY p.programme, p.grp ORDER BY ' + order +
                   ') AS choice FROM requested p ' + joins + ') WHERE choice = 1')
            params = []
        sql = (sql.replace('::jsonb', '').replace('jsonb_agg', 'json_group_array')
               .replace('jsonb_array_length', 'json_array_length')
               .replace('jsonb_typeof', 'json_type').replace('%s', '?'))
        cur = self.db.execute(sql, params)
        return [dict(zip([c[0] for c in cur.description], row)) for row in cur.fetchall()]

    def test_id_lookup_uses_fk_and_excludes_manual_without_cross_group_leak(self):
        self.assertEqual(plans._group_module_ids('stale name', 'stale group', group_id='G1'), ['M1'])
        self.assertEqual(plans._group_module_ids('', '', group_id='G2'), ['M2'])

    def test_name_fallback_resolves_programme_relation(self):
        self.assertEqual(plans._group_module_ids('Renamed programme', 'Shared name'), ['M1'])
        self.assertEqual(plans._group_module_ids('P1', 'Shared name'), ['M1'])
        self.assertEqual(plans._group_module_ids('old programme', 'Shared name'), [])

    def test_empty_and_missing_groups_do_not_borrow_modules(self):
        self.assertEqual(plans._group_module_ids('', '', group_id='G3'), [])
        self.assertEqual(plans._group_module_ids('', '', group_id='MISSING'), [])

    def test_fk_reassignment_is_visible_without_a_copied_module_list(self):
        self.db.execute("UPDATE curriculum.modules SET group_id='G2' WHERE module_catalogue_id='M1'")
        self.assertEqual(plans._group_module_ids('', '', group_id='G1'), [])
        self.assertEqual(plans._group_module_ids('', '', group_id='G2'), ['M1', 'M2'])

    def test_shared_effective_plan_keeps_saved_explicit_and_empty_semantics(self):
        learner = SimpleNamespace(programme_id='P1', cohort_id='C1', group_id='G1')
        for kind in ('commercial', 'apprenticeship'):
            learner.learner_type = kind
            with self.subTest(kind=kind):
                self.assertEqual(plans._effective_plan_ids(learner, {}, saved_plan=None), ['M1'])
                self.assertEqual(plans._effective_plan_ids(learner, {}, saved_plan=[]), [])
                self.assertEqual(plans._effective_plan_ids(learner, {}, saved_plan=[
                    {'moduleId': 'SAVED', 'assignmentMode': 'explicit'}]), ['SAVED'])
                self.assertEqual(plans._effective_plan_ids(learner, {}, saved_plan=[
                    {'moduleId': 'SAVED'}]), ['SAVED', 'M1'])

    def test_name_tiebreak_still_prefers_fuller_then_more_recent_group(self):
        self.db.execute("INSERT INTO curriculum.groups VALUES ('G4','Shared name','P1','2026-01-01','2026-06-01')")
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M4','G4','inherited')")
        # G1 has two structural modules, including its manual-roster module.
        self.assertEqual(plans._group_module_ids('P1', 'Shared name'), ['M1'])
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M5','G4','inherited')")
        self.assertEqual(plans._group_module_ids('P1', 'Shared name'), ['M4', 'M5'])

    def test_bulk_presets_match_single_reads_and_keep_empty_pairs(self):
        pairs = [('P1', 'Shared name'), ('Other', 'Shared name'), ('P1', 'Empty'), ('P1', '')]
        expected = {pair: plans._group_module_ids(*pair) for pair in pairs}
        self.calls.clear()
        self.assertEqual(plans.group_module_ids_bulk(pairs), expected)
        self.assertEqual(len(self.calls), 2)  # one preset read, one manual-roster read
