"""Run directly with Python. The Graph token cache; production functions, no Django, no network."""
import ast
import hashlib
import json
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib import error as urllib_error
from urllib import parse as urllib_parse

ROOT = Path(__file__).parent
NAMES = {'microsoft_graph_token', '_fetch_microsoft_graph_token', 'forget_microsoft_graph_token'}


class Response:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def load(settings, urlopen, clock):
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in NAMES]
    namespace = {
        'json': json, 'hashlib': hashlib, 'urllib_parse': urllib_parse, 'urllib_error': urllib_error,
        'urllib_request': type('R', (), {'Request': lambda *args, **kwargs: (args, kwargs), 'urlopen': staticmethod(urlopen)}),
        'get_graph_settings': lambda: settings, 'has_graph_credentials': lambda: all(settings.values()),
        'monotonic': clock, '_sleep': lambda _seconds: None,
        '_GRAPH_TOKEN_LOCK': threading.Lock(), '_GRAPH_TOKEN_CACHE': {'key': None, 'value': None, 'expires_at': 0.0},
        '_GRAPH_TOKEN_SKEW': 120,
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace


class GraphTokenCacheTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.settings = {'tenant_id': 't', 'client_id': 'c', 'client_secret': 's', 'scope': 'x', 'base_url': 'b'}
        self.now = [1000.0]
        self.issued = iter(f'token-{n}' for n in range(1, 10))
        self.urlopen = Mock(side_effect=lambda *_a, **_k: Response({'access_token': next(self.issued), 'expires_in': 3600}))
        self.n = load(self.settings, self.urlopen, lambda: self.now[0])

    def test_one_token_serves_every_call_until_shortly_before_it_expires(self):
        self.assertEqual([self.n['microsoft_graph_token']() for _ in range(15)], ['token-1'] * 15)
        self.assertEqual(self.urlopen.call_count, 1)
        self.now[0] += 3600 - 121
        self.assertEqual(self.n['microsoft_graph_token'](), 'token-1')
        self.now[0] += 2
        self.assertEqual(self.n['microsoft_graph_token'](), 'token-2')
        self.assertEqual(self.urlopen.call_count, 2)

    def test_changed_credentials_never_reuse_the_old_token(self):
        self.n['microsoft_graph_token']()
        self.settings['client_secret'] = 'rotated'
        self.assertEqual(self.n['microsoft_graph_token'](), 'token-2')

    def test_a_forgotten_token_is_fetched_again(self):
        self.n['microsoft_graph_token']()
        self.n['forget_microsoft_graph_token']()
        self.assertEqual(self.n['microsoft_graph_token'](), 'token-2')

    def test_a_failed_token_request_caches_nothing(self):
        self.urlopen.side_effect = [Response({}), Response({'access_token': 'good', 'expires_in': 3600})]
        with self.assertRaises(RuntimeError):
            self.n['microsoft_graph_token']()
        self.assertEqual(self.n['microsoft_graph_token'](), 'good')

    def test_unauthorised_graph_call_drops_the_cached_token(self):
        source = (ROOT / 'views.py').read_text(encoding='utf-8-sig')
        node = next(node for node in ast.parse(source).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'microsoft_graph_request')
        handler = ast.get_source_segment(source, node).split('except urllib_error.HTTPError as exc:', 1)[1].split('detail = exc.read()', 1)[0]
        self.assertIn('if exc.code == 401:', handler)
        self.assertIn('forget_microsoft_graph_token()', handler)


if __name__ == '__main__':
    unittest.main()
