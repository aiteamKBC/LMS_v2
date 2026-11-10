"""Shared cache of live login sessions, keyed by a digest of the token hash.

``resolve_session`` used to read ``login."Login_sessions"`` joined to the
account on every API request. This keeps the result of that read in Valkey for
at most ``ENTRY_TTL_SECONDS`` (60 s) and applies the very same checks to it --
not revoked, not expired, account active -- on every request, so an expiry
still takes effect at its exact time.

What is stored, and what is not:

* The key is ``login-sess:v1:<sha256("login-sess|" + token hash)>``: neither
  the raw token nor the token hash the database holds appears in Valkey.
* The value is the session's columns except ``Token_hash`` (restored in
  memory from the caller's own hash) and the account's columns except
  ``Password_hash``, which the rebuilt account leaves deferred (a full save()
  can then never write it from a cached copy), plus the account version and
  the namespace generation it was built under.
* Only live sessions are stored. An unknown, revoked, expired or inactive
  result is never cached: each such request reads the database, as before.

Invalidation is by account version (config.cache_versions): every write to an
account or its sessions -- logout, revoke-all on a password change or
deactivation, role and status changes, renewals, bulk revocations, deletes,
prunes -- sets a new version once it commits, through post_save/post_delete
and the models' version-bumping querysets. An entry built under any other
version, or with its version key missing, is not used.

A miss reads the session, then the account version, then the session again,
and stores only what that second read saw. A revocation that committed before
the version was read is in the second read; one that commits later moves the
version. Either way nothing stale is stored under the current version.

Valkey unavailable: the database answers, exactly as before; the process-local
fallback is never used for sessions. Residual risk (see config.cache_versions):
a process that cannot reach Valkey cannot retire entries the others still read,
for at most the 60 s TTL.
"""
from __future__ import annotations

import hashlib
import logging
import threading

from django.db import router
from django.db.models.signals import post_delete, post_save
from django.utils import timezone

from config import cache_versions

logger = logging.getLogger(__name__)

NAMESPACE = 'login-acct'
ENTRY_TTL_SECONDS = 60
_HINT_LIMIT = 20000
_account_hint = {}  # entry key -> account id; a session's account never changes
_hint_lock = threading.Lock()


def enabled() -> bool:
    return (cache_versions.enabled('LOGIN_SESSION_CACHE') and cache_versions.shared_cache_available()
            and not cache_versions.in_transaction())


def entry_key(token_hash: str) -> str:
    return 'login-sess:v1:' + hashlib.sha256(f'login-sess|{token_hash}'.encode()).hexdigest()


def _account_fields():
    from .models import LoginAccount
    return [f.attname for f in LoginAccount._meta.concrete_fields if f.attname != 'password_hash']


def _session_fields():
    # Not the token hash: the caller has it already and it is restored on the
    # rebuilt session in memory, so Valkey holds no credential material.
    from .models import LoginSession
    return [f.attname for f in LoginSession._meta.concrete_fields if f.attname != 'token_hash']


def _pack(session, version, generation):
    account = session.account
    return {
        'session': [getattr(session, name) for name in _session_fields()],
        'account': [getattr(account, name) for name in _account_fields()],
        'account_id': session.account_id,
        'v': version,
        'g': generation,
        'db': session._state.db,
    }


def _unpack(entry, token_hash):
    from .models import LoginAccount, LoginSession
    db = entry.get('db') or router.db_for_read(LoginSession) or 'default'
    account = LoginAccount.from_db(db, _account_fields(), entry['account'])
    session = LoginSession.from_db(db, _session_fields(), entry['session'])
    session.token_hash = token_hash
    LoginSession.account.field.set_cached_value(session, account)
    return session


def lookup(token_hash):
    """The cached live session for this token hash, or None (read the database)."""
    if not enabled():
        return None
    key = entry_key(token_hash)
    with _hint_lock:
        account_id = _account_hint.get(key)
    try:
        cache_versions.flush_pending()
        keys = [key]
        if account_id is not None:
            keys += [cache_versions.version_key(NAMESPACE, account_id), cache_versions.generation_key(NAMESPACE)]
        found = cache_versions.strict('get_many', keys)
        entry = found.get(key)
        if not entry:
            return None
        if account_id is None or entry['account_id'] != account_id:
            account_id = entry['account_id']
            found.update(cache_versions.strict('get_many', [
                cache_versions.version_key(NAMESPACE, account_id), cache_versions.generation_key(NAMESPACE)]))
        version = found.get(cache_versions.version_key(NAMESPACE, account_id))
        generation = found.get(cache_versions.generation_key(NAMESPACE))
        # A missing version or generation is a miss, never a match.
        if version is None or generation is None or version != entry['v'] or generation != entry['g']:
            return None
        return _unpack(entry, token_hash)
    except cache_versions.Unavailable:
        return None
    except Exception:
        logger.warning('Discarding an unreadable cached login session.', exc_info=True)
        return None


def remember(token_hash, session, reread):
    """Store a live session read from the database; return the session to use.

    ``reread`` runs the same database read again after the version is read
    (see the module docstring). Its result is what the caller must use: it is
    newer, and may be None if the session was revoked in between.
    """
    if not enabled():
        return session
    try:
        version, generation = cache_versions.current(NAMESPACE, session.account_id)
    except cache_versions.Unavailable:
        return session
    fresh = reread()
    if fresh is None or fresh.revoked_at is not None or not fresh.account.is_active:
        return fresh
    remaining = (fresh.expires_at - timezone.now()).total_seconds()
    if remaining <= 1:
        return fresh
    key = entry_key(token_hash)
    try:
        cache_versions.strict('set', key, _pack(fresh, version, generation),
                              timeout=int(min(ENTRY_TTL_SECONDS, remaining)))
    except cache_versions.Unavailable:
        return fresh
    with _hint_lock:
        if len(_account_hint) > _HINT_LIMIT:
            _account_hint.clear()
        _account_hint[key] = fresh.account_id
    return fresh


def bump_account(account_id, using=None):
    cache_versions.bump(NAMESPACE, [account_id], using=using)


def _on_account_write(sender, instance, using=None, **kwargs):
    bump_account(instance.pk, using=using)


def _on_session_write(sender, instance, using=None, **kwargs):
    bump_account(instance.account_id, using=using)


def connect_signals():
    from .models import LoginAccount, LoginSession
    for signal in (post_save, post_delete):
        signal.connect(_on_account_write, sender=LoginAccount, weak=False,
                       dispatch_uid=f'login-session-cache:account:{signal is post_save}')
        signal.connect(_on_session_write, sender=LoginSession, weak=False,
                       dispatch_uid=f'login-session-cache:session:{signal is post_save}')


def reset_for_tests():
    with _hint_lock:
        _account_hint.clear()
