"""Mirror KBC attendance rows linked to Last_audit learners."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
import psycopg
from psycopg.rows import dict_row

from audit_api.views import _kbc_attendance_connection_string


TABLE = '"Last_audit"."learner_attendance"'


DDL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    source_key          text PRIMARY KEY,
    learner_id          bigint
                        REFERENCES "Last_audit"."learners" (learner_id)
                        ON DELETE CASCADE,
    aptem_id            bigint NOT NULL,
    attendance_date     date,
    attendance_value    integer,
    module              text,
    activity_hours      numeric,
    attendance_status   text,
    lecture_name        text,
    source_created_at   timestamptz,
    synced_at           timestamptz NOT NULL DEFAULT now()
)
"""


UPSERT = f"""
INSERT INTO {TABLE} (
    source_key, learner_id, aptem_id, attendance_date, attendance_value,
    module, activity_hours, attendance_status, lecture_name, source_created_at,
    synced_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
ON CONFLICT (source_key) DO UPDATE SET
    learner_id = EXCLUDED.learner_id,
    aptem_id = EXCLUDED.aptem_id,
    attendance_date = EXCLUDED.attendance_date,
    attendance_value = EXCLUDED.attendance_value,
    module = EXCLUDED.module,
    activity_hours = EXCLUDED.activity_hours,
    attendance_status = EXCLUDED.attendance_status,
    lecture_name = EXCLUDED.lecture_name,
    source_created_at = EXCLUDED.source_created_at,
    synced_at = now()
"""


class Command(BaseCommand):
    help = "Create and sync Last_audit.learner_attendance from AiTeamKBC.kbc_attendance."

    def handle(self, *args, **options):
        source_dsn = _kbc_attendance_connection_string()
        if not source_dsn:
            raise CommandError("KBCDATABASE is not configured.")

        alias = "audit" if "audit" in connections else "default"
        with connections[alias].cursor() as cursor:
            cursor.execute(
                'SELECT aptem_id, learner_id FROM "Last_audit"."learners" '
                'WHERE aptem_id IS NOT NULL'
            )
            learner_by_aptem = {
                int(aptem_id): int(learner_id) if learner_id is not None else None
                for aptem_id, learner_id in cursor.fetchall()
            }
        if not learner_by_aptem:
            raise CommandError("Last_audit has no Aptem-linked learners.")

        with psycopg.connect(source_dsn, row_factory=dict_row) as source:
            with source.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT "ID" AS aptem_id, "key" AS source_key, date AS attendance_date,
                           "Attendance" AS attendance_value, module,
                           activity AS activity_hours, attendance_status,
                           lecture_name, created_at AS source_created_at
                    FROM public.kbc_attendance
                    WHERE "ID" = ANY(%s) AND "key" IS NOT NULL
                    ORDER BY "key"
                    """,
                    (list(learner_by_aptem),),
                )
                source_rows = list(cursor.fetchall())

        if not source_rows:
            # An empty result almost certainly means a broken/misdirected source
            # connection; deleting the whole mirror on it would destroy data.
            raise CommandError(
                "kbc_attendance returned no rows for the synced learners; "
                "refusing to wipe the mirror."
            )

        rows = [
            (
                row["source_key"],
                learner_by_aptem[int(row["aptem_id"])],
                int(row["aptem_id"]),
                row["attendance_date"],
                row["attendance_value"],
                row["module"],
                row["activity_hours"],
                row["attendance_status"],
                row["lecture_name"],
                row["source_created_at"],
            )
            for row in source_rows
        ]

        with transaction.atomic(using=alias):
            with connections[alias].cursor() as cursor:
                cursor.execute(DDL)
                # Existing installs originally required an LMS learner. Aptem
                # is now canonical, so attendance may exist before an LMS match.
                cursor.execute(f"ALTER TABLE {TABLE} ALTER COLUMN learner_id DROP NOT NULL")
                cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_la_attendance_learner_date ON {TABLE} (learner_id, attendance_date)")
                cursor.execute(f"CREATE INDEX IF NOT EXISTS idx_la_attendance_aptem ON {TABLE} (aptem_id)")
                cursor.executemany(UPSERT, rows)
                # The source deletes and re-keys rows; an upsert-only mirror
                # keeps those forever and drifts. Full-replace per synced
                # learner: drop mirror rows whose key the source no longer has.
                cursor.execute(
                    f"""
                    DELETE FROM {TABLE}
                    WHERE aptem_id = ANY(%s)
                      AND NOT (source_key = ANY(%s))
                    """,
                    [list(learner_by_aptem), [row[0] for row in rows]],
                )
                deleted = cursor.rowcount

        self.stdout.write(self.style.SUCCESS(
            f"Synced {len(rows)} attendance rows for {len(learner_by_aptem)} "
            f"Aptem learners; removed {deleted} stale mirror rows."
        ))
