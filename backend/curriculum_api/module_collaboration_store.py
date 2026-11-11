"""Redis atomic room state; presence and renewals never write to PostgreSQL."""
import hashlib
import json
import threading
import time

from .module_collaboration_state import CoordinationUnavailable, clean_room


class RedisRoomStore:
    def __init__(self, client):
        self.client = client

    def key(self, module_id):
        return 'lms:module-collaboration:v1:' + hashlib.sha256(module_id.encode()).hexdigest()

    def read(self, module_id):
        try:
            raw = self.client.get(self.key(module_id))
            return clean_room(json.loads(raw) if raw else None, time.time())
        except Exception as exc:
            raise CoordinationUnavailable('Live editing coordination is temporarily unavailable.') from exc

    def update(self, module_id, change):
        from redis.exceptions import WatchError
        try:
            for _ in range(4):
                with self.client.pipeline() as pipeline:
                    try:
                        pipeline.watch(self.key(module_id))
                        raw = pipeline.get(self.key(module_id))
                        room, result = change(json.loads(raw) if raw else None, time.time())
                        encoded = json.dumps(room, separators=(',', ':'))
                        if len(encoded) > 512_000:
                            raise CoordinationUnavailable('This page has reached its collaboration capacity.')
                        pipeline.multi()
                        pipeline.set(self.key(module_id), encoded, ex=150)
                        pipeline.execute()
                        return result
                    except WatchError:
                        continue
        except CoordinationUnavailable:
            raise
        except Exception as exc:
            raise CoordinationUnavailable('Live editing coordination is temporarily unavailable.') from exc
        raise CoordinationUnavailable('The editing coordinator is busy. Try again in a moment.')


class MemoryRoomStore:
    """Deterministic isolated test adapter; never selected by production settings."""
    def __init__(self, clock=time.time):
        self.clock, self.rooms, self.lock = clock, {}, threading.RLock()

    def read(self, module_id):
        with self.lock:
            return clean_room(self.rooms.get(module_id), self.clock())

    def update(self, module_id, change):
        with self.lock:
            room, result = change(self.rooms.get(module_id), self.clock())
            self.rooms[module_id] = room
            return result
