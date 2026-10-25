"""Opt-in, PII-safe memory telemetry for the Engagement service.

The shared Django application is loaded by every LMS service, so this module is
inert unless ``ENGAGEMENT_MEMORY_OBSERVABILITY`` is enabled for that process.
It never logs request paths, query strings, payloads, cache keys, filenames, or
user identity. Memory values describe the whole process and are correlation
signals only; they are not attributed to an individual request thread.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from django.conf import settings


logger = logging.getLogger("engagement_api.memory")

_ENGAGEMENT_PREFIX = "/engagement_api/"
_PRIORITY_PATHS = frozenset({
    "/engagement_api/learner-analytics/",
    "/engagement_api/flash-cards/ai/generate/",
})
_ALLOWED_FIELDS = frozenset({
    "route_template",
    "method",
    "status_code",
    "duration_ms",
    "response_size_bytes",
    "outcome",
    "memory_scope",
    "interpretation",
    "rss_before_kib",
    "rss_after_kib",
    "rss_delta_kib",
    "pss_before_kib",
    "pss_after_kib",
    "pss_delta_kib",
    "peak_rss_before_kib",
    "peak_rss_after_kib",
    "cache_outcome",
    "builder_scope",
    "scope_kind",
    "scope_tag",
    "concurrent_builders_at_start",
    "profile_rows",
    "attendance_rows",
    "points_all_time_rows",
    "points_month_rows",
    "club_rows",
    "intervention_rows",
    "message_response_rows",
    "learner_rows",
    "submitted_file_count",
    "processed_file_count",
    "submitted_size_bucket",
    "processed_size_bucket",
    "extraction_duration_ms",
    "dropped_events",
})


class _WindowLimiter:
    """Thread-safe fixed-window limiter for request instrumentation."""

    def __init__(self):
        self._lock = threading.Lock()
        self._window_started = 0.0
        self._count = 0

    def allow(self, now: float, limit: int) -> bool:
        with self._lock:
            if not self._window_started or now - self._window_started >= 60.0:
                self._window_started = now
                self._count = 0
            if self._count >= limit:
                return False
            self._count += 1
            return True

    def reset(self) -> None:
        with self._lock:
            self._window_started = 0.0
            self._count = 0


class _OutputLimiter:
    """Bound output and carry a dropped-event total into the next window."""

    def __init__(self):
        self._lock = threading.Lock()
        self._window_started = 0.0
        self._emitted = 0
        self._dropped = 0

    def claim(self, now: float, limit: int) -> tuple[bool, int]:
        """Return ``(emit_current, previous_window_drops)``.

        A rollover summary consumes one slot in the new window. With a one-event
        limit the summary wins and the current event is counted as dropped.
        """

        with self._lock:
            dropped_summary = 0
            if not self._window_started or now - self._window_started >= 60.0:
                dropped_summary = self._dropped
                self._window_started = now
                self._emitted = 1 if dropped_summary else 0
                self._dropped = 0

            if self._emitted < limit:
                self._emitted += 1
                return True, dropped_summary

            self._dropped += 1
            return False, dropped_summary

    def reset(self) -> None:
        with self._lock:
            self._window_started = 0.0
            self._emitted = 0
            self._dropped = 0


_output_limiter = _OutputLimiter()
_request_limiter = _WindowLimiter()
_priority_request_limiter = _WindowLimiter()
_pss_read_lock = threading.Lock()
_last_pss_sample = 0.0
_builder_lock = threading.Lock()
_active_builders = 0


def enabled() -> bool:
    return bool(getattr(settings, "ENGAGEMENT_MEMORY_OBSERVABILITY", False))


def _request_diagnostics_active(request) -> bool:
    return enabled() and bool(
        getattr(request, "_engagement_memory_observability_active", False)
    )


def _event_limit() -> int:
    value = int(getattr(settings, "ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_EVENTS_PER_MINUTE", 240))
    return max(1, min(value, 10_000))


def _request_limit(priority: bool) -> int:
    setting_name = (
        "ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_PRIORITY_REQUESTS_PER_MINUTE"
        if priority else "ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_REQUESTS_PER_MINUTE"
    )
    default = 30 if priority else 120
    value = int(getattr(settings, setting_name, default))
    return max(1, min(value, 10_000))


def _pss_interval() -> float:
    value = float(getattr(settings, "ENGAGEMENT_MEMORY_OBSERVABILITY_PSS_INTERVAL_SECONDS", 15.0))
    return max(1.0, value)


def _request_id(request) -> str:
    candidate = str(getattr(request, "request_id", "") or "")
    try:
        return str(uuid.UUID(candidate))
    except (ValueError, AttributeError):
        generated = str(uuid.uuid4())
        request.request_id = generated
        return generated


def _safe_route_template(request) -> str:
    match = getattr(request, "resolver_match", None)
    route = str(getattr(match, "route", "") or "")
    if not route:
        route = str(getattr(match, "view_name", "") or "unresolved")
    # Resolver routes are developer-authored templates. Keep only the small
    # character set needed by Django converters and cap pathological values.
    return "".join(
        character if character.isalnum() or character in "_./<>:-" else "_"
        for character in route[:160]
    ) or "unresolved"


def _write_event(event: str, request=None, **fields) -> None:
    payload = {
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
    }
    if request is not None:
        payload["request_id"] = _request_id(request)
    for key, value in fields.items():
        if key in _ALLOWED_FIELDS and value is not None:
            payload[key] = value
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def _emit(event: str, request=None, **fields) -> None:
    """Emit one bounded safe event; observability must never affect the API."""

    try:
        if not enabled():
            return
        emit_current, dropped_summary = _output_limiter.claim(
            time.monotonic(), _event_limit()
        )
    except Exception:
        return

    if dropped_summary:
        try:
            _write_event(
                "engagement_telemetry_dropped",
                dropped_events=min(dropped_summary, 2_147_483_647),
            )
        except Exception:
            pass
    if emit_current:
        try:
            _write_event(event, request, **fields)
        except Exception:
            pass


def _read_process_memory(*, include_pss: bool) -> dict[str, int]:
    values: dict[str, int] = {}
    try:
        page_kib = os.sysconf("SC_PAGE_SIZE") // 1024
        with open("/proc/self/statm", "r", encoding="ascii") as handle:
            parts = handle.read().split()
        if len(parts) >= 2:
            values["rss_kib"] = int(parts[1]) * page_kib
    except (OSError, ValueError, AttributeError):
        pass

    try:
        with open("/proc/self/status", "r", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("VmHWM:"):
                    values["peak_rss_kib"] = int(line.split()[1])
                    break
    except (OSError, ValueError):
        pass

    if include_pss:
        try:
            with open("/proc/self/smaps_rollup", "r", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("Pss:"):
                        values["pss_kib"] = int(line.split()[1])
                        break
        except (OSError, ValueError):
            pass
    return values


def _safe_process_memory(*, include_pss: bool) -> dict[str, int]:
    try:
        return _read_process_memory(include_pss=include_pss)
    except Exception:
        return {}


def _begin_pss_sample() -> bool:
    """Claim the single process-wide PSS sampler without waiting."""

    global _last_pss_sample
    if not _pss_read_lock.acquire(blocking=False):
        return False
    try:
        now = time.monotonic()
        if now - _last_pss_sample < _pss_interval():
            _pss_read_lock.release()
            return False
        _last_pss_sample = now
        return True
    except Exception:
        _pss_read_lock.release()
        return False


def _end_pss_sample(claimed: bool) -> None:
    if claimed:
        try:
            _pss_read_lock.release()
        except RuntimeError:
            pass


def _response_size(response) -> int | None:
    if response is None:
        return None
    try:
        header = response.get("Content-Length")
        if header is not None:
            return max(0, int(header))
        if not getattr(response, "streaming", False):
            return len(response.content)
    except (AttributeError, TypeError, ValueError):
        pass
    return None


class EngagementMemoryObservabilityMiddleware:
    """Log bounded route-template and process-memory data for Engagement only."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path_info = str(getattr(request, "path_info", "") or "")
        if not enabled() or not path_info.startswith(_ENGAGEMENT_PREFIX):
            return self.get_response(request)

        priority = path_info in _PRIORITY_PATHS
        limiter = _priority_request_limiter if priority else _request_limiter
        try:
            admitted = limiter.allow(time.monotonic(), _request_limit(priority))
        except Exception:
            admitted = False
        if not admitted:
            return self.get_response(request)
        request._engagement_memory_observability_active = True

        started = time.perf_counter()
        include_pss = _begin_pss_sample()
        before = _safe_process_memory(include_pss=include_pss)
        response = None
        outcome = "completed"
        status_code = 500
        try:
            response = self.get_response(request)
            status_code = int(getattr(response, "status_code", 500))
            return response
        except BaseException:
            outcome = "exception"
            raise
        finally:
            after = _safe_process_memory(include_pss=include_pss)
            _end_pss_sample(include_pss)
            try:
                fields = {
                    "route_template": _safe_route_template(request),
                    "method": str(getattr(request, "method", "UNKNOWN"))[:12],
                    "status_code": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "response_size_bytes": _response_size(response),
                    "outcome": outcome,
                    "memory_scope": "process",
                    "interpretation": "correlation_only",
                    "rss_before_kib": before.get("rss_kib"),
                    "rss_after_kib": after.get("rss_kib"),
                    "peak_rss_before_kib": before.get("peak_rss_kib"),
                    "peak_rss_after_kib": after.get("peak_rss_kib"),
                    "pss_before_kib": before.get("pss_kib"),
                    "pss_after_kib": after.get("pss_kib"),
                }
                if "rss_kib" in before and "rss_kib" in after:
                    fields["rss_delta_kib"] = after["rss_kib"] - before["rss_kib"]
                if "pss_kib" in before and "pss_kib" in after:
                    fields["pss_delta_kib"] = after["pss_kib"] - before["pss_kib"]
                _emit("engagement_request_completed", request, **fields)
            except Exception:
                pass


def _analytics_scope(programme, cohort) -> tuple[str, str]:
    programme_value = str(programme or "")
    cohort_value = str(cohort or "")
    if programme_value and cohort_value:
        scope_kind = "both"
    elif programme_value:
        scope_kind = "programme"
    elif cohort_value:
        scope_kind = "cohort"
    else:
        scope_kind = "all"

    # HMAC permits matching the same cache scope across workers that share the
    # service secret while preventing dictionary attacks against low-entropy
    # programme/cohort labels in copied logs.
    canonical = json.dumps(
        [programme_value, cohort_value], ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    secret = str(settings.SECRET_KEY).encode("utf-8")
    scope_tag = hmac.new(
        secret, b"engagement-analytics-scope-v1\0" + canonical, hashlib.sha256
    ).hexdigest()[:24]
    return scope_kind, scope_tag


def record_analytics_cache(
    request,
    outcome: str,
    response_size_bytes: int | None = None,
    *,
    programme=None,
    cohort=None,
) -> None:
    if not _request_diagnostics_active(request):
        return
    try:
        scope_kind, scope_tag = _analytics_scope(programme, cohort)
        _emit(
            "engagement_learner_analytics_cache",
            request,
            cache_outcome="hit" if outcome == "hit" else "miss",
            response_size_bytes=response_size_bytes,
            scope_kind=scope_kind,
            scope_tag=scope_tag,
        )
    except Exception:
        pass


class _NoopDiagnostic:
    """Allocation-free shared context used while telemetry is disabled."""

    @property
    def response_size_bytes(self):
        return None

    @response_size_bytes.setter
    def response_size_bytes(self, _value):
        return None

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback):
        return False

    def count(self, _name: str, _value) -> None:
        return None

    def set_outcome(self, _value: str) -> None:
        return None

    def extraction(self):
        return self


_NOOP_DIAGNOSTIC = _NoopDiagnostic()


class _AnalyticsBuildContext:
    def __init__(self, request, programme, cohort):
        self.request = request
        self.programme = programme
        self.cohort = cohort
        self.concurrent_builders_at_start = 0
        self.counts: dict[str, int] = {}
        self.response_size_bytes: int | None = None
        self.started = 0.0
        self.counted = False

    def __enter__(self):
        global _active_builders
        try:
            self.started = time.perf_counter()
            with _builder_lock:
                _active_builders += 1
                self.concurrent_builders_at_start = _active_builders
                self.counted = True
        except Exception:
            self.counted = False
        return self

    def __exit__(self, exc_type, _exc_value, _traceback):
        global _active_builders
        try:
            if self.counted:
                with _builder_lock:
                    _active_builders = max(0, _active_builders - 1)
            scope_kind, scope_tag = _analytics_scope(self.programme, self.cohort)
            _emit(
                "engagement_learner_analytics_build_completed",
                self.request,
                outcome="exception" if exc_type is not None else "completed",
                cache_outcome="miss",
                builder_scope="process",
                scope_kind=scope_kind,
                scope_tag=scope_tag,
                duration_ms=round((time.perf_counter() - self.started) * 1000, 1),
                response_size_bytes=self.response_size_bytes,
                concurrent_builders_at_start=self.concurrent_builders_at_start,
                **self.counts,
            )
        except Exception:
            pass
        return False

    def count(self, name: str, value) -> None:
        if name not in _ALLOWED_FIELDS:
            return
        try:
            self.counts[name] = max(0, int(value))
        except (TypeError, ValueError):
            return


def analytics_build(request, *, programme=None, cohort=None):
    # Unlike request sampling, every real cache-miss build joins the process
    # counter while telemetry is enabled. This is evidence, not single-flight.
    if not enabled():
        return _NOOP_DIAGNOSTIC
    try:
        return _AnalyticsBuildContext(request, programme, cohort)
    except Exception:
        return _NOOP_DIAGNOSTIC


def _input_size_bucket(files) -> str:
    total = 0
    try:
        for uploaded_file in files:
            total += max(0, int(getattr(uploaded_file, "size", 0) or 0))
    except Exception:
        return "unknown"
    mib = 1024 * 1024
    if total == 0:
        return "none"
    if total < mib:
        return "under_1_mib"
    if total < 10 * mib:
        return "1_to_10_mib"
    if total < 100 * mib:
        return "10_to_100_mib"
    if total < 500 * mib:
        return "100_to_500_mib"
    return "500_mib_or_more"


class _AiInvocationContext:
    def __init__(self, request, files, max_files: int):
        self.request = request
        self.files = files
        self.max_files = max_files
        self.outcome = "completed"
        self.extraction_duration_ms: float | None = None
        self.memory_before: dict[str, int] = {}
        self.memory_after: dict[str, int] = {}

    def __enter__(self):
        return self

    def __exit__(self, exc_type, _exc_value, _traceback):
        if exc_type is not None:
            self.outcome = "exception"
        try:
            processed_files = self.files[:self.max_files]
            fields = {
                "outcome": self.outcome,
                "submitted_file_count": len(self.files),
                "processed_file_count": len(processed_files),
                "submitted_size_bucket": _input_size_bucket(self.files),
                "processed_size_bucket": _input_size_bucket(processed_files),
                "extraction_duration_ms": self.extraction_duration_ms,
                "memory_scope": "process",
                "interpretation": "correlation_only",
                "rss_before_kib": self.memory_before.get("rss_kib"),
                "rss_after_kib": self.memory_after.get("rss_kib"),
                "peak_rss_before_kib": self.memory_before.get("peak_rss_kib"),
                "peak_rss_after_kib": self.memory_after.get("peak_rss_kib"),
            }
            if "rss_kib" in self.memory_before and "rss_kib" in self.memory_after:
                fields["rss_delta_kib"] = (
                    self.memory_after["rss_kib"] - self.memory_before["rss_kib"]
                )
            _emit("engagement_ai_flashcards_invocation_completed", self.request, **fields)
        except Exception:
            pass
        return False

    @contextmanager
    def extraction(self):
        try:
            started = time.perf_counter()
            self.memory_before = _safe_process_memory(include_pss=False)
        except Exception:
            started = None
        try:
            yield
        finally:
            try:
                if started is not None:
                    self.extraction_duration_ms = round(
                        (time.perf_counter() - started) * 1000, 1
                    )
                self.memory_after = _safe_process_memory(include_pss=False)
            except Exception:
                pass

    def set_outcome(self, value: str) -> None:
        if value in {"success", "rejected", "provider_error", "exception", "completed"}:
            self.outcome = value


def ai_flashcard_invocation(request, files, *, max_files: int):
    if not _request_diagnostics_active(request):
        return _NOOP_DIAGNOSTIC
    try:
        safe_files = tuple(files)
        return _AiInvocationContext(request, safe_files, max(0, int(max_files)))
    except Exception:
        return _NOOP_DIAGNOSTIC


def _reset_state_for_tests() -> None:
    """Reset process-local rate/cadence state for isolated no-DB tests."""

    global _active_builders, _last_pss_sample
    _output_limiter.reset()
    _request_limiter.reset()
    _priority_request_limiter.reset()
    with _pss_read_lock:
        _last_pss_sample = 0.0
    with _builder_lock:
        _active_builders = 0
