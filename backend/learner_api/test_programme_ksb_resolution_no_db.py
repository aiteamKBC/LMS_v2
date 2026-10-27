"""Execute the KSB lookup SQL against synthetic, in-memory curriculum rows.

Only the lookup functions are loaded: no Django startup, application database,
network, learner data, or snapshot writes. SQLite adapts PostgreSQL placeholders
and ANY arrays while retaining the actual query filters and ordering.
"""
import ast
import copy
import logging
import sqlite3
import unittest
from contextlib import contextmanager, nullcontext
from pathlib import Path
from types import SimpleNamespace


class LookupConnection:
    def __init__(self, database):
        self.database = database

    @contextmanager
    def cursor(self):
        cursor = self.database.cursor()

        def execute(sql, params):
            parts = sql.split('%s')
            translated, values = parts[0], []
            for value, part in zip(params, parts[1:]):
                if isinstance(value, list):
                    translated = translated.removesuffix('= ANY(') + 'IN ('
                    translated += ', '.join('?' for _ in value) + part
                    values.extend(value)
                else:
                    translated += '?' + part
                    values.append(value)
            return cursor.execute(translated.replace('%%', '%'), values)

        try:
            yield SimpleNamespace(execute=execute, fetchone=cursor.fetchone, fetchall=cursor.fetchall)
        finally:
            cursor.close()


class ProgrammeKsbResolutionTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.create_function('btrim', 1, lambda value: value.strip() if value is not None else None)
        self.db.executescript("""
            ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE curriculum.programmes (
                programme_id TEXT, name TEXT, ksb_profile_source_id TEXT, updated_at TEXT
            );
            CREATE TABLE curriculum.modules (
                module_catalogue_id TEXT, programme_id TEXT, programme_name TEXT,
                ksb_profile_source_id TEXT, updated_at TEXT
            );
            INSERT INTO curriculum.programmes VALUES
                ('PROG-MARKETING', 'Marketing', 'standard:marketing', '2026-10-21'),
                ('PROG-PROJECT', 'Project Controls', 'standard:project', '2026-10-20');
            INSERT INTO curriculum.modules VALUES
                ('SHARED', 'PROG-MARKETING', 'Marketing', 'standard:marketing', '2026-10-21'),
                ('PROJECT', 'PROG-PROJECT', 'Project Controls', 'standard:project', '2026-10-20');
        """)
        self.plan = [{'moduleId': 'SHARED'}, {'moduleId': 'PROJECT'}]
        self.project_ksbs = [{'code': 'K1', 'description': 'Project controls knowledge'}]
        self.marketing_ksbs = [{'code': 'K1', 'description': 'Marketing knowledge'}]
        self.sources = {'standard:project': self.project_ksbs, 'standard:marketing': self.marketing_ksbs}
        self.scope = {
            'connections': {'enrolment': LookupConnection(self.db)},
            'transaction': SimpleNamespace(atomic=lambda **_: nullcontext()),
            'DatabaseError': sqlite3.DatabaseError,
            'logger': logging.getLogger(__name__),
            'get_training_plan': lambda source: source.training_plan,
            '_fetch_ksb_items_from_profile_source': lambda source_id: self.sources.get(source_id, []),
            '_fetch_ksb_items_for_programme': lambda *_: [],
            '_fetch_ksb_items_from_plan_mappings': lambda **_: [],
        }
        names = {'_s', '_plan_module_ids', '_clean_ksb_profile_source_id', '_resolve_programme_id',
                 '_resolve_ksb_profile_source_id', '_fetch_ksb_items', 'current_curriculum_ksb_items_for_learner'}
        path = Path(__file__).with_name('active_users.py')
        nodes = [node for node in ast.parse(path.read_text(encoding='utf-8')).body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), self.scope)

    def test_enrolled_programme_wins_over_a_shared_module_from_another_programme(self):
        result = self.scope['_resolve_programme_id']('Project Controls', self.plan)
        self.assertEqual(result, 'PROG-PROJECT')

    def test_picker_returns_enrolled_ksbs_for_both_learner_kinds_without_changing_history(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                source = SimpleNamespace(programme='Project Controls', learner_type=kind, training_plan=self.plan)
                learner = SimpleNamespace(programme='Project Controls', ksbs=[{'code': 'K9', 'description': 'Saved history'}])
                original = copy.deepcopy((self.plan, learner.ksbs))
                result = self.scope['current_curriculum_ksb_items_for_learner'](learner, source=source)
                self.assertEqual(result, self.project_ksbs)
                self.assertEqual((self.plan, learner.ksbs), original)

    def test_another_learner_keeps_their_own_programme(self):
        result = self.scope['current_curriculum_ksb_items_for_learner'](
            source=SimpleNamespace(programme='Marketing', training_plan=self.plan))
        self.assertEqual(result, self.marketing_ksbs)

    def test_learner_without_a_profile_still_uses_the_enrolment_programme(self):
        result = self.scope['current_curriculum_ksb_items_for_learner'](
            source=SimpleNamespace(programme='Project Controls', training_plan=self.plan))
        self.assertEqual(result, self.project_ksbs)

    def test_exact_programme_match_wins_over_a_newer_prefix_match(self):
        self.db.execute('INSERT INTO curriculum.programmes VALUES (?, ?, ?, ?)',
                        ('PROG-PREFIX', 'Project', 'standard:marketing', '2026-10-22'))
        self.assertEqual(self.scope['_resolve_programme_id']('Project Controls'), 'PROG-PROJECT')

    def test_programme_lookup_accepts_case_whitespace_and_id(self):
        for programme in (' project controls ', 'PROG-PROJECT'):
            with self.subTest(programme=programme):
                self.assertEqual(self.scope['_resolve_programme_id'](programme, self.plan), 'PROG-PROJECT')

    def test_plan_keeps_the_existing_programme_when_names_are_duplicated(self):
        self.db.execute('INSERT INTO curriculum.programmes VALUES (?, ?, ?, ?)',
                        ('PROG-REPLACEMENT', 'Project Controls', 'standard:replacement', '2026-10-22'))
        result = self.scope['_fetch_ksb_items']('Project Controls', self.plan)
        self.assertEqual(result, self.project_ksbs)

    def test_confirmed_id_wins_over_a_newer_name_match_for_the_ksb_source(self):
        result = self.scope['_resolve_ksb_profile_source_id']('PROG-PROJECT', 'Marketing', self.plan)
        self.assertEqual(result, 'standard:project')

    def test_exact_source_name_wins_over_a_newer_prefix_without_an_id(self):
        self.db.execute('INSERT INTO curriculum.programmes VALUES (?, ?, ?, ?)',
                        ('PROG-PREFIX', 'Project', 'standard:marketing', '2026-10-22'))
        result = self.scope['_resolve_ksb_profile_source_id']('', 'Project Controls')
        self.assertEqual(result, 'standard:project')

    def test_single_programme_module_fallback_is_preserved(self):
        for programme in ('', 'Legacy programme name'):
            with self.subTest(programme=programme):
                result = self.scope['_resolve_programme_id'](programme, [{'moduleId': 'PROJECT'}])
                self.assertEqual(result, 'PROG-PROJECT')

    def test_mixed_modules_do_not_invent_a_programme_when_enrolment_is_missing(self):
        self.assertEqual(self.scope['_resolve_programme_id']('', self.plan), '')
        self.assertEqual(self.scope['_fetch_ksb_items']('', self.plan), [])

    def test_module_source_fallback_stays_within_the_resolved_programme(self):
        self.db.execute("UPDATE curriculum.programmes SET ksb_profile_source_id='' WHERE programme_id='PROG-PROJECT'")
        result = self.scope['_fetch_ksb_items']('Project Controls', self.plan)
        self.assertEqual(result, self.project_ksbs)

    def test_applied_manual_source_is_preserved(self):
        self.db.execute("UPDATE curriculum.programmes SET ksb_profile_source_id='profile:KSBP-PROJECT' WHERE programme_id='PROG-PROJECT'")
        self.sources['KSBP-PROJECT'] = self.project_ksbs
        self.assertEqual(self.scope['_fetch_ksb_items']('Project Controls', self.plan), self.project_ksbs)

    def test_no_programme_and_no_plan_returns_no_items(self):
        self.assertEqual(self.scope['_fetch_ksb_items'](''), [])


if __name__ == '__main__':
    unittest.main()
