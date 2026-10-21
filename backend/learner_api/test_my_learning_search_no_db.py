"""O02 source-only comparisons; no Django startup, DB, settings or network.

Run: python -B backend/learner_api/test_my_learning_search_no_db.py
The frozen pre-O02 view and current source share the real search assembler and
permission functions. ORM/context/SQL/HTTP middleware are explicit doubles;
these checks do not establish physical SQL or real HTTP integration behavior.
"""
from collections import Counter, defaultdict
from copy import deepcopy
from contextlib import nullcontext
from datetime import datetime
import functools
import json
from pathlib import Path
import re
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

if __package__:
    from .test_legacy_assignment_list_no_db import (
        DatabaseError, Response, definitions, forbidden, guard,
    )
else:
    from test_legacy_assignment_list_no_db import (
        DatabaseError, Response, definitions, forbidden, guard,
    )

if __name__ == '__main__':
    sys.addaudithook(guard)

ROOT = Path(__file__).resolve().parent
# Captured from the working tree before the O02 edit; inserted below.
BASELINE_VIEW = """@require_GET
@local_catalogue_trace
@learner_self_or_staff(kwarg='pk')
@learner_journal_view
def my_learning(request,kind,pk,subject_id=None,resource=None):
    model=SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error':'Learner not found.'},status=404)
    try:
        with projection_stage('source'):
            source=model.all_learners.only(*SOURCE_FIELDS).get(pk=pk)
        with projection_stage('owner'):
            owner=canonical.require_profile(pk)
        if resource == 'search':
            term = request.GET.get('q','').strip()
            try:
                offset = int(request.GET.get('offset',0))
            except ValueError:
                return JsonResponse({'error':'Invalid search offset.'},status=400)
            if len(term)>200 or offset<0:
                return JsonResponse({'error':'Invalid search.'},status=400)
            payload = read_search(source,owner,term,offset) if term else dict(matches=[],nextOffset=None)
        elif resource == 'upcoming':
            payload = read_catalogue(source,kind,owner,upcoming_only=True)
        else:
            payload=read_module(source,kind,owner,subject_id) if subject_id is not None else read_catalogue(source,kind,owner)
    except model.DoesNotExist:
        return JsonResponse({'error':'Learner not found.'},status=404)
    except ServiceError as error:
        return JsonResponse({'error':str(error)},status=error.status)
    except DatabaseError:
        return JsonResponse({'error':'Could not load your learning. Please try again.'},status=503)
    with projection_stage('serialize'):
        response=JsonResponse(payload)
    response['Cache-Control']='private, no-store'
    return response
"""


class ServiceError(Exception):
    def __init__(self, message, code=None, status=400):
        super().__init__(message)
        self.status = status


class SearchProjectionTests(unittest.TestCase):
    def setUp(self):
        self.account = SimpleNamespace(role='learner', subject_id=501)
        self.unreadable = False
        self.missing = type('Missing', (Exception,), {})
        self.source_error = None
        self.owner_error = None
        self.fields = []
        self.events = []
        self.owner = {'id': 601, 'enrolment_id': 501}

        def only(*fields):
            self.fields.append(fields)
            return SimpleNamespace(get=get)

        def get(**kwargs):
            self.events.append(('source', kwargs))
            if self.source_error:
                raise self.source_error
            # No lazy/deferred ORM fallback is available in the harness.
            return SimpleNamespace(pk=501, id=501)

        def owner(pk):
            self.events.append(('owner', pk))
            if self.owner_error:
                raise self.owner_error
            return self.owner

        self.model = SimpleNamespace(DoesNotExist=self.missing,
                                     all_learners=SimpleNamespace(only=only))
        self.context = self.make_context()
        self.load = Mock(side_effect=lambda *args, **kwargs: deepcopy(self.context))
        self.query = Mock(return_value=[])
        self.canonical = SimpleNamespace(require_profile=owner, query=self.query)
        decoded = definitions(ROOT / 'monthly_log_sources.py', {'decoded'}, {'json': json})
        self.canonical.decoded = decoded['decoded']
        rules = definitions(ROOT / 'canonical_learning.py', {'learner_course_catalogue'},
                            {'decoded': self.canonical.decoded, 're': re, 'ServiceError': ServiceError})
        self.canonical.learner_course_catalogue = rules['learner_course_catalogue']

        permissions = definitions(ROOT.parent / 'login' / 'permissions.py',
                                  {'_unauthenticated', '_unavailable', '_read_only_learner_view',
                                   '_target_learner_id', '_error_bad_target',
                                   '_learner_progress_gate', 'learner_self_or_staff'},
                                  {'functools': functools, 'JsonResponse': Response,
                                   '_auth_gate_enabled': lambda: True,
                                   'authenticate_request': lambda request: self.account,
                                   'session_unreadable': lambda request: self.unreadable})

        replacement = ModuleType('learner_api.replacement_learning')
        definitions(ROOT / 'replacement_learning.py',
                    {'_object', 'project_replacement_learning', 'project_approved_learning'},
                    replacement.__dict__)
        replacement.json, replacement.Counter = json, Counter
        package = ModuleType('learner_api')
        package.__path__ = []
        modules = {'learner_api': package, 'learner_api.replacement_learning': replacement}
        # Search must not use catalogue hours, completion, display placement or
        # demo credit reducers; the real shared assembler's search branch skips them.
        for name, functions in {
            'progress_transfer_policy': ('credited_percent',),
            'progress_demo': ('credit',),
            'training_plan_dashboard': ('_canonical_module_progress', 'module_record_index'),
            'live_session_progress': ('supplement_module_hours',),
            'course_catalogue_display': ('catalogue_display_context', 'read_export_placements',
                                         'display_schedule'),
        }.items():
            module = ModuleType('learner_api.' + name)
            for function in functions:
                setattr(module, function, forbidden)
            modules[module.__name__] = module
        patched = patch.dict(sys.modules, modules)
        patched.start()
        self.addCleanup(patched.stop)

        def require_get(view):
            @functools.wraps(view)
            def wrapped(request, *args, **kwargs):
                return (view(request, *args, **kwargs) if request.method == 'GET'
                        else Response({'error': 'Method not allowed'}, status=405))
            return wrapped

        scope = {'__package__': 'learner_api', 'Counter': Counter, 'defaultdict': defaultdict,
                 'datetime': datetime, 'UK': ZoneInfo('Europe/London'),
                 'canonical': self.canonical, 'load_context': self.load,
                 'projection_stage': lambda *args, **kwargs: nullcontext(),
                 'JsonResponse': Response, 'DatabaseError': DatabaseError,
                 'ServiceError': ServiceError,
                 'SOURCE_MODELS': {'commercial': self.model, 'apprenticeship': self.model},
                 'require_GET': require_get, 'local_catalogue_trace': lambda view: view,
                 'learner_journal_view': lambda view: view,
                 'learner_self_or_staff': permissions['learner_self_or_staff'],
                 'read_catalogue': Mock(return_value={'catalogue': 'unchanged'}),
                 'read_module': Mock(return_value={'selected': 'unchanged'})}
        self.scope = definitions(ROOT / 'my_learning.py',
                                 {'assemble_cards', 'read_search', 'my_learning'}, scope,
                                 constants=('SOURCE_FIELDS',))
        self.current = self.scope['my_learning']
        baseline = dict(self.scope)
        exec(compile(BASELINE_VIEW, '<frozen pre-O02 my_learning>', 'exec'), baseline)
        self.before = baseline['my_learning']

    def make_context(self, count=2):
        components = [{'moduleId': f'M{i}', 'module': 'Same title',
                       'componentId': f'C{i}', 'component': 'Needle lesson'} for i in range(count)]
        native = {'modules': [], 'components': components, 'retiredQuizComponents': [],
                  'quizAttempts': [], 'componentProgress': []}
        metadata = {'current_subjects': [], 'imported_courses': {}, 'replacement_courses': {},
                    'replacement_settings': {}, 'modules': {}, 'progress_transfers': []}
        return ([], [], [], native, [], [], set(), set(), defaultdict(float), metadata, [])

    def request(self, **params):
        return SimpleNamespace(method='GET', GET=params)

    def call(self, view, params=None, kind='commercial', resource='search', subject_id=None):
        return view(self.request(**(params or {})), kind=kind, pk=501,
                    resource=resource, subject_id=subject_id)

    def equal(self, params=None, **kwargs):
        before = self.call(self.before, params, **kwargs)
        after = self.call(self.current, params, **kwargs)
        self.assertEqual(after.status_code, before.status_code)
        self.assertEqual(after.content, before.content)
        self.assertEqual(dict(after), dict(before))
        return after

    def test_empty_and_whitespace_queries_use_id_only_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            for params in ({}, {'q': ''}, {'q': ' \t\n'}, {'q': '\u2003'}):
                with self.subTest(kind=kind, params=params):
                    response = self.equal(params, kind=kind)
                    self.assertEqual(json.loads(response.content), {'matches': [], 'nextOffset': None})
                    self.assertEqual(self.fields[-2], self.scope['SOURCE_FIELDS'])
                    self.assertEqual(self.fields[-1], ('id',))
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.load.assert_not_called()
        self.query.assert_not_called()

    def test_empty_search_retains_source_and_owner_checks_in_order(self):
        self.equal({'q': ''})
        self.assertEqual(self.events, [('source', {'pk': 501}), ('owner', 501)] * 2)

    def test_missing_source_still_precedes_offset_validation(self):
        self.source_error = self.missing()
        self.assertEqual(self.equal({'q': '', 'offset': 'bad'}).status_code, 404)
        self.assertFalse(any(event[0] == 'owner' for event in self.events))

    def test_identity_conflict_still_precedes_empty_or_invalid_search(self):
        self.owner_error = ServiceError('Identity needs review', status=409)
        for params in ({'q': ''}, {'q': '', 'offset': '-1'}, {'q': 'x' * 201}):
            self.assertEqual(self.equal(params).status_code, 409)
        self.load.assert_not_called()

    def test_source_database_failure_preserves_response(self):
        self.source_error = DatabaseError('synthetic failure')
        self.assertEqual(self.equal({'q': ''}).status_code, 503)
        self.load.assert_not_called()

    def test_long_queries_and_invalid_offsets_preserve_validation(self):
        for params in ({'q': 'x' * 201}, {'q': 'needle', 'offset': '-1'},
                       {'q': 'needle', 'offset': 'bad'}, {'q': '', 'offset': 'bad'},
                       {'q': '', 'offset': '-1'}):
            with self.subTest(params=params):
                self.assertEqual(self.equal(params).status_code, 400)
        self.load.assert_not_called()
        self.query.assert_not_called()

    def test_nonempty_search_keeps_full_source_fields_and_graph(self):
        response = self.equal({'q': '  Needle  '}, kind='apprenticeship')
        self.assertEqual(json.loads(response.content), {
            'matches': [{'id': 'current:M0'}, {'id': 'current:M1'}], 'nextOffset': None})
        self.assertEqual(self.fields, [self.scope['SOURCE_FIELDS']] * 2)
        self.assertEqual(self.load.call_count, 2)
        for call in self.load.call_args_list:
            self.assertEqual(call.kwargs, {'purpose': 'search'})
            self.assertEqual(call.args[1], self.owner)

    def test_200_character_query_is_accepted(self):
        self.assertEqual(self.equal({'q': 'x' * 200}).status_code, 200)
        self.assertEqual(self.load.call_count, 2)

    def test_order_duplicates_retained_quizzes_and_unlinked_subjects(self):
        self.context[3]['components'].extend([
            {'moduleId': 'M1', 'module': 'Same title', 'componentId': 'C0', 'component': 'Needle duplicate'},
            {'module': 'Orphan', 'component': 'Needle orphan', 'week': 'Week 1'},
        ])
        self.context[3]['retiredQuizComponents'] = [
            {'moduleId': 'R', 'module': 'Retired', 'component': 'Needle quiz', 'quizMeta': {'quizId': 7}}]
        self.context[3]['modules'] = ['same title', 'Empty', 'Orphan']
        response = self.equal({'q': 'needle'})
        self.assertEqual([m['id'] for m in json.loads(response.content)['matches']],
                         ['unlinked:Orphan', 'current:R', 'current:M0', 'current:M1'])

    def test_source_demo_exclusions_and_replacement_transfer_eligibility(self):
        courses = self.context[4]
        courses.extend([{'id': 31, 'source_course_ref': '50', 'source_course_title': 'Old',
                         'verified_catalogue_scope': {'version': 1,
                          'basis': 'verified-legacy-account-inventory', 'course_ref': '50',
                          'excluded_activity_refs': ['material:8']}},
                        {'id': 32, 'source_course_ref': '51', 'source_course_title': 'Demo',
                         'demo_progress': {'excluded_activity_refs': ['quiz:9']}}])
        metadata = self.context[9]
        metadata['replacement_courses'] = {'current:M0': 'legacy:50'}
        self.query.return_value = [{'source_course_ref': '50'}, {'source_course_ref': '51'}]
        response = self.equal({'q': 'needle'})
        self.assertEqual([m['id'] for m in json.loads(response.content)['matches']],
                         ['legacy:51', 'legacy:50', 'current:M1'])
        sql, params = self.query.call_args.args
        self.assertEqual(params, [[31, 32], 'needle', ['50:material:8', '51:quiz:9']])
        self.assertIn('a.source_course_id=ANY(%s)', sql)
        self.assertIn('a.deleted_at IS NULL AND c.deleted_at IS NULL', sql)
        self.assertIn('ORDER BY c.source_course_ref', sql)
        metadata['progress_transfers'] = [{'moduleId': 'M0', 'courseRef': 'legacy:50',
                                         'status': 'approved'}]
        response = self.equal({'q': 'needle'})
        self.assertEqual([m['id'] for m in json.loads(response.content)['matches']],
                         ['legacy:51', 'current:M0', 'current:M1'])

    def test_invalid_verified_scope_still_fails_before_search_sql(self):
        self.context[4].append({'id': 31, 'source_course_ref': '50',
                                'verified_catalogue_scope': {'version': 99}})
        self.assertEqual(self.equal({'q': 'needle'}).status_code, 409)
        self.query.assert_not_called()

    def test_offset_boundaries_and_next_offset_match(self):
        self.context = self.make_context(103)
        for offset, length, next_offset in [(0, 50, 50), (49, 50, 99), (50, 50, 100),
                                             (100, 3, None), (103, 0, None), (1000, 0, None)]:
            with self.subTest(offset=offset):
                payload = json.loads(self.equal({'q': 'needle', 'offset': str(offset)}).content)
                self.assertEqual(len(payload['matches']), length)
                self.assertEqual(payload['nextOffset'], next_offset)

    def test_owner_access_and_other_learner_denial_for_both_kinds(self):
        self.account = SimpleNamespace(role='learner', subject_id=502)
        for kind in ('commercial', 'apprenticeship'):
            for q in ('', 'needle'):
                self.assertEqual(self.equal({'q': q}, kind=kind).status_code, 404)
        self.assertEqual(self.fields, [])
        self.assertEqual(self.events, [])
        self.load.assert_not_called()

    def test_signed_out_unreadable_and_employer_access_restrictions(self):
        for account, unreadable, status in [(None, False, 401), (None, True, 503),
                                            (SimpleNamespace(role='employer', subject_id=501), False, 403)]:
            self.account, self.unreadable = account, unreadable
            for q in ('', 'needle'):
                self.assertEqual(self.equal({'q': q}).status_code, status)
        self.assertEqual(self.fields, [])
        self.assertEqual(self.events, [])

    def test_staff_admin_and_unknown_kind_behavior(self):
        for role in ('staff', 'admin'):
            self.account = SimpleNamespace(role=role, subject_id=999)
            self.assertEqual(self.equal({'q': ''}).status_code, 200)
            self.assertEqual(self.equal({'q': 'needle'}).status_code, 200)
        self.fields.clear()
        self.assertEqual(self.equal({'q': ''}, kind='unknown').status_code, 404)
        self.assertEqual(self.fields, [])

    def test_catalogue_upcoming_and_selected_endpoints_keep_full_source_projection(self):
        for resource, subject in [(None, None), ('upcoming', None), (None, 'current:M0')]:
            self.equal({'q': ''}, resource=resource, subject_id=subject)
        self.assertEqual(self.fields, [self.scope['SOURCE_FIELDS']] * 6)
        self.load.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
