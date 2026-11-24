"""Own the single in-process warm scheduler and its coalescing state.

Payload construction stays with the supplied catalogue callbacks. Importing this
module starts no thread and opens no connection.
"""
from datetime import datetime
import threading
import time

from django.db import connections
from .runtime_config import logger

_CURRICULUM_WARM_LOCK = threading.Lock()
_CURRICULUM_WARM_RUNNING = False
_CURRICULUM_WARM_REQUESTED = False


def _curriculum_warm_loop(*, warm_curriculum_caches, warm_programme_detail_sections, delay_seconds):
    from config.management_safety import reconciliation_command
    if reconciliation_command():
        return
    global _CURRICULUM_WARM_RUNNING, _CURRICULUM_WARM_REQUESTED
    try:
        while True:
            time.sleep(delay_seconds)
            with _CURRICULUM_WARM_LOCK:
                _CURRICULUM_WARM_REQUESTED = False
            started = datetime.now().timestamp()
            try:
                warm_curriculum_caches()
                logger.info(
                    'Curriculum cache warm finished in %.1fs.',
                    datetime.now().timestamp() - started,
                )
            except Exception:
                # A warm that fails must never take the process with it; the
                # request path still rebuilds on demand.
                logger.warning('Curriculum cache warm failed.', exc_info=True)
            try:
                # Apart from the warm above: that one is a single untargeted
                # read scope, and a programme build needs its own targeted one.
                warm_programme_detail_sections()
            except Exception:
                logger.warning('Programme section warm failed.', exc_info=True)
            finally:
                # This thread opened its own connection. Neon counts it, and a
                # warm runs rarely enough that holding one between runs is pure
                # cost.
                connections.close_all()
            with _CURRICULUM_WARM_LOCK:
                if not _CURRICULUM_WARM_REQUESTED:
                    _CURRICULUM_WARM_RUNNING = False
                    return
    except BaseException:
        with _CURRICULUM_WARM_LOCK:
            _CURRICULUM_WARM_RUNNING = False
        raise


def schedule_curriculum_warm(*, enabled, run_warm_loop):
    """Ask for a warm, coalescing with one already pending.

    Returns whether a warm is now scheduled, so callers and tests can tell the
    disabled case from the queued one.
    """
    from config.management_safety import reconciliation_command
    if reconciliation_command() or not enabled:
        return False
    global _CURRICULUM_WARM_RUNNING, _CURRICULUM_WARM_REQUESTED
    with _CURRICULUM_WARM_LOCK:
        _CURRICULUM_WARM_REQUESTED = True
        if _CURRICULUM_WARM_RUNNING:
            # The running loop re-reads the flag after it publishes and goes
            # round again, so a write during a warm is never lost.
            return True
        _CURRICULUM_WARM_RUNNING = True
    try:
        threading.Thread(
            target=run_warm_loop,
            name='curriculum-cache-warm',
            daemon=True,
        ).start()
    except Exception:
        with _CURRICULUM_WARM_LOCK:
            _CURRICULUM_WARM_RUNNING = False
        logger.warning('Unable to start curriculum cache warm thread.', exc_info=True)
        return False
    return True

