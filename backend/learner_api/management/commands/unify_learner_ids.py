"""Give every learner mirror the same id as its enrolment record.

``"Learner".learners.id`` was an independent sequence, so a learner was one
number in ``enrolment."Created_users"`` and a different number in the mirror.
Every surface joining the two had to route through ``enrolment_id``, and getting
it wrong is silent -- the two id ranges overlap, so a mistaken id usually finds
*somebody*, just the wrong person. This makes the mirror's primary key equal to
the enrolment id, so the two can never disagree again.

Why it cannot be done row by row
--------------------------------
Most targets are currently some *other* row's id, so updating one row at a time
hits a unique violation, or worse a chain that moves a row twice. The run parks
every profile at ``id + ORPHAN_OFFSET`` first, which empties the real id space,
then assigns final ids from a saved map. Child rows are remapped set-based from
their pre-change values for the same reason.

What is remapped, and what is deliberately left alone
-----------------------------------------------------
Remapped: the columns that hold ``learners.id`` -- the three FK children, the
two attendance tables, and ``reviews``. The attendance tables carry no FK, so
they were confirmed by their own ``learner_name`` column matching
``learners.full_name`` rather than ``Created_users."Username"``.

Left alone: ``evidence_files``, ``learner_monthly_reports``,
``learning_reflection_submissions``, ``progress_review_runs`` and
``calendar_connections``. Those already hold the *enrolment* id -- they are the
``(learner_kind, learner_id)`` pair taken from the URL. They need no change, and
after this run they read correctly in both spaces at once.

The chat tables are ``ON UPDATE CASCADE``, so they follow the two id updates by
themselves. Remapping them by hand afterwards would move their rows a second
time, onto the wrong learner.

    python manage.py unify_learner_ids
    python manage.py unify_learner_ids --apply
"""
from django.core.management.base import BaseCommand
from django.db import DatabaseError, connections, transaction

#: Where a profile with no live enrolment record is parked. Far above any real
#: id so it cannot collide, and reversible -- these rows keep all their data.
ORPHAN_OFFSET = 1_000_000

#: Columns holding ``"Learner".learners.id`` that do NOT cascade on update.
CHILD_COLUMNS = [
    ("Learner", "learner_progress_entries", "learner_id"),
    ("Learner", "learner_training_plan_modules", "learner_id"),
    ("Learner", "learner_ksb_assignments", "learner_id"),
    ("Learner", "reviews", "learner_id"),
    ("Learner", "learner_attendance_details", "learner_id"),
    ("Learner", "learner_attendance_details", "learner_profile_id"),
    ("Learner", "verified_teams_attendance", "learner_id"),
    ("Learner", "verified_teams_attendance", "learner_profile_id"),
]

#: Made deferrable so the parking pass cannot trip them mid-transaction. They
#: keep their names and their delete rules; only the check timing moves.
#:
#: The UNIQUE entries matter as much as the foreign keys. A child table keyed
#: ``(learner_id, position)`` has the same collision problem the parent primary
#: key does: while the set-based update is in flight, a row moving to learner
#: 286 meets a row already sitting at 286 that has not moved yet. Checked at
#: commit instead, both have moved and the pair is unique again. Discovered the
#: hard way -- the first run rolled back on
#: ``learner_training_plan_modules_learner_id_position_key``.
DEFERRABLE_CONSTRAINTS = [
    ("Learner", "learner_ksb_assignments", "learner_ksb_assignments_learner_id_fkey"),
    ("Learner", "learner_progress_entries", "learner_progress_entries_learner_id_fkey"),
    ("Learner", "learner_training_plan_modules", "learner_training_plan_modules_learner_id_fkey"),
]


class Command(BaseCommand):
    help = "Renumber Learner.learners.id to match enrolment.Created_users.id."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, only reports what it would do.",
        )

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        conn = connections["enrolment"]

        def rows(sql, params=None):
            with conn.cursor() as cur:
                cur.execute(sql, params or [])
                return cur.fetchall()

        total = rows('select count(*) from "Learner".learners')[0][0]
        mapped = rows(
            'select count(*) from "Learner".learners l '
            ' where l.enrolment_id is not null and l.id <> l.enrolment_id '
            '   and exists (select 1 from enrolment."Created_users" u where u.id = l.enrolment_id)'
        )[0][0]
        already = rows('select count(*) from "Learner".learners where id = enrolment_id')[0][0]
        orphans = rows(
            'select count(*) from "Learner".learners l '
            ' where l.enrolment_id is null '
            '    or not exists (select 1 from enrolment."Created_users" u where u.id = l.enrolment_id)'
        )[0][0]
        collisions = rows(
            'select count(*) from "Learner".learners a '
            ' where a.enrolment_id is not null and a.id <> a.enrolment_id '
            '   and exists (select 1 from "Learner".learners b where b.id = a.enrolment_id)'
        )[0][0]

        self.stdout.write(f"Profiles in Learner.learners : {total}")
        self.stdout.write(f"  will be renumbered         : {mapped}")
        self.stdout.write(f"  already correct            : {already}")
        self.stdout.write(self.style.WARNING(
            f"  no live enrolment record   : {orphans} "
            f"(parked at id + {ORPHAN_OFFSET:,}, data kept)"
        ))
        self.stdout.write(
            f"  target held by another row : {collisions} (why this runs in two passes)"
        )

        # A uuid that disagrees means the enrolment_id points at the wrong
        # person. Renumbering onto it would merge two learners, so refuse.
        bad = rows(
            'select l.id, l.enrolment_id, l.full_name from "Learner".learners l '
            '  join enrolment."Created_users" u on u.id = l.enrolment_id '
            ' where l.uuid is not null and u."uuid" is not null and l.uuid <> u."uuid"'
        )
        if bad:
            self.stderr.write(self.style.ERROR(
                f"{len(bad)} profile(s) have a uuid that disagrees with their enrolment "
                "record. Refusing: these links are wrong and would merge learners."
            ))
            for row in bad[:10]:
                self.stderr.write(f"    learners.id={row[0]} enrolment_id={row[1]} {row[2]}")
            return

        dupes = rows(
            'select enrolment_id, count(*) from "Learner".learners '
            ' where enrolment_id is not null group by 1 having count(*) > 1'
        )
        if dupes:
            self.stderr.write(self.style.ERROR(
                f"{len(dupes)} enrolment id(s) are claimed by more than one profile. "
                "Two rows cannot share one primary key -- resolve these first."
            ))
            for row in dupes[:10]:
                self.stderr.write(f"    enrolment_id={row[0]} claimed by {row[1]} profiles")
            return

        for schema, table, column in CHILD_COLUMNS:
            count = rows(
                f'select count(*) from "{schema}"."{table}" where "{column}" is not null'
            )[0][0]
            self.stdout.write(
                f"  children to follow: {schema}.{table}.{column:<22} {count}"
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                "\nDry run -- nothing written. Re-run with --apply."
            ))
            return

        try:
            with transaction.atomic(using="enrolment"):
                with conn.cursor() as cur:
                    # The pooler leaks default_transaction_read_only between
                    # clients, so the transaction states plainly that it writes.
                    cur.execute("SET TRANSACTION READ WRITE")

                    # Built from pre-change state and kept afterwards: anything
                    # outside this database still holding an old profile id --
                    # an export, a Teams sync -- reconciles through this table.
                    cur.execute('drop table if exists "Learner".learner_id_remap')
                    cur.execute(
                        'create table "Learner".learner_id_remap as '
                        'select l.id as old_id, l.enrolment_id as new_id, now() as remapped_at '
                        '  from "Learner".learners l '
                        ' where l.enrolment_id is not null '
                        '   and exists (select 1 from enrolment."Created_users" u '
                        '                where u.id = l.enrolment_id)'
                    )
                    cur.execute('select count(*) from "Learner".learner_id_remap')
                    self.stdout.write(f"\nremap rows saved: {cur.fetchone()[0]}")

                    # Checked at commit rather than per statement, so the
                    # parking pass below cannot trip them.
                    #
                    # Discovered rather than listed: the tables carry UNIQUE
                    # constraints that are not declared on the Django models
                    # (``(learner_id, position)``), and hardcoding names would
                    # miss whichever one nobody thought of -- which is exactly
                    # how the first run failed. Anything deferrable-capable on
                    # a table being rewritten is deferred.
                    touched = {(s, t) for s, t, _c in CHILD_COLUMNS}
                    touched.add(("Learner", "learners"))
                    relnames = [f'"{s}"."{t}"' for s, t in sorted(touched)]

                    # Foreign keys can be re-timed in place.
                    cur.execute(
                        "select conrelid::regclass::text, conname from pg_constraint "
                        " where conrelid = any(%s::regclass[]) "
                        "   and contype = 'f' and not condeferrable",
                        [relnames],
                    )
                    fks = cur.fetchall()
                    for relname, name in fks:
                        cur.execute(
                            f'alter table {relname} '
                            f'alter constraint "{name}" deferrable initially immediate'
                        )

                    # UNIQUE constraints cannot: Postgres only accepts ALTER
                    # CONSTRAINT on a foreign key, so each is dropped and
                    # recreated deferrable from its own definition. Recreated
                    # inside this transaction, so a rollback restores the
                    # original and the table is never left unprotected.
                    cur.execute(
                        "select conrelid::regclass::text, conname, pg_get_constraintdef(oid) "
                        "  from pg_constraint "
                        " where conrelid = any(%s::regclass[]) "
                        "   and contype = 'u' and not condeferrable",
                        [relnames],
                    )
                    uniques = cur.fetchall()
                    for relname, name, definition in uniques:
                        cur.execute(f'alter table {relname} drop constraint "{name}"')
                        cur.execute(
                            f'alter table {relname} add constraint "{name}" '
                            f"{definition} deferrable initially immediate"
                        )
                    self.stdout.write(
                        f"deferred {len(fks)} foreign key(s) and {len(uniques)} unique "
                        "constraint(s) for the duration of this transaction"
                    )
                    cur.execute("SET CONSTRAINTS ALL DEFERRED")

                    # Pass 1 -- empty the real id space.
                    cur.execute(
                        f'update "Learner".learners set id = id + {ORPHAN_OFFSET}'
                    )
                    self.stdout.write(
                        f"parked {cur.rowcount} profile(s) above {ORPHAN_OFFSET:,}"
                    )

                    # Pass 2 -- final ids. Anything with no map row stays parked.
                    cur.execute(
                        'update "Learner".learners l set id = m.new_id '
                        '  from "Learner".learner_id_remap m '
                        f' where l.id = m.old_id + {ORPHAN_OFFSET}'
                    )
                    self.stdout.write(f"renumbered {cur.rowcount} profile(s)")

                    # Children, in the same two passes as the parent and for
                    # the same reason. A straight update collides wherever a
                    # child's target id is another child's current id -- and on
                    # a table whose PRIMARY KEY is the learner id
                    # (learner_ksb_assignments), that cannot be deferred away,
                    # so parking first is the only thing that works. Set-based
                    # from pre-change values, so each row moves exactly once.
                    for schema, table, column in CHILD_COLUMNS:
                        cur.execute(
                            f'update "{schema}"."{table}" c '
                            f'   set "{column}" = c."{column}" + {ORPHAN_OFFSET} '
                            f' where c."{column}" is not null'
                        )
                    for schema, table, column in CHILD_COLUMNS:
                        cur.execute(
                            f'update "{schema}"."{table}" c set "{column}" = m.new_id '
                            '  from "Learner".learner_id_remap m '
                            f' where c."{column}" = m.old_id + {ORPHAN_OFFSET}'
                        )
                        self.stdout.write(
                            f"  {schema}.{table}.{column:<22} {cur.rowcount} row(s) followed"
                        )

                    # Children of a profile with no enrolment record were parked
                    # by the first pass above and simply stay there, alongside
                    # their parent. Nothing more to do for them -- but count
                    # them, because a row left above the offset that has no
                    # parked parent would be a dangling reference.
                    for schema, table, column in CHILD_COLUMNS:
                        cur.execute(
                            f'select count(*) from "{schema}"."{table}" c '
                            f' where c."{column}" >= {ORPHAN_OFFSET} '
                            '   and not exists (select 1 from "Learner".learners l '
                            f'                   where l.id = c."{column}")'
                        )
                        dangling = cur.fetchone()[0]
                        if dangling:
                            raise DatabaseError(
                                f"{dangling} row(s) in {schema}.{table}.{column} point at a "
                                "learner that no longer exists. Rolling back."
                            )

                    # A profile created outside the enrolment path must never
                    # land in the enrolment id range and steal somebody's id.
                    cur.execute(
                        "select setval(pg_get_serial_sequence('\"Learner\".learners','id'), "
                        "greatest((select coalesce(max(id), 0) from \"Learner\".learners), %s))",
                        [ORPHAN_OFFSET],
                    )
                    self.stdout.write(f"sequence set to {cur.fetchone()[0]}")
        except DatabaseError as exc:
            self.stderr.write(self.style.ERROR(f"Renumber failed and was rolled back: {exc}"))
            return

        left = rows(
            'select count(*) from "Learner".learners '
            ' where enrolment_id is not null and id <> enrolment_id and id < %s',
            [ORPHAN_OFFSET],
        )[0][0]
        self.stdout.write(self.style.SUCCESS(
            f"\nDone. Profiles still disagreeing with their enrolment id: {left}"
        ))
