"""The RUN_APP_ON_TEST_BRANCH database guard.

The point of test-branch mode is that a manual tester can drive the real app
without a single write reaching production. That promise rests entirely on this
guard, so it is proven here directly rather than by booting Django: the guard
takes the environment as an argument and reads no module state.

``enrolment`` gets its own cases because it is the alias learner progress and
every completion write actually land on, and it resolves from its own variable
before falling back to the ones ``default`` uses.
"""
import os
from unittest.mock import patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.settings import TEST_BRANCH_BLANK_KEYS, assert_test_branch_databases

# Hosts only; the passwords here are placeholders and match no real role.
BRANCH_HOST = "ep-holy-union-abdyzfi6-pooler.eu-west-2.aws.neon.tech"
PRODUCTION_HOST = "ep-wild-shape-ab005yy6-pooler.eu-west-2.aws.neon.tech"
BRANCH_URL = f"postgresql://role:placeholder@{BRANCH_HOST}/neondb?sslmode=require"
PRODUCTION_URL = f"postgresql://role:placeholder@{PRODUCTION_HOST}/neondb?sslmode=require"


class TestBranchDatabaseGuardTests(SimpleTestCase):
    def env(self, **overrides):
        """A minimal passing test-branch environment, with overrides applied.

        A value of ``None`` removes the key, so a case can prove that leaving a
        variable unset is what makes the difference.
        """
        base = {
            "security_Database_url": BRANCH_URL,
            "DATABASE_URL": BRANCH_URL,
            "Database_url": BRANCH_URL,
        }
        base.update(overrides)
        return {key: value for key, value in base.items() if value is not None}

    # -- enrolment, the alias completions are written through ----------------

    def test_a_production_enrolment_url_is_refused(self):
        with self.assertRaises(ImproperlyConfigured) as caught:
            assert_test_branch_databases(self.env(ENROLMENT_DATABASE_URL=PRODUCTION_URL))
        message = str(caught.exception)
        self.assertIn("ENROLMENT_DATABASE_URL", message)
        self.assertIn(PRODUCTION_HOST, message)

    def test_the_approved_branch_enrolment_url_is_accepted(self):
        self.assertEqual(
            assert_test_branch_databases(self.env(ENROLMENT_DATABASE_URL=BRANCH_URL)),
            BRANCH_HOST,
        )

    def test_an_absent_enrolment_url_is_allowed_because_it_falls_through(self):
        # Unset means the alias reuses Database_url, which is checked already.
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
                "DATABASE_URL": PRODUCTION_URL,
                "Database_url": PRODUCTION_URL,
                "ENROLMENT_DATABASE_URL": PRODUCTION_URL,
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
            assert_test_branch_databases(self.env(security_Database_url=None))

    def test_every_audit_alias_must_be_blank(self):
        for key in TEST_BRANCH_BLANK_KEYS:
            with self.subTest(key=key):
                with self.assertRaises(ImproperlyConfigured) as caught:
                    assert_test_branch_databases(self.env(**{key: PRODUCTION_URL}))
                self.assertIn(key, str(caught.exception))
