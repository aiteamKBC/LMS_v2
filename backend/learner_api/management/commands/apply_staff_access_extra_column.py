"""Add the "Access_extra" column to enrolment."Staff_users".

Why a second column rather than a list in "Access"
--------------------------------------------------
An account may now hold more than one access — somebody who both coaches a
caseload and teaches a group should reach both workspaces from one sign-in.

The obvious implementation, making ``Access`` hold a comma-separated list, would
have been a silent security bug in both directions. Every reader in the codebase
does ``(access or "").strip().lower()`` and then compares with ``==``:

    ``"coach,tutor" == "coach"``            -> False, so a dual-access coach is
                                               refused the coach workspace, and
                                               ``require_access`` 403s them
                                               everywhere.
    ``role_for_staff("super-admin,coach")`` -> ROLE_STAFF, quietly demoting a
                                               platform administrator.

So ``Access`` keeps its exact present meaning — one value, the PRIMARY grant
that decides where the account lands at sign-in — and this column carries any
additional grants. A single-access row is unchanged, and every existing reader
keeps working untouched; only the readers that need "holds any of" were widened,
via ``login.identity.accesses_for_staff``.

Format: comma-separated lowercase values from ``constants.ACCESS_CHOICES``,
matching the sibling column's text type. NULL and '' both mean "no additional
access".

The CHECK is the backstop, as it is for ``Access``: these tables are unmanaged
and written from more than one place, so the database refuses a malformed value
even though the API validates first. It is expressed over the split list so it
holds for any number of entries, and REBUILT when ``ACCESS_CHOICES`` grows —
without that, a newly added grant is accepted by the API and then rejected by
the database, which reads as a broken form rather than a stale constraint.

``super-admin`` is deliberately NOT excluded here by the database: the API
collapses a set containing it down to super-admin alone, and encoding that rule
twice would mean fixing it twice.

    python manage.py apply_staff_access_extra_column [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

from ...constants import ACCESS_CHOICES

CONN = "enrolment"
TABLE = "Staff_users"
COLUMN = "Access_extra"
CONSTRAINT = "staff_users_access_extra_check"


class Command(BaseCommand):
    help = 'Add "Access_extra" to enrolment."Staff_users" for additional access grants.'

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
                # validation cannot drift apart. Every element of the split
                # list must be a known grant; an empty string is "none".
                # Expressed with array containment (<@) rather than a subquery
                # over unnest(): PostgreSQL refuses a subquery in a CHECK, and
                # `<@` says the same thing — every element of the split list is
                # one of the allowed grants — as a plain expression.
                allowed = ", ".join(f"'{value}'" for value in ACCESS_CHOICES)
                check = (
                    f'CHECK ("{COLUMN}" IS NULL OR btrim("{COLUMN}") = \'\' OR '
                    f'string_to_array(replace(lower(btrim("{COLUMN}")), \' \', \'\'), \',\') '
                    f'<@ ARRAY[{allowed}]::text[])'
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

                if dry_run:
                    self.stdout.write(self.style.WARNING("\nDRY RUN — rolling back."))
                    raise _Rollback()
        except _Rollback:
            return

        self.stdout.write(self.style.SUCCESS(f'\n"{COLUMN}" is present on {TABLE}.'))


class _Rollback(Exception):
    """Unwinds the transaction for --dry-run."""
