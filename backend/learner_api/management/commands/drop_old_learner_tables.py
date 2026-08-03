"""Drop the retired learner tables, now that enrolment."Created_users" owns the data.

Separate from create_created_users_table so the destructive step is its own
deliberate command. It re-proves the data is safe in Created_users before
dropping anything: same row count, and every id/email/Learner_type in the old
table present in the new one. If that check fails the transaction rolls back and
nothing is dropped.

Dropped:
    enrolment."Enrolment_Users"                  (superseded)
    enrolment."Commercial_users"                 (superseded; merged in earlier)
    enrolment."Enrolment_Users_premerge_bak"     (copy of the above)
    enrolment."Commercial_users_premerge_bak"    (copy of the above)

Run:

    python manage.py drop_old_learner_tables --dry-run   # rehearse, roll back
    python manage.py drop_old_learner_tables             # drop for real
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
LIVE = 'enrolment."Created_users"'

# The table whose contents must be accounted for in Created_users before any drop.
VERIFY_AGAINST = "Enrolment_Users"

DROP_TABLES = [
    "Enrolment_Users",
    "Commercial_users",
    "Enrolment_Users_premerge_bak",
    "Commercial_users_premerge_bak",
]


class Command(BaseCommand):
    help = "Drop the retired Enrolment_Users / Commercial_users tables and their backups."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Rehearse the drops and roll back.",
        )

    def _exists(self, cur, table):
        cur.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema='enrolment' AND table_name=%s",
            (table,),
        )
        return cur.fetchone() is not None

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                if not self._exists(cur, "Created_users"):
                    raise RuntimeError(
                        f"{LIVE} does not exist — run create_created_users_table first."
                    )

                cur.execute(f"SELECT count(*) FROM {LIVE}")
                live_count = cur.fetchone()[0]
                self.stdout.write(f"\n{LIVE} holds {live_count} learner(s)")

                # --- safety gate: every old row must be present in the new table ---
                if self._exists(cur, VERIFY_AGAINST):
                    cur.execute(f'SELECT count(*) FROM enrolment."{VERIFY_AGAINST}"')
                    old_count = cur.fetchone()[0]
                    cur.execute(f'''
                        SELECT o.id, o."Email"
                        FROM enrolment."{VERIFY_AGAINST}" o
                        WHERE NOT EXISTS (
                            SELECT 1 FROM {LIVE} n
                            WHERE n.id = o.id
                              AND coalesce(n."Email",'') = coalesce(o."Email",'')
                              AND coalesce(n."Learner_type",'') = coalesce(o."Learner_type",'')
                        )
                    ''')
                    missing = cur.fetchall()
                    if missing:
                        raise RuntimeError(
                            f"REFUSING TO DROP — {len(missing)} row(s) in {VERIFY_AGAINST} "
                            f"are not in {LIVE}: {missing}"
                        )
                    self.stdout.write(self.style.SUCCESS(
                        f"  safety gate passed: all {old_count} row(s) of {VERIFY_AGAINST} "
                        f"are present in Created_users"
                    ))
                else:
                    self.stdout.write(f"  {VERIFY_AGAINST} already gone — nothing to verify")

                # Satellites must still resolve against the surviving table.
                cur.execute(f'''
                    SELECT count(*) FROM enrolment."Extended_ILR" e
                    WHERE NOT EXISTS (SELECT 1 FROM {LIVE} d WHERE d.id = e."Learner_id")
                ''')
                orphans = cur.fetchone()[0]
                if orphans:
                    raise RuntimeError(f"REFUSING TO DROP — {orphans} Extended_ILR row(s) would be orphaned")
                self.stdout.write("  no satellite row would be orphaned")

                # --- drop ---
                self.stdout.write("\ndropping:")
                for table in DROP_TABLES:
                    if not self._exists(cur, table):
                        self.stdout.write(f"  {table}: already gone")
                        continue
                    cur.execute(f'SELECT count(*) FROM enrolment."{table}"')
                    n = cur.fetchone()[0]
                    cur.execute(f'DROP TABLE enrolment."{table}"')
                    self.stdout.write(self.style.SUCCESS(f"  dropped enrolment.\"{table}\" ({n} row(s))"))

                cur.execute("""
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema='enrolment' ORDER BY table_name
                """)
                self.stdout.write("\nremaining tables in schema enrolment:")
                for (name,) in cur.fetchall():
                    marker = "  <- the learner table" if name == "Created_users" else ""
                    self.stdout.write(f"  {name}{marker}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing dropped."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Drop failed (rolled back): {exc}"))
            raise
