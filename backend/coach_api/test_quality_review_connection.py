"""Connection failures are isolated from saved reviews and private evidence."""
from unittest.mock import MagicMock, patch

import psycopg
from django.test import SimpleTestCase

from . import quality_review_store as store


class QualityReviewConnectionTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('coach_api.recordings_saved_evidence.source_dsn',
                                return_value='postgresql://synthetic.invalid/quality'))
        self.driver = self.enterContext(patch('psycopg.connect'))
        self.connection = MagicMock()
        self.driver.return_value.__enter__.return_value = self.connection

    def test_a_slow_remote_handshake_can_complete_before_the_query_starts(self):
        context = self.driver.return_value

        def slow_handshake(*args, **kwargs):
            if kwargs['connect_timeout'] < 8:
                raise psycopg.errors.ConnectionTimeout('Synthetic eight-second handshake')
            return context

        self.driver.side_effect = slow_handshake
        with store.connect() as connection:
            connection.execute('SELECT 1')
        self.connection.execute.assert_any_call("SET LOCAL statement_timeout='5000ms'")
        self.connection.execute.assert_any_call("SET LOCAL lock_timeout='2000ms'")
        self.connection.execute.assert_any_call('SELECT 1')
        self.assertEqual(self.driver.call_args.kwargs['options'], '-c default_transaction_read_only=on')

    def test_a_failed_connection_does_not_run_or_replay_a_write(self):
        self.driver.side_effect = psycopg.errors.ConnectionTimeout('Synthetic timeout')
        with self.assertLogs(store.logger, level='WARNING') as logs:
            with self.assertRaises(store.ReviewUnavailable):
                with store.connect(write=True) as connection:
                    connection.execute('INSERT synthetic write')
        self.driver.assert_called_once()
        self.connection.execute.assert_not_called()
        self.assertEqual(self.driver.call_args.kwargs['options'], '-c default_transaction_read_only=off')
        self.assertIn('ConnectionTimeout', logs.output[0])

    def test_database_errors_do_not_log_credentials_or_private_evidence(self):
        private_error = 'postgresql://synthetic:secret@private.invalid/quality Synthetic private evidence'
        self.connection.execute.side_effect = psycopg.OperationalError(private_error)
        with self.assertLogs(store.logger, level='WARNING') as logs:
            with self.assertRaises(store.ReviewUnavailable) as raised:
                with store.connect():
                    self.fail('An unavailable transaction must not be used.')
        diagnostic = '\n'.join(logs.output) + str(raised.exception)
        self.assertIn('OperationalError', diagnostic)
        for private_value in ('secret', 'private.invalid', 'Synthetic private evidence'):
            self.assertNotIn(private_value, diagnostic)
        self.driver.return_value.__exit__.assert_called_once()
