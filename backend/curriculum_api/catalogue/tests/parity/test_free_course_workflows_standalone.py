"""Actual frozen/current workflow parity, with synthetic storage and no Django import.

Only import statements and HTTP decorators are excluded from the frozen AST.
All decisions, SQL, ORM calls, response/error mapping and transaction scopes run.
The isolated runtime suite separately verifies the current imports/decorators.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
from uuid import UUID

from curriculum_api.catalogue.application import free_course_quizzes as quizzes
from curriculum_api.catalogue.application import free_course_conversion as conversion
from curriculum_api.catalogue.application import free_course_import as importer
from curriculum_api.catalogue.application import free_course_structure_edits as edits
from curriculum_api.catalogue.domain import free_course_quizzes as quiz_policy
from curriculum_api.catalogue.domain import free_course_import as import_policy
from curriculum_api.catalogue.domain import free_course_structure_edits as edit_policy
from curriculum_api.catalogue.domain import free_course_authoring as authoring
from curriculum_api.catalogue.domain import values
from curriculum_api.legacy_free_course_migration import adopted_id, course_payload

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).resolve().parents[1] / 'fixtures/free_course_workflows_boundary.json'
FROZEN = json.loads(FIXTURE.read_text(encoding='utf-8'))
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)
REVISION = 'fcv1:' + 'a' * 64


class DatabaseError(Exception): pass
class IntegrityError(DatabaseError): pass
class Http404(Exception): pass
class WriterDisabled(Exception): pass


class Response:
    def __init__(self, data, status=200):
        self.status_code, self.data, self.headers = status, data, {}
        self.content = json.dumps(data).encode()
    def __setitem__(self, key, value): self.headers[key] = value


def reject(message, status=400, **details):
    return Response({'error': message, **details}, status)


def load_functions(text, namespace):
    tree = ast.parse(text)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    class BindImports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module in {'curriculum_api', 'curriculum_api.learning_storage'}:
                return ast.copy_location(ast.Pass(), node)
            return node
    for node in functions:
        node.decorator_list = []
        BindImports().visit(node)
    exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), '<actual-workflow-source>', 'exec'), namespace)
    return SimpleNamespace(**namespace)


def source(path): return (ROOT/path).read_text(encoding='utf-8-sig')


def plain(value):
    if isinstance(value, SimpleNamespace):
        return {key: plain(item) for key, item in vars(value).items() if not callable(item)}
    if isinstance(value, dict): return {key: plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)): return type(value)(plain(item) for item in value)
    return deepcopy(value)


class Transaction:
    def __init__(self, events): self.events, self.aborted = events, False
    @contextmanager
    def atomic(self):
        self.events.append(('begin',))
        try:
            yield
        except Exception:
            self.events.append(('rollback',)); raise
        else: self.events.append(('rollback' if self.aborted else 'commit',))
    def set_rollback(self, value): self.aborted = value; self.events.append(('mark-rollback', value))
    def on_commit(self, callback, **options): self.events.append(('on-commit', options))


def run_quiz(old, method, payload, *, history=0, published=False, links=(), owner='FW', exists=True, question_error=False, publication_error='', serialize_error=False):
    events = []
    tx = Transaction(events)
    quiz = SimpleNamespace(id=44, free_course_week_id=owner, week_id='', status='published' if published else 'draft', published_at=None)
    def record(name, result=None):
        def call(*a, **kw): events.append((name, plain(a), plain(kw))); return deepcopy(result)
        return call
    quiz.save = lambda: events.append(('save', quiz.status, getattr(quiz,'title',None)))
    quiz.refresh_from_db = lambda: events.append(('refresh',))
    class Manager:
        def select_for_update(self): events.append(('orm-lock',)); return self
        def get(self, **kw): events.append(('get', kw)); return quiz
        def create(self, **kw): events.append(('create', kw)); return quiz
        def filter(self, **kw): events.append(('filter', kw)); return self
        def prefetch_related(self, *args): events.append(('prefetch', args)); return []
        def count(self): events.append(('count',)); return 2
    manager = Manager()
    class Cursor:
        def __enter__(self): events.append(('cursor',)); return self
        def __exit__(self, *args): events.append(('cursor-close',))
        def execute(self, sql, params=()): self.sql=sql; events.append(('sql',sql,deepcopy(params)))
        def fetchone(self):
            if 'count(*)' in self.sql:return (history,)
            if 'select 1' in self.sql:return (1,) if exists else None
            settings={} if method=='POST' else {'linkedQuizId':'44','retained':True}
            return ('CP','quiz',settings,'FW','Week','Course') if exists else None
        def fetchall(self): return list(links)
    db=SimpleNamespace(cursor=Cursor)
    def questions(request, ident):
        events.append(('questions',ident,request._canonical_free_course_quiz))
        return Response({'question-result':True},400 if question_error else 200)
    def reply(data,status=200):
        events.append(('reply',status))
        if serialize_error:raise ValueError('Synthetic serialization failure')
        return Response(data,status)
    base=dict(json=json, connection=db, transaction=tx, timezone=SimpleNamespace(now=lambda:NOW),
        QuizPackage=SimpleNamespace(objects=manager,DoesNotExist=LookupError), QuizQuestion=SimpleNamespace(objects=manager),
        require_mode=record('mode'), CANONICAL='canonical', _catalogue_lock=record('catalogue-lock'),
        MutationError=authoring.MutationError,_check_revision=authoring._check_revision,_expected=authoring._expected,
        DatabaseError=DatabaseError,IntegrityError=IntegrityError,Http404=Http404,FreeCourseWriterDisabled=WriterDisabled,
        is_question_reference_violation=lambda exc:False, JsonResponse=reply,
        free_course_authoring=SimpleNamespace(course_document=record('document',{'revision':REVISION})),
        _quiz_questions_locked=questions,_quiz_preview_payload=record('preview',{'quiz':44}),
        _question_key_payload=lambda item:item,quiz_publication_error=lambda items:publication_error,
        owned_component=quiz_policy.owned_component,canonical_link_required=quiz_policy.canonical_link_required)
    if old: api=load_functions(FROZEN['catalogue/api/free_course_quiz_views.py'],base)
    else:
        storage=load_functions(source('catalogue/infrastructure/free_course_quizzes.py'),dict(base))
        api=load_functions(source('catalogue/api/free_course_quiz_views.py'),{**base,'storage':storage,'workflow':quizzes})
    request=SimpleNamespace(method=method,body=json.dumps(payload).encode())
    try:
        result=api.collection(request,'FC') if method=='POST' else api.detail(request,'FC',44)
        outcome=(result.status_code,result.data,result.headers)
    except Exception as exc:outcome=(type(exc).__name__,str(exc))
    return outcome,events



def run_conversion(old, *, mode='free_course', missing=False, group_mismatch=False,
                   archived=False, refused=False, clash=False, write_failure=False,
                   fallback=False, retry_tutor='Tutor', day_error=False):
    from curriculum_api.catalogue.domain import free_course_placement as placement, staff_identity
    from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
    events=[]; tx=Transaction(events)
    def record(name,result=None):
        def call(*a,**kw):
            events.append((name,plain(a),plain(kw)))
            if write_failure and name=='update-group': raise RuntimeError('Synthetic late failure')
            return deepcopy(result)
        return call
    stored={'title':'Keep','source_type':mode,'programme_id':'P','cohort_id':'H','group_id':'G','tutor_name':retry_tutor}
    programme={'programme_id':'P','name':'Programme','status':'archived' if archived else 'active'}
    cohort={'cohort_id':'H','programme_id':'P','cohort_name':'Cohort'}
    group={'group_id':'G','cohort_id':'WRONG' if group_mismatch else 'H','programme_id':'P','group_name':'Group','module_ids':['M','OTHER'],'module_names':['Keep','Other']}
    class Cursor:
        def __enter__(self):events.append(('cursor',));return self
        def __exit__(self,*args):events.append(('cursor-close',))
        def execute(self,sql,params=()):events.append(('sql',sql,plain(params)))
        def fetchall(self):return [('G',)]
    connection=SimpleNamespace(vendor='postgresql',cursor=Cursor)
    callbacks=dict(
        get_authoring_structure_payload=record('structure',stored),module_schedule_view=record('schedule',{'group_id':'G'}),
        tutor_assignment_delivery_day_error=lambda *a,**kw:Response({'code':'missing-day'},409) if day_error else None,
        tutor_schedule_conflicts_created=record('conflicts',[{'other':'OTHER'}] if clash else []),
        tutor_conflict_error=lambda *a:Response({'code':'clash'},409),
        check_structure_save=lambda *a:Response({'code':'reserved'},409) if refused else None,
        announce_saved=record('announce'), invalidate_curriculum_cache=record('invalidate'))
    bindings={name:getattr(conversion,name) for name in ('clean_str','module_cohort_date_error','parse_json_value','programme_config_identity','staff_assignment_key','staff_profile_email','staff_profile_is_archived','staff_profile_name','tutor_conflict_override_requested','unique')}
    bindings.update(is_archived_program_config=placement.is_archived_program_config,
        programme_status_is_archived=placement.programme_status_is_archived,
        is_blank_staff_assignment=staff_identity.is_blank_staff_assignment,
        curriculum_row_effectively_deleted=programme_deleted_row,
        get_program_config_rows=record('programmes',[programme]),resolve_cohort_row=record('cohort',cohort),resolve_group_row=record('group',group),
        authoring_module_exists=record('module',None if missing else stored),lock_module_structure_row=record('module-lock'),
        find_staff_profile_row=record('staff',{'name':'Tutor','email':'synthetic@example.invalid'}),
        update_authoring_rows=record('update-module'),update_group_fields=record('update-group'),
        log_curriculum_decision=record('audit'),json_db_value=lambda value:json.dumps(value),
        authoring_table_name=lambda table:'curriculum.groups',GROUPS_TABLE='groups',AUTHORING_MODULES_TABLE='modules',
        json_body=lambda request:json.loads(request.body),json_error=reject,**callbacks)
    request=SimpleNamespace(body=json.dumps({'programmeId':'P','cohortId':'H','groupId':'G','tutor':'Tutor'}).encode())
    native_convert=record('native-convert',not fallback)
    base=dict(v=SimpleNamespace(**bindings),connection=connection,transaction=tx,
        timezone=SimpleNamespace(now=lambda:NOW),versioning=SimpleNamespace(source=lambda label:__import__('contextlib').nullcontext()),
        JsonResponse=Response,logger=SimpleNamespace(exception=record('error-log')),convert_to_module=native_convert,
        check_structure_save=lambda req,*args:callbacks['check_structure_save'](*args),announce_saved=callbacks['announce_saved'])
    if old:api=load_functions(FROZEN['catalogue/api/free_course_conversion.py'],base)
    else:
        storage=load_functions(source('catalogue/infrastructure/free_course_conversion.py'),{**base,**bindings})
        # The adapter's lazy import is rebound explicitly by the loader; its
        # underlying native operation is the identical synthetic capability.
        storage.convert_to_module.__globals__['implementation']=native_convert
        api=load_functions(source('catalogue/api/free_course_conversion.py'),{**base,**bindings,'storage':storage,'workflow':conversion})
        api.convert_free_course.__globals__['check_structure_save']=base['check_structure_save']
    result=api.convert_free_course(request,'M')
    return (result.status_code,result.data),events


def run_import(old, *, existing=False, collision='', invalid=False, inactive=False,
               write_failure=False, disabled=False, schema_missing=False):
    from collections import defaultdict
    events = []
    tx = Transaction(events)
    export = {'courses': [{'id': 'FC', 'course_name': 'Course', 'cover_image_url': 'synthetic-cover'}],
              'week_links': [{'id': 'L', 'week_id': 'W', 'course_id': 'FC'}],
              'weeks': [{'id': 'W', 'free_course_id': 'FC', 'week_number': 1, 'title': 'Week',
                         'status': 'inactive' if inactive else 'active'}],
              'components': [{'id': 'C', 'free_module_id': 'L', 'week_id': 'W', 'type': 'reading'}]}
    def module_response(row, components, course):
        return {'id': row['id'], 'courseId': course['id'], 'weekNumber': row['week_number'],
                'title': row['week_title'], 'components': components}
    def record(name, result=None):
        def call(*args, **kwargs):
            events.append((name, plain(args), plain(kwargs)))
            if write_failure and name == 'save':
                raise ValueError('Synthetic content write failure')
            return deepcopy(result)
        return call
    def read(table, **kwargs):
        events.append(('read', table, kwargs))
        if table == 'courses': return [{'id': 'FC'}] if existing else []
        if table == 'modules' and collision == 'module':
            return [{'module_catalogue_id': adopted_id('MOD', 'FC', 'FC')}]
        return [{'id': 'C'}] if table == 'free_components' and collision == 'component' else []
    def require_mode(mode):
        events.append(('mode', mode))
        if disabled: raise WriterDisabled('Disabled')
    class Cursor:
        def __enter__(self): events.append(('cursor',)); return self
        def __exit__(self, *args): events.append(('cursor-close',))
        def execute(self, sql): events.append(('sql', sql))
    bindings = dict(FREE_COURSES_TABLE='courses', AUTHORING_MODULES_TABLE='modules',
        FREE_PROGRAMME_MODULES_TABLE='free_weeks', FREE_PROGRAMME_COMPONENTS_TABLE='free_components',
        AUTHORING_WEEKS_TABLE='weeks', AUTHORING_COMPONENTS_TABLE='components',
        free_programme_fetch_all=read, authoring_fetch_all=read,
        free_programme_module_response=module_response,
        validate_module_authoring_payload=record('validate', [{'message': 'Invalid'}] if invalid else []),
        free_programme_upsert=record('upsert'), update_authoring_rows=record('update'),
        authoring_soft_delete=record('archive'), save_module_authoring_structure=record('save'),
        get_authoring_structure_payload=record('structure', {'weekStructure': [] if inactive else
            [{'components': [{'type': 'reading', 'expectedOtjh': 2}]}]}),
        invalidate_curriculum_cache=record('invalidate'), has_column=record('column', not schema_missing),
        json_db_value=json.dumps, otjh_hours_from_minutes=importer.otjh_hours_from_minutes,
        component_expected_otjh_minutes=importer.component_expected_otjh_minutes)
    base = dict(v=SimpleNamespace(**bindings), connection=SimpleNamespace(vendor='postgresql', cursor=Cursor),
                transaction=tx, require_mode=require_mode, LEGACY='legacy', defaultdict=defaultdict,
                deepcopy=deepcopy, adopted_id=adopted_id, course_payload=course_payload)
    if old:
        entry = load_functions(FROZEN['catalogue/infrastructure/free_course_import.py'], base)
    else:
        storage = load_functions(source('catalogue/infrastructure/free_course_import_storage.py'), {**base, **bindings})
        entry = load_functions(source('catalogue/api/free_course_import.py'),
            {**bindings, 'storage': storage, 'policy': import_policy, 'use_cases': importer})
    try:
        outcome = entry.import_content(deepcopy(export))
    except Exception as exc:
        outcome = type(exc).__name__, str(exc)
    return outcome, events


def run_authoring(old, method, kind='structure', item_id=None, *, missing=False,
                  adopted=True, active=True, reserved=False, save_error=False):
    import copy
    events = []
    tx = Transaction(events)
    def record(name, result=None):
        def call(*args): events.append((name, plain(args))); return deepcopy(result)
        return call
    stored = {'title': 'Keep', 'structureRevision': 'revision', 'weekStructure': [
        {'id': 'W', 'title': 'Week', 'components': [{'id': 'C', 'title': 'Read', 'type': 'reading'}]}]}
    def save(request, **kwargs):
        events.append(('save-request', request.method, json.loads(request.body), request.META, kwargs))
        return Response({'saved': True}, 409 if save_error else 200)
    class Request:
        META = {'ORIGINAL': 'preserved'}
        @property
        def body(self): return self._body
    request = Request()
    request.method = method
    request._body = json.dumps({'title': 'Edited', 'expectedRevision': 'revision', 'weekId': 'W'}).encode()
    bindings = dict(json_body=lambda req: json.loads(req.body), json_error=reject,
        lock_module_structure_row=record('lock'), read_module_structure_with_revision=record('read', stored),
        collaboration_configuration=lambda req, ident: Response({'collaboration': ident}),
        refuse_stale_module_write=lambda req, data, ident: Response({'reserved': True},409) if reserved else None,
        requested_expected_revision=lambda req, data: data.get('expectedRevision'))
    namespace = dict(v=SimpleNamespace(**bindings), **bindings, edits=edits, transaction=tx,
        json=json, copy=copy, JsonResponse=Response, DatabaseError=DatabaseError,
        uuid4=lambda: UUID(int=1), logger=SimpleNamespace(exception=record('error-log')),
        _save_structure=save)
    original = FROZEN['catalogue/api/free_course_authoring.py']
    for node in ast.parse(original).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {'_metadata','_week_fields','_component_fields'} for t in node.targets):
            exec(compile(ast.Module(body=[node],type_ignores=[]),'<original-fields>','exec'),namespace)
    api = load_functions(original if old else source('catalogue/api/free_course_authoring.py'),namespace)
    api.authoring.__globals__['_course'] = lambda ident: None if missing else {'id': ident, **({'module_catalogue_id':'M'} if adopted else {})}
    api.authoring.__globals__['_active_module'] = lambda course: active
    from unittest.mock import patch
    with patch.object(edit_policy, 'uuid4', lambda: UUID(int=1)):
        result = api.authoring(request, 'FC', kind=kind, item_id=item_id)
    return (result.status_code, result.data, result.headers), events


class FreeCourseWorkflowParity(unittest.TestCase):

    def test_authoring_request_capabilities_and_existing_error_contracts(self):
        cases = [('GET', 'structure', None, {}), ('PATCH', 'structure', None, {}),
                 ('GET', 'collaboration', None, {}), ('GET', 'week', 'W', {}),
                 ('GET', 'component', 'C', {}), ('PATCH', 'component', 'C', {}),
                 ('DELETE', 'week', 'W', {}), ('POST', 'week', None, {}),
                 ('PATCH', 'structure', None, {'reserved': True}),
                 ('PATCH', 'structure', None, {'save_error': True}),
                 ('GET', 'structure', None, {'missing': True}),
                 ('GET', 'structure', None, {'adopted': False}),
                 ('GET', 'structure', None, {'active': False})]
        for method, kind, ident, options in cases:
            with self.subTest(method=method, kind=kind, options=options):
                self.assertEqual(run_authoring(False,method,kind,ident,**options),
                                 run_authoring(True,method,kind,ident,**options))

    def test_import_original_and_new_planning_write_order_gates_and_rollback(self):
        cases = [{}, {'existing': True}, {'collision': 'module'}, {'collision': 'component'},
                 {'invalid': True}, {'inactive': True}, {'write_failure': True},
                 {'disabled': True}, {'schema_missing': True}]
        for case in cases:
            with self.subTest(case=case):
                actual = run_import(False, **case)
                self.assertEqual(actual, run_import(True, **case))
                if not case or case.get('inactive'):
                    self.assertEqual(actual[0]['coursesToImport'], 1)
                if case.get('existing'):
                    self.assertEqual(actual[0]['existingCoursesPreserved'], 1)
                if case.get('write_failure'):
                    self.assertIn(('rollback',), actual[1])
                if case.get('collision') or case.get('invalid') or case.get('schema_missing'):
                    self.assertEqual(actual[0][0], 'ValueError')
                if case.get('collision') == 'module':
                    self.assertIn('module identity is already in use', actual[0][1])
                if case.get('collision') == 'component':
                    self.assertIn('identity is already owned', actual[0][1])
                if case.get('disabled'):
                    self.assertEqual(actual[0], ('WriterDisabled', 'Disabled'))

    def test_conversion_actual_original_and_new_decisions_lock_order_and_failure_paths(self):
        cases=[{}, {'fallback':True}, {'mode':'module_authoring'}, {'mode':'module_authoring','retry_tutor':'Other'},
               {'missing':True}, {'archived':True}, {'group_mismatch':True}, {'refused':True},
               {'clash':True}, {'day_error':True}, {'write_failure':True}]
        for case in cases:
            with self.subTest(case=case):
                actual=run_conversion(False,**case)
                self.assertEqual(actual,run_conversion(True,**case))
                if not case or case=={'fallback':True}:
                    self.assertEqual(actual[0][0],200)
                    self.assertTrue(actual[0][1]['converted'])
                if case.get('write_failure'):
                    self.assertEqual(actual[0][0],500)
                    self.assertIn(('rollback',),actual[1])

    def test_originals_are_frozen(self):
        self.assertEqual(sha256(FIXTURE.read_bytes()).hexdigest(),'4de37787ece838e7256c35d5e1c1ba849b018dd3ec7d60c3ed7040b92fc942ef')

    def test_quiz_actual_old_new_http_sql_and_transaction_traces(self):
        common={'expectedRevision':REVISION,'freeCourseWeekId':'FW','componentId':'CP'}
        scenarios=[('POST',{},{}),('POST',common,{}),('POST',{**common,'quizId':44},{}),
            ('POST',{**common,'quizId':44},{'owner':'OTHER'}),('POST',common,{'links':[(1,'OTHER','FW',None,None)]}),
            ('POST',common,{'links':[(1,'FC','FW',None,None),(2,'FC','FW',None,None)]}),
            ('POST',{**common,'title':'x'*256},{}),('POST',common,{'serialize_error':True}),
            ('GET',{},{}),('GET',{}, {'exists':False}),('GET',{}, {'owner':''}),
            ('DELETE',common,{}),('DELETE',common,{'history':2}),('PATCH',common,{'history':2,'published':True}),
            ('PATCH',{**common,'questions':[]},{'question_error':True}),('PATCH',{**common,'questions':[],'title':'Edit'},{}),
            ('PATCH',{**common,'title':''},{}),('PATCH',{**common,'duration':'bad'},{}),
            ('PATCH',{**common,'status':'published'},{}),('PATCH',{**common,'status':'published'},{'publication_error':'Missing answer'}),
            ('PATCH',{**common,'status':'invalid'},{}),('PATCH',{**common,'shortDescription':None,'duration':-2,'retakeAfterPass':False},{}),
            ('PATCH',{**common,'expectedRevision':'fcv1:'+'b'*64},{}),('PATCH',common,{'exists':False})]
        for method,payload,options in scenarios:
            with self.subTest(method=method,payload=payload,options=options):
                actual = run_quiz(False,method,payload,**options)
                self.assertEqual(actual,run_quiz(True,method,payload,**options))
                if options.get('serialize_error'):
                    self.assertEqual(actual[0], ('ValueError', 'Synthetic serialization failure'))
                    self.assertEqual(actual[1][-1], ('rollback',))
                else:
                    self.assertIsInstance(actual[0][0], int)

    def test_structure_delta_preserves_unknown_fields_settings_and_order(self):
        namespace={'uuid4':lambda:UUID(int=1)}
        old_source=FROZEN['catalogue/api/free_course_authoring.py']
        for node in ast.parse(old_source).body:
            if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in {'_metadata','_week_fields','_component_fields'} for t in node.targets):
                exec(compile(ast.Module(body=[node],type_ignores=[]),'<original-fields>','exec'),namespace)
        old=load_functions(old_source,namespace)
        stored={'title':'Keep','weekStructure':[{'id':'W','title':'Week','components':[{'id':'C','type':'reading','title':'Read','settings':{'a':1,'b':2}}]}]}
        from unittest.mock import patch
        for kind,item,payload,method in [('component','C',{'settings':{'a':3}},'PATCH'),('week','W',{'title':'Edit'},'PATCH'),('week','W',{},'DELETE'),('component','C',{},'DELETE'),('week',None,{'title':'New'},'POST'),('component',None,{'title':'New','type':'reading','weekId':'W'},'POST'),('component','X',{},'PATCH'),('week','W',{'unsupported':1},'PATCH')]:
            with self.subTest(kind=kind,method=method),patch.object(edit_policy,'uuid4',lambda:UUID(int=1)):
                def outcome(call):
                    try:return call(deepcopy(stored),kind,item,deepcopy(payload),method)
                    except Exception as exc:return type(exc).__name__,str(exc)
                self.assertEqual(outcome(edit_policy._delta),outcome(old._delta))

    def test_application_and_domain_have_no_runtime_infrastructure_imports(self):
        for layer in ('application','domain'):
            for name in ('free_course_quizzes','free_course_import','free_course_structure_edits','free_course_conversion','free_course_placement'):
                path=ROOT/'catalogue'/layer/(name+'.py')
                if not path.exists():continue
                for node in ast.walk(ast.parse(path.read_text())):
                    if isinstance(node,ast.ImportFrom):
                        self.assertNotIn('infrastructure',node.module or '')
                        self.assertFalse((node.module or '').startswith(('django','psycopg')))
                        self.assertNotIn('api', (node.module or '').split('.'))
                    elif isinstance(node,ast.Import):
                        self.assertTrue(all(a.name.split('.')[0] not in {'django','psycopg','requests','redis'} for a in node.names))

    def test_import_payload_validation_uses_original_source(self):
        def module_response(row,components,course):
            return {'id':row['id'],'courseId':course['id'],'weekNumber':row['week_number'],'title':row['week_title'],'components':[
                {'id':c['id'],'type':c['type'],'settings':c.get('settings_json',{})} for c in components]}
        v=SimpleNamespace(free_programme_module_response=module_response)
        old=load_functions(FROZEN['catalogue/infrastructure/free_course_import.py'],dict(v=v,defaultdict=__import__('collections').defaultdict,adopted_id=adopted_id,course_payload=course_payload))
        export={'courses':[{'id':'FC','course_name':'Course'}], 'week_links':[{'id':'L','week_id':'W','course_id':'FC'}], 'weeks':[{'id':'W','free_course_id':'FC','week_number':1,'title':'Week'}], 'components':[{'id':'C','free_module_id':'L','week_id':'W','type':'reading','settings_json':{}}]}
        cases=[export, {**export,'courses':export['courses']*2}, {**export,'components':[{**export['components'][0],'week_id':'OTHER'}]}, {**export,'weeks':[]}, {**export,'courses':[]}]
        for data in cases:
            with self.subTest(data=data):
                def outcome(call):
                    try:return call(deepcopy(data))
                    except Exception as exc:return type(exc).__name__,str(exc)
                self.assertEqual(outcome(lambda e:import_policy.import_payloads(e,free_programme_module_response=module_response)),outcome(old.import_payloads))


if __name__=='__main__':unittest.main()
