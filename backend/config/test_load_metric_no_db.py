"""The auto-scaling load metric counts HTTP request-seconds, passes every
request through, and stays off without LOAD_METRIC_SERVICE. Uses no
database, settings or network."""
import asyncio
import os
import unittest
from unittest import mock

from config import load_metric


async def _receive():
    return {'type': 'http.request', 'body': b'', 'more_body': False}


async def _send(message):
    pass


class LoadMetricTests(unittest.TestCase):
    def test_off_without_service_name(self):
        async def inner(scope, receive, send):
            pass

        with mock.patch.dict(os.environ, {'LOAD_METRIC_SERVICE': ''}):
            self.assertIs(load_metric.with_load_metric(inner), inner)

    def test_counts_request_seconds(self):
        with mock.patch.object(load_metric.time, 'monotonic', side_effect=[0.0, 0.0, 4.0, 10.0]):
            load = load_metric._Load()  # since = 0
            load.change(1)              # request starts at 0 s
            load.change(-1)             # ends at 4 s
            self.assertAlmostEqual(load.take(10), 0.4)

    def test_passes_requests_and_websockets_through(self):
        seen = []

        async def inner(scope, receive, send):
            seen.append(scope['type'])

        with mock.patch.dict(os.environ, {'LOAD_METRIC_SERVICE': 'learner-api'}), \
                mock.patch.object(load_metric.threading, 'Thread') as thread:
            app = load_metric.with_load_metric(inner)
            asyncio.run(app({'type': 'http', 'path': '/x/'}, _receive, _send))
            asyncio.run(app({'type': 'websocket', 'path': '/ws/'}, _receive, _send))

        self.assertEqual(seen, ['http', 'websocket'])
        thread.return_value.start.assert_called_once()

    def test_health_check_starts_reporter_but_is_not_counted(self):
        async def inner(scope, receive, send):
            pass

        with mock.patch.dict(os.environ, {'LOAD_METRIC_SERVICE': 'learner-api'}), \
                mock.patch.object(load_metric.threading, 'Thread') as thread, \
                mock.patch.object(load_metric._Load, 'change') as change:
            app = load_metric.with_load_metric(inner)
            asyncio.run(app({'type': 'http', 'path': '/health/'}, _receive, _send))

        thread.return_value.start.assert_called_once()
        change.assert_not_called()


if __name__ == '__main__':
    unittest.main()
