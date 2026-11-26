"""Run focused date/OTJH/snapshot and mocked Teams checks without any DB access."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings_sqlite_test"

import django
django.setup()

from django.conf import settings
from django.db.backends.base.base import BaseDatabaseWrapper

if any(db["ENGINE"] != "django.db.backends.sqlite3" for db in settings.DATABASES.values()):
    raise RuntimeError("Only isolated SQLite test settings are permitted.")

labels = [
    "coach_api.tests_profile_start_date.ProfileStartDateTests",
    "coach_api.tests_caseload_display_dates",
    "coach_api.tests.SerializeCaseloadDashboardLearnerTests",
    "coach_api.tests.OtjhToDateContractTests",
    "coach_api.tests.CoachDashboardReadModelTests",
    "curriculum_api.tests.TeamsMultiDayRecurrenceTests",
    "curriculum_api.tests.TeamsAttendanceRosterTests",
]
suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(label) for label in labels)
with patch.object(BaseDatabaseWrapper, "ensure_connection", side_effect=AssertionError("Database access forbidden in these checks")):
    result = unittest.TextTestRunner(verbosity=1).run(suite)
raise SystemExit(not result.wasSuccessful())
