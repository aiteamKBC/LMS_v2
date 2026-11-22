from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import monthly_actual_scheduler as scheduler


class MonthlyActualSchedulerTests(SimpleTestCase):
    def setUp(self):
        scheduler._thread = None
        scheduler._stop.clear()

    def tearDown(self):
        scheduler._thread = None
        scheduler._stop.clear()

    def test_tests_and_explicit_setting_do_not_start_background_thread(self):
        with patch.object(scheduler.sys, 'argv', ['manage.py', 'test']), \
             patch.object(scheduler.threading, 'Thread') as thread:
            self.assertFalse(scheduler.start_scheduler())
        thread.assert_not_called()
        with patch.dict(scheduler.os.environ, {'MONTHLY_ACTUAL_CACHE_SCHEDULE': 'false'}), \
             patch.object(scheduler.sys, 'argv', ['gunicorn']), \
             patch.object(scheduler.threading, 'Thread') as thread:
            self.assertFalse(scheduler.start_scheduler())
        thread.assert_not_called()

    def test_wsgi_wrapper_starts_scheduler_once_per_request(self):
        application = MagicMock(return_value='response')
        with patch.object(scheduler, 'start_scheduler') as start:
            result = scheduler.MonthlyActualWSGI(application)({}, object())
        self.assertEqual(result, 'response')
        start.assert_called_once_with()

    async def test_asgi_wrapper_starts_only_for_http(self):
        application = MagicMock()

        async def call(scope, receive, send):
            application(scope)

        wrapped = scheduler.MonthlyActualASGI(call)
        with patch.object(scheduler, 'start_scheduler') as start:
            await wrapped({'type': 'websocket'}, None, None)
            start.assert_not_called()
            await wrapped({'type': 'http'}, None, None)
            start.assert_called_once_with()
