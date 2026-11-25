"""Single process/thread state shared by curriculum reads and invalidation.

Importing this module allocates memory and locks only; no Django, SQL or I/O.
"""
import threading


_CURRICULUM_CACHE = {}
_CURRICULUM_CACHE_LOCK = threading.Lock()
_CURRICULUM_BUILD_LOCKS = {}
_CURRICULUM_CACHE_EPOCH = 0
_CURRICULUM_SHARED_EPOCH_KEY = 'curriculum:cache-epoch'
CURRICULUM_EPOCH_TABLE = 'cache_epoch'
SHARED_EPOCH_POLL_SECONDS = 3.0
_SHARED_EPOCH_STATE = {'value': None, 'checked_at': 0.0}
_SHARED_EPOCH_LOCK = threading.Lock()
_SHARED_EPOCH_REFRESH_LOCK = threading.Lock()
_CURRICULUM_EPOCH_TABLE_READY = False
_CURRICULUM_EPOCH_BUMP = threading.local()
_CURRICULUM_READ_SCOPE = threading.local()
