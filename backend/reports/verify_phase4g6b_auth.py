"""Reader-only Django authentication and ownership check for Phase 4G.6B."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.benchmark_credentials import read_benchmark_reader_url  # noqa: E402
from reports.provision_phase4g6_fixture import (  # noqa: E402
    HANDLE_CREDENTIAL, SESSION_CREDENTIAL,
)


def _credential(target: str) -> str:
    return read_benchmark_reader_url({
        "LMS_BENCHMARK_READER_CREDENTIAL_TARGET": target,
        "LMS_BENCHMARK_READER_URL": "",
    })


for key in (
    "LMS_IDEAL_TEST", "DATABASE_URL", "DATABASEURL", "Database_url",
    "ENROLMENT_DATABASE_URL", "AUDIT_DATABASE_URL", "AUDIT_CLONE_DATABASE_URL",
):
    os.environ.pop(key, None)
os.environ.update(
    RUN_APP_ON_TEST_BRANCH="true",
    LMS_TEST_ACTIVE="true",
    LMS_TEST_MODE="postgres-read-only",
    LMS_TEST_POSTGRES_BRANCH_NAME="lms_ideal_test",
    LMS_TEST_POSTGRES_BRANCH_ID="br-orange-shadow-abm8uwwe",
    LMS_TEST_POSTGRES_ENDPOINT_ID="ep-dawn-block-ab5vob3x",
    LEARNER_API_REQUIRE_AUTH="1",
    API_REQUIRE_AUTH="1",
    DJANGO_SETTINGS_MODULE="config.settings",
)

session_secret = json.loads(_credential(SESSION_CREDENTIAL))
handle = json.loads(_credential(HANDLE_CREDENTIAL))
if session_secret.get("namespace") != handle.get("namespace"):
    raise RuntimeError("Session and receipt handle namespaces differ")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.db import connections  # noqa: E402
from django.test import Client  # noqa: E402
from learner_api.canonical_learning import profile  # noqa: E402


with connections["default"].cursor() as cursor:
    cursor.execute(
        """SELECT current_user,current_database(),
                  current_setting('neon.branch_id',true),
                  current_setting('neon.endpoint_id',true),
                  current_setting('transaction_read_only')"""
    )
    db_identity = list(cursor.fetchone())
    cursor.execute(
        'SELECT "Last_seen_at","Expires_at" FROM login."Login_sessions" WHERE id=%s',
        [handle["session_id"]],
    )
    session_before = cursor.fetchone()

client = Client(HTTP_HOST="localhost")
client.cookies["kbc_session"] = session_secret["token"]
me = client.get("/login_api/me/")
owned = client.get(
    f"/learner_api/learner-summary/apprenticeship/{handle['enrolment_id']}/"
)
other = client.get(
    f"/learner_api/learner-summary/apprenticeship/{int(handle['enrolment_id']) + 1}/"
)
anonymous = Client(HTTP_HOST="localhost")
anon_me = anonymous.get("/login_api/me/")
anon_owned = anonymous.get(
    f"/learner_api/learner-summary/apprenticeship/{handle['enrolment_id']}/"
)
owner = profile(handle["enrolment_id"])

with connections["default"].cursor() as cursor:
    cursor.execute(
        'SELECT "Last_seen_at","Expires_at" FROM login."Login_sessions" WHERE id=%s',
        [handle["session_id"]],
    )
    session_after = cursor.fetchone()

me_body = me.json() if me.status_code == 200 else {}
owned_body = owned.json() if owned.status_code == 200 else {}
checks = {
    "aliases_exact": sorted(settings.DATABASES) == ["default", "enrolment"],
    "reader_only": db_identity == [
        "lms_benchmark_reader", "neondb", "br-orange-shadow-abm8uwwe",
        "ep-dawn-block-ab5vob3x", "on",
    ],
    "owner_env_absent": not bool(os.environ.get("LMS_IDEAL_TEST")),
    "fallback_env_absent": not any(os.environ.get(key) for key in (
        "DATABASE_URL", "DATABASEURL", "Database_url", "ENROLMENT_DATABASE_URL"
    )),
    "valid_session_200": me.status_code == 200,
    "account_is_learner": me_body.get("user", {}).get("role") == "learner",
    "account_enrolment_exact": int(me_body.get("user", {}).get("subjectId", -1)) == int(handle["enrolment_id"]),
    "owned_summary_200": owned.status_code == 200,
    "owned_summary_exact": int(owned_body.get("id", -1)) == int(handle["enrolment_id"]),
    "other_learner_hidden": other.status_code == 404,
    "anonymous_me_denied": anon_me.status_code == 401,
    "anonymous_owned_denied": anon_owned.status_code == 401,
    "canonical_enrolment_exact": int(owner.get("enrolment_id", -1)) == int(handle["enrolment_id"]),
    "canonical_learner_exact": int(owner.get("id", -1)) == int(handle["learner_id"]),
    "session_unchanged": session_before == session_after,
}
if not all(checks.values()):
    raise RuntimeError("Django authentication or canonical ownership check failed")
print(json.dumps({"checks": checks, "database_identity": db_identity}, sort_keys=True))
