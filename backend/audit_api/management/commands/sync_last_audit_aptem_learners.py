"""Make Last_audit.learners Aptem-complete without inventing LMS ids."""

from django.core.management.base import BaseCommand
from django.db import connections, transaction


LEARNERS = '"Last_audit"."learners"'
ATTENDANCE = '"Last_audit"."learner_attendance"'
MATCH = '"Audit"."learner_match"'


class Command(BaseCommand):
    help = "Migrate Last_audit.learners to Aptem-first identity and sync every Aptem learner."

    def handle(self, *args, **options):
        alias = "audit" if "audit" in connections else "default"
        with transaction.atomic(using=alias):
            with connections[alias].cursor() as cursor:
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS record_id bigserial")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS lms_learner_name text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS lms_learner_email text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS programme_name text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS programme_status text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS coach_name text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS coach_email text")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD COLUMN IF NOT EXISTS declared_lms_id bigint")
                cursor.execute(f"UPDATE {LEARNERS} SET lms_learner_name=learner_name WHERE lms_learner_name IS NULL")
                cursor.execute(f"UPDATE {LEARNERS} SET lms_learner_email=learner_email WHERE lms_learner_email IS NULL")

                # The attendance FK originally depended on learners_pkey.
                cursor.execute(f"ALTER TABLE {ATTENDANCE} DROP CONSTRAINT IF EXISTS learner_attendance_learner_id_fkey")
                cursor.execute(f"ALTER TABLE {LEARNERS} DROP CONSTRAINT IF EXISTS learners_pkey")
                cursor.execute(f"ALTER TABLE {LEARNERS} ALTER COLUMN learner_id DROP NOT NULL")
                cursor.execute(f"ALTER TABLE {LEARNERS} ALTER COLUMN record_id SET NOT NULL")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD CONSTRAINT learners_pkey PRIMARY KEY (record_id)")
                cursor.execute(f"ALTER TABLE {LEARNERS} DROP CONSTRAINT IF EXISTS learners_learner_id_key")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD CONSTRAINT learners_learner_id_key UNIQUE (learner_id)")
                cursor.execute(f"ALTER TABLE {LEARNERS} DROP CONSTRAINT IF EXISTS learners_aptem_id_key")
                cursor.execute(f"ALTER TABLE {LEARNERS} ADD CONSTRAINT learners_aptem_id_key UNIQUE (aptem_id)")

                # Existing matched rows keep their real LMS id. Aptem-only rows
                # get learner_id=NULL; no synthetic/colliding LMS id is created.
                cursor.execute(f"""
                    INSERT INTO {LEARNERS} (
                        learner_id, aptem_id, learner_name, learner_email,
                        programme_name, declared_lms_id, first_seen, last_seen
                    )
                    SELECT verified.learner_id, m.aptem_id, m.learner_name,
                           m.learner_email, m.programme_name, m.lms_id, now(), now()
                    FROM {MATCH} m
                    LEFT JOIN {LEARNERS} verified
                      ON verified.learner_id = m.lms_id
                     AND verified.aptem_id = m.aptem_id
                    WHERE m.aptem_id IS NOT NULL
                    ON CONFLICT (aptem_id) DO UPDATE SET
                        learner_name = EXCLUDED.learner_name,
                        learner_email = EXCLUDED.learner_email,
                        programme_name = EXCLUDED.programme_name,
                        declared_lms_id = EXCLUDED.declared_lms_id,
                        learner_id = COALESCE(EXCLUDED.learner_id, {LEARNERS}.learner_id),
                        last_seen = now()
                """)

                cursor.execute(f"""
                    UPDATE {ATTENDANCE} a
                    SET learner_id = l.learner_id
                    FROM {LEARNERS} l
                    WHERE l.aptem_id = a.aptem_id
                      AND a.learner_id IS DISTINCT FROM l.learner_id
                """)
                cursor.execute(f"""
                    UPDATE {LEARNERS} l
                    SET programme_status = COALESCE((
                        SELECT NULLIF(btrim(p.program_status), '')
                        FROM fetching_evidence.aptem_cv_contracts_probe p
                        WHERE p.learner_id = l.aptem_id
                        ORDER BY p.fetched_at DESC NULLS LAST, p.id DESC
                        LIMIT 1
                    ), 'Unknown')
                    WHERE l.aptem_id IS NOT NULL
                """)
                cursor.execute(f"""
                    UPDATE {LEARNERS} l
                    SET coach_name = NULLIF(btrim(u."OwnerName"), ''),
                        coach_email = NULLIF(btrim(u."OwnerEmail"), '')
                    FROM "LMS"."Aptem_users" u
                    WHERE u."ID" = l.aptem_id
                """)
                cursor.execute(f"""
                    ALTER TABLE {ATTENDANCE}
                    ADD CONSTRAINT learner_attendance_learner_id_fkey
                    FOREIGN KEY (learner_id) REFERENCES {LEARNERS} (learner_id)
                    ON DELETE SET NULL
                """)

                cursor.execute(f"SELECT count(*), count(learner_id), count(*) FILTER (WHERE learner_id IS NULL) FROM {LEARNERS} WHERE aptem_id IS NOT NULL")
                total, lms_matched, aptem_only = cursor.fetchone()

        self.stdout.write(self.style.SUCCESS(
            f"Last_audit.learners now has {total} Aptem learners: "
            f"{lms_matched} with LMS ids, {aptem_only} Aptem-only."
        ))
