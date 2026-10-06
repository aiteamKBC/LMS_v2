"""Add the new declaration without reinterpreting historical outside-hours consent."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Apply/check inside-working-hours declaration columns on learner progress.'

    def add_arguments(self, parser):
        parser.add_argument('--check', action='store_true')

    def handle(self, *args, **options):
        connection = connections['enrolment']
        if connection.vendor != 'postgresql':
            raise CommandError('This command requires PostgreSQL.')
        columns = {
            'inside_working_hours_confirmed': 'boolean not null default false',
            'inside_working_hours_confirmed_at': 'timestamp with time zone null',
        }
        with transaction.atomic(using='enrolment'):
            with connection.cursor() as cursor:
                cursor.execute("select column_name from information_schema.columns where table_schema = 'Learner' and table_name = 'learner_progress_entries'")
                existing = {row[0] for row in cursor.fetchall()}
                if not existing:
                    raise CommandError('Learner.learner_progress_entries is missing.')
                missing = set(columns) - existing
                if options['check'] and missing:
                    raise CommandError('Missing columns: ' + ', '.join(sorted(missing)))
                if not options['check']:
                    for name in sorted(missing):
                        cursor.execute(f'ALTER TABLE "Learner".learner_progress_entries ADD COLUMN IF NOT EXISTS {name} {columns[name]}')
        self.stdout.write(self.style.SUCCESS('Inside-working-hours declaration columns are present.'))
