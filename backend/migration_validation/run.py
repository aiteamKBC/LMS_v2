"""Opt-in PMA-G1B runner for an explicitly approved disposable Neon branch.

This module is deliberately not used by normal Django commands.  It never
reads project .env files or DATABASE_URL values.  Invocation is documented in
PMA-G1B-PREP and remains prohibited until all approval fields are supplied.
"""

import argparse
import certifi
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
from urllib.request import Request, urlopen

from .safety import (
    ApprovedTarget,
    Refused,
    ROLLBACK_TARGETS,
    ledger_digest,
    parse_target,
    verify_live_identity,
)


EXECUTION_PHRASE = "I_UNDERSTAND_THIS_WRITES_ONLY_TO_THE_APPROVED_DISPOSABLE_BRANCH"
SESSION_OPTIONS = (
    "-c lock_timeout=5000 "
    "-c statement_timeout=300000 "
    "-c idle_in_transaction_session_timeout=60000"
)
DATABASE_ENV_NAMES = frozenset({
    "DATABASE_URL", "DATABASEURL", "Database_url", "ENROLMENT_DATABASE_URL",
    "NEW_ENDPOINT_URL", "PGDATABASE", "PGHOST", "PGHOSTADDR", "PGPASSWORD",
    "PGPORT", "PGSERVICE", "PGSERVICEFILE", "PGUSER", "AUDIT_DATABASE_URL",
    "AUDIT_CLONE_DATABASE_URL", "LASR-ADUTIOD-CLNE", "KBC_ATTENDANCE_DATABASE_URL",
    "security_Database_url", "COACHING_SESSIONS_DATABASE_URL",
    "SAFEGUARDING_DATABASE_URL", "SafeGuarding_database_url",
    "ASSESSMENT_FETCH_DATABASE_URL", "SOURCE_DATABASE_URL", "FK_TEST_DATABASE_URL",
})
EXTERNAL_ENV_NAMES = frozenset({
    "CACHE_URL", "REDIS_URL", "CELERY_BROKER_URL", "EVIDENCE_AUDIT_SERVICE_URL",
})


def _json_get(url, api_key):
    request = Request(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
    )
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def provider_metadata(target, api_key):
    base = f"https://console.neon.tech/api/v2/projects/{target.project_id}"
    return (
        _json_get(base, api_key),
        _json_get(f"{base}/branches/{target.branch_id}", api_key),
        _json_get(f"{base}/endpoints/{target.endpoint_id}", api_key),
    )


def verify_provider_attestation(target, payload, *, now=None):
    if not isinstance(payload, dict) or set(payload) != {
        "verified_at", "project", "branch", "endpoint"
    }:
        raise Refused("Provider attestation fields are incomplete or unexpected")
    try:
        verified_at = datetime.fromisoformat(payload["verified_at"])
    except (TypeError, ValueError) as error:
        raise Refused("Provider attestation timestamp is invalid") from error
    if verified_at.tzinfo is None:
        raise Refused("Provider attestation timestamp has no timezone")
    observed_now = now or datetime.now(timezone.utc)
    age = observed_now - verified_at.astimezone(timezone.utc)
    if age < timedelta(seconds=-30) or age > timedelta(minutes=5):
        raise Refused("Provider attestation is outside the five-minute execution window")
    target.verify_metadata(payload["project"], payload["branch"], payload["endpoint"])


def _disable_integrations():
    prefixes = ("AZURE_", "MS_GRAPH_", "MICROSOFT_", "TEAMS_", "SENDGRID_", "SMTP_")
    for name in tuple(os.environ):
        if name.startswith(prefixes) or name in DATABASE_ENV_NAMES or name in EXTERNAL_ENV_NAMES:
            os.environ.pop(name, None)
    os.environ["EMAIL_BACKEND"] = "django.core.mail.backends.locmem.EmailBackend"
    os.environ["CELERY_TASK_ALWAYS_EAGER"] = "false"


class TransportGuard:
    """Deny application I/O, opening only the explicit DB-connect window."""

    def __init__(self):
        self._database_connect_window = False

    def allow_database_connect(self):
        self._database_connect_window = True

    def lock_down(self):
        self._database_connect_window = False

    def __call__(self, event, args):
        # Python and Django may create local socket pairs for an asyncio
        # self-pipe. Those never leave the process and are not transports.
        # Gate only outbound resolution/connect events so the runner remains
        # fail-closed without breaking local runtime initialization.
        if event in {"socket.getaddrinfo", "socket.connect"}:
            if self._database_connect_window:
                return
            raise Refused("External transports are disabled during migration execution")
        if event in {"subprocess.Popen", "os.system"}:
            raise Refused("Subprocesses are disabled during migration execution")
        if event == "open" and Path(str(args[0])).name.lower().startswith(".env"):
            raise Refused("Environment files are forbidden in the migration runner")


def _database_config(target, password):
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": target.database,
        "USER": target.role,
        "PASSWORD": password,
        "HOST": target.endpoint_host,
        "PORT": "5432",
        "CONN_MAX_AGE": 0,
        "OPTIONS": {
            "sslmode": "verify-full",
            # libpq's Windows `system` trust-store mode did not accept the
            # direct Neon endpoint chain in this environment.  Use the pinned
            # Mozilla bundle already shipped with the backend instead; this
            # retains CA and hostname verification rather than weakening TLS.
            "sslrootcert": certifi.where(),
            "channel_binding": "require",
            "connect_timeout": 10,
            "options": SESSION_OPTIONS,
        },
    }


def _validate_report_destination(path):
    path = Path(path).resolve()
    if path.suffix.lower() != ".json" or not path.parent.is_dir():
        raise Refused("Report destination must be a JSON file in an existing directory")
    if path.exists():
        raise Refused("Report destination already exists; refusing to overwrite it")
    return path


def _write_report(path, payload):
    # Exclusive creation closes the check/write race and preserves previous
    # validation evidence if an operator accidentally reuses a report path.
    with Path(path).open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, sort_keys=True)
        stream.write("\n")


def _read_ledger(cursor):
    cursor.execute("SELECT app, name FROM django_migrations ORDER BY app, name")
    return cursor.fetchall()


def _catalog_snapshot(cursor):
    cursor.execute(
        """
        SELECT n.nspname, c.relname, c.relkind
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname IN ('Learner', 'Coach', 'Feedback', 'public')
           AND c.relkind IN ('r', 'p', 'v', 'm')
         ORDER BY n.nspname, c.relname
        """
    )
    relations = [list(row) for row in cursor.fetchall()]
    cursor.execute(
        """
        SELECT n.nspname, t.relname, con.conname, con.contype, con.convalidated,
               pg_get_constraintdef(con.oid, true)
          FROM pg_constraint con
          JOIN pg_class t ON t.oid = con.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname IN ('Learner', 'Coach', 'Feedback', 'public')
         ORDER BY n.nspname, t.relname, con.conname
        """
    )
    constraints = [list(row) for row in cursor.fetchall()]
    return {"relations": relations, "constraints": constraints}


def _relation_exists(cursor, qualified_name):
    cursor.execute("SELECT to_regclass(%s) IS NOT NULL", [qualified_name])
    return bool(cursor.fetchone()[0])


def _bounded_integrity(cursor):
    counts = {}
    if (_relation_exists(cursor, '"Learner".progress_transfer_requests')
            and _relation_exists(cursor, '"Learner".progress_transfer_items')):
        cursor.execute(
            """
            SELECT
              (SELECT count(*) FROM (
                 SELECT id, enrolment_id FROM "Learner".progress_transfer_requests
                 GROUP BY id, enrolment_id HAVING count(*) > 1
              ) d),
              (SELECT count(*) FROM "Learner".progress_transfer_items i
                 JOIN "Learner".progress_transfer_requests r ON r.id = i.request_id
                WHERE r.enrolment_id IS DISTINCT FROM i.enrolment_id),
              (SELECT count(*) FROM "Learner".progress_transfer_items i
                 LEFT JOIN "Learner".progress_transfer_requests r ON r.id = i.request_id
                WHERE r.id IS NULL)
            """
        )
        duplicate, mismatch, orphan = cursor.fetchone()
        counts.update(
            learner_parent_duplicates=duplicate,
            learner_enrolment_mismatches=mismatch,
            learner_request_orphans=orphan,
        )
    if _relation_exists(cursor, '"Coach".coach_migrated_review_revision'):
        cursor.execute(
            """
            SELECT
              (SELECT count(*) FROM (
                 SELECT overlay_id, number FROM "Coach".coach_migrated_review_revision
                 GROUP BY overlay_id, number HAVING count(*) > 1
              ) d),
              (SELECT count(*) FROM "Coach".coach_migrated_review_revision WHERE number < 1)
            """
        )
        duplicate, nonpositive = cursor.fetchone()
        counts.update(coach_revision_duplicates=duplicate, coach_nonpositive_revisions=nonpositive)
    if _relation_exists(cursor, '"Feedback".feedback_delivery_questions'):
        cursor.execute(
            """
            SELECT
              (SELECT count(*) FROM (
                 SELECT delivery_id, question_id FROM "Feedback".feedback_delivery_questions
                 GROUP BY delivery_id, question_id HAVING count(*) > 1
              ) d),
              (SELECT count(*) FROM "Feedback".feedback_delivery_questions q
                 LEFT JOIN "Feedback".feedback_deliveries d ON d.id = q.delivery_id
                WHERE d.id IS NULL),
              (SELECT count(*) FROM "Feedback".feedback_delivery_questions q
                 LEFT JOIN "Feedback".feedback_questions f ON f.id = q.question_id
                WHERE f.id IS NULL)
            """
        )
        duplicate, delivery_orphan, question_orphan = cursor.fetchone()
        counts.update(
            feedback_question_duplicates=duplicate,
            feedback_delivery_orphans=delivery_orphan,
            feedback_question_orphans=question_orphan,
        )
    return {name: int(value) for name, value in sorted(counts.items())}


def _assert_zero_integrity(counts):
    failures = {name: value for name, value in counts.items() if value != 0}
    if failures:
        raise Refused(f"Bounded integrity precondition failed: {sorted(failures)}")


def _verify_session_settings(cursor):
    cursor.execute(
        "SELECT current_setting('lock_timeout'), "
        "current_setting('statement_timeout'), "
        "current_setting('idle_in_transaction_session_timeout')"
    )
    if tuple(cursor.fetchone() or ()) != ("5s", "5min", "1min"):
        raise Refused("Migration session timeouts do not match the guarded runner")


def _verify_execution_quiescence(cursor):
    cursor.execute(
        """
        SELECT count(*) FILTER (WHERE pid <> pg_backend_pid()),
               count(*) FILTER (
                   WHERE pid <> pg_backend_pid() AND state = 'active'
               ),
               count(*) FILTER (
                   WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
               )
          FROM pg_stat_activity
         WHERE datname = current_database() AND backend_type = 'client backend'
        """
    )
    sessions = tuple(int(value) for value in (cursor.fetchone() or ()))
    cursor.execute(
        "SELECT count(*) FROM pg_locks "
        "WHERE NOT granted AND pid IS DISTINCT FROM pg_backend_pid()"
    )
    ungranted_locks = int(cursor.fetchone()[0])
    if sessions != (0, 0, 0) or ungranted_locks != 0:
        raise Refused("Unexpected client sessions or blocking locks exist")
    return {
        "other_client_sessions": sessions[0],
        "other_active_sessions": sessions[1],
        "other_lock_waiters": sessions[2],
        "ungranted_locks": ungranted_locks,
    }


def _verify_scanner_preconditions(cursor, ledger):
    required = ("learner_api", "0025_progress_transfer_constraint_repair")
    target = ("learner_api", "0026_file_scan_persistence")
    applied = set(ledger)
    if required not in applied or target in applied:
        raise Refused("Learner 0026 migration-ledger prerequisites are not exact")

    cursor.execute(
        """
        SELECT to_regclass('"Learner".file_scan_jobs'),
               to_regclass('"Learner".file_scan_events'),
               to_regclass('"Learner".file_scan_outbox')
        """
    )
    if tuple(cursor.fetchone() or ()) != (None, None, None):
        raise Refused("Scanner persistence tables already exist or are partially installed")

    cursor.execute(
        """
        SELECT own_table.relname,
               c.conname,
               c.contype,
               c.convalidated,
               ARRAY(
                   SELECT a.attname
                     FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ord)
                     JOIN pg_attribute a
                       ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                    ORDER BY key.ord
               ),
               foreign_ns.nspname,
               foreign_table.relname,
               CASE WHEN c.contype = 'f' THEN ARRAY(
                   SELECT a.attname
                     FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ord)
                     JOIN pg_attribute a
                       ON a.attrelid = c.confrelid AND a.attnum = key.attnum
                    ORDER BY key.ord
               ) ELSE NULL END
          FROM pg_constraint c
          JOIN pg_class own_table ON own_table.oid = c.conrelid
          JOIN pg_namespace own_ns ON own_ns.oid = own_table.relnamespace
          LEFT JOIN pg_class foreign_table ON foreign_table.oid = c.confrelid
          LEFT JOIN pg_namespace foreign_ns ON foreign_ns.oid = foreign_table.relnamespace
         WHERE own_ns.nspname = 'Learner'
           AND own_table.relname IN (
               'progress_transfer_requests', 'progress_transfer_items'
           )
           AND c.conname IN (
               'progress_transfer_requests_id_enrolment_id_key',
               'progress_transfer_items_request_enrolment_fkey',
               'progress_transfer_items_request_id_fkey'
           )
         ORDER BY own_table.relname, c.conname
        """
    )
    actual = {
        (row[0], row[1]): (
            row[2], bool(row[3]), tuple(row[4] or ()), row[5], row[6],
            tuple(row[7] or ()),
        )
        for row in cursor.fetchall()
    }
    expected = {
        (
            "progress_transfer_requests",
            "progress_transfer_requests_id_enrolment_id_key",
        ): ("u", True, ("id", "enrolment_id"), None, None, ()),
        (
            "progress_transfer_items",
            "progress_transfer_items_request_enrolment_fkey",
        ): (
            "f", True, ("request_id", "enrolment_id"), "Learner",
            "progress_transfer_requests", ("id", "enrolment_id"),
        ),
    }
    if actual != expected:
        raise Refused("Learner 0025 physical constraint contract has drifted")
    return {
        "learner_0025_applied": True,
        "learner_0026_applied": False,
        "scanner_tables_present": [False, False, False],
        "parent_unique_validated": True,
        "composite_foreign_key_validated": True,
        "legacy_weak_foreign_key_present": False,
    }


def _target_preconditions(cursor, ledger, target_name):
    if target_name == "learner_api.0026_file_scan_persistence":
        return _verify_scanner_preconditions(cursor, ledger)
    return {}


def _configure_django(target, password):
    from django.conf import settings
    from integration_f01_f02.safety import application_lists

    database = _database_config(target, password)
    backend_root = Path(__file__).resolve().parents[1]
    installed_apps = application_lists(backend_root / "config" / "settings.py")["INSTALLED_APPS"]
    settings.configure(
        SECRET_KEY="pma-g1b-disposable-validation-only",
        DEBUG=False,
        USE_TZ=True,
        TIME_ZONE="Europe/London",
        DEFAULT_AUTO_FIELD="django.db.models.BigAutoField",
        INSTALLED_APPS=installed_apps,
        DATABASES={"default": database, "enrolment": dict(database)},
        DATABASE_ROUTERS=["learner_api.routers.EnrolmentRouter"],
        EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    )
    import django
    django.setup()


def execute(target, password, report_path, mode):
    if (target.targets == ("learner_api.0026_file_scan_persistence",)
            and mode != "forward"):
        raise Refused(
            "Scanner persistence rollback execution is outside this guarded batch; "
            "review the empty-table reverse restriction separately"
        )
    _disable_integrations()
    transport_guard = TransportGuard()
    _configure_django(target, password)
    # Django/Python initialization creates a private Windows asyncio
    # self-pipe. Install the outbound transport guard after that local-only
    # runtime setup, but before opening the approved database connection.
    sys.addaudithook(transport_guard)

    from django.db import connections
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.loader import MigrationLoader

    connection = connections["default"]
    transport_guard.allow_database_connect()
    try:
        connection.ensure_connection()
    finally:
        transport_guard.lock_down()
    with connection.cursor() as cursor:
        cursor.execute("BEGIN READ ONLY")
        cursor.execute(
            "SELECT current_database(), current_user, current_setting('neon.branch_id', true), "
            "current_setting('transaction_read_only')"
        )
        verify_live_identity(target, cursor.fetchone())
        _verify_session_settings(cursor)
        before_ledger = _read_ledger(cursor)
        target_preconditions = _target_preconditions(
            cursor, before_ledger, target.targets[0]
        )
        before_catalog = _catalog_snapshot(cursor)
        before_integrity = _bounded_integrity(cursor)
        execution_quiescence = _verify_execution_quiescence(cursor)
        cursor.execute("ROLLBACK")

    if ledger_digest(before_ledger) != target.expected_ledger_sha256:
        raise Refused("Migration ledger changed after approval")
    _assert_zero_integrity(before_integrity)

    loader = MigrationLoader(connection, ignore_no_migrations=True)
    loader.check_consistent_history(connection)
    conflicts = loader.detect_conflicts()
    if conflicts:
        raise Refused(f"Migration graph conflicts exist: {sorted(conflicts)}")
    selected = target.targets if mode == "forward" else tuple(
        ROLLBACK_TARGETS[value] for value in target.targets
    )
    targets = [parse_target(value) for value in selected]
    executor = MigrationExecutor(connection)
    plan = executor.migration_plan(targets)
    if mode == "forward" and not plan:
        raise Refused("Requested forward target is already applied; a fresh approval is required")
    if mode == "forward" and any(backwards for _migration, backwards in plan):
        raise Refused("Backward migration steps are forbidden")
    if mode != "forward" and (not plan or any(not backwards for _migration, backwards in plan)):
        raise Refused("Rollback mode requires a nonempty, entirely backward migration plan")
    planned = [f"{migration.app_label}.{migration.name}" for migration, _ in plan]
    if tuple(planned) != target.expected_plan:
        raise Refused("Django migration plan differs from the explicitly approved plan")
    irreversible = [
        f"{migration.app_label}.{migration.name}"
        for migration, backwards in plan
        if backwards and any(not operation.reversible for operation in migration.operations)
    ]
    if irreversible:
        raise Refused(
            "Rollback plan contains irreversible migrations; restore/reset the disposable branch instead: "
            + ", ".join(irreversible)
        )

    if mode == "rollback-plan":
        report = {
            "status": "ROLLBACK_PLAN_ONLY",
            "authorization_id": target.authorization_id,
            "project_id": target.project_id,
            "branch_id": target.branch_id,
            "endpoint_id": target.endpoint_id,
            "database": target.database,
            "planned_backward_nodes": planned,
            "before_ledger_sha256": ledger_digest(before_ledger),
            "before_catalog": before_catalog,
            "before_integrity": before_integrity,
            "target_preconditions": target_preconditions,
            "execution_quiescence": execution_quiescence,
            "integrations": "disabled",
            "database_writes": "none",
        }
        _write_report(report_path, report)
        return

    try:
        executor.migrate(targets)
    except Exception as error:
        failure = {
            "status": "FAILED",
            "authorization_id": target.authorization_id,
            "project_id": target.project_id,
            "branch_id": target.branch_id,
            "endpoint_id": target.endpoint_id,
            "database": target.database,
            "mode": mode,
            "planned_nodes": planned,
            "before_ledger_sha256": ledger_digest(before_ledger),
            "before_catalog": before_catalog,
            "before_integrity": before_integrity,
            "target_preconditions": target_preconditions,
            "execution_quiescence": execution_quiescence,
            "error_type": type(error).__name__,
            "rollback_required": "operator-owned disposable branch reset/restore",
        }
        _write_report(report_path, failure)
        raise Refused("Migration validation failed; inspect the sanitized report and restore the disposable target")

    with connection.cursor() as cursor:
        cursor.execute("BEGIN READ ONLY")
        cursor.execute(
            "SELECT current_database(), current_user, current_setting('neon.branch_id', true), "
            "current_setting('transaction_read_only')"
        )
        verify_live_identity(target, cursor.fetchone())
        after_ledger = _read_ledger(cursor)
        after_catalog = _catalog_snapshot(cursor)
        after_integrity = _bounded_integrity(cursor)
        cursor.execute("ROLLBACK")
    _assert_zero_integrity(after_integrity)

    report = {
        "status": "PASSED",
        "authorization_id": target.authorization_id,
        "project_id": target.project_id,
        "branch_id": target.branch_id,
        "endpoint_id": target.endpoint_id,
        "database": target.database,
        "mode": mode,
        "planned_nodes": planned,
        "before_ledger_sha256": ledger_digest(before_ledger),
        "after_ledger_sha256": ledger_digest(after_ledger),
        "before_catalog": before_catalog,
        "after_catalog": after_catalog,
        "before_integrity": before_integrity,
        "after_integrity": after_integrity,
        "target_preconditions": target_preconditions,
        "execution_quiescence": execution_quiescence,
        "integrations": "disabled",
        "automatic_teardown_or_rollback": "not performed",
    }
    _write_report(report_path, report)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--approval", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--provider-attestation", type=Path)
    parser.add_argument("--execute-disposable-migrations", required=True)
    parser.add_argument("--mode", choices=("forward", "rollback-plan", "rollback-execute"),
                        default="forward")
    args = parser.parse_args(argv)
    if args.execute_disposable_migrations != EXECUTION_PHRASE:
        raise Refused("Exact execution acknowledgement is required")

    target = ApprovedTarget.parse(json.loads(args.approval.read_text(encoding="utf-8")))
    repository_root = Path(__file__).resolve().parents[2]
    target.verify_sources(repository_root)
    report_path = _validate_report_destination(args.report)
    secrets = json.loads(sys.stdin.read())
    expected_secrets = (
        {"database_password"}
        if args.provider_attestation
        else {"database_password", "neon_api_key"}
    )
    if set(secrets) != expected_secrets:
        raise Refused("Credentials must be supplied only as exact JSON on standard input")
    if not all(isinstance(value, str) and value for value in secrets.values()):
        raise Refused("Missing private credentials")

    if args.provider_attestation:
        attestation = json.loads(
            args.provider_attestation.read_text(encoding="utf-8")
        )
        verify_provider_attestation(target, attestation)
    else:
        metadata = provider_metadata(target, secrets["neon_api_key"])
        target.verify_metadata(*metadata)
    execute(target, secrets["database_password"], report_path, args.mode)
    print("PMA-G1B disposable migration validation completed; see the sanitized report.")


if __name__ == "__main__":
    try:
        main()
    except Refused as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        raise SystemExit(78)
