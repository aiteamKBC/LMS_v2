"""Create the Actual Hours review structures on the CLONE branch.

This is the reviewed "migration" for this feature (Django migrations never run
against the Neon audit branches — see ``audit_api/actual_hours/tables.py``).

    python manage.py setup_actual_hours_review --check      # dry run, no DDL
    python manage.py setup_actual_hours_review              # apply
    python manage.py setup_actual_hours_review --seed-holidays bank-holidays.json

Safety:

* it refuses to run against anything but the ``audit_clone`` alias unless
  ``--alias`` is given explicitly;
* it only creates tables/indexes — it never rewrites a learner row, an
  ``actual_hours`` value, a timestamp or a source label;
* it is idempotent.

The bank-holiday seed expects the official gov.uk ``bank-holidays.json``
payload (``england-and-wales.events``); no network call is made here — download
the file and pass its path.
"""

import json

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections, transaction

from ...actual_hours.journal_hours import ensure_journal_hours_tables
from ...actual_hours.tables import BANK_HOLIDAY_TABLE, ensure_actual_hours_tables


CLONE_ALIAS = "audit_clone"


class Command(BaseCommand):
    help = "Create the Last_audit Actual Hours review tables on the clone branch."

    def add_arguments(self, parser):
        parser.add_argument("--alias", default=CLONE_ALIAS,
                            help=f"Database alias to use (default: {CLONE_ALIAS}).")
        parser.add_argument("--check", action="store_true",
                            help="Report what exists and exit without running any DDL.")
        parser.add_argument("--seed-holidays", dest="seed_holidays", default=None,
                            help="Path to the official gov.uk bank-holidays.json file.")

    def handle(self, *args, **options):
        alias = options["alias"]
        if alias not in connections.databases:
            raise CommandError(f"Database alias {alias!r} is not configured.")
        if alias != CLONE_ALIAS:
            self.stdout.write(self.style.WARNING(
                f"Running against {alias!r}, not {CLONE_ALIAS!r} — this was requested explicitly."))

        connection = connections[alias]
        with connection.cursor() as cursor:
            cursor.execute("select current_database(), current_user")
            database, user = cursor.fetchone()
            host = connection.settings_dict.get("HOST")
            self.stdout.write(f"alias={alias} host={host} database={database} user={user}")

            if options["check"]:
                cursor.execute(
                    """
                    select table_name from information_schema.tables
                    where table_schema = 'Last_audit'
                      and table_name in ('activity_actual_hours_revision',
                                         'activity_actual_hours_validation',
                                         'bank_holidays_england_wales')
                    order by table_name
                    """
                )
                present = [row[0] for row in cursor.fetchall()]
                self.stdout.write(f"existing review tables: {present or 'none'}")
                self.stdout.write(self.style.WARNING("--check: no DDL was run."))
                return

            try:
                with transaction.atomic(using=alias):
                    ensure_actual_hours_tables(cursor)
                    ensure_journal_hours_tables(cursor)
                    seeded = self._seed_holidays(cursor, options["seed_holidays"])
            except DatabaseError as error:
                raise CommandError(f"DDL failed: {error}") from error

            cursor.execute(
                """
                select table_name from information_schema.tables
                where table_schema = 'Last_audit'
                  and table_name in ('activity_actual_hours_revision',
                                     'activity_actual_hours_validation',
                                     'bank_holidays_england_wales')
                order by table_name
                """
            )
            created = [row[0] for row in cursor.fetchall()]
            cursor.execute(
                """
                select count(*) from information_schema.tables
                where table_schema = 'public'
                  and table_name like 'activity_actual_hours%'
                """
            )
            leaked = cursor.fetchone()[0]

        self.stdout.write(self.style.SUCCESS(f"Last_audit review tables: {', '.join(created)}"))
        if seeded:
            self.stdout.write(self.style.SUCCESS(f"bank holidays seeded: {seeded}"))
        if leaked:
            raise CommandError(f"{leaked} unexpected object(s) exist in schema public — investigate.")
        self.stdout.write("No learner row was read or written by this command.")

    def _seed_holidays(self, cursor, path):
        if not path:
            return 0
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        events = (payload.get("england-and-wales") or {}).get("events") or []
        if not events:
            raise CommandError("No england-and-wales events found in that file.")
        version = str(payload.get("england-and-wales", {}).get("division", "england-and-wales"))
        for event in events:
            cursor.execute(
                f"""
                insert into {BANK_HOLIDAY_TABLE} (holiday_date, title, division, data_version)
                values (%s, %s, 'england-and-wales', %s)
                on conflict (holiday_date) do update
                    set title = excluded.title, data_version = excluded.data_version,
                        retrieved_at = now()
                """,
                [event["date"], event.get("title") or "Bank holiday", version],
            )
        return len(events)
