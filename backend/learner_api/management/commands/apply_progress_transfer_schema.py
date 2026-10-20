"""Install/check transfer storage on the externally managed enrolment database."""
from importlib import import_module
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Apply or check the module progress transfer tables.'

    def add_arguments(self, parser):
        parser.add_argument('--check', action='store_true')

    def handle(self, *args, **options):
        connection = connections['enrolment']
        if connection.vendor != 'postgresql':
            raise CommandError('This command requires PostgreSQL.')
        with transaction.atomic(using='enrolment'), connection.cursor() as cursor:
            if not options['check']:
                cursor.execute(import_module('learner_api.migrations.0021_progress_transfer').SQL)
            cursor.execute("SELECT to_regclass(%s),to_regclass(%s)",
                ['"Learner".progress_transfer_requests', '"Learner".progress_transfer_items'])
            if not all(cursor.fetchone()):
                raise CommandError('Progress transfer tables are missing.')
        self.stdout.write(self.style.SUCCESS('Progress transfer tables are present.'))
