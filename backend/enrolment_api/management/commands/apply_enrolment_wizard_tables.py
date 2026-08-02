"""Create the per-step tables for the enrolment wizard in the `enrolment` schema.

Idempotent: safe to re-run. Everything is CREATE TABLE / ADD COLUMN / CREATE INDEX
IF NOT EXISTS, so extending a step later means adding a line here rather than
hand-running an ALTER.

Why these exist alongside enrolment."Extended_ILR"."Wizard_draft":
    the draft column is a whole-wizard snapshot — fine for "reopen exactly what
    was typed", useless for questions like "which learners haven't acknowledged
    the safeguarding policy?" or "show every learner rated 'rarely' on K3".
    Anything worth querying or reporting on gets real columns and real rows here;
    the draft column stays as the resume/audit blob.

Tables (all keyed on the learner by (Learner_kind, Learner_id) — the console's
directory spans enrolment."Enrolment_Users" and enrolment."Commercial_users", so
no single foreign key can address both):

    Wizard_Personal_Details   one row per learner; includes the learner's signature
    Wizard_Skills_Radar       one row per learner (the chosen standard)
    Wizard_Ksb_Assessments    one row per KSB assessed
    Wizard_Plr                one row per learner (the ULN)
    Wizard_Plr_Records        one row per prior qualification
    Wizard_Cv_Job             one row per learner
    Wizard_Policy_Acks        one row per policy acknowledged

Run it once:

    python manage.py apply_enrolment_wizard_tables            # apply
    python manage.py apply_enrolment_wizard_tables --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"

# (table, create SQL, [(column, ddl), ...], [index SQL, ...])
TABLES = [
    (
        "Wizard_Personal_Details",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Personal_Details" (
            id             bigserial PRIMARY KEY,
            "Learner_kind" varchar(32) NOT NULL,
            "Learner_id"   bigint      NOT NULL,
            "First_name"   text,
            "Last_name"    text,
            "Email"        text,
            "Phone"        text,
            "Address"      text,
            "Date_of_birth" date,
            "Age"          integer,
            "Sex"          text,
            -- PNG data URL: drawn in the browser or uploaded. Text, not bytea, so
            -- it round-trips to the client exactly as the <img>/PDF needs it.
            "Signature"      text,
            "Signature_date" date,
            "Created_at"   timestamptz NOT NULL DEFAULT now(),
            "Updated_at"   timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [
            ('"Signature"', "text"),
            ('"Signature_date"', "date"),
        ],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_personal_details_learner_uniq '
            'ON enrolment."Wizard_Personal_Details" ("Learner_kind", "Learner_id")',
        ],
    ),
    (
        "Wizard_Skills_Radar",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Skills_Radar" (
            id             bigserial PRIMARY KEY,
            "Learner_kind" varchar(32) NOT NULL,
            "Learner_id"   bigint      NOT NULL,
            "Standard_id"  text,
            "Created_at"   timestamptz NOT NULL DEFAULT now(),
            "Updated_at"   timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_skills_radar_learner_uniq '
            'ON enrolment."Wizard_Skills_Radar" ("Learner_kind", "Learner_id")',
        ],
    ),
    (
        "Wizard_Ksb_Assessments",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Ksb_Assessments" (
            id              bigserial PRIMARY KEY,
            "Learner_kind"  varchar(32) NOT NULL,
            "Learner_id"    bigint      NOT NULL,
            "Ksb_id"        text        NOT NULL,
            -- 8-point self-assessment: mastery | expert | proficient |
            -- consistently | frequently | occasionally | rarely | never
            -- (plus legacy always | often | sometimes)
            "Level"         text,
            -- 8..1 for the level above, denormalised so reporting can average
            -- competence without re-deriving the scale in SQL.
            "Score"         integer,
            "Note"          text,
            "Action_text"   text,
            "Action"        text,
            "Goal"          text,
            "Due_date"      date,
            -- Filenames only; the blobs live in the evidence containers.
            "Evidence_files" jsonb,
            "Created_at"    timestamptz NOT NULL DEFAULT now(),
            "Updated_at"    timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [('"Score"', "integer")],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_ksb_learner_ksb_uniq '
            'ON enrolment."Wizard_Ksb_Assessments" ("Learner_kind", "Learner_id", "Ksb_id")',
            'CREATE INDEX IF NOT EXISTS idx_wizard_ksb_level '
            'ON enrolment."Wizard_Ksb_Assessments" ("Level")',
        ],
    ),
    (
        "Wizard_Plr",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Plr" (
            id             bigserial PRIMARY KEY,
            "Learner_kind" varchar(32) NOT NULL,
            "Learner_id"   bigint      NOT NULL,
            "ULN"          text,
            "Created_at"   timestamptz NOT NULL DEFAULT now(),
            "Updated_at"   timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_plr_learner_uniq '
            'ON enrolment."Wizard_Plr" ("Learner_kind", "Learner_id")',
        ],
    ),
    (
        "Wizard_Plr_Records",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Plr_Records" (
            id                   bigserial PRIMARY KEY,
            "Learner_kind"       varchar(32) NOT NULL,
            "Learner_id"         bigint      NOT NULL,
            -- The client-side record id, so re-saving updates instead of duplicating.
            "Record_ref"         text        NOT NULL,
            "Place_of_study"     text,
            "Qualification_type" text,
            "Subject"            text,
            "Level"              text,
            "Award_date"         date,
            "Credits"            integer,
            "Grade"              text,
            "Record_type"        text,
            "Created_at"         timestamptz NOT NULL DEFAULT now(),
            "Updated_at"         timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_plr_record_uniq '
            'ON enrolment."Wizard_Plr_Records" ("Learner_kind", "Learner_id", "Record_ref")',
        ],
    ),
    (
        "Wizard_Cv_Job",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Cv_Job" (
            id                       bigserial PRIMARY KEY,
            "Learner_kind"           varchar(32) NOT NULL,
            "Learner_id"             bigint      NOT NULL,
            "Cv_file"                text,
            "Experience_text"        text,
            "PM_qualifications"      text,
            "Functional_skills_enrol" text,
            "Created_at"             timestamptz NOT NULL DEFAULT now(),
            "Updated_at"             timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_cv_job_learner_uniq '
            'ON enrolment."Wizard_Cv_Job" ("Learner_kind", "Learner_id")',
        ],
    ),
    (
        "Wizard_Policy_Acks",
        '''
        CREATE TABLE IF NOT EXISTS enrolment."Wizard_Policy_Acks" (
            id             bigserial PRIMARY KEY,
            "Learner_kind" varchar(32) NOT NULL,
            "Learner_id"   bigint      NOT NULL,
            "Policy_id"    text        NOT NULL,
            "Acknowledged" boolean     NOT NULL DEFAULT false,
            "Acknowledged_at" timestamptz,
            "Created_at"   timestamptz NOT NULL DEFAULT now(),
            "Updated_at"   timestamptz NOT NULL DEFAULT now()
        )
        ''',
        [],
        [
            'CREATE UNIQUE INDEX IF NOT EXISTS wizard_policy_ack_uniq '
            'ON enrolment."Wizard_Policy_Acks" ("Learner_kind", "Learner_id", "Policy_id")',
            'CREATE INDEX IF NOT EXISTS idx_wizard_policy_ack_policy '
            'ON enrolment."Wizard_Policy_Acks" ("Policy_id")',
        ],
    ),
]

# Every table gets the learner lookup index.
LEARNER_INDEX = (
    'CREATE INDEX IF NOT EXISTS idx_{slug}_learner '
    'ON enrolment."{table}" ("Learner_kind", "Learner_id")'
)


class Command(BaseCommand):
    help = "Create/patch the enrolment wizard's per-step tables in the enrolment schema."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be created without committing (rolls back).",
        )

    def _tables(self, cur):
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='enrolment' AND table_name LIKE 'Wizard_%' "
            "ORDER BY table_name"
        )
        return [r[0] for r in cur.fetchall()]

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()
                cur.execute("CREATE SCHEMA IF NOT EXISTS enrolment")

                self.stdout.write("\n===== BEFORE =====")
                before = self._tables(cur)
                self.stdout.write("  " + (", ".join(before) if before else "(no Wizard_* tables)"))

                for table, create_sql, columns, indexes in TABLES:
                    cur.execute(create_sql)
                    for name, ddl in columns:
                        cur.execute(
                            f'ALTER TABLE enrolment."{table}" ADD COLUMN IF NOT EXISTS {name} {ddl}'
                        )
                    cur.execute(
                        LEARNER_INDEX.format(slug=table.lower().replace('"', ""), table=table)
                    )
                    for index_sql in indexes:
                        cur.execute(index_sql)
                    self.stdout.write(self.style.SUCCESS(f"  ok  enrolment.\"{table}\""))

                self.stdout.write("\n===== AFTER =====")
                for name in self._tables(cur):
                    cur.execute(
                        "SELECT count(*) FROM information_schema.columns "
                        "WHERE table_schema='enrolment' AND table_name=%s",
                        [name],
                    )
                    self.stdout.write(f"  {name} ({cur.fetchone()[0]} columns)")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
