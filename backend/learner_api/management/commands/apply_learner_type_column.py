"""Make "Learner".learners the permanent record for every learner who goes active.

Two things, both about the same table.

1. A ``learner_type`` column
---------------------------
``Learner.learners`` had no way to say whether a learner is apprenticeship or
commercial, so the commercial listing *guessed* from the programme name::

    return "apprentice" in programme or programme.startswith("apm") or ...

That only works while no programme is named something that collides. The
authoritative answer already exists one table over as
``enrolment."Created_users"."Learner_type"``, and since
``apply_learner_enrolment_id`` there is an explicit ``enrolment_id`` to read it
through — so it is copied here rather than inferred.

2. The profiles that were never created
---------------------------------------
The profile is written by ``active_users.sync_active_user``, which
``learner_progression.advance_learner`` calls when a learner **transitions** into
Active. A learner whose status was set to Active directly — by an admin editing
the field, or by being created that way — never passed through that transition
and so never got a row. Most Active learners on this database are in exactly that
position, which is why the table looked as though it held no commercial learners
at all.

This backfills them through ``sync_active_user`` itself rather than with parallel
INSERTs, so they get the same training-plan hydration and KSB snapshot a learner
promoted the normal way would.

Who gets a profile: anyone **at or past** Active — Active, plus the post-active
states (Withdrawn, On break, Completed). Once a learner has gone active they keep
their row for good; a later status change only updates ``lifecycle_status``.
Earlier states (Fresh user, Onboarding, Ready to enrol, Delivery) are left alone,
because they have not become active yet. Existing rows are never removed,
whatever the status.

Idempotent, and ``--dry-run`` shows the plan without writing.

    python manage.py apply_learner_type_column [--dry-run]
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"

#: Statuses meaning "this learner has gone active at some point", so the
#: permanent profile is owed to them. Compared case-insensitively.
ACTIVE_OR_LATER = ("active", "withdrawn", "on break", "completed")


class Command(BaseCommand):
    help = 'Add learners.learner_type and create the profiles active learners are missing.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan and the counts without committing.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                # Neon's pooler hands back sessions another client left
                # read-only; ask for a writable transaction explicitly, as the
                # first statement. See apply_learner_enrolment_id.
                cur.execute("SET TRANSACTION READ WRITE")

                # ---- 1. the column ------------------------------------
                self.stdout.write(self.style.MIGRATE_HEADING("1. Adding learners.learner_type"))
                cur.execute(
                    'ALTER TABLE "Learner"."learners" '
                    'ADD COLUMN IF NOT EXISTS "learner_type" varchar(32)'
                )
                # Constrained at the database level as well as in the API: this
                # column decides which workspace a learner is treated as being
                # on, so an unexpected value must not be storable.
                cur.execute(
                    "SELECT 1 FROM pg_constraint WHERE conname = %s",
                    ["learners_learner_type_check"],
                )
                if cur.fetchone() is None:
                    cur.execute(
                        'ALTER TABLE "Learner"."learners" '
                        'ADD CONSTRAINT "learners_learner_type_check" '
                        'CHECK ("learner_type" IS NULL OR '
                        "lower(btrim(\"learner_type\")) IN ('apprenticeship', 'commercial'))"
                    )
                    self.stdout.write("   + CHECK learners_learner_type_check")
                self.stdout.write("   + learners.learner_type")

                # ---- 2. backfill the type ----------------------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n2. Copying Learner_type from the enrolment record")
                )
                cur.execute(
                    'UPDATE "Learner"."learners" AS l '
                    '   SET "learner_type" = lower(btrim(c."Learner_type")) '
                    '  FROM enrolment."Created_users" AS c '
                    ' WHERE c.id = l."enrolment_id" '
                    "   AND btrim(coalesce(c.\"Learner_type\", '')) <> '' "
                    '   AND l."learner_type" IS DISTINCT FROM lower(btrim(c."Learner_type"))'
                )
                self.stdout.write(f"   set on {cur.rowcount} profile(s)")

                # ---- 3. the missing profiles -------------------------
                self.stdout.write(
                    self.style.MIGRATE_HEADING("\n3. Creating profiles for learners already active")
                )
                placeholders = ", ".join(["%s"] * len(ACTIVE_OR_LATER))
                cur.execute(
                    "SELECT c.id, c.\"Username\", c.\"Learner_type\", c.\"Programme_status\" "
                    '  FROM enrolment."Created_users" AS c '
                    '  LEFT JOIN "Learner"."learners" AS l ON l."enrolment_id" = c.id '
                    " WHERE l.id IS NULL "
                    f"   AND lower(btrim(coalesce(c.\"Programme_status\", ''))) IN ({placeholders}) "
                    " ORDER BY c.id",
                    list(ACTIVE_OR_LATER),
                )
                owed = cur.fetchall()

                if not owed:
                    self.stdout.write("   every active learner already has one")
                else:
                    self.stdout.write(f"   {len(owed)} learner(s) owed a profile:")
                    for cid, name, kind, status in owed:
                        self.stdout.write(
                            f"      Created_users.id={cid:<5} {(name or '')[:28]:<28} "
                            f"{kind or '(unset)':<15} {status}"
                        )

                    # Routed through the real promotion path so these learners
                    # get the same plan and KSB snapshot as any other, rather
                    # than a bare row that later code would find half-built.
                    from ...active_users import sync_active_user
                    from ...models import EnrolmentUser

                    created = failed = 0
                    for cid, name, _kind, _status in owed:
                        source = EnrolmentUser.all_learners.filter(pk=cid).first()
                        if source is None:
                            continue
                        try:
                            sync_active_user(source)
                            created += 1
                        except Exception as exc:  # noqa: BLE001
                            failed += 1
                            self.stdout.write(
                                self.style.ERROR(
                                    f"      id={cid} could not be synced: {str(exc)[:120]}"
                                )
                            )
                    self.stdout.write(f"   synced {created}, failed {failed}")

                    # sync_active_user does not know about learner_type, so the
                    # rows it just made need the same copy step as step 2.
                    cur.execute(
                        'UPDATE "Learner"."learners" AS l '
                        '   SET "learner_type" = lower(btrim(c."Learner_type")) '
                        '  FROM enrolment."Created_users" AS c '
                        ' WHERE c.id = l."enrolment_id" '
                        "   AND btrim(coalesce(c.\"Learner_type\", '')) <> '' "
                        '   AND l."learner_type" IS NULL'
                    )
                    if cur.rowcount:
                        self.stdout.write(f"   typed {cur.rowcount} newly created profile(s)")

                # ---- 4. where we ended up ----------------------------
                self.stdout.write(self.style.MIGRATE_HEADING("\n4. Result"))
                cur.execute(
                    'SELECT coalesce("learner_type", \'(unset)\'), lifecycle_status, count(*) '
                    '  FROM "Learner"."learners" GROUP BY 1, 2 ORDER BY 1, 2'
                )
                for kind, life, count in cur.fetchall():
                    self.stdout.write(f"   {kind:<16} {life or '(none)':<12} {count}")

                cur.execute(
                    'SELECT count(*) FROM "Learner"."learners" WHERE "learner_type" IS NULL'
                )
                untyped = cur.fetchone()[0]
                if untyped:
                    self.stdout.write(
                        self.style.WARNING(
                            f"\n   {untyped} profile(s) still untyped — these have no enrolment "
                            "record to read it from (see apply_learner_enrolment_id's orphan list)."
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
