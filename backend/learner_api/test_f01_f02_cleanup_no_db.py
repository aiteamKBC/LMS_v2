"""F01/F02 final integration: real source bodies with strictly intercepted I/O.

Run: python -B backend/learner_api/test_f01_f02_cleanup_no_db.py
No Django startup, database settings, alternative database or live HTTP.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import functools
import json
import logging
from pathlib import Path
import re
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


def load(source, scope, names=None):
    """Bind real definitions; replace only the local connection import seam."""
    tree = ast.parse(source)
    class ConnectionImport(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module == 'django.db' and [a.name for a in node.names] == ['connection']:
                return ast.copy_location(ast.Pass(), node)
            return node
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef, ast.Assign))
             and (names is None or isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names
                  or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets))]
    module = ConnectionImport().visit(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(ast.fix_missing_locations(module), '<guarded-document-source>', 'exec'), scope)
    return scope


def source(relative):
    return (ROOT / relative).read_text(encoding='utf-8-sig')


NOW = datetime(2026, 10, 21, 12, tzinfo=timezone.utc)


class Harness:
    def __init__(self, before=False, role='learner', grants=('enrolment',), kind='apprenticeship'):
        self.events = []
        self.fail = None
        self.before = before
        self.gate_enabled = True
        self.linked = True
        self.grants = set(grants)
        self.account = (None if role is None else SimpleNamespace(role=role, subject_type='staff' if role in
                        {'staff', 'admin'} else role, subject_id=1, is_active=True))
        self.user = None
        self.learner = SimpleNamespace(pk=1, id=1, learner_type=kind, username='Synthetic learner',
            programme='Programme', cohort='C', group='G', reference_number='SYNTHETIC',
            employer='', line_manager='', learning_provider='', email='synthetic@example.invalid',
            phone_number='', address_line_1='', address_line_2='', address_line_3='', address='',
            current_postcode='', programme_status='Onboarding')
        self.plan = [{'moduleId': 'M1'}]
        self.catalogue = [dict(moduleId='M1', moduleTitle='One', hours=4, groupName='G'),
                          dict(moduleId='M2', moduleTitle='Two', hours=2, groupName='G')]
        self.modules = {}
        self.documents = []
        harness = self

        class Document:
            STATUS_ACTIVE, STATUS_SUPERSEDED = 'active', 'superseded'
            def __init__(doc, **values):
                doc.__dict__.update(dict(id='D1', learner_id=1, learner_kind=kind, status='active',
                    fully_signed=False, created_at=NOW, updated_at=NOW, programme={'frozen': True},
                    employment={}, learning_plan=[], otjh={}, epa={}, contacts={}))
                for party in ('apprentice', 'employer', 'provider'):
                    for suffix, value in [('signature', ''), ('signed_name', ''), ('position', ''), ('signed_at', None)]:
                        setattr(doc, f'{party}_{suffix}', value)
                doc.__dict__.update(deepcopy(values))
            def recalculate_signed(doc):
                doc.fully_signed = all(getattr(doc, f'{p}_signature') for p in ('apprentice', 'employer', 'provider'))
                harness.events.append(('recalculate', doc.id))
            def save(doc, **kwargs):
                harness.hit('save', doc.id, kwargs)
                doc.updated_at = NOW

        self.Document = Document
        self.documents.append(Document())

        class DocumentQuery:
            def __init__(query, where):
                query.where = where
            def select_for_update(query):
                harness.events.append(('lock',))
                return query
            def first(query):
                harness.hit('active', query.where)
                return next((d for d in harness.documents if all(getattr(d, k) == v for k, v in query.where.items())), None)

        def create(**values):
            self.hit('create', values)
            doc = Document(id=f'D{len(self.documents) + 1}', **values)
            self.documents.append(doc)
            return doc

        Document.objects = SimpleNamespace(filter=lambda **where: DocumentQuery(where), create=create)

        @contextmanager
        def atomic(*, using):
            self.events.append(('atomic', using))
            original = deepcopy(self.documents)
            try:
                yield
            except Exception:
                self.documents = original
                self.events.append(('rollback',))
                raise
            else:
                self.events.append(('commit',))

        def learner_filter(**where):
            self.hit('learner', where)
            return SimpleNamespace(first=lambda: self.learner if where['pk'] == 1 else None)

        def employs(account, learner_id):
            self.hit('employer_link', learner_id)
            return self.linked and learner_id == 1

        def accesses(account):
            self.hit('staff_grants', account.subject_id)
            return self.grants

        auth = self.auth = SimpleNamespace()
        auth_scope = dict(functools=functools, JsonResponse=support.Response,
                          _accesses_of=accesses, _employs=employs,
                          auth_required=lambda: self.gate_enabled)
        load((ROOT.parent / 'enrolment_api' / 'auth.py').read_text(encoding='utf-8-sig'), auth_scope,
             {'is_authenticated', '_requested_learner_id', '_may_access', 'enrolment_login_required',
              'employer_signing_party_error', 'STAFF_ROLES', 'LEARNER_ID_KWARGS', 'UNSCOPED_VIEWS', 'EMPLOYER_LEARNER_VIEWS'})
        auth.__dict__.update(auth_scope)
        constants = ModuleType('learner_api.constants')
        constants.ACCESS_ENROLMENT, constants.ACCESS_SUPER_ADMIN = 'enrolment', 'super-admin'
        learner_package = ModuleType('learner_api'); learner_package.__path__ = []
        enrolment_package = ModuleType('enrolment_api'); enrolment_package.__path__ = []
        ilr = ModuleType('enrolment_api.models')
        ilr.ExtendedIlr = SimpleNamespace(objects=SimpleNamespace(filter=lambda **where:
            SimpleNamespace(first=lambda: SimpleNamespace(answers={'employer': {'organisationName': 'Synthetic employer'}}))))
        self.modules.update({'learner_api': learner_package, 'learner_api.constants': constants,
                             'enrolment_api': enrolment_package, 'enrolment_api.models': ilr})

        class Cursor:
            def __enter__(cursor):
                return cursor
            def __exit__(cursor, *args):
                return False
            def execute(cursor, sql, params):
                self.hit('sql', sql, params)
            def fetchall(cursor):
                return [('M1', 1, 'Week 1', 'C1', 'reading', 'Lesson', 2, 0),
                        ('M1', 2, '', None, None, None, None, 0)]

        base = dict(json=json, logging=logging, functools=functools, JsonResponse=support.Response,
                    DatabaseError=support.DatabaseError, transaction=SimpleNamespace(atomic=atomic),
                    timezone=SimpleNamespace(now=lambda: NOW), logger=Mock(spec=logging.Logger),
                    EnrolmentUser=SimpleNamespace(all_learners=SimpleNamespace(filter=learner_filter)),
                    TrainingPlanDocument=Document, csrf_exempt=lambda f: f,
                    enrolment_login_required=auth.enrolment_login_required,
                    employer_signing_party_error=auth.employer_signing_party_error,
                    connection=SimpleNamespace(cursor=Cursor),
                    visible_child_sql=lambda alias: f'{alias}.deleted_at IS NULL',
                    visible_week_sql=lambda alias: f'{alias}.deleted_at IS NULL',
                    _saved_modules=lambda learner: self.plan,
                    learner_programme_modules=lambda learner: self.catalogue,
                    learner_group_module_ids=lambda learner: ['M1'],
                    _group_dates=lambda learner: (NOW.date(), NOW.date(), 'group'),
                    _weeks_between=lambda start, end: 0, _employer_address=lambda learner: '',
                    advance_learner=lambda learner: self.hit('advance', learner.pk))
        load(source('mappers.py'), base, {'_s'})
        if before:
            self.ns = load(ORIGINAL, base)
        else:
            serialized = load(source('serializers/training_plan_documents.py'), dict(base))
            selected = load(source('selectors/training_plan_documents.py'), dict(serialized))
            service = load(source('services/training_plan_documents.py'), dict(selected))
            policy = load(source('training_plan_document_permissions.py'), dict(base, auth=auth))
            self.ns = load(source('training_plan_document.py'), dict(service, **{
                'document_mutation_required': policy['document_mutation_required'],
                'document_party_error': policy['document_party_error']}))

    def hit(self, name, *args):
        self.events.append((name, deepcopy(args)))
        if self.fail == name:
            raise support.DatabaseError('synthetic unavailable')
        return None

    def request(self, endpoint='sign_training_plan', party='apprentice', mark='data:image/png;base64,synthetic',
                body=None, method=None, pk=1):
        request = SimpleNamespace(method=method or ('GET' if endpoint == 'training_plan_document' else 'POST'),
            login_account=self.account, user=self.user,
            body=(json.dumps({'party': party, 'signature': mark, 'name': 'Synthetic signer', 'position': 'Role'}).encode()
                  if body is None else body))
        with patch.dict(sys.modules, self.modules):
            return self.ns[endpoint](request, pk=pk)


class DocumentIntegrationTests(unittest.TestCase):
    def compare(self, role='learner', setup=None, **request):
        old, new = Harness(True, role=role), Harness(False, role=role)
        if setup:
            setup(old); setup(new)
        left, right = old.request(**request), new.request(**request)
        expected = left.content
        legacy = json.loads(expected)
        if left.status_code == 502 and str(legacy.get('error', '')).startswith('Database error: '):
            # Approved P04 correction: freeze every other field/status/trace as before.
            self.assertEqual(set(legacy), {'error'})
            expected = json.dumps({'error': 'The database service is temporarily unavailable.'}).encode()
        self.assertEqual((left.status_code, expected), (right.status_code, right.content))
        self.assertEqual(old.events, new.events)
        self.assertEqual([vars(d) for d in old.documents], [vars(d) for d in new.documents])
        return new, right

    def test_allowed_signature_json_and_side_effect_parity_for_every_party_and_kind(self):
        for role, party in [('learner', 'apprentice'), ('employer', 'employer'), ('staff', 'provider'), ('admin', 'provider')]:
            for kind in ('apprenticeship', 'commercial'):
                def setup(h):
                    h.learner.learner_type = kind
                    h.documents[0].learner_kind = kind
                with self.subTest(role=role, kind=kind):
                    h, response = self.compare(role, setup, party=party)
                    self.assertEqual(response.status_code, 200)
                    data = json.loads(response.content)
                    self.assertTrue(data['document']['signatures'][party]['signed'])
                    self.assertEqual(data['document']['programme'], {'frozen': True})
                    events = [e[0] for e in h.events]
                    self.assertLess(events.index('commit'), events.index('advance'))

    def test_withdrawal_preserves_other_signatures_frozen_content_and_null_timestamp(self):
        def setup(h):
            h.documents[0].provider_signature = 'data:image/png;base64,old'
        h, response = self.compare('learner', setup, mark='')
        data = json.loads(response.content)['document']
        self.assertIsNone(data['signatures']['apprentice']['signedAt'])
        self.assertEqual(data['marks']['provider'], 'data:image/png;base64,old')

    def test_issue_reissue_json_and_lock_supersede_create_order(self):
        for role in ('staff', 'admin'):
            h, response = self.compare(role, endpoint='issue_training_plan')
            self.assertEqual(response.status_code, 201)
            self.assertEqual(h.documents[0].status, 'superseded')
            self.assertEqual(h.documents[1].programme['apprenticeName'], 'Synthetic learner')
            self.assertEqual(h.documents[0].programme, {'frozen': True})
            events = [e[0] for e in h.events]
            self.assertLess(events.index('save'), events.index('create'))

    def test_get_live_and_frozen_json_saved_empty_and_absent_population_is_preserved(self):
        for plan in (None, [], [{'moduleId': 'M1'}], [{'moduleId': 'M2'}, {'moduleId': 'M1'}]):
            h, response = self.compare('learner', lambda h: setattr(h, 'plan', plan), endpoint='training_plan_document')
            self.assertEqual(response.status_code, 200)
            data = json.loads(response.content)
            self.assertEqual(data['document']['programme'], {'frozen': True})
            self.assertTrue(data['learningPlan'])  # Preserve historical document fallback, not native membership rules.
            self.assertEqual(data['learningPlan'][-1]['componentCount'], 1)

    def test_missing_learner_and_missing_active_document(self):
        _, response = self.compare('staff', endpoint='issue_training_plan', pk=999)
        self.assertEqual(response.status_code, 404)
        _, response = self.compare('learner', lambda h: h.documents.clear())
        self.assertEqual(response.status_code, 404)

    def test_validation_and_authorized_wrong_method_error_parity(self):
        for body in (b'{', b'[]', b'{}', b'{"party":"apprentice","signature":"wrong","name":"N"}',
                     b'{"party":"apprentice","signature":"data:image/png;base64,test"}'):
            _, response = self.compare(body=body)
            self.assertEqual(response.status_code, 400)
        for endpoint in ('sign_training_plan', 'issue_training_plan', 'training_plan_document'):
            _, response = self.compare('staff', endpoint=endpoint, method='DELETE')
            self.assertEqual(response.status_code, 405)

    def test_database_failures_preserve_errors_rollback_and_progression_order(self):
        for endpoint, failure in [('sign_training_plan', 'save'), ('sign_training_plan', 'advance'),
                                  ('sign_training_plan', 'active'), ('issue_training_plan', 'create')]:
            _, response = self.compare('staff', lambda h: setattr(h, 'fail', failure),
                                       endpoint=endpoint, party='provider')
            self.assertEqual(response.status_code, 502)

    def test_signing_matrix_denies_before_document_reads_locks_or_writes(self):
        for role, allowed in [('learner', 'apprentice'), ('employer', 'employer'), ('staff', 'provider'), ('admin', 'provider')]:
            for party in ('apprentice', 'employer', 'provider'):
                if party == allowed:
                    continue
                h = Harness(role=role)
                response = h.request(party=party)
                self.assertEqual(response.status_code, 403, (role, party))
                self.assertFalse(any(e[0] in {'learner', 'active', 'atomic', 'save', 'create'} for e in h.events))

    def test_learner_and_employer_cannot_issue_even_with_dev_gate_disabled(self):
        for role in ('learner', 'employer'):
            h = Harness(role=role); h.gate_enabled = False
            self.assertEqual(h.request(endpoint='issue_training_plan').status_code, 403)
            self.assertEqual(h.events, [])

    def test_foreign_learner_or_employer_is_hidden_and_link_failure_fails_closed(self):
        h = Harness(); h.account.subject_id = 2
        self.assertEqual(h.request().status_code, 404)
        h = Harness(role='employer'); h.linked = False
        self.assertEqual(h.request(party='employer').status_code, 404)
        h.fail = 'employer_link'
        self.assertEqual(h.request(party='employer').status_code, 503)
        self.assertFalse(any(e[0] == 'atomic' for e in h.events))

    def test_staff_needs_current_enrolment_or_super_admin_grant_and_staff_identity(self):
        for grants, status in [((), 404), (('coach',), 404), (('enrolment',), 200), (('super-admin',), 200)]:
            h = Harness(role='staff', grants=grants)
            self.assertEqual(h.request(party='provider').status_code, status)
            self.assertEqual(sum(e[0] == 'staff_grants' for e in h.events), 1)
        h = Harness(role='admin'); h.account.subject_type = 'learner'
        self.assertEqual(h.request(party='provider').status_code, 403)

    def test_inactive_unknown_and_missing_accounts_deny_before_body_validation(self):
        for role in (None, 'employer', 'staff', 'learner', 'unknown'):
            h = Harness(role=role)
            if h.account:
                h.account.is_active = False
            self.assertEqual(h.request(body=b'{').status_code, 401)
            self.assertEqual(h.events, [])

    def test_django_sessions_need_explicit_active_superuser_authority(self):
        for staff, superuser, active, status in [(False, False, True, 403), (True, False, True, 403),
                                               (True, True, False, 403), (True, True, True, 200)]:
            h = Harness(role=None)
            h.user = SimpleNamespace(is_authenticated=True, is_active=active, is_staff=staff, is_superuser=superuser)
            self.assertEqual(h.request(party='provider').status_code, status)

    def test_existing_employer_signing_fixture_keeps_cross_party_denial(self):
        fixture = {'SimpleNamespace': SimpleNamespace}
        load((ROOT.parent / 'enrolment_api' / 'tests_employer_document_signing.py').read_text(encoding='utf-8-sig'),
             fixture, {'_employer'})
        h = Harness(role='employer')
        h.account = fixture['_employer']()
        self.assertTrue(h.account.is_active)
        self.assertEqual(h.request(party='apprentice').status_code, 403)
        self.assertEqual(h.request(party='provider').status_code, 403)
        self.assertFalse(any(e[0] == 'atomic' for e in h.events))

    def test_moved_definitions_are_exact_and_no_duplicate_implementation_remains(self):
        original = {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(ORIGINAL).body if isinstance(n, ast.FunctionDef)}
        moves = {'selectors/training_plan_documents.py': ['_extended_ilr_answers', '_plan_modules', '_module_breakdown', '_active_document', '_learner_kind'],
                 'serializers/training_plan_documents.py': ['_iso', '_method_label', '_party_json', '_document_json'],
                 'services/training_plan_documents.py': ['derive_content']}
        for path, names in moves.items():
            definitions = {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(source(path)).body if isinstance(n, ast.FunctionDef)}
            for name in names:
                self.assertEqual(original[name], definitions[name], (path, name))
        live = {n.name for n in ast.parse(source('training_plan_document.py')).body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(live, {'_error', 'training_plan_document', 'issue_training_plan', 'sign_training_plan'})


class StructureTests(unittest.TestCase):
    def test_one_document_membership_owner_preserves_agreement_population_order_and_failures(self):
        cases = [None, [], [{'moduleId': 'M1'}], [{'moduleId': 'M2', 'assignmentMode': 'explicit'}],
                 [{'moduleId': 'M1'}, {'moduleId': 'M1'}], [{'moduleId': None, 'moduleTitle': 'Old'}],
                 [{'moduleId': 'RETIRED'}], ['invalid']]
        for plan in cases:
            results, traces = [], []
            for code in (BEFORE_AGREEMENT_MEMBERSHIP, source('selectors/training_plan_documents.py')):
                calls = []
                def catalogue(learner):
                    calls.append('catalogue')
                    return [{'moduleId': 'M1'}, {'moduleId': 'M2'}]
                def saved(learner):
                    calls.append('saved')
                    return plan
                def group(learner):
                    calls.append('group')
                    return ['M2', 'M1']
                scope = {'_s': lambda v: str(v or '').strip(), '_saved_modules': saved,
                         'learner_programme_modules': catalogue, 'learner_group_module_ids': group}
                load(code, scope, {'_plan_modules'})
                try:
                    result = scope['_plan_modules'](SimpleNamespace())
                except (AttributeError, TypeError) as exc:
                    result = (type(exc), str(exc))
                results.append(result); traces.append(calls)
            self.assertEqual(results[0], results[1])
            self.assertEqual(traces[0], traces[1])
        tree = ast.parse(source('apprenticeship_agreement.py'))
        self.assertFalse(any(isinstance(n, ast.FunctionDef) and n.name == '_plan_modules' for n in tree.body))
        self.assertTrue(any(isinstance(n, ast.ImportFrom) and n.module == 'selectors.training_plan_documents'
                            and any(a.name == '_plan_modules' for a in n.names) for n in tree.body))

    def test_all_sixty_existing_method_route_pairs_still_registered(self):
        self.assertEqual(len(ENDPOINT_PAIRS), 60)
        self.assertEqual(len(set(ENDPOINT_PAIRS)), 60)
        self.assertEqual(len({path for method, path in ENDPOINT_PAIRS}), 51)
        files = {'login_api': ROOT.parent / 'login' / 'urls.py',
                 'learner_api': ROOT / 'urls.py', 'curriculum_api': ROOT.parent / 'curriculum_api' / 'urls.py'}
        routes = {}
        for app, file in files.items():
            tree = ast.parse(file.read_text(encoding='utf-8-sig'))
            routes[app] = {n.args[0].value for n in ast.walk(tree) if isinstance(n, ast.Call)
                           and isinstance(n.func, ast.Name) and n.func.id == 'path' and n.args
                           and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str)}
        for method, route in ENDPOINT_PAIRS:
            app, relative = route.lstrip('/').split('/', 1)
            self.assertIn(relative, routes[app], (method, route))

    def test_new_owners_have_resolvable_local_import_symbols_and_no_eager_cycle(self):
        backend = ROOT.parent
        applications = [p for p in backend.iterdir() if p.is_dir() and p.name.isidentifier() and (p / '__init__.py').is_file()]
        paths = {'.'.join(p.relative_to(backend).with_suffix('').parts).removesuffix('.__init__'): p
                 for app in applications for p in app.rglob('*.py') if '__pycache__' not in p.parts and 'migrations' not in p.parts
                 and not p.name.startswith('test')}
        trees = {name: ast.parse(p.read_text(encoding='utf-8-sig')) for name, p in paths.items()}
        graph = {name: set() for name in trees}
        imports = {}
        for name, tree in trees.items():
            package = name.split('.') if paths[name].name == '__init__.py' else name.split('.')[:-1]
            for node in tree.body:
                if isinstance(node, ast.ImportFrom):
                    prefix = package[:len(package) - node.level + 1] if node.level else []
                    module = '.'.join([*prefix, *node.module.split('.')]) if node.module else '.'.join(prefix)
                    imports.setdefault(name, []).append((node, module))
                    if module in trees:
                        graph[name].add(module)
                    for alias in node.names:
                        if module + '.' + alias.name in trees:
                            graph[name].add(module + '.' + alias.name)
                elif isinstance(node, ast.Import):
                    graph[name].update(alias.name for alias in node.names if alias.name in trees)
        owners = ['learner_api.training_plan_document', 'learner_api.training_plan_document_permissions',
                  'learner_api.selectors.training_plan_documents', 'learner_api.services.training_plan_documents',
                  'learner_api.serializers.training_plan_documents']
        for owner in owners:
            for node, module in imports.get(owner, []):
                if module not in trees:
                    continue
                exports = set()
                for definition in trees[module].body:
                    if isinstance(definition, (ast.FunctionDef, ast.ClassDef)):
                        exports.add(definition.name)
                    elif isinstance(definition, ast.Assign):
                        exports.update(t.id for t in definition.targets if isinstance(t, ast.Name))
                    elif isinstance(definition, (ast.Import, ast.ImportFrom)):
                        exports.update(a.asname or a.name.split('.')[0] for a in definition.names)
                for alias in node.names:
                    self.assertTrue(alias.name in exports or module + '.' + alias.name in paths,
                                    (owner, module, alias.name))
            pending, seen = list(graph[owner]), set()
            while pending:
                dependency = pending.pop()
                self.assertNotEqual(dependency, owner, f'Eager import cycle at {owner}')
                if dependency not in seen:
                    seen.add(dependency)
                    pending.extend(graph[dependency])

    def test_existing_week_visibility_checks_follow_moved_query_without_lowering_assertions(self):
        scope = {'re': re, 'BACKEND': ROOT.parent, 'SimpleTestCase': unittest.TestCase}
        load(source('tests_week_visibility.py'), scope, {'READER_PATHS', 'CHILD_READER_PATHS', 'WeekReaderPathTests'})
        paths = scope['READER_PATHS']
        self.assertEqual(paths['learner_api/selectors/training_plan_documents.py'], 1)
        self.assertNotIn('learner_api/training_plan_document.py', paths)
        case = scope['WeekReaderPathTests']()
        case.test_every_reader_uses_the_shared_rule()
        case.test_every_component_and_mapping_reader_uses_the_shared_rule()
        body = next(n for n in ast.parse(source('selectors/training_plan_documents.py')).body
                    if isinstance(n, ast.FunctionDef) and n.name == '_module_breakdown')
        self.assertEqual(sum(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                             and n.func.id == 'visible_child_sql' for n in ast.walk(body)), 1)

BEFORE_AGREEMENT_MEMBERSHIP = 'def _plan_modules(learner):\n    """The learner\'s learning-plan modules, with hours. Group preset if unsaved."""\n    catalogue = {m["moduleId"]: m for m in learner_programme_modules(learner)}\n\n    saved = _saved_modules(learner)\n    if saved:\n        module_ids = [_s(m.get("moduleId")) for m in saved]\n    else:\n        module_ids = learner_group_module_ids(learner)\n    return [catalogue[i] for i in module_ids if i in catalogue]\n'

ENDPOINT_PAIRS = (('POST', '/login_api/login/'), ('POST', '/login_api/logout/'), ('GET', '/login_api/me/'), ('GET', '/login_api/learner-action-access/'), ('GET', '/login_api/microsoft/start/'), ('GET', '/login_api/microsoft/callback/'), ('POST', '/login_api/change-password/'), ('POST', '/login_api/forgot-password/'), ('GET', '/login_api/reset/'), ('POST', '/login_api/reset-password/'), ('GET', '/login_api/invitation/'), ('POST', '/login_api/accept-invitation/'), ('POST', '/login_api/accounts/invite/'), ('POST', '/login_api/accounts/invitation-link/'), ('GET', '/login_api/learner-entry/'), ('POST', '/login_api/request-access/'), ('GET', '/login_api/health/'), ('GET', '/learner_api/first-login-details/<int:pk>/'), ('POST', '/learner_api/first-login-details/<int:pk>/'), ('GET', '/learner_api/learner-summary/<str:kind>/<int:pk>/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/header/minimal/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/header/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/bootstrap/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/header/presentation/'), ('GET', '/learner_api/learning-plan/<int:pk>/'), ('PATCH', '/learner_api/learning-plan/<int:pk>/'), ('PUT', '/learner_api/learning-plan/<int:pk>/'), ('GET', '/learner_api/module-learners/<str:module_id>/'), ('PATCH', '/learner_api/module-learners/<str:module_id>/'), ('PUT', '/learner_api/module-learners/<str:module_id>/'), ('GET', '/learner_api/learner-detail/<str:kind>/<int:pk>/'), ('GET', '/learner_api/weekly-learning/<str:kind>/<int:pk>/'), ('GET', '/learner_api/overview-week/<str:kind>/<int:pk>/'), ('GET', '/learner_api/module-progress/<str:kind>/<int:pk>/'), ('GET', '/learner_api/student-activity/<str:kind>/<int:pk>/'), ('GET', '/learner_api/subject-covers/<int:pk>/'), ('GET', '/learner_api/my-learning/<str:kind>/<int:pk>/'), ('GET', '/learner_api/my-learning/<str:kind>/<int:pk>/search/'), ('GET', '/learner_api/my-learning/<str:kind>/<int:pk>/upcoming/'), ('GET', '/learner_api/my-learning/<str:kind>/<int:pk>/modules/<path:subject_id>/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/weekly/plan/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/weekly/plan/<str:week_id>/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/monthly/plan/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/weekly/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/weekly/<str:week_id>/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/training/modules/<str:module_id>/'), ('GET', '/learner_api/dashboard/<str:kind>/<int:pk>/<str:tab>/'), ('GET', '/learner_api/free-courses/<str:kind>/<int:pk>/'), ('GET', '/learner_api/reflection/submissions/'), ('GET', '/learner_api/training-plan/<str:kind>/<int:pk>/'), ('GET', '/learner_api/training-plan-dashboard/<str:kind>/<int:pk>/'), ('GET', '/learner_api/training-plan-document/<int:pk>/'), ('POST', '/learner_api/training-plan-document/<int:pk>/issue/'), ('POST', '/learner_api/training-plan-document/<int:pk>/sign/'), ('GET', '/curriculum_api/curriculum/cohorts/<str:identifier>/learner-assignments/'), ('POST', '/curriculum_api/curriculum/cohorts/<str:identifier>/learner-assignments/'), ('DELETE', '/curriculum_api/curriculum/cohorts/<str:identifier>/learner-assignments/'), ('GET', '/curriculum_api/curriculum/modules/<str:identifier>/learner-assignments/'), ('POST', '/curriculum_api/curriculum/modules/<str:identifier>/learner-assignments/'), ('DELETE', '/curriculum_api/curriculum/modules/<str:identifier>/learner-assignments/'))

# Frozen current working-tree source before the final structure cleanup.
ORIGINAL = r'''
"""The Training Plan — issue, sign and retrieve.

The tripartite document: it sets out how the apprentice, the employer and the
training provider will each support the apprenticeship, and carries the learning
plan that delivers it. All three parties sign it.

Content is assembled from what we already hold:
  * programme particulars  -> the learner's record and their group's dates
  * employment details     -> the learner's employer and the Extended ILR
  * the learning plan      -> the modules on enrolment."Created_users".Learning_plan,
    which is what the learning-plan editor writes
  * off-the-job hours      -> that plan's total

Those values are SNAPSHOT at issue: once three parties have signed, editing the
learning plan must not rewrite what they agreed to.

    GET  /learner_api/training-plan-document/<pk>/          particulars + document
    POST /learner_api/training-plan-document/<pk>/issue/    create/reissue
    POST /learner_api/training-plan-document/<pk>/sign/     one party signs
"""
import json
import logging

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from enrolment_api.auth import employer_signing_party_error, enrolment_login_required

from .apprenticeship_agreement import (
    _employer_address,
    _group_dates,
    _weeks_between,
)
from .learning_plan import _saved_modules, learner_programme_modules
from .selectors.assignments import learner_group_module_ids
from .learner_progression import advance_learner
from .mappers import _s
from .models import EnrolmentUser, TrainingPlanDocument

logger = logging.getLogger(__name__)

SIGNING_PARTIES = ("apprentice", "employer", "provider")
MAX_SIGNATURE_CHARS = 400_000


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _iso(value):
    return value.isoformat() if value else ""


def _extended_ilr_answers(learner_id):
    """The wizard's Extended ILR answers, which hold the employment details."""
    try:
        from enrolment_api.models import ExtendedIlr

        row = ExtendedIlr.objects.filter(learner_id=learner_id).first()
    except DatabaseError:
        logger.exception("_extended_ilr_answers: lookup failed")
        return {}
    answers = getattr(row, "answers", None)
    return answers if isinstance(answers, dict) else {}


def _plan_modules(learner):
    """The learner's learning plan, falling back to their group's preset."""
    catalogue = {m["moduleId"]: m for m in learner_programme_modules(learner)}
    saved = _saved_modules(learner)
    ids = (
        [_s(m.get("moduleId")) for m in saved]
        if saved
        else learner_group_module_ids(learner)
    )
    return [catalogue[i] for i in ids if i in catalogue]


# How a component's `type` reads in the Method column of the printed plan.
COMPONENT_METHODS = {
    "live_session": "Live session",
    "recording_placeholder": "Recorded session",
    "video": "Pre-recorded video",
    "podcast": "Podcast",
    "reading": "Reading material",
    "quiz": "Quiz",
    "assignment": "Assignment (task)",
    "reflection": "Reflection",
    "workplace_task": "Workplace task",
    "slides": "Slides",
    "digital_learning": "Digital learning",
}


def _method_label(component_type):
    """A readable Method for the plan table, from the component's type."""
    key = _s(component_type)
    return COMPONENT_METHODS.get(key, key.replace("_", " ").capitalize())


def _module_breakdown(module_ids):
    """Weeks and components for the plan's modules, keyed by module id.

    The printed Training Plan lists each teaching activity, not just the module
    it belongs to — so the plan table is built from components, grouped by the
    week that delivers them. Off-the-job hours come from each component's
    expected_otjh, which is what actually sums to the module total.
    """
    if not module_ids:
        return {}

    from django.db import connection

    try:
        # Deliberately the `default` alias: curriculum.weeks/components are owned
        # by curriculum_api and migrated on `default`. See the note in
        # apprenticeship_agreement._group_dates.
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT w.module_catalogue_id, w.week_number, w.title,
                       c.id, c.type, c.title, c.expected_otjh, c.display_order
                FROM curriculum.weeks w
                LEFT JOIN curriculum.components c ON c.week_id = w.id
                  AND """ + visible_child_sql("c") + """
                WHERE w.module_catalogue_id = ANY(%s)
                  AND """ + visible_week_sql("w") + """
                ORDER BY w.module_catalogue_id, w.week_number, w.display_order,
                         c.display_order, c.title
                """,
                [list(module_ids)],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("_module_breakdown: lookup failed")
        return {}

    breakdown = {}
    for module_id, week_no, week_title, comp_id, comp_type, comp_title, otjh, _order in rows:
        weeks = breakdown.setdefault(_s(module_id), [])
        week = next((w for w in weeks if w["weekNumber"] == week_no), None)
        if week is None:
            week = {
                "weekNumber": week_no,
                "weekTitle": _s(week_title) or (f"Week {week_no}" if week_no else ""),
                "components": [],
            }
            weeks.append(week)
        # LEFT JOIN: a week with no components still appears, with none listed.
        if comp_id:
            week["components"].append({
                "componentId": _s(comp_id),
                "title": _s(comp_title),
                "method": _method_label(comp_type),
                "otjHours": float(otjh) if otjh is not None else 0.0,
            })
    return breakdown


def derive_content(learner):
    """Everything the Training Plan states, from the learner's own records."""
    start, end, dates_from = _group_dates(learner)
    modules = _plan_modules(learner)
    total_hours = round(sum(float(m.get("hours") or 0) for m in modules), 2)
    answers = _extended_ilr_answers(learner.pk)
    employer_block = answers.get("employer") if isinstance(answers.get("employer"), dict) else {}

    weeks = _weeks_between(start, end)

    programme = {
        "apprenticeName": _s(learner.username),
        "programme": _s(learner.programme),
        "cohort": _s(learner.cohort),
        "group": _s(learner.group),
        # We hold no separate standard name/level/reference, so the programme
        # name is what we can honestly state; an officer completes the rest.
        "standard": _s(learner.programme),
        "reference": _s(learner.reference_number),
        "level": "",
        "startDate": _iso(start),
        "endDate": _iso(end),
        "practicalStartDate": _iso(start),
        "practicalEndDate": _iso(end),
        "durationWeeks": float(weeks) if weeks is not None else None,
        "ilrPlannedHours": total_hours,
    }

    employment = {
        "employerName": _s(learner.employer) or _s(employer_block.get("organisationName")),
        "deliveryAddress": _employer_address(learner) or _s(employer_block.get("address")),
        "jobTitle": "",
        "workingHoursPerWeek": "",
        "lineManager": _s(learner.line_manager) or _s(employer_block.get("lineManagerName")),
        "lineManagerTitle": "",
        "startDateWithEmployer": "",
    }

    # Each module with the weeks and components that deliver it, so the printed
    # plan lists actual teaching activities rather than just module names.
    delivery_lead = _s(learner.learning_provider) or "Kent Business College"
    breakdown = _module_breakdown([_s(m.get("moduleId")) for m in modules])
    learning_plan = []
    for m in modules:
        module_id = _s(m.get("moduleId"))
        weeks = breakdown.get(module_id, [])
        # The module total is authoritative (it is what the learning-plan editor
        # agreed); the component sum is shown alongside where it differs.
        component_hours = round(
            sum(c["otjHours"] for w in weeks for c in w["components"]), 2
        )
        learning_plan.append({
            "moduleId": module_id,
            "activity": _s(m.get("moduleTitle")),
            "deliveryLead": delivery_lead,
            "plannedDate": _iso(start),
            "plannedEmHours": None,
            "plannedOtjHours": float(m.get("hours") or 0),
            "groupName": _s(m.get("groupName")),
            "weeks": weeks,
            "componentHours": component_hours,
            "componentCount": sum(len(w["components"]) for w in weeks),
        })

    otjh = {
        # The planned total is the learning plan's; the published minimum and
        # any RPL reduction have no source on our side yet.
        "plannedTotal": total_hours,
        "publishedMinimum": None,
        "rplVolume": None,
        "minimumReducedByRpl": None,
    }

    epa = {"epao": "", "gatewayReviewDate": "", "epaPeriodFrom": "", "epaPeriodTo": ""}

    contacts = {
        "apprentice": {
            "name": _s(learner.username),
            "email": _s(learner.email),
            "telephone": _s(learner.phone_number),
            "address": " ".join(
                p for p in (
                    _s(learner.address_line_1) or _s(learner.address),
                    _s(learner.address_line_2),
                    _s(learner.address_line_3),
                    _s(learner.current_postcode),
                ) if p
            ),
        },
        "employer": {
            "lineManager": employment["lineManager"],
            "position": "",
            "email": _s(employer_block.get("lineManagerEmail")),
            "telephone": _s(employer_block.get("lineManagerPhone")),
            "company": employment["employerName"],
            "address": employment["deliveryAddress"],
        },
    }

    return {
        "programme": programme,
        "employment": employment,
        "learningPlan": learning_plan,
        "otjh": otjh,
        "epa": epa,
        "contacts": contacts,
        "datesFrom": dates_from,
    }


# ---------------------------------------------------------------------------
# Serialising
# ---------------------------------------------------------------------------
def _party_json(signature, name, position, at):
    return {
        "signed": bool(_s(signature)),
        "name": _s(name),
        "position": _s(position),
        "signedAt": at.isoformat() if at else None,
    }


def _document_json(document):
    if document is None:
        return None
    return {
        "id": str(document.id),
        "status": _s(document.status),
        "fullySigned": bool(document.fully_signed),
        "createdAt": document.created_at.isoformat() if document.created_at else None,
        "updatedAt": document.updated_at.isoformat() if document.updated_at else None,
        # The frozen content — what the three parties signed.
        "programme": document.programme or {},
        "employment": document.employment or {},
        "learningPlan": document.learning_plan or [],
        "otjh": document.otjh or {},
        "epa": document.epa or {},
        "contacts": document.contacts or {},
        "signatures": {
            "apprentice": _party_json(
                document.apprentice_signature,
                document.apprentice_signed_name,
                document.apprentice_position,
                document.apprentice_signed_at,
            ),
            "employer": _party_json(
                document.employer_signature,
                document.employer_signed_name,
                document.employer_position,
                document.employer_signed_at,
            ),
            "provider": _party_json(
                document.provider_signature,
                document.provider_signed_name,
                document.provider_position,
                document.provider_signed_at,
            ),
        },
        "marks": {
            "apprentice": _s(document.apprentice_signature),
            "employer": _s(document.employer_signature),
            "provider": _s(document.provider_signature),
        },
    }


def _active_document(learner_kind, learner_id, lock=False):
    """The learner's active training plan. `lock=True` takes a row lock for the
    caller's transaction — only valid inside
    `transaction.atomic(using="enrolment")`."""
    qs = TrainingPlanDocument.objects.filter(
        learner_kind=learner_kind,
        learner_id=learner_id,
        status=TrainingPlanDocument.STATUS_ACTIVE,
    )
    if lock:
        qs = qs.select_for_update()
    return qs.first()


def _learner_kind(learner):
    return _s(getattr(learner, "learner_type", "")) or "apprenticeship"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@enrolment_login_required
@csrf_exempt
def training_plan_document(request, pk):
    """The learner's Training Plan, plus the content a new one would carry."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        derived = derive_content(learner)
        document = _active_document(_learner_kind(learner), learner.pk)
    except DatabaseError as exc:
        logger.exception("training_plan_document: build failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "learner": {
            "id": str(learner.id),
            "name": _s(learner.username),
            "programmeStatus": _s(learner.programme_status),
        },
        # What a freshly issued plan would state, from live data.
        "programme": derived["programme"],
        "employment": derived["employment"],
        "learningPlan": derived["learningPlan"],
        "otjh": derived["otjh"],
        "epa": derived["epa"],
        "contacts": derived["contacts"],
        "meta": {
            "datesFrom": derived["datesFrom"],
            "moduleCount": len(derived["learningPlan"]),
        },
        "document": _document_json(document),
    })


@enrolment_login_required
@csrf_exempt
def issue_training_plan(request, pk):
    """Issue the plan, snapshotting the current content onto a new row."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        kind = _learner_kind(learner)
        derived = derive_content(learner)

        # `using="enrolment"` is required — a bare atomic() opens on `default`
        # and leaves this supersede+create unprotected. See BE-1.
        with transaction.atomic(using="enrolment"):
            existing = _active_document(kind, learner.pk, lock=True)
            if existing is not None:
                existing.status = TrainingPlanDocument.STATUS_SUPERSEDED
                existing.save(update_fields=["status", "updated_at"])

            document = TrainingPlanDocument.objects.create(
                learner_kind=kind,
                learner_id=learner.pk,
                programme=derived["programme"],
                employment=derived["employment"],
                learning_plan=derived["learningPlan"],
                otjh=derived["otjh"],
                epa=derived["epa"],
                contacts=derived["contacts"],
            )
    except DatabaseError as exc:
        logger.exception("issue_training_plan: failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"document": _document_json(document)}, status=201)


@enrolment_login_required
@csrf_exempt
def sign_training_plan(request, pk):
    """Record one party's signature. Empty signature withdraws that sign-off."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    party = _s(payload.get("party")).lower()
    if party not in SIGNING_PARTIES:
        allowed = "', '".join(SIGNING_PARTIES)
        return _error(f"party must be one of '{allowed}'.", 400)
    party_error = employer_signing_party_error(request, party)
    if party_error is not None:
        return party_error

    signature = _s(payload.get("signature"))
    name = _s(payload.get("name"))
    position = _s(payload.get("position"))
    if signature:
        if len(signature) > MAX_SIGNATURE_CHARS:
            return _error("That signature image is too large.", 400)
        if not signature.startswith("data:image/"):
            return _error("signature must be a PNG data URL.", 400)
        if not name:
            return _error("name is required when signing.", 400)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        # Lock the row for the read-modify-write so concurrent signers can't
        # overwrite each other's signature. See BE-4.
        with transaction.atomic(using="enrolment"):
            document = _active_document(_learner_kind(learner), learner.pk, lock=True)
            if document is None:
                return _error("No training plan has been issued for this learner yet.", 404)

            now = timezone.now() if signature else None
            setattr(document, f"{party}_signature", signature)
            setattr(document, f"{party}_signed_name", name if signature else "")
            setattr(document, f"{party}_position", position if signature else "")
            setattr(document, f"{party}_signed_at", now)

            document.recalculate_signed()
            document.save()
        promoted = advance_learner(learner)
    except DatabaseError as exc:
        logger.exception("sign_training_plan: failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "document": _document_json(document),
        "programmeStatus": _s(learner.programme_status),
        "programmeStatusChangedTo": promoted,
    })
'''



if __name__ == '__main__':
    unittest.main(verbosity=2)
