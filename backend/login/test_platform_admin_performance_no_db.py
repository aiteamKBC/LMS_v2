from contextlib import nullcontext
from types import SimpleNamespace
from unittest import mock

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import platform_admin


class PlatformAdminDatabaseIsolationTests(SimpleTestCase):
    def test_autocommit_path_avoids_redundant_transaction_round_trips(self):
        fake_connections = {"enrolment": SimpleNamespace(in_atomic_block=False)}
        with (
            mock.patch.object(platform_admin, "connections", fake_connections),
            mock.patch.object(platform_admin.transaction, "atomic") as atomic,
            mock.patch.object(platform_admin, "_scalars", return_value={"total": 3}),
        ):
            result = platform_admin._optional_scalars("SELECT 3 AS total")

        self.assertEqual(result, {"total": 3})
        atomic.assert_not_called()

    def test_existing_transaction_keeps_savepoint_isolation(self):
        fake_connections = {"enrolment": SimpleNamespace(in_atomic_block=True)}
        with (
            mock.patch.object(platform_admin, "connections", fake_connections),
            mock.patch.object(
                platform_admin.transaction,
                "atomic",
                return_value=nullcontext(),
            ) as atomic,
            mock.patch.object(
                platform_admin,
                "_scalars",
                side_effect=DatabaseError("missing"),
            ),
        ):
            result = platform_admin._optional_scalars("SELECT * FROM missing")

        self.assertEqual(result, {})
        atomic.assert_called_once_with(using="enrolment")

    def test_required_query_uses_the_same_conditional_isolation(self):
        fake_connections = {"enrolment": SimpleNamespace(in_atomic_block=False)}
        with (
            mock.patch.object(platform_admin, "connections", fake_connections),
            mock.patch.object(platform_admin.transaction, "atomic") as atomic,
            mock.patch.object(platform_admin, "_scalars", return_value={"active": 2}),
        ):
            result = platform_admin._scalars_or_raise("SELECT 2 AS active")

        self.assertEqual(result, {"active": 2})
        atomic.assert_not_called()
