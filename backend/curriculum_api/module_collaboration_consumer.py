"""A separate, origin-checked WebSocket using the LMS's revocable kbc_session.

Does not turn on chat or use Django's unrelated admin-site session. The sidebar
only receives names of staff on this module; drafts/content never use sockets.
"""
import hashlib
import logging
import json
import time
import uuid
from types import SimpleNamespace
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.routing import URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.sessions import CookieMiddleware
from django.urls import path

from . import module_collaboration as service
from .module_collaboration_state import CoordinationUnavailable, ReservationBusy


def authenticate(cookies, module_id, *, check_module=False):
    from login.sessions import authenticate_request, session_unreadable
    from login.api_gate import refusal_for
    request = SimpleNamespace(COOKIES=cookies)
    account = authenticate_request(request)
    if account is None:
        if session_unreadable(request):
            raise CoordinationUnavailable('Sign-in could not be checked.')
        return None
    if account.role not in ('admin', 'staff'):
        return None
    refusal = refusal_for('/curriculum_api/curriculum/modules/' + module_id + '/collaboration/', account)
    if refusal is not None:
        if refusal.status_code == 503:
            raise CoordinationUnavailable('Staff access could not be checked.')
        return None
    if check_module and service.resolve_module(module_id) != module_id:
        return None
    return {'account': str(account.pk), 'name': str(account.display_name or 'A colleague')[:100]}


class ModuleCollaborationConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.joined = False
        self.message_times = []
        self.module_id = self.scope['url_route']['kwargs']['module_id']
        if not service.enabled(self.module_id):
            await self.close(code=4404)
            return
        try:
            editor = parse_qs(self.scope.get('query_string', b'').decode()).get('editor', [''])[0]
            editor = str(uuid.UUID(editor))
            identity = await database_sync_to_async(authenticate)(self.scope.get('cookies', {}), self.module_id, check_module=True)
            if not identity:
                await self.close(code=4403)
                return
            self.actor = {**identity, 'editor': editor, 'connection': uuid.uuid4().hex}
            self.auth_checked_at = time.monotonic()
            result = await database_sync_to_async(service.apply_event)(self.module_id, 'join', self.actor)
            self.group_name = 'module_edit_' + hashlib.sha256(self.module_id.encode()).hexdigest()
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            self.joined = True
            await self.accept()
            await self.send_json({'type': 'state', **result})
            await self.publish(result)
        except (ValueError, UnicodeDecodeError):
            await self.close(code=4400)
        except CoordinationUnavailable:
            await self.close(code=1013)

    async def disconnect(self, close_code):
        if not self.joined:
            return
        try:
            result = await database_sync_to_async(service.apply_event)(self.module_id, 'leave', self.actor)
            await self.publish(result)
        except CoordinationUnavailable:
            logging.getLogger(__name__).info('Editing presence cleanup deferred to its bounded expiry.')
        finally:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if bytes_data is not None or text_data is None or len(text_data) > 16_000:
            await self.close(code=4400)
            return
        now = time.monotonic()
        self.message_times = [stamp for stamp in self.message_times if now - stamp < 1]
        if len(self.message_times) >= 20:
            await self.close(code=4429)
            return
        self.message_times.append(now)
        try:
            await super().receive(text_data=text_data, **kwargs)
        except json.JSONDecodeError:
            await self.close(code=4400)

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            await self.close(code=4400)
            return
        action = content.get('type')
        request_id = str(content.get('requestId') or '')[:80]
        try:
            # Fresh identity before acquiring any field; periodic revalidation
            # bounds presence visibility on logout/role changes. Normal saves
            # additionally authenticate on every HTTP request.
            if time.monotonic() - self.auth_checked_at >= 60:
                identity = await database_sync_to_async(authenticate)(self.scope.get('cookies', {}), self.module_id)
                if not identity or identity['account'] != self.actor['account']:
                    await self.close(code=4403)
                    return
                self.auth_checked_at = time.monotonic()
            if action == 'claim':
                result = await database_sync_to_async(service.claim)(self.module_id, self.actor, str(content.get('key') or ''))
            elif action == 'heartbeat':
                renew = content.get('renew') or []
                if not isinstance(renew, list) or any(not isinstance(item, dict) for item in renew):
                    raise ValueError('Invalid reservation renewal.')
                result = await database_sync_to_async(service.apply_event)(self.module_id, action, self.actor, renew=renew)
            elif action == 'release':
                release = content.get('release') or []
                if not isinstance(release, list) or len(release) > 64 or any(not isinstance(item, dict) for item in release):
                    raise ValueError('Invalid reservation release.')
                result = await database_sync_to_async(service.apply_event)(self.module_id, action, self.actor,
                    key=str(content.get('key') or ''), token=str(content.get('token') or ''), release=release)
            else:
                raise ValueError('Unsupported editing event.')
            await self.send_json({'type': 'state', 'requestId': request_id, **result})
            await self.publish(result, claimed=content.get('key') if action == 'claim' and result.get('ok') else '')
        except ValueError as exc:
            await self.send_json({'type': 'error', 'requestId': request_id, 'error': str(exc)})
        except ReservationBusy as exc:
            await self.send_json({'type': 'error', 'requestId': request_id, 'code': 'field_retry', 'error': str(exc)})
        except CoordinationUnavailable:
            await self.send_json({'type': 'error', 'requestId': request_id,
                'error': 'Live editing coordination is unavailable. Your draft is retained.'})
            await self.close(code=1013)

    async def publish(self, result, claimed=''):
        if result.get('presenceChanged'):
            await self.channel_layer.group_send(self.group_name, {'type': 'module.edit.event',
                'payload': {'type': 'presence', 'members': result['members']}})
        released = result.get('released', [])
        leased = [item for item in result.get('leases', []) if item['key'] == claimed]
        if released or leased:
            await self.channel_layer.group_send(self.group_name, {'type': 'module.edit.event',
                'payload': {'type': 'leases', 'released': released, 'leases': leased}})

    async def module_edit_event(self, event):
        await self.send_json(event['payload'])

    async def module_saved(self, event):
        await self.send_json({'type': 'saved'})


class ModuleCollaborationASGI:
    """Add one isolated route without changing existing chat authorization."""
    def __init__(self, existing):
        self.existing = existing
        self.collaboration = AllowedHostsOriginValidator(CookieMiddleware(URLRouter([
            path('ws/curriculum/module-collaboration/<str:module_id>/', ModuleCollaborationConsumer.as_asgi()),
        ])))

    async def __call__(self, scope, receive, send):
        app = self.collaboration if scope.get('path', '').startswith('/ws/curriculum/module-collaboration/') else self.existing
        await app(scope, receive, send)
