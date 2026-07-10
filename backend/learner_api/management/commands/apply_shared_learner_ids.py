"""Unify learner ids across the enrolment tables and carry them into Active_users.

  Part A: Commercial_users + Enrolment_Users draw ids from ONE shared sequence
          (enrolment.learner_id_seq) so a learner id is globally unique and never
          collides across the two tables.
  Part B: "Learner"."Active_users".id stops minting its own identity and instead
          carries the source learner id forward. Active_users is then rebuilt to
          correctly mirror every Active source learner.

This is a one-off, idempotent migration. Run it once:

    python manage.py apply_shared_learner_ids          # apply
    python manage.py apply_shared_learner_ids --dry-run  # show plan only

It writes to the live Neon database, so it prints a before/after summary and runs
inside a single transaction (rolled back on --dry-run or any error).
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

from learner_api.active_users import sync_active_user
from learner_api.models import ActiveUser, CommercialUser, EnrolmentUser

CONN = "enrolment"


class Command(BaseCommand):
    help = "Give the enrolment tables a shared id sequence and carry ids into Active_users."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the before/after plan without committing (rolls back).",
        )

    def _snapshot(self, cur, label):
        self.stdout.write(f"\n===== {label} =====")
        for t in ("Commercial_users", "Enrolment_Users"):
            cur.execute(f'select id, "Email", "Programme_status" from enrolment."{t}" order by id')
            self.stdout.write(f"-- {t}: {cur.fetchall()}")
        cur.execute('select id, "Email", "Programme_status" from "Learner"."Active_users" order by id')
        self.stdout.write(f"-- Active_users: {cur.fetchall()}")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                self._snapshot(cur, "BEFORE")

                # ---- Part A: shared sequence for the two enrolment tables ----
                cur.execute("CREATE SEQUENCE IF NOT EXISTS enrolment.learner_id_seq")
                cur.execute(
                    """
                    SELECT setval('enrolment.learner_id_seq', GREATEST(
                        (SELECT COALESCE(MAX(id),0) FROM enrolment."Commercial_users"),
                        (SELECT COALESCE(MAX(id),0) FROM enrolment."Enrolment_Users"),
                        (SELECT COALESCE(MAX(id),0) FROM "Learner"."Active_users")
                    ), true)
                    """
                )
                for t in ("Commercial_users", "Enrolment_Users"):
                    cur.execute(f'ALTER TABLE enrolment."{t}" ALTER COLUMN id DROP IDENTITY IF EXISTS')
                    cur.execute(
                        f'ALTER TABLE enrolment."{t}" ALTER COLUMN id '
                        "SET DEFAULT nextval('enrolment.learner_id_seq')"
                    )

                # ---- Part B: Active_users carries the source id ----
                cur.execute('ALTER TABLE "Learner"."Active_users" ALTER COLUMN id DROP IDENTITY IF EXISTS')

                # Rebuild Active_users as a correct mirror of every Active source learner.
                deleted, _ = ActiveUser.objects.all().delete()
                mirrored = 0
                for source in list(CommercialUser.objects.all()) + list(EnrolmentUser.objects.all()):
                    if sync_active_user(source) is not None:
                        mirrored += 1
                self.stdout.write(
                    f"\nRebuilt Active_users: cleared {deleted} old row(s), "
                    f"mirrored {mirrored} active learner(s)."
                )

                self._snapshot(cur, "AFTER")

                cur.execute("SELECT last_value, is_called FROM enrolment.learner_id_seq")
                last_value, is_called = cur.fetchone()
                nxt = last_value + (1 if is_called else 0)
                self.stdout.write(f"\nNext learner id (either table) will be: {nxt}")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
