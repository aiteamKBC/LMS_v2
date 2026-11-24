"""Phase 1D. Launch via phase1f_tests/image/run_membership_runtime.py (Docker).

Never use Django discovery. Parent launches a credential-free child. Child blocks
network, database drivers, process spawning, file writes and .env reads before
Django initialization. No project settings/apps/middleware are initialized.
Real modules: reader, assignments, permissions, pure policy; real Django setup,
HttpRequest and JsonResponse. Data sources/session lookup are synthetic.
"""
import os
from pathlib import Path
import subprocess
import sys

if '--isolated-child' not in sys.argv:
    if __name__ != '__main__':
        raise RuntimeError('Run this isolated test directly, not through discovery')
    env = {k: os.environ[k] for k in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP') if k in os.environ}
    env['LEARNER_API_REQUIRE_AUTH'] = '1'
    raise SystemExit(subprocess.run([sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                                    '--isolated-child'], env=env, check=False).returncode)
sys.argv.remove('--isolated-child')
assert set(os.environ) <= {'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LEARNER_API_REQUIRE_AUTH', 'LC_CTYPE'}
assert sys.dont_write_bytecode and 'django' not in sys.modules

import ast
from contextlib import nullcontext
from copy import deepcopy
import importlib.abc
import json
import re
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
blocked = []


class IsolationViolation(BaseException):
    pass


def deny(*args, **kwargs):
    blocked.append('blocked boundary')
    raise IsolationViolation('External/persistent operation blocked')


def audit(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.remove', 'os.rename', 'os.mkdir'):
        deny()
    if event == 'open':
        path, mode, flags = args
        if isinstance(path, (str, bytes)) and '.env' in os.fsdecode(path).replace('\\', '/').split('/')[-1]:
            deny()
        if (isinstance(mode, str) and any(c in mode for c in 'wax+')) or flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            deny()


sys.addaudithook(audit)
PROJECT_ROOTS = {p.name for p in BACKEND.iterdir() if p.is_dir() and (p / '__init__.py').exists()}
ALLOWED = {'learner_api.learning_plans.tests',
           'learner_api.learning_plans.tests.parity',
           'curriculum_api.directory', 'curriculum_api.directory.domain',
           'curriculum_api.directory.domain.placement',
           'curriculum_api.directory.domain.membership_values',
           'curriculum_api.directory.application',
           'curriculum_api.directory.application.status_queries',
           'curriculum_api.directory.application.assignment_queries',
           'curriculum_api.directory.infrastructure',
           'curriculum_api.directory.infrastructure.membership_runtime',
           'curriculum_api.directory.infrastructure.registration_reads',
           'learner_api.learning_plans.application',
           'learner_api.learning_plans.application.module_membership',
'curriculum_api', 'curriculum_api.learner_status_counts', 'curriculum_api.learner_assignments',
           'login', 'login.permissions', 'learner_api', 'learner_api.learning_plans',
           'learner_api.learning_plans.domain', 'learner_api.learning_plans.domain.membership_policy',
           'learner_api.learning_plans.tests.parity.test_membership_caller_parity_standalone',
           'learner_api.learning_plans.tests.parity.test_membership_integration_standalone'}


class ImportFence(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        root = fullname.split('.')[0]
        if root in {'psycopg', 'psycopg2', 'sqlite3', 'redis', 'requests', 'httpx', 'msal', 'azure', 'dotenv'}:
            deny()
        if root in PROJECT_ROOTS and fullname not in ALLOWED:
            deny()


sys.meta_path.insert(0, ImportFence())


def stub(name, **values):
    module = ModuleType(name)
    module.__dict__.update(values)
    sys.modules[name] = module
    return module


def pure_source_helpers(relative, names, env=None):
    # Preserve the actual serializer/string helpers without importing models.
    env = {} if env is None else env
    tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    assert all(not n.decorator_list for n in nodes)
    assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) for node in nodes for n in ast.walk(node))
    env['__builtins__'] = {'str': str}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), relative, 'exec'), env)
    return env


strings = pure_source_helpers('learner_api/learning_plans/domain/stored_plan.py', ['_s'])
view_strings = pure_source_helpers(
    'curriculum_api/catalogue/domain/values.py',
    ['clean_str', 'normalise'],
    env={'re': re},
)
from curriculum_api.directory.domain.placement import scope_programme_identifier
view_strings['scope_programme_identifier'] = lambda lineage: scope_programme_identifier(
    lineage, clean_str=view_strings['clean_str'])
# Install infrastructure replacements BEFORE setup or application imports.
sessions = stub('login.sessions', authenticate_request=lambda r: r.account,
                session_unreadable=lambda r: getattr(r, 'unreadable', False))
plans = stub('learner_api.learning_plan', _s=strings['_s'])
stub('learner_api.placement_links', with_placements=lambda rows: rows, placement_ids=deny,
     placement_profile=lambda row: row.profile, RELATIONS=(), CACHE='synthetic')
stub('learner_api.active_users', hydrate_training_plan=deny)
stub('learner_api.mappers', get_training_plan=deny, stored_training_plan=deny, training_plan_field=deny)
models = stub('learner_api.models', EnrolmentUser=SimpleNamespace(), LearnerProfile=SimpleNamespace())
plan_rows = stub('curriculum_api.module_plan_rows', profile_for=deny)
stub('curriculum_api.curriculum_names', NAME_FIELDS={})
views = stub('curriculum_api.views', clean_str=view_strings['clean_str'],
             curriculum_read_scope=lambda **kw: nullcontext(),
             scope_programme_identifier=view_strings['scope_programme_identifier'],
             programme_identity_candidates=lambda p: [p], AUTHORING_MODULES_TABLE='modules',
             curriculum_row_effectively_deleted=lambda row: row.get('status') in ('inactive', 'archived'),
             invalidate_curriculum_cache=deny)
stub('curriculum_api.catalogue.infrastructure.database_reads',
     AUTHORING_MODULES_TABLE='modules', column_names=deny,
     learner_schema_columns=deny, learner_schema_table_exists=deny)
stub('curriculum_api.catalogue.infrastructure.authoring_schema_runtime',
     COHORT_AUTHORING_DETAILS_TABLE='cohorts', GROUPS_TABLE='groups')
stub('curriculum_api.catalogue.infrastructure.authoring_runtime', authoring_fetch_all=deny)
stub('curriculum_api.catalogue.domain.values', clean_str=view_strings['clean_str'],
     normalise=view_strings['normalise'])
stub('curriculum_api.catalogue.infrastructure.cache_runtime',
     curriculum_read_scope=lambda **kw: nullcontext())
stub('curriculum_api.catalogue.infrastructure.catalogue_resolution',
     programme_identity_candidates=lambda value: [value], scope_placement_lineage=deny)
stub('curriculum_api.catalogue.infrastructure.placement_runtime',
     scope_programme_identifier=view_strings['scope_programme_identifier'])
stub('curriculum_api.learner_assignment_counts_sql', bulk_assigned_learner_counts=deny)

from django.conf import settings
settings.configure(SECRET_KEY='synthetic-only', INSTALLED_APPS=[], MIDDLEWARE=[], DATABASE_ROUTERS=[],
                   DATABASES={'default': {'ENGINE': 'django.db.backends.dummy'}},
                   CACHES={'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}},
                   LOGGING_CONFIG=None, USE_TZ=True, DEFAULT_CHARSET='utf-8', ALLOWED_HOSTS=['testserver'])
from django.db.backends.base.base import BaseDatabaseWrapper
BaseDatabaseWrapper.ensure_connection = deny
BaseDatabaseWrapper.connect = deny
BaseDatabaseWrapper.cursor = deny
from django.db import transaction
transaction.atomic = deny
from django.core.cache import cache
cache.get = cache.set = cache.delete = deny
import django
django.setup()
from django.http import HttpRequest, QueryDict
from curriculum_api import learner_status_counts as counts
from curriculum_api.directory.infrastructure import membership_runtime
from curriculum_api import learner_assignments as assignments
from learner_api.learning_plans.domain import membership_policy
from learner_api.learning_plans.tests.parity import test_membership_integration_standalone as oracle

ACTUAL_READER = counts.module_member_enrolment_ids


class Rows(list):
    def only(self, *fields):
        return self

    def order_by(self, *fields):
        return Rows(sorted(self, key=lambda r: tuple(getattr(r, f) for f in fields)))

    def filter(self, **kw):
        assert set(kw) == {'pk__in'}
        return Rows(r for r in self if str(r.pk) in {str(i) for i in kw['pk__in']})


def person(pk, name):
    return SimpleNamespace(pk=pk, id=pk, username=name, email='synthetic@example.invalid',
                           programme='P', cohort='C', group='G', employer='', organization='',
                           programme_status='active', learner_type='', profile=SimpleNamespace(lifecycle_status='inactive'))


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.start_blocked = len(blocked)
        self.facts = [oracle.parity.fact(1, 103), oracle.parity.fact(2, 101, programme_id='OTHER', explicit=True, module_ids=['M']),
                      oracle.parity.fact(3, 102, explicit=True, module_ids=['S'])]
        self.target = dict(oracle.parity.TARGET)
        self.present = True
        models.EnrolmentUser.all_learners = Rows([person(103, 'Zulu'), person(102, 'Alpha'), person(101, 'Alpha')])
        views.resolve_stored_module_catalogue_id = lambda identifier: 'M' if identifier in ('M', 'legacy') else None
        views.authoring_fetch_all = lambda table, where, params: ([dict(module_catalogue_id='M', title='Synthetic',
            status='active', programme_name='P', programme_id='P')] if self.present and params == ['M'] else [])
        membership_runtime.placement_lineages = lambda scope, ids: {
            key: deepcopy(self.target) if self.present else {} for key in ids
        }
        membership_runtime.learner_facts = lambda ids: deepcopy(self.facts)
        assignments._plan_row_counts = lambda: {'101': 1}
        self.assertIs(counts.module_member_enrolment_ids, ACTUAL_READER)

    def tearDown(self):
        self.assertEqual(len(blocked), self.start_blocked, 'Unexpected blocked I/O attempt')

    def get(self, compact=False, identifier='M', role='staff', unreadable=False):
        request = HttpRequest()
        request.method = 'GET'
        request.GET = QueryDict('assignedOnly=1' if compact else '')
        request.account = None if role is None else SimpleNamespace(role=role)
        request.unreadable = unreadable
        response = assignments.module_learner_assignments(request, identifier)
        return response.status_code, json.loads(response.content)

    def parity_get(self, compact=False, identifier='M'):
        actual = self.get(compact, identifier)
        old, _, _ = oracle.reader('old', deepcopy(self.facts), {'M': deepcopy(self.target) if self.present else {}})
        with patch.object(counts, 'module_member_enrolment_ids', old):
            before = self.get(compact, identifier)
        self.assertEqual(actual, before)
        return actual

    def test_real_import_invocation(self):
        self.assertEqual(
            ACTUAL_READER.__module__,
            'curriculum_api.directory.infrastructure.membership_runtime',
        )
        with patch.object(membership_policy, 'members_for_lineages', wraps=membership_policy.members_for_lineages) as spy:
            self.assertEqual(ACTUAL_READER('M'), {'101', '103'})
            spy.assert_called_once()

    def test_full_and_compact_serialization_order(self):
        status, full = self.parity_get()
        self.assertEqual(status, 200)
        self.assertEqual([r['id'] for r in full['learners']], ['101', '102', '103'])
        self.assertEqual([r['assigned'] for r in full['learners']], [True, False, True])
        self.assertEqual(full['learners'][0]['lifecycleStatus'], 'inactive')
        self.assertEqual(full['learners'][0]['learnerType'], 'apprenticeship')
        status, compact = self.parity_get(True)
        self.assertEqual([r['id'] for r in compact['learners']], ['101', '103'])
        self.assertEqual(compact['totals'], {'learnerCount': 2, 'assignedCount': 2})

    def test_empty_missing_and_controlled_alias(self):
        self.assertEqual(self.parity_get(True, 'legacy'), self.parity_get(True, 'M'))
        self.facts = []
        self.assertEqual(self.parity_get(True)[1]['learners'], [])
        self.present = False
        self.assertEqual(self.parity_get(True)[0], 404)

    def test_manual_bridges_duplicates(self):
        self.target['learnerRosterMode'] = 'manual'
        self.assertEqual([r['id'] for r in self.parity_get(True)[1]['learners']], ['101'])
        self.target['learnerRosterMode'] = 'inherited'
        self.facts += [deepcopy(self.facts[0]), oracle.parity.fact(9, None), oracle.parity.fact(10, 0)]
        self.assertEqual([r['id'] for r in self.parity_get(True)[1]['learners']], ['101', '103'])

    def test_real_string_serialization_edge(self):
        models.EnrolmentUser.all_learners = Rows([person(101, 0)])
        payload = self.parity_get(True)[1]
        self.assertEqual(payload['learners'][0]['name'], '0')

    def test_real_decorator_with_synthetic_session_boundary(self):
        self.assertEqual(self.get(role=None)[0], 401)
        self.assertEqual(self.get(role='learner')[0], 403)
        self.assertEqual(self.get(role=None, unreadable=True)[0], 503)
        self.assertEqual(self.get(role='admin')[0], 200)

    def test_actual_writer_guards_against_snapshot(self):
        cases = [(oracle.parity.fact(), 'inherited'),
                 (oracle.parity.fact(explicit=True, module_ids=['S']), 'inherited'),
                 (oracle.parity.fact(programme_id='OTHER', explicit=True, module_ids=['M']), 'inherited'),
                 (oracle.parity.fact(), 'manual'),
                 (oracle.parity.fact(explicit=True, ambiguous=True, module_ids=['M']), 'manual'),
                 (oracle.parity.fact(bridge=0), 'inherited'), (oracle.parity.fact(bridge='0'), 'inherited'),
                 (oracle.parity.fact(bridge=None), 'inherited'), (None, 'inherited')]
        for row, mode in cases:
            self.facts = [row]
            self.target['learnerRosterMode'] = mode
            for name in ('_assign_module', '_unassign_module'):
                with self.subTest(row=row, mode=mode, guard=name):
                    old, _, _ = oracle.reader('old', deepcopy(self.facts), {'M': self.target})
                    pk = 0 if row and row.get('enrolment_id') in (0, '0') else 101
                    expected = oracle.guard_outcome(name, old, pk, baseline=True)
                    boundary = []
                    def stop(learner):
                        boundary.append(learner.pk)
                        raise oracle.Proceed()
                    args = [SimpleNamespace(pk=pk), {'id': 'M', 'moduleIds': ['M']}]
                    if name == '_assign_module':
                        args.append({})
                    args.append({})
                    with patch.object(plan_rows, 'profile_for', stop):
                        try:
                            value = getattr(assignments, name)(*args)
                        except oracle.Proceed:
                            actual = ('proceed', boundary)
                        except Exception as exc:
                            actual = ('error', type(exc).__name__, str(exc))
                        else:
                            self.assertIs(value, False)
                            actual = ('skip', [])
                    self.assertEqual(actual, expected)

    def test_isolation_configuration_and_blocks(self):
        from django.apps import apps
        self.assertTrue(apps.ready)
        self.assertEqual(list(apps.get_app_configs()), [])
        self.assertEqual(settings.MIDDLEWARE, [])
        self.assertEqual(settings.DATABASE_ROUTERS, [])
        self.assertEqual(settings.DATABASES['default']['ENGINE'], 'django.db.backends.dummy')
        self.assertNotIn('config.settings', sys.modules)
        self.assertNotIn('psycopg', sys.modules)
        # Exercise fail-closed boundaries, without any actual connection or write.
        for operation in (lambda: audit('socket.connect', ()), lambda: transaction.atomic(),
                          lambda: cache.set('synthetic', 1), lambda: BaseDatabaseWrapper.ensure_connection(None)):
            with self.assertRaises(IsolationViolation):
                operation()
        self.start_blocked = len(blocked)


if __name__ == '__main__':
    unittest.main(verbosity=2)
