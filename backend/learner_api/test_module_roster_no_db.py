"""O04 source-only regressions; all ORM, writes and services are I/O doubles.

Run: python -B backend/learner_api/test_module_roster_no_db.py
Frozen pre-O04 functions provide an independent orchestration parity baseline.
No Django startup, database drivers, settings or live HTTP requests.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
import functools
import json
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

if __package__:
    from . import test_legacy_assignment_list_no_db as support
else:
    import test_legacy_assignment_list_no_db as support

ROOT = Path(__file__).resolve().parent
if __name__ == '__main__':
    sys.addaudithook(support.guard)


def model_fields():
    tree = ast.parse((ROOT / 'models.py').read_text(encoding='utf-8-sig'))
    model = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'EnrolmentUser')
    return {n.targets[0].id for n in model.body if isinstance(n, ast.Assign)
            and isinstance(n.targets[0], ast.Name) and isinstance(n.value, ast.Call)
            and (isinstance(n.value.func, ast.Attribute) and n.value.func.attr.endswith('Field')
                 or isinstance(n.value.func, ast.Name) and n.value.func.id == 'SafeJSONField')}


FIELDS = model_fields()


def learner(pk, plan=None, **extra):
    row = dict.fromkeys(FIELDS)
    row.update(id=pk, username=f'Learner {pk:03}', email=f'l{pk}@example.invalid',
               programme='P', cohort='C', group='G', learner_type='apprenticeship',
               programme_status='Delivery', learning_plan=plan, training_plan=None)
    row.update(extra)
    return row


def module(mid):
    return dict(moduleId=mid, moduleTitle=f'Title {mid}', programmeId='P',
                programmeName='P', groupName='G', hours=0, startDate='', endDate='')


class Record:
    def __init__(self, data, manager, fields=None):
        self.__dict__.update({k: deepcopy(v) for k, v in data.items() if fields is None or k in fields})
        self._manager = manager

    @property
    def pk(self):
        return self.id

    def __getattr__(self, name):
        if name in FIELDS:
            raise AssertionError(f'Deferred field access: {name}')
        raise AttributeError(name)

    def save(self, update_fields):
        self._manager.events.append(('save', self.pk, tuple(update_fields)))
        if self.pk == self._manager.fail_save:
            raise support.DatabaseError('synthetic save unavailable')
        for field in update_fields:
            self._manager.data[self.pk][field] = deepcopy(getattr(self, field))


class Directory:
    db = 'intercepted-only'

    def __init__(self, rows):
        self.data = {r['id']: deepcopy(r) for r in rows}
        self.events = []
        self.fail_save = None
        self.fail_read = False

    def order_by(self, *fields):
        assert fields == ('username', 'id')
        return Query(self, sorted(self.data, key=lambda pk: (self.data[pk]['username'] or '', pk)))

    def filter(self, **where):
        ids = where.get('pk__in', [where.get('pk')])
        return Query(self, [pk for pk in ids if pk in self.data])

    def select_for_update(self):
        self.events.append(('lock',))
        return self

    def only(self, *fields):
        return Query(self, list(self.data)).only(*fields)


class Query:
    def __init__(self, manager, ids):
        self.manager, self.ids, self.fields = manager, ids, None

    def only(self, *fields):
        self.fields = fields
        return self

    def order_by(self, *fields):
        assert fields == ('username', 'id')
        self.ids.sort(key=lambda pk: (self.manager.data[pk]['username'] or '', pk))
        return self

    def __iter__(self):
        self.manager.events.append(('directory', self.fields))
        if self.manager.fail_read:
            raise support.DatabaseError('synthetic directory unavailable')
        return iter([Record(self.manager.data[pk], self.manager, self.fields) for pk in self.ids])

    def count(self):
        return len(self.ids)

    def first(self):
        return next(iter(self), None)


class Harness:
    def __init__(self, rows, before=False):
        self.directory = Directory(rows)
        self.calls = []
        self.catalogue = [module(mid) for mid in ('A', 'B', 'MANUAL')]
        self.profiles = {}
        self.groups = {('P', 'G'): ['A', 'B', 'MANUAL'], ('Q', 'H'): ['B']}
        self.by_id = {'stable': ['B'], 'deleted': []}
        self.role = 'staff'
        self.unreadable = False
        self.ns = dict(json=json, JsonResponse=support.Response, DatabaseError=support.DatabaseError,
                       logger=Mock(spec=logging.Logger), csrf_exempt=lambda f: f,
                       EnrolmentUser=SimpleNamespace(all_learners=self.directory))
        permissions = dict(functools=functools, JsonResponse=support.Response,
                           authenticate_request=lambda request: None if self.role is None else SimpleNamespace(role=self.role),
                           session_unreadable=lambda request: self.unreadable)
        support.definitions(ROOT.parent / 'login' / 'permissions.py',
                            ['staff_only', '_unauthenticated', '_unavailable', '_forbidden'], permissions,
                            constants=('_DISABLED_VALUES', '_SAFE_METHODS'))
        self.ns['staff_only'] = permissions['staff_only']
        support.definitions(ROOT / 'mappers.py', ['_s', '_maybe_json', 'stored_training_plan', 'training_plan_field'], self.ns)
        raw_stored = self.ns['stored_training_plan']

        def stored(source):
            self.calls.append(('stored_plan', source.pk))
            return raw_stored(source)

        self.ns['stored_training_plan'] = stored

        def profile_filter(**where):
            self.calls.append(('profile', where['enrolment_id']))
            return SimpleNamespace(values_list=lambda *fields: self.profiles.get(where['enrolment_id'], []))

        placement = dict(EnrolmentUser=Record, LearnerProfile=SimpleNamespace(objects=SimpleNamespace(
            using=lambda alias: SimpleNamespace(filter=profile_filter))))
        support.definitions(ROOT / 'placement_links.py', ['_s', '_id', 'placement_ids'], placement,
                            constants=('FIELDS', '_CACHE', '_NAME_FIELDS'))
        self.ns.update(placement_ids=placement['placement_ids'], connection=SimpleNamespace(vendor='postgresql'),
                       projection_call=lambda label, fn, *args: fn(*args))

        def rows_reader(sql, params):
            if 'SELECT module_catalogue_id' in sql:
                self.calls.append(('manual', tuple(params)))
                return [{'module_catalogue_id': 'MANUAL'}] if 'MANUAL' in params else []
            self.calls.append(('preset', tuple(params)))
            # Intercept the unchanged SQL boundary, not a real SQL evaluator.
            assert 'deleted_at IS NULL' in sql and 'is_programme_deleted' in sql
            ids = self.by_id.get(params[0], []) if 'WHERE group_id = %s' in sql else self.groups.get((params[1], params[0]), [])
            return [{'module_ids': deepcopy(ids)}] if ids else []

        self.ns['_rows'] = rows_reader
        support.definitions(ROOT / 'selectors' / 'assignments.py',
                            ['_module_ids_from_column', '_manual_roster_module_ids', '_group_preset_rows',
                             '_group_module_ids', '_preset_ids_for', '_effective_plan_ids'], self.ns,
                            constants=('GROUP_PRESET_SOURCE', 'GROUP_PRESET_SQL', 'GROUP_PRESET_BY_ID_SQL'))
        self.ns.update(_all_modules=self.all_modules, sync_learning_plan_mirror=self.mirror,
                       advance_learner=self.advance)
        support.definitions(ROOT / 'learning_plan.py',
                            ['_error', '_plan_field', '_plan_entries', '_learner_picker_row', '_module_facts',
                             '_module_learners_payload', '_picker_learners', 'module_learners', '_orphan_module'],
                            self.ns, constants=('_PICKER_FIELDS',))
        if before:
            exec(compile(BEFORE, '<frozen-pre-O04>', 'exec'), self.ns)

    def all_modules(self):
        self.calls.append(('catalogue',))
        return deepcopy(self.catalogue)

    def mirror(self, source, **kwargs):
        self.calls.append(('mirror', source.pk))

    def advance(self, source):
        # Mutation passes must retain full instances for progression/date reads.
        source.start_date, source.end_date, source.learner_start_date, source.learner_end_date
        self.calls.append(('advance', source.pk))

    def request(self, method='GET', ids=None, mid='A', body=None):
        request = SimpleNamespace(method=method, body=json.dumps({'learnerIds': ids}).encode() if body is None else body)
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}):
            return self.ns['module_learners'](request, module_id=mid)

    def curriculum(self, method, ids=None, scope='module', fail_mirror=None, facts=None):
        """Real unchanged shared handlers/writers, with explicit transactional I/O doubles."""
        target = dict(id='A', name='C', scope=scope, programmeName='P', programmeId='P',
                      groupNames=['G'], moduleIds=['A'])
        plans = SimpleNamespace(**self.ns)
        mirror = plans.sync_learning_plan_mirror

        def strict_mirror(source, **kwargs):
            mirror(source, **kwargs)
            if source.pk == fail_mirror:
                raise support.DatabaseError('synthetic strict mirror failure')

        plans.sync_learning_plan_mirror = strict_mirror

        @contextmanager
        def atomic(*, using):
            assert using == self.directory.db
            self.calls.append(('atomic',))
            original = deepcopy(self.directory.data)
            try:
                yield
            except Exception:
                self.directory.data = original
                raise

        def profile_update(**kwargs):
            self.calls.append(('placement_update',))
            return SimpleNamespace(update=lambda **values: self.calls.append(('placement_values', values)))

        package = ModuleType('_o04_curriculum')
        package.__path__ = []
        views = ModuleType('_o04_curriculum.views')
        views.invalidate_curriculum_cache = lambda: self.calls.append(('invalidate',))
        fact_module = ModuleType('_o04_curriculum.learner_assignment_counts_sql')
        fact_module.assignment_directory_facts = lambda ids: (facts or {}, [])
        ns = dict(self.ns, __package__='_o04_curriculum', plans=plans,
                  assignment_reads=SimpleNamespace(_effective_plan_ids=self.ns['_effective_plan_ids']),
                  _target=lambda *args: deepcopy(target), transaction=SimpleNamespace(atomic=atomic),
                  get_training_plan=lambda source: self.ns['stored_training_plan'](source) or [],
                  hydrate_training_plan=lambda entries, strict: deepcopy(entries),
                  LearnerProfile=SimpleNamespace(objects=SimpleNamespace(filter=profile_update)))
        support.definitions(ROOT.parent / 'curriculum_api' / 'learner_assignments.py',
                            ['_same_cohort', '_assigned', '_payload', '_assign', '_unassign', '_handle',
                             'cohort_learner_assignments', 'module_learner_assignments'], ns)
        request = SimpleNamespace(method=method, body=json.dumps({'learnerIds': ids}).encode())
        endpoint = ns[f'{scope}_learner_assignments']
        with patch.dict(sys.modules, {'_o04_curriculum': package, '_o04_curriculum.views': views,
                                     '_o04_curriculum.learner_assignment_counts_sql': fact_module}), \
                patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}):
            return endpoint(request, identifier='A')


class ModuleRosterTests(unittest.TestCase):
    def compare(self, rows, method='GET', ids=None, mid='A', setup=None, body=None):
        old, new = Harness(rows, before=True), Harness(rows)
        if setup:
            setup(old)
            setup(new)
        old_response, new_response = old.request(method, ids, mid, body), new.request(method, ids, mid, body)
        expected_content = old_response.content
        old_data = json.loads(expected_content)
        if old_response.status_code == 502 and str(old_data.get('error', '')).startswith('Database error: '):
            # P04 deliberately replaces only the database diagnostic text.
            self.assertEqual(set(old_data), {'error'})
            expected_content = json.dumps({'error': 'The database service is temporarily unavailable.'}).encode()
        self.assertEqual((old_response.status_code, expected_content),
                         (new_response.status_code, new_response.content))
        self.assertEqual(old.directory.data, new.directory.data)
        self.assertEqual([c for c in old.calls if c[0] != 'stored_plan'],
                         [c for c in new.calls if c[0] != 'stored_plan'])
        return old, new, json.loads(new_response.content)

    def test_empty_roster(self):
        _, new, payload = self.compare([])
        self.assertEqual(payload['totals'], {'learnerCount': 0, 'assignedCount': 0})
        self.assertEqual(new.calls, [('catalogue',)])

    def test_populated_shared_and_different_groups(self):
        rows = [learner(3, programme='Q', group='H', learner_type='commercial'), learner(2), learner(1)]
        old, new, payload = self.compare(rows)
        self.assertEqual([r['id'] for r in payload['learners']], ['1', '2', '3'])
        self.assertEqual([r['assigned'] for r in payload['learners']], [True, True, False])
        self.assertEqual(sum(c[0] == 'preset' for c in new.calls), 2)
        self.assertEqual(sum(c[0] == 'profile' for c in new.calls), 3)
        self.assertEqual(sum(c[0] == 'stored_plan' for c in old.calls), 6)
        self.assertEqual(sum(c[0] == 'stored_plan' for c in new.calls), 3)

    def test_plan_decode_reduction_scales_without_claiming_sql_elimination(self):
        for size in (1, 10, 100):
            with self.subTest(size=size):
                old, new, _ = self.compare([learner(i + 1) for i in range(size)])
                self.assertEqual(sum(c[0] == 'stored_plan' for c in old.calls), size * 2)
                self.assertEqual(sum(c[0] == 'stored_plan' for c in new.calls), size)
                self.assertEqual(sum(c[0] == 'preset' for c in new.calls), 1)
                self.assertEqual(sum(c[0] == 'manual' for c in new.calls), 1)

    def test_projection_is_exact_and_no_deferred_reads(self):
        old, new, _ = self.compare([learner(1)])
        self.assertEqual(old.directory.events, [('directory', None)])
        selected = new.directory.events[0][1]
        self.assertEqual(set(selected), {'id', 'username', 'email', 'learner_type', 'programme',
                                         'cohort', 'group', 'programme_status', 'learning_plan', 'training_plan'})
        self.assertLess(len(selected), len(FIELDS))

    def test_empty_explicit_inherited_manual_duplicate_and_json_string_plans(self):
        rows = [learner(1), learner(2, []), learner(3, [{'moduleId': 'A'}]),
                learner(4, [{'moduleId': 'A', 'assignmentMode': 'explicit'}]),
                learner(5, [{'moduleId': 'MANUAL'}]),
                learner(6, [{'moduleId': 'A'}, {'moduleId': 'A'}]),
                learner(7, '[{"moduleId":"B"}]'),
                learner(8, [{'moduleId': 'A'}], training_plan=[]),
                learner(9, [{'moduleId': None, 'moduleTitle': 'Legacy title'}])]
        _, _, payload = self.compare(rows)
        self.assertEqual([r['moduleCount'] for r in payload['learners']], [2, 0, 2, 1, 3, 3, 2, 0, 0])
        _, _, manual = self.compare(rows, mid='MANUAL')
        self.assertEqual([r['id'] for r in manual['learners'] if r['assigned']], ['5'])

    def test_stable_id_deleted_group_and_name_fallback(self):
        def setup(h):
            h.profiles = {1: [('P', 'C', 'stable')], 2: [('P', 'C', 'deleted')]}
        _, _, payload = self.compare([learner(1), learner(2), learner(3)], setup=setup)
        self.assertEqual([r['assigned'] for r in payload['learners']], [False, False, True])

    def test_deleted_module_is_still_not_in_catalogue(self):
        _, _, payload = self.compare([learner(1)], mid='DELETED')
        self.assertEqual(payload, {'error': 'Module DELETED is not in the module catalogue.'})

    def test_patch_and_put_remain_full_desired_roster_with_fresh_readback(self):
        for method in ('PATCH', 'PUT'):
            with self.subTest(method=method):
                rows = [learner(1, []), learner(2, [{'moduleId': 'A', 'assignmentMode': 'explicit'}]),
                        learner(3, [{'moduleId': 'B', 'assignmentMode': 'explicit'}])]
                old, new, payload = self.compare(rows, method, [1, 1, '3'])
                self.assertEqual(payload['changedCount'], 3)
                self.assertEqual([r['assigned'] for r in payload['learners']], [True, False, True])
                self.assertEqual([e[1] for e in new.directory.events if e[0] == 'directory'],
                                 [None, new.ns['_PICKER_FIELDS']])
                self.assertEqual(sum(c[0] == 'stored_plan' for c in old.calls), 12)
                self.assertEqual(sum(c[0] == 'stored_plan' for c in new.calls), 6)

    def test_noop_does_not_materialize_inheritance_or_touch_unrelated_learner(self):
        rows = [learner(1), learner(2, []), learner(3, training_plan=[], learner_type='commercial')]
        _, new, payload = self.compare(rows, 'PATCH', ['1'])
        self.assertEqual(payload['changedCount'], 0)
        self.assertEqual(new.directory.data, {r['id']: r for r in rows})
        self.assertFalse(any(c[0] == 'mirror' for c in new.calls))

    def test_existing_nonexplicit_removal_inheritance_is_preserved(self):
        _, new, payload = self.compare([learner(1)], 'PATCH', [])
        self.assertEqual(payload['changedCount'], 1)
        self.assertEqual(new.directory.data[1]['learning_plan'], [module('B')])
        self.assertTrue(payload['learners'][0]['assigned'])

    def test_partial_save_failure_preserves_existing_502_and_prior_save(self):
        old, new, payload = self.compare([learner(1, []), learner(2, [])], 'PUT', [1, 2],
                                         setup=lambda h: setattr(h.directory, 'fail_save', 2))
        # P04 forbids returning the database exception; partial-save assertions remain.
        self.assertEqual(payload['error'], 'The database service is temporarily unavailable.')
        self.assertTrue(new.directory.data[1]['learning_plan'])
        self.assertEqual(new.directory.data[2]['learning_plan'], [])

    def test_invalid_body_unknown_learner_and_method_errors(self):
        for method, body in [('PATCH', b'{'), ('PUT', b'[]'), ('PATCH', b'{}'), ('POST', b'{}')]:
            with self.subTest(method=method, body=body):
                self.compare([learner(1)], method, body=body)
        self.compare([learner(1)], 'PATCH', ['999'])

    def test_authorization_denies_before_reading_directory_or_catalogue(self):
        for role, status in [(None, 401), ('learner', 403), ('employer', 403), ('coach', 403)]:
            for method in ('GET', 'PATCH', 'PUT'):
                with self.subTest(role=role, method=method):
                    for before in (True, False):
                        h = Harness([learner(1)], before)
                        h.role = role
                        self.assertEqual(h.request(method, [1]).status_code, status)
                        self.assertEqual(h.calls, [])
                        self.assertEqual(h.directory.events, [])

    def test_admin_allowed_and_unreadable_session_fails_closed(self):
        self.compare([learner(1)], setup=lambda h: setattr(h, 'role', 'admin'))
        h = Harness([learner(1)])
        h.role, h.unreadable = None, True
        self.assertEqual(h.request().status_code, 503)
        self.assertEqual(h.calls, [])

    def test_directory_unavailable(self):
        self.compare([learner(1)], setup=lambda h: setattr(h.directory, 'fail_read', True))


class SharedAssignmentTests(unittest.TestCase):
    def compare(self, rows, method, ids=None, scope='module', **kwargs):
        old, new = Harness(rows, before=True), Harness(rows)
        left, right = old.curriculum(method, ids, scope, **kwargs), new.curriculum(method, ids, scope, **kwargs)
        self.assertEqual((left.status_code, left.content), (right.status_code, right.content))
        self.assertEqual(old.directory.data, new.directory.data)
        self.assertEqual(old.calls, new.calls)
        return new, right, json.loads(right.content)

    def test_empty_and_populated_directory_json_and_cohort_membership(self):
        for scope in ('module', 'cohort'):
            _, _, empty = self.compare([], 'GET', scope=scope)
            self.assertEqual(empty['totals']['learnerCount'], 0)
            rows = [learner(2, programme='Q'), learner(1)]
            facts = {1: {'effective': {'A', 'B'}, 'moduleCount': 2},
                     2: {'effective': {'A'}, 'moduleCount': 1}}
            _, _, payload = self.compare(rows, 'GET', scope=scope, facts=facts)
            self.assertEqual([r['assigned'] for r in payload['learners']],
                             [True, scope == 'module'])

    def test_post_is_additive_deduplicated_and_does_not_touch_unselected(self):
        for scope in ('module', 'cohort'):
            rows = [learner(1, []), learner(2, [{'moduleId': 'B', 'assignmentMode': 'explicit'}]), learner(3)]
            new, response, payload = self.compare(rows, 'POST', [2, '1', 2], scope)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload['changedCount'], 2)
            self.assertEqual(new.directory.data[3], rows[2])
            self.assertEqual([e['moduleId'] for e in new.directory.data[2]['learning_plan']], ['B', 'A'])
            self.assertTrue(all(e['assignmentMode'] == 'explicit' for e in new.directory.data[2]['learning_plan']))
            self.assertEqual(sum(c[0] == 'atomic' for c in new.calls), 2)

    def test_delete_freezes_remaining_plan_and_does_not_reinherit_removed_module(self):
        new, response, payload = self.compare([learner(1, [{'moduleId': 'A'}, {'moduleId': 'B'}])], 'DELETE', [1])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['changedCount'], 1)
        self.assertEqual(new.directory.data[1]['learning_plan'], [{'moduleId': 'B', 'assignmentMode': 'explicit'}])

    def test_shared_partial_failure_rolls_back_only_failed_learner(self):
        rows = [learner(1, []), learner(2, []), learner(3, [])]
        new, response, payload = self.compare(rows, 'POST', [1, 2], fail_mirror=2)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((payload['assignedCount'], payload['changedCount'], payload['failedIds']), (1, 1, ['2']))
        self.assertTrue(new.directory.data[1]['learning_plan'])
        self.assertEqual(new.directory.data[2], rows[1])
        self.assertEqual(new.directory.data[3], rows[2])

    def test_shared_all_failed_preserves_503(self):
        _, response, _ = self.compare([learner(1, [])], 'POST', [1], fail_mirror=1)
        self.assertEqual(response.status_code, 503)

    def test_shared_authorization_and_invalid_selection(self):
        for scope in ('module', 'cohort'):
            for method in ('GET', 'POST', 'DELETE'):
                for role, status in [(None, 401), ('learner', 403), ('employer', 403)]:
                    h = Harness([learner(1)])
                    h.role = role
                    self.assertEqual(h.curriculum(method, [1], scope).status_code, status)
                    self.assertEqual(h.calls, [])
            for ids in ([], [True], ['bad'], [999]):
                _, response, _ = self.compare([learner(1)], 'POST', ids, scope)
                self.assertEqual(response.status_code, 400)

# Exact function bodies captured before O04; do not derive these from live code.
BEFORE = r'''
def _learner_picker_row(learner, module_id, preset_cache):
    saved = _plan_entries(learner)
    plan_ids = _effective_plan_ids(learner, preset_cache)
    assigned = module_id in plan_ids
    return {
        "id": str(learner.id),
        "name": _s(learner.username) or _s(learner.email) or f"Learner {learner.id}",
        "email": _s(learner.email),
        "learnerType": _s(learner.learner_type) or "apprenticeship",
        "programme": _s(learner.programme),
        "cohort": _s(learner.cohort),
        "group": _s(learner.group),
        "programmeStatus": _s(learner.programme_status),
        "assigned": assigned,
        # True when the tick comes from the group preset rather than a saved
        # plan: nobody has agreed this learner's plan yet, so the module is
        # inherited rather than chosen. Named so the picker can say which it is.
        "fromPreset": assigned and not saved,
        "moduleCount": len(plan_ids),
    }


def _picker_learners():
    """Every learner in enrolment."Created_users", both kinds, by name.

    Whole rows, not ``.only(*_PICKER_FIELDS)``. A save runs advance_learner
    on each learner it touches, and that reads columns the picker itself
    never shows -- the delivery dates, the apprenticeship window. On a
    deferred instance each of those reads is its own query, so narrowing the
    select traded one wide read for dozens of narrow ones, and left the write
    depending on which columns a caller happened to list.
    """
    return list(EnrolmentUser.all_learners.order_by("username", "id"))


@csrf_exempt
# The whole learner directory with names and email addresses, and a write that
# changes what other people are taught. Staff/admin only, reads included.
@staff_only()
def module_learners(request, module_id):
    """GET who is assigned to this module, or PATCH to set the assignment."""
    module_id = _s(module_id)
    if not module_id:
        return _error("A module id is required.", 400)

    try:
        catalogue = {m["moduleId"]: m for m in _all_modules()}
    except DatabaseError as exc:
        logger.exception("module_learners: catalogue lookup failed")
        return _error(f"Database error: {exc}", 502)

    module = catalogue.get(module_id)
    if module is None:
        return _error(f"Module {module_id} is not in the module catalogue.", 404)

    if request.method == "GET":
        try:
            return JsonResponse(_module_learners_payload(module, _picker_learners(), {}))
        except DatabaseError as exc:
            logger.exception("module_learners: read failed")
            return _error(f"Database error: {exc}", 502)

    if request.method not in ("PATCH", "PUT"):
        return _error("Method not allowed.", 405)

    # ---- save ----
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    learner_ids = payload.get("learnerIds")
    if not isinstance(learner_ids, list):
        return _error("learnerIds must be a list.", 400)
    assigned_ids = {_s(value) for value in learner_ids if _s(value)}

    try:
        learners = _picker_learners()
    except DatabaseError as exc:
        logger.exception("module_learners: read failed")
        return _error(f"Database error: {exc}", 502)

    known_ids = {str(learner.id) for learner in learners}
    unknown = sorted(assigned_ids - known_ids)
    if unknown:
        return _error(f"Learner {unknown[0]} is not in the learner directory.", 400)

    preset_cache = {}
    changed = 0
    for learner in learners:
        should_have = str(learner.id) in assigned_ids
        saved = _plan_entries(learner)
        plan_ids = _effective_plan_ids(learner, preset_cache)
        # A learner whose effective plan already says the right thing is left
        # alone — including one inheriting the module from their group preset.
        # So opening this picker and saving it unchanged writes nothing, and
        # never converts a preset into an agreed plan behind staff's back.
        if should_have == (module_id in plan_ids):
            continue
        if should_have:
            plan_ids = [*plan_ids, module_id]
        else:
            plan_ids = [value for value in plan_ids if value != module_id]

        # Rebuilt from the catalogue, exactly as the learner's own plan save
        # does it, so titles/hours/dates are current rather than whatever was
        # stored last. A module retired since the plan was agreed has no
        # catalogue row left, and keeps its saved snapshot instead of vanishing.
        saved_by_id = {_s(entry.get("moduleId")): entry for entry in saved}
        resolved, seen = [], set()
        for plan_id in plan_ids:
            if not plan_id or plan_id in seen:
                continue
            seen.add(plan_id)
            resolved.append(dict(
                catalogue.get(plan_id)
                or _orphan_module(saved_by_id.get(plan_id) or {"moduleId": plan_id}),
                **({'assignmentMode': 'explicit'} if any(entry.get('assignmentMode') == 'explicit' for entry in saved) else {}),
            ))

        field = _plan_field(learner)
        setattr(learner, field, resolved)
        try:
            learner.save(update_fields=[field])
        except DatabaseError as exc:
            logger.exception("module_learners: save failed for learner %s", learner.id)
            return _error(f"Database error: {exc}", 502)
        # Same mirror as the learner's own plan save: assigning a module from
        # this side changes the same record, so the reporting tables have to
        # follow it here too or they would only track edits made from one of
        # the two directions.
        sync_learning_plan_mirror(learner)
        # Agreeing a plan is the last gate before Active for a commercial
        # learner, the same as on the learner's own plan save. Never raises.
        advance_learner(learner)
        changed += 1

    try:
        return JsonResponse({
            **_module_learners_payload(module, _picker_learners(), {}),
            "changedCount": changed,
        })
    except DatabaseError as exc:
        logger.exception("module_learners: read-back failed")
        return _error(f"Database error: {exc}", 502)
'''


if __name__ == '__main__':
    unittest.main(verbosity=2)
