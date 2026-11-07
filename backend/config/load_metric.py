"""High-resolution load metric for AWS auto scaling (ECS staging/production).

ECS reports CPU once a minute and late, so CPU alarms notice a surge only
minutes after it starts. Every 10 seconds each worker process prints its
average number of requests in progress (request-seconds / 10 s) as a
CloudWatch Embedded Metric Format line on stdout; the awslogs driver ships
it and CloudWatch turns it into the high-resolution metric
``LMS/App ConcurrentRequests`` (dimension ``Service``), which a 10-second
alarm uses to add tasks (infrastructure/autoscaling.tf).

A worker runs Django's sync views one at a time, so a value above ~1 means
requests are queueing. Every worker reports even when idle, so the number of
reports per minute also tells auto scaling how many tasks are running (the
"busy tasks + 2" rule). Only active when ``LOAD_METRIC_SERVICE`` is set (ECS
sets it to the service name); locally the app is passed through unchanged.
WebSockets and ``/health/`` are not counted; the load balancer's first health
check starts the reporter in a new worker.
"""

import json
import os
import threading
import time

from config.health import HEALTH_PATH

NAMESPACE = 'LMS/App'
METRIC = 'ConcurrentRequests'
INTERVAL_SECONDS = 10


class _Load:
    def __init__(self):
        self._lock = threading.Lock()
        self._in_flight = 0
        self._request_seconds = 0.0
        self._since = time.monotonic()

    def _advance(self, now):
        self._request_seconds += self._in_flight * (now - self._since)
        self._since = now

    def change(self, delta):
        with self._lock:
            self._advance(time.monotonic())
            self._in_flight += delta

    def take(self, interval):
        with self._lock:
            self._advance(time.monotonic())
            value, self._request_seconds = self._request_seconds / interval, 0.0
        return value


def _report(service, load):
    while True:
        time.sleep(INTERVAL_SECONDS)
        print(json.dumps({
            '_aws': {
                'Timestamp': int(time.time() * 1000),
                'CloudWatchMetrics': [{
                    'Namespace': NAMESPACE,
                    'Dimensions': [['Service']],
                    'Metrics': [{'Name': METRIC, 'Unit': 'Count', 'StorageResolution': 1}],
                }],
            },
            'Service': service,
            METRIC: round(load.take(INTERVAL_SECONDS), 3),
        }), flush=True)


def with_load_metric(app):
    service = os.environ.get('LOAD_METRIC_SERVICE', '')
    if not service:
        return app

    load = _Load()
    started = threading.Event()

    async def application(scope, receive, send):
        # Started in the worker process on its first HTTP request or health
        # check (Uvicorn workers are separate processes)
        if scope['type'] == 'http' and not started.is_set():
            started.set()
            threading.Thread(target=_report, args=(service, load), daemon=True).start()
        if scope['type'] != 'http' or scope.get('path') == HEALTH_PATH:
            await app(scope, receive, send)
            return
        load.change(1)
        try:
            await app(scope, receive, send)
        finally:
            load.change(-1)

    return application
