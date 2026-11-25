"""Actual old/new storage orchestration parity on synthetic, DB-forbidden ports."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import copy
from contextlib import ExitStack, contextmanager, nullcontext
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, MagicMock, patch

from django.conf import settings
from django.middleware.csrf import get_token
from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api import course_pricing_schema
from curriculum_api import legacy_free_course_adoption
from curriculum_api.catalogue.infrastructure import free_course_catalogue_store as free_course_catalogue_store
from curriculum_api import learning_storage
from curriculum_api.catalogue.application import free_programme_commands
from curriculum_api.catalogue.tests.parity.authoring_storage_oracle import SNAPSHOT, runtime_source
from curriculum_api.catalogue.tests.test_lifecycle_commands_boundary_no_db import lifecycle_scope
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording, request, response_value
from curriculum_api.catalogue.tests.test_hierarchy_commands_boundary_no_db import FrozenClock


@contextmanager
def original_storage():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(runtime_source(entry['source']), '<pre-authoring-storage>', 'exec'), namespace)
            fn = namespace[name]
            original = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            original.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


@contextmanager
def storage_scope(original, events, values=None, *, atomic=True):
    from curriculum_api.catalogue.infrastructure import authoring_schema_runtime, course_schema_runtime
    with ExitStack() as setup:
        for name, value in (values or {}).items():
            if name.endswith('_READY') and not hasattr(views, name):
                # Frozen implementations retain their original global lookup.
                setup.enter_context(patch.object(views, name, value, create=True))
        stack = setup.enter_context(lifecycle_scope(False, events, values, atomic=atomic))
        for name, value in (values or {}).items():
            if hasattr(authoring_schema_runtime, name):
                stack.enter_context(patch.object(authoring_schema_runtime, name, value))
            if hasattr(course_schema_runtime, name):
                stack.enter_context(patch.object(course_schema_runtime, name, value))
        stack.enter_context(composition_fixture(views, 'native_only', return_value=False))
        stack.enter_context(composition_fixture(views, 'require_mode', return_value=None))
        stack.enter_context(patch.object(legacy_free_course_adoption, 'adopted_courses', return_value=set()))
        stack.enter_context(patch.object(free_course_catalogue_store, 'applies', return_value=False))
        if original:
            stack.enter_context(original_storage())
        yield stack


def free_ports(events):
    return {
        'delete_free_programme_data': recording(events, 'clear', ({'OLD-W'}, {'OLD-C'})),
        'schema_compat': SimpleNamespace(columns_of=Mock(return_value=set())),
        'authoring_delete': recording(events, 'delete-weeks'),
        'authoring_upsert': recording(events, 'week', {}),
        'free_programme_upsert': recording(events, 'free-row', {}),
        'stored_module_cover_image': recording(events, 'cover', '/synthetic/cover'),
        'free_programme_module_id': Mock(side_effect=lambda p, m, i: 'LINK-' + str(i)),
        'free_programme_week_payload': Mock(side_effect=lambda c, m, i: {'id': 'W-' + str(i), 'title': m['weekTitle'], 'week_number': i + 1}),
        'free_programme_component_payload': Mock(side_effect=lambda c, i: {'id': c['id'], 'title': c['title']}),
        'get_free_programme_modules_payload': recording(events, 'read-result', [{'courseId': 'COURSE'}]),
    }


def free_request(*, csrf=True):
    req = request('PATCH', {'modules': []})
    if csrf:
        req.META[settings.CSRF_HEADER_NAME] = get_token(req)
        req.COOKIES[settings.CSRF_COOKIE_NAME] = req.META['CSRF_COOKIE']
    return req


class AuthoringStorageParity(SimpleTestCase):
    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_schema_sql_order_cache_invalidation_and_ready_flags(self):
        def scenario(original, name, vendor, fail=False, ready=False):
            events = []
            cursor = MagicMock()
            cursor.__enter__.return_value = cursor
            cursor.fetchall.return_value = []
            cursor.execute = recording(events, 'sql')
            if fail:
                cursor.execute.side_effect = ValueError('DDL refused')
            values = {'connection': SimpleNamespace(vendor=vendor, cursor=lambda: cursor),
                      'authoring_json_type': Mock(return_value='jsonb' if vendor == 'postgresql' else 'text'),
                      'authoring_table_name': Mock(side_effect=lambda t: 'fixture.' + t),
                      '_TABLE_COLUMNS_CACHE': {'weeks': ['stale'], 'curriculum.weeks': ['stale'], 'unrelated': ['keep']}}
            flag = SNAPSHOT['functions'][name]['ready']
            values[flag] = ready
            with storage_scope(original, events, values) as stack:
                stack.enter_context(patch.object(course_pricing_schema, 'provision', side_effect=lambda conn: events.append(('pricing', (), {}))))
                try:
                    result = getattr(views, name)()
                except ValueError as exc:
                    result = str(exc)
                from curriculum_api.catalogue.infrastructure import authoring_schema_runtime, course_schema_runtime
                state_owner = views if original else (authoring_schema_runtime if flag == '_AUTHORING_TABLES_READY' else course_schema_runtime)
                state = getattr(state_owner, flag)
                cache = copy.deepcopy(views._TABLE_COLUMNS_CACHE)
            if original and name == 'provision_module_authoring_tables' and not fail and not ready:
                # Compare recorded SQL only; this test never executes DDL.
                # Dev adds one nullable column and its idempotent provisioning statement.
                create_index = next(i for i, event in enumerate(events)
                                    if event[0] == 'sql' and 'week_starts_on varchar(9),' in event[1][0])
                kind, sql_args, sql_kwargs = events[create_index]
                old_sql = sql_args[0]
                self.assertEqual(old_sql.count('week_starts_on varchar(9),'), 1)
                events[create_index] = (kind, (old_sql.replace('week_starts_on varchar(9),',
                    'week_starts_on varchar(9),\n                week_boundary_mode varchar(16),'), *sql_args[1:]), sql_kwargs)
                starts = 'alter table fixture.modules add column ' + ('if not exists ' if vendor == 'postgresql' else '')
                anchor = next(i for i, event in enumerate(events)
                              if event[0] == 'sql' and event[1][0] == starts + 'week_starts_on varchar(9)')
                events.insert(anchor + (1 if vendor == 'postgresql' else 0),
                              ('sql', (starts + 'week_boundary_mode varchar(16)',), {}))
            return result, state, cache, events
        for name, entry in SNAPSHOT['functions'].items():
            if not entry['ready']:
                continue
            for vendor in ('postgresql', 'sqlite'):
                with self.subTest(name=name, vendor=vendor):
                    result, ready, cache, events = self.compare(lambda old: scenario(old, name, vendor))
                    self.assertTrue(ready)
                    self.assertGreater(len(events), 2)
                    self.assertEqual(cache['unrelated'], ['keep'])
            result = self.compare(lambda old: scenario(old, name, 'postgresql', fail=True))
            self.assertFalse(result[1])
            result = self.compare(lambda old: scenario(old, name, 'postgresql', ready=True))
            self.assertEqual(result[3], [])

    def free_save(self, original, *, normalized=False, fail=False):
        events = []
        values = free_ports(events)
        if normalized:
            values['schema_compat'].columns_of.return_value = {'free_course_id'}
        if fail:
            values['free_programme_upsert'] = Mock(side_effect=ValueError('save refused'))
        payload = {'modules': [
            {'courseId': 'COURSE', 'courseName': 'Synthetic course', 'weekTitle': title, 'coverImageUrl': 'raw-cover',
             'components': [{'id': 'X-' + str(i), 'type': 'reading', 'title': title, 'expectedOtjh': 2}]}
            for i, title in enumerate(('First', 'Second'))]}
        with storage_scope(original, events, values):
            try:
                result = views.save_free_programme_modules(' P ', payload)
            except ValueError as exc:
                result = str(exc)
        return result, events

    def test_free_save_groups_weeks_deduplicates_cover_and_scopes_rewrite(self):
        with patch.object(free_programme_commands, 'save_free_programme_modules', wraps=free_programme_commands.save_free_programme_modules) as invoked:
            actual = self.free_save(False)
        invoked.assert_called_once()
        self.assertEqual(actual, self.free_save(True))
        events = actual[1]
        self.assertEqual(len([e for e in events if e[0] == 'cover']), 1)
        self.assertEqual([e[1][0] for e in events if e[0] == 'clear'], ['P'])
        course = [e for e in events if e[0] == 'free-row' and e[1][0] == views.FREE_COURSES_TABLE][-1][1][2]
        self.assertEqual((course['week_count'], course['component_count'], course['total_otjh']), (2, 2, 4))
        self.assertEqual([e[0] for e in events][-3:], ['commit', 'invalidate', 'read-result'])

    def test_normalized_course_is_written_before_its_week(self):
        result, events = self.compare(lambda old: self.free_save(old, normalized=True))
        names = [e[0] for e in events]
        self.assertLess(names.index('free-row'), names.index('week'))
        weeks = [e[1][2] for e in events if e[0] == 'week']
        self.assertTrue(all(w['free_course_id'] == 'COURSE' and w['module_catalogue_id'] is None for w in weeks))

    def test_failed_free_save_rolls_back_before_result_or_invalidation(self):
        result, events = self.compare(lambda old: self.free_save(old, fail=True))
        self.assertEqual(result, 'save refused')
        self.assertEqual(events[-1][0], 'rollback')
        self.assertNotIn('read-result', [e[0] for e in events])

    def test_protected_course_refusal_and_canonical_store_fast_path(self):
        def scenario(original, protected):
            events = []
            with storage_scope(original, events, free_ports(events)) as stack:
                stack.enter_context(patch.object(legacy_free_course_adoption, 'adopted_courses', return_value={'COURSE'} if protected else set()))
                stack.enter_context(patch.object(free_course_catalogue_store, 'applies', return_value=True))
                stack.enter_context(patch.object(free_course_catalogue_store, 'save_catalogue', side_effect=recording(events, 'canonical-save')))
                try:
                    result = views.save_free_programme_modules('P', {'modules': [{'courseId': 'COURSE'}]})
                except ValueError as exc:
                    result = str(exc)
            return result, events
        result, events = self.compare(lambda old: scenario(old, True))
        self.assertIn('Module Builder', result)
        self.assertEqual(events, [])
        result, events = self.compare(lambda old: scenario(old, False))
        self.assertEqual([e[0] for e in events], ['canonical-save', 'invalidate', 'read-result'])

    def test_scoped_free_delete_excludes_adopted_courses(self):
        def scenario(original, empty):
            events = []
            values = {'free_programme_owned_ids': Mock(return_value=({'W', 'PROTECTED-W'}, {'C', 'PROTECTED'})),
                      'free_programme_fetch_all': Mock(return_value=[{'id': 'PROTECTED-W', 'course_id': 'PROTECTED'}]),
                      'free_programme_delete': recording(events, 'free-delete'),
                      'authoring_delete': recording(events, 'week-delete'),
                      'schema_compat': SimpleNamespace(columns_of=Mock(return_value={'free_course_id'}))}
            with storage_scope(original, events, values) as stack:
                stack.enter_context(patch.object(legacy_free_course_adoption, 'adopted_courses', return_value={'PROTECTED'}))
                result = views.delete_free_programme_data('' if empty else 'P')
            return result, events
        self.assertEqual(self.compare(lambda old: scenario(old, True)), ((set(), set()), []))
        result, events = self.compare(lambda old: scenario(old, False))
        self.assertEqual(result, ({'W'}, {'C'}))
        self.assertEqual(events[0][1][2], ['P', 'PROTECTED-W'])
        self.assertEqual([e[0] for e in events], ['free-delete', 'free-delete', 'week-delete', 'free-delete'])

    def test_conversion_preserves_dates_append_semantics_and_move_order(self):
        def scenario(original, mode):
            events = []
            values = {'get_free_programme_modules_payload': Mock(return_value=[{'courseId': 'C', 'courseName': 'Synthetic'}]),
                      'build_free_course_week_structure': Mock(return_value=[{'id': 'W'}]),
                      'resolve_group_row': Mock(return_value={'group_id': 'G', 'cohort_id': 'CO'}),
                      'resolve_cohort_row': Mock(return_value={'cohort_id': 'CO'}),
                      'serialize_group_authoring_detail': Mock(side_effect=lambda row: row),
                      'serialize_cohort_authoring_detail': Mock(side_effect=lambda row: row),
                      'curriculum_group_from_authoring_detail': Mock(side_effect=lambda row: row),
                      'curriculum_cohort_from_authoring_detail': Mock(side_effect=lambda row: row),
                      'save_tree_group_modules': recording(events, 'append', ([{'catalogueId': 'M', 'programmeId': 'P'}], [])),
                      '_scrub_free_course_learner_assignments': recording(events, 'assignments'),
                      '_delete_single_free_course_rows': recording(events, 'source-delete'),
                      'repair_curriculum_parent_links': recording(events, 'repair'),
                      'versioning': SimpleNamespace(source=lambda reason: nullcontext())}
            with storage_scope(original, events, values):
                result = views.inject_free_course_into_group('C', 'G', mode=mode, start_date='2026-01-01', end_date='2026-02-01')
            return result, events
        for mode in ('clone', 'move'):
            result, events = self.compare(lambda old: scenario(old, mode))
            self.assertEqual(result['moduleCatalogueId'], 'M')
            append = next(e for e in events if e[0] == 'append')
            self.assertEqual(append[2], {'preserve_missing': True})
            self.assertEqual(append[1][2][0]['startDate'], '2026-01-01')
            names = [e[0] for e in events]
            self.assertEqual('source-delete' in names, mode == 'move')
            if mode == 'move':
                self.assertLess(names.index('assignments'), names.index('source-delete'))

    def test_repair_read_mode_does_not_query_or_write_and_archived_lineage_stays(self):
        def scenario(original, allow):
            events = []
            def rows(table):
                events.append(('read', (table,), {}))
                return [{'cohort_id': 'C', 'programme_id': 'P', 'status': 'inactive'}] if table == views.COHORT_AUTHORING_DETAILS_TABLE else [{'group_id': 'G', 'cohort_id': 'C', 'programme_id': 'P', 'status': 'inactive'}]
            values = {'authoring_fetch_all': Mock(side_effect=rows),
                      'safe_authoring_module_rows': Mock(return_value=[{'module_catalogue_id': 'M', 'group_id': 'G', 'status': 'active'}]),
                      'update_group_fields': recording(events, 'group-update'),
                      'update_authoring_rows': recording(events, 'module-update'),
                      'authoring_delete': recording(events, 'orphan-delete'),
                      'authoring_table_name': Mock(side_effect=lambda t: 'fixture.' + t)}
            with storage_scope(original, events, values):
                result = views.repair_curriculum_parent_links('P', allow_writes=allow)
            return result, events
        self.assertEqual(self.compare(lambda old: scenario(old, False)), (None, []))
        result, events = self.compare(lambda old: scenario(old, True))
        self.assertFalse(any(e[0].endswith('update') for e in events))
        self.assertEqual(len([e for e in events if e[0] == 'orphan-delete']), 4)

    def test_changed_rows_only_and_preloaded_reads_are_preserved(self):
        def scenario(original):
            events = []
            values = {'authoring_fetch_all': Mock(side_effect=AssertionError('unnecessary read')),
                      'authoring_row_differs': Mock(side_effect=lambda p, row: p != row),
                      'authoring_row_is_active': Mock(return_value=True),
                      'soft_delete_authoring_ids': recording(events, 'archive'),
                      'authoring_bulk_upsert': recording(events, 'upsert')}
            with storage_scope(original, events, values):
                views.write_changed_authoring_rows('M', [{'id': 'keep'}], [], [], {}, stored_rows={views.AUTHORING_WEEKS_TABLE: [{'id': 'keep'}, {'id': 'remove'}], views.AUTHORING_KSB_MAPPINGS_TABLE: []})
            return events
        events = self.compare(scenario)
        self.assertEqual(events[0][1], (views.AUTHORING_WEEKS_TABLE, ['remove']))
        self.assertTrue(all(e[1][2] == [] for e in events if e[0] == 'upsert'))

    def test_week_template_patch_missing_empty_and_stale_components(self):
        def scenario(original, payload):
            events = []
            values = {'get_week_template_row': Mock(return_value={'id': 'T', 'course_type': 'paid'}),
                      'update_rows': recording(events, 'update', []),
                      'save_week_template_components': recording(events, 'components', []),
                      'week_template_detail_response': Mock(return_value=views.JsonResponse({'id': 'T'})),
                      'lock_record_row': recording(events, 'lock'),
                      'week_template_revision': Mock(return_value='current'),
                      'week_template_record': Mock(return_value={'id': 'T'})}
            with storage_scope(original, events, values):
                result = response_value(views.curriculum_week_template_detail(request('PATCH', payload), 'T'))
            return result, events
        for payload in ({'title': 'Updated'}, {'components': []}, {'components': [], 'expectedRevision': 'stale'}):
            with self.subTest(payload=payload):
                result, events = self.compare(lambda old: scenario(old, payload))
                stale = 'expectedRevision' in payload
                self.assertEqual(result[0], 409 if stale else 200)
                self.assertEqual(any(e[0] == 'components' for e in events), 'components' in payload and not stale)

    def test_week_components_keep_settings_and_display_order(self):
        def scenario(original):
            events = []
            values = {'ensure_week_template_tables': Mock(), 'delete_rows': recording(events, 'delete', []),
                      'insert_row': recording(events, 'insert', {'id': 'X'})}
            with storage_scope(original, events, values):
                result = views.save_week_template_components('T', [{'id': 'X', 'title': 'Synthetic', 'settings': {'linkedQuizId': '17'}, 'coachValidationRequired': False}])
            return result, events
        result, events = self.compare(scenario)
        self.assertEqual([e[0] for e in events], ['delete', 'insert'])
        payload = events[1][1][1]
        self.assertEqual(payload['display_order'], 0)
        self.assertFalse(payload['coach_validation_required'])

    def test_free_http_access_and_error_mapping(self):
        def scenario(original, error):
            events = []
            values = {'_legacy_free_writer_access': Mock(return_value=None),
                      'save_free_programme_modules': Mock(side_effect=error) if error else Mock(return_value=[{'courseId': 'C'}])}
            with storage_scope(original, events, values) as stack:
                stack.enter_context(patch('login.permissions._accesses_of', return_value={views.ACCESS_CURRICULUM}))
                return response_value(views.curriculum_free_programme_modules(free_request(), 'P'))
        for error, status in ((None, 200), (ValueError('invalid'), 400), (views.FreeCourseInUse('used'), 409), (RuntimeError('failed'), 500)):
            self.assertEqual(self.compare(lambda old: scenario(old, error))[0], status)

    def test_free_http_retains_csrf_workspace_and_authoring_gates(self):
        def scenario(original, *, csrf=True, role='staff', grants=()):
            events = []
            save = Mock(return_value=[])
            with storage_scope(original, events, {'save_free_programme_modules': save}) as stack:
                stack.enter_context(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role) if role else None))
                stack.enter_context(patch('login.permissions._accesses_of', return_value=set(grants)))
                response = views.curriculum_free_programme_modules(free_request(csrf=csrf), 'P')
            # CSRF refusal is intentionally an HTML response, not JSON.
            return response.status_code, response.get('Content-Type'), save.call_count
        both = (views.ACCESS_CURRICULUM, views.ACCESS_FREE_COURSE_AUTHORING)
        cases = [({'csrf': False, 'grants': both}, 403), ({'role': None}, 401),
                 ({'role': 'learner', 'grants': both}, 403), ({}, 403),
                 ({'grants': (views.ACCESS_CURRICULUM,)}, 403), ({'grants': both}, 200)]
        for kwargs, status in cases:
            with self.subTest(kwargs=kwargs):
                result = self.compare(lambda old: scenario(old, **kwargs))
                self.assertEqual(result[0], status)
                self.assertEqual(result[2], int(status == 200))


if __name__ == '__main__':
    raise SystemExit('Run only through the isolated Phase 1F runner.')
