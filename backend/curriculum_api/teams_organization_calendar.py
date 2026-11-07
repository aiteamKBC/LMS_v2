"""Institution-managed delegation, used only for verified imported group calendars.

Refresh credentials never leave the server. Existing original-event/link and
staff authorization checks still run on every operation. No meeting is created
or changed by connecting, refreshing, checking, or disconnecting this credential.
"""
import base64
from contextlib import contextmanager
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from django.db import connection, transaction

TABLE = 'curriculum.teams_organization_calendar_connections'
SCOPES = {'User.Read', 'Group.ReadWrite.All'}
OAUTH_SCOPE = 'openid profile offline_access User.Read Group.ReadWrite.All'


def error(message, code='organization_calendar_unavailable', status=409):
    from .teams_imported_calendar_auth import CalendarConnectionError
    return CalendarConnectionError(message, code, status)


def _key(cfg):
    return str(cfg['tenant']).lower(), str(cfg['client_id']).lower()


def schema_ready():
    with connection.cursor() as cursor:
        cursor.execute('SELECT to_regclass(%s)', [TABLE])
        return cursor.fetchone()[0] is not None


def _load(cfg):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM {TABLE} WHERE tenant_id=%s AND client_id=%s', _key(cfg))
        row = cursor.fetchone()
        return dict(zip((item[0] for item in cursor.description), row)) if row else None


@contextmanager
def _locked(cfg):
    # Also serializes first creation, where SELECT FOR UPDATE has no row to lock.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                           ['teams-organization-calendar:' + ':'.join(_key(cfg))])
        yield


def _store(cfg, row):
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {TABLE}
            (tenant_id,client_id,status,revision,credential_ciphertext,connected_by,updated_by,last_error_code)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (tenant_id,client_id) DO UPDATE SET
            status=excluded.status,revision=excluded.revision,credential_ciphertext=excluded.credential_ciphertext,
            connected_by=excluded.connected_by,updated_by=excluded.updated_by,
            last_error_code=excluded.last_error_code,updated_at=now()''',
            [*_key(cfg), *(row[name] for name in ('status', 'revision', 'credential_ciphertext',
                                                 'connected_by', 'updated_by', 'last_error_code'))])


def _cipher():
    raw = (os.environ.get('CREDENTIAL_ENCRYPTION_KEY') or '').strip()
    if not raw:
        raise error('Calendar connection encryption is not configured.', status=503)
    key = hashlib.sha256(('teams-organization-calendar-v1\0' + raw).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def _seal(record):
    return _cipher().encrypt(json.dumps(record, separators=(',', ':')).encode()).decode()


def _unseal(cfg, row):
    try:
        record = json.loads(_cipher().decrypt(row['credential_ciphertext'].encode()))
        if (record.get('type') != 'organization-calendar-v1' or
                (record.get('tenant'), record.get('clientId')) != _key(cfg) or
                not SCOPES.issubset(record.get('scopes') or []) or
                not record.get('actorId') or not record.get('accessToken') or not record.get('refreshToken')):
            raise ValueError()
        return record
    except (InvalidToken, ValueError, TypeError, AttributeError, KeyError):
        # A wrong/unavailable encryption key is not proof of Microsoft
        # revocation. Keep the ciphertext so configuration can be recovered.
        raise error('The stored organization calendar connection could not be read. Ask an LMS administrator to check its encryption configuration.',
                    'organization_calendar_storage_unreadable', 503) from None


def require_admin(request):
    from login.sessions import authenticate_request
    account = authenticate_request(request)
    if not account or account.role != 'admin':
        raise error('An LMS administrator must manage the organization calendar connection.',
                    'organization_calendar_admin_required', 403)
    return str(account.pk)


def group_calendar(series):
    """Exact directory lookup; no user/attendee calendar is converted to a group."""
    from coach_api.views import microsoft_graph_request
    mailbox = str(series.get('organizer_email') or '').strip()
    if not mailbox:
        return False
    try:
        data = microsoft_graph_request('GET', 'groups?' + urlencode({
            '$filter': "mail eq '" + mailbox.replace("'", "''") + "'", '$select': 'id,mail', '$top': 2}))
    except (RuntimeError, httpx.HTTPError) as exc:
        raise error('Microsoft could not identify the original calendar. Retry its status check.', status=503) from exc
    matches = [item for item in data.get('value', []) if item.get('id') and
               str(item.get('mail') or '').casefold() == mailbox.casefold()]
    if len(matches) > 1 or data.get('@odata.nextLink'):
        raise error('The original group calendar could not be identified uniquely.')
    return len(matches) == 1


def status(cfg):
    if not schema_ready():
        return {'connected': False, 'state': 'migration_required', 'available': False,
                'message': 'An LMS administrator must apply the organization calendar database migration.'}
    row = _load(cfg)
    state = row['status'] if row else 'disconnected'
    connected = state == 'active' and bool(row.get('credential_ciphertext'))
    return {'connected': connected, 'state': state, 'available': True,
            'revision': row['revision'] if row else '',
            'message': ('Connected for the organization. Microsoft access is refreshed automatically.' if connected else
                        'An LMS administrator must reconnect the organization calendar.' if state == 'reauth_required' else
                        'An LMS administrator connects the organization calendar once for authorised staff.')}


def begin(request, cfg):
    require_admin(request)
    current = status(cfg)
    if not current['available']:
        raise error(current['message'], 'organization_calendar_migration_required', 503)
    return current['revision']


def save(request, cfg, access, expected_revision):
    actor = require_admin(request)
    if not access.get('refreshToken') or not SCOPES.issubset(access.get('scopes') or []):
        raise error('Microsoft did not return renewable group-calendar access. Reconnect the organization calendar.')
    record = {**access, 'type': 'organization-calendar-v1', 'tenant': _key(cfg)[0], 'clientId': _key(cfg)[1]}
    with _locked(cfg):
        current = _load(cfg)
        if (current['revision'] if current else '') != expected_revision:
            raise error('Another administrator changed the organization connection. Reload its status before reconnecting.',
                        'organization_calendar_changed')
        _store(cfg, {'status': 'active', 'revision': secrets.token_hex(16), 'credential_ciphertext': _seal(record),
                     'connected_by': actor, 'updated_by': actor, 'last_error_code': ''})


def disconnect(request, cfg, expected_revision):
    actor = require_admin(request)
    if not schema_ready():
        raise error('The organization calendar database migration is required.', status=503)
    with _locked(cfg):
        current = _load(cfg)
        if not current or current['revision'] != expected_revision:
            raise error('The organization connection changed. Reload its status before disconnecting.',
                        'organization_calendar_changed')
        _store(cfg, {**current, 'status': 'disconnected', 'revision': secrets.token_hex(16),
                     'credential_ciphertext': None, 'updated_by': actor, 'last_error_code': ''})


def _refresh(cfg, record):
    """A token refresh is not a meeting operation; only token POST and /me GET."""
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        response = client.post(f'https://login.microsoftonline.com/{cfg["tenant"]}/oauth2/v2.0/token', data={
            'client_id': cfg['client_id'], 'client_secret': cfg['client_secret'],
            'refresh_token': record['refreshToken'], 'grant_type': 'refresh_token', 'scope': OAUTH_SCOPE})
        if response.status_code in (408, 429) or response.status_code >= 500:
            raise error('Microsoft calendar access could not be refreshed yet. Retry shortly.', status=503)
        if response.status_code != 200:
            try:
                details = response.json()
            except ValueError:
                details = {}
            reason = details.get('error') if isinstance(details, dict) else ''
            if reason in {'invalid_grant', 'interaction_required', 'consent_required', 'login_required', 'access_denied'}:
                return None
            # A client/configuration or unconfirmed provider failure must not
            # destroy a still-recoverable encrypted refresh credential.
            from .teams_imported_calendar_auth import _oauth_error
            failure = _oauth_error(details, 'group')
            raise error(str(failure), failure.code, 503)
        data = response.json()
        if not isinstance(data, dict):
            raise error('Microsoft returned an unreadable calendar renewal response. Retry shortly.', status=503)
        scopes = str(data.get('scope') or '').split()
        access = data.get('access_token')
        expires = int(data.get('expires_in', 0))
        if data.get('refresh_token') is not None and not isinstance(data['refresh_token'], str):
            raise error('Microsoft returned an unreadable calendar renewal response. Retry shortly.', status=503)
        rotated = data.get('refresh_token') or record['refreshToken']
        if (not isinstance(access, str) or not access or expires <= 90 or
                str(data.get('token_type') or '').lower() != 'bearer' or not isinstance(rotated, str)):
            raise error('Microsoft returned an unreadable calendar renewal response. Retry shortly.', status=503)
        if not SCOPES.issubset(scopes):
            return None
        person = client.get('https://graph.microsoft.com/v1.0/me?$select=id',
                            headers={'Authorization': 'Bearer ' + access})
        if person.status_code in (401, 403):
            return None
        if person.status_code != 200:
            raise error('Microsoft account verification is temporarily unavailable. Retry shortly.', status=503)
        identity = person.json()
        if not isinstance(identity, dict) or not identity.get('id'):
            raise error('Microsoft account verification returned an unreadable response. Retry shortly.', status=503)
        if str(identity['id']).casefold() != record['actorId'].casefold():
            return None
        return {**record, 'accessToken': access, 'refreshToken': rotated,
                'scopes': sorted(SCOPES), 'expires': int(time.time()) + expires - 60}


def access(request, series, cfg):
    from .teams_imported_calendar_auth import _actor_binding
    from .teams_imported_participants import join_context
    binding = _actor_binding(request)
    if str(join_context(series.get('join_url')).get('Tid') or '').lower() != _key(cfg)[0]:
        raise error('The organization connection belongs to a different Microsoft tenant.', 'calendar_tenant_mismatch')
    if not schema_ready():
        return None
    row = _load(cfg)
    if not row or row['status'] == 'disconnected':
        return None
    if not group_calendar(series):
        return None
    failed = None
    with _locked(cfg):
        row = _load(cfg)
        if not row or row['status'] == 'disconnected':
            return None
        if row['status'] != 'active':
            raise error('An LMS administrator must reconnect the organization calendar.', 'organization_calendar_reauth_required')
        try:
            record = _unseal(cfg, row)
        except RuntimeError as exc:
            if getattr(exc, 'status', 409) >= 500:
                raise
            failed = exc
        else:
            if record.get('expires', 0) <= time.time() + 90:
                try:
                    record = _refresh(cfg, record)
                except (httpx.HTTPError, ValueError, TypeError) as exc:
                    raise error('Microsoft calendar access could not be refreshed. Retry shortly.', status=503) from exc
                if record is None:
                    failed = error('Microsoft requires an LMS administrator to reconnect the organization calendar.',
                                   'organization_calendar_reauth_required')
                else:
                    _store(cfg, {**row, 'credential_ciphertext': _seal(record), 'updated_by': binding['account'], 'last_error_code': ''})
        if failed:
            # Commit the revocation marker before raising outside the transaction.
            _store(cfg, {**row, 'status': 'reauth_required', 'credential_ciphertext': None,
                         'updated_by': binding['account'], 'last_error_code': 'reauth_required'})
    if failed:
        raise failed
    return {'accessToken': record['accessToken'], 'actorId': record['actorId'], 'tenantId': _key(cfg)[0],
            'scopes': list(record['scopes']), 'mode': 'delegated', 'calendarKind': 'group',
            'organizationManaged': True, 'lmsAccountId': binding['account']}


def for_series(request, live_id):
    """Optional institutional access; retain the existing app/user flows otherwise."""
    if not schema_ready():
        return None
    from login.microsoft_sso import config
    from coach_api.views import get_graph_settings
    from .teams_imported_participants import GUID
    value = config()
    tenant = str(get_graph_settings().get('tenant_id') or '').lower()
    if not GUID.fullmatch(tenant) or not value.get('client_id'):
        return None
    # An absent institutional grant must not make a working app-only/user
    # calendar depend on SSO configuration or imported-series lookup.
    row = _load({'tenant': tenant, 'client_id': value['client_id']})
    if not row or row['status'] == 'disconnected':
        return None
    from .teams_imported_calendar_auth import _series, _configuration
    series = _series(live_id)
    cfg = _configuration(request, series)
    return access(request, series, cfg)
