"""O05 source-only endpoint parity with strict intercepted I/O.

Run: python -B backend/learner_api/test_learner_detail_o05_no_db.py
Real view, reading selector, assignment rules, permission gate and detail
orchestration; authored data/progress/identity/services use synthetic doubles.
No Django startup/settings, database drivers, writes or live HTTP.
"""
from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
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
    from . import test_module_roster_no_db as roster
else:
    import test_legacy_assignment_list_no_db as support
    import test_module_roster_no_db as roster

ROOT = Path(__file__).resolve().parent
if __name__ == '__main__':
    sys.addaudithook(support.guard)


class ServiceError(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


class MissingSource(Exception):
    pass


def graph(count=2, origin='native'):
    components = []
    weeks = []
    for i in range(count):
        weeks.append(dict(module=f'Module {i}', week='Week 1', moduleId=f'M{i}', weekId=f'W{i}'))
        for j, kind in enumerate(('reading', 'quiz', 'live_session')):
            components.append(dict(module=f'Module {i}', week='Week 1', moduleId=f'M{i}', weekId=f'W{i}',
                                   componentId=f'C{i}-{j}', component=f'{kind} {i}', type=kind,
                                   contentHtml=None, hasReadingContent=kind == 'reading', isQuiz=kind == 'quiz',
                                   quizMeta={'quizId': i} if kind == 'quiz' else None, expectedOtjh=0,
                                   completed=j == 0, empty='', zero=0, flag=False, optional=None))
    if origin != 'native':
        for i in range(count):
            if origin == 'source' or i % 2:
                weeks[i].update(moduleId=None, weekId=None)
                for component in components[i * 3:i * 3 + 3]:
                    component.update(moduleId=None, weekId=None, componentId=None)
    return dict(id='1', modules=[f'Module {i}' for i in range(count)], week=weeks, components=components,
                ksbs=[{'code': 'K1', 'title': 'Synthetic definition'}], progressKsbCodes=['K1'],
                quizAttempts=[{'quizId': 9, 'passed': True, 'retained': True}],
                componentProgress=[{'componentId': 'C0-0', 'status': 'completed'},
                                   {'componentId': 'C0-2', 'status': 'partial'}],
                videoProgress=[], componentMarkingStatus={'C0-0': {'status': 'accepted', 'feedback': ''}},
                activityFeed=[], learnerStartDate='25/10/2026', programmeEndDate='',
                sourceNativeRelationships={'legacy:9': 'current:M0'})


class Harness:
    def __init__(self, before=False, plan=None):
        self.assignment = roster.Harness([roster.learner(1, plan)])
        self.calls = []
        self.fields = []
        self.account = SimpleNamespace(role='learner', subject_id=1)
        self.unreadable = False
        self.source_error = None
        self.fail = None
        self.data = graph()
        self.profile = SimpleNamespace(ksbs=['K1'], training_plan_progress=[], start_date=date(2026, 10, 25))
        permissions = dict(functools=functools, JsonResponse=support.Response,
                           _auth_gate_enabled=lambda: True,
                           authenticate_request=lambda request: self.account,
                           session_unreadable=lambda request: self.unreadable)
        support.definitions(ROOT.parent / 'login' / 'permissions.py',
                            ['_unauthenticated', '_unavailable', '_read_only_learner_view', '_target_learner_id',
                             '_error_bad_target', '_learner_progress_gate', 'learner_self_or_staff'], permissions)
        ns = self.ns = dict(self.assignment.ns, __package__='_o05_learner',
                            learner_self_or_staff=permissions['learner_self_or_staff'],
                            ServiceError=ServiceError, logger=Mock(spec=logging.Logger))
        support.definitions(ROOT / 'mappers.py', ['get_training_plan', '_legacy_plan_from_csv', '_split_csv'], ns)
        support.definitions(ROOT / 'selectors' / 'assignments.py', ['effective_training_plan'], ns)
        # get_training_plan resolves in this same namespace, including the real
        # absent/empty distinction and title-only CSV fallback.
        ns['SOURCE_MODELS'] = {kind: SimpleNamespace(all_learners=self, DoesNotExist=MissingSource)
                               for kind in ('commercial', 'apprenticeship')}

        def stable(value):
            if isinstance(value, roster.Record):
                return ('source', value.pk)
            if isinstance(value, SimpleNamespace):
                return stable(vars(value))
            if isinstance(value, dict):
                return {k: stable(v) for k, v in value.items()}
            if isinstance(value, (list, tuple)):
                return [stable(v) for v in value]
            return deepcopy(value)

        def spy(name, result=None):
            def run(*args, **kwargs):
                self.calls.append((name, stable(args), stable(kwargs)))
                if self.fail == name:
                    raise support.DatabaseError('synthetic ' + name + ' unavailable')
                return result(*args, **kwargs) if callable(result) else deepcopy(result)
            return run

        self.spy = spy
        ns.update(_active_profile_for_source=spy('profile', lambda *a, **kw: self.profile),
                  to_learner_detail=spy('mapper', lambda *a, **kw: deepcopy(self.data)),
                  advance_learner=spy('advance'), hydrate_source_training_plan=spy('hydrate'),
                  access_gate=spy('access', {'blocked': False, 'reasons': []}),
                  learning_access=spy('learning_access', {'blocked': False, 'startDate': ''}),
                  _apply_cohort_schedule=spy('schedule'),
                  _resolve_from_master=spy('master', lambda modules, weeks, components, **kw: (modules, weeks, components)),
                  _apply_programme_assignment_template=spy('templates', lambda components, programme: components),
                  _otjh_by_component_id=spy('otjh_ids', lambda components: {c['componentId']: 2 for c in components}),
                  _otjh_by_legacy_title=spy('otjh_titles', {}),
                  _live_otjh_snapshot=spy('snapshot', dict(plannedHours='8', completedHours='3', targetHours='4',
                      progressHours='-1', progressVariance='-0.25', otjhStatus='Behind', currentModule='Module 0',
                      currentWeek='Week 1', componentsTargetToDate=3)),
                  persist_live_otjh_snapshot=spy('persist'),
                  retain_quiz_progress=spy('retained'),
                  _append_week_quizzes=spy('quizzes', lambda weeks, components, **kw: (weeks, components)),
                  measure_projection=lambda *a, **kw: nullcontext(SimpleNamespace(stage=lambda name: nullcontext())))
        package = ModuleType('_o05_learner'); package.__path__ = []
        self.modules = {'_o05_learner': package}
        for name, functions in {
            'teams_attendance': {'annotate_attendance_completion': spy('attendance', lambda components, profile: components)},
            'replacement_learning': {'annotate_replacement_learning': spy('replacement', lambda components, pk: components)},
            'live_session_progress': {'read_live_credits': spy('live_credits', []),
                'supplement_component_progress': spy('supplement', lambda progress, credits: progress)},
            'active_users': {'refresh_learner_ksb_snapshot': spy('refresh_ksb', False)},
        }.items():
            m = ModuleType('_o05_learner.' + name)
            m.__dict__.update(functions)
            self.modules[m.__name__] = m
        self.sql = []

        class Cursor:
            def __enter__(cursor):
                return cursor
            def __exit__(cursor, *args):
                return False
            def execute(cursor, sql, params):
                self.sql.append((sql, deepcopy(params)))
                if self.fail == 'reading':
                    raise support.DatabaseError('synthetic reading unavailable')
            def fetchone(cursor):
                requested, module_ids = self.sql[-1][1]
                return (requested, '<p>Synthetic lesson</p>') if requested == 'C0-0' and 'A' in module_ids else None

        ns.update(connections={'enrolment': SimpleNamespace(cursor=Cursor)},
                  visible_child_sql=lambda alias: f'{alias}.deleted_at IS NULL',
                  visible_week_sql=lambda alias: f'{alias}.deleted_at IS NULL')
        support.definitions(ROOT / 'learner_detail.py', ['_error', '_reading_content', '_authored_setting', 'build_learner_detail',
                            '_activity_module_components', '_annotate_otjh', '_apply_live_otjh_snapshot', 'learner_detail'], ns,
                            constants=('_AUTHORED_SETTING_KEYS',))
        if before:
            exec(compile(BEFORE, '<pre-O05-view>', 'exec'), ns)

    def only(self, *fields):
        self.pending_fields = fields
        return self

    def get(self, *, pk):
        fields = getattr(self, 'pending_fields', None)
        self.fields.append(fields)
        if self.source_error:
            raise self.source_error
        if pk not in self.assignment.directory.data:
            raise MissingSource()
        return roster.Record(self.assignment.directory.data[pk], self.assignment.directory, fields)

    def request(self, content=None, component='C0-0', kind='commercial', pk=1, method='GET'):
        query = {} if content is None else {'content': content}
        if component is not None:
            query['component_id'] = component
        request = SimpleNamespace(GET=query, method=method)
        with patch.dict(sys.modules, self.modules):
            return self.ns['learner_detail'](request, kind=kind, pk=pk)


class DetailTests(unittest.TestCase):
    def compare(self, content=None, setup=None, plan=None, same_io=True, **kwargs):
        old, new = Harness(True, plan), Harness(False, plan)
        if setup:
            setup(old); setup(new)
        def result(h):
            try:
                r = h.request(content, **kwargs)
                return r.status_code, r.content, dict(r)
            except (ServiceError, StopIteration) as exc:
                return type(exc), str(exc)
        a, b = result(old), result(new)
        if a[0] == 502 and json.loads(a[1]).get('error', '').startswith('Database error: '):
            # P04 intentionally sanitizes the error; status, headers and I/O stay identical.
            self.assertEqual(set(json.loads(a[1])), {'error'})
            a = (502, json.dumps({'error': 'The database service is temporarily unavailable.'}).encode(), a[2])
        self.assertEqual(a, b)
        if same_io:
            self.assertEqual(old.calls, new.calls)
        self.assertEqual(old.sql, new.sql)
        self.assertEqual(old.assignment.calls, new.assignment.calls)
        return old, new, b

    def test_baseline_reading_reader_calls_and_json(self):
        old, new, result = self.compare('reading', plan=[{'moduleId': 'A'}])
        self.assertEqual(result[:2], (200, b'{"componentId": "C0-0", "contentHtml": "<p>Synthetic lesson</p>"}'))
        self.assertEqual(old.fields, [None])
        self.assertEqual(len(old.sql), 1)
        self.assertEqual(old.calls, [])
        self.assertEqual(sum(c[0] == 'stored_plan' for c in old.assignment.calls), 1)
        self.assertEqual(set(new.fields[0]), {'id', 'programme', 'cohort', 'group', 'learning_plan',
                                              'training_plan', 'modules', 'weeks', 'components'})
        self.assertGreater(len(roster.FIELDS), len(new.fields[0]))
        self.assertEqual(len(new.fields[0]), 9)

    def test_empty_one_multiple_native_source_and_mixed_graphs_all_modes(self):
        for count in (0, 1, 3):
            for origin in ('native', 'source', 'mixed'):
                for mode in (None, 'summary', 'quiz', 'unknown'):
                    with self.subTest(count=count, origin=origin, mode=mode):
                        def setup(h):
                            h.data = graph(count, origin)
                        old, new, result = self.compare(
                            mode, setup, plan=[{'moduleId': 'A'}], same_io=mode != 'summary',
                        )
                        self.assertEqual(result[0], 200)
                        self.assertEqual(old.fields, new.fields)
                        data = json.loads(result[1])
                        self.assertEqual(data['ksbs'], graph()['ksbs'])
                        self.assertEqual(data['quizAttempts'], graph()['quizAttempts'])
                        self.assertEqual(data['componentProgress'], graph()['componentProgress'])

    def test_default_keeps_legacy_reconciliation_and_persistence(self):
        _, new, result = self.compare(None)
        names = [c[0] for c in new.calls]
        self.assertEqual(names[:2], ['advance', 'hydrate'])
        self.assertLess(names.index('snapshot'), names.index('persist'))
        self.assertLess(names.index('persist'), names.index('retained'))
        self.assertIn('attendance', names)
        data = json.loads(result[1])
        self.assertEqual(data['totalExpectedOtjh'], 8)
        self.assertEqual((data['plannedHours'], data['completedHours'], data['targetHours']), ('8', '3', '4'))

    def test_summary_is_read_only_and_keeps_live_hours_contract(self):
        _, new, result = self.compare('summary', same_io=False)
        names = [c[0] for c in new.calls]
        for name in ('advance', 'hydrate', 'persist', 'refresh_ksb'):
            self.assertNotIn(name, names)
        self.assertIn('snapshot', names)
        self.assertIn('attendance', names)
        self.assertEqual(next(c[2] for c in new.calls if c[0] == 'profile'), {'heal': False})
        data = json.loads(result[1])
        self.assertEqual(data['totalExpectedOtjh'], 8)
        self.assertEqual((data['plannedHours'], data['completedHours'], data['targetHours']), ('8', '3', '4'))

    def test_concurrent_summary_reads_have_identical_contract_and_no_write_calls(self):
        harness = Harness(False)

        def read_summary(_index):
            request = SimpleNamespace(GET={'content': 'summary'}, method='GET')
            return harness.ns['learner_detail'](request, kind='commercial', pk=1)

        with patch.dict(sys.modules, harness.modules):
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses = list(pool.map(read_summary, range(8)))

        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertTrue(all(response.content == responses[0].content for response in responses))
        calls = harness.calls
        for name in ('advance', 'hydrate', 'persist', 'refresh_ksb'):
            self.assertNotIn(name, [call[0] for call in calls])
        profile_calls = [call for call in calls if call[0] == 'profile']
        self.assertEqual(len(profile_calls), 8)
        self.assertTrue(all(call[2] == {'heal': False} for call in profile_calls))

    def test_quiz_activity_and_reading_keep_read_only_side_effect_boundaries(self):
        for mode in ('quiz', 'activity', 'reading'):
            _, new, result = self.compare(mode, plan=[{'moduleId': 'A'}])
            self.assertEqual(result[0], 200)
            names = [c[0] for c in new.calls]
            for name in ('advance', 'hydrate', 'persist', 'snapshot'):
                self.assertNotIn(name, names)
            if mode in ('quiz', 'activity'):
                self.assertEqual(next(c[2] for c in new.calls if c[0] == 'profile'), {'heal': False})

    def test_reading_assignment_variants_preserve_scope_and_title_only_fallback(self):
        plans = [None, [], [{'moduleId': 'A'}], [{'moduleId': 'A', 'assignmentMode': 'explicit'}],
                 [{'moduleId': 'MANUAL'}], [{'moduleId': 'A'}, {'moduleId': 'A'}, {'moduleId': 'B'}],
                 [{'moduleId': None, 'moduleTitle': 'Historical'}], '[{"moduleId":"A"}]']
        for kind in ('apprenticeship', 'commercial'):
            for plan in plans:
                with self.subTest(kind=kind, plan=plan):
                    _, _, result = self.compare('reading', plan=plan, kind=kind)
                    self.assertIn(result[0], (200, 404))
        def legacy(h):
            h.assignment.directory.data[1].update(modules='Old', weeks='Old · W', components='Old · W · C')
            h.assignment.groups = {}
        self.compare('reading', legacy)

    def test_reading_missing_component_and_unassigned_content(self):
        for component in (None, '', 'OTHER'):
            _, _, result = self.compare('reading', component=component, plan=[])
            self.assertEqual(result[0], 404)

    def test_training_plan_precedence_and_stable_group_identity(self):
        def setup(h):
            h.assignment.directory.data[1]['training_plan'] = []
        _, _, result = self.compare('reading', setup, plan=[{'moduleId': 'A'}])
        self.assertEqual(result[0], 404)
        def stable(h):
            h.assignment.profiles = {1: [('P', 'C', 'stable')]}
        _, _, result = self.compare('reading', stable)
        self.assertEqual(result[0], 404)

    def test_owner_staff_admin_denials_and_unreadable_session_precede_reads(self):
        for role, subject, status in [('learner', 2, 404), ('employer', 1, 403), (None, 1, 401),
                                      ('staff', 1, 200), ('admin', 1, 200)]:
            def setup(h):
                h.account = None if role is None else SimpleNamespace(role=role, subject_id=subject)
            for mode in ('reading', 'summary'):
                _, new, result = self.compare(
                    mode, setup, plan=[{'moduleId': 'A'}], same_io=mode != 'summary',
                )
                self.assertEqual(result[0], status)
                if status != 200:
                    self.assertEqual(new.fields, [])
                    self.assertEqual(new.sql, [])
        def unreadable(h):
            h.account = None; h.unreadable = True
        _, _, result = self.compare('reading', unreadable)
        self.assertEqual(result[0], 503)

    def test_missing_unavailable_source_and_wrong_method_or_kind(self):
        for error, status in [(MissingSource(), 404), (support.DatabaseError('synthetic source unavailable'), 502)]:
            for mode in ('reading', None):
                _, _, result = self.compare(mode, lambda h: setattr(h, 'source_error', error))
                self.assertEqual(result[0], status)
        for options, status in [({'method': 'POST'}, 405), ({'kind': 'unknown'}, 404)]:
            _, _, result = self.compare('reading', **options)
            self.assertEqual(result[0], status)

    def test_reading_and_graph_failures_keep_error_behavior(self):
        for name in ('reading', 'master', 'otjh_ids', 'attendance', 'live_credits'):
            mode = 'reading' if name == 'reading' else None
            _, _, result = self.compare(mode, lambda h: setattr(h, 'fail', name), plan=[{'moduleId': 'A'}])
            self.assertEqual(result[0], 502)

    def test_optional_snapshot_and_ksb_repair_failures_keep_success_behavior(self):
        _, _, result = self.compare(None, lambda h: setattr(h, 'fail', 'persist'))
        self.assertEqual(result[0], 200)
        def setup(h):
            h.profile.ksbs = []
            h.fail = 'refresh_ksb'
        _, new, result = self.compare(None, setup)
        self.assertEqual(result[0], 200)
        self.assertIn('refresh_ksb', [c[0] for c in new.calls])

    def test_missing_activity_keeps_existing_ownership_error(self):
        _, _, result = self.compare('activity', component='unknown')
        self.assertEqual(result[0], 404)

BEFORE = r'''
@learner_self_or_staff(kwarg="pk")
def learner_detail(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        # all_learners, not objects: the default manager is scoped to
        # apprenticeship rows, so a commercial learner would 404 here.
        source = model.all_learners.get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        if request.GET.get("content") == "reading":
            reading = _reading_content(source, request.GET.get("component_id"))
            if reading is None:
                return _error("Activity not found in this learner's plan.", 404)
            response = JsonResponse(reading)
            response['Cache-Control'] = 'private, no-store'
            return response
        if request.GET.get("content") == "activity":
            component_id = request.GET.get("component_id")
            if not component_id:
                return _error("An activity identity is required.", 400)
            detail = build_learner_detail(source, pk, compact=True, read_only=True,
                                          activity_component_id=component_id)
            component = next(c for c in detail['components'] if c.get('componentId') == component_id)
            if not component.get('contentHtml') and (component.get('hasReadingContent') or component.get('type') == 'reading'):
                reading = _reading_content(source, component_id)
                if reading is None:
                    return _error("Activity not found in this learner's plan.", 404)
                component['contentHtml'] = reading['contentHtml']
            response = JsonResponse(detail)
            response['Cache-Control'] = 'private, no-store'
            return response
        options = {"compact": True} if request.GET.get("content") == "summary" else {}
        if request.GET.get("content") == "quiz":
            options = {"compact": True, "read_only": True, "quiz_view": True}
        with measure_projection(
            'learner-detail', kind=kind, learner_id=pk,
            section=request.GET.get('content') or 'complete',
        ) as measurement:
            with measurement.stage('detail'):
                return JsonResponse(build_learner_detail(source, pk, **options))
    except ServiceError as exc:
        return _error(str(exc), exc.status)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
'''


if __name__ == '__main__':
    unittest.main(verbosity=2)
