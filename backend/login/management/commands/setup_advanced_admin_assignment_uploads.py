"""Provision private Advanced Admin assignment uploads on the enrolment DB."""
from django.core.management.base import BaseCommand
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Create the Advanced Admin-only assignment upload table; dry-run by default.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        target = connections['enrolment'].settings_dict
        self.stdout.write(f"Target database: {target['NAME']} (enrolment alias)")
        if not options['apply']:
            self.stdout.write('Dry run; no changes made.')
            return
        with transaction.atomic(using='enrolment'):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('''create table if not exists login."Advanced_admin_assignment_uploads" (
                    id uuid primary key,
                    aptem_id text not null,
                    learner_profile_id bigint not null,
                    month_key varchar(7) not null
                        check (month_key ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
                    title varchar(250) not null,
                    actual_hours numeric(8,2) not null check (actual_hours > 0),
                    original_filename varchar(512) not null,
                    content_type varchar(255) not null,
                    size_bytes bigint not null check (size_bytes > 0),
                    sha256 char(64) not null,
                    container varchar(128) not null,
                    blob_name varchar(1024) not null unique,
                    uploaded_by varchar(255) not null,
                    uploaded_at timestamptz not null default now(),
                    unique (aptem_id, month_key, sha256)
                )''')
                cursor.execute('''create index if not exists idx_advanced_admin_assignment_learner_month
                    on login."Advanced_admin_assignment_uploads"
                    (learner_profile_id, month_key desc)''')
                cursor.execute('''select to_regclass('login."Advanced_admin_assignment_uploads"')''')
                if cursor.fetchone()[0] is None:
                    raise RuntimeError('Assignment upload table was not created.')
        self.stdout.write('Advanced Admin assignment upload table is available.')
