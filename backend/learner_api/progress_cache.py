"""Shared cache of one learner's KSB progress rows.

Coach and learner pages read the same learner's progress entries joined to
their KSB links many times over (learner_progress_ksbs was the fourth heaviest
statement). ``rows`` and ``rows_by_learner`` return a statement's rows from
Valkey when they can, under:

* a digest of the statement text and of its non-learner parameters;
* the learner's ``Learner.learners`` id;
* the learner's progress version and the namespace generation
  (config.cache_versions), which every write to that learner's progress
  entries or KSB links moves once it commits -- post_save/post_delete, the
  models' version-bumping querysets, and explicit bumps in the raw SQL writers.
  A missing version is a miss.

Only what the statement returns is stored, zlib-compressed. A value above
``MAX_VALUE_BYTES`` compressed (1 MB) is not cached: the read stays live and a
log line counts it, so one heavy learner cannot fill Valkey.

Not covered by an invalidation, and so up to ``ENTRY_TTL_SECONDS`` (120 s)
stale: changes made outside the application to the KSB exclusion registry
("Learner".learner_progress_ksb_exclusions, which no application code writes)
and the one-off scripts in backend/scripts/.

Valkey unavailable: the statement runs against the database, exactly as
before; the process-local fallback is never used. Residual risk as in
config.cache_versions, bounded by the 120 s TTL.
"""
from __future__ import annotations

import hashlib
import json
import logging
import pickle
import zlib

from django.db.models.signals import post_delete, post_save

from config import cache_versions

logger = logging.getLogger(__name__)

NAMESPACE = 'lprog'
ENTRY_TTL_SECONDS = 120
MAX_VALUE_BYTES = 1_000_000


def enabled() -> bool:
    return (cache_versions.enabled('LEARNER_PROGRESS_CACHE') and cache_versions.shared_cache_available()
            and not cache_versions.in_transaction())


def _digest(value) -> str:
    return hashlib.sha1(str(value).encode()).hexdigest()[:16]


def _key(sql, params, learner_id, version, generation):
    extra = json.dumps(params, default=str, sort_keys=True)
    return f'lprog:v1:{_digest(sql)}:{_digest(extra)}:{learner_id}:{_digest(version)}:{_digest(generation)}'


def _pack(rows):
    blob = zlib.compress(pickle.dumps([tuple(row) for row in rows], protocol=pickle.HIGHEST_PROTOCOL), 1)
    return blob if len(blob) <= MAX_VALUE_BYTES else None


def _too_large(learner_id, rows):
    logger.info('Learner progress rows not cached: over %s bytes compressed.', MAX_VALUE_BYTES,
                extra={'event': 'progress_cache.too_large', 'row_count': len(rows)})


def _versions(learner_ids):
    """``{learner id: (version, generation)}``, creating missing keys."""
    cache_versions.flush_pending()
    found = cache_versions.read(NAMESPACE, learner_ids)
    missing = [lid for lid in learner_ids if lid not in found]
    if 'gen' not in found or missing:
        for lid in missing:
            cache_versions.strict('add', cache_versions.version_key(NAMESPACE, lid), cache_versions.new_version(),
                                  timeout=None)
        if 'gen' not in found:
            cache_versions.strict('add', cache_versions.generation_key(NAMESPACE), cache_versions.new_version(),
                                  timeout=None)
        found = cache_versions.read(NAMESPACE, learner_ids)
    if 'gen' not in found or any(lid not in found for lid in learner_ids):
        raise cache_versions.Unavailable('version keys could not be read back')
    return {lid: (found[lid], found['gen']) for lid in learner_ids}


def value(sql, extra_params, learner_id, fetch):
    """``fetch()`` for one learner, cached under ``sql`` and ``extra_params``.

    For readers that do not hold a cursor (old_otjh.repository.query). Put
    anything else the result depends on -- the database alias, a filter -- in
    ``extra_params``.
    """
    key = None
    if enabled() and learner_id not in (None, ''):
        try:
            version, generation = _versions([str(learner_id)])[str(learner_id)]
            key = _key(sql, extra_params, learner_id, version, generation)
            blob = cache_versions.strict('get', key)
            if blob is not None:
                return pickle.loads(zlib.decompress(blob))
        except cache_versions.Unavailable:
            key = None
        except Exception:
            logger.warning('Learner progress cache unavailable; reading the database.', exc_info=True)
            key = None
    result = fetch()
    if key is not None:
        blob = zlib.compress(pickle.dumps(result, protocol=pickle.HIGHEST_PROTOCOL), 1)
        if len(blob) > MAX_VALUE_BYTES:
            _too_large(learner_id, result)
        else:
            try:
                cache_versions.strict('set', key, blob, timeout=ENTRY_TTL_SECONDS)
            except cache_versions.Unavailable:
                pass
    return result


def rows(cursor, sql, params, learner_id, extra_params=None):
    """``cursor.execute(sql, params); cursor.fetchall()`` for one learner, cached.

    ``extra_params`` is everything in ``params`` except the learner id (it is
    part of the key); pass it whenever the statement takes other parameters.
    """
    key = None
    if enabled() and learner_id not in (None, ''):
        try:
            version, generation = _versions([str(learner_id)])[str(learner_id)]
            key = _key(sql, extra_params or [], learner_id, version, generation)
            blob = cache_versions.strict('get', key)
            if blob is not None:
                return pickle.loads(zlib.decompress(blob))
        except cache_versions.Unavailable:
            key = None
        except Exception:
            logger.warning('Learner progress cache unavailable; reading the database.', exc_info=True)
            key = None
    cursor.execute(sql, params)
    result = cursor.fetchall()
    if key is not None:
        blob = _pack(result)
        if blob is None:
            _too_large(learner_id, result)
        else:
            try:
                cache_versions.strict('set', key, blob, timeout=ENTRY_TTL_SECONDS)
            except cache_versions.Unavailable:
                pass
    return result


def rows_by_learner(cursor, sql, learner_ids, learner_index):
    """``{learner id: [rows]}`` for ``sql`` run with ``[learner_ids]``.

    ``sql`` takes the learner id array as its only parameter and returns the
    learner id at ``learner_index``. Rows keep the statement's order within each
    learner. Learners missing from the cache are read in one statement.
    """
    originals = {}
    for lid in learner_ids:
        if lid not in (None, ''):
            originals.setdefault(str(lid), lid)
    ids = list(originals)
    out = {lid: [] for lid in ids}
    keys = {}
    if ids and enabled():
        try:
            versions = _versions(ids)
            keys = {lid: _key(sql, [], lid, *versions[lid]) for lid in ids}
            found = cache_versions.strict('get_many', list(keys.values()))
            for lid in ids:
                blob = found.get(keys[lid])
                if blob is not None:
                    out[lid] = pickle.loads(zlib.decompress(blob))
            missing = [lid for lid in ids if keys[lid] not in found]
        except cache_versions.Unavailable:
            keys, missing = {}, ids
        except Exception:
            logger.warning('Learner progress cache unavailable; reading the database.', exc_info=True)
            keys, missing = {}, ids
    else:
        missing = ids
    if missing:
        # The caller's own values, as the statement always received them.
        cursor.execute(sql, [[originals[lid] for lid in missing]])
        fresh = {lid: [] for lid in missing}
        for row in cursor.fetchall():
            bucket = fresh.get(str(row[learner_index]))
            if bucket is not None:
                bucket.append(row)
        out.update(fresh)
        if keys:
            to_store = {}
            for lid, learner_rows in fresh.items():
                blob = _pack(learner_rows)
                if blob is None:
                    _too_large(lid, learner_rows)
                else:
                    to_store[keys[lid]] = blob
            try:
                if to_store:
                    cache_versions.strict('set_many', to_store, timeout=ENTRY_TTL_SECONDS)
            except cache_versions.Unavailable:
                pass
    return out


def bump_learners(learner_ids, using=None):
    cache_versions.bump(NAMESPACE, learner_ids, using=using)


def _on_entry_write(sender, instance, using=None, **kwargs):
    bump_learners([instance.learner_id], using=using)


def _on_link_write(sender, instance, using=None, **kwargs):
    bump_learners(sender.cache_version_targets([instance]).get(NAMESPACE, []), using=using)


def connect_signals():
    from .models import LearnerProgressEntry, LearnerProgressKsb
    for signal in (post_save, post_delete):
        name = 'save' if signal is post_save else 'delete'
        signal.connect(_on_entry_write, sender=LearnerProgressEntry, weak=False,
                       dispatch_uid=f'progress-cache:entry:{name}')
        signal.connect(_on_link_write, sender=LearnerProgressKsb, weak=False,
                       dispatch_uid=f'progress-cache:ksb:{name}')
