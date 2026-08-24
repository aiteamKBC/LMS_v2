"""Give every learner-scoped table an explicit link to the enrolment record.

The problem this fixes
----------------------
``enrolment."Created_users"`` and ``"Learner".learners`` have independent primary
key sequences — the ids are disjoint (21,22,23… vs 1,2,4…), so one cannot be read
as the other. Until now the only bridge between the two schemas was an **email
match** (see ``learner_api.identity.learner_profile_for_source``), which breaks
the moment somebody's address is corrected and silently mis-links two people who
ever share one.

Worse, a column named ``learner_id`` already means two different things
depending on the table:

    holds the ENROLMENT id   evidence_files, learning_reflection_submissions,
                             calendar_connections
    holds the PROFILE id     learner_attendance_details, verified_teams_attendance

``enrolment_id`` is the fix: one column, one meaning everywhere — always
``Created_users.id``. That is the right key because a learner exists in
``Created_users`` from the moment they are created, long before any profile row
appears, so it can identify them at every stage of their life on the platform.

Which tables get it
-------------------
The bridge (``learners``) plus the tables that have no foreign key to it. The
six tables that *do* FK to ``learners`` (training plan, progress, KSB
assignments, quiz answers…) reach the enrolment id through it, so giving them
their own copy would be the same fact stored twice and free to disagree.

Backfill is non-destructive
---------------------------
Rows that cannot be matched are left NULL and reported, never deleted or
guessed. Some genuinely cannot be matched — there is evidence and calendar data
for enrolment id 19, a learner who no longer exists.

Idempotent: safe to re-run, and re-running is how you re-check the orphan report
after fixing data.

    python manage.py apply_learner_enrolment_id [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
SCHEMA = "Learner"

#: Tables gaining ``enrolment_id``, and how each is backfilled.
#:
#: "bridge"  — matched to Created_users by normalised email (the rule the code
#:             already used, so this reproduces today's linkage exactly).
#: "direct"  — its ``learner_id`` already IS the enrolment id; copied across,
#:             but only where that learner still exists.
#: "profile" — its ``learner_id`` is a ``learners.id``; resolved through the
#:             bridge, so it inherits whatever the bridge matched.
TARGETS = [
    ("learners", "bridge", None),
    ("evidence_files", "direct", "learner_id"),
    ("learning_reflection_submissions", "direct", "learner_id"),
    ("calendar_connections", "direct", "learner_id"),
    ("learner_attendance_details", "profile", "learner_id"),
    # NB: "Learner".verified_teams_attendance is deliberately absent. It is a
    # VIEW — a filtered projection of learner_attendance_details where
    # source='microsoft_teams' — so it has no rows of its own to link. Adding
    # the column to its base table above is what links that data; re-listing
    # the column in the view is a separate, cosmetic change and is not done
    # here (a view cannot be ALTERed, and rebuilding one to add a column risks
    # reordering it).
]

UNIQUE_INDEX = "learners_enrolment_id_uniq"


class Command(BaseCommand):
    help = 'Add and backfill "enrolment_id" (and learners.programme_id) in the Learner schema.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan and the counts without committing.",
        )

    # -- helpers ---------------------------------------------------------
    def _base_table_kind(self, cur, table):
        """'BASE TABLE', 'VIEW', or None when the relation is absent.

        information_schema.tables lists views too, so a plain existence check
        would happily try to ALTER one.
        """
        cur.execute(
            "SELECT table_type FROM information_schema.tables "
            "WHERE table_schema=%s AND table_name=%s",
            [SCHEMA, table],
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

                # Neon's pooler hands out backends that another client has left
                # with default_transaction_read_only=on, which makes DDL fail
                # with "cannot execute ALTER TABLE in a read-only transaction"
                # on a connection that is otherwise perfectly healthy. Asking
                # for a writable transaction explicitly is the durable fix — it
                # must be the first statement in the transaction, so it goes
                # here rather than anywhere more convenient.
                cur.execute("SET TRANSACTION READ WRITE")

                # ---- 1. columns ---------------------------------------
                self.stdout.write(self.style.MIGRATE_HEADING("1. Adding columns"))
                present = []
                for table, _mode, _col in TARGETS:
                    kind = self._base_table_kind(cur, table)
                    if kind is None:
                        self.stdout.write(f"   - {table}: not on this database, skipped")
                        continue
                    if kind != "BASE TABLE":
                        self.stdout.write(
                            f"   - {table}: is a {kind}, skipped (link its base table instead)"
                        )
                        continue
                    cur.execute(
                        f'ALTER TABLE "{SCHEMA}"."{table}" '
                        'ADD COLUMN IF NOT EXISTS "enrolment_id" bigint'
                    )
                    present.append(table)
                    self.stdout.write(f"   + {table}.enrolment_id")

                # The programme the learner is on, as an id rather than a name.
                # curriculum.programmes.programme_id is a string key, so this
                # column matches that type rather than inventing a numeric one.
                cur.execute(
                    f'ALTER TABLE "{SCHEMA}"."learners" '
                    'ADD COLUMN IF NOT EXISTS "programme_id" varchar(64)'
                )
                self.stdout.write("   + learners.programme_id")

                # ---- 2. the bridge ------------------------------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n2. Linking learners -> Created_users (by email)")
                )
                cur.execute(
                    f'UPDATE "{SCHEMA}"."learners" AS l '
                    '   SET "enrolment_id" = c.id '
                    '  FROM enrolment."Created_users" AS c '
                    ' WHERE l."enrolment_id" IS DISTINCT FROM c.id '
                    "   AND lower(btrim(coalesce(l.email, ''))) <> '' "
                    "   AND lower(btrim(l.email)) = lower(btrim(coalesce(c.\"Email\", '')))"
                )
                self.stdout.write(f"   matched {cur.rowcount} profile(s)")

                # One profile per enrolment learner. Partial, so the rows still
                # awaiting a match do not all collide on NULL.
                cur.execute(
                    "SELECT 1 FROM pg_indexes WHERE schemaname=%s AND indexname=%s",
                    [SCHEMA, UNIQUE_INDEX],
                )
                if cur.fetchone() is None:
                    cur.execute(
                        f'CREATE UNIQUE INDEX "{UNIQUE_INDEX}" ON "{SCHEMA}"."learners" '
                        '("enrolment_id") WHERE "enrolment_id" IS NOT NULL'
                    )
                    self.stdout.write(f"   + unique index {UNIQUE_INDEX}")

                # ---- 3. dependent tables ------------------------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n3. Backfilling the unlinked tables")
                )
                for table, mode, col in TARGETS:
                    if table not in present or mode == "bridge":
                        continue
                    if mode == "direct":
                        # learner_id already IS an enrolment id — but only trust
                        # it where that learner still exists, so a dangling
                        # reference stays visibly NULL instead of being invented.
                        cur.execute(
                            f'UPDATE "{SCHEMA}"."{table}" AS t '
                            '   SET "enrolment_id" = c.id '
                            '  FROM enrolment."Created_users" AS c '
                            f' WHERE c.id = NULLIF(btrim(t."{col}"::text), \'\')::bigint '
                            '   AND t."enrolment_id" IS NULL'
                        )
                    else:
                        cur.execute(
                            f'UPDATE "{SCHEMA}"."{table}" AS t '
                            '   SET "enrolment_id" = l."enrolment_id" '
                            f'  FROM "{SCHEMA}"."learners" AS l '
                            f' WHERE l.id = t."{col}" '
                            '   AND l."enrolment_id" IS NOT NULL '
                            '   AND t."enrolment_id" IS NULL'
                        )
                    linked = cur.rowcount
                    total = self._scalar(cur, f'SELECT count(*) FROM "{SCHEMA}"."{table}"')
                    unmatched = self._scalar(
                        cur,
                        f'SELECT count(*) FROM "{SCHEMA}"."{table}" WHERE "enrolment_id" IS NULL',
                    )
                    self.stdout.write(
                        f"   {table}: linked {linked}, {unmatched} of {total} "
                        f"still unmatched ({mode})"
                    )

                # ---- 4. programme ids ---------------------------------
                # Only names that identify exactly ONE programme are resolved.
                # A name shared by several programmes -- an archived one and the
                # replacement created under the same name -- cannot be resolved
                # from the learner row, and an unqualified UPDATE ... FROM would
                # silently attach the learner to whichever row the planner
                # happened to join. Those are reported for a human instead.
                self.stdout.write(self.style.MIGRATE_HEADING("\n4. Resolving programme ids"))
                cur.execute(
                    f'UPDATE "{SCHEMA}"."learners" AS l '
                    '   SET "programme_id" = p.programme_id '
                    "  FROM ("
                    "         SELECT lower(btrim(coalesce(name, ''))) AS name_key, "
                    "                min(programme_id) AS programme_id "
                    "           FROM curriculum.programmes "
                    "          WHERE lower(btrim(coalesce(name, ''))) <> '' "
                    "          GROUP BY 1 "
                    "         HAVING count(*) = 1"
                    "       ) AS p "
                    " WHERE lower(btrim(coalesce(l.programme, ''))) <> '' "
                    "   AND lower(btrim(l.programme)) = p.name_key "
                    '   AND l."programme_id" IS DISTINCT FROM p.programme_id'
                )
                self.stdout.write(f"   resolved {cur.rowcount} programme id(s)")

                cur.execute(
                    f'SELECT l.id, l.programme, count(p.programme_id) '
                    f'  FROM "{SCHEMA}"."learners" AS l '
                    "  JOIN curriculum.programmes AS p "
                    "    ON lower(btrim(l.programme)) = lower(btrim(coalesce(p.name, ''))) "
                    ' WHERE l."programme_id" IS NULL '
                    " GROUP BY l.id, l.programme "
                    "HAVING count(p.programme_id) > 1 "
                    " ORDER BY l.id"
                )
                for pid, prog, matches in cur.fetchall():
                    self.stdout.write(
                        self.style.WARNING(
                            f"      learners.id={pid:<5} programme {prog!r} matches "
                            f"{matches} programmes - left NULL, assign it by hand"
                        )
                    )

                # ---- 5. what could not be matched ---------------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n5. Orphans (left NULL, nothing deleted)")
                )
                cur.execute(
                    f"SELECT id, coalesce(full_name,''), coalesce(email,'') "
                    f'  FROM "{SCHEMA}"."learners" WHERE "enrolment_id" IS NULL ORDER BY id'
                )
                rows = cur.fetchall()
                if rows:
                    self.stdout.write(f"   {len(rows)} profile(s) with no enrolment record:")
                    for pid, name, email in rows:
                        self.stdout.write(f"      learners.id={pid:<5} {name!r} <{email}>")
                else:
                    self.stdout.write("   every profile is linked")

                # Names matching several programmes are already reported in
                # step 4; listing them here as matching none would contradict it.
                cur.execute(
                    f"SELECT l.id, coalesce(l.programme,'') "
                    f'  FROM "{SCHEMA}"."learners" AS l '
                    ' WHERE l."programme_id" IS NULL '
                    "   AND btrim(coalesce(l.programme,'')) <> '' "
                    "   AND NOT EXISTS ("
                    "         SELECT 1 FROM curriculum.programmes AS p "
                    "          WHERE lower(btrim(l.programme)) = lower(btrim(coalesce(p.name, '')))"
                    "       ) "
                    " ORDER BY l.id"
                )
                for pid, prog in cur.fetchall():
                    self.stdout.write(
                        self.style.WARNING(
                            f"      learners.id={pid:<5} programme {prog!r} "
                            "matches no curriculum programme"
                        )
                    )

                for table, mode, col in TARGETS:
                    if table not in present or mode == "bridge":
                        continue
                    cur.execute(
                        f'SELECT DISTINCT t."{col}"::text FROM "{SCHEMA}"."{table}" t '
                        ' WHERE t."enrolment_id" IS NULL ORDER BY 1'
                    )
                    ids = [str(r[0]) for r in cur.fetchall()]
                    if ids:
                        self.stdout.write(
                            self.style.WARNING(
                                f"      {table}: unresolved learner_id(s) {', '.join(ids)}"
                            )
                        )

                if dry_run:
                    self.stdout.write(
                        self.style.WARNING("\n--dry-run: rolling back, nothing committed.")
                    )
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
