"""A cancelled HTTP request must not freeze the ASGI event loop.

Keep the reproducer in a subprocess: an affected asgiref version blocks the
loop itself, so an asyncio timeout cannot protect the test runner.
These checks use no database, application accounts or network services.
"""
import os
import subprocess
import sys
import textwrap
from unittest import TestCase


class ASGIDisconnectTests(TestCase):
    def run_isolated(self, source):
        with subprocess.Popen(
            [sys.executable, "-c", textwrap.dedent(source)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ) as process:
            try:
                stdout, stderr = process.communicate(timeout=8)
            except subprocess.TimeoutExpired:
                # Windows venv Python is a launcher with a child interpreter.
                # Kill our whole test process tree, not only that launcher.
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        capture_output=True, check=False,
                    )
                process.kill()
                process.communicate()
                self.fail("ASGI cleanup deadlocked; install backend/requirements.txt.")
        self.assertEqual(process.returncode, 0, stdout + stderr)

    def test_cancelled_sync_worker_can_finish_its_async_response(self):
        self.run_isolated("""
            import asyncio
            import threading
            from contextlib import suppress
            from asgiref.sync import ThreadSensitiveContext, async_to_sync, sync_to_async

            async def main():
                entered = asyncio.Event()
                release = threading.Event()
                completed = asyncio.Event()
                loop = asyncio.get_running_loop()

                async def response():
                    await asyncio.sleep(0)
                    completed.set()

                def middleware():
                    loop.call_soon_threadsafe(entered.set)
                    assert release.wait(3), 'Worker was never released'
                    async_to_sync(response)()

                async with ThreadSensitiveContext():
                    request = asyncio.create_task(sync_to_async(middleware)())
                    await asyncio.wait_for(entered.wait(), 2)
                    request.cancel()
                    with suppress(asyncio.CancelledError):
                        await request
                    release.set()
                    # Cleanup must let the worker re-enter this event loop.
                assert completed.is_set(), 'The worker response did not finish'
                # New requests must still have a working executor and event loop.
                async with ThreadSensitiveContext():
                    assert await sync_to_async(lambda: 'users available')() == 'users available'

            asyncio.run(main())
        """)

    def test_http_disconnect_does_not_block_the_next_request(self):
        self.run_isolated("""
            import asyncio
            import threading
            import django
            from django.conf import settings
            from django.http import HttpResponse
            from django.urls import path
            from asgiref.testing import ApplicationCommunicator

            entered = threading.Event()
            release = threading.Event()

            class PausedMiddleware:
                def __init__(self, get_response):
                    self.get_response = get_response

                def __call__(self, request):
                    if request.path == '/slow/':
                        entered.set()
                        assert release.wait(3), 'Worker was never released'
                    return self.get_response(request)

            async def view(request):
                return HttpResponse('ready')

            urlpatterns = [path('slow/', view), path('ready/', view)]
            settings.configure(
                SECRET_KEY='isolated-test', ROOT_URLCONF=__name__,
                ALLOWED_HOSTS=['testserver'],
                MIDDLEWARE=[__name__ + '.PausedMiddleware'],
                DATABASES={},
            )
            django.setup()
            from django.core.asgi import get_asgi_application
            app = get_asgi_application()

            def connection(path):
                return ApplicationCommunicator(app, {
                    'type': 'http', 'method': 'GET', 'path': path,
                    'query_string': b'', 'headers': [(b'host', b'testserver')],
                    'http_version': '1.1',
                })

            async def main():
                slow = connection('/slow/')
                await slow.send_input({'type': 'http.request', 'body': b''})
                for _ in range(200):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.005)
                assert entered.is_set(), 'Request never reached middleware'
                await slow.send_input({'type': 'http.disconnect'})
                # Release from outside the loop so a deadlock cannot mask itself.
                threading.Timer(0.05, release.set).start()
                await slow.wait(timeout=3)

                ready = connection('/ready/')
                await ready.send_input({'type': 'http.request', 'body': b''})
                start = await ready.receive_output(timeout=2)
                assert start['status'] == 200, start
                body = await ready.receive_output(timeout=2)
                assert body['body'] == b'ready', body
                await ready.wait(timeout=2)

            asyncio.run(main())
        """)
