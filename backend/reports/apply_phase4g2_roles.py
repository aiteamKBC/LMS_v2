"""Create and verify the Phase 4G.2 roles on the pinned Neon test branch.

This one-shot helper deliberately never prints a DSN or password.  The Reader
connection is stored as a Generic Credential in Windows Credential Manager so
the benchmark runtime does not need the owner URL or a plaintext secret file.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import secrets
import sys
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg import sql


PROJECT_ID = "green-term-97168878"
BRANCH_ID = "br-orange-shadow-abm8uwwe"
ENDPOINT_ID = "ep-dawn-block-ab5vob3x"
DATABASE_NAME = "neondb"
OWNER_ROLE = "neondb_owner"
READER_ROLE = "lms_benchmark_reader"
PROVISIONER_ROLE = "lms_fixture_provisioner"
CREDENTIAL_TARGET = "LMS_v2/phase4g2/lms_benchmark_reader"
DIRECT_HOST = f"{ENDPOINT_ID}.eu-west-2.aws.neon.tech"
POOLED_HOST = f"{ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"


class _Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def _env_value(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if value:
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        if raw.startswith(f"{key}="):
            return raw.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} is unavailable")


def _owner_dsn() -> str:
    parsed = urlsplit(_env_value("LMS_IDEAL_TEST"))
    host = (parsed.hostname or "").casefold()
    if host not in {DIRECT_HOST, POOLED_HOST}:
        raise RuntimeError("LMS_IDEAL_TEST is not the pinned benchmark endpoint")
    if parsed.path.lstrip("/") != DATABASE_NAME:
        raise RuntimeError("LMS_IDEAL_TEST is not the pinned benchmark database")
    if parsed.username != OWNER_ROLE:
        raise RuntimeError("LMS_IDEAL_TEST is not the expected owner identity")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.pop("options", None)
    query["sslmode"] = "require"
    netloc = parsed.netloc.replace(POOLED_HOST, DIRECT_HOST)
    return urlunsplit((parsed.scheme, netloc, parsed.path, urlencode(query), ""))


def _reader_dsn(owner_dsn: str, password: str) -> str:
    parsed = urlsplit(owner_dsn)
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{quote(READER_ROLE, safe='')}:{quote(password, safe='')}@{host}{port}"
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["sslmode"] = "require"
    option = "-c default_transaction_read_only=on"
    query["options"] = option
    return urlunsplit((parsed.scheme, netloc, parsed.path, urlencode(query, quote_via=quote), ""))


def _write_generic_credential(target: str, username: str, secret: str) -> None:
    if os.name != "nt":
        raise RuntimeError("Windows Credential Manager is required")
    blob = secret.encode("utf-16-le")
    if len(blob) > 5 * 512:
        raise RuntimeError("Credential blob is unexpectedly large")
    buffer = ctypes.create_string_buffer(blob)
    credential = _Credential()
    credential.Type = 1  # CRED_TYPE_GENERIC
    credential.TargetName = target
    credential.Comment = "LMS Phase 4G.2 benchmark Reader DSN"
    credential.CredentialBlobSize = len(blob)
    credential.CredentialBlob = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    credential.Persist = 2  # CRED_PERSIST_LOCAL_MACHINE (current-user encrypted)
    credential.UserName = username
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(_Credential), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    if not advapi32.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


ROLE_SQL = [
    """CREATE ROLE lms_benchmark_reader LOGIN PASSWORD NULL NOSUPERUSER
       NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
       CONNECTION LIMIT 4""",
    """CREATE ROLE lms_fixture_provisioner LOGIN PASSWORD NULL NOSUPERUSER
       NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
       CONNECTION LIMIT 1""",
    "ALTER ROLE lms_benchmark_reader SET default_transaction_read_only = on",
    "ALTER ROLE lms_benchmark_reader SET statement_timeout = '30s'",
    "ALTER ROLE lms_benchmark_reader SET lock_timeout = '2s'",
    "ALTER ROLE lms_benchmark_reader SET idle_in_transaction_session_timeout = '15s'",
    "ALTER ROLE lms_benchmark_reader SET search_path = pg_catalog",
    "ALTER ROLE lms_fixture_provisioner SET statement_timeout = '30s'",
    "ALTER ROLE lms_fixture_provisioner SET lock_timeout = '2s'",
    "ALTER ROLE lms_fixture_provisioner SET idle_in_transaction_session_timeout = '15s'",
    "ALTER ROLE lms_fixture_provisioner SET search_path = pg_catalog",
    "REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC",
    "GRANT CONNECT ON DATABASE neondb TO lms_benchmark_reader, lms_fixture_provisioner",
    """GRANT USAGE ON SCHEMA login, enrolment, "Learner", curriculum,
       "Audit", "Last_audit", fetching_evidence,
       structured_manual_activities, "Coach" TO lms_benchmark_reader""",
    "GRANT SELECT ON login.\"Login_accounts\", login.\"Login_sessions\" TO lms_benchmark_reader",
    """GRANT SELECT ON enrolment."Created_users", enrolment."Extended_ILR",
       enrolment."Enrolment_Reviews" TO lms_benchmark_reader""",
    """GRANT SELECT ON
       "Learner".learners,
       "Learner".learner_training_plan_modules,
       "Learner".learner_training_plan_weeks,
       "Learner".learner_training_plan_components,
       "Learner".learner_progress_entries,
       "Learner".learner_activity_sources,
       "Learner".learner_activity_reporting_segments,
       "Learner".learner_journal_rows,
       "Learner".learner_progress_historical_components,
       "Learner".learner_progress_ksbs,
       "Learner".learner_quiz_answers,
       "Learner".learner_quiz_chosen_answers,
       "Learner".learner_quiz_correct_answers,
       "Learner".learner_source_course_memberships,
       "Learner".learner_monthly_targets,
       "Learner".learner_activity_documents,
       "Learner"."Evidence", "Learner".evidence_files,
       "Learner".learning_reflection_submissions,
       "Learner".reviews, "Learner".review_sections,
       "Learner".review_documents,
       "Learner".progress_review_source_snapshots
       TO lms_benchmark_reader""",
    """GRANT SELECT ON
       curriculum.programmes, curriculum.cohorts, curriculum.groups,
       curriculum.modules, curriculum.weeks, curriculum.components,
       curriculum.historical_components, curriculum.ksb_definitions,
       curriculum.ksb_mappings, curriculum.quizzes,
       curriculum.quiz_questions, curriculum.quiz_answers,
       curriculum.quiz_component_links, curriculum.quiz_course_links,
       curriculum.record_revisions, curriculum.source_courses,
       curriculum.source_activities, curriculum.source_materials,
       curriculum.live_sessions, curriculum.live_session_occurrences,
       curriculum.live_session_attendance, curriculum.review_types,
       curriculum.review_templates, curriculum.review_sections,
       curriculum.review_fields, curriculum.review_instances,
       curriculum.review_instance_answers,
       curriculum.review_instance_signatures,
       curriculum.review_occurrence_overrides
       TO lms_benchmark_reader""",
    """GRANT SELECT ON
       "Audit".learner_match, "Audit".contract_document_archive,
       "Audit".ilr_learning_deliveries, "Audit".learner_evidence_overrides,
       "Last_audit".learners, "Last_audit".activities,
       "Last_audit".activity_actual_hours,
       "Last_audit".activity_planned_hours,
       "Last_audit".activity_results, "Last_audit".groups,
       "Last_audit".group_learners, "Last_audit".group_activities,
       "Last_audit".learner_assignments,
       "Last_audit".learner_attendance,
       "Last_audit".attendance_module_exclusions,
       "Last_audit".bank_holidays_england_wales,
       fetching_evidence.aptem_cv_contracts_probe,
       fetching_evidence.evidence_items,
       fetching_evidence.learner_evidence,
       structured_manual_activities.activity_ksbs,
       structured_manual_activities.learner_activity_ksbs,
       structured_manual_activities.learner_journal_row_ksbs,
       structured_manual_activities.manual_activity_hours_revision,
       "Coach".coach_calendar_event,
       "Coach".coach_calendar_event_learner_link,
       "Coach".coach_imported_review_instance,
       "Coach".coach_migrated_review_document,
       "Coach".coach_migrated_review_revision,
       "Coach".coach_migrated_review_signature,
       "Coach".coach_migrated_review_template,
       "Coach".review_source_reconciliation
       TO lms_benchmark_reader""",
    """REVOKE EXECUTE ON FUNCTION
       "Coach".refresh_learner_absence_counts(integer,text) FROM PUBLIC""",
]


def _verify_target(cursor) -> None:
    cursor.execute(
        """SELECT current_database(), current_user,
                  current_setting('neon.branch_id', true),
                  current_setting('neon.endpoint_id', true),
                  current_setting('transaction_read_only')"""
    )
    database, role, branch, endpoint, read_only = cursor.fetchone()
    if (database, role, branch, endpoint, read_only) != (
        DATABASE_NAME, OWNER_ROLE, BRANCH_ID, ENDPOINT_ID, "off"
    ):
        raise RuntimeError("Owner connection failed the pinned writable-target check")
    cursor.execute(
        "SELECT count(*) FROM pg_roles WHERE rolname IN (%s,%s)",
        (READER_ROLE, PROVISIONER_ROLE),
    )
    if cursor.fetchone()[0]:
        raise RuntimeError("Phase 4G.2 role already exists; refusing a non-idempotent rerun")


def _negative(reader_dsn: str, statement: str) -> bool:
    try:
        with psycopg.connect(reader_dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement)
            connection.rollback()
    except psycopg.Error:
        return True
    return False


def main() -> int:
    owner_dsn = _owner_dsn()
    password = secrets.token_urlsafe(48)
    reader_dsn = _reader_dsn(owner_dsn, password)
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            _verify_target(cursor)
        connection.rollback()
        with connection.transaction():
            with connection.cursor() as cursor:
                for statement in ROLE_SQL:
                    cursor.execute(statement)
                cursor.execute(
                    sql.SQL("ALTER ROLE lms_benchmark_reader PASSWORD {}")
                    .format(sql.Literal(password))
                )

    checks: dict[str, object] = {}
    with psycopg.connect(reader_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user, current_database(),
                          current_setting('neon.branch_id', true),
                          current_setting('neon.endpoint_id', true),
                          current_setting('transaction_read_only')"""
            )
            identity = cursor.fetchone()
            checks["identity"] = identity == (
                READER_ROLE, DATABASE_NAME, BRANCH_ID, ENDPOINT_ID, "on"
            )
            cursor.execute('SELECT count(*) >= 0 FROM curriculum.modules')
            checks["required_select"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*) FROM pg_auth_members m
                   WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)"""
            )
            checks["memberships_zero"] = cursor.fetchone()[0] == 0
            cursor.execute(
                """SELECT count(*) FROM pg_class c
                   JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname NOT LIKE 'pg_%' AND c.relowner=
                         (SELECT oid FROM pg_roles WHERE rolname=current_user)"""
            )
            checks["ownership_zero"] = cursor.fetchone()[0] == 0
            cursor.execute(
                """SELECT count(*) FROM pg_class c
                   JOIN pg_namespace n ON n.oid=c.relnamespace
                   WHERE n.nspname NOT LIKE 'pg_%' AND c.relkind IN ('r','p')
                     AND (has_table_privilege(current_user,c.oid,'INSERT')
                       OR has_table_privilege(current_user,c.oid,'UPDATE')
                       OR has_table_privilege(current_user,c.oid,'DELETE')
                       OR has_table_privilege(current_user,c.oid,'TRUNCATE'))"""
            )
            checks["application_dml_zero"] = cursor.fetchone()[0] == 0

    checks["insert_denied"] = _negative(
        reader_dsn,
        "INSERT INTO curriculum.programmes SELECT * FROM curriculum.programmes WHERE false",
    )
    checks["update_denied"] = _negative(
        reader_dsn,
        "UPDATE curriculum.programmes SET programme_id=programme_id WHERE false",
    )
    checks["delete_denied"] = _negative(
        reader_dsn, "DELETE FROM curriculum.programmes WHERE false"
    )
    checks["create_denied"] = _negative(
        reader_dsn, "CREATE TABLE phase4g2_reader_must_not_create(id integer)"
    )
    checks["temp_denied"] = _negative(
        reader_dsn, "CREATE TEMP TABLE phase4g2_reader_temp(id integer)"
    )
    checks["create_role_denied"] = _negative(
        reader_dsn, "CREATE ROLE phase4g2_reader_must_not_create_role"
    )
    checks["set_role_denied"] = _negative(reader_dsn, "SET ROLE neondb_owner")
    checks["mutator_denied"] = _negative(
        reader_dsn, 'SELECT "Coach".refresh_learner_absence_counts(NULL,NULL)'
    )
    if not all(checks.values()):
        raise RuntimeError("Reader privilege verification failed: " + json.dumps(checks))
    _write_generic_credential(CREDENTIAL_TARGET, READER_ROLE, reader_dsn)
    print(json.dumps({
        "status": "created-and-verified",
        "branch_id": BRANCH_ID,
        "endpoint_id": ENDPOINT_ID,
        "reader_role": READER_ROLE,
        "provisioner_role": PROVISIONER_ROLE,
        "credential_target": CREDENTIAL_TARGET,
        "checks": checks,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "failed", "error_type": type(exc).__name__}))
        raise
