"""Consumer parity against the original programme reads on synthetic fixtures."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from curriculum_api import views, home_summary, programme_list
from curriculum_api.catalogue.application import programme_detail, home_projection
from curriculum_api.catalogue.tests.test_home_summary_no_db import source_data
from curriculum_api.catalogue.tests import tests_programme_detail_sections as detail_fixtures
from curriculum_api.catalogue.tests import test_programme_list_no_db as list_fixtures

SNAPSHOT = json.loads((Path(__file__).parents[2]/'catalogue/tests/fixtures/legacy_snapshots/programme_reads_snapshot.json').read_text())


@contextmanager
def original_reads():
    with ExitStack() as stack:
        # The old detail builder used a generated-session port. Supply the same
        # reviewed fixture output to compare its unchanged outer document only.
        stack.enter_context(composition_fixture(views, 'build_sessions_basic',
            lambda *a, **k: [{'id': 'S-1'}], create=True))
        from curriculum_api.catalogue.infrastructure import projection_sources
        from curriculum_api import curriculum_names
        from curriculum_api.catalogue.tests.test_projection_consumer_boundary_no_db import original
        module_authoring_facts = original("home_summary.py")
        supplied = {
            **{name: value for name, value in vars(projection_sources).items() if name.endswith('_FIELDS')},
            'curriculum_names': curriculum_names,
            'decode_counts': module_authoring_facts.decode_counts,
            'ksb_counts_selection': module_authoring_facts.ksb_counts_selection,
            'apply_authoring_facts': module_authoring_facts.apply_authoring_facts,
            'project_home': home_summary.project_home,
            'Counter': __import__('collections').Counter,
        }
        for name, value in supplied.items():
            stack.enter_context(composition_fixture(views, name, value, create=True))
        for key, entry in SNAPSHOT.items():
            filename,name=key.split(':')
            owner=importlib.import_module('curriculum_api.'+filename[:-3])
            if (filename == 'programme_list.py' or
                    filename == 'home_summary.py' and name in {
                        'home_relationship_rows', 'home_source_rows',
                        'home_programmes_need_enrichment', 'build_home_summary'}):
                owner = views
            if filename in {'home_summary.py', 'programme_list.py'}:
                stack.enter_context(patch.object(owner, 'views', views, create=True))
            # Preserve the same fixture-provided read results in both branches.
            if isinstance(getattr(owner,name),Mock):
                continue
            namespace=dict(vars(owner))
            exec(compile(entry['source'],'<frozen-programme-reads>','exec'),namespace)
            source=namespace[name]
            fn=FunctionType(source.__code__,vars(owner),name,source.__defaults__)
            fn.__kwdefaults__=source.__kwdefaults__
            if name=='active_learner_programme_counts': fn=views.scoped_curriculum_read(fn)
            stack.enter_context(composition_fixture(owner,name,fn))
        yield


class ProgrammeReadBoundaryParity(SimpleTestCase):
    def test_home_full_projection_and_public_summary_parity(self):
        for data in (source_data(), {'modules':[],'programmes':[],'groups':[],'cohorts':[]}):
            before=deepcopy(data)
            with original_reads():
                old_full=home_summary.project_home(data,data['programmes'])
                old_summary=home_summary.project_home_summary(data,data['programmes'])
            with patch.object(home_projection,'project_home',wraps=home_projection.project_home) as spy:
                self.assertEqual(home_summary.project_home(data,data['programmes']),old_full)
                self.assertEqual(home_summary.project_home_summary(data,data['programmes']),old_summary)
                self.assertTrue(spy.called)
            self.assertEqual(data,before)

    def test_detail_shell_modules_full_and_tree_parity(self):
        fixture=detail_fixtures.ProgrammeDetailSectionTests()
        outer=views.build_curriculum_programme_tree_detail_payload
        for section in ('shell','modules',None):
            for tree in (False,True):
                with self.subTest(section=section,tree=tree):
                    def build(*args,**kwargs):
                        return outer(*args,**{**kwargs,'include_tree':tree})
                    with composition_fixture(views,'build_curriculum_programme_tree_detail_payload',side_effect=build):
                        with original_reads(): expected=fixture.build(section)
                        with patch.object(programme_detail,'_build_curriculum_programme_tree_detail_payload',
                                          wraps=programme_detail._build_curriculum_programme_tree_detail_payload) as spy:
                            actual=fixture.build(section)
                        self.assertEqual(actual,expected)
                        self.assertTrue(spy.called)

    def test_detail_never_enables_parent_repair(self):
        fixture=detail_fixtures.ProgrammeDetailSectionTests()
        original=programme_detail._build_curriculum_programme_tree_detail_payload
        repair=Mock()
        def invoke(*args,**kwargs):
            kwargs['repair_curriculum_parent_links']=repair
            return original(*args,**kwargs)
        with patch.object(programme_detail,'_build_curriculum_programme_tree_detail_payload',side_effect=invoke):
            fixture.build('shell')
        repair.assert_called_once_with('PROG-1',allow_writes=False)

    def test_list_operational_archive_values_and_read_order_parity(self):
        fixture=list_fixtures.ProgrammeListTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        for visibility in ('operational','all'):
            fixture.reads.clear()
            with original_reads(): expected=views.build_programme_list(visibility)
            old_reads=list(fixture.reads)
            fixture.reads.clear()
            actual=views.build_programme_list(visibility)
            self.assertEqual(actual,expected)
            self.assertEqual(fixture.reads,old_reads)
