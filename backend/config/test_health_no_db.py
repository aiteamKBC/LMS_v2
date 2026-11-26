"""The load-balancer health endpoint answers outside Django and passes
everything else through untouched. Uses no database, settings or network."""
import asyncio
import unittest

from config.health import with_health_check


def run(app, scope):
    sent = []

    async def receive():
        return {'type': 'http.request', 'body': b'', 'more_body': False}

    async def send(message):
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


class HealthCheckTests(unittest.TestCase):
    def setUp(self):
        self.inner_scopes = []

        async def inner(scope, receive, send):
            self.inner_scopes.append(scope)

        self.app = with_health_check(inner)

    def test_health_returns_200_without_calling_the_app(self):
        sent = run(self.app, {'type': 'http', 'path': '/health/', 'headers': [(b'host', b'10.20.10.5:8000')]})
        self.assertEqual(sent[0]['status'], 200)
        self.assertEqual(sent[1]['body'], b'ok')
        self.assertEqual(self.inner_scopes, [])

    def test_other_http_paths_pass_through(self):
        for path in ('/api/batch/', '/health', '/health/x', '/'):
            with self.subTest(path=path):
                self.inner_scopes.clear()
                self.assertEqual(run(self.app, {'type': 'http', 'path': path}), [])
                self.assertEqual(self.inner_scopes[0]['path'], path)

    def test_websocket_and_lifespan_pass_through(self):
        for scope in ({'type': 'websocket', 'path': '/health/'}, {'type': 'lifespan'}):
            with self.subTest(scope=scope['type']):
                self.inner_scopes.clear()
                run(self.app, scope)
                self.assertEqual(self.inner_scopes, [scope])


if __name__ == '__main__':
    unittest.main()
