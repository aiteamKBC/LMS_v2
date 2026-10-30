"""Synthetic staff, RAM coordinator, no Graph/mail or production data."""
import asyncio
import copy
import json
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from . import module_collaboration as service
from .module_collaboration_state import (
    CoordinationUnavailable, ReservationBusy, blocked_fields, changed_fields, field_key, parse_field_key, transition,
)
from .module_collaboration_store import MemoryRoomStore, RedisRoomStore

ALICE = dict(editor='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', connection='a1', account='1', name='Synthetic Alice')
BOB = dict(editor='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', connection='b1', account='2', name='Synthetic Bob')
TITLE = field_key('component', 'C1', 'title')
HOURS = field_key('component', 'C1', 'expectedOtjh')


def module():
    return dict(catalogueId='M1', title='Module', declaredTotalOtjh=1, weekStructure=[
        dict(id='W1', summary='Week', components=[dict(id='C1', title='Reading', expectedOtjh=1,
            settings=dict(readingContent='<p>Original</p>', teamsEventId='immutable-event'))])])


class FieldReservationTests(SimpleTestCase):
    def setUp(self):
        self.clock = 1000
        self.store = MemoryRoomStore(lambda: self.clock)
        self.event('join', ALICE); self.event('join', BOB)

    def event(self, action, actor, **kw):
        return self.store.update('M1', lambda room, now: transition(room, action, actor, now, **kw))

    def test_same_field_has_one_owner_and_names_the_holder(self):
        first = self.event('claim', ALICE, key=TITLE)
        second = self.event('claim', BOB, key=TITLE)
        self.assertTrue(first['ok']); self.assertFalse(second['ok'])
        self.assertEqual(second['name'], ALICE['name'])
        self.assertNotIn('token', json.dumps(second['leases']))

    def test_different_fields_on_same_record_can_be_edited_and_saved(self):
        a = self.event('claim', ALICE, key=TITLE)
        b = self.event('claim', BOB, key=HOURS)
        self.assertTrue(a['ok'] and b['ok'])
        self.assertEqual([], blocked_fields(self.store.read('M1'), {HOURS}, BOB['editor'], {HOURS: b['token']}, self.clock))
        self.assertEqual(1, len(blocked_fields(self.store.read('M1'), {TITLE}, BOB['editor'], {HOURS: b['token']}, self.clock)))

    def test_atomic_simultaneous_claims_never_both_succeed(self):
        barrier = threading.Barrier(2)
        def acquire(actor):
            barrier.wait()
            return self.event('claim', actor, key=TITLE)['ok']
        with ThreadPoolExecutor(2) as workers:
            self.assertEqual([False, True], sorted(workers.map(acquire, [ALICE, BOB])))

    def test_crashed_tab_releases_field_after_sixty_seconds(self):
        self.event('claim', ALICE, key=TITLE)
        self.clock += 61
        self.assertTrue(self.event('claim', BOB, key=TITLE)['ok'])

    def test_idle_open_tab_presence_does_not_renew_fields(self):
        self.event('claim', ALICE, key=TITLE)
        self.clock += 40; self.event('heartbeat', ALICE)
        self.clock += 21
        self.assertTrue(self.event('claim', BOB, key=TITLE)['ok'])

    def test_actively_edited_field_renews_only_with_secret_proof(self):
        proof = self.event('claim', ALICE, key=TITLE)['token']
        self.clock += 40
        self.event('heartbeat', ALICE, renew=[dict(key=TITLE, token=proof)])
        self.clock += 21
        self.assertFalse(self.event('claim', BOB, key=TITLE)['ok'])

    def test_reconnect_and_delayed_old_disconnect_cannot_remove_new_owner(self):
        old = self.event('claim', ALICE, key=TITLE)['token']
        new = {**ALICE, 'connection': 'a2'}
        self.event('join', new)
        proof = self.event('claim', new, key=TITLE)['token']
        self.assertNotEqual(old, proof)
        self.event('leave', ALICE)
        self.event('release', ALICE, key=TITLE, token=old)
        self.assertEqual(proof, self.store.read('M1')['leases'][TITLE]['token'])

    def test_other_account_cannot_replace_editor_identity(self):
        with self.assertRaises(ValueError): self.event('join', {**BOB, 'editor': ALICE['editor']})

    def test_expired_proof_cannot_write_even_before_another_person_claims(self):
        proof = self.event('claim', ALICE, key=TITLE)['token']
        self.clock += 61
        refused = blocked_fields(self.store.read('M1'), {TITLE}, ALICE['editor'], {TITLE: proof}, self.clock)
        self.assertEqual('lease_expired', refused[0]['reason'])

    def test_wrong_nonce_cannot_renew_or_release(self):
        self.event('claim', ALICE, key=TITLE)
        self.event('release', ALICE, key=TITLE, token='wrong')
        self.clock += 40
        self.event('heartbeat', ALICE, renew=[dict(key=TITLE, token='wrong')])
        self.clock += 21
        self.assertTrue(self.event('claim', BOB, key=TITLE)['ok'])

    def test_malformed_renewal_or_unicode_nonce_never_removes_an_owner(self):
        self.event('claim', ALICE, key=TITLE)
        self.event('release', ALICE, key=TITLE, token='\u00e9')
        with self.assertRaises(ValueError): self.event('heartbeat', ALICE, renew=[{'key': []}])
        refused = blocked_fields(self.store.read('M1'), {TITLE}, ALICE['editor'], {TITLE: '\u00e9'}, self.clock)
        self.assertEqual(1, len(refused))

    def test_normal_leave_releases_immediately(self):
        self.event('claim', ALICE, key=TITLE); self.event('leave', ALICE)
        self.assertTrue(self.event('claim', BOB, key=TITLE)['ok'])

    def test_batch_release_only_releases_matching_ownership(self):
        keys = [field_key('component', 'C1', f'settings.note{index}') for index in range(40)]
        proofs = [{'key': key, 'token': self.event('claim', ALICE, key=key)['token']} for key in keys]
        self.event('claim', BOB, key=TITLE)
        self.event('release', ALICE, release=proofs + [{'key': TITLE, 'token': 'wrong'}])
        self.assertEqual([TITLE], list(self.store.read('M1')['leases']))

    def test_nested_content_type_change_and_deletion_respect_field_owner(self):
        self.event('claim', ALICE, key=field_key('component', 'C1', 'settings.readingContent'))
        for field in ['settings', 'type', '$delete']:
            self.assertFalse(self.event('claim', BOB, key=field_key('component', 'C1', field))['ok'])

    def test_deleting_week_cannot_bypass_child_field_owner(self):
        self.event('claim', ALICE, key=TITLE)
        refused = blocked_fields(self.store.read('M1'), {field_key('week', 'W1', '$delete')}, BOB['editor'], {}, self.clock, parents={'C1': 'W1'})
        self.assertEqual(1, len(refused))

    def test_unrelated_module_room_is_unchanged(self):
        self.event('claim', ALICE, key=TITLE)
        self.assertEqual({}, self.store.read('M2')['leases'])

    def test_derived_totals_and_microsoft_settings_are_not_authored_conflicts(self):
        base = module(); draft = copy.deepcopy(base)
        draft['declaredTotalOtjh'] = 9
        draft['weekStructure'][0]['sessionDate'] = '2026-10-28'
        draft['weekStructure'][0]['components'][0]['settings']['teamsEventId'] = 'new-event'
        self.assertEqual(set(), changed_fields(base, draft))
        draft['weekStructure'][0]['components'][0]['title'] = 'Changed'
        self.assertEqual({TITLE}, changed_fields(base, draft))

    def test_invalid_or_protected_paths_cannot_be_reserved(self):
        for key in ['invalid', '[]', field_key('module', 'M1', 'declaredTotalOtjh'), field_key('component', 'C1', 'settings.teamsEventId')]:
            with self.assertRaises(ValueError): parse_field_key(key)

    def test_store_connection_failure_is_visible_not_an_empty_unlocked_room(self):
        client = SimpleNamespace(get=lambda key: (_ for _ in ()).throw(ConnectionError()))
        with self.assertRaises(CoordinationUnavailable): RedisRoomStore(client).read('M1')


@override_settings(CURRICULUM_COLLABORATION_ENABLED=True, CURRICULUM_COLLABORATION_MODULES=('M1',))
class SaveReservationGuardTests(SimpleTestCase):
    def setUp(self):
        self.store = MemoryRoomStore()
        self.patch = patch.object(service, 'get_store', return_value=self.store); self.patch.start(); self.addCleanup(self.patch.stop)
        service.apply_event('M1', 'join', ALICE)
        service.apply_event('M1', 'claim', ALICE, key=TITLE)

    def save(self, account, candidate, payload=None):
        with patch('login.sessions.authenticate_request', return_value=account):
            return service.check_structure_save(SimpleNamespace(), 'M1', module(), candidate, payload or {})

    def test_legacy_client_cannot_overwrite_reserved_field(self):
        candidate = module(); candidate['weekStructure'][0]['components'][0]['title'] = 'Overwrite'
        response = self.save(SimpleNamespace(pk=2, role='staff'), candidate)
        self.assertEqual(409, response.status_code)
        self.assertEqual('module_edit_reserved', json.loads(response.content)['code'])

    def test_unrelated_field_saves_without_page_lock(self):
        candidate = module(); candidate['weekStructure'][0]['components'][0]['expectedOtjh'] = 3
        self.assertIsNone(self.save(SimpleNamespace(pk=2, role='staff'), candidate))

    def test_unavailable_coordinator_refuses_write(self):
        with patch.object(self.store, 'read', side_effect=CoordinationUnavailable()):
            self.assertEqual(503, self.save(SimpleNamespace(pk=2, role='staff'), module()).status_code)

    def test_unauthorized_roles_and_identity_spoof_are_rejected(self):
        for account in [None, SimpleNamespace(pk=2, role='learner'), SimpleNamespace(pk=2, role='coach')]:
            self.assertEqual(403, self.save(account, module()).status_code)
        self.assertEqual(403, self.save(SimpleNamespace(pk=2, role='staff'), module(), {'collaboration': {'editorId': ALICE['editor']}}).status_code)

    def test_other_modules_keep_existing_behavior(self):
        self.assertFalse(service.enabled('M2'))

    def test_existing_django_operator_http_identity_still_respects_reservations(self):
        request = SimpleNamespace(user=SimpleNamespace(is_authenticated=True, pk=7))
        with patch('login.sessions.authenticate_request', return_value=None):
            draft = module(); draft['weekStructure'][0]['components'][0]['expectedOtjh'] = 2
            self.assertIsNone(service.check_structure_save(request, 'M1', module(), draft, {}))
            draft['weekStructure'][0]['components'][0]['title'] = 'Cannot overwrite'
            self.assertEqual(409, service.check_structure_save(request, 'M1', module(), draft, {}).status_code)
            self.assertEqual(403, service.check_structure_save(request, 'M1', module(), draft,
                {'collaboration': {'editorId': ALICE['editor']}}).status_code)


class SocketIdentityTests(SimpleTestCase):
    def test_socket_uses_the_same_restricted_staff_gate_as_http(self):
        from .module_collaboration_consumer import authenticate
        for access in ['advanced-admin', 'record-monitor']:
            account = SimpleNamespace(pk=1, role='staff', display_name='Synthetic staff',
                _staff_access=access, _staff_accesses=frozenset({access}))
            with patch('login.sessions.authenticate_request', return_value=account):
                self.assertIsNone(authenticate({'kbc_session': 'synthetic'}, 'M1'))

    def test_unreadable_staff_access_is_unavailable_not_stale_permission(self):
        from .module_collaboration_consumer import authenticate
        account = SimpleNamespace(pk=1, role='admin', display_name='Synthetic admin', _staff_access_unavailable=True)
        with patch('login.sessions.authenticate_request', return_value=account):
            with self.assertRaises(CoordinationUnavailable): authenticate({'kbc_session': 'synthetic'}, 'M1')


@override_settings(CURRICULUM_COLLABORATION_ENABLED=True, CURRICULUM_COLLABORATION_MODULES=('M1',),
    ALLOWED_HOSTS=['testserver'], CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class CollaborationSocketTests(SimpleTestCase):
    async def test_content_save_lock_contention_keeps_presence_and_socket_alive(self):
        from channels.testing import WebsocketCommunicator
        from .module_collaboration_consumer import ModuleCollaborationASGI
        store = MemoryRoomStore()
        with patch.object(service, 'get_store', return_value=store), patch('curriculum_api.module_collaboration_consumer.authenticate', return_value={'account': '1', 'name': 'Synthetic staff'}), patch.object(service, 'claim', side_effect=ReservationBusy('Save in progress; draft retained.')):
            socket = WebsocketCommunicator(ModuleCollaborationASGI(None), '/ws/curriculum/module-collaboration/M1/?editor=' + ALICE['editor'], headers=[(b'origin', b'http://testserver')])
            self.assertTrue((await socket.connect())[0]); await socket.receive_json_from(); await socket.receive_json_from()
            await socket.send_json_to({'type': 'claim', 'key': TITLE, 'requestId': 'busy'})
            response = await socket.receive_json_from()
            self.assertEqual('field_retry', response['code'])
            await socket.send_json_to({'type': 'heartbeat'})
            self.assertTrue((await socket.receive_json_from())['ok'])
            await socket.disconnect()

    async def test_two_editors_see_names_and_one_owner_then_disconnect_releases(self):
        from channels.testing import WebsocketCommunicator
        from .module_collaboration_consumer import ModuleCollaborationASGI
        store = MemoryRoomStore()
        async def fallback(scope, receive, send): raise AssertionError('Unexpected chat fallback')
        app = ModuleCollaborationASGI(fallback)
        def authenticate(cookies, module_id, **kw):
            return {'account': '1' if cookies.get('kbc_session') == 'a' else '2', 'name': 'Synthetic ' + cookies.get('kbc_session', '')}
        with patch.object(service, 'get_store', return_value=store), patch('curriculum_api.module_collaboration_consumer.authenticate', side_effect=authenticate), patch.object(service, 'claim', side_effect=lambda module_id, actor, key: service.apply_event(module_id, 'claim', actor, key=key)):
            a = WebsocketCommunicator(app, '/ws/curriculum/module-collaboration/M1/?editor=' + ALICE['editor'], headers=[(b'origin', b'http://testserver'), (b'cookie', b'kbc_session=a')])
            b = WebsocketCommunicator(app, '/ws/curriculum/module-collaboration/M1/?editor=' + BOB['editor'], headers=[(b'origin', b'http://testserver'), (b'cookie', b'kbc_session=b')])
            self.assertTrue((await a.connect())[0]); await a.receive_json_from(); await a.receive_json_from()
            self.assertTrue((await b.connect())[0]); await b.receive_json_from(); await b.receive_json_from(); await a.receive_json_from()
            await a.send_json_to({'type': 'claim', 'key': TITLE, 'requestId': 'grant'})
            grant = await a.receive_json_from(); self.assertTrue(grant['ok'])
            await a.receive_json_from(); await b.receive_json_from()
            await b.send_json_to({'type': 'claim', 'key': TITLE, 'requestId': 'deny'})
            self.assertFalse((await b.receive_json_from())['ok'])
            await a.send_json_to({'type': 'release', 'release': [{'key': TITLE, 'token': grant['token']}]})
            self.assertEqual([], (await a.receive_json_from())['leases'])
            await a.receive_json_from(); await b.receive_json_from()
            await a.send_json_to({'type': 'claim', 'key': TITLE})
            self.assertTrue((await a.receive_json_from())['ok']); await a.receive_json_from(); await b.receive_json_from()
            await a.disconnect()
            # Leave publishes the roster then removed leases.
            self.assertEqual('presence', (await b.receive_json_from())['type'])
            await b.receive_json_from()
            await b.send_json_to({'type': 'claim', 'key': TITLE})
            self.assertTrue((await b.receive_json_from())['ok']); await b.receive_json_from()
            await b.disconnect()

    async def test_foreign_origin_and_learner_are_denied(self):
        from channels.testing import WebsocketCommunicator
        from .module_collaboration_consumer import ModuleCollaborationASGI
        app = ModuleCollaborationASGI(None)
        denied = WebsocketCommunicator(app, '/ws/curriculum/module-collaboration/M1/?editor=' + ALICE['editor'], headers=[(b'origin', b'https://foreign.invalid')])
        self.assertFalse((await denied.connect())[0]); await denied.disconnect()
        with patch('curriculum_api.module_collaboration_consumer.authenticate', return_value=None):
            denied = WebsocketCommunicator(app, '/ws/curriculum/module-collaboration/M1/?editor=' + ALICE['editor'], headers=[(b'origin', b'http://testserver')])
            self.assertFalse((await denied.connect())[0]); await denied.disconnect()
