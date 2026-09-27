import os
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

import run_databased_fix_server as launcher


class DatabaseFixLauncherTests(SimpleTestCase):
    def test_extracts_url_from_neon_psql_snippet(self):
        value = "psql 'postgresql://role:secret@host.example/neondb?sslmode=require'"
        self.assertEqual(
            launcher.extract_postgres_url(value),
            "postgresql://role:secret@host.example/neondb?sslmode=require",
        )

    def test_clipboard_is_read_without_echoing_the_secret(self):
        completed = MagicMock(returncode=0, stdout="psql 'postgresql://hidden'")
        with patch.object(launcher.subprocess, "run", return_value=completed) as run:
            self.assertEqual(launcher.read_windows_clipboard(), completed.stdout)
        self.assertTrue(run.call_args.kwargs["capture_output"])

    def test_non_neon_endpoint_is_rejected_before_connecting(self):
        with patch.object(launcher.psycopg, "connect") as connect:
            with self.assertRaisesRegex(RuntimeError, "not a Neon"):
                launcher.verify_branch("postgresql://role:secret@wrong.example/neondb")
        connect.assert_not_called()

    def test_exact_read_only_branch_identity_passes(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (
            launcher.DATABASE_NAME,
            "on",
            launcher.EXPECTED_BRANCH_ID,
        )
        url = f"postgresql://role:secret@ep-current-pooler.eu-west-2.aws.neon.tech/{launcher.DATABASE_NAME}"
        with patch.object(launcher.psycopg, "connect", return_value=connection) as connect:
            launcher.verify_branch(url)

        self.assertEqual(connect.call_args.kwargs["options"], "-c default_transaction_read_only=on")
        connection.rollback.assert_called_once_with()
        connection.close.assert_called_once_with()

    def test_different_branch_id_is_rejected(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (launcher.DATABASE_NAME, "on", "br-other")
        url = f"postgresql://role:secret@ep-other-pooler.eu-west-2.aws.neon.tech/{launcher.DATABASE_NAME}"
        with patch.object(launcher.psycopg, "connect", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "br-other"):
                launcher.verify_branch(url)

    def test_configures_django_settings_for_the_child_process(self):
        with patch.dict(os.environ, {}, clear=True):
            launcher.configure_process("postgresql://role:secret@host/neondb")
            self.assertEqual(os.environ["DJANGO_SETTINGS_MODULE"], "config.settings")
