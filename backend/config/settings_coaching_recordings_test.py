"""Opt-in isolated settings for coaching recordings, reviews and reminders."""
import os

# Set these before base settings are evaluated. This module is never imported
# by the application's normal settings or default production test runner.
os.environ.update(
    DJANGO_USE_SQLITE='true',
    USE_SECURITY_TEST_BRANCH='false',
    AZURE_MAIL_ENABLED='false',
    CATCHUP_REMINDERS_ENABLED='false',
    SESSION_RESULTS_AUTOMATIC='false',
    COACH_DASHBOARD_SNAPSHOT_SCHEDULE='false',
    COACH_RECORDINGS_AUTOMATIC='false',
)

from .settings_sqlite_test import *  # noqa: F401,F403,E402
from .settings_sqlite_test import DATABASES  # noqa: E402

if any(value['ENGINE'] != 'django.db.backends.sqlite3' for value in DATABASES.values()):
    raise RuntimeError('Coaching feature tests require isolated SQLite aliases.')

TEST_RUNNER = 'django.test.runner.DiscoverRunner'
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
