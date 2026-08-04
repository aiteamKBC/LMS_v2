from django.core.management.base import BaseCommand
from django.db import connections


class Command(BaseCommand):
    help = "Create the encrypted personal-calendar connection store in Neon."

    def handle(self, *args, **options):
        with connections["enrolment"].cursor() as cursor:
            cursor.execute('CREATE SCHEMA IF NOT EXISTS "Learner"')
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS "Learner"."calendar_connections" (
                    id BIGSERIAL PRIMARY KEY,
                    learner_kind TEXT NOT NULL,
                    learner_id BIGINT NOT NULL,
                    provider TEXT NOT NULL,
                    account_email TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'connected',
                    credential_ciphertext TEXT NOT NULL,
                    calendar_url TEXT NOT NULL DEFAULT '',
                    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_sync_at TIMESTAMPTZ NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    CONSTRAINT learner_calendar_provider_unique UNIQUE (learner_kind, learner_id, provider)
                )
            ''')
            cursor.execute('''CREATE INDEX IF NOT EXISTS learner_calendar_owner_idx
                              ON "Learner"."calendar_connections" (learner_kind, learner_id)''')
        self.stdout.write(self.style.SUCCESS("Learner calendar connection table is ready."))
