"""The RUN_APP_ON_TEST_BRANCH database guard.

The point of test-branch mode is that a manual tester can drive the real app
without a single write reaching production. That promise rests entirely on this
guard, so it is proven here directly rather than by booting Django: the guard
takes the environment as an argument and reads no module state.

Benchmark mode builds both Django aliases from the dedicated Reader URL only.
Owner and legacy primary URLs are absent; optional aliases cannot retain their
normal deployment targets.
"""
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.settings import (
    TEST_BRANCH_BLANK_KEYS,
    TEST_BRANCH_SUPPRESSED_ENV_KEYS,
    assert_test_branch_databases,
    load_env_file,
)
from config.test_isolation import (
    BENCHMARK_BRANCH_ID,
    BENCHMARK_BRANCH_NAME,
    BENCHMARK_DATABASE_NAME,
    BENCHMARK_ENDPOINT_ID,
    BENCHMARK_POOLED_HOST,
)

# Hosts only; the passwords here are placeholders and match no real role.
BRANCH_HOST = BENCHMARK_POOLED_HOST
PRODUCTION_HOST = "ep-wild-shape-ab005yy6-pooler.eu-west-2.aws.neon.tech"
BRANCH_URL = f"postgresql://lms_benchmark_reader:placeholder@{BRANCH_HOST}/{BENCHMARK_DATABASE_NAME}?sslmode=require"
PRODUCTION_URL = f"postgresql://role:placeholder@{PRODUCTION_HOST}/neondb?sslmode=require"


class TestBranchDatabaseGuardTests(SimpleTestCase):
    def env(self, **overrides):
        """A minimal passing test-branch environment, with overrides applied.

        A value of ``None`` removes the key, so a case can prove that leaving a
        variable unset is what makes the difference.
        """
        base = {
            "LMS_BENCHMARK_READER_URL": BRANCH_URL,
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
        }
        base.update(overrides)
        return {key: value for key, value in base.items() if value is not None}

    # -- legacy primary variables cannot redirect either Django alias --------

    def test_a_production_enrolment_url_is_refused(self):
        with self.assertRaises(ImproperlyConfigured) as caught:
            assert_test_branch_databases(self.env(ENROLMENT_DATABASE_URL=PRODUCTION_URL))
        message = str(caught.exception)
        self.assertIn("ENROLMENT_DATABASE_URL", message)
        self.assertNotIn("placeholder", message)

    def test_matching_legacy_enrolment_url_is_refused_even_on_same_host(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "ENROLMENT_DATABASE_URL"):
            assert_test_branch_databases(self.env(ENROLMENT_DATABASE_URL=BRANCH_URL))

    def test_an_absent_enrolment_url_is_allowed(self):
        # Both aliases are built from the Reader URL, not by falling through.
        self.assertEqual(assert_test_branch_databases(self.env()), BRANCH_HOST)

    def test_an_unparseable_enrolment_url_is_refused_rather_than_ignored(self):
        with self.assertRaises(ImproperlyConfigured) as caught:
            assert_test_branch_databases(self.env(ENROLMENT_DATABASE_URL="neondb"))
        self.assertIn("ENROLMENT_DATABASE_URL", str(caught.exception))

    # -- production mode is untouched ---------------------------------------

    def test_production_mode_never_reaches_the_guard(self):
        # Nothing in this module runs unless the flag is on, and it is off here.
        self.assertFalse(settings.RUN_APP_ON_TEST_BRANCH)
        # And the guard is not merely passing by accident in this process: a
        # production-shaped environment -- no approved branch named at all --
        # is refused outright. This process started regardless, because the
        # flag, not the environment, is what invokes the guard.
        with self.assertRaises(ImproperlyConfigured):
            assert_test_branch_databases({
                "LMS_BENCHMARK_READER_URL": PRODUCTION_URL,
                "LMS_TEST_POSTGRES_ENDPOINT_ID": "ep-production",
                "LMS_TEST_POSTGRES_BRANCH_ID": "br-production",
                "LMS_TEST_POSTGRES_BRANCH_NAME": "production",
            })

    def test_the_flag_is_off_for_every_non_affirmative_value(self):
        for value in ("", "0", "false", "no", "off", "production"):
            with patch.dict(os.environ, {"RUN_APP_ON_TEST_BRANCH": value}, clear=False):
                self.assertNotIn(
                    os.environ["RUN_APP_ON_TEST_BRANCH"].strip().lower(),
                    {"1", "true", "yes", "on"},
                    f"{value!r} must not switch the app onto the test branch",
                )

    # -- the checks that were already there stay in force --------------------

    def test_a_production_default_url_is_still_refused(self):
        with self.assertRaises(ImproperlyConfigured) as caught:
            assert_test_branch_databases(self.env(DATABASE_URL=PRODUCTION_URL))
        self.assertIn("DATABASE_URL", str(caught.exception))

    def test_an_absent_branch_url_is_refused(self):
        with self.assertRaises(ImproperlyConfigured):
            assert_test_branch_databases(self.env(LMS_BENCHMARK_READER_URL=None))

    def test_privileged_test_url_is_refused_even_on_the_same_branch(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "privileged LMS_IDEAL_TEST"):
            assert_test_branch_databases(self.env(LMS_IDEAL_TEST=BRANCH_URL))

    def test_parent_architecture_metadata_is_refused(self):
        with self.assertRaisesRegex(ImproperlyConfigured, "authorised benchmark branch"):
            assert_test_branch_databases(self.env(
                LMS_TEST_POSTGRES_BRANCH_NAME="lms-ideal-architecture",
                LMS_TEST_POSTGRES_BRANCH_ID="br-raspy-sky-abvs8lq9",
            ))

    def test_every_audit_alias_must_be_blank(self):
        for key in TEST_BRANCH_BLANK_KEYS:
            with self.subTest(key=key):
                with self.assertRaises(ImproperlyConfigured) as caught:
                    assert_test_branch_databases(self.env(**{key: PRODUCTION_URL}))
                self.assertIn(key, str(caught.exception))

    def test_benchmark_mode_does_not_reload_external_aliases_from_dotenv(self):
        with TemporaryDirectory() as directory:
            dotenv = Path(directory) / ".env"
            dotenv.write_text(
                "\n".join([
                    *(f"{key}={PRODUCTION_URL}" for key in TEST_BRANCH_SUPPRESSED_ENV_KEYS),
                    "PHASE4G_SAFE_SENTINEL=loaded",
                ]),
                encoding="utf-8",
            )
            clean = {"RUN_APP_ON_TEST_BRANCH": "true"}
            with patch.dict(os.environ, clean, clear=True):
                load_env_file(dotenv)
                self.assertEqual(os.environ["PHASE4G_SAFE_SENTINEL"], "loaded")
                for key in TEST_BRANCH_SUPPRESSED_ENV_KEYS:
                    self.assertNotIn(key, os.environ)

    def test_fresh_benchmark_runtime_is_hermetic_before_any_request(self):
        environment = os.environ.copy()
        for key in TEST_BRANCH_SUPPRESSED_ENV_KEYS:
            environment.pop(key, None)
        environment.update({
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "RUN_APP_ON_TEST_BRANCH": "true",
            "LMS_TEST_ACTIVE": "true",
            "LMS_TEST_MODE": "postgres-read-only",
            "LMS_BENCHMARK_READER_URL": BRANCH_URL,
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
            # Hostile inherited values must be overridden by benchmark mode.
            "CACHE_URL": "redis://cache.example.invalid:6379/1",
            "REDIS_URL": "redis://cache.example.invalid:6379/1",
            "SESSION_RESULTS_AUTOMATIC": "true",
            "COACH_DASHBOARD_SNAPSHOT_SCHEDULE": "true",
            "CATCHUP_REMINDERS_ENABLED": "true",
            "COACH_RECORDINGS_AUTOMATIC": "true",
            "ENGLAND_HOLIDAY_AUTO_SYNC": "true",
            "CURRICULUM_WARM": "true",
            "API_REQUIRE_AUTH": "0",
            "LEARNER_API_REQUIRE_AUTH": "0",
            "CHAT_DEMO_BOOTSTRAP_ENABLED": "true",
            "KBC_MOBILE_API_ENABLED": "true",
            "KBC_MOBILE_COMMS_ENABLED": "true",
            "KBC_MOBILE_PUSH_ENABLED": "true",
            "KBC_MOBILE_CALENDAR_WRITES_ENABLED": "true",
            "AZURE_STORAGE_ACCOUNT": "must-be-cleared",
            "AZURE_STORAGE_KEY": "must-be-cleared",
            "AZURE_MATERIALS_STORAGE_ACCOUNT": "must-be-cleared",
            "AZURE_MATERIALS_STORAGE_KEY": "must-be-cleared",
        })
        check = r'''
import threading
starts = []
original_start = threading.Thread.start
def forbidden_start(self, *args, **kwargs):
    starts.append(self.name)
    raise AssertionError("background thread started during benchmark startup")
threading.Thread.start = forbidden_start
import django
django.setup()
from django.conf import settings
assert starts == []
assert set(settings.DATABASES) == {"default", "enrolment"}
for alias, config in settings.DATABASES.items():
    assert config["HOST"] == "'''+BENCHMARK_ENDPOINT_ID+r'''.eu-west-2.aws.neon.tech", alias
    assert config["NAME"] == "neondb", alias
    assert config["USER"] == "lms_benchmark_reader", alias
    assert "default_transaction_read_only=on" in config["OPTIONS"]["options"]
    assert "pool" not in config["OPTIONS"]
assert "LMS_IDEAL_TEST" not in __import__("os").environ
for key in ("DATABASE_URL", "DATABASEURL", "Database_url", "ENROLMENT_DATABASE_URL"):
    assert key not in __import__("os").environ, key
assert settings.CACHES["default"]["BACKEND"].endswith("LocMemCache")
assert settings.CHANNEL_LAYERS["default"]["BACKEND"].endswith("InMemoryChannelLayer")
assert settings.EMAIL_BACKEND.endswith("locmem.EmailBackend")
assert settings.READ_MODEL_OUTBOX_ENABLED is False
assert settings.READ_MODEL_DUAL_WRITE_ENABLED is False
assert settings.LEARNER_HOME_SHARED_READ_MODEL_ENABLED is False
assert settings.CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP is False
assert settings.CHAT_DEMO_BOOTSTRAP_ENABLED is False
assert settings.KBC_MOBILE_API_ENABLED is False
assert settings.KBC_MOBILE_COMMS_ENABLED is False
assert settings.KBC_MOBILE_PUSH_ENABLED is False
assert settings.KBC_MOBILE_CALENDAR_WRITES_ENABLED is False
assert settings.AZURE_STORAGE_ACCOUNT == ""
assert settings.AZURE_STORAGE_KEY == ""
assert settings.AZURE_MATERIALS_STORAGE_ACCOUNT == ""
assert settings.AZURE_MATERIALS_STORAGE_KEY == ""
assert __import__("os").environ["API_REQUIRE_AUTH"] == "1"
assert __import__("os").environ["LEARNER_API_REQUIRE_AUTH"] == "1"
for key in ("SESSION_RESULTS_AUTOMATIC", "COACH_DASHBOARD_SNAPSHOT_SCHEDULE",
            "CATCHUP_REMINDERS_ENABLED", "COACH_RECORDINGS_AUTOMATIC",
            "ENGLAND_HOLIDAY_AUTO_SYNC", "CURRICULUM_WARM"):
    assert __import__("os").environ[key] == "0", key
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

    def test_fresh_benchmark_runtime_blocks_external_and_raw_database_bypasses(self):
        environment = os.environ.copy()
        for key in TEST_BRANCH_SUPPRESSED_ENV_KEYS:
            environment.pop(key, None)
        environment.update({
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "RUN_APP_ON_TEST_BRANCH": "true",
            "LMS_TEST_ACTIVE": "true",
            "LMS_TEST_MODE": "postgres-read-only",
            "LMS_BENCHMARK_READER_URL": BRANCH_URL,
            "LMS_TEST_POSTGRES_ENDPOINT_ID": BENCHMARK_ENDPOINT_ID,
            "LMS_TEST_POSTGRES_BRANCH_ID": BENCHMARK_BRANCH_ID,
            "LMS_TEST_POSTGRES_BRANCH_NAME": BENCHMARK_BRANCH_NAME,
        })
        check = r'''
import asyncio
import smtplib
import socket
import django
import httpx
import psycopg
import requests
django.setup()
from config.test_isolation import TestIsolationError

def blocked(call, secret=""):
    try:
        call()
    except TestIsolationError as error:
        assert not secret or secret not in str(error)
        return
    raise AssertionError("external operation was not blocked")

blocked(lambda: socket.getaddrinfo("account.blob.core.windows.net", 443))
blocked(lambda: httpx.get("https://graph.microsoft.com/v1.0/me", timeout=.01, trust_env=False))
blocked(lambda: requests.get("https://webhook.example.invalid/event", timeout=.01))
blocked(lambda: smtplib.SMTP(timeout=.01).connect("smtp.example.invalid", 587))
wrong = "postgresql://role:do-not-log@ep-other.eu-west-2.aws.neon.tech/neondb?sslmode=require&options=-c%20default_transaction_read_only%3Don"
blocked(lambda: psycopg.connect(wrong), "do-not-log")
blocked(lambda: psycopg.Connection.connect(wrong), "do-not-log")
async def async_wrong():
    await psycopg.AsyncConnection.connect(wrong)
blocked(lambda: asyncio.run(async_wrong()), "do-not-log")
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
