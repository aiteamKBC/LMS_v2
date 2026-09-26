"""Run the local LMS against the reviewed Neon ``databased fix`` branch.

The connection string is entered interactively and stays process-local.  This
script never edits ``.env`` and performs a read-only Neon identity check before
starting Django.  Django's autoreloader is disabled so the secret is not needed
again in a child process.
"""
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse

import psycopg


EXPECTED_BRANCH_ID = "br-dark-wave-abo4ema5"
DATABASE_NAME = "neondb"


def extract_postgres_url(value):
    match = re.search(r"postgresql://[^\s'\"]+", str(value or ""))
    if not match:
        raise RuntimeError("No PostgreSQL URL was found in the pasted Neon snippet.")
    return match.group(0)


def read_windows_clipboard():
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Could not read the Windows clipboard.")
    return result.stdout


def verify_branch(connection_url):
    parsed = urlparse(connection_url)
    host = (parsed.hostname or "").lower()
    if not host.endswith(".neon.tech"):
        raise RuntimeError("The copied URL is not a Neon PostgreSQL endpoint.")
    if parsed.path.lstrip("/") != DATABASE_NAME:
        raise RuntimeError(f"Expected database {DATABASE_NAME!r}.")

    connection = psycopg.connect(
        connection_url,
        connect_timeout=10,
        options="-c default_transaction_read_only=on",
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "select current_database(), current_setting(%s), "
                "current_setting(%s, true)",
                ["transaction_read_only", "neon.branch_id"],
            )
            database, read_only, branch_id = cursor.fetchone()
    finally:
        connection.rollback()
        connection.close()

    if read_only != "on":
        raise RuntimeError("The Neon identity check was not read-only.")
    if database != DATABASE_NAME:
        raise RuntimeError(f"Connected to unexpected database {database!r}.")
    if branch_id != EXPECTED_BRANCH_ID:
        raise RuntimeError(
            f"Connected to Neon branch {branch_id!r}; expected {EXPECTED_BRANCH_ID!r}."
        )


def configure_process(connection_url):
    for key in ("security_Database_url", "Database_url", "DATABASE_URL"):
        os.environ[key] = connection_url
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"
    os.environ["RUN_APP_ON_TEST_BRANCH"] = "1"
    os.environ["SECURITY_TEST_BRANCH_ID"] = EXPECTED_BRANCH_ID

    # These aliases point at separate live systems in the normal .env.  Empty
    # process-level values stop settings.load_env_file from restoring them.
    for key in (
        "AUDIT_DATABASE_URL",
        "AUDIT_CLONE_DATABASE_URL",
        "LASR-ADUTIOD-CLNE",
        "KBC_ATTENDANCE_DATABASE_URL",
    ):
        os.environ[key] = ""


def main():
    print(
        "Reading the Neon snippet from the clipboard. Open Branches > "
        "databased fix > Connect and click Copy snippet first."
    )
    connection_url = extract_postgres_url(read_windows_clipboard())
    verify_branch(connection_url)
    configure_process(connection_url)

    print(f"Verified Neon branch {EXPECTED_BRANCH_ID}.")
    print("Starting the local backend. Stop it with CTRL-BREAK.")
    backend_dir = Path(__file__).resolve().parent
    os.chdir(backend_dir)
    argv = [str(backend_dir / "manage.py"), "runserver", "--noreload"]
    sys.argv = argv
    from django.core.management import execute_from_command_line

    execute_from_command_line(argv)


if __name__ == "__main__":
    main()
