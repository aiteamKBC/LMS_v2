"""Actual pre-change consumer code versus the composed reads; synthetic data only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_patch
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import ast
import builtins
from copy import deepcopy
import hashlib
import inspect
import json
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import home_summary, programme_list, views
from .catalogue.application import home_projection, projections
from . import test_home_source_no_db as home_fixtures
from . import test_programme_list_no_db as list_fixtures
from .test_home_summary_no_db import source_data

ROOT = Path(__file__).parent
DATA = (ROOT / 'catalogue/tests/fixtures/legacy_snapshots/projection_consumers_snapshot.json').read_bytes()

assert hashlib.sha256(DATA).hexdigest() == 'eb5a7650949bb6e242feae941303371ac87379c54163ce0d5e625233e6ac1257'


def original(filename):
    module = ModuleType('curriculum_api.frozen_projection_consumer')
    module.__package__ = 'curriculum_api'
    exec(compile(json.loads(DATA)[filename], '<frozen-' + filename + '>', 'exec'), vars(module))
    facts = ModuleType('curriculum_api.frozen_authoring_facts')
    facts.__package__ = 'curriculum_api'
    source = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/module_authoring_facts_snapshot.json').read_text())['source']
    exec(compile(source, '<frozen-authoring-facts>', 'exec'), vars(facts))
    for name in ('apply_authoring_facts', 'decode_counts', 'ksb_counts_selection'):
        setattr(module, name, getattr(facts, name))
    return module


class ProjectionConsumerParity(SimpleTestCase):
    def fixture(self, kind):
        fixture = kind()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        return fixture

    def test_public_exports_keep_signatures_and_single_owners(self):
        # Bound internal call contracts now live at the runtime entry point;
        # reusable exports require explicit dependencies instead of importing it.
        bound = {
            'home_summary.py': ('home_relationship_rows', 'home_source_rows',
                                'home_programmes_need_enrichment', 'build_home_summary',
                                '_home_projection', 'curriculum_home_summary', 'curriculum_home_attention'),
            'programme_list.py': ('programme_list_sources', 'programme_list_learner_counts',
                                  'programme_list_needs_module_enrichment', 'build_programme_list'),
        }
        for filename, names in bound.items():
            old = original(filename)
            for name in names:
                self.assertEqual(inspect.signature(getattr(old, name)),
                                 inspect.signature(getattr(views, name)), name)
        for name in ('_clean', '_key', '_missing', '_zero', '_date_value',
                     'project_home_summary', 'summary_only', 'project_home'):
            self.assertIs(getattr(home_summary, name), getattr(home_projection, name))
        self.assertIs(home_summary.build_home_summary, projections.build_home_summary)
        self.assertIs(programme_list.build_programme_list, projections.build_programme_list)

    def test_home_payload_and_read_order_match_actual_original(self):
        fixture = self.fixture(home_fixtures.HomeSourceTests)
        old = original('home_summary.py')
        for visibility in ('operational', 'all'):
            fixture.calls.clear()
            expected = old.build_home_summary(visibility)
            expected_calls = deepcopy(fixture.calls)
            fixture.calls.clear()
            with patch.object(projections, 'build_home_summary', wraps=projections.build_home_summary) as invoked:
                self.assertEqual(views.build_home_summary(visibility), expected)
            self.assertEqual(invoked.call_count, 1)
            self.assertEqual(fixture.calls, expected_calls)

    def test_module_only_home_enrichment_matches_original(self):
        fixture = self.fixture(home_fixtures.HomeSourceTests)
        fixture.modules.append({'module_catalogue_id': 'MOD-SYNTH', 'programme_id': 'P-ORPHAN',
                                'programme_name': 'Synthetic orphan', 'title': 'Synthetic', 'status': 'active'})
        old = original('home_summary.py')
        for visibility in ('operational', 'all'):
            self.assertEqual(views.build_home_summary(visibility), old.build_home_summary(visibility))

    def test_programme_cards_and_read_order_match_actual_original(self):
        fixture = self.fixture(list_fixtures.ProgrammeListTests)
        old = original('programme_list.py')
        for visibility in ('operational', 'all'):
            fixture.reads.clear()
            expected = old.build_programme_list(visibility)
            expected_calls = deepcopy(fixture.reads)
            fixture.reads.clear()
            with patch.object(projections, 'build_programme_list', wraps=projections.build_programme_list) as invoked:
                self.assertEqual(views.build_programme_list(visibility), expected)
            self.assertEqual(invoked.call_count, 1)
            self.assertEqual(fixture.reads, expected_calls)

    def test_programme_enrichment_archive_and_duplicate_contract(self):
        fixture = self.fixture(list_fixtures.ProgrammeListTests)
        fixture.configs.append(dict(fixture.configs[0]))
        fixture.configs[0]['status'] = 'archived'
        fixture.modules.append({'module_catalogue_id': 'MOD-ONLY', 'programme_id': 'PROG-ONLY',
                                'programme_name': 'Synthetic orphan', 'title': 'Synthetic', 'status': 'active'})
        old = original('programme_list.py')
        for visibility in ('operational', 'all'):
            self.assertEqual(views.build_programme_list(visibility), old.build_programme_list(visibility))

    def test_postgresql_source_sql_and_parameter_order_match(self):
        for filename, module, function in (('home_summary.py', views, 'home_relationship_rows'),
                                            ('programme_list.py', views, 'programme_list_sources')):
            old = original(filename)
            options = ({}, {'include_weeks': True}) if function.startswith('home') else ({},)
            for kwargs in options:
                with composition_fixture(views, 'connection', vendor='postgresql'), \
                     composition_fixture(views, 'ensure_module_authoring_tables') as ensure, \
                     composition_fixture(views, 'fetch_all', return_value=[{'modules': '[]', 'ksb_counts': '{}'}]) as fetch:
                    expected = getattr(old, function)(**kwargs)
                    expected_call = fetch.call_args
                    fetch.reset_mock()
                    self.assertEqual(getattr(module, function)(**kwargs), expected)
                    self.assertEqual(fetch.call_args, expected_call)
                    self.assertEqual(fetch.call_count, 1)
                    self.assertEqual(ensure.call_count, 2)

    def test_source_errors_propagate_in_both_implementations(self):
        self.fixture(home_fixtures.HomeSourceTests)
        old = original('home_summary.py')
        with composition_fixture(views, 'authoring_fetch_all', side_effect=RuntimeError('synthetic unavailable')):
            for build in (old.build_home_summary, views.build_home_summary):
                with self.assertRaisesMessage(RuntimeError, 'synthetic unavailable'):
                    build('operational')

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_http_visibility_force_cache_key_and_bytes_match(self):
        old = original('home_summary.py')
        for query in ('', '?visibility=all', '?skipCache=1', '?_ts=synthetic'):
            request = RequestFactory().get('/curriculum_api/curriculum/home-summary/' + query)
            outcomes = []
            for module in (old, views):
                with composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()) as cache, \
                     composition_fixture(module, 'build_home_summary', return_value={'stats': {}, 'attentionRecords': {}}) as build:
                    response = module.curriculum_home_summary(request)
                    outcomes.append((response.status_code, dict(response.items()), response.content,
                                     cache.call_args.args[0], cache.call_args.kwargs, build.call_args))
            self.assertEqual(*outcomes)

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_shared_snapshot_hit_and_stale_contract_match(self):
        old = original('home_summary.py')
        data = source_data()
        for stale in (False, True):
            snapshot = SimpleNamespace(payload={'overview': data, 'programmes': data['programmes']}, stale=stale)
            outcomes = []
            for module in (old, views):
                with composition_patch('curriculum_api.read_model.get_curriculum_home', return_value=snapshot), \
                     composition_patch('curriculum_api.read_model.enqueue_curriculum_home_refresh') as enqueue, \
                     composition_fixture(views, 'cached_curriculum_value', side_effect=AssertionError('cache must not run')):
                    response = module.curriculum_home_summary(RequestFactory().get('/curriculum_api/curriculum/home-summary/'))
                    outcomes.append((response.content, dict(response.items()), enqueue.call_args_list))
            self.assertEqual(*outcomes)

    def test_attention_errors_and_post_rejection_match(self):
        old = original('home_summary.py')
        for request in (RequestFactory().get('/home-attention/'),
                        RequestFactory().get('/home-attention/?issue=bad'),
                        RequestFactory().get('/home-attention/?issue=group-coach&programme=P1'),
                        RequestFactory().post('/home-attention/')):
            outcomes = []
            for module in (old, views):
                with patch.object(module, '_home_projection', side_effect=AssertionError('invalid request reads nothing')):
                    response = module.curriculum_home_attention(request)
                    outcomes.append((response.status_code, dict(response.items()), response.content))
            self.assertEqual(*outcomes)

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_disabled_read_model_does_not_import_or_register_it(self):
        real_import = builtins.__import__

        def guarded_import(name, *args, **kwargs):
            if name == 'read_model' or name.startswith('read_models'):
                raise AssertionError('Disabled read model must remain unloaded')
            return real_import(name, *args, **kwargs)

        with patch.object(builtins, '__import__', side_effect=guarded_import), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()), \
             composition_fixture(views, 'build_home_summary', return_value={'stats': {}}), \
             patch.object(home_summary, 'curriculum_home_summary', wraps=home_summary.curriculum_home_summary) as handler:
            response = views.curriculum_home_summary(RequestFactory().get('/curriculum_api/curriculum/home-summary/'))
        self.assertEqual(response.status_code, 200)
        handler.assert_called_once()
        self.assertIs(handler.call_args.kwargs['load_projection'], views._home_projection)
