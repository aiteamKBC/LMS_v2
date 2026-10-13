"""Provision the append-only historical assessment marking table."""
from django.core.management.base import BaseCommand
from django.db import connections


class Command(BaseCommand):
    help = 'Create the LMS review ledger for historical Aptem assignments.'

    def handle(self, *args, **options):
        target = connections['enrolment'].settings_dict
        self.stdout.write(f"Target: {target['HOST']} / {target['NAME']}")
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('''create table if not exists login."Advanced_admin_legacy_marks" (
                id bigint generated always as identity primary key,
                aptem_id text not null,
                evidence_id bigint not null,
                decision varchar(16) not null check
                    (decision in ('accepted','partial','referred','escalated','rejected')),
                feedback text not null,
                reviewed_by text not null,
                reviewer_account_id bigint not null,
                reviewed_at timestamptz not null default now()
            )''')
            cursor.execute('''create index if not exists advanced_admin_legacy_marks_lookup
                on login."Advanced_admin_legacy_marks" (aptem_id, evidence_id, reviewed_at, id)''')
        self.stdout.write(self.style.SUCCESS('Historical assessment review ledger is available.'))
