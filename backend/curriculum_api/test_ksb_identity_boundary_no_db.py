"""Frozen-source KSB read parity and deliberate identity corrections.

Django imports require the isolated harness; SimpleTestCase forbids databases.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from functools import partial
import inspect
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views
from .catalogue.api import ksb_sources
from .reporting.application import source_catalogue
from .reporting.domain import sources

SNAPSHOT = json.loads((Path(__file__).parent / 'reporting/tests/fixtures/legacy_snapshots/ksb_identity_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_views():
    with ExitStack() as stack:
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            if filename != 'views.py' or isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-ksb-identity>', 'exec'), namespace)
            old = namespace[name]
            restored = FunctionType(old.__code__, vars(views), name, old.__defaults__)
            restored.__kwdefaults__ = old.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(views))(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


def old_owner(name):
    entry = next(value for key, value in SNAPSHOT.items()
                 if not key.startswith('views.py:') and key.endswith(':' + name))
    namespace = {}
    exec(compile(entry['source'], '<pre-ksb-source-owner>', 'exec'), namespace)
    fn = namespace[name]
    return partial(fn, **{key: getattr(views, key) for key, value in inspect.signature(fn).parameters.items()
                         if value.kind == value.KEYWORD_ONLY and value.default is value.empty})


class KsbIdentityBoundaryTests(SimpleTestCase):
    def compare(self, name, *args):
        plain_args = tuple(value for value in args if not hasattr(value, "META"))
        before = deepcopy(plain_args)
        with original_views():
            expected = getattr(views, name)(*args)
        owner = ksb_sources if name.startswith('curriculum_') else sources
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args)
        called.assert_called_once()
        self.assertEqual(plain_args, before)
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (expected.status_code, expected.content, dict(expected.items())))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_code_and_type_rules_match_actual_old_functions(self):
        for value in (None, '', ' K1.2 ', 'skill', 'BEHAVIORS', 'invalid', 'S007', 0):
            self.compare('ksb_type_label', value)
            self.compare('normalise_ksb_type', value)
            for kind in ('K', 'skills', 'B', ''):
                self.compare('normalise_ksb_code', value, kind)
        for item in ({}, {'type': 'Skill', 'code': 'S1.2'}, {'full_code': 'K2'}):
            self.compare('full_ksb_code', item)

    def test_stored_source_prefix_and_context_compatibility(self):
        for value in (None, '', ' KSBP-X ', 'profile:KSBP-X', 'FRAMEWORK: KSBP-X ',
                      'standard:st001-v1', 'unknown:stored'):
            self.compare('normalise_ksb_profile_source_value', value)
        for data in (None, {}, {'programme_ids': '[" P1 ", "P1", "P2"]'}, {'programme_ids': 'bad'}):
            self.compare('ksb_profile_context_ids', data, 'programme_ids', 'P0')

    def test_required_codes_and_legacy_session_inputs_preserve_rules(self):
        for data in (None, {}, {'ksb_items': [{'type': 'K', 'code': '1'}, {'type': 'S', 'code': '2'}, None]},
                     {'knowledge_codes': ['K1', 'K1'], 'skill_codes': ['S1']}):
            self.compare('ksb_profile_required_codes', data)
        for data in ('invalid', {}, [], [{'knowledgeCodes': ['K1', 'K1'], 'skillCodes': ['S1']}, None]):
            self.compare('codes_from_session_ksb', data)

    def test_valid_public_ids_preserve_precedence(self):
        for profile in ({'id': 'KSBP-A', 'ksb_profile_id': 'KSBP-B'},
                        {'id': 17, 'ksb_profile_id': 'KSBP-A'}):
            self.compare('ksb_profile_source_id', profile)

    def test_reads_never_generate_ids_and_legacy_row_ids_stay_stable(self):
        profile = {'id': 17, 'name': 'Same display name'}
        with composition_fixture(views, 'unique_ksb_profile_id', side_effect=['KSBP-FIRST', 'KSBP-SECOND']) as create:
            with original_views():
                self.assertNotEqual(views.ksb_profile_source_id(profile), views.ksb_profile_source_id(profile))
            create.reset_mock()
            self.assertEqual([views.ksb_profile_source_id(profile) for _ in range(3)], ['17'] * 3)
            for value in (None, {}, {'name': 'No stored identity'}):
                self.assertEqual(views.ksb_profile_source_id(value), '')
            create.assert_not_called()

    def test_identity_less_profile_cannot_name_a_programme(self):
        invalid = {'name': 'Shared', 'programme_ids': ['P']}
        valid = {'id': 'KSBP-REAL', 'name': 'Shared', 'programme_ids': ['P']}
        self.assertIs(views.get_ksb_profile_for_program('P', [invalid, valid]), valid)
        self.assertIsNone(views.programme_applied_ksb_profile({}, [invalid], 'Shared'))
        self.assertIs(views.programme_applied_ksb_profile({}, [invalid, valid], 'Shared'), valid)

    def test_identity_less_profile_cannot_emit_a_fabricated_framework(self):
        with composition_fixture(views, 'unique_ksb_profile_id', side_effect=AssertionError('read invoked ID writer')):
            for summary in (False, True):
                with self.assertRaisesRegex(ValueError, 'no stored identity'):
                    views.build_ksb_data([{'name': 'Missing ID', 'ksb_items': []}], [], [], summary_only=summary)

    def test_legacy_persisted_profile_identity_reaches_full_and_summary_payloads(self):
        profile = {'id': 17, 'name': 'Legacy stored row', 'is_active': True,
                   'ksb_items': [{'type': 'K', 'code': '1'}]}
        for summary in (False, True):
            frameworks, sets = views.build_ksb_data([profile], [], [], summary_only=summary)
            self.assertEqual(frameworks[0]['id'], '17')
            self.assertEqual(sets[0]['frameworkId'], '17')
            self.assertEqual(frameworks[0]['profileId'], 17)

    def test_programme_exact_id_wins_over_an_earlier_name_collision(self):
        rows = [{'programme_id': 'PROG-WRONG', 'name': 'PROG-TARGET', 'ksb_profile_source_id': 'standard:wrong'},
                {'programme_id': 'PROG-TARGET', 'name': 'Actual', 'ksb_profile_source_id': 'standard:correct'}]
        with composition_fixture(views, 'get_program_config_rows', return_value=rows):
            self.assertEqual(old_owner('programme_row_ksb_source')('PROG-TARGET'), ('standard', 'wrong'))
            self.assertEqual(views.programme_row_ksb_source('PROG-TARGET'), ('standard', 'correct'))
            self.assertEqual(views.programme_row_ksb_source('Actual'), ('standard', 'correct'))

    def test_missing_canonical_programme_does_not_match_another_programmes_name(self):
        rows = [{'programme_id': 'PROG-WRONG', 'name': 'PROG-MISSING', 'ksb_profile_source_id': 'standard:wrong'}]
        with composition_fixture(views, 'get_program_config_rows', return_value=rows):
            self.assertEqual(old_owner('programme_row_ksb_source')('PROG-MISSING'), ('standard', 'wrong'))
            self.assertEqual(views.programme_row_ksb_source('PROG-MISSING'), ('', ''))

    def test_real_stored_source_reaches_coverage_before_module_and_name_fallbacks(self):
        rows = [{'programme_id': 'PROG-WRONG', 'name': 'PROG-TARGET', 'ksb_profile_source_id': 'standard:wrong'},
                {'programme_id': 'PROG-TARGET', 'name': 'Target', 'ksb_profile_source_id': 'standard:correct'}]
        with composition_fixture(views, 'get_program_config_rows', return_value=rows), \
             composition_fixture(views, 'build_skills_england_standards', side_effect=AssertionError('unexpected fallback')):
            self.assertEqual(views.infer_source_from_scope([{'programme_id': 'PROG-TARGET', 'ksb_profile_source_id': 'standard:stale'}]),
                             ('standard', 'correct', 'programme'))

    def test_standards_get_detail_missing_and_etag_preserve_http_contract(self):
        standard = {'id': 'st-test-v1', 'name': 'Synthetic standard', 'ksbs': []}
        request = RequestFactory().get('/standards/')
        with composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()), \
             composition_fixture(views, 'build_skills_england_standards', return_value=[standard]), \
             composition_fixture(views, 'find_skills_england_standard', side_effect=lambda identifier: standard if identifier == standard['id'] else None):
            response = self.compare('curriculum_standards', request)
            self.compare('curriculum_standard_detail', request, standard['id'])
            self.compare('curriculum_standard_detail', request, 'missing')
            conditional = RequestFactory().get('/standards/', HTTP_IF_NONE_MATCH=response['ETag'])
            self.assertEqual(self.compare('curriculum_standards', conditional).status_code, 304)

    def test_retired_framework_routes_preserve_statuses_and_cannot_write(self):
        for method in ('get', 'post', 'patch', 'delete', 'put'):
            request = getattr(RequestFactory(), method)('/frameworks/')
            with composition_fixture(views, 'get_cached_payload', return_value={'schema': views.CURRICULUM_SCHEMA, 'ksbFrameworks': []}), \
                 composition_fixture(views, 'unique_ksb_profile_id', side_effect=AssertionError('unexpected writer')):
                self.compare('curriculum_ksb_framework_collection', request)
                self.compare('curriculum_ksb_framework_detail', request, 'KSBP-MISSING')
        request = RequestFactory().get('/sets/')
        self.compare('curriculum_ksb_sets', request)
        self.compare('curriculum_ksb_set_definitions', request, 'KSBP-MISSING')
