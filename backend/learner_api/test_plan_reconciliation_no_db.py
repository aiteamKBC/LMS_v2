"""Real writer bodies with synthetic ORM/transactions; no framework or database.

Run: python -B backend/learner_api/test_plan_reconciliation_no_db.py
SQL locking, FK behavior and real concurrent transactions remain unverified.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
import json
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace as NS
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent


def guard(event, args):
    if event == 'import' and args[0].split('.')[0] in {'django', 'psycopg', 'psycopg2', 'sqlite3'}:
        raise RuntimeError('Framework/database startup forbidden')
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
        raise RuntimeError('External IO forbidden')
    if event == 'open':
        path, mode, flags = args
        if Path(str(path)).name.startswith('.env'):
            raise RuntimeError('Environment access forbidden')
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (
            isinstance(flags, int) and flags & (1 | 2 | 64 | 512 | 1024)
        ):
            raise RuntimeError('Writes forbidden')


def load(file, names, scope):
    nodes = [node for node in ast.parse((ROOT / file).read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in nodes} == set(names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), file, 'exec'), scope)


class Failure(Exception):
    pass


PLAN = [{'moduleId': 'orphan-M', 'moduleTitle': 'Old title', 'weeks': [
    {'weekId': 'W1', 'components': [{'componentId': 'C1'}, {'componentId': 'C2'}]},
    {'weekId': 'W2', 'components': []},
]}]


class Store:
    def __init__(self):
        self.rows = [[], [], []]
        self.progress = []
        self.json = None
        self.legacy = {}
        self.free = []
        self.writes = []
        self.fail_level = None
        self.next_id = 100
        self.profile = NS(pk=19)
        self.scope = {'DatabaseError': Failure, 'transaction': NS(atomic=self.atomic),
                      'connections': {'enrolment': NS(cursor=self.cursor)},
                      'LearnerProfile': NS(objects=self), '_s': lambda v: '' if v is None else str(v).strip()}
        self.models = []
        for level, name in enumerate(('Module', 'Week', 'Component')):
            manager = Manager(self, level)
            model = lambda _level=level, **kw: NS(pk=None, **kw)
            model.objects = manager
            self.models.append(model)
            self.scope['LearnerTrainingPlan' + name] = model
        load('active_users.py', ['replace_training_plan'], self.scope)

    @contextmanager
    def atomic(self, using):
        assert using == 'enrolment'
        saved = deepcopy((self.rows, self.progress, self.json, self.legacy, self.free, self.next_id))
        try:
            yield
        except Exception:
            self.rows, self.progress, self.json, self.legacy, self.free, self.next_id = saved
            raise

    def using(self, alias):
        assert alias == 'enrolment'
        return self

    def select_for_update(self):
        return self

    def get(self, pk):
        assert pk == 19
        return self.profile

    def filter(self, **kw):
        assert kw == {'enrolment_id': 7}
        return self

    def update(self, learning_plan):
        self.json = deepcopy(learning_plan)

    def first(self):
        return self.profile

    @contextmanager
    def cursor(self):
        def execute(sql, params):
            assert 'plan_component_id = ANY(%s)' in sql
            self.removed = params[0]
        yield NS(execute=execute, fetchone=lambda: (1,) if any(
            p['plan_component_id'] in self.removed for p in self.progress) else None)

    def replace(self, plan):
        self.scope['replace_training_plan'](self.profile, deepcopy(plan))

    def snapshot(self):
        return deepcopy((self.rows, self.progress, self.json, self.legacy, self.free))

    def ids(self):
        return [[r.pk for r in rows] for rows in self.rows]

    def sync(self, source, strict=True):
        codec = codec_scope()
        modules = {name: ModuleType(name) for name in (
            'learner_api', 'learner_api.active_users', 'learner_api.mappers', 'learner_api.models')}
        modules['learner_api.active_users'].replace_training_plan = self.scope['replace_training_plan']
        modules['learner_api.active_users'].replace_free_courses = lambda profile, free: self.free.extend(free)
        modules['learner_api.mappers'].mirrored_training_plan = codec['mirrored_training_plan']
        modules['learner_api.models'].LearnerProfile = NS(objects=self)
        def update(**kw):
            self.legacy.update(kw)
        scope = {'__package__': 'learner_api', 'DatabaseError': Failure,
                 'transaction': NS(atomic=self.atomic), '_s': self.scope['_s'],
                 'logger': logging.getLogger('guarded'),
                 'EnrolmentUser': NS(all_learners=NS(filter=lambda **kw: NS(update=update)))}
        load('learning_plan.py', ['_plan_titles', 'sync_learning_plan_mirror'], scope)
        with patch.dict(sys.modules, modules):
            return scope['sync_learning_plan_mirror'](source, strict=strict)


class Manager:
    def __init__(self, store, level, selected=None):
        self.store, self.level, self.selected = store, level, selected

    def using(self, alias):
        assert alias == 'enrolment'
        return self

    def select_for_update(self):
        return self

    def filter(self, **kw):
        def matches(row):
            for key, value in kw.items():
                if key.endswith('__in'):
                    if getattr(row, key[:-4]) not in value:
                        return False
                elif getattr(row, key) != value:
                    return False
            return True
        return Manager(self.store, self.level, [r for r in self.store.rows[self.level] if matches(r)])

    def order_by(self, *fields):
        return sorted(self.selected, key=lambda r: r.pk)

    def delete(self):
        ids = {r.pk for r in self.selected}
        # Emulate the dangerous FK action to catch accidental link destruction.
        if self.level == 2:
            for p in self.store.progress:
                if p['plan_component_id'] in ids:
                    p['plan_component_id'] = None
        self.store.rows[self.level] = [r for r in self.store.rows[self.level] if r.pk not in ids]
        self.store.writes.append(('delete', self.level))

    def check_unique(self):
        seen = set()
        parent = ('learner_id', 'plan_module_id', 'plan_week_id')[self.level]
        for row in self.store.rows[self.level]:
            key = (getattr(row, parent), row.position)
            if key in seen:
                raise Failure('UNIQUE parent/position violation')
            seen.add(key)

    def bulk_update(self, rows, fields, **kw):
        self.check_unique()
        self.store.writes.append(('update', self.level))
        if self.store.fail_level == self.level:
            raise Failure('injected update failure')

    def bulk_create(self, rows, **kw):
        for row in rows:
            self.store.next_id += 1
            row.pk = self.store.next_id
            parent = ('learner', 'plan_module', 'plan_week')[self.level]
            setattr(row, parent + '_id', getattr(row, parent).pk)
            self.store.rows[self.level].append(row)
        self.check_unique()
        self.store.writes.append(('create', self.level))
        if self.store.fail_level == self.level:
            raise Failure('injected insert failure')
        return rows


def codec_scope():
    scope = {'json': json}
    load('mappers.py', ['_s', '_as_list', '_maybe_json', '_split_csv', '_legacy_plan_from_csv',
                        'stored_training_plan', 'get_training_plan', 'mirrored_training_plan'], scope)
    return scope


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.db = Store()
        self.db.replace(PLAN)
        self.db.progress = [{'id': 911, 'plan_component_id': self.db.rows[2][0].pk,
                             'deleted_at': 'historical', 'attempt': 3}]

    def test_identical_replay_preserves_ids_progress_and_has_no_graph_writes(self):
        before = self.db.snapshot()
        self.db.writes.clear()
        self.db.replace(PLAN)
        self.assertEqual(self.db.snapshot(), before)
        self.assertEqual(self.db.writes, [])

    def test_reordering_and_title_changes_keep_stable_ids(self):
        ids, progress = self.db.ids(), deepcopy(self.db.progress)
        plan = deepcopy(PLAN)
        plan[0]['moduleTitle'] = 'Renamed'
        plan[0]['weeks'].reverse()
        plan[0]['weeks'][1]['components'].reverse()
        plan.insert(0, {'moduleId': 'new', 'weeks': []})
        self.db.replace(plan)
        self.assertEqual(self.db.rows[0][0].pk, ids[0][0])
        self.assertEqual(self.db.rows[0][0].position, 2)
        self.assertEqual(self.db.rows[1][0].position, 2)
        self.assertEqual(self.db.rows[2][0].position, 2)
        self.assertEqual(self.db.progress, progress)
        self.assertEqual(self.db.ids()[1:], ids[1:])

    def test_unassignment_with_links_fails_without_changes(self):
        for plan in (None, [], [{'moduleId': 'replacement'}]):
            before = self.db.snapshot()
            with self.assertRaisesRegex(Failure, 'historical progress'):
                self.db.replace(plan)
            self.assertEqual(self.db.snapshot(), before)

    def test_unlinked_unassignment_removes_graph(self):
        self.db.progress = []
        self.db.replace([])
        self.assertEqual(self.db.rows, [[], [], []])

    def test_removing_unlinked_component_keeps_linked_sibling(self):
        plan = deepcopy(PLAN)
        plan[0]['weeks'][0]['components'].pop()
        progress = deepcopy(self.db.progress)
        self.db.replace(plan)
        self.assertEqual(len(self.db.rows[2]), 1)
        self.assertEqual(self.db.progress, progress)

    def test_parent_change_is_not_a_stable_identity_match(self):
        plan = deepcopy(PLAN)
        plan[0]['weeks'][1]['components'] = plan[0]['weeks'][0]['components']
        plan[0]['weeks'][0]['components'] = []
        before = self.db.snapshot()
        with self.assertRaises(Failure):
            self.db.replace(plan)
        self.assertEqual(self.db.snapshot(), before)

    def test_ambiguous_or_missing_identities_never_write(self):
        for plan in ([PLAN[0], PLAN[0]], [{'moduleTitle': 'Old title'}],
                     [{'moduleId': 'orphan-M', 'weeks': [{'weekId': 'W1'}, {'weekId': 'W1'}]}],
                     [{'moduleId': 'orphan-M', 'weeks': [{'weekId': 'W1', 'components': [
                         {'componentId': 'C1'}, {'componentId': 'C1'}]}]}]):
            before = self.db.snapshot()
            with self.assertRaises(Failure):
                self.db.replace(plan)
            self.assertEqual(self.db.snapshot(), before)

    def test_existing_duplicate_or_null_ref_fails_without_writes(self):
        for ref in ('C1', None):
            self.db.rows[2][1].component_ref = ref
            before = self.db.snapshot()
            with self.assertRaises(Failure):
                self.db.replace(PLAN)
            self.assertEqual(self.db.snapshot(), before)

    def test_insert_failure_rolls_back_prior_updates(self):
        before = self.db.snapshot()
        plan = deepcopy(PLAN)
        plan[0]['moduleTitle'] = 'changed'
        plan[0]['weeks'][0]['components'].append({'componentId': 'new'})
        self.db.fail_level = 2
        with self.assertRaises(Failure):
            self.db.replace(plan)
        self.assertEqual(self.db.snapshot(), before)

    def test_sync_failure_rolls_back_json_children_free_courses_and_legacy(self):
        before = self.db.snapshot()
        source = NS(pk=7, training_plan=[], learning_plan=PLAN, free_courses=['synthetic'])
        with self.assertRaises(Failure):
            self.db.sync(source)
        self.assertEqual(self.db.snapshot(), before)
        with self.assertLogs('guarded', level='ERROR'):
            self.assertEqual(self.db.sync(source, strict=False), 0)
        self.assertEqual(self.db.snapshot(), before)

    def test_successful_sync_is_idempotent(self):
        source = NS(pk=7, training_plan=PLAN, learning_plan=None)
        self.db.sync(source)
        before = self.db.snapshot()
        self.db.sync(source)
        self.assertEqual(self.db.snapshot(), before)

    def test_sync_explicit_empty_and_null_remain_distinct(self):
        self.db.progress = []
        self.db.sync(NS(pk=7, training_plan=[], learning_plan=PLAN))
        self.assertEqual(self.db.json, [])
        self.db.sync(NS(pk=7, training_plan=None, learning_plan=None))
        self.assertIsNone(self.db.json)

    def test_precedence_and_legacy_fallback(self):
        codec = codec_scope()
        cases = [(NS(training_plan=[], learning_plan=PLAN), []),
                 (NS(training_plan=PLAN, learning_plan=[]), PLAN),
                 (NS(training_plan=None, learning_plan=[]), []),
                 (NS(training_plan=None, learning_plan=None), None),
                 (NS(training_plan='[]', learning_plan=PLAN), [])]
        for source, expected in cases:
            self.assertEqual(codec['mirrored_training_plan'](source), expected)
        legacy = codec['mirrored_training_plan'](NS(modules='Legacy title'))
        self.assertEqual(legacy[0]['moduleTitle'], 'Legacy title')
        self.assertIsNone(legacy[0]['moduleId'])

    def test_another_learner_is_untouched(self):
        other = NS(pk=999, learner_id=88, module_ref='other', module_title='other', position=1)
        self.db.rows[0].append(other)
        before = deepcopy(other)
        self.db.replace(PLAN)
        self.assertEqual(self.db.rows[0][-1], before)

    def test_shift_uses_the_same_link_protection(self):
        self.db.profile.training_plan = deepcopy(PLAN)
        before = self.db.snapshot()
        active = ModuleType('learner_api.active_users')
        active.replace_training_plan = self.db.scope['replace_training_plan']
        scope = {'__package__': 'learner_api', 'transaction': NS(atomic=self.db.atomic),
                 'LearnerProfile': NS(objects=self.db), '_s': self.db.scope['_s']}
        load('module_shift.py', ['_replace_mirrored_module'], scope)
        with patch.dict(sys.modules, {'learner_api': ModuleType('learner_api'),
                                      'learner_api.active_users': active}):
            with self.assertRaisesRegex(Failure, 'historical progress'):
                scope['_replace_mirrored_module'](self.db.profile, 'orphan-M', {'moduleId': 'new'})
        self.assertEqual(self.db.snapshot(), before)

    def test_existing_mirror_suite_with_framework_doubles(self):
        active = ModuleType('learner_api.active_users')
        active.__dict__.update(self.db.scope)
        load('active_users.py', ['replace_training_plan'], active.__dict__)
        active.replace_free_courses = lambda *args: None
        codec = ModuleType('learner_api.mappers')
        codec.__dict__.update(codec_scope())
        models = ModuleType('learner_api.models')
        models.LearnerProfile = NS(objects=self.db)
        learning = ModuleType('learner_api.learning_plan')
        learning.__dict__.update(__package__='learner_api', DatabaseError=Failure,
                                 transaction=NS(atomic=self.db.atomic),
                                 EnrolmentUser=NS(), _s=self.db.scope['_s'],
                                 logger=NS(exception=lambda *args: None, error=lambda *args: None))
        load('learning_plan.py', ['_plan_titles', 'sync_learning_plan_mirror'], learning.__dict__)
        package = ModuleType('learner_api')
        package.active_users = active
        modules = {'learner_api': package, 'learner_api.active_users': active,
                   'learner_api.mappers': codec, 'learner_api.models': models,
                   'learner_api.learning_plan': learning}
        scope = {'__name__': 'guarded_existing_mirror', '__package__': 'learner_api',
                 'SimpleTestCase': unittest.TestCase, 'patch': patch, 'DatabaseError': Failure,
                 '_plan_titles': learning._plan_titles, 'sync_learning_plan_mirror': learning.sync_learning_plan_mirror}
        tree = ast.parse((ROOT / 'tests_learning_plan_mirror.py').read_text(encoding='utf-8'))
        nodes = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.Assign))]
        with patch.dict(sys.modules, modules):
            exec(compile(ast.Module(body=nodes, type_ignores=[]), 'tests_learning_plan_mirror.py', 'exec'), scope)
            suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(scope[name])
                                       for name in ('PlanTitleColumnsTests', 'SyncMirrorTests', 'ChildRowBatchingTests'))
            result = unittest.TestResult()
            suite.run(result)
            self.assertEqual(result.testsRun, 14)
            self.assertTrue(result.wasSuccessful(), '\n'.join(trace for _, trace in result.errors + result.failures))


if __name__ == '__main__':
    sys.addaudithook(guard)
    unittest.main()
