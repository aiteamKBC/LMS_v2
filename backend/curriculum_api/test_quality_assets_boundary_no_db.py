"""Actual old/new quality and asset caller parity on synthetic values; DB forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager, nullcontext
from copy import deepcopy
from datetime import datetime, timezone as datetime_timezone
from decimal import Decimal
import importlib
import inspect
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import quality, programme_audit, versioning, views
from system_audit import derived, pages, writes

SNAPSHOT = json.loads((Path(__file__).parent / 'reporting/tests/fixtures/legacy_snapshots/quality_assets_snapshot.json').read_text())
LEGACY = {'quality': quality, 'programme_audit': programme_audit}
NOW = datetime(2026, 11, 21, 12, 0, 0, tzinfo=datetime_timezone.utc)


class FrozenDateTime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW.replace(tzinfo=None)


@contextmanager
def original_quality_assets():
    with ExitStack() as stack:
        # Frozen pre-extraction functions still reference their original facade.
        for module in LEGACY.values():
            stack.enter_context(patch.object(module, 'curriculum_views', views, create=True))
        for key, entry in SNAPSHOT['functions'].items():
            legacy, name = key.split('.')
            module = LEGACY[legacy]
            if isinstance(getattr(module, name), Mock):
                continue
            namespace = dict(vars(module))
            exec(compile(entry['source'], '<pre-quality-assets>', 'exec'), namespace)
            old = namespace[name]
            restored = FunctionType(old.__code__, vars(module), name, old.__defaults__)
            restored.__kwdefaults__ = old.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(module))(restored)
            stack.enter_context(patch.object(module, name, restored))
        yield


class QualityAssetParity(SimpleTestCase):
    owner_calls_verified = set()

    @classmethod
    def tearDownClass(cls):
        print('Quality/assets compared owner functions:', len(cls.owner_calls_verified), '/', len(SNAPSHOT['functions']),
              'uncovered:', sorted(set(SNAPSHOT['functions']) - cls.owner_calls_verified))
        super().tearDownClass()

    def setUp(self):
        self.requests = RequestFactory()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(quality, 'datetime', FrozenDateTime))
        self.stack.enter_context(patch.object(programme_audit.timezone, 'now', return_value=NOW))
        # Neither branch may provision a schema, write assets or contact a provider.
        for name in ('provision_programme_audit_table', 'provision_per_programme_table',
                     'upsert_assets', 'upsert_assets_per_programme_tables', 'fetch_external_payload'):
            self.stack.enter_context(patch.object(programme_audit, name,
                side_effect=AssertionError('Forbidden capability: ' + name)))

    def compare(self, key, *args, watched=(), error=False, **kwargs):
        legacy, name = key.split('.')
        module = LEGACY[legacy]
        def invoke(arguments, keywords):
            try:
                result = getattr(module, name)(*arguments, **keywords)
                if inspect.isgenerator(result):
                    result = list(result)
                if hasattr(result, 'status_code') and hasattr(result, 'content'):
                    result = (result.status_code, result.content, result.get('Cache-Control'))
                return ('return', result)
            except Exception as exc:
                return ('raise', type(exc), str(exc))
        old_args, new_args = deepcopy(args), deepcopy(args)
        for mock in watched: mock.reset_mock()
        with original_quality_assets():
            with observe_export(views, module, name, wraps=getattr(module, name)) as original_calls:
                expected = invoke(old_args, deepcopy(kwargs))
        calls = [list(mock.mock_calls) for mock in watched]
        for mock in watched: mock.reset_mock()
        owner = importlib.import_module(SNAPSHOT['functions'][key]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = invoke(new_args, deepcopy(kwargs))
        self.assertGreater(called.call_count, 0, key)
        self.assertEqual(called.call_count, original_calls.call_count, key)
        self.assertEqual(actual, expected, key)
        self.assertEqual([list(mock.mock_calls) for mock in watched], calls, key)
        # Request objects compare by identity; mutable business input values do not.
        if not any(hasattr(a, 'META') for a in args): self.assertEqual(new_args, old_args, key)
        if not error: self.assertEqual(actual[0], 'return', (key, actual))
        self.owner_calls_verified.add(key)
        return actual[1]

    def test_history_windows_labels_bounded_values_and_empty_states(self):
        for name, cases in {
            'window_limit': [('curriculum',), ('learner',), ('',)],
            'change_window_limit': [('curriculum',), ('learner',)],
            'source_label': [('auto-save',), ('unrecognised-source',), (None,)],
            'cause_label': [('unknown',), ('',)],
            'field_label': [('settings.contentHtml',), ('coach_name',), ('plain_name',)],
            'parse_bounded_int': [('9999', 7, 1, 60), ('bad', 7, 1, 60), ('0', 7, 1, 60)],
            'iso': [(NOW,), ('2026-11-21 12:00',), (None,)],
            'context_line': [('module', {'programme_name': 'P', 'module_name': 'M'}), ('unknown', {})],
            'coverage_keys': [],
        }.items():
            for args in cases: self.compare('quality.' + name, *args)
        self.compare('quality.coverage_keys', [{'value': 'curriculum'}, {'value': 'coach'}], revision=['curriculum'], derived=[])

    def test_attribution_preserves_old_tags_structured_precedence_and_unknowns(self):
        reasons = ('edited; source=auto-save; actor=system; by=synthetic@example.test', '', 'unknown; actor=nonsense')
        for reason in reasons:
            self.compare('quality.split_reason', reason)
            for extra in ({}, {'actor_type': 'user', 'source': 'manual', 'triggered_by_name': 'Synthetic trigger'}):
                self.compare('quality.revision_attribution', {'reason': reason, **extra})
        result = self.compare('quality.merge_actors',
            [{'email': 'A@example.test', 'name': 'Synthetic A', 'changes': 2}],
            [{'email': 'a@example.test', 'name': 'Old name', 'changes': 3}, {'email': '', 'changes': 7}])
        self.assertEqual(result[0]['changes'], 5)

    def test_revision_projection_privacy_missing_values_and_event_shapes(self):
        row = {'id': 1, 'entity_type': 'module', 'entity_id': 'M', 'revision_no': 2,
               'title': 'Synthetic', 'action': 'updated', 'created_at': NOW,
               'snapshot': {'title': 'Synthetic', versioning.CONTEXT_KEY: {'programme_name': 'P'}},
               'changed_fields': [{'field': 'title', 'from': 'Before', 'to': 'After'}, 'description', None],
               'metadata': {'page_workspace': 'curriculum'}, 'reason': 'edit; source=manual'}
        self.compare('quality.entity_type_options', 'curriculum')
        for action in ('updated', 'created', 'deleted'):
            self.compare('quality.revision_event', {**row, 'action': action})
        self.compare('quality.revision_row', row)
        for change in ('title', '', None, {'field': 'title', 'from': None, 'to': '', 'truncated': True}):
            self.compare('quality.revision_change', 'module', change)
        with patch.object(versioning, 'REDACTED_COLUMNS', {'learner': {'secret'}}):
            result = self.compare('quality.revision_change', 'learner', {'field': 'secret', 'from': 'private', 'to': 'private2'})
            self.assertNotEqual(result['before'], 'private')

    def test_history_sql_scope_facets_duplicate_latest_and_counts(self):
        with patch.object(quality, 'connection', SimpleNamespace(vendor='postgresql')):
            for scope in ('programme', 'cohort', 'group'):
                self.compare('quality._scope_clause', scope, 'SYNTHETIC')
            with composition_fixture(views, 'fetch_all', return_value=[
                {'entity_type': 'module', 'entity_id': 'M', 'revision_no': 3, 'total': 2},
                {'entity_type': 'module', 'entity_id': 'M', 'revision_no': 2, 'total': 2},
            ]) as read:
                for key in ('latest_revision_by_entity', 'named_version_counts'):
                    self.compare('quality.' + key, [], watched=(read,))
                    self.compare('quality.' + key, [('module', 'M')], watched=(read,))
                read.return_value = [{'actor_email': 'synthetic@example.test', 'actor_name': 'Synthetic', 'changes': 2}]
                with patch.object(versioning, 'metadata_columns_available', return_value=True), \
                     patch.object(writes, 'revision_workspace_clause', return_value=('entity_type = %s', ['module'])):
                    self.compare('quality.revision_actors', NOW, 'curriculum', 'module', 'updated', 'manual', 'user', watched=(read,))
                    read.side_effect = ValueError('synthetic unavailable')
                    self.assertEqual(self.compare('quality.revision_actors', NOW, watched=(read,)), [])
                    self.assertEqual(self.compare('quality.named_version_counts', [('module', 'M')], watched=(read,)), {})
        with patch.object(quality, 'connection', SimpleNamespace(vendor='sqlite')):
            self.compare('quality._scope_clause', 'programme', 'P')

    def test_canonical_history_feed_pagination_filters_and_no_recovery(self):
        result = {'total': 2, 'page': 1, 'pages': 1, 'rows': [],
                  'action_counts': {'updated': 2}, 'entity_counts': {'module': 2},
                  'unreadable': [], 'provenance_counts': {derived.PROVENANCE_REVISION: 2}, 'boundaries': {}}
        request = self.requests.get('/?workspace=curriculum&days=99&page=1&limit=2&entity=module&action=updated&actor=synthetic@example.test&source=manual&actorType=user&scope=module&scopeId=M&search=example')
        with patch.object(versioning, 'metadata_columns_available', return_value=True), \
             patch.object(derived, 'read_hybrid', return_value=result) as read, \
             patch.object(quality, 'revision_actors', return_value=[]) as actors, \
             patch.object(quality, 'transaction', SimpleNamespace(atomic=nullcontext)), \
             patch.object(writes, 'revision_workspace_clause', return_value=('entity_type = %s', ['module'])):
            actual = self.compare('quality.revision_trail', request, watched=(read, actors))
            body = json.loads(actual[1])
            self.assertFalse(body['recoveredHistory'])
            self.assertEqual(read.call_args.kwargs['recover'], False)
            self.assertEqual(body['provenanceCounts'][derived.PROVENANCE_TIMESTAMPS], 0)

    def test_history_unavailable_and_read_failures_keep_http_contracts(self):
        self.compare('quality.history_off_response')
        with patch.object(versioning, 'history_available', return_value=False):
            for name, args in (('curriculum_quality_audit_trail', ()), ('curriculum_quality_versions', ()),
                               ('curriculum_quality_record_history', ('module', 'M'))):
                result = self.compare('quality.' + name, self.requests.get('/'), *args)
                self.assertFalse(json.loads(result[1])['available'])
        with patch.object(versioning, 'history_available', return_value=True), \
             patch.object(quality, 'revision_trail', side_effect=ValueError('synthetic unreadable')):
            result = self.compare('quality.curriculum_quality_audit_trail', self.requests.get('/'))
            self.assertEqual(result[0], 503)

    def test_versions_http_summaries_order_and_named_counts(self):
        def rows(sql, params=None):
            if 'max(revision_no)' in sql:
                return [{'entity_type': 'module', 'entity_id': 'M', 'revisions': 2, 'last_change': NOW, 'first_change': NOW}]
            return [{'revisions': 2, 'versions': 1}]
        with patch.object(versioning, 'history_available', return_value=True), \
             composition_fixture(views, 'fetch_all', side_effect=rows) as read, \
             patch.object(quality, 'latest_revision_by_entity', return_value={('module', 'M'): {'title': 'Synthetic', 'revision_no': 2}}), \
             patch.object(quality, 'named_version_counts', return_value={('module', 'M'): 1}):
            for search in ('', 'Synthetic', 'missing'):
                self.compare('quality.curriculum_quality_versions', self.requests.get('/?module=M&entity_type=module&search=' + search), watched=(read,))
            read.side_effect = ValueError('synthetic unavailable')
            # Intentional correction: a failed read is not an uninstalled store.
            with original_quality_assets():
                previous = quality.curriculum_quality_versions(self.requests.get('/'))
            self.assertFalse(json.loads(previous.content)['available'])
            current = quality.curriculum_quality_versions(self.requests.get('/'))
            self.assertEqual(current.status_code, 503)
            self.assertEqual(json.loads(current.content), {'error': 'Version history could not be read. Please retry.'})

    def test_record_history_snapshot_selection_empty_and_unknown(self):
        row = {'id': 1, 'entity_type': 'module', 'entity_id': 'M', 'revision_no': 2, 'title': 'Synthetic', 'snapshot': {'title': 'Saved'}, 'created_at': NOW}
        with patch.object(versioning, 'history_available', return_value=True), \
             composition_fixture(views, 'fetch_all', return_value=[row]) as read:
            self.compare('quality.curriculum_quality_record_history', self.requests.get('/?snapshot=2'), 'module', 'M', watched=(read,))
            read.return_value = []
            self.compare('quality.curriculum_quality_record_history', self.requests.get('/'), 'module', 'missing', watched=(read,))
            self.compare('quality.curriculum_quality_record_history', self.requests.get('/'), 'unknown', 'M', watched=(read,))

    def test_asset_normalization_urls_and_source_selection(self):
        cases = {
            'clean': [(None,), (0,), ('   name ',)], 'normalise': [(' self_study ',)],
            'read_json_value': [('broken', {}), ('[1]', []), ({'x': 1}, {})],
            'parse_int': [('2.5',), ('bad',)], 'parse_float': [('2.5',), (None,)],
            'first_value': [({'value': 0}, 'value'), ({}, 'missing')],
            'first_clean': [({'value': ' A '}, 'value')],
            'iframe_src': [('<iframe src="https://example.test/a?x=1&amp;y=2">',), ('plain',)],
            'is_http_url': [('https://example.test/a',), ('/relative',)],
            'youtube_embed_url': [('https://youtu.be/synthetic',), ('https://www.youtube.com/watch?v=synthetic',)],
            'vimeo_embed_url': [('https://vimeo.com/123',)],
            'google_embed_url': [('https://docs.google.com/presentation/d/synthetic/edit',)],
            'file_extension': [('https://example.test/A.PDF?x=1',)],
            'content_kind_for_component': [('podcast',), ('reading',)],
            'component_settings': [({'settings': '{broken'},), ({'settings_json': '{"a":1}'},)],
            'normalised_component_type': [({'type': 'self-study', 'settings': {'videoUrl': 'https://example.test/v'}},)],
            'stable_asset_id': [({'programme_id': 'P', 'component_id': 'C', 'content_kind': 'reading', 'title': 'Synthetic'},)],
            'is_component_like': [(None,), ({'type': 'reading', 'title': 'Synthetic'},)],
            'context_with': [({}, 'module', {'id': 'M'}), ({}, 'module', None)],
            'rows_as_dicts': [(SimpleNamespace(description=[('id',)], fetchall=lambda: [('A',)]),)],
        }
        for name, values in cases.items():
            for args in values: self.compare('programme_audit.' + name, *args)
        for url in ('', '/curriculum_api/curriculum/uploads/sample.pdf', 'https://example.test/a.docx', 'https://example.test/a.mp3'):
            self.compare('programme_audit.render_target', url, '', 'audio')
        for kind in ('video', 'podcast', 'reading', 'powerpoint', 'assignment', 'recording-placeholder', 'other'):
            self.compare('programme_audit.primary_source_for_component', {}, {'resourceUrl': 'https://example.test/a'}, kind)

    def test_asset_tree_flat_identity_duplicates_audio_and_serialization(self):
        component = {'id': 'C', 'type': 'reading', 'title': 'Synthetic', 'settings': {'resourceUrl': 'https://example.test/a.pdf', 'audioUrl': 'https://example.test/a.mp3'}, 'expectedOtjh': '2.5'}
        context = {'programme': {'id': 'P', 'name': 'Programme'}, 'module': {'id': 'M', 'title': 'Module'}, 'week': {'id': 'W', 'week_number': 1}}
        tree = {'programme': context['programme'], 'modules': [{**context['module'], 'weeks': [{**context['week'], 'components': [component, component]}]}]}
        self.compare('programme_audit.base_asset', component, context, tree, 'synthetic')
        self.compare('programme_audit.component_assets', component, context, tree)
        self.compare('programme_audit.stamp_asset', {'programme_id': 'P', 'component_id': 'C'})
        for payload in (tree, {'flat': {'modules': [context['module']], 'components': [{**component, 'moduleCatalogueId': 'M'}]}}, [], None):
            self.compare('programme_audit.iter_components', payload)
            self.compare('programme_audit.assets_from_payload', payload)
        material = {'key': 'impact-planning', 'name': 'Material', 'programme_id': 'ME'}
        self.compare('programme_audit.scope_assets_to_ui_material', material, [{'programme_id': 'P', 'module_catalogue_id': 'M', 'module_title': 'Original', 'settings': {}}])
        self.compare('programme_audit.serialise_asset_row', {'expected_otjh': Decimal('2.25'), 'imported_at': NOW, 'settings': '{}', 'ksb_mappings': '[]'})
        self.compare('programme_audit.kbc_wordpress_activity_asset', {'group_id': 'P', 'group_name': 'Synthetic'}, {'activity_id': 'C', 'activity_type': 'reading', 'title': 'Synthetic'})

    def test_curriculum_assets_keep_canonical_reader_and_missing_target(self):
        with composition_fixture(views, 'build_curriculum_programme_tree_detail_payload', return_value={'programme': {'id': 'P'}, 'components': []}) as read:
            self.compare('programme_audit.assets_from_curriculum_programme', 'P', watched=(read,))
            read.return_value = None
            self.compare('programme_audit.assets_from_curriculum_programme', 'missing', watched=(read,), error=True)

    def test_material_metadata_reads_and_missing_table(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (1,)
        cursor.description = [('id',)]
        cursor.fetchall.return_value = [('A',)]
        db = SimpleNamespace(vendor='postgresql', cursor=MagicMock())
        db.cursor.return_value.__enter__.return_value = cursor
        with patch.object(programme_audit, 'connection', db):
            self.compare('programme_audit.quote_ident', 'unsafe"name')
            self.compare('programme_audit.asset_table_name')
            # Cursor itself is an external capability, not a mutable business input.
            self.assertEqual(programme_audit.rows_as_dicts(cursor), [{'id': 'A'}])
            self.compare('programme_audit.ui_material_table_exists', 'impact_planning', watched=(cursor.execute,))
            self.compare('programme_audit.table_exists', watched=(cursor.execute,))
            with patch.object(programme_audit, 'ui_material_table_exists', return_value=False):
                self.compare('programme_audit.fetch_ui_material', 'impact-planning')
                self.compare('programme_audit.fetch_ui_material', 'unknown', error=True)
            with patch.object(programme_audit, 'ui_material_table_exists', return_value=True):
                cursor.fetchone.side_effect = lambda: (2, Decimal('120')) if 'count(*)' in cursor.execute.call_args.args[0] else ('Week 1',)
                self.compare('programme_audit.fetch_ui_material', 'impact-planning', include_results=True, watched=(cursor.execute,))

    def test_asset_reads_preserve_parameterization_order_and_schema_guard(self):
        cursor = MagicMock()
        cursor.description = [('id',), ('title',), ('settings',)]
        cursor.fetchall.return_value = [('A', 'Synthetic', '{}')]
        db = SimpleNamespace(vendor='postgresql', cursor=MagicMock())
        db.cursor.return_value.__enter__.return_value = cursor
        with patch.object(programme_audit, 'connection', db), \
             patch.object(programme_audit, 'require_programme_audit_table') as require:
            self.compare('programme_audit.fetch_assets', 'P', 'reading', watched=(require, cursor.execute))
            self.assertEqual(cursor.execute.call_args.args[1], ['P', 'reading'])
            self.assertTrue(cursor.execute.call_args.args[0].lstrip().lower().startswith('select'))

    def test_material_http_permissions_missing_ready_and_cache_headers(self):
        with patch.object(programme_audit, 'table_exists', return_value=True):
            self.compare('programme_audit.programme_audit_status', self.requests.get('/'))
        with patch.object(programme_audit, 'fetch_ui_material', return_value={'ready': True, 'results': []}) as read:
            for role in ('admin', 'learner'):
                request = self.requests.get('/?programme=MM')
                request.login_account = SimpleNamespace(role=role)
                self.compare('programme_audit.programme_audit_materials', request, watched=(read,))
                self.compare('programme_audit.programme_audit_material', request, 'ai-in-marketing', watched=(read,))
                if role == 'learner': read.assert_not_called()
            read.return_value = {'ready': False}
            self.compare('programme_audit.programme_audit_material', self.requests.get('/'), 'impact-planning', watched=(read,))
            read.side_effect = programme_audit.ProgrammeAuditNotFound('Material not found.')
            self.compare('programme_audit.programme_audit_material', self.requests.get('/'), 'unknown', watched=(read,))

    def test_public_get_decorators_still_reject_post_before_reads(self):
        with patch.object(versioning, 'history_available') as history, patch.object(programme_audit, 'fetch_ui_material') as material:
            for key, args in (('quality.curriculum_quality_audit_trail', ()), ('quality.curriculum_quality_versions', ()),
                              ('quality.curriculum_quality_record_history', ('module', 'M')),
                              ('programme_audit.programme_audit_materials', ()), ('programme_audit.programme_audit_material', ('impact-planning',))):
                legacy, name = key.split('.')
                self.assertEqual(getattr(LEGACY[legacy], name)(self.requests.post('/'), *args).status_code, 405)
            history.assert_not_called()
            material.assert_not_called()
