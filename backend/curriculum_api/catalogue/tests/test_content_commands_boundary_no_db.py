"""Actual frozen-source comparisons on synthetic ports; isolated runner only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
from contextlib import ExitStack, contextmanager, nullcontext
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.infrastructure import free_course_catalogue_store as free_course_catalogue_store
from curriculum_api.catalogue.api import content_commands
from curriculum_api.catalogue.tests.parity.content_commands_oracle import SNAPSHOT
from curriculum_api.catalogue.tests.test_lifecycle_commands_boundary_no_db import lifecycle_scope
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import request, recording, response_value


@contextmanager
def original_content():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-content-commands>', 'exec'), namespace)
            fn = namespace[name]
            original = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            original.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


@contextmanager
def content_scope(original, events, values=None, *, atomic=True):
    with lifecycle_scope(False, events, values, atomic=atomic) as stack:
        if original:
            stack.enter_context(original_content())
        yield stack


class ContentCommandParity(SimpleTestCase):
    def compare(self, scenario):
        current = scenario(False)
        self.assertEqual(current, scenario(True))
        return current

    def test_revision_is_required_and_lock_precedes_revision(self):
        def scenario(old, expected):
            events = []
            values = {'lock_module_structure_row': recording(events, 'lock'),
                      'module_structure_revision': recording(events, 'revision', 'current')}
            with content_scope(old, events, values):
                response = views.refuse_stale_module_write(request('PATCH'), {'expectedRevision': expected}, 'M')
            return response_value(response) if response else None, events
        for expected, status in (('', 428), ('stale', 409), ('current', None)):
            result, events = self.compare(lambda old: scenario(old, expected))
            self.assertEqual(result[0] if result else None, status)
            self.assertEqual([e[0] for e in events], ['lock', 'revision'] if expected else [])

    def test_component_patch_preserves_locked_fields_and_strips_revision_metadata(self):
        def scenario(old):
            events = []
            values = {'authoring_fetch_all': Mock(return_value=[{'id': 'C', 'module_catalogue_id': 'M'}]),
                      'refuse_stale_module_write': recording(events, 'guard'),
                      'component_builder_rows': recording(events, 'locked-read', [{'id': 'C', 'title': 'Before', 'settings': {'body': 'keep'}, 'points': 17}]),
                      'save_component_builder_payload': recording(events, 'save', {'id': 'C'}),
                      'component_builder_response': Mock(side_effect=AssertionError('full row already available'))}
            with content_scope(old, events, values):
                response = views.curriculum_component_detail(request('PATCH', {'title': 'After', 'expectedRevision': 'r'}), ' C ')
            # Compare request values separately; object identity is immaterial.
            for i, event in enumerate(events):
                if event[0] == 'guard':
                    events[i] = ('guard', event[1][1:], event[2])
            return response_value(response), events
        with patch.object(content_commands, 'curriculum_component_detail', wraps=content_commands.curriculum_component_detail) as called:
            current = scenario(False)
        called.assert_called_once()
        self.assertEqual(current, scenario(True))
        response, events = current
        self.assertEqual(response[0], 200)
        self.assertEqual([e[0] for e in events], ['begin', 'guard', 'locked-read', 'save', 'commit'])
        saved = next(e[1][0] for e in events if e[0] == 'save')
        self.assertEqual(saved, {'id': 'C', 'title': 'After', 'settings': {'body': 'keep'}, 'points': 17})

    def test_component_delete_guard_and_mapping_first_order(self):
        def scenario(old, refuse):
            events = []
            values = {'authoring_fetch_all': Mock(return_value=[{'id': 'C', 'module_catalogue_id': 'M'}]),
                      'refuse_stale_module_write': Mock(return_value=views.json_error('stale', status=409) if refuse else None),
                      'authoring_soft_delete': recording(events, 'archive', [])}
            with content_scope(old, events, values):
                response = views.curriculum_component_detail(request('DELETE', {'expectedRevision': 'r'}), 'C')
            return response_value(response), events
        for refuse in (False, True):
            result, events = self.compare(lambda old: scenario(old, refuse))
            self.assertEqual(result[0], 409 if refuse else 200)
            writes = [e for e in events if e[0] == 'archive']
            self.assertEqual([e[1][0] for e in writes], [] if refuse else [views.AUTHORING_KSB_MAPPINGS_TABLE, views.AUTHORING_COMPONENTS_TABLE])
            if writes:
                self.assertEqual(writes[0][1][1:], ('component_id = %s', ['C']))

    def test_normalized_mapping_rows_remain_authoritative_with_optional_legacy_mirror(self):
        def scenario(old, mirror):
            events = []
            items = [{'id': 'K', 'code': 'K1'}]
            component = {'id': 'C', 'module_catalogue_id': 'M', 'week_id': 'W', 'ksb_mappings': items}
            values = {'authoring_fetch_all': Mock(side_effect=AssertionError('preloaded inputs must be used')),
                      'component_ksb_mappings_from_row': Mock(return_value=items),
                      'normalise_component_ksb_mappings': recording(events, 'normalize', (items, [{'id': 'K', 'component_id': 'C'}])),
                      'has_column': Mock(return_value=mirror), 'update_authoring_rows': recording(events, 'mirror'),
                      'authoring_soft_delete': recording(events, 'archive'),
                      'authoring_bulk_upsert': recording(events, 'write'), 'sync_progress_ksbs': recording(events, 'progress')}
            with content_scope(old, events, values):
                result = views.sync_component_ksb_projection(' C ', component, {'module_catalogue_id': 'M'})
            return result, events
        for mirror in (False, True):
            result, events = self.compare(lambda old: scenario(old, mirror))
            self.assertEqual(result, [{'id': 'K', 'code': 'K1'}])
            self.assertEqual([e[0] for e in events], ['normalize'] + (['mirror'] if mirror else []) + ['archive', 'write', 'progress'])
            self.assertFalse(events[0][2]['enforce_unique'])

    def test_mapping_delete_preserves_siblings_and_handles_detached_mapping(self):
        def scenario(old, has_component):
            events = []
            def read(table, *args):
                if table == views.AUTHORING_COMPONENTS_TABLE:
                    return [{'id': 'C'}] if has_component else []
                return [{'id': 'K', 'component_id': 'C'}]
            values = {'authoring_fetch_all': Mock(side_effect=read),
                      'component_ksb_mappings_from_row': Mock(return_value=[{'id': 'K'}, {'id': 'OTHER'}]),
                      'active_mapping_rows': Mock(side_effect=lambda rows: rows),
                      'store_component_ksb_mappings': recording(events, 'store'),
                      'authoring_soft_delete': recording(events, 'archive')}
            with content_scope(old, events, values):
                response = views._curriculum_ksb_mapping_detail(request('DELETE'), 'K')
            return response_value(response), events
        for attached in (False, True):
            result, events = self.compare(lambda old: scenario(old, attached))
            self.assertEqual(result[0], 200)
            if attached:
                self.assertEqual(next(e[1][1] for e in events if e[0] == 'store'), [{'id': 'OTHER'}])
            else:
                self.assertEqual(events[0][1][1:], ('id = %s', ['K']))

    def test_assignment_topic_upload_is_not_auto_attached(self):
        def scenario(old, topic):
            events = []
            req = SimpleNamespace(method='POST', FILES={'file': object()}, POST={'componentType': 'assignment', 'topicResource': 'true' if topic else 'false', 'moduleId': 'M'})
            values = {'component_upload_metadata': Mock(return_value=({'url': '/synthetic'}, '')),
                      'update_component_upload_settings': recording(events, 'attach', True)}
            with content_scope(old, events, values):
                response = views.curriculum_component_upload(req, 'C')
            return response_value(response), events
        for topic in (False, True):
            result, events = self.compare(lambda old: scenario(old, topic))
            self.assertEqual(result[0], 201)
            self.assertEqual(result[1]['savedToComponent'], not topic)
            self.assertEqual(len(events), int(not topic))

    def test_free_conversion_appends_and_move_archives_only_after_save(self):
        def scenario(old, mode, failure=False):
            events = []
            values = {'get_authoring_structure_payload': Mock(return_value={'title': 'Synthetic'}),
                      'module_future_teams_sessions': Mock(return_value=False),
                      'versioning': SimpleNamespace(source=lambda reason: nullcontext()),
                      'get_free_programme_modules_payload': Mock(return_value=[{'courseId': 'OTHER'}]),
                      'unique_timestamp_prefixed_id': Mock(return_value='NEW'),
                      'build_module_free_course_weeks': Mock(return_value=[{'courseId': 'NEW'}]),
                      '_free_module_response_to_input': Mock(side_effect=lambda row: row),
                      'save_free_programme_modules': Mock(side_effect=ValueError('refused')) if failure else recording(events, 'save', []),
                      'delete_module_authoring_structure': recording(events, 'archive')}
            with content_scope(old, events, values):
                try:
                    result = views.convert_module_to_free_course('M', mode=mode)
                except ValueError as exc:
                    result = str(exc)
            return result, events
        for mode in ('clone', 'move'):
            result, events = self.compare(lambda old: scenario(old, mode))
            names = [e[0] for e in events]
            self.assertEqual('archive' in names, mode == 'move')
            self.assertEqual(next(e[1][1]['modules'] for e in events if e[0] == 'save'), [{'courseId': 'OTHER'}, {'courseId': 'NEW'}])
        result, events = self.compare(lambda old: scenario(old, 'move', True))
        self.assertEqual(result, 'refused')
        self.assertEqual([e[0] for e in events], ['begin', 'rollback'])

    def test_single_course_delete_canonical_fast_path_and_legacy_scope(self):
        def scenario(old, canonical):
            events = []
            values = {'free_programme_fetch_all': Mock(return_value=[{'id': 'FW', 'week_id': 'W'}]),
                      'free_programme_delete': recording(events, 'delete'), 'authoring_delete': recording(events, 'mirror')}
            with content_scope(old, events, values) as stack:
                stack.enter_context(patch.object(free_course_catalogue_store, 'applies', return_value=canonical))
                stack.enter_context(patch.object(free_course_catalogue_store, 'delete_course', side_effect=recording(events, 'canonical')))
                views._delete_single_free_course_rows(' C ')
            return events
        self.assertEqual([e[0] for e in self.compare(lambda old: scenario(old, True))], ['canonical'])
        events = self.compare(lambda old: scenario(old, False))
        self.assertEqual([e[0] for e in events], ['delete', 'mirror', 'delete', 'delete'])
        self.assertEqual(events[0][1][2], ['FW'])
        self.assertEqual(events[-1][1][2], ['C'])
