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
        names = {'DB_CONNECT_TIMEOUT', 'DB_POOL_TIMEOUT', 'DB_POOL_OPTIONS'}
        tree.body = [node for node in tree.body if isinstance(node, ast.Assign)
                     and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)]
        namespace = {'os': os, 'sys': SimpleNamespace(argv=argv)}
        with patch.dict(os.environ, environment, clear=True):
            exec(compile(tree, '<pool-settings>', 'exec'), namespace)
        return namespace

    def test_local_server_waits_for_slow_connection(self):
        result = self.options(['manage.py', 'runserver'], {})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 45)
        self.assertEqual(result['DB_CONNECT_TIMEOUT'], 10)
        self.assertEqual(result['DB_POOL_OPTIONS']['max_size'], 10)

    def test_other_commands_preserve_existing_timeout(self):
        result = self.options(['daphne'], {'DB_CONNECT_TIMEOUT': '12'})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 12)

    def test_explicit_pool_timeout_wins(self):
        result = self.options(['manage.py', 'runserver'], {'DB_POOL_TIMEOUT': '60'})
        self.assertEqual(result['DB_POOL_OPTIONS']['timeout'], 60)
        self.assertEqual(result['DB_CONNECT_TIMEOUT'], 10)


if __name__ == '__main__':
    unittest.main()
