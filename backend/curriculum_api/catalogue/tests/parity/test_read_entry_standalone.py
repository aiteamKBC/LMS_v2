"""Compare actual former entry bodies with current explicit-port read adapters.

Only AST definitions and pure modules execute. Imports for readers and HTTP are
explicit synthetic ports; unexpected imports fail instead of starting Django.
"""
import ast
import builtins
import copy
from contextlib import contextmanager
import hashlib
import importlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import read_entry_oracle as oracle
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.application.overview import CurriculumOverviewUnavailable
from curriculum_api.reporting.domain.readiness import coverage_readiness

MANIFEST = oracle.SNAPSHOT['manifest']
OLD = {n.name: n for source in oracle.SNAPSHOT['source_changes']['views.py']['removed']
       for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}


def current(name):
    return next(n for n in ast.parse((ROOT / MANIFEST[name]['owner']).read_text(encoding='utf-8')).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


class Bindings(ast.NodeTransformer):
    def __init__(self, bridges):
        self.bridges = bridges

    def visit_ImportFrom(self, node):
        loaders = {symbol: loader for loader, (_, symbol) in self.bridges.items()}
        if len(node.names) == 1 and node.names[0].name in loaders:
            alias = node.names[0]
            return ast.Assign(targets=[ast.Name(id=alias.asname or alias.name, ctx=ast.Store())],
                              value=ast.Call(func=ast.Name(id=loaders[alias.name], ctx=ast.Load()), args=[], keywords=[]))
        if node.level:
            assert node.level == 1
            node.level = 0
            node.module = 'curriculum_api.' + node.module
        return node


class Response(dict):
    def __init__(self, payload, status=200):
        super().__init__()
        self.payload = copy.deepcopy(payload)
        self.status_code = status
        self.content = json.dumps(payload).encode()

    def __bool__(self):
        return True  # Match Django HttpResponse even when there are no headers.


def run(name, prior, args, ports, imports=None):
    """Compile the actual definition; do not reimplement either algorithm."""
    imports = imports or {}
    def importer(module, globals=None, locals=None, fromlist=(), level=0):
        full = 'curriculum_api.' + module if level else module
        if full in imports:
            return imports[full]
        if full in {'functools', 'curriculum_api.learner_impact_summary'}:
            return importlib.import_module(full)
        if full == 'curriculum_api.catalogue.application.overview':
            return SimpleNamespace(CurriculumOverviewUnavailable=CurriculumOverviewUnavailable)
        raise AssertionError(('Unexpected import', full, fromlist))
    node = copy.deepcopy(OLD[name] if prior else current(name))
    node.decorator_list = []
    env = {**ports, 'coverage_readiness': coverage_readiness,
           '__builtins__': {**vars(builtins), '__import__': importer}}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), '<actual-read-adapter>', 'exec'), env)
    kwargs = {} if prior else {p: ports[p] for p in MANIFEST[name]['ports']}
    try:
        value = env[name](*args, **kwargs)
        if isinstance(value, Response):
            value = (value.status_code, value.payload, dict(value))
        return value
    except (ValueError, TypeError) as exc:
        return type(exc).__name__, str(exc)


class ReadEntryContracts(unittest.TestCase):
    def test_frozen_baseline_and_exact_body_transfer(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '09bf924606d576af4e91a0665f120ca9833713585e2c2d708f48bcbc9d69956c')
        for name, entry in MANIFEST.items():
            expected = Bindings(entry['bridges']).visit(copy.deepcopy(OLD[name]))
            actual = current(name)
            if name == 'curriculum_readiness_validation':
                domain = ast.parse((ROOT / 'reporting/domain/readiness.py').read_text(encoding='utf-8')).body[1]
                self.assertEqual(ast.dump(ast.Module(body=expected.body[3:-1], type_ignores=[])),
                                 ast.dump(ast.Module(body=domain.body[:-1], type_ignores=[])))
                self.assertEqual(ast.dump(expected.body[-1].value.args[0]), ast.dump(domain.body[-1].value))
                self.assertEqual(ast.dump(actual.body[-1]),
                                 ast.dump(ast.parse('return JsonResponse(coverage_readiness(payload))').body[0]))
                self.assertEqual(ast.dump(ast.Module(body=expected.body[:3], type_ignores=[])),
                                 ast.dump(ast.Module(body=actual.body[:3], type_ignores=[])))
            else:
                self.assertEqual(ast.dump(ast.Module(body=expected.body, type_ignores=[])),
                                 ast.dump(ast.Module(body=actual.body, type_ignores=[])), name)
            kept = len(actual.args.kwonlyargs) - len(entry['ports'])
            self.assertEqual([a.arg for a in actual.args.kwonlyargs[kept:]], entry['ports'])
            actual.args.kwonlyargs = actual.args.kwonlyargs[:kept]
            actual.args.kw_defaults = actual.args.kw_defaults[:kept]
            self.assertEqual(ast.dump(actual.args), ast.dump(OLD[name].args), name)

    def test_entry_signatures_decorators_and_port_forwarding(self):
        from curriculum_api.catalogue.tests.parity.cache_lifecycle_oracle import restore_tree
        views = restore_tree(ast.parse((ROOT / 'views.py').read_text(encoding='utf-8')), 'views.py')
        for node in views.body:
            if not isinstance(node, ast.FunctionDef) or node.name not in MANIFEST:
                continue
            entry = MANIFEST[node.name]
            self.assertEqual(ast.dump(node.args), ast.dump(OLD[node.name].args))
            self.assertEqual([ast.dump(d) for d in node.decorator_list], [ast.dump(d) for d in OLD[node.name].decorator_list])
            call = node.body[-1].value
            self.assertEqual(call.func.id, 'implementation')
            self.assertEqual([k.arg for k in call.keywords[-len(entry['ports']):]], entry['ports'])
            self.assertTrue(all(isinstance(k.value, ast.Name) and k.value.id == k.arg for k in call.keywords))
            self.assertFalse(any(isinstance(n, (ast.If, ast.For, ast.Try, ast.With)) for n in ast.walk(node)))

    def test_no_reverse_import_or_framework_in_application_domain(self):
        for relative in {e['owner'] for e in MANIFEST.values()} | {'reporting/domain/readiness.py'}:
            for node in ast.walk(ast.parse((ROOT / relative).read_text(encoding='utf-8'))):
                if not isinstance(node, (ast.Import, ast.ImportFrom)):
                    continue
                modules = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or '']
                for module in modules:
                    self.assertNotEqual(module, 'curriculum_api.views')
                    if '/application/' in relative or '/domain/' in relative:
                        self.assertFalse(module.startswith(('django', 'psycopg', 'requests')) or '.infrastructure.' in module or '.api.' in module, (relative, module))

    def test_profile_and_enrolment_count_modes(self):
        for profiles in (False, True):
            for seed in ([], [{}], [{'id': ' B '}, {'moduleCatalogueId': 'A', 'id': 'B'}, {'catalogueId': 'A'}]):
                outcomes = []
                for prior in (True, False):
                    rows = copy.deepcopy(seed); trace = []
                    def legacy(ids):
                        trace.append(('legacy', sorted(ids))); return {'A': 7, 'B': 2}
                    def canonical(scope, ids):
                        trace.append((scope, ids)); return {'A': {'total': 3}, 'B': None}
                    ports = dict(clean_str=clean_str, load_status_counts=lambda:canonical, load_assignment_counts=lambda:legacy)
                    imports = {'curriculum_api.directory.infrastructure.membership_runtime': SimpleNamespace(status_counts=canonical),
                               'curriculum_api.learner_assignment_counts_sql': SimpleNamespace(bulk_assigned_learner_counts_sql=legacy)}
                    # The existing keyword-only identity mode is supplied as-is.
                    node = copy.deepcopy(OLD['attach_module_assignment_counts'] if prior else current('attach_module_assignment_counts'))
                    env = {**ports, '__builtins__': {**vars(builtins), '__import__': lambda module, *a, **kw: imports['curriculum_api.'+module]}}
                    exec(compile(ast.Module(body=[node], type_ignores=[]), '<count-source>', 'exec'), env)
                    result = env[node.name](rows, learner_profiles=profiles, **({} if prior else ports))
                    outcomes.append((result, rows, trace))
                self.assertEqual(*outcomes)
                if profiles:
                    expected = [('module', ['A', 'B'])] if len(seed) == 3 else []
                else:
                    expected = [('legacy', ['A', 'B'] if len(seed) == 3 else [''] if seed else [])]
                self.assertEqual(outcomes[0][2], expected)

    def test_required_overview_cache_contract(self):
        for profiles in (False, True):
            outcomes = []
            for prior in (True, False):
                trace = []
                @contextmanager
                def scope():
                    trace.append('enter'); yield; trace.append('exit')
                def cache(key, build, **kwargs):
                    trace.append((key, kwargs)); return build()
                def project(rows, visibility, **kwargs):
                    trace.append((rows, visibility, kwargs)); return {'ok': True}
                ports = dict(curriculum_read_scope=scope, cached_curriculum_value=cache,
                             get_required_curriculum_rows=lambda **kw: {'requested': kw},
                             build_curriculum_payload_from_rows=project, CURRICULUM_ROWS_CACHE_TTL_SECONDS=33)
                node = copy.deepcopy(OLD['build_curriculum_overview'] if prior else current('build_curriculum_overview'))
                env = dict(ports); exec(compile(ast.Module(body=[node], type_ignores=[]), '<required-overview>', 'exec'), env)
                value = env[node.name]('all', True, True, learner_profiles=profiles, **({} if prior else ports))
                outcomes.append((value, trace))
            self.assertEqual(*outcomes)
            self.assertEqual(outcomes[0][1][0], 'enter'); self.assertEqual(outcomes[0][1][-1], 'exit')

    def test_overview_http_cache_modes_and_unavailable_sources(self):
        for compact, profiles, force, shared, stale, fail in (
                (False,False,False,False,False,False),(True,False,False,True,False,False),
                (True,False,False,True,True,False),(True,False,True,True,False,False),
                (True,True,False,True,False,False),(True,False,False,False,False,False),
                (False,False,False,False,False,True)):
            outcomes=[]
            for prior in (True, False):
                trace=[]; payload={'modules':[{'id':'M','extra':1}], 'ksbSets':['K']}
                def build(*args, **kwargs):
                    trace.append(('build', args, kwargs))
                    if fail: raise CurriculumOverviewUnavailable()
                    return payload
                def cache(key, fn, **kwargs):
                    trace.append(('cache',key,kwargs)); return fn()
                request=SimpleNamespace(GET={'compact':'1' if compact else '', 'learner_source':'profiles' if profiles else ''})
                home=SimpleNamespace(get_curriculum_home=lambda vis: SimpleNamespace(payload={'overview':{'shared':True}}, stale=stale) if shared else None,
                    enqueue_curriculum_home_refresh=lambda *a, **kw: trace.append(('refresh',a,kw)))
                ports=dict(JsonResponse=Response, build_curriculum_overview=build, cached_curriculum_value=cache,
                    compact_module_rows=lambda rows:[{'id':r['id']} for r in rows], curriculum_visibility=lambda r:'all',
                    logger=Mock(), request_bypasses_curriculum_cache=lambda r:force,
                    settings=SimpleNamespace(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True))
                value=run('curriculum_overview', prior, [request], ports, {'curriculum_api.catalogue.infrastructure.home_read_model':home})
                outcomes.append((value,trace,copy.deepcopy(payload)))
            self.assertEqual(*outcomes)
            self.assertEqual(outcomes[0][2]['ksbSets'], ['K'])
            if fail:self.assertEqual(outcomes[0][0][0],503)

    def test_achievement_paging_errors_and_definition_identity(self):
        for name in ('curriculum_programme_ksb_achievement','curriculum_programme_ksb_achievement_consumptions'):
            for page in ('1','2','0','bad'):
                results=[]
                for prior in (True,False):
                    query={'page':page,'page_size':'2'};request=SimpleNamespace(GET=query)
                    projection={'consumptions':[1,2,3], 'items':[], '_allItems':[{'ksbDefinitionId':'source:K'}]}
                    ports=dict(JsonResponse=Response, _achievement_projection=lambda *a:(projection,None))
                    args=[request,'P']+(['source:K'] if name.endswith('consumptions') else [])
                    results.append((run(name,prior,args,ports),query,request.GET))
                self.assertEqual(*results)

    def test_scope_validation_and_error_propagation(self):
        for name in ('curriculum_scope_learner_ksb_impact','curriculum_scope_learner_roster'):
            for query in ({},{'scope':'bad','id':'X'},{'scope':'module','id':' M '}):
                values=[]
                for prior in (True,False):
                    ports=dict(clean_str=clean_str,CURRICULUM_LEARNER_SCOPES=('programme','module'),JsonResponse=Response,
                        json_error=lambda message,status=400:Response({'error':message},status),
                        scope_learner_ksb_impact_payload=lambda r,s,i:({'scope':s,'id':i},None),
                        scope_learner_roster_response=lambda r,s,i:Response({'scope':s,'id':i}))
                    values.append(run(name,prior,[SimpleNamespace(GET=query)],ports))
                self.assertEqual(*values)

    def test_trace_identity_and_readiness_weight_rule(self):
        for status in (200,503):
            for items in ([],[{'code':'K1','raw_total_weight':None}],
                          [{'code':'K1','raw_total_weight':0.2},{'ksbId':'K2','raw_total_weight':-1}]):
                for name in ('curriculum_ksb_trace','curriculum_readiness_validation'):
                    outcomes=[]
                    for prior in (True,False):
                        ports=dict(JsonResponse=Response,json=json,coverage_normalise_code=lambda s:str(s or '').upper(),
                            coverage_response=lambda *a:Response({'items':items,'summary':{'total':len(items)}},status),
                            json_error=lambda message,status=400:Response({'error':message},status))
                        args=[SimpleNamespace(GET={})]+(['k2'] if name.endswith('trace') else [])
                        outcomes.append(run(name,prior,args,ports))
                    self.assertEqual(*outcomes)
        self.assertTrue(coverage_readiness({'items':[{'raw_total_weight':0.2}]})['ready'])

    def test_activity_import_failure_stays_outside_call_error_mapping(self):
        class StorageUnavailable(RuntimeError):
            pass
        def failure(*args):
            raise StorageUnavailable('synthetic')
        class BrokenImport:
            @property
            def enrich(self):
                return failure()
        for prior in (True, False):
            request = SimpleNamespace(GET={'moduleProgress':'1'})
            ports = dict(SchemaNotProvisioned=StorageUnavailable, DatabaseError=LookupError,
                JsonResponse=Response, json_error=lambda message,status=400:Response({'error':message},status),
                scope_learner_ksb_impact_payload=lambda *a:({'items':[]},None), load_activity_enricher=failure)
            with self.assertRaises(StorageUnavailable):
                run('curriculum_module_learner_ksb_impact', prior, [request,'M'], ports,
                    {'curriculum_api.learner_activity_status':BrokenImport()})
            ports['load_activity_enricher'] = lambda:failure
            result = run('curriculum_module_learner_ksb_impact', prior, [request,'M'], ports,
                         {'curriculum_api.learner_activity_status':SimpleNamespace(enrich=failure)})
            self.assertEqual(result[0],503)

    def test_upstream_error_keeps_response_and_skips_projection_work(self):
        for name in ('curriculum_programme_ksb_achievement', 'curriculum_programme_ksb_achievement_consumptions'):
            for prior in (True, False):
                response = Response({'error':'source unavailable'},503)
                ports = dict(JsonResponse=Mock(side_effect=AssertionError('Must not serialize again')),
                             _achievement_projection=lambda *a:(None,response))
                args = [SimpleNamespace(GET={'page':'invalid'}),'P']
                if name.endswith('consumptions'):
                    args.append('source:K')
                self.assertEqual(run(name,prior,args,ports),(503,{'error':'source unavailable'},{}))


if __name__ == '__main__':
    unittest.main()
