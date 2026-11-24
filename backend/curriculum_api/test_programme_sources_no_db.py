"""One normalized module source, with frozen pre-change behavior as the oracle.

Run through the isolated harness only: Django imports, SimpleTestCase forbids DB.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture, composition_fixtures
from collections import defaultdict
from contextlib import ExitStack, contextmanager
from .catalogue.application import programme_detail
from .catalogue.tests.parity.read_dependency_test_support import bind_test_defaults
from copy import deepcopy
from functools import partial
import inspect
import json
from pathlib import Path
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views, programme_workspace_reads
from .catalogue.application.programme_modules import ProgrammeModulesUnavailable
from .catalogue.domain.programme_scope import owns_record

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/programme_sources_snapshot.json').read_text(encoding='utf-8'))
PROGRAMME = {'id': 'PROG-A', 'sourceId': 'PROG-A', 'name': 'Shared title'}


def original(name, **ports):
    key = next(key for key in SNAPSHOT if key.endswith(':' + name)
               and not key.startswith('views.py:'))
    scope = {'defaultdict': defaultdict}
    exec(compile(SNAPSHOT[key]['source'], '<pre-programme-source>', 'exec'), scope)
    function = scope[name]
    dependencies = {key: ports.get(key, getattr(views, key, None))
                    for key, parameter in inspect.signature(function).parameters.items()
                    if parameter.kind == parameter.KEYWORD_ONLY
                    and parameter.default is parameter.empty}
    return partial(function, **dependencies)


def payload(identifier='MOD-A', **changes):
    return dict(catalogueId=identifier, programmeId='PROG-A', programmeName='Shared title',
                title='Saved module', description='', coverImage='saved.png',
                weeks=2, sessionsNumber=2, startDate='2028-01-03', endDate='2028-01-10',
                weekDays='Monday', startTime='09:00', endTime='10:00',
                weekStructure=[], moduleKsbMappings=[], **changes)


@contextmanager
def sources(rows=None, payloads=None, **overrides):
    rows = [{'module_catalogue_id': 'MOD-A', 'programme_id': 'PROG-A', 'status': 'active'}] if rows is None else rows
    payloads = {'MOD-A': payload()} if payloads is None else payloads
    bindings = dict(
        module_index_rows=Mock(return_value=rows),
        safe_module_index_rows=Mock(return_value=rows),
        get_authoring_structure_payloads=Mock(return_value=payloads),
        programme_config_modules=Mock(side_effect=AssertionError('config content must not be read')),
    )
    bindings.update(overrides)
    with ExitStack() as stack:
        for key, value in bindings.items():
            stack.enter_context(composition_fixture(views, key, value))
        children = stack.enter_context(patch.object(programme_workspace_reads, 'programme_structure_child_rows',
                                                   return_value={'modules': rows, 'weeks': [], 'components': [], 'mappings': []}))
        yield bindings, children


class ProgrammeSourceTests(SimpleTestCase):
    def test_detail_training_ownership_prefers_ids_over_shared_names(self):
        training = [{'identity': {'sourceId': 'PROG-A', 'name': 'Shared title'}},
                    {'identity': {'sourceId': 'PROG-B', 'name': 'Shared title'}}]
        captured = []
        def modules(rows, scoped_training, configs, **kwargs):
            captured.append(deepcopy(scoped_training))
            return []
        with composition_fixtures(views,
            get_cached_curriculum_rows=lambda **kw: {'training': training, 'ksb_profiles': [], 'modules': [], 'program_configs': []},
            build_programmes=lambda *a, **kw: [PROGRAMME],
            programme_identity=lambda row, *a: row['identity'],
            build_cohorts_and_groups=lambda *a, **kw: ([], []),
            build_modules=modules, programme_module_candidates=lambda *a, **kw: [],
            enrich_curriculum_modules_with_authoring_details=lambda value: value,
            programme_authoring_modules=lambda *a, **kw: [], programme_config_modules=lambda *a: [],
            read_programme_sessions=lambda *a: [], repair_curriculum_parent_links=lambda *a, **kw: None,
        ), bind_test_defaults(programme_detail, programme_identity=views.programme_identity):
            original('_build_curriculum_programme_tree_detail_payload')(
                'PROG-A', 'all', include_stats=False, include_components=False, section='modules')
            views._build_curriculum_programme_tree_detail_payload(
                'PROG-A', 'all', include_stats=False, include_components=False, section='modules')
        self.assertEqual(captured[0], training, 'pre-fix same-name leakage reproduced')
        self.assertEqual(captured[1], training[:1])

    def test_foreign_programme_config_cannot_inject_a_cohort_by_shared_name(self):
        config = {'programme_id': 'PROG-B', 'name': 'Shared title',
                  'cohorts': [{'id': 'C-FOREIGN', 'name': 'Wrong'}]}
        with composition_fixtures(views,
            get_cached_curriculum_rows=lambda **kw: {'training': [], 'ksb_profiles': [], 'modules': [], 'program_configs': [config]},
            build_programmes=lambda *a, **kw: [PROGRAMME],
            programme_config_for_programme=lambda *a: config,
            build_cohorts_and_groups=lambda *a, **kw: ([], []),
            repair_curriculum_parent_links=lambda *a, **kw: None,
        ):
            old = original('_build_curriculum_programme_tree_detail_payload')(
                'PROG-A', 'all', include_stats=False, section='shell')
            new = views._build_curriculum_programme_tree_detail_payload(
                'PROG-A', 'all', include_stats=False, section='shell')
        self.assertEqual([row['id'] for row in old['flat']['cohorts']], ['C-FOREIGN'])
        self.assertEqual(new['flat']['cohorts'], [])

    def test_actual_old_new_full_and_workspace_candidates_match_on_healthy_facts(self):
        modules = [{'moduleCatalogueId': 'MOD-A', 'name': 'Delivery name'}]
        with sources() as (reads, children):
            enrich = original('enrich_curriculum_modules_with_authoring_details')
            authored = original('programme_authoring_modules')
            old_full = enrich(modules) + authored(PROGRAMME, None)
            old_workspace = original('programme_workspace_module_candidates',
                component_text_cancels=programme_workspace_reads.component_text_cancels,
                programme_structure_child_rows=programme_workspace_reads.programme_structure_child_rows,
                enrich_curriculum_modules_with_authoring_details=enrich,
                programme_authoring_modules=authored, programme_config_modules=lambda config: [],
            )(modules, PROGRAMME, None)
            # Only enriched records gain the approved nullable study-week field.
            old_full = [{**row, 'weekBoundaryMode': None} if 'weekStartsOn' in row else row for row in old_full]
            old_workspace = [{**row, 'weekBoundaryMode': None} if 'weekStartsOn' in row else row for row in old_workspace]
            for workspace in (False, True):
                reads['get_authoring_structure_payloads'].reset_mock()
                children.reset_mock()
                actual = views.programme_module_candidates(modules, PROGRAMME, None, workspace_view=workspace)
                self.assertEqual(actual, old_workspace if workspace else old_full)
                reads['get_authoring_structure_payloads'].assert_called_once()
                self.assertEqual(children.call_args.kwargs['component_text'], not workspace)
            reads['module_index_rows'].assert_called_with(ensure_tables=False)
            reads['programme_config_modules'].assert_not_called()

    def test_cached_index_reused_and_inputs_unchanged(self):
        rows = [{'module_catalogue_id': 'MOD-A', 'programme_id': 'PROG-A'}]
        modules = [{'moduleCatalogueId': 'MOD-A'}]
        before = deepcopy((rows, modules))
        with sources() as (reads, _):
            views.programme_module_candidates(modules, PROGRAMME, None, module_rows=rows)
            reads['module_index_rows'].assert_not_called()
        self.assertEqual((rows, modules), before)

    def test_foreign_canonical_ids_cannot_match_by_name(self):
        rows = [{'module_catalogue_id': 'MOD-B', 'programme_id': 'PROG-B', 'programme_name': 'Shared title'}]
        with sources(rows=rows) as (reads, children):
            result = views.programme_module_candidates([{'moduleCatalogueId': 'MOD-B'}], PROGRAMME, None)
        self.assertEqual(result, [])
        children.assert_not_called()
        reads['get_authoring_structure_payloads'].assert_not_called()

    def test_known_noncanonical_foreign_ids_are_also_excluded(self):
        self.assertFalse(owns_record(PROGRAMME, 'another-row', 'Shared title', known_ids={'another-row'},
            clean_str=views.clean_str, matches_curriculum_identifier=views.matches_curriculum_identifier,
            identifier_looks_exact=views.programme_identifier_looks_exact))

    def test_unlinked_legacy_names_and_canonical_renames_remain_supported(self):
        for identifier, name in [('', 'Shared title'), ('PROG-A', 'Old name')]:
            self.assertTrue(owns_record(PROGRAMME, identifier, name, clean_str=views.clean_str,
                matches_curriculum_identifier=views.matches_curriculum_identifier,
                identifier_looks_exact=views.programme_identifier_looks_exact))

    def test_stale_delivery_and_config_cannot_create_modules(self):
        config = {'modules': [{'moduleCatalogueId': 'MOD-GHOST', 'title': 'Old content', 'weeks': 500}]}
        with sources(rows=[]) as (reads, children):
            actual = views.programme_module_candidates([{'moduleCatalogueId': 'MOD-GHOST'}], PROGRAMME, config)
        self.assertEqual(actual, [])
        children.assert_not_called()
        reads['get_authoring_structure_payloads'].assert_not_called()

    def test_empty_and_zero_authored_fields_do_not_resurrect_stale_values(self):
        stored = payload()
        stored.update(weeks=0, sessionsNumber=0, weekStructure=[], moduleKsbMappings=[],
                      startDate='', endDate='', coverImage='', title='', weekDays='', startTime='', endTime='')
        stale = dict(moduleCatalogueId='MOD-A', weeks=10, sessionsNumber=10,
                     weekStructure=[{'id': 'old'}], moduleKsbMappings=[{'code': 'OLD'}],
                     sessionNames=['Old session'], ksbCodes=['OLD'], startDate='2020', name='Old name')
        old = original('enrich_curriculum_modules_with_authoring_details',
                       get_authoring_structure_payloads=lambda *a, **k: {'MOD-A': stored})([stale])[0]
        current = views.enrich_curriculum_modules_with_authoring_details([stale], authoring_payloads={'MOD-A': stored})[0]
        self.assertEqual(old['weeks'], 10)
        self.assertEqual(old['weekStructure'], stale['weekStructure'])
        for key in ('weeks', 'sessionsNumber'):
            self.assertEqual(current[key], 0)
        for key in ('weekStructure', 'moduleKsbMappings', 'sessionNames', 'ksbCodes'):
            self.assertEqual(current[key], [])
        self.assertEqual(current['startDate'], '')
        self.assertEqual(current['name'], '')

    def test_normalized_ksb_codes_include_module_week_and_component_mappings(self):
        stored = payload()
        stored.update(moduleKsbMappings=[{'code': ' K1 '}], weekStructure=[{
            'title': 'Topic', 'ksbMappings': [{'code': 'S1'}],
            'components': [{'ksbMappings': [{'code': 'K1'}, {'code': 'B1'}]}],
        }])
        result = views.enrich_curriculum_modules_with_authoring_details(
            [{'moduleCatalogueId': 'MOD-A'}], authoring_payloads={'MOD-A': stored})[0]
        self.assertEqual(result['ksbCodes'], ['K1', 'S1', 'B1'])
        self.assertEqual(result['sessionNames'], ['Topic'])

    def test_missing_required_structure_fails_instead_of_bare_row_fallback(self):
        with sources(payloads={}):
            with self.assertRaises(ProgrammeModulesUnavailable):
                views.programme_module_candidates([], PROGRAMME, None)

    def test_ownership_change_between_index_and_structure_fails_closed(self):
        stored = payload()
        stored['programmeId'] = 'PROG-B'
        with sources(payloads={'MOD-A': stored}):
            with self.assertRaises(ProgrammeModulesUnavailable):
                views.programme_module_candidates([], PROGRAMME, None)

    def test_reader_failure_is_not_a_successful_empty_list(self):
        with sources(module_index_rows=Mock(side_effect=RuntimeError('unavailable'))):
            with self.assertRaises(ProgrammeModulesUnavailable):
                views.programme_module_candidates([], PROGRAMME, None)

    def test_config_reference_export_batches_and_ignores_embedded_content(self):
        stored = payload()
        config = {'modules': [{'moduleCatalogueId': 'MOD-A', 'title': 'Wrong'}, 'MOD-A',
                              {'module_catalogue_id': 'MOD-A'}, {'id': 'MOD-A'},
                              {'sourceId': 'MOD-A'}, {'title': 'Ghost'}, 'MOD-MISSING']}
        with composition_fixture(views, 'get_authoring_structure_payloads', return_value={'MOD-A': stored}) as read:
            result = views.programme_config_modules(config)
        read.assert_called_once_with(['MOD-A', 'MOD-MISSING'])
        self.assertEqual([item['name'] for item in result], ['Saved module'])

    def test_full_and_section_http_failures_are_503_not_cached_success(self):
        for section in (None, 'modules'):
            with self.subTest(section=section), composition_fixture(views, 'repair_curriculum_parent_links'), \
                 composition_fixture(views, 'build_curriculum_programme_tree_detail_payload', side_effect=ProgrammeModulesUnavailable('private diagnostic')), \
                 composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()):
                request = RequestFactory().get('/?visibility=all&deferStats=1')
                response = (views.curriculum_programme_tree_detail(request, 'PROG-A') if section is None
                            else views.curriculum_programme_detail_section(request, 'PROG-A', section))
                self.assertEqual(response.status_code, 503)
                self.assertEqual(json.loads(response.content), {'error': 'Programme modules could not be loaded. Please try again.'})
