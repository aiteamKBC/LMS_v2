"""Create the ``login`` schema and its five tables on the enrolment database.

Run once per environment (it is re-runnable and additive):

    python manage.py apply_login_tables
    python manage.py apply_login_tables --dry-run   # rehearse, roll back

Follows the same shape as apply_staff_users_table and the other enrolment DDL
commands: idempotent CREATE ... IF NOT EXISTS, then ADD COLUMN IF NOT EXISTS for
anything added after the first release, all inside one transaction that --dry-run
rolls back. Django never migrates this database (EnrolmentRouter.allow_migrate
returns False for it), so the DDL lives here rather than in a migration.

Why the indexes are what they are
---------------------------------
* ``Email`` is uniquely indexed on ``lower(btrim(...))`` per subject_type, not on
  the raw column: the enrolment tables already hold addresses with stray case and
  whitespace, and "the same person" must not be able to hold two accounts of the
  same kind. It is not globally unique because one human can legitimately be both
  an employer contact and a staff member.
* ``(Subject_type, Subject_id)`` is uniquely indexed so a learner row cannot
  acquire a second login account.
* The token tables index ``Token_hash`` uniquely — that column is the lookup key
  for every redemption, and the uniqueness is what makes a token single-use.

The schema is ``login`` rather than ``auth``: Neon reserves an ``auth`` schema
owned by ``cloud_admin``, which the application role cannot create tables in.
"""
from django.core.management.base import BaseCommand
from django.db import connections, transaction

CONN = "enrolment"
SCHEMA = "login"


class Command(BaseCommand):
    help = 'Create the "login" schema and account/session/invitation/reset/audit tables.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show the resulting tables without committing (rolls back).",
        )

    def _tables(self, cur):
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema=%s ORDER BY table_name",
            [SCHEMA],
        )
        return [r[0] for r in cur.fetchall()]

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        conn = connections[CONN]

        try:
            with transaction.atomic(using=CONN):
                cur = conn.cursor()

                existing = self._tables(cur)
                self.stdout.write(
                    f'\nSchema "{SCHEMA}" currently has {len(existing)} table(s): '
                    f'{existing or "none"}'
                )

                cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"')

                # --- accounts -------------------------------------------------
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS "{SCHEMA}"."Login_accounts" (
                        id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Subject_type"    text NOT NULL,
                        "Subject_id"      bigint NOT NULL,
                        "Email"           text NOT NULL,
                        "Display_name"    text,
                        "Role"            text NOT NULL,
                        "Password_hash"   text NOT NULL DEFAULT '',
                        "Password_set_at" timestamptz,
                        "Is_active"       boolean NOT NULL DEFAULT true,
                        "Failed_attempts" integer NOT NULL DEFAULT 0,
                        "Locked_until"    timestamptz,
                        "Last_login_at"   timestamptz,
                        "Last_login_ip"   text,
                        "Created_at"      timestamptz NOT NULL DEFAULT now(),
                        "Updated_at"      timestamptz NOT NULL DEFAULT now(),
                        CONSTRAINT login_accounts_subject_type_check
                            CHECK ("Subject_type" IN ('learner','employer','staff')),
                        CONSTRAINT login_accounts_role_check
                            CHECK ("Role" IN ('admin','staff','employer','learner'))
                    )
                ''')
                cur.execute(
                    f'CREATE UNIQUE INDEX IF NOT EXISTS login_accounts_email_kind_idx '
                    f'ON "{SCHEMA}"."Login_accounts" ("Subject_type", lower(btrim("Email")))'
                )
                cur.execute(
                    f'CREATE UNIQUE INDEX IF NOT EXISTS login_accounts_subject_idx '
                    f'ON "{SCHEMA}"."Login_accounts" ("Subject_type", "Subject_id")'
                )
                # Sign-in resolves an address without yet knowing which kind of
                # account it is, so the lookup is on the normalised email alone.
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_accounts_email_lookup_idx '
                    f'ON "{SCHEMA}"."Login_accounts" (lower(btrim("Email")))'
                )

                # --- sessions -------------------------------------------------
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS "{SCHEMA}"."Login_sessions" (
                        id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Account_id"   bigint NOT NULL
                            REFERENCES "{SCHEMA}"."Login_accounts"(id) ON DELETE CASCADE,
                        "Token_hash"   varchar(64) NOT NULL UNIQUE,
                        "Expires_at"   timestamptz NOT NULL,
                        "Revoked_at"   timestamptz,
                        "Ip_address"   text,
                        "User_agent"   text,
                        "Created_at"   timestamptz NOT NULL DEFAULT now(),
                        "Last_seen_at" timestamptz
                    )
                ''')
                # Supports "revoke every session for this account" on password
                # change and account deactivation.
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_sessions_account_idx '
                    f'ON "{SCHEMA}"."Login_sessions" ("Account_id")'
                )
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_sessions_expiry_idx '
                    f'ON "{SCHEMA}"."Login_sessions" ("Expires_at")'
                )

                # --- invitations ---------------------------------------------
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS "{SCHEMA}"."Invitations" (
                        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Account_id"  bigint NOT NULL
                            REFERENCES "{SCHEMA}"."Login_accounts"(id) ON DELETE CASCADE,
                        "Token_hash"  varchar(64) NOT NULL UNIQUE,
                        "Email"       text NOT NULL,
                        "Expires_at"  timestamptz NOT NULL,
                        "Used_at"     timestamptz,
                        "Invited_by"  text,
                        "Sent_at"     timestamptz,
                        "Send_error"  text,
                        "Created_at"  timestamptz NOT NULL DEFAULT now(),
                        "Created_ip"  text
                    )
                ''')
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS invitations_account_idx '
                    f'ON "{SCHEMA}"."Invitations" ("Account_id")'
                )

                # --- password resets -----------------------------------------
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS "{SCHEMA}"."Password_resets" (
                        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Account_id"  bigint NOT NULL
                            REFERENCES "{SCHEMA}"."Login_accounts"(id) ON DELETE CASCADE,
                        "Token_hash"  varchar(64) NOT NULL UNIQUE,
                        "Email"       text NOT NULL,
                        "Expires_at"  timestamptz NOT NULL,
                        "Used_at"     timestamptz,
                        "Sent_at"     timestamptz,
                        "Send_error"  text,
                        "Created_at"  timestamptz NOT NULL DEFAULT now(),
                        "Created_ip"  text
                    )
                ''')
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS password_resets_account_idx '
                    f'ON "{SCHEMA}"."Password_resets" ("Account_id")'
                )
                # Rate limiting counts recent rows per address.
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS password_resets_email_created_idx '
                    f'ON "{SCHEMA}"."Password_resets" (lower(btrim("Email")), "Created_at" DESC)'
                )

                # --- audit ----------------------------------------------------
                # No FK to Login_accounts: a failed attempt against an address
                # with no account is exactly the event worth keeping.
                cur.execute(f'''
                    CREATE TABLE IF NOT EXISTS "{SCHEMA}"."Login_audit" (
                        id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                        "Event"      text NOT NULL,
                        "Email"      text,
                        "Account_id" bigint,
                        "Succeeded"  boolean NOT NULL DEFAULT false,
                        "Reason"     text,
                        "Ip_address" text,
                        "User_agent" text,
                        "Created_at" timestamptz NOT NULL DEFAULT now()
                    )
                ''')
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_audit_email_created_idx '
                    f'ON "{SCHEMA}"."Login_audit" (lower(btrim("Email")), "Created_at" DESC)'
                )
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_audit_created_idx '
                    f'ON "{SCHEMA}"."Login_audit" ("Created_at" DESC)'
                )
                # Per-IP throttling counts recent failures from one source.
                cur.execute(
                    f'CREATE INDEX IF NOT EXISTS login_audit_ip_created_idx '
                    f'ON "{SCHEMA}"."Login_audit" ("Ip_address", "Created_at" DESC)'
                )

                self.stdout.write("\n===== TABLES =====")
                for name in self._tables(cur):
                    cur.execute(
                        "SELECT count(*) FROM information_schema.columns "
                        "WHERE table_schema=%s AND table_name=%s",
                        [SCHEMA, name],
                    )
                    self.stdout.write(f'  "{SCHEMA}"."{name}"  ({cur.fetchone()[0]} columns)')

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except Exception as exc:  # noqa: BLE001 - surface any DB/DDL failure clearly
            self.stderr.write(self.style.ERROR(f"Migration failed (rolled back): {exc}"))
            raise
