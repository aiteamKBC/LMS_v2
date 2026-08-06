"""Add enrolment."Created_users"."Employer_id" — the learner's employer record.

The learner table already holds "Employer" and "Orgnization" as free text, which
is what the create form wrote before employer profiles existed. Those names are
a label, not a reference: two employers can share a name, a renamed employer
leaves the learner pointing at a string that no longer matches any record, and
there is no way to get from a learner to the rest of their employer's data
(address, mobile, organisation membership).

This adds the actual reference. "Employer_id" points at enrolment."Employers".id,
so a learner row can reach its employer's full record. The text columns stay:
they carry historical values for learners created before this existed, and the
create form still writes them so a plain listing needs no join.

A real FK is deliberately NOT used. These tables are unmanaged (created by these
apply_* commands, never by a Django migration), and the sibling link —
Employers."Employer_group_ids" -> Organisations — is id-in-jsonb for the same
reason. Referential integrity is enforced in the API, which rejects an unknown
employer id on write.

Run it once:

    python manage.py apply_created_users_employer_id            # apply
    python manage.py apply_created_users_employer_id --dry-run  # show plan only

`--backfill` additionally matches existing learners to an employer by name, for
rows written before this column existed. Only unambiguous matches are filled: a
name that resolves to two employer records is skipped and reported, because
guessing which one would silently attach the learner to the wrong company.
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
TABLE = 'enrolment."Created_users"'
COLUMN = "Employer_id"


class Command(BaseCommand):
    help = 'Add enrolment."Created_users"."Employer_id", referencing enrolment."Employers".'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the plan without committing (rolls back).",
        )
        parser.add_argument(
            "--backfill",
            action="store_true",
            help='Match existing rows to an employer by "Employer" name where unambiguous.',
        )

    def _column(self, cur):
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema='enrolment' AND table_name='Created_users' "
            "AND column_name=%s",
            [COLUMN],
        )
        return cur.fetchone()

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        backfill = options["backfill"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                # Employers must exist first — this column is meaningless without it.
                cur.execute(
                    "SELECT 1 FROM information_schema.tables "
                    "WHERE table_schema='enrolment' AND table_name='Employers'"
                )
                if not cur.fetchone():
                    self.stderr.write(self.style.ERROR(
                        'enrolment."Employers" does not exist. '
                        "Run `manage.py apply_employer_tables` first."
                    ))
                    return

                existed = bool(self._column(cur))
                self.stdout.write(
                    f'\n{TABLE}."{COLUMN}" '
                    f"{'already exists — leaving as is' if existed else 'does not exist — adding'}"
                )

                cur.execute(f'ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS "{COLUMN}" integer')
                # Looked up learner-by-employer ("who works at this employer?"),
                # which is a filtered scan without an index.
                cur.execute(
                    'CREATE INDEX IF NOT EXISTS enrolment_created_users_employer_id_idx '
                    f'ON enrolment."Created_users" ("{COLUMN}")'
                )

                if backfill:
                    self._backfill(cur)

                cur.execute(
                    f'SELECT count(*) FROM {TABLE} WHERE "{COLUMN}" IS NOT NULL'
                )
                linked = cur.fetchone()[0]
                cur.execute(f"SELECT count(*) FROM {TABLE}")
                total = cur.fetchone()[0]
                self.stdout.write(f"\n{linked} of {total} learner row(s) linked to an employer.")
                self.stdout.write(f'  column: {self._column(cur)}')

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise

    def _backfill(self, cur):
        """Link existing learners to an employer by name, where unambiguous.

        Matched on the trimmed, case-folded name, since the learner's "Employer"
        was typed free-hand and won't reliably match an employer record's exact
        capitalisation.
        """
        self.stdout.write("\n===== BACKFILL =====")

        # Names that resolve to more than one employer record can't be matched
        # safely — report them rather than picking one.
        cur.execute('''
            SELECT lower(btrim(coalesce("First_name",'') || ' ' || coalesce("Surname",''))) AS key,
                   count(*) AS n
            FROM enrolment."Employers"
            GROUP BY key
            HAVING count(*) > 1
        ''')
        ambiguous = cur.fetchall()
        for key, n in ambiguous:
            self.stdout.write(self.style.WARNING(
                f'  skipping "{key}" — {n} employer records share that name'
            ))

        cur.execute(f'''
            UPDATE {TABLE} AS c
            SET "{COLUMN}" = e.id
            FROM (
                SELECT lower(btrim(coalesce("First_name",'') || ' ' || coalesce("Surname",''))) AS key,
                       min(id) AS id
                FROM enrolment."Employers"
                GROUP BY key
                HAVING count(*) = 1
            ) AS e
            WHERE c."{COLUMN}" IS NULL
              AND btrim(coalesce(c."Employer", '')) <> ''
              AND lower(btrim(c."Employer")) = e.key
        ''')
        self.stdout.write(f"  linked {cur.rowcount} row(s) by name")

        # Anything still unlinked but with a name is worth surfacing: it means the
        # learner names an employer that has no profile record.
        cur.execute(f'''
            SELECT DISTINCT btrim("Employer")
            FROM {TABLE}
            WHERE "{COLUMN}" IS NULL AND btrim(coalesce("Employer", '')) <> ''
            ORDER BY 1
        ''')
        unmatched = [r[0] for r in cur.fetchall()]
        if unmatched:
            self.stdout.write(
                f"  {len(unmatched)} employer name(s) with no matching profile record:"
            )
            for name in unmatched[:20]:
                self.stdout.write(f"    - {name}")
            if len(unmatched) > 20:
                self.stdout.write(f"    … and {len(unmatched) - 20} more")
