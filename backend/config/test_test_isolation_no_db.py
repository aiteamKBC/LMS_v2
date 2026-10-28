"""Regression coverage for the fail-closed backend test boundary.

No assertion in this module needs or permits a remote connection.  The local
socket case proves the guard does not break Django/LiveServer-style loopback
traffic; every other transport is rejected before DNS or connection setup.
"""
from __future__ import annotations

import asyncio
import os
import smtplib
import socket
import subprocess
import sys
import threading
import urllib.request
from unittest.mock import patch

import httpx
import psycopg
import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.test_isolation import (
    BENCHMARK_BRANCH_ID,
    BENCHMARK_BRANCH_NAME,
    BENCHMARK_DIRECT_HOST,
    BENCHMARK_ENDPOINT_ID,
    BENCHMARK_POOLED_HOST,
    INTEGRATION_MODE,
    LOCAL_BENCHMARK_MODE,
    POSTGRES_READ_ONLY_MODE,
    UNIT_MODE,
    IsolationPolicy,
    TestIsolationError,
    active_policy,
    assert_unit_database_aliases,
    configure_read_only_database_url,
    test_mode as resolve_test_mode,
)
from config.local_benchmark import validate_local_benchmark_url


class NetworkIsolationTests(SimpleTestCase):
    def test_guard_is_automatic_and_in_unit_mode(self):
        self.assertIsNotNone(active_policy())
        self.assertEqual(active_policy().mode, UNIT_MODE)

    def test_azure_storage_dns_is_blocked_below_the_sdk(self):
        with self.assertRaisesRegex(TestIsolationError, r"blob\.core\.windows\.net"):
            socket.getaddrinfo("kbcdocs.blob.core.windows.net", 443)

    def test_microsoft_graph_is_blocked(self):
        with self.assertRaisesRegex(TestIsolationError, "httpx"):
            httpx.get("https://graph.microsoft.com/v1.0/me", timeout=0.1, trust_env=False)

    def test_requests_external_https_is_blocked(self):
        session = requests.Session()
        session.trust_env = False
        with self.assertRaisesRegex(TestIsolationError, "requests"):
            session.get("https://example.invalid/phase4f", timeout=0.1)

    def test_urllib_external_https_is_blocked(self):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with patch.object(urllib.request, "urlopen", wraps=urllib.request.urlopen):
            with self.assertRaises(TestIsolationError):
                # The global guard protects the module entry point; exercise it
                # directly so no platform proxy can become the destination.
                urllib.request.urlopen("https://example.invalid/phase4f", timeout=0.1)
        self.assertIsNotNone(opener)

    def test_async_httpx_is_blocked(self):
        async def request():
            async with httpx.AsyncClient(timeout=0.1, trust_env=False) as client:
                await client.get("https://example.invalid/async")

        with self.assertRaisesRegex(TestIsolationError, "httpx async"):
            asyncio.run(request())

    def test_real_smtp_delivery_is_blocked(self):
        client = smtplib.SMTP(timeout=0.1)
        self.addCleanup(client.close)
        with self.assertRaisesRegex(TestIsolationError, "SMTP"):
            client.connect("smtp.example.invalid", 587)

    def test_raw_external_socket_is_blocked(self):
        with socket.socket() as client, self.assertRaisesRegex(TestIsolationError, "socket"):
            client.connect(("198.51.100.10", 443))

    def test_loopback_connections_remain_available(self):
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            port = server.getsockname()[1]
            accepted = []

            def receive():
                connection, _address = server.accept()
                with connection:
                    accepted.append(connection.recv(4))

            worker = threading.Thread(target=receive)
            worker.start()
            with socket.create_connection(("127.0.0.1", port), timeout=1) as client:
                client.sendall(b"safe")
            worker.join(timeout=1)
        self.assertEqual(accepted, [b"safe"])


class DatabaseIsolationTests(SimpleTestCase):
    def test_default_unit_settings_ignore_remote_database_fallbacks(self):
        self.assertTrue(settings.USE_SQLITE_FOR_TESTS)
        self.assertEqual(settings.TEST_EXECUTION_MODE, UNIT_MODE)
        self.assertEqual(settings.EMAIL_BACKEND, "django.core.mail.backends.locmem.EmailBackend")
        self.assertEqual(
            settings.CACHES["default"]["BACKEND"],
            "django.core.cache.backends.locmem.LocMemCache",
        )
        self.assertEqual(
            settings.CHANNEL_LAYERS["default"]["BACKEND"],
            "channels.layers.InMemoryChannelLayer",
        )
        self.assertTrue(settings.DATABASES)
        self.assertTrue(all(
            config.get("ENGINE", "").endswith("sqlite3")
            for config in settings.DATABASES.values()
        ))

    def test_fresh_unit_process_ignores_remote_database_and_redis_environment(self):
        environment = os.environ.copy()
        environment.update({
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "LMS_TEST_ACTIVE": "true",
            "LMS_TEST_MODE": UNIT_MODE,
            "DATABASE_URL": "postgresql://unit:secret@db.example.invalid/live",
            "Database_url": "postgresql://unit:secret@db.example.invalid/live",
            "CACHE_URL": "redis://cache.example.invalid:6379/1",
            "REDIS_URL": "redis://cache.example.invalid:6379/1",
        })
        check = """
import django
django.setup()
from django.conf import settings
assert all(value.get('ENGINE', '').endswith('sqlite3') for value in settings.DATABASES.values())
assert settings.CACHES['default']['BACKEND'] == 'django.core.cache.backends.locmem.LocMemCache'
assert settings.CHANNEL_LAYERS['default']['BACKEND'] == 'channels.layers.InMemoryChannelLayer'
"""
        completed = subprocess.run(
            [sys.executable, "-c", check],
            cwd=settings.BASE_DIR,
            env=environment,
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_remote_psycopg_connection_is_blocked_and_redacted(self):
        dsn = "postgresql://unit-user:super-secret@remote-db.example.invalid/lms"
        with self.assertRaises(TestIsolationError) as caught:
            psycopg.connect(dsn)
        message = str(caught.exception)
        self.assertIn("remote-db.example.invalid", message)
        self.assertNotIn("unit-user", message)
        self.assertNotIn("super-secret", message)
        self.assertNotIn(dsn, message)

    def test_psycopg_classmethod_cannot_bypass_the_guard(self):
        dsn = "postgresql://unit-user:class-secret@raw.example.invalid/live"
        with self.assertRaises(TestIsolationError) as caught:
            psycopg.Connection.connect(dsn)
        self.assertNotIn("class-secret", str(caught.exception))

    def test_libpq_environment_fallback_cannot_hide_a_remote_host(self):
        from config.test_isolation import _database_call_target

        target = _database_call_target((), {}, {
            "PGHOST": "hidden.example.invalid",
            "PGPORT": "6543",
            "PGDATABASE": "hidden",
            "PGOPTIONS": "-c default_transaction_read_only=on",
            "PGUSER": "lms_benchmark_reader",
        })
        self.assertEqual(target, (
            "hidden.example.invalid", 6543, "hidden",
            "-c default_transaction_read_only=on", "lms_benchmark_reader",
        ))

    def test_libpq_service_definition_is_rejected_when_target_is_opaque(self):
        from config.test_isolation import _database_call_target

        with self.assertRaisesRegex(TestIsolationError, "service definitions"):
            _database_call_target((), {}, {"PGSERVICE": "production"})

    def test_unit_alias_validation_refuses_a_remote_database(self):
        with self.assertRaisesRegex(TestIsolationError, "alias 'default'"):
            assert_unit_database_aliases({
                "default": {"ENGINE": "django.db.backends.postgresql", "HOST": "remote-db.example.invalid"},
            })
        assert_unit_database_aliases({
            "default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"},
            "local": {"ENGINE": "django.db.backends.postgresql", "HOST": "127.0.0.1"},
        })

    def test_benchmark_reader_url_is_unavailable_in_default_unit_mode(self):
        with patch.dict(os.environ, {
            "LMS_TEST_MODE": UNIT_MODE,
            "LMS_BENCHMARK_READER_URL": "postgresql://lms_benchmark_reader:secret@ep-safe.example.invalid/neondb",
        }, clear=False):
            with self.assertRaisesRegex(TestIsolationError, "postgres-read-only"):
                configure_read_only_database_url(os.environ["LMS_BENCHMARK_READER_URL"])

    def test_read_only_mode_requires_exact_endpoint_and_branch_identity(self):
        base = {
            "LMS_TEST_MODE": POSTGRES_READ_ONLY_MODE,
            "LMS_BENCHMARK_READER_URL": f"postgresql://lms_benchmark_reader:secret@{BENCHMARK_POOLED_HOST}/neondb?sslmode=require",
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
        }
        policy = IsolationPolicy(base)
        self.assertEqual(policy.mode, POSTGRES_READ_ONLY_MODE)
        self.assertTrue(policy.permits(BENCHMARK_POOLED_HOST, 5432))
        self.assertTrue(policy.permits(BENCHMARK_DIRECT_HOST, 5432))
        for missing in (
            "LMS_BENCHMARK_READER_URL", "LMS_TEST_POSTGRES_ENDPOINT_ID",
            "LMS_TEST_POSTGRES_BRANCH_ID", "LMS_TEST_POSTGRES_BRANCH_NAME",
        ):
            invalid = {**base, missing: ""}
            with self.subTest(missing=missing), self.assertRaises(TestIsolationError):
                IsolationPolicy(invalid)

        with patch.dict(os.environ, base, clear=False):
            configured = configure_read_only_database_url(base["LMS_BENCHMARK_READER_URL"])
        self.assertIn("options=-c%20default_transaction_read_only%3Don", configured)
        self.assertNotIn("options=-c+", configured)
        self.assertIn(BENCHMARK_DIRECT_HOST, configured)
        self.assertNotIn(BENCHMARK_POOLED_HOST, configured)

    def test_parent_architecture_branch_is_rejected(self):
        environment = {
            "LMS_TEST_MODE": POSTGRES_READ_ONLY_MODE,
            "LMS_BENCHMARK_READER_URL": f"postgresql://lms_benchmark_reader:secret@{BENCHMARK_DIRECT_HOST}/neondb?sslmode=require",
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": "br-raspy-sky-abvs8lq9",
            "LMS_TEST_POSTGRES_BRANCH_NAME": "lms-ideal-architecture",
        }
        with self.assertRaisesRegex(TestIsolationError, "authorised benchmark branch"):
            IsolationPolicy(environment)

    def test_same_endpoint_wrong_database_is_rejected_before_connect(self):
        environment = {
            "LMS_TEST_MODE": POSTGRES_READ_ONLY_MODE,
            "LMS_BENCHMARK_READER_URL": f"postgresql://lms_benchmark_reader:secret@{BENCHMARK_DIRECT_HOST}/neondb?sslmode=require",
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
        }
        policy = IsolationPolicy(environment)
        with self.assertRaisesRegex(TestIsolationError, "authorised benchmark database"):
            policy.require_database(
                BENCHMARK_DIRECT_HOST, 5432,
                "-c default_transaction_read_only=on", "other_database",
            )

    def test_read_only_url_options_are_visible_to_the_database_guard(self):
        from config.test_isolation import _database_call_target

        dsn = (
            f"postgresql://lms_benchmark_reader:secret@{BENCHMARK_DIRECT_HOST}/neondb"
            "?sslmode=require&options=-c+default_transaction_read_only%3Don"
        )
        host, port, database, options, user = _database_call_target((dsn,), {})
        self.assertEqual(host, BENCHMARK_DIRECT_HOST)
        self.assertEqual(port, 5432)
        self.assertEqual(database, "neondb")
        self.assertIn("default_transaction_read_only=on", options)
        self.assertEqual(user, "lms_benchmark_reader")

    def test_read_only_guard_rejects_owner_role_on_authorised_endpoint(self):
        environment = {
            "LMS_TEST_MODE": POSTGRES_READ_ONLY_MODE,
            "LMS_BENCHMARK_READER_URL": f"postgresql://lms_benchmark_reader:secret@{BENCHMARK_DIRECT_HOST}/neondb?sslmode=require",
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
        }
        policy = IsolationPolicy(environment)
        with self.assertRaisesRegex(TestIsolationError, "lms_benchmark_reader"):
            policy.require_database(
                BENCHMARK_DIRECT_HOST, 5432,
                "-c default_transaction_read_only=on", "neondb", "neondb_owner",
            )


class IntegrationModeConfigurationTests(SimpleTestCase):
    def test_integration_mode_is_disabled_by_default(self):
        self.assertEqual(resolve_test_mode({}), UNIT_MODE)

    def test_python_unittest_entry_point_is_detected(self):
        from config.test_isolation import is_test_process

        self.assertTrue(is_test_process(["python", "-m", "unittest", "learner_api.tests"], {}))

    def test_local_benchmark_url_rejects_remote_or_shared_targets(self):
        invalid = (
            "postgresql://bench:secret@ep-dawn-block-ab5vob3x.eu-west-2.aws.neon.tech/local",
            "postgresql://bench:secret@127.0.0.1/neondb",
            "postgresql://bench:secret@0.0.0.0/lms_learner_benchmark_local_run1",
            "postgresql://bench:secret@127.0.0.1/lms_learner_benchmark_local_run1?options=-c%20search_path%3Dpublic",
        )
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ImproperlyConfigured):
                validate_local_benchmark_url(value)

    def test_local_benchmark_policy_allows_only_loopback_http_and_database(self):
        url = (
            "postgresql://benchmark:synthetic@127.0.0.1:5432/"
            "lms_learner_benchmark_local_run1"
        )
        policy = IsolationPolicy({
            "LMS_TEST_MODE": LOCAL_BENCHMARK_MODE,
            "LMS_LOCAL_BENCHMARK_DATABASE_URL": url,
        })
        policy.require_http("POST", "http://127.0.0.1:8765/login", client="benchmark")
        policy.require_database(
            "127.0.0.1", 5432, "", "lms_learner_benchmark_local_run1", "benchmark",
        )
        with self.assertRaisesRegex(TestIsolationError, "loopback"):
            policy.require_database(
                BENCHMARK_DIRECT_HOST, 5432, "", "lms_learner_benchmark_local_run1", "benchmark",
            )
        with self.assertRaisesRegex(TestIsolationError, "disposable"):
            policy.require_database("127.0.0.1", 5432, "", "neondb", "benchmark")
        with self.assertRaises(TestIsolationError):
            policy.require_http("GET", "https://graph.microsoft.com/v1.0/me", client="benchmark")

    def test_fresh_local_benchmark_settings_scrub_remote_inputs(self):
        url = (
            "postgresql://benchmark:synthetic@127.0.0.1:5432/"
            "lms_learner_benchmark_local_run1"
        )
        environment = os.environ.copy()
        environment.update({
            "DJANGO_SETTINGS_MODULE": "config.settings_local_benchmark",
            "LMS_LOCAL_BENCHMARK_DATABASE_URL": url,
            "LMS_IDEAL_TEST": "postgresql://owner:must-not-load@neon.example.invalid/neondb",
            "DATABASE_URL": "postgresql://owner:must-not-load@neon.example.invalid/neondb",
            "AUDIT_DATABASE_URL": "postgresql://owner:must-not-load@audit.example.invalid/audit",
            "MICROSOFT_CLIENT_SECRET": "must-not-load",
            "AZURE_STORAGE_KEY": "must-not-load",
            "REDIS_URL": "redis://cache.example.invalid:6379/1",
        })
        check = r'''
import os
import django
django.setup()
from django.conf import settings
assert set(settings.DATABASES) == {"default", "enrolment"}
for config in settings.DATABASES.values():
    assert config["ENGINE"].endswith("postgresql")
    assert config["HOST"] == "127.0.0.1"
    assert config["NAME"] == "lms_learner_benchmark_local_run1"
assert settings.EMAIL_BACKEND.endswith("locmem.EmailBackend")
assert settings.CACHES["default"]["BACKEND"].endswith("LocMemCache")
assert settings.CHANNEL_LAYERS["default"]["BACKEND"].endswith("InMemoryChannelLayer")
for key in ("LMS_IDEAL_TEST", "LMS_BENCHMARK_READER_URL", "AUDIT_DATABASE_URL",
            "MICROSOFT_CLIENT_SECRET", "AZURE_STORAGE_KEY", "REDIS_URL"):
    assert os.environ.get(key, "") == "", key
'''
        completed = subprocess.run(
            [sys.executable, "-c", check],
            cwd=settings.BASE_DIR,
            env=environment,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_integration_mode_needs_an_exact_allowlist(self):
        with self.assertRaisesRegex(TestIsolationError, "non-empty"):
            IsolationPolicy({"LMS_TEST_MODE": INTEGRATION_MODE})
        for value in ("*", "*.example.test", "user@example.test", "example.test/path"):
            with self.subTest(value=value), self.assertRaises(TestIsolationError):
                IsolationPolicy({
                    "LMS_TEST_MODE": INTEGRATION_MODE,
                    "LMS_TEST_INTEGRATION_ALLOW_HOSTS": value,
                })

    def test_read_only_and_mutating_integration_switches_are_separate(self):
        readonly = IsolationPolicy({
            "LMS_TEST_MODE": INTEGRATION_MODE,
            "LMS_TEST_INTEGRATION_ALLOW_HOSTS": "api.example.test:443",
        })
        self.assertFalse(readonly.external_mutations)
        self.assertFalse(readonly.database_writes)
        readonly.require_http("GET", "https://api.example.test/status", client="test")
        with self.assertRaisesRegex(TestIsolationError, "mutation"):
            readonly.require_http("POST", "https://api.example.test/items", client="test")

    def test_writable_database_integration_requires_expected_branch_identity(self):
        policy = IsolationPolicy({
            "LMS_TEST_MODE": INTEGRATION_MODE,
            "LMS_TEST_INTEGRATION_ALLOW_HOSTS": "db.example.test:5432",
            "LMS_TEST_ALLOW_DATABASE_WRITES": "true",
        })
        with self.assertRaisesRegex(TestIsolationError, "branch ID"):
            policy.require_database("db.example.test", 5432, "")

        mutating = IsolationPolicy({
            "LMS_TEST_MODE": INTEGRATION_MODE,
            "LMS_TEST_INTEGRATION_ALLOW_HOSTS": "api.example.test:443",
            "LMS_TEST_ALLOW_EXTERNAL_MUTATIONS": "true",
            "LMS_TEST_ALLOW_DATABASE_WRITES": "true",
        })
        self.assertTrue(mutating.external_mutations)
        self.assertTrue(mutating.database_writes)
        mutating.require_http("POST", "https://api.example.test/items", client="test")

