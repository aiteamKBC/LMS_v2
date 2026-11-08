"""Run one verified Aptem reconciliation cycle without logging private data."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


class SyncFailure(Exception):
    pass


def verify_target(environment, connect=None):
    url = environment.get("APTEM_SYNC_DATABASE_URL")
    database = environment.get("APTEM_SYNC_EXPECTED_DATABASE")
    branch = environment.get("APTEM_SYNC_EXPECTED_BRANCH")
    if not all((url, database, branch)):
        raise SyncFailure("The synchronization database and expected identity must be configured.")
    if connect is None:
        import psycopg
        connect = psycopg.connect
    try:
        with connect(url, connect_timeout=15,
                     options="-c default_transaction_read_only=on -c statement_timeout=15000") as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_setting('neon.branch_id', true), "
                               "current_setting('transaction_read_only')")
                actual_database, actual_branch, read_only = cursor.fetchone()
    except Exception:
        raise SyncFailure("Read-only database identity verification failed; no cycle was started.") from None
    if (actual_database, actual_branch, read_only) != (database, branch, "on"):
        raise SyncFailure("The database identity does not match the configured target; no cycle was started.")
    return url


def cycle_result(process):
    report = None
    for line in process.stdout.splitlines():
        try:
            candidate = json.loads(line)
        except ValueError:
            continue
        if isinstance(candidate, dict) and candidate.get("mode") == "apply":
            report = candidate
    if report is None or set(report) != {"mode", "counts", "review"}:
        raise SyncFailure("The command did not produce a committed reconciliation report.")
    if any(not isinstance(report[key], dict) or any(
            not isinstance(name, str) or type(value) is not int or value < 0
            for name, value in report[key].items()) for key in ("counts", "review")):
        raise SyncFailure("The reconciliation report is invalid.")
    if process.returncode == 0 and not report["review"]:
        return report, "applied"
    # A missing source is a data-review outcome, not evidence of withdrawal.
    # Only the command's explicitly committed partial result is accepted here.
    # Database errors, identity conflicts and other review reasons fail the job.
    if (process.returncode == 1 and set(report["review"]) == {"missing_source"}
            and report["review"]["missing_source"] > 0
            and "CommandError: Partial sync:" in process.stderr):
        return report, "source-review"
    raise SyncFailure("The cycle failed or reported unresolved identity/status/date conflicts.")


def run_cycle(environment, execute=subprocess.run, connect=None):
    url = verify_target(environment, connect)
    runtime = dict(environment)
    runtime.update({
        "DATABASE_URL": url, "Database_url": url, "DATABASEURL": url,
        "ENROLMENT_DATABASE_URL": url, "DJANGO_USE_SQLITE": "false",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(48), "DJANGO_DEBUG": "false",
        "DB_POOL": "false", "DB_CONN_MAX_AGE": "0", "DB_CONNECT_TIMEOUT": "15",
        "DB_STATEMENT_TIMEOUT_MS": "60000", "CURRICULUM_WARM": "0",
        "CACHE_URL": "", "REDIS_URL": "", "CHAT_REDIS_URL": "",
    })
    try:
        process = execute(
            [sys.executable, "manage.py", "sync_aptem_learner_details", "--apply", "--all"],
            cwd=Path(__file__).resolve().parents[2] / "backend", env=runtime,
            text=True, capture_output=True, timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SyncFailure("The reconciliation process could not finish; inspect the next verified cycle.") from None
    return cycle_result(process)


def main():
    try:
        report, outcome = run_cycle(os.environ)
    except SyncFailure as error:
        # Never echo captured driver messages, command stderr, or environment.
        print(f"::error::{error}")
        return 1
    print(json.dumps({"outcome": outcome, **report}, sort_keys=True))
    missing = report["review"].get("missing_source", 0)
    if missing:
        print(f"::warning title=Aptem source review::{missing} existing linked records are absent "
              "from both imported sources. Their local data was retained; this is a partial data result.")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        counts = report["counts"]
        Path(summary).write_text(
            "## Aptem learner reconciliation\n\n"
            f"Cycle outcome: **{outcome}**.\n\n"
            f"Existing local records: {counts.get('local_records', 0)}. "
            f"Examined: {counts.get('examined', 0)}. Updated: {counts.get('changed', 0)}. "
            f"Unchanged: {counts.get('unchanged', 0)}.\n\n"
            f"Missing source records requiring review: **{missing}**. "
            f"No trusted Aptem identity: {counts.get('without_trusted_aptem_id', 0)}.\n\n"
            "Only existing LMS learners are reconciled. Missing source data does not infer "
            "withdrawal or clear dates. LMS activation rules remain authoritative.\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
