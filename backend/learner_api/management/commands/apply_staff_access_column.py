"""Add the "Access" column to enrolment."Staff_users".

Why a new column rather than reusing "Position"
-----------------------------------------------
``Position`` is a job title (Caseowner, Enrolment, Curriculum team…) and, until
now, doubled as the permission check: ``login.identity.role_for_staff`` granted
``role='admin'`` to exactly one value of it. Those are two different facts, and
conflating them meant a change of job title silently changed what somebody could
do. ``Access`` holds the permission on its own:

    enrolment    — the enrolment workspace and every learner record
    curriculum   — the curriculum workspace
    coach        — the coach workspace
    tutor        — the tutor workspace
    super-admin  — everything, including this console

``constants.ACCESS_CHOICES`` is the authority; the list above is prose. Re-run
this command after adding a value there.

Because every staff account created from the console now carries
``Position = 'Admin'`` (so ``role='admin'``), this column is the only thing that
narrows what an account can reach. It is therefore enforced server-side by
``login.permissions.require_access``, not merely used to pick a landing page.

The CHECK constraint is the backstop: the API validates against
``constants.ACCESS_CHOICES``, but these tables are unmanaged and written from
more than one place, so the database refuses an unknown value too. NULL stays
allowed — rows created before this column existed have no access recorded, and
``role_for_staff`` treats that as the safest interpretation rather than guessing.

Idempotent, and it REBUILDS the constraint when ``ACCESS_CHOICES`` has grown.
That mattered the first time a grant was added: the constraint was created once
and then skipped as "already present", so the database still refused the new
value while the API accepted it — every attempt to save it failed on a check
violation, which reads as a broken form rather than a stale constraint.

    python manage.py apply_staff_access_column [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

from ...constants import ACCESS_CHOICES

CONN = "enrolment"
TABLE = "Staff_users"
COLUMN = "Access"
CONSTRAINT = "staff_users_access_check"


class Command(BaseCommand):
    help = 'Add "Access" to enrolment."Staff_users" with a CHECK on the allowed values.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan without committing changes.",
        )

    def _columns(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name=%s "
            "ORDER BY ordinal_position",
            [TABLE],
        )
        return cur.fetchall()

    def _constraint_definition(self, cur):
        """The existing CHECK's SQL, or None when there is no such constraint."""
        cur.execute(
            "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = %s",
            [CONSTRAINT],
        )
        row = cur.fetchone()
        return row[0] if row else None

    def _missing_from(self, definition):
        """Grants the existing constraint does not allow.

        Compared by looking for each quoted value rather than by matching the
        whole expression: Postgres rewrites a CHECK when it stores it, so the
        text never comes back in the form it went in.
        """
        return [value for value in ACCESS_CHOICES if f"'{value}'" not in definition]

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                self.stdout.write(f"===== {TABLE} BEFORE =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                cur.execute(
                    f'ALTER TABLE enrolment."{TABLE}" '
                    f'ADD COLUMN IF NOT EXISTS "{COLUMN}" text'
                )

                # Built from ACCESS_CHOICES so the constraint and the API's
                # validation cannot drift apart.
                allowed = ", ".join(f"'{value}'" for value in ACCESS_CHOICES)
                check = (
                    f'CHECK ("{COLUMN}" IS NULL OR lower(trim("{COLUMN}")) IN ({allowed}))'
                )
                existing = self._constraint_definition(cur)
                missing = self._missing_from(existing) if existing is not None else []

                if existing is None:
                    cur.execute(
                        f'ALTER TABLE enrolment."{TABLE}" '
                        f'ADD CONSTRAINT "{CONSTRAINT}" {check}'
                    )
                    self.stdout.write(f"  added CHECK {CONSTRAINT} ({allowed})")
                elif missing:
                    # Dropped and re-added rather than left alone: the old
                    # constraint would refuse the new grant, so the API would
                    # accept a value the database then rejects.
                    cur.execute(
                        f'ALTER TABLE enrolment."{TABLE}" '
                        f'DROP CONSTRAINT "{CONSTRAINT}"'
                    )
                    cur.execute(
                        f'ALTER TABLE enrolment."{TABLE}" '
                        f'ADD CONSTRAINT "{CONSTRAINT}" {check}'
                    )
                    self.stdout.write(
                        f"  rebuilt CHECK {CONSTRAINT} — it did not allow: "
                        f"{', '.join(missing)}"
                    )
                    self.stdout.write(f"  now allows ({allowed})")
                else:
                    self.stdout.write(f"  CHECK {CONSTRAINT} already allows ({allowed})")

                self.stdout.write(f"\n===== {TABLE} AFTER =====")
                for col in self._columns(cur):
                    self.stdout.write(f"  {col}")

                # Report what is currently unassigned, so whoever runs this knows
                # how many accounts still need an access set in the console.
                cur.execute(
                    f'SELECT count(*) FROM enrolment."{TABLE}" WHERE "{COLUMN}" IS NULL'
                )
                unassigned = cur.fetchone()[0]
                if unassigned:
                    self.stdout.write(
                        self.style.WARNING(
                            f"\n{unassigned} staff row(s) have no Access yet — they resolve to "
                            "the least-privileged role until one is set."
                        )
                    )

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
