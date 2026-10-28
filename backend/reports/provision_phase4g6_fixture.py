"""Create and verify the receipt-controlled Phase 4G.6 synthetic fixture.

This is a one-shot, target-pinned helper. Secrets are generated in memory and
stored only in Windows Credential Manager. Output is deliberately sanitised.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import secrets
import sys
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.benchmark_credentials import read_benchmark_reader_url  # noqa: E402


BRANCH_ID = "br-orange-shadow-abm8uwwe"
ENDPOINT_ID = "ep-dawn-block-ab5vob3x"
DATABASE_NAME = "neondb"
OWNER_ROLE = "neondb_owner"
READER_ROLE = "lms_benchmark_reader"
FIXTURE_OWNER_ROLE = "lms_fixture_owner"
PROVISIONER_ROLE = "lms_fixture_provisioner"
DIRECT_HOST = f"{ENDPOINT_ID}.eu-west-2.aws.neon.tech"
POOLED_HOST = f"{ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"
PLAN_PATH = Path(__file__).with_name(
    "phase4g4_fixture_security_definer_not_executed_2026-10-28.sql"
)
PROVISIONER_CREDENTIAL = "LMS_v2/phase4g6/lms_fixture_provisioner"
SESSION_CREDENTIAL = "LMS_v2/phase4g6/synthetic_session"
HANDLE_CREDENTIAL = "LMS_v2/phase4g6/fixture_handle"

TARGET_TABLES = (
    'enrolment."Created_users"',
    '"Learner".learners',
    'login."Login_accounts"',
    'login."Login_sessions"',
    '"Learner".learner_training_plan_modules',
    '"Learner".learner_training_plan_weeks',
    '"Learner".learner_training_plan_components',
    '"Learner".learner_progress_entries',
)
SEQUENCES = {
    'enrolment."Created_users"': 'enrolment."Created_users_id_seq"',
    '"Learner".learners': '"Learner".learners_id_seq',
    'login."Login_accounts"': 'login."Login_accounts_id_seq"',
    'login."Login_sessions"': 'login."Login_sessions_id_seq"',
    '"Learner".learner_training_plan_modules':
        '"Learner".learner_training_plan_modules_id_seq',
    '"Learner".learner_training_plan_weeks':
        '"Learner".learner_training_plan_weeks_id_seq',
    '"Learner".learner_training_plan_components':
        '"Learner".learner_training_plan_components_id_seq',
    '"Learner".learner_progress_entries':
        '"Learner".learner_progress_entries_id_seq',
}
APPLICATION_SCHEMAS = (
    "login", "enrolment", "Learner", "curriculum", "Audit", "Last_audit",
    "fetching_evidence", "structured_manual_activities", "Coach",
    "Engagement", "chat", "public",
)


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
    if (parsed.hostname or "").casefold() not in {DIRECT_HOST, POOLED_HOST}:
        raise RuntimeError("Owner URL is not the pinned endpoint")
    if parsed.path.lstrip("/") != DATABASE_NAME or parsed.username != OWNER_ROLE:
        raise RuntimeError("Owner URL database or role is not the pinned target")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.pop("options", None)
    query["sslmode"] = "require"
    return urlunsplit((
        parsed.scheme,
        parsed.netloc.replace(POOLED_HOST, DIRECT_HOST),
        parsed.path,
        urlencode(query),
        "",
    ))


def _role_dsn(owner_dsn: str, role: str, password: str) -> str:
    parsed = urlsplit(owner_dsn)
    port = f":{parsed.port}" if parsed.port else ""
    netloc = (
        f"{quote(role, safe='')}:{quote(password, safe='')}@"
        f"{parsed.hostname}{port}"
    )
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["sslmode"] = "require"
    return urlunsplit(
        (parsed.scheme, netloc, parsed.path, urlencode(query, quote_via=quote), "")
    )


def _write_credential(target: str, username: str, secret: str, comment: str) -> None:
    if os.name != "nt":
        raise RuntimeError("Windows Credential Manager is required")
    blob = secret.encode("utf-16-le")
    if len(blob) > 5 * 512:
        raise RuntimeError("Credential payload is too large")
    buffer = ctypes.create_string_buffer(blob)
    credential = _Credential()
    credential.Type = 1
    credential.TargetName = target
    credential.Comment = comment
    credential.CredentialBlobSize = len(blob)
    credential.CredentialBlob = ctypes.cast(
        buffer, ctypes.POINTER(ctypes.c_ubyte)
    )
    credential.Persist = 2
    credential.UserName = username
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(_Credential), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    if not advapi32.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def _verify_target(cursor) -> None:
    cursor.execute(
        """SELECT current_database(),current_user,
                  current_setting('neon.branch_id',true),
                  current_setting('neon.endpoint_id',true),
                  current_setting('transaction_read_only')"""
    )
    if cursor.fetchone() != (
        DATABASE_NAME, OWNER_ROLE, BRANCH_ID, ENDPOINT_ID, "off"
    ):
        raise RuntimeError("Owner connection failed the exact writable-target guard")
    cursor.execute(
        """SELECT to_regnamespace('benchmark_admin') IS NULL,
                  to_regrole(%s) IS NULL,to_regrole(%s) IS NULL,
                  to_regrole(%s) IS NOT NULL""",
        (FIXTURE_OWNER_ROLE, PROVISIONER_ROLE, READER_ROLE),
    )
    if cursor.fetchone() != (True, True, True, True):
        raise RuntimeError("Fixture objects are not absent or Reader is missing")
    cursor.execute(
        """SELECT
          (SELECT count(*) FROM enrolment."Created_users"
           WHERE "Programme" LIKE 'phase4g_%%'
              OR lower(coalesce("Email",'')) LIKE 'phase4g_%%@example.invalid'),
          (SELECT count(*) FROM "Learner".learners
           WHERE programme LIKE 'phase4g_%%'
              OR lower(email) LIKE 'phase4g_%%@example.invalid'),
          (SELECT count(*) FROM login."Login_accounts"
           WHERE lower("Email") LIKE 'phase4g_%%@example.invalid')"""
    )
    if cursor.fetchone() != (0, 0, 0):
        raise RuntimeError("An existing Phase 4G fixture or namespace was found")


def _verify_resume_target(cursor) -> None:
    cursor.execute(
        """SELECT current_database(),current_user,
                  current_setting('neon.branch_id',true),
                  current_setting('neon.endpoint_id',true),
                  current_setting('transaction_read_only')"""
    )
    if cursor.fetchone() != (
        DATABASE_NAME, OWNER_ROLE, BRANCH_ID, ENDPOINT_ID, "off"
    ):
        raise RuntimeError("Resume connection failed the exact writable-target guard")
    cursor.execute(
        """SELECT to_regnamespace('benchmark_admin') IS NOT NULL,
                  to_regrole(%s) IS NOT NULL,to_regrole(%s) IS NOT NULL,
                  to_regrole(%s) IS NOT NULL,
                  (SELECT count(*) FROM benchmark_admin.fixture_receipts),
                  (SELECT count(*) FROM enrolment."Created_users"
                   WHERE "Programme" LIKE 'phase4g_%%')""",
        (FIXTURE_OWNER_ROLE, PROVISIONER_ROLE, READER_ROLE),
    )
    if cursor.fetchone() != (True, True, True, True, 0, 0):
        raise RuntimeError("Resume requires exact empty Phase 4G.6 DDL state")


def _validate_plan(cursor, plan: str) -> dict[str, int]:
    required_fragments = (
        "CREATE ROLE lms_fixture_owner NOLOGIN",
        "CREATE ROLE lms_fixture_provisioner LOGIN PASSWORD :'provisioner_password'",
        "CREATE SCHEMA benchmark_admin",
        "SECURITY DEFINER",
        "SET search_path = pg_catalog",
        "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA benchmark_admin FROM PUBLIC",
        "'fixture_id', v_receipt_id",
        "'cleanup_verification', jsonb_build_object(",
        "RAISE EXCEPTION 'Fixture cleanup residue assertion failed'",
        "RAISE EXCEPTION 'Fixture progress identity range collides with existing rows'",
    )
    if any(fragment not in plan for fragment in required_fragments):
        raise RuntimeError("Fixture plan is missing a required security control")
    if plan.count(":'provisioner_password'") != 1:
        raise RuntimeError("Provisioner password placeholder is unexpected")
    if plan.count("SECURITY DEFINER") != 2:
        raise RuntimeError("Fixture plan must contain exactly two definer functions")
    if len(re.findall(
        r"SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*pg_catalog",
        plan,
        flags=re.IGNORECASE,
    )) != 2:
        raise RuntimeError("Fixture functions do not both pin search_path")
    executable = "\n".join(
        line for line in plan.splitlines() if not line.lstrip().startswith("--")
    ).upper()
    for forbidden in ("TRUNCATE ", " CASCADE", "DISABLE TRIGGER", "DROP TABLE"):
        if forbidden in executable:
            raise RuntimeError(f"Forbidden fixture SQL token: {forbidden.strip()}")

    identifier = r'(?:(?:"[^"]+")|(?:[A-Za-z_][A-Za-z0-9_]*))'
    objects = set(re.findall(rf'{identifier}\.{identifier}', plan))
    allowed_schemas = set(APPLICATION_SCHEMAS)
    dependencies = sorted(
        obj for obj in objects
        if obj.split(".", 1)[0].strip('"') in allowed_schemas
    )
    missing = []
    for obj in dependencies:
        cursor.execute("SELECT to_regclass(%s)", (obj,))
        if cursor.fetchone()[0] is None:
            missing.append(obj)
    if missing:
        raise RuntimeError("Fixture dependency relation is missing")

    insert_pattern = re.compile(
        rf'INSERT\s+INTO\s+({identifier}\.{identifier})\s*\((.*?)\)\s*'
        r'(?:VALUES|SELECT)',
        re.IGNORECASE | re.DOTALL,
    )
    required_columns: dict[str, set[str]] = {}
    for relation, columns in insert_pattern.findall(plan):
        if relation.startswith("benchmark_admin."):
            continue
        required_columns.setdefault(relation, set()).update(
            column.strip().strip('"') for column in columns.split(",")
        )
    extras = {
        'enrolment."Created_users"': {"id", "learner_id"},
        '"Learner".learners': {"id", "enrolment_id"},
        'login."Login_accounts"': {"id"},
        'login."Login_sessions"': {"id"},
        '"Learner".learner_training_plan_modules': {"id", "learner_id"},
        '"Learner".learner_training_plan_weeks': {"id", "plan_module_id"},
        '"Learner".learner_training_plan_components': {"id", "plan_week_id"},
        '"Learner".learner_progress_entries': {"id", "learner_id"},
    }
    for relation, columns in extras.items():
        required_columns.setdefault(relation, set()).update(columns)
    checked_columns = 0
    for relation, columns in required_columns.items():
        schema_name, table_name = [part.strip('"') for part in relation.split(".", 1)]
        for column in columns:
            cursor.execute(
                """SELECT is_generated FROM information_schema.columns
                   WHERE table_schema=%s AND table_name=%s AND column_name=%s""",
                (schema_name, table_name, column),
            )
            row = cursor.fetchone()
            if row is None:
                raise RuntimeError("Fixture required column is missing")
            if row[0] != "NEVER":
                raise RuntimeError("Fixture plan writes a generated column")
            checked_columns += 1

    for relation, expected_sequence in SEQUENCES.items():
        cursor.execute("SELECT pg_get_serial_sequence(%s,'id')::regclass::text", (relation,))
        if cursor.fetchone()[0] != expected_sequence:
            raise RuntimeError("Fixture identity sequence does not match the plan")

    cursor.execute(
        """WITH targets(rel) AS (SELECT unnest(%s::regclass[]))
           SELECT count(*) FILTER(WHERE conrelid IN(SELECT rel FROM targets)),
                  count(*) FILTER(WHERE confrelid IN(SELECT rel FROM targets)
                    AND conrelid NOT IN(SELECT rel FROM targets))
           FROM pg_constraint WHERE contype='f' AND
             (conrelid IN(SELECT rel FROM targets)
              OR confrelid IN(SELECT rel FROM targets))""",
        (list(TARGET_TABLES),),
    )
    outbound_fks, inbound_fks = cursor.fetchone()
    cursor.execute(
        """SELECT count(*),bool_and(NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
           FROM pg_class c WHERE c.oid=ANY(%s::regclass[])""",
        (list(TARGET_TABLES),),
    )
    target_count, no_rls = cursor.fetchone()
    if target_count != 8 or not no_rls:
        raise RuntimeError("Fixture targets changed or gained RLS")
    cursor.execute(
        """SELECT count(*) FROM pg_trigger
           WHERE NOT tgisinternal AND tgrelid=ANY(%s::regclass[])""",
        (list(TARGET_TABLES),),
    )
    trigger_count = cursor.fetchone()[0]
    if trigger_count != 3:
        raise RuntimeError("Fixture target trigger inventory changed")
    return {
        "dependency_relations": len(dependencies),
        "required_columns": checked_columns,
        "outbound_foreign_keys": outbound_fks,
        "inbound_external_foreign_keys": inbound_fks,
        "target_triggers": trigger_count,
    }


def _denied(dsn: str, statement: str, params=None) -> bool:
    try:
        with psycopg.connect(dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement, params)
            connection.rollback()
    except psycopg.Error:
        return True
    return False


def _verify_created_security(owner_dsn: str, provisioner_dsn: str) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT bool_and(NOT rolsuper AND NOT rolcreatedb
                          AND NOT rolcreaterole AND NOT rolinherit
                          AND NOT rolreplication AND NOT rolbypassrls)
                   FROM pg_roles WHERE rolname IN (%s,%s)""",
                (FIXTURE_OWNER_ROLE, PROVISIONER_ROLE),
            )
            checks["role_flags_restricted"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_auth_members m
                   JOIN pg_roles r ON r.oid=m.member
                   WHERE r.rolname IN (%s,%s)""",
                (FIXTURE_OWNER_ROLE, PROVISIONER_ROLE),
            )
            checks["memberships_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n
                   ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s)
                   AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=%s)""",
                (list(APPLICATION_SCHEMAS), FIXTURE_OWNER_ROLE),
            )
            checks["owner_has_no_application_ownership"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_class c JOIN pg_namespace n
                   ON n.oid=c.relnamespace
                   WHERE n.nspname=ANY(%s)
                     AND c.relkind IN ('r','p','v','m','f')
                     AND (has_table_privilege(%s,c.oid,'INSERT')
                       OR has_table_privilege(%s,c.oid,'UPDATE')
                       OR has_table_privilege(%s,c.oid,'DELETE')
                       OR has_table_privilege(%s,c.oid,'TRUNCATE'))""",
                (list(APPLICATION_SCHEMAS), *([PROVISIONER_ROLE] * 4)),
            )
            checks["provisioner_application_dml_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_namespace
                   WHERE has_schema_privilege(%s,oid,'CREATE')""",
                (PROVISIONER_ROLE,),
            )
            checks["provisioner_schema_create_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=2 FROM pg_proc p JOIN pg_namespace n
                     ON n.oid=p.pronamespace
                   WHERE n.nspname NOT LIKE 'pg_%%' AND n.nspname<>'information_schema'
                     AND has_schema_privilege(%s,n.oid,'USAGE')
                     AND has_function_privilege(%s,p.oid,'EXECUTE')""",
                (PROVISIONER_ROLE, PROVISIONER_ROLE),
            )
            checks["only_two_callable_application_functions"] = bool(
                cursor.fetchone()[0]
            )
            cursor.execute(
                """SELECT count(*)=2 AND bool_and(p.prosecdef)
                          AND bool_and(p.proconfig @> ARRAY['search_path=pg_catalog'])
                          AND bool_and(pg_get_userbyid(p.proowner)=%s)
                          AND bool_and(has_function_privilege(%s,p.oid,'EXECUTE'))
                   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                   WHERE n.nspname='benchmark_admin'""",
                (FIXTURE_OWNER_ROLE, PROVISIONER_ROLE),
            )
            checks["definer_functions_exact"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_proc p JOIN pg_namespace n
                     ON n.oid=p.pronamespace
                   CROSS JOIN LATERAL aclexplode(
                     COALESCE(p.proacl,acldefault('f',p.proowner))) a
                   WHERE n.nspname='benchmark_admin' AND a.grantee=0
                     AND a.privilege_type='EXECUTE'"""
            )
            checks["public_function_execute_zero"] = bool(cursor.fetchone()[0])
        connection.rollback()

    with psycopg.connect(provisioner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user,current_database(),
                   current_setting('neon.branch_id',true),
                   current_setting('neon.endpoint_id',true),
                   current_setting('search_path'),
                   has_database_privilege(current_user,current_database(),'TEMP')"""
            )
            checks["provisioner_identity_exact"] = cursor.fetchone() == (
                PROVISIONER_ROLE, DATABASE_NAME, BRANCH_ID, ENDPOINT_ID,
                "pg_catalog", False,
            )
        connection.rollback()

    checks["direct_insert_denied"] = _denied(
        provisioner_dsn,
        'INSERT INTO enrolment."Created_users" '
        'SELECT * FROM enrolment."Created_users" WHERE false',
    )
    checks["create_denied"] = _denied(
        provisioner_dsn, "CREATE TABLE phase4g6_forbidden(id integer)"
    )
    checks["temp_denied"] = _denied(
        provisioner_dsn, "CREATE TEMP TABLE phase4g6_forbidden(id integer)"
    )
    checks["set_role_denied"] = _denied(
        provisioner_dsn, f"SET ROLE {FIXTURE_OWNER_ROLE}"
    )
    checks["endpoint_override_denied"] = _denied(
        provisioner_dsn, "SET neon.endpoint_id='wrong-endpoint'"
    )
    checks["invalid_provision_denied"] = _denied(
        provisioner_dsn,
        "SELECT benchmark_admin.provision_phase4g_fixture(%s,%s,"
        "clock_timestamp()+interval '75 minutes')",
        ("invalid", "0" * 64),
    )
    if not all(checks.values()):
        raise RuntimeError("Created fixture security controls failed verification")
    return checks


def _verify_fixture(owner_dsn: str, reader_dsn: str, receipt: dict) -> dict[str, object]:
    ids = {key: int(receipt[key]) for key in (
        "enrolment_id", "learner_id", "account_id", "session_id",
        "module_id", "week_id", "component_id",
    )}
    progress_ids = [int(value) for value in receipt["progress_ids"]]
    if (
        receipt.get("fixture_id") != receipt.get("receipt_id")
        or receipt.get("application_rows") != 364
        or receipt.get("control_rows") != 1
        or len(progress_ids) != 357
        or len(set(progress_ids)) != 357
        or receipt.get("branch_id") != BRANCH_ID
        or receipt.get("endpoint_id") != ENDPOINT_ID
        or receipt.get("database") != DATABASE_NAME
    ):
        raise RuntimeError("Provision receipt failed structural validation")

    checks: dict[str, object] = {}
    with psycopg.connect(reader_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user,current_database(),
                   current_setting('neon.branch_id',true),
                   current_setting('neon.endpoint_id',true),
                   current_setting('transaction_read_only')"""
            )
            checks["reader_identity_exact"] = cursor.fetchone() == (
                READER_ROLE, DATABASE_NAME, BRANCH_ID, ENDPOINT_ID, "on"
            )
            cursor.execute(
                """SELECT
                 (SELECT count(*) FROM enrolment."Created_users" WHERE id=%s),
                 (SELECT count(*) FROM "Learner".learners WHERE id=%s AND enrolment_id=%s),
                 (SELECT count(*) FROM login."Login_accounts" WHERE id=%s
                    AND "Subject_type"='learner' AND "Subject_id"=%s),
                 (SELECT count(*) FROM login."Login_sessions" WHERE id=%s AND "Account_id"=%s),
                 (SELECT count(*) FROM "Learner".learner_training_plan_modules WHERE id=%s AND learner_id=%s),
                 (SELECT count(*) FROM "Learner".learner_training_plan_weeks WHERE id=%s AND plan_module_id=%s),
                 (SELECT count(*) FROM "Learner".learner_training_plan_components WHERE id=%s AND plan_week_id=%s),
                 (SELECT count(*) FROM "Learner".learner_progress_entries
                    WHERE id=ANY(%s) AND learner_id=%s AND plan_component_id=%s)""",
                (
                    ids["enrolment_id"], ids["learner_id"], ids["enrolment_id"],
                    ids["account_id"], ids["enrolment_id"],
                    ids["session_id"], ids["account_id"],
                    ids["module_id"], ids["learner_id"],
                    ids["week_id"], ids["module_id"],
                    ids["component_id"], ids["week_id"],
                    progress_ids, ids["learner_id"], ids["component_id"],
                ),
            )
            checks["application_row_counts"] = list(cursor.fetchone())
        connection.rollback()
    if checks["application_row_counts"] != [1, 1, 1, 1, 1, 1, 1, 357]:
        raise RuntimeError("Fixture application inventory is not exact")

    namespace = receipt["namespace"]
    email = namespace + "@example.invalid"
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT count(*) FROM benchmark_admin.fixture_receipts
                   WHERE receipt_id=%s AND namespace=%s AND payload=%s""",
                (receipt["receipt_id"], namespace, Jsonb(receipt)),
            )
            checks["receipt_exact"] = cursor.fetchone()[0] == 1
            cursor.execute(
                """SELECT
                 (SELECT count(*) FROM "Engagement".shared_reward_outbox WHERE progress_id=ANY(%s)),
                 (SELECT count(*) FROM "Engagement".shared_reward_saved_progress WHERE progress_id=ANY(%s)),
                 (SELECT count(*) FROM login."Login_audit" WHERE "Account_id"=%s OR lower("Email")=lower(%s)),
                 (SELECT count(*) FROM login."Invitations" WHERE "Account_id"=%s OR lower("Email")=lower(%s)),
                 (SELECT count(*) FROM login."Password_resets" WHERE "Account_id"=%s OR lower("Email")=lower(%s)),
                 (SELECT count(*) FROM fetching_evidence.platform_read_model_outbox
                    WHERE scope_id IN (%s,%s) OR payload::text LIKE %s),
                 (SELECT count(*) FROM public.platform_read_model_outbox
                    WHERE scope_id IN (%s,%s) OR payload::text LIKE %s),
                 (SELECT count(*) FROM "Learner".learner_progress_entries
                    WHERE id=ANY(%s) AND kbc_attendance_key IS NOT NULL)""",
                (
                    progress_ids, progress_ids,
                    ids["account_id"], email, ids["account_id"], email,
                    ids["account_id"], email,
                    str(ids["enrolment_id"]), str(ids["learner_id"]), f"%{namespace}%",
                    str(ids["enrolment_id"]), str(ids["learner_id"]), f"%{namespace}%",
                    progress_ids,
                ),
            )
            checks["unexpected_side_effect_counts"] = list(cursor.fetchone())
        connection.rollback()
    if not checks["receipt_exact"] or any(checks["unexpected_side_effect_counts"]):
        raise RuntimeError("Fixture receipt or trigger containment verification failed")
    return checks


def _cleanup_rehearsal(
    provisioner_dsn: str, reader_dsn: str, receipt: dict
) -> dict[str, bool]:
    checks: dict[str, bool] = {}
    try:
        with psycopg.connect(provisioner_dsn) as connection:
            with connection.cursor() as cursor:
                # The receipt validator inspects every inbound FK before it
                # deletes anything.  On the full Neon snapshot that bounded
                # catalog/data check takes about 86 seconds; keep the role's
                # 30-second default for provisioning and raise it only for
                # this rollback-only cleanup rehearsal transaction.
                cursor.execute("SET LOCAL statement_timeout = '120s'")
                cursor.execute(
                    "SELECT benchmark_admin.cleanup_phase4g_fixture(%s)",
                    (Jsonb(receipt),),
                )
                result = cursor.fetchone()[0]
                checks["valid_cleanup_exact_counts"] = (
                    result.get("deleted_application_rows") == 364
                    and result.get("deleted_control_rows") == 1
                )
            connection.rollback()
    except psycopg.Error:
        checks["valid_cleanup_exact_counts"] = False
    checks["invalid_receipt_denied"] = _denied(
        provisioner_dsn,
        "SELECT benchmark_admin.cleanup_phase4g_fixture(%s)",
        (Jsonb({}),),
    )
    changed = dict(receipt)
    changed["namespace"] = "phase4g_00000000-0000-0000-0000-000000000000"
    checks["altered_receipt_denied"] = _denied(
        provisioner_dsn,
        "SELECT benchmark_admin.cleanup_phase4g_fixture(%s)",
        (Jsonb(changed),),
    )
    checks["wrong_role_denied"] = _denied(
        reader_dsn,
        "SELECT benchmark_admin.cleanup_phase4g_fixture(%s)",
        (Jsonb(receipt),),
    )
    with psycopg.connect(reader_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT count(*) FROM "Learner".learner_progress_entries '
                'WHERE id=ANY(%s)',
                ([int(value) for value in receipt["progress_ids"]],),
            )
            checks["active_fixture_retained"] = cursor.fetchone()[0] == 357
        connection.rollback()
    if not all(checks.values()):
        raise RuntimeError("Cleanup safety rehearsal failed")
    return checks


def main() -> int:
    plan = PLAN_PATH.read_text(encoding="utf-8")
    owner_dsn = _owner_dsn()
    reader_dsn = read_benchmark_reader_url()
    provisioner_password = secrets.token_urlsafe(48)
    provisioner_dsn = _role_dsn(owner_dsn, PROVISIONER_ROLE, provisioner_password)
    namespace = "phase4g_" + str(uuid4())
    session_token = secrets.token_urlsafe(32)
    token_hash = sha256(session_token.encode("utf-8")).hexdigest()

    resume_existing_ddl = "--resume-existing-ddl" in sys.argv[1:]
    replace_provision_function = "--replace-provision-function" in sys.argv[1:]
    install_guard_only = "--install-guard-only" in sys.argv[1:]
    if install_guard_only and not (
        resume_existing_ddl and replace_provision_function
    ):
        raise RuntimeError(
            "--install-guard-only requires --resume-existing-ddl and "
            "--replace-provision-function"
        )
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            if resume_existing_ddl:
                _verify_resume_target(cursor)
            else:
                _verify_target(cursor)
            plan_evidence = _validate_plan(cursor, plan)
            password_literal = sql.Literal(provisioner_password).as_string(connection)
            rendered = plan.replace(":'provisioner_password'", password_literal)
            rendered = re.sub(r"(?mi)^\s*(BEGIN|COMMIT)\s*;\s*$", "", rendered)
        connection.rollback()
        with connection.transaction():
            with connection.cursor() as cursor:
                if resume_existing_ddl:
                    if replace_provision_function:
                        start = plan.index(
                            "CREATE FUNCTION benchmark_admin.provision_phase4g_fixture("
                        )
                        end = plan.index(
                            "CREATE FUNCTION benchmark_admin.cleanup_phase4g_fixture("
                        )
                        replacement = plan[start:end].strip().replace(
                            "CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1
                        )
                        cursor.execute(
                            f"GRANT {FIXTURE_OWNER_ROLE} TO {OWNER_ROLE}"
                        )
                        cursor.execute(f"SET LOCAL ROLE {FIXTURE_OWNER_ROLE}")
                        cursor.execute(replacement, prepare=False)
                        cursor.execute("RESET ROLE")
                        cursor.execute(
                            f"REVOKE {FIXTURE_OWNER_ROLE} FROM {OWNER_ROLE}"
                        )
                    cursor.execute(
                        sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                            sql.Identifier(PROVISIONER_ROLE),
                            sql.Literal(provisioner_password),
                        )
                    )
                else:
                    cursor.execute(rendered, prepare=False)

    if install_guard_only:
        security_checks = _verify_created_security(owner_dsn, provisioner_dsn)
        _write_credential(
            PROVISIONER_CREDENTIAL,
            PROVISIONER_ROLE,
            provisioner_dsn,
            "LMS Phase 4G.6 restricted fixture provisioner DSN",
        )
        print(json.dumps({
            "status": "fixture-collision-guard-installed",
            "branch_id": BRANCH_ID,
            "endpoint_id": ENDPOINT_ID,
            "database": DATABASE_NAME,
            "security_checks": security_checks,
            "fixture_created": False,
        }, sort_keys=True))
        return 0

    security_checks = _verify_created_security(owner_dsn, provisioner_dsn)
    _write_credential(
        PROVISIONER_CREDENTIAL,
        PROVISIONER_ROLE,
        provisioner_dsn,
        "LMS Phase 4G.6 restricted fixture provisioner DSN",
    )
    _write_credential(
        SESSION_CREDENTIAL,
        namespace,
        json.dumps({"namespace": namespace, "token": session_token}),
        "LMS Phase 4G.6 synthetic Learner session token",
    )

    with psycopg.connect(provisioner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT benchmark_admin.provision_phase4g_fixture("
                "%s,%s,clock_timestamp()+interval '75 minutes')",
                (namespace, token_hash),
            )
            receipt = cursor.fetchone()[0]
        connection.commit()

    fixture_checks = _verify_fixture(owner_dsn, reader_dsn, receipt)
    cleanup_checks = _cleanup_rehearsal(provisioner_dsn, reader_dsn, receipt)
    handle = {
        key: receipt[key] for key in (
            "fixture_id", "receipt_id", "namespace", "enrolment_id",
            "learner_id", "account_id", "session_id",
        )
    }
    _write_credential(
        HANDLE_CREDENTIAL,
        namespace,
        json.dumps(handle, sort_keys=True, default=str),
        "LMS Phase 4G.6 receipt handle; full receipt remains in PostgreSQL",
    )

    print(json.dumps({
        "status": "fixture-created-and-verified",
        "branch_id": BRANCH_ID,
        "endpoint_id": ENDPOINT_ID,
        "database": DATABASE_NAME,
        "namespace": namespace,
        "application_rows": receipt["application_rows"],
        "control_rows": receipt["control_rows"],
        "progress_rows": len(receipt["progress_ids"]),
        "plan_evidence": plan_evidence,
        "security_checks": security_checks,
        "fixture_checks": fixture_checks,
        "cleanup_checks": cleanup_checks,
        "credential_targets": [
            PROVISIONER_CREDENTIAL, SESSION_CREDENTIAL, HANDLE_CREDENTIAL,
        ],
        "raw_session_token_printed": False,
        "fixture_retained": True,
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
