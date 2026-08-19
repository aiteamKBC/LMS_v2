"""Give every user — learner, staff and employer — one permanent UUID.

The problem this fixes
----------------------
Users are identified by integer primary keys from three independent identity
sequences (``Created_users.id``, ``Staff_users.id``, ``Employers.id``), so the
same number means a different person in each table and nothing outside the
database can name a user unambiguously. Worse for learners: a person exists as
``enrolment."Created_users"`` while enrolling and as ``"Learner".learners`` once
active, and those two tables have disjoint id sequences — learner 21 in the
first is learner 4 in the second. ``enrolment_id`` (see
``apply_learner_enrolment_id``) bridges them, but it is still an *enrolment*
integer, so the answer to "who is this?" changes shape depending on which phase
and which table you ask.

``uuid`` is the fix: one value, stable for the life of the user, the same in
every table that describes them. For a learner the SAME uuid is written to both
``Created_users`` and ``learners``, so the identifier no longer changes when
they cross from enrolling to active — that crossing is what this command exists
to make invisible.

Additive, not a primary-key swap
--------------------------------
The integer primary keys stay exactly as they are and remain the internal join
key. Roughly twenty-five columns across three schemas hold a learner id as
``bigint``/``integer``, most of them on unmanaged tables that no Django
migration would touch, and ``Login_accounts.Subject_id`` is a bigint too;
retyping all of them in one shot is a far larger and riskier change than adding
a column. The uuid is therefore the *public* identifier — the one APIs and URLs
should expose — layered over plumbing that keeps working untouched.

Backfill is non-destructive
---------------------------
Existing rows keep any uuid they already have; only NULLs are filled. Learner
profiles take their uuid from the enrolment row they are linked to, via
``enrolment_id`` — the real link. A profile with no ``enrolment_id`` (the
backfill in ``apply_learner_enrolment_id`` leaves unmatched rows NULL rather
than guessing) gets its own fresh uuid instead: it is still a user and still
needs naming, and inventing a link here would be exactly the silent
mis-matching that column was added to stop.

Idempotent: safe to re-run, and re-running is how you fill in uuids for rows
that gained an ``enrolment_id`` since the last run.

    python manage.py apply_user_uuid [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"

#: Tables gaining ``uuid``, as (schema, table). Each is independent: a staff
#: member and an employer are their own users, so they get their own uuids.
TARGETS = [
    ("enrolment", "Created_users"),
    ("enrolment", "Staff_users"),
    ("enrolment", "Employers"),
    ("Learner", "learners"),
]

#: Unique indexes, one per table, named after it.
INDEX_NAME = "{table}_uuid_uniq"


class Command(BaseCommand):
    help = 'Add and backfill a permanent "uuid" on the learner, staff and employer tables.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan and the counts without committing.",
        )

    # -- helpers ---------------------------------------------------------
    def _base_table_kind(self, cur, schema, table):
        """'BASE TABLE', 'VIEW', or None when the relation is absent.

        information_schema.tables lists views too, so a plain existence check
        would happily try to ALTER one.
        """
        cur.execute(
            "SELECT table_type FROM information_schema.tables "
            "WHERE table_schema=%s AND table_name=%s",
            [schema, table],
        )
        row = cur.fetchone()
        return row[0] if row else None

    def _scalar(self, cur, sql, params=None):
        cur.execute(sql, params or [])
        row = cur.fetchone()
        return row[0] if row else 0

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                # Neon's pooler hands out backends left with
                # default_transaction_read_only=on by another client, which
                # makes DDL fail on an otherwise healthy connection. Must be
                # the first statement in the transaction.
                cur.execute("SET TRANSACTION READ WRITE")

                # ---- 1. columns ---------------------------------------
                self.stdout.write(self.style.MIGRATE_HEADING("1. Adding columns"))
                present = []
                for schema, table in TARGETS:
                    kind = self._base_table_kind(cur, schema, table)
                    if kind is None:
                        self.stdout.write(f"   - {schema}.{table}: not on this database, skipped")
                        continue
                    if kind != "BASE TABLE":
                        self.stdout.write(
                            f"   - {schema}.{table}: is a {kind}, skipped (add it to the base table)"
                        )
                        continue
                    cur.execute(
                        f'ALTER TABLE "{schema}"."{table}" '
                        'ADD COLUMN IF NOT EXISTS "uuid" uuid'
                    )
                    present.append((schema, table))
                    self.stdout.write(f"   + {schema}.{table}.uuid")

                names = {(s, t) for s, t in present}

                # ---- 2. learners inherit the enrolment uuid -----------
                # Order matters: Created_users is filled first (step 3) only
                # for rows a profile might point at, so do the enrolment side
                # of the pair before copying it across. Filling Created_users
                # here — limited to rows that have a linked profile — keeps
                # the pair consistent even on a first run.
                self.stdout.write(
                    self.style.MIGRATE_HEADING(
                        "\n2. Sharing one uuid across the enrolment and active rows"
                    )
                )
                if ("enrolment", "Created_users") in names and ("Learner", "learners") in names:
                    cur.execute(
                        'UPDATE enrolment."Created_users" AS c '
                        '   SET "uuid" = gen_random_uuid() '
                        ' WHERE c."uuid" IS NULL '
                        '   AND EXISTS (SELECT 1 FROM "Learner"."learners" AS l '
                        '                WHERE l."enrolment_id" = c.id)'
                    )
                    self.stdout.write(f"   seeded {cur.rowcount} enrolment row(s) that have a profile")

                    # The copy across. enrolment_id is the real link; a profile
                    # without one is handled in step 3 as a user in its own right.
                    cur.execute(
                        'UPDATE "Learner"."learners" AS l '
                        '   SET "uuid" = c."uuid" '
                        '  FROM enrolment."Created_users" AS c '
                        ' WHERE l."enrolment_id" = c.id '
                        '   AND c."uuid" IS NOT NULL '
                        '   AND l."uuid" IS DISTINCT FROM c."uuid"'
                    )
                    self.stdout.write(f"   linked {cur.rowcount} profile(s) to their enrolment uuid")
                else:
                    self.stdout.write("   - both tables not present, skipped")

                # ---- 3. everyone else gets a fresh uuid ---------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n3. Filling remaining rows")
                )
                for schema, table in present:
                    cur.execute(
                        f'UPDATE "{schema}"."{table}" '
                        'SET "uuid" = gen_random_uuid() WHERE "uuid" IS NULL'
                    )
                    self.stdout.write(f"   {schema}.{table}: {cur.rowcount} row(s) given a new uuid")

                # ---- 4. constraints -----------------------------------
                # Unique first, then NOT NULL: both are only safe once every
                # row is filled, which step 3 guarantees.
                self.stdout.write(self.style.MIGRATE_HEADING("\n4. Constraints"))
                for schema, table in present:
                    index = INDEX_NAME.format(table=table.lower())
                    cur.execute(
                        "SELECT 1 FROM pg_indexes WHERE schemaname=%s AND indexname=%s",
                        [schema, index],
                    )
                    if cur.fetchone() is None:
                        cur.execute(
                            f'CREATE UNIQUE INDEX "{index}" ON "{schema}"."{table}" ("uuid")'
                        )
                        self.stdout.write(f"   + unique index {index}")
                    else:
                        self.stdout.write(f"   = {index} already present")

                    cur.execute(
                        f'ALTER TABLE "{schema}"."{table}" '
                        'ALTER COLUMN "uuid" SET DEFAULT gen_random_uuid()'
                    )
                    cur.execute(
                        f'ALTER TABLE "{schema}"."{table}" '
                        'ALTER COLUMN "uuid" SET NOT NULL'
                    )
                    self.stdout.write(f"   + {schema}.{table}.uuid default + NOT NULL")

                # ---- 5. report ----------------------------------------
                self.stdout.write(self.style.MIGRATE_HEADING("\n5. Result"))
                for schema, table in present:
                    total = self._scalar(cur, f'SELECT count(*) FROM "{schema}"."{table}"')
                    filled = self._scalar(
                        cur, f'SELECT count("uuid") FROM "{schema}"."{table}"'
                    )
                    self.stdout.write(f"   {schema}.{table}: {filled}/{total} rows have a uuid")

                if ("Learner", "learners") in names:
                    shared = self._scalar(
                        cur,
                        'SELECT count(*) FROM "Learner"."learners" AS l '
                        'JOIN enrolment."Created_users" AS c ON c.id = l."enrolment_id" '
                        'WHERE l."uuid" = c."uuid"',
                    )
                    unlinked = self._scalar(
                        cur,
                        'SELECT count(*) FROM "Learner"."learners" '
                        'WHERE "enrolment_id" IS NULL',
                    )
                    self.stdout.write(
                        f"   {shared} learner(s) share one uuid across both phases"
                    )
                    if unlinked:
                        # Not an error: these are real users, they just have no
                        # enrolment row to share with. Reported so the number is
                        # visible rather than discovered later.
                        self.stdout.write(
                            f"   {unlinked} profile(s) have no enrolment_id and carry "
                            "their own uuid"
                        )

                if dry_run:
                    self.stdout.write(self.style.WARNING("\nDry run — rolling back."))
                    raise _Rollback()
        except _Rollback:
            self.stdout.write(self.style.SUCCESS("Dry run complete, nothing committed."))
            return

        self.stdout.write(self.style.SUCCESS("\nDone."))


class _Rollback(Exception):
    """Internal: unwinds the transaction for --dry-run."""
