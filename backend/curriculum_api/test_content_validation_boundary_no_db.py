"""Actual frozen-source parity for the authoring validation boundary; DB forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import calendar_policy, video_uploads, views

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/content_validation_snapshot.json').read_text())


@contextmanager
def original_content_validation():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-content-validation>', 'exec'), namespace)
            original = namespace[name]
            function = FunctionType(original.__code__, vars(views), name, original.__defaults__)
            function.__kwdefaults__ = original.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, function))
        yield


class ContentValidationParity(SimpleTestCase):
    def compare(self, name, *args, **kwargs):
        old_args, old_kwargs = deepcopy(args), deepcopy(kwargs)
        new_args, new_kwargs = deepcopy(args), deepcopy(kwargs)
        def invoke(arguments, keywords):
            try:
                return ('return', getattr(views, name)(*arguments, **keywords))
            except (TypeError, ValueError, AttributeError, DatabaseError) as error:
                return ('raise', type(error), str(error))
        with original_content_validation():
            expected = invoke(old_args, old_kwargs)
        owner = importlib.import_module(SNAPSHOT[name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = invoke(new_args, new_kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs))
        return actual

    def test_type_aliases_and_unknown_labels(self):
        for value in (None, '', 'live_session', 'Reading Material', 'Power Point',
                      'checkpoint quiz', 'Monthly KSB Quiz', 'video', 'unrecognized_type', '  assignment  '):
            for name in ('frontend_component_type', 'display_component_type', 'stored_component_type'):
                with self.subTest(name=name, value=value):
                    self.compare(name, value)

    def test_resource_and_uploaded_mp4_urls(self):
        prefix = '/curriculum_api/curriculum/uploads/'
        for value in (None, '', 'https://example.invalid/x', 'ftp://example.invalid/x',
                      prefix + 'old/lesson.MP4', prefix + 'videos/module/M/C/hash.mp4',
                      prefix + '../secret.mp4', prefix + '%2e%2e/secret.mp4',
                      prefix + 'a.mp4?x=1', prefix + 'a.mp4#part', '//example.invalid/x.mp4',
                      prefix + 'a\\b.mp4', 'file:///secret.mp4'):
            for name in ('http_url', 'component_resource_url', 'component_uploaded_video_url'):
                with self.subTest(name=name, value=value):
                    self.compare(name, value)
        self.assertFalse(views.component_uploaded_video_url(prefix + '%2e%2e/secret.mp4'))

    def test_provider_host_matching_without_provider_calls(self):
        for url in ('https://youtube.com/a', 'https://www.youtube.com/a', 'https://youtube.com.evil.invalid/a',
                    'https://youtube.com@evil.invalid/a', 'https://youtu.be/a', 'not a URL'):
            self.compare('host_matches', url, {'youtube.com', 'youtu.be'})

    def test_otjh_aliases_defaults_and_negative_values(self):
        for component in (None, {}, {'expectedOtjh': 0}, {'expectedOtjh': '-3'},
                          {'expectedOtjh': '', 'expected_otjh': '4.5'}, {'expectedOtjh': 'invalid'}):
            self.compare('component_expected_otjh', component, 7)

    def test_reflection_explicit_empty_is_not_replaced_by_legacy_prompt(self):
        for component in ({'reflectionQuestion': '', 'settings': {'reflectionPrompt': 'Old'}},
                          {'reflection_question': 'New'}, {'settings': {'reflectionPrompt': 'Old'}},
                          {'settings': []}, {}):
            self.compare('payload_reflection_question', component)
        self.assertEqual(views.payload_reflection_question(
            {'reflectionQuestion': '', 'settings': {'reflectionPrompt': 'Old'}}), '')

    def test_retired_filter_and_input_aliasing_are_preserved(self):
        components = [{'id': 'A', 'type': 'reading'}, {'id': 'B', 'type': 'coaching-preparation'}, None]
        self.compare('active_components_payload', components)
        self.compare('without_retired_components', [{'title': 'Week', 'components': components}, None])
        self.assertIs(views.active_components_payload(components)[0], components[0])
        weeks = [{'title': 'Week', 'components': components}]
        result = views.without_retired_components(weeks)
        self.assertIsNot(result[0], weeks[0])
        self.assertIs(result[0]['components'][0], components[0])

    def test_partial_read_markers_and_error_order(self):
        for payload in (None, [], {}, {'settingsOmitted': ['text']}, {'componentsOmitted': True},
                        {'weekStructureOutline': True, 'settingsOmitted': True}):
            self.compare('partial_read_errors', payload, 'week.0')

    def test_component_errors_and_normalized_settings_match(self):
        component = {'title': '', 'type': 'reading', 'expectedOtjh': -1, 'points': -2,
                     'reflectionRequired': True, 'settings': {'version': 'bad', 'contentStatus': 'bad',
                     'resourceUrl': 'file:///secret', 'audioUrl': 'invalid', 'customLegacyKey': 'keep'}}
        self.compare('validate_component_authoring_payload', component, 'component.2')

    def test_video_sources_statuses_and_uploaded_paths(self):
        for source, url in (('YouTube', 'https://youtube.com/watch?v=test'),
                            ('YouTube', 'https://youtube.com.evil.invalid/'),
                            ('Vimeo', 'https://vimeo.com/1'), ('HTML (MP4)', '/private/a.mp4'),
                            ('Upload file', '/curriculum_api/curriculum/uploads/old/a.mp4'),
                            ('HTML (MP4)', '/curriculum_api/curriculum/uploads/videos/module/M/C/hash.mp4'),
                            ('External link', 'https://example.invalid/a'), ('Embed', ''), ('Shortcode', '')):
            for status in ('Draft', 'Approved'):
                with self.subTest(source=source, status=status):
                    self.compare('validate_component_authoring_payload',
                        {'title': 'Lesson', 'type': 'video', 'settings': {
                            'sourceType': source, 'videoUrl': url, 'contentStatus': status,
                            'requiredProgressPercentage': 101}}, 'component')

    def test_non_video_resource_types_and_reflection(self):
        for kind, settings in (('podcast', {'podcastSource': 'Embed', 'contentStatus': 'Approved'}),
                               ('podcast', {'podcastUrl': 'invalid', 'requiredProgressPercentage': -1}),
                               ('reading', {'resourceUrl': '/curriculum_api/curriculum/uploads/reading.pdf'}),
                               ('powerpoint', {'presentationUrl': 'invalid'}),
                               ('assignment', {'assignmentBrief': 'Preserve'})):
            self.compare('validate_component_authoring_payload',
                {'title': 'Content', 'type': kind, 'reflectionQuestion': 'Why?',
                 'reflectionRequired': True, 'settings': settings}, 'component')

    def test_malformed_module_shapes_remain_errors_or_existing_exceptions(self):
        for payload in (None, {}, {'title': 'Module', 'weekStructure': 4},
                        {'title': 'Module', 'weeks': []}, {'title': 'Module', 'weekStructure': [None]},
                        {'title': 'Module', 'weekStructure': [{'title': 'Week', 'components': 3}]},
                        {'title': 'Module', 'weekStructureOutline': True}):
            self.compare('validate_module_authoring_payload', payload)

    def test_calendar_and_schedule_errors_are_ordered_and_bounded(self):
        for payload in ({'calendarPolicy': 4}, {'calendarPolicy': {'country': 'INVALID'}},
                        {'calendar_policy': None, 'scheduleMode': 'invalid'},
                        {'scheduleMode': 'custom', 'weeklySchedule': []}, {'weekStartsOn': 'INVALID'}):
            self.compare('validate_module_authoring_payload', {'title': 'Module', **payload})

    def test_ksb_shape_and_lookup_short_circuit(self):
        with composition_fixture(views, 'source_record_exists', return_value=True) as exists, \
             composition_fixture(views, 'ksb_exists_in_source', return_value=True) as contains:
            result = self.compare('validate_ksb_mapping_payload', {}, 'mapping')
        self.assertEqual(result[0], 'return')
        exists.assert_not_called()
        contains.assert_not_called()

    def test_ksb_source_decisions_cache_identity_and_failures(self):
        mapping = {'code': 'K1', 'classification': 'main', 'weight_class': 'hard',
                   'weight': 10, 'sourceType': 'standard', 'sourceId': 'ST0001'}
        for present, belongs in ((False, False), (True, False), (True, True)):
            calls = []
            def exists(kind, key, cache):
                calls.append(('exists', kind, key, id(cache)))
                return present
            def contains(kind, key, code, cache):
                calls.append(('contains', kind, key, code, id(cache)))
                return belongs
            with composition_fixture(views, 'source_record_exists', side_effect=exists), \
                 composition_fixture(views, 'ksb_exists_in_source', side_effect=contains):
                self.compare('validate_ksb_mapping_payload', mapping, 'mapping', {})
            split = 2 if present else 1
            self.assertEqual([c[:-1] for c in calls[:split]], [c[:-1] for c in calls[split:]])
            self.assertEqual(len(calls), split * 2)
            if present:
                self.assertEqual(calls[0][-1], calls[1][-1])
        with composition_fixture(views, 'source_record_exists', side_effect=DatabaseError('synthetic read failure')):
            self.assertEqual(self.compare('validate_ksb_mapping_payload', mapping)[0], 'raise')

    def test_duplicate_ksb_keys_and_component_validation_share_source_cache(self):
        mapping = {'code': 'K1', 'classification': 'main', 'weight_class': 'hard', 'weight': 10,
                   'sourceType': 'standard', 'sourceId': 'ST0001'}
        self.compare('validate_mapping_duplicates', [mapping, deepcopy(mapping)], 'mappings')
        payload = {'title': 'Module', 'weekStructure': [{'title': 'Week', 'components': [
            {'title': 'Content', 'type': 'reading', 'settings': {}, 'ksbMappings': [mapping, mapping]}]}]}
        with composition_fixture(views, 'source_record_exists', return_value=True) as exists, \
             composition_fixture(views, 'ksb_exists_in_source', return_value=True):
            result = self.compare('validate_module_authoring_payload', payload)
        self.assertTrue(any('already mapped' in e['message'] for e in result[1]))
        self.assertEqual(exists.call_count, 4)
        self.assertIs(exists.call_args_list[0].args[2], exists.call_args_list[1].args[2])
        self.assertIs(exists.call_args_list[2].args[2], exists.call_args_list[3].args[2])
