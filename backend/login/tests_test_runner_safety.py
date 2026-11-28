from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .test_runner import _verify_security_test_branch


def safety_settings(*, expected="br-approved", host="branch.example.test"):
    return SimpleNamespace(
        DATABASES={
            "enrolment": {
                "NAME": "neondb",
                "USER": "test-role",
                "PASSWORD": "not-a-real-secret",
                "HOST": host,
                "PORT": "5432",
                "OPTIONS": {"connect_timeout": 3, "sslmode": "require"},
            }
        },
        SECURITY_TEST_BRANCH_HOST="branch.example.test",
        SECURITY_TEST_BRANCH_ID=expected,
    )


class SecurityTestBranchPreflightTests(SimpleTestCase):
    def _connection(self, row=("neondb", "on", "br-approved")):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = row
        return connection

    def test_exact_branch_identity_passes_with_a_read_only_connection(self):
        connection = self._connection()
        with patch("login.test_runner.psycopg.connect", return_value=connection) as connect:
            _verify_security_test_branch(safety_settings())

        self.assertEqual(connect.call_args.kwargs["options"], "-c default_transaction_read_only=on")
        connection.rollback.assert_called_once_with()
        connection.close.assert_called_once_with()

    def test_missing_expected_branch_id_fails_before_connecting(self):
        with patch("login.test_runner.psycopg.connect") as connect:
            with self.assertRaisesRegex(RuntimeError, "SECURITY_TEST_BRANCH_ID is missing"):
                _verify_security_test_branch(safety_settings(expected=""))
        connect.assert_not_called()

    def test_wrong_host_fails_before_connecting(self):
        with patch("login.test_runner.psycopg.connect") as connect:
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                _verify_security_test_branch(safety_settings(host="wrong.example.test"))
        connect.assert_not_called()

    def test_wrong_neon_branch_id_is_rejected(self):
        connection = self._connection(("neondb", "on", "br-other"))
        with patch("login.test_runner.psycopg.connect", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "br-other.*br-approved"):
                _verify_security_test_branch(safety_settings())

    def test_non_read_only_preflight_is_rejected(self):
        connection = self._connection(("neondb", "off", "br-approved"))
        with patch("login.test_runner.psycopg.connect", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "was not read-only"):
                _verify_security_test_branch(safety_settings())
