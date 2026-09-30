"""Add the declared-completion columns without touching the legacy declarations.

``submitted_at`` keeps the real Finish click. These two columns hold the working
instant the learner declared when that click failed the working rules, and the
reason it failed. Existing ``inside_working_hours_confirmed`` /
``outside_working_hours_confirmed`` rows are left exactly as they are: they
record a consent that was asked for at the time and mean what they meant.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Apply/check declared-completion columns on learner progress.'

    def add_arguments(self, parser):
        parser.add_argument('--check', action='store_true')

    def handle(self, *args, **options):
        connection = connections['enrolment']
        if connection.vendor != 'postgresql':
            raise CommandError('This command requires PostgreSQL.')
        columns = {
            'declared_completed_at': 'timestamp with time zone null',
            'submission_validation_reason': 'varchar(32) not null default \'\'',
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
        self.stdout.write(self.style.SUCCESS('Declared-completion columns are present.'))
