"""Run with a verified disposable PostgreSQL runner, never an app database."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection, connections
from django.test import RequestFactory, override_settings
from django.urls import resolve

from . import free_course_authoring as api, module_collaboration as collaboration, views as v
from .free_course_storage_schema import provision
from .module_collaboration_state import CoordinationUnavailable, field_key
from .module_collaboration_store import MemoryRoomStore
from .tests import CurriculumPersistenceTransactionHarness


@override_settings(CURRICULUM_COLLABORATION_ENABLED=True, CURRICULUM_COLLABORATION_MODULES=(),
                   CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class FreeCourseAuthoringTests(CurriculumPersistenceTransactionHarness):
    databases = {'default', 'enrolment'}

    def setUp(self):
        super().setUp()
        self.assertEqual(connection.vendor, 'postgresql')
        provision(connection)
        self.module_id = 'MOD-FREE-COLLAB'
        self.saved = v.save_module_authoring_structure(self.module_id, {
            'isFreeCourse': True, 'title': 'Independent study', 'isForSale': True, 'price': '19.99', 'currency': 'GBP',
            'weekStructure': [{'id': 'WEEK-FREE-COLLAB', 'title': 'Study', 'components': [
                {'id': 'COMP-FREE-C1', 'type': 'reading', 'title': 'Reading', 'expectedOtjh': 1,
                 'settings': {'readingSource': 'Text', 'readingContent': '<p>Original</p>', 'customNote': 'Keep'}},
                {'id': 'COMP-FREE-C2', 'type': 'reading', 'title': 'Practice', 'expectedOtjh': 2},
            ]}],
        }, repair_links=False)
        self.course_id = v.free_programme_fetch_all(v.FREE_COURSES_TABLE,
            'module_catalogue_id = %s', [self.module_id])[0]['id']
        self.base_url = '/curriculum_api/curriculum/free-courses/' + self.course_id
        self.account = SimpleNamespace(role='staff', pk=100)
        self.auth = self.enterContext(patch('login.permissions.authenticate_request', side_effect=lambda r: self.account))
        self.enterContext(patch('login.sessions.authenticate_request', side_effect=lambda r: self.account))
        self.enterContext(patch('curriculum_api.video_imports.enabled', return_value=False))
        self.store = MemoryRoomStore()
        self.enterContext(patch.object(collaboration, 'get_store', return_value=self.store))

    def call(self, method, suffix='/structure/', payload=None, *, csrf=True, **headers):
        request = getattr(RequestFactory(), method)(self.base_url + suffix,
            data=json.dumps(payload or {}) if method != 'get' else {}, content_type='application/json', **headers)
        request._dont_enforce_csrf_checks = csrf
        match = resolve(request.path)
        return match.func(request, **match.kwargs)

    def read(self):
        response = self.call('get')
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def edit(self, component='COMP-FREE-C1', **values):
        return self.call('patch', '/components/' + component + '/',
                         {'expectedRevision': self.read()['structureRevision'], **values})

    def test_catalogue_exposes_same_builder_identity_and_collaboration_room(self):
        result = api.catalogue(RequestFactory().get('/'))
        entry = next(item for item in json.loads(result.content)['results'] if item['courseId'] == self.course_id)
        self.assertEqual(entry['moduleCatalogueId'], self.module_id)
        self.assertTrue(entry['editable'])
        response = self.call('get', '/collaboration/')
        self.assertEqual(json.loads(response.content)['moduleId'], self.module_id)
        self.assertEqual(self.read()['structureRevision'], v.module_structure_revision(self.module_id))

    def test_missing_and_stale_versions_write_nothing(self):
        before = self.read()
        for extra, code in (({}, 428), ({'expectedRevision': 'stale'}, 409)):
            with self.subTest(code=code):
                result = self.call('patch', '/components/COMP-FREE-C1/', {'title': 'Unsafe', **extra})
                self.assertEqual(result.status_code, code, result.content)
                self.assertEqual(self.read()['structureRevision'], before['structureRevision'])

    def test_builder_save_blocks_stale_tool_and_retry_preserves_both_changes(self):
        before = self.read()
        candidate = copy.deepcopy(before)
        candidate['weekStructure'][0]['components'][0]['title'] = 'Builder edit'
        request = RequestFactory().patch('/', json.dumps({**candidate, 'expectedRevision': before['structureRevision']}),
                                         content_type='application/json')
        response = v.curriculum_module_structure(request, self.module_id)
        self.assertEqual(response.status_code, 200, response.content)
        result = self.call('patch', '/components/COMP-FREE-C2/',
            {'title': 'Tool edit', 'expectedRevision': before['structureRevision']})
        self.assertEqual(result.status_code, 409, result.content)
        result = self.edit('COMP-FREE-C2', title='Tool edit')
        self.assertEqual(result.status_code, 200, result.content)
        saved = self.read()
        self.assertEqual([c['title'] for c in saved['weekStructure'][0]['components']], ['Builder edit', 'Tool edit'])
        self.assertTrue(saved['isFreeCourse'])
        self.assertEqual(saved['price'], '19.99')

    def test_tool_edit_cannot_be_overwritten_by_stale_builder(self):
        before = self.read()
        self.assertEqual(self.edit(title='Tool saved').status_code, 200)
        request = RequestFactory().patch('/', json.dumps({**before, 'expectedRevision': before['structureRevision']}),
                                         content_type='application/json')
        result = v.curriculum_module_structure(request, self.module_id)
        self.assertEqual(result.status_code, 409, result.content)
        self.assertEqual(self.read()['weekStructure'][0]['components'][0]['title'], 'Tool saved')

    def test_two_concurrent_tool_writes_only_accept_one_revision(self):
        revision = self.read()['structureRevision']
        barrier = Barrier(2)
        def save(title):
            try:
                barrier.wait(timeout=10)
                return self.call('patch', '/components/COMP-FREE-C1/',
                    {'expectedRevision': revision, 'title': title}).status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(save, ['Editor A', 'Editor B']))
        self.assertEqual(sorted(results), [200, 409])

    def test_tool_respects_builder_reservation_but_can_edit_another_field(self):
        actor = {'account': '101', 'editor': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'connection': 'a', 'name': 'Colleague'}
        collaboration.apply_event(self.module_id, 'join', actor)
        key = field_key('component', 'COMP-FREE-C1', 'title')
        collaboration.claim(self.module_id, actor, key)
        blocked = self.edit(title='Overwrite')
        self.assertEqual(blocked.status_code, 409, blocked.content)
        self.assertEqual(json.loads(blocked.content)['code'], 'module_edit_reserved')
        self.assertEqual(self.edit(expectedOtjh=3).status_code, 200)
        week_delete = self.call('delete', '/weeks/WEEK-FREE-COLLAB/',
                               {'expectedRevision': self.read()['structureRevision']})
        self.assertEqual(week_delete.status_code, 409, week_delete.content)
        saved = self.read()['weekStructure'][0]['components'][0]
        self.assertEqual(saved['title'], 'Reading')
        self.assertEqual(saved['expectedOtjh'], 3)

    def test_settings_patch_preserves_unnamed_values_and_other_component(self):
        before = self.read()['weekStructure'][0]['components']
        self.assertEqual(json.loads(before[0]['settings']['legacySettings'])['customNote'], 'Keep')
        result = self.edit(settings={'readingContent': '<p>Changed</p>'})
        self.assertEqual(result.status_code, 200, result.content)
        items = self.read()['weekStructure'][0]['components']
        self.assertEqual(items[0]['settings']['legacySettings'], before[0]['settings']['legacySettings'])
        self.assertEqual(items[0]['settings']['readingSource'], before[0]['settings']['readingSource'])
        self.assertEqual(items[0]['settings']['readingContent'], '<p>Changed</p>')
        self.assertEqual(items[1], before[1])

    def test_create_then_soft_delete_component_and_week_keeps_history_rows(self):
        response = self.call('post', '/weeks/', {'title': 'Extra week', 'expectedRevision': self.read()['structureRevision']})
        self.assertEqual(response.status_code, 201, response.content)
        week = json.loads(response.content)['itemId']
        response = self.call('post', '/components/', {'title': 'New reading', 'type': 'reading', 'weekId': week,
                                                    'expectedRevision': self.read()['structureRevision']})
        self.assertEqual(response.status_code, 201, response.content)
        component = json.loads(response.content)['itemId']
        response = self.call('delete', '/components/' + component + '/', {'expectedRevision': self.read()['structureRevision']})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(json.loads(response.content)['permanent'])
        row = v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE, 'id=%s', [component])[0]
        self.assertIsNotNone(row['deleted_at'])
        row = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'authoring_component_id=%s', [component])[0]
        self.assertIsNotNone(row['deleted_at'])
        response = self.call('delete', '/weeks/' + week + '/', {'expectedRevision': self.read()['structureRevision']})
        self.assertEqual(response.status_code, 200, response.content)
        row = v.authoring_fetch_all(v.AUTHORING_WEEKS_TABLE, 'id=%s', [week])[0]
        self.assertIsNotNone(row['deleted_at'])
        row = v.free_programme_fetch_all(v.FREE_PROGRAMME_MODULES_TABLE, 'authoring_week_id=%s', [week])[0]
        self.assertIsNotNone(row['deleted_at'])
        self.assertEqual(len(self.read()['weekStructure'][0]['components']), 2)

    def test_invalid_or_out_of_scope_writes_are_rejected(self):
        before = self.read()['structureRevision']
        for suffix, body, status in (
            ('/components/OTHER/', {'title': 'Foreign'}, 404),
            ('/components/COMP-FREE-C1/', {'moduleCatalogueId': 'OTHER'}, 400),
            ('/components/COMP-FREE-C1/', {'settings': None}, 400),
            ('/components/COMP-FREE-C1/', {'type': 'live-session'}, 400),
        ):
            with self.subTest(body=body):
                result = self.call('patch', suffix, {**body, 'expectedRevision': before})
                self.assertEqual(result.status_code, status, result.content)
        result = self.call('post', '/components/', {'title': 'Foreign', 'type': 'reading', 'weekId': 'OTHER', 'expectedRevision': before})
        self.assertEqual(result.status_code, 404, result.content)
        self.assertEqual(self.read()['structureRevision'], before)

    def test_coordination_outage_retains_content(self):
        before = self.read()['structureRevision']
        with patch.object(self.store, 'read', side_effect=CoordinationUnavailable()):
            result = self.call('patch', '/components/COMP-FREE-C1/', {'title': 'Unsafe', 'expectedRevision': before})
        self.assertEqual(result.status_code, 503, result.content)
        self.assertEqual(self.read()['structureRevision'], before)

    def test_role_and_csrf_gates_apply_before_edit(self):
        revision = self.read()['structureRevision']
        for role, status in ((None, 401), ('learner', 403), ('coach', 403), ('tutor', 403), ('employer', 403)):
            self.account = SimpleNamespace(role=role, pk=100) if role else None
            for method in ('get', 'patch'):
                result = self.call(method, '/components/COMP-FREE-C1/',
                                   {'title': 'Forbidden', 'expectedRevision': revision})
                self.assertEqual(result.status_code, status, result.content)
        for role in ('admin', 'staff'):
            self.account = SimpleNamespace(role=role, pk=100)
            self.assertEqual(self.call('get').status_code, 200)
        self.assertEqual(self.call('patch', '/components/COMP-FREE-C1/', {}, csrf=False).status_code, 403)
        self.assertEqual(self.read()['structureRevision'], revision)

    @override_settings(CURRICULUM_COLLABORATION_ENABLED=False)
    def test_version_guard_still_applies_when_live_presence_is_disabled(self):
        before = self.read()['structureRevision']
        result = self.call('patch', '/components/COMP-FREE-C1/', {'title': 'First'}, HTTP_IF_MATCH=before)
        self.assertEqual(result.status_code, 200, result.content)
        result = self.call('patch', '/components/COMP-FREE-C2/', {'title': 'Stale'}, HTTP_IF_MATCH=before)
        self.assertEqual(result.status_code, 409, result.content)
        self.assertEqual(self.read()['weekStructure'][0]['components'][1]['title'], 'Practice')

    def test_reservation_owner_can_save_using_same_proof_as_builder(self):
        actor = {'account': '100', 'editor': 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', 'connection': 'b', 'name': 'Tool editor'}
        collaboration.apply_event(self.module_id, 'join', actor)
        key = field_key('component', 'COMP-FREE-C1', 'title')
        token = collaboration.claim(self.module_id, actor, key)['token']
        result = self.edit(title='Owner edit', collaboration={'editorId': actor['editor'], 'proofs': {key: token}})
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.read()['weekStructure'][0]['components'][0]['title'], 'Owner edit')

    def test_full_course_save_requires_revision_and_checks_reservations(self):
        before = self.read()
        candidate = copy.deepcopy(before)
        candidate['weekStructure'][0]['components'][0]['title'] = 'Whole course edit'
        result = self.call('patch', payload=candidate)
        self.assertEqual(result.status_code, 428, result.content)
        candidate['expectedRevision'] = before['structureRevision']
        result = self.call('patch', payload=candidate)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(self.call('patch', payload=candidate).status_code, 409)
        actor = {'account': '101', 'editor': 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', 'connection': 'a', 'name': 'Colleague'}
        collaboration.apply_event(self.module_id, 'join', actor)
        collaboration.claim(self.module_id, actor, field_key('module', self.module_id, 'title'))
        candidate = self.read()
        candidate.update(title='Reserved course title', expectedRevision=candidate['structureRevision'])
        result = self.call('patch', payload=candidate)
        self.assertEqual(result.status_code, 409, result.content)
        self.assertEqual(json.loads(result.content)['code'], 'module_edit_reserved')

    def test_legacy_bulk_save_cannot_replace_builder_course(self):
        before = self.read()['structureRevision']
        with self.assertRaises(ValueError):
            v.save_free_programme_modules('FREE-COURSES', {'modules': [{'courseId': self.course_id}]})
        self.assertEqual(self.read()['structureRevision'], before)

    def test_converted_course_cannot_use_free_authoring_api(self):
        v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id=%s', [self.module_id],
                                {'source_type': 'module_authoring'})
        result = self.call('get')
        self.assertEqual(result.status_code, 404, result.content)
