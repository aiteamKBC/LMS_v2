"""Sanitised live check for the Phase 4G.2 Django benchmark runtime."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# This verifier must be safe when launched from an ordinary developer shell.
# Remove every legacy/owner input in this process before Django can read .env,
# then opt into the one control-plane-verified benchmark target.
for key in (
    "LMS_IDEAL_TEST",
    "DATABASE_URL",
    "DATABASEURL",
    "Database_url",
    "ENROLMENT_DATABASE_URL",
    "AUDIT_DATABASE_URL",
    "AUDIT_CLONE_DATABASE_URL",
):
    os.environ.pop(key, None)
os.environ.update(
    RUN_APP_ON_TEST_BRANCH="true",
    LMS_TEST_ACTIVE="true",
    LMS_TEST_MODE="postgres-read-only",
    LMS_TEST_POSTGRES_BRANCH_NAME="lms_ideal_test",
    LMS_TEST_POSTGRES_BRANCH_ID="br-orange-shadow-abm8uwwe",
    LMS_TEST_POSTGRES_ENDPOINT_ID="ep-dawn-block-ab5vob3x",
)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.conf import settings
from django.db import connections


evidence = {
    "aliases": sorted(settings.DATABASES),
    "users": {alias: settings.DATABASES[alias]["USER"] for alias in settings.DATABASES},
    "hosts": {alias: settings.DATABASES[alias]["HOST"] for alias in settings.DATABASES},
    "owner_env_loaded": bool(os.environ.get("LMS_IDEAL_TEST")),
    "fallbacks_loaded": any(
        os.environ.get(key)
        for key in ("DATABASE_URL", "DATABASEURL", "Database_url", "ENROLMENT_DATABASE_URL")
    ),
}
with connections["default"].cursor() as cursor:
    cursor.execute(
        """SELECT current_user,current_database(),
                  current_setting('neon.branch_id',true),
                  current_setting('neon.endpoint_id',true),
                  current_setting('transaction_read_only')"""
    )
    evidence["database_identity"] = cursor.fetchone()

print(json.dumps(evidence, sort_keys=True))
