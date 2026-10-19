from importlib import import_module
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Apply the additive LMS support ticket migration on the enrolment database.'

    def handle(self, *args, **options):
        connection = connections['enrolment']
        if connection.vendor != 'postgresql':
            raise CommandError('This schema command requires PostgreSQL.')
        with transaction.atomic(using='enrolment'), connection.cursor() as cursor:
            cursor.execute(import_module('learner_api.migrations.0022_support_tickets').SQL)
            cursor.execute("SELECT to_regclass('\"Learner\".support_tickets')")
            if not cursor.fetchone()[0]:
                raise CommandError('Support ticket table verification failed.')
        self.stdout.write(self.style.SUCCESS('LMS support ticket schema applied and verified.'))
