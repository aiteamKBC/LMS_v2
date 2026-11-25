"""Bounded, process-local row reuse, verified against SQL on every read.

An unrelated curriculum write invalidates response caches. It need not transfer
megabytes of unchanged authoring content again. Read current row fingerprints,
then fetch only changed/new rows. This is not a TTL-based source of truth: the
database still decides membership, order and every selected value on each call.
"""
from collections import OrderedDict
import hashlib
import json
import pickle
import threading
import time
import zlib


_FINGERPRINT = '__authoring_row_sha256'
_MAX_BYTES = 32 * 1024 * 1024
_MAX_ENTRY_BYTES = 8 * 1024 * 1024
_MAX_ENTRIES = 64
_TTL_SECONDS = 15 * 60
_SNAPSHOTS = OrderedDict()
_LOCK = threading.Lock()


def _key(connection, table, where, params, order, columns):
    config = getattr(connection, 'settings_dict', None)
    namespace = (
        {name: config.get(name) for name in ('ENGINE', 'HOST', 'PORT', 'NAME', 'USER', 'OPTIONS')}
        if isinstance(config, dict) else {'connection': id(connection)}
    )
    return hashlib.sha256(json.dumps(
        [namespace, table, where, params, order, columns], sort_keys=True, default=str,
    ).encode()).hexdigest()


def _load(key):
    with _LOCK:
        item = _SNAPSHOTS.get(key)
        if item is None:
            return None
        expiry, compressed = item
        if expiry <= time.monotonic():
            del _SNAPSHOTS[key]
            return None
        _SNAPSHOTS.move_to_end(key)
    # Only bytes serialized by _store in this process reach pickle.loads. No
    # files, shared cache, requests or database values can supply this envelope.
    # Each load also gives callers independent dicts/lists, never cached objects.
    return pickle.loads(zlib.decompress(compressed))


def _store(key, rows):
    try:
        compressed = zlib.compress(pickle.dumps(rows, protocol=pickle.HIGHEST_PROTOCOL), level=1)
    except (TypeError, pickle.PicklingError):
        # A future native database type may not be serializable. The fresh
        # database result is still valid; simply don't retain this snapshot.
        return
    if len(compressed) > _MAX_ENTRY_BYTES:
        return
    with _LOCK:
        now = time.monotonic()
        for expired in [k for k, (expiry, _) in _SNAPSHOTS.items() if expiry <= now]:
            del _SNAPSHOTS[expired]
        _SNAPSHOTS[key] = (now + _TTL_SECONDS, compressed)
        _SNAPSHOTS.move_to_end(key)
        while len(_SNAPSHOTS) > _MAX_ENTRIES or sum(len(item[1]) for item in _SNAPSHOTS.values()) > _MAX_BYTES:
            _SNAPSHOTS.popitem(last=False)
