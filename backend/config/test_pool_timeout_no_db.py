"""Check pool configuration without importing settings or opening a database."""
import ast
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class PoolTimeoutTests(unittest.TestCase):
    def options(self, argv, environment):
        tree = ast.parse(Path(__file__).with_name('settings.py').read_text(encoding='utf-8'))
        names = {'DB_CONNECT_TIMEOUT', 'DB_POOL_TIMEOUT', 'DB_POOL_OPTIONS', 'DB_POOL_DEFAULT_MIN_SIZE'}
        tree.body = [node for node in tree.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)]
        namespace = {'os': os, 'sys': SimpleNamespace(argv=argv)}
        with patch.dict(os.environ, environment, clear=True):
            exec(compile(tree, '<pool-settings>', 'exec'), namespace)
        return namespace

    # The defaults are the ones b8162e5f set (connect 10 -> 45s, so the
    # runserver checkout budget 45 -> 65s); these two cases still asserted
    # the old values and had failed since.
    def test_local_server_waits_for_slow_connection(self):
        result = self.options(['manage.py', 'runserver'], {})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 65)
        self.assertEqual(result['DB_CONNECT_TIMEOUT'], 45)
        self.assertEqual(result['DB_POOL_OPTIONS']['max_size'], 10)

    def test_other_commands_preserve_existing_timeout(self):
        result = self.options(['daphne'], {'DB_CONNECT_TIMEOUT': '12'})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 12)

    def test_explicit_pool_timeout_wins(self):
        result = self.options(['manage.py', 'runserver'], {'DB_POOL_TIMEOUT': '60'})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 60)
        self.assertEqual(result['DB_CONNECT_TIMEOUT'], 45)

    def test_default_alias_keeps_one_connection_per_gthread_thread(self):
        result = self.options(['gunicorn'], {})
        self.assertEqual(result['DB_POOL_DEFAULT_MIN_SIZE'], 4)
        # The shared options -- every other alias -- keep one.
        self.assertEqual(result['DB_POOL_OPTIONS']['min_size'], 1)
        self.assertEqual(result['DB_POOL_OPTIONS']['max_size'], 10)
        self.assertEqual(result['DB_POOL_OPTIONS']['max_idle'], 180)

    def test_min_size_is_clamped_to_the_pool(self):
        self.assertEqual(self.options(['gunicorn'], {'DB_POOL_MIN_SIZE': '50'})['DB_POOL_DEFAULT_MIN_SIZE'], 10)
        self.assertEqual(self.options(['gunicorn'], {'DB_POOL_MIN_SIZE': '0'})['DB_POOL_DEFAULT_MIN_SIZE'], 1)
        self.assertEqual(self.options(['gunicorn'], {'DB_POOL_MIN_SIZE': '6', 'DB_POOL_MAX_SIZE': '5'})['DB_POOL_DEFAULT_MIN_SIZE'], 5)


if __name__ == '__main__':
    unittest.main()
