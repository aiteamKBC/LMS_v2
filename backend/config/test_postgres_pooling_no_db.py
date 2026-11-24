"""Exercise the real database URL factory without importing runtime settings."""
import ast
from pathlib import Path
import unittest
from urllib.parse import parse_qsl,unquote,urlparse
from .postgres_pooling import neon_transaction_pooler


class TransactionPoolConfigurationTests(unittest.TestCase):
    def factory(self):
        source=Path(__file__).with_name('settings.py')
        tree=ast.parse(source.read_text(encoding='utf-8'))
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='database_from_url')
        ns=dict(urlparse=urlparse,parse_qsl=parse_qsl,unquote=unquote,neon_transaction_pooler=neon_transaction_pooler,
                DB_POOL=True,DB_POOL_OPTIONS={'min_size':1,'max_size':2},DB_CONNECT_TIMEOUT=5,
                DB_CONN_MAX_AGE=300,DB_CONN_HEALTH_CHECKS=True)
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),ns)
        return ns['database_from_url']

    def test_pooler_endpoints_disable_named_cursors_for_every_url_based_alias(self):
        build=self.factory()
        for scheme in ('postgres','postgresql'):
            with self.subTest(scheme=scheme):
                result=build(f'{scheme}://synthetic:synthetic@ep-example-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require')
                self.assertTrue(result['DISABLE_SERVER_SIDE_CURSORS'])
                self.assertEqual(result['OPTIONS']['sslmode'],'require')
                self.assertEqual(result['OPTIONS']['pool'],{'min_size':1,'max_size':2})

    def test_direct_postgres_and_other_backends_retain_their_cursor_behavior(self):
        build=self.factory()
        for host in ('ep-example.eu-west-2.aws.neon.tech','127.0.0.1','pooler.example.invalid'):
            self.assertFalse(build(f'postgres://synthetic:synthetic@{host}/synthetic')['DISABLE_SERVER_SIDE_CURSORS'])
        self.assertNotIn('DISABLE_SERVER_SIDE_CURSORS',build('sqlite:///:memory:'))

    def test_host_detection_is_case_insensitive_and_does_not_match_lookalike_domains(self):
        self.assertTrue(neon_transaction_pooler('EP-EXAMPLE-POOLER.eu-west-2.aws.neon.tech.'))
        self.assertFalse(neon_transaction_pooler('ep-example-pooler.neon.tech.attacker.invalid'))
        self.assertFalse(neon_transaction_pooler(None))

    def test_default_alias_has_the_same_capability_as_url_based_aliases(self):
        source=Path(__file__).with_name('settings.py')
        tree=ast.parse(source.read_text(encoding='utf-8'))
        node=next(n for n in tree.body if isinstance(n,ast.If)and
            {c.id for c in ast.walk(n.test)if isinstance(c,ast.Name)}=={'DATABASE_URL','USE_SQLITE_FOR_TESTS'})
        for host,expected in [('ep-example-pooler.eu-west-2.aws.neon.tech',True),('127.0.0.1',False)]:
            ns={**self.factory().__globals__,'DATABASE_URL':f'postgres://synthetic:synthetic@{host}/synthetic',
                'USE_SQLITE_FOR_TESTS':False,'DB_POOL_DEFAULT_MIN_SIZE':2}
            exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),ns)
            self.assertIs(ns['DATABASES']['default']['DISABLE_SERVER_SIDE_CURSORS'],expected)
            self.assertEqual(ns['DATABASES']['default']['OPTIONS']['pool']['min_size'],2)
