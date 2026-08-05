from django.core.management.base import BaseCommand
from django.db import connections


class Command(BaseCommand):
    help = "Create the privacy-safe learner calendar busy-slot cache in Neon."

    def handle(self, *args, **options):
        with connections["enrolment"].cursor() as cursor:
            cursor.execute('CREATE SCHEMA IF NOT EXISTS "Learner"')
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS "Learner"."calendar_busy_slots" (
                    id BIGSERIAL PRIMARY KEY,
                    connection_id BIGINT NOT NULL
                        REFERENCES "Learner"."calendar_connections"(id)
                        ON DELETE CASCADE,
                    starts_at TIMESTAMPTZ NOT NULL,
                    ends_at TIMESTAMPTZ NOT NULL,
                    busy_status TEXT NOT NULL DEFAULT 'busy',
                    source_hash TEXT NOT NULL,
                    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT calendar_busy_valid_range CHECK (ends_at > starts_at),
                    CONSTRAINT calendar_busy_slot_unique UNIQUE (connection_id, source_hash)
                )
                '''
            )
            cursor.execute(
                '''CREATE INDEX IF NOT EXISTS calendar_busy_connection_time_idx
                   ON "Learner"."calendar_busy_slots" (connection_id, starts_at, ends_at)'''
            )
        self.stdout.write(self.style.SUCCESS("Learner calendar busy-slot cache is ready."))
