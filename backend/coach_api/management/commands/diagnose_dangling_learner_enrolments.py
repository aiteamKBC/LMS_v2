"""Report dangling enrolment references without modifying records."""
import json
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


class Command(BaseCommand):
    help = 'Read-only report of learner enrolment IDs missing from Created_users.'
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--database', default='enrolment')

    def handle(self, *args, **options):
        alias = options['database']
        if alias not in connections or connections[alias].vendor != 'postgresql':
            raise CommandError('Diagnostic requires the configured PostgreSQL enrolment database.')
        with transaction.atomic(using=alias):
            with connections[alias].cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute('''SELECT l.id, l.enrolment_id
                    FROM "Learner"."learners" l
                    LEFT JOIN enrolment."Created_users" e ON e.id = l.enrolment_id
                    WHERE l.enrolment_id IS NOT NULL AND e.id IS NULL
                    ORDER BY l.id''')
                rows = [{'learnerProfileId': str(row[0]), 'enrolmentId': str(row[1])}
                        for row in cursor.fetchall()]
        self.stdout.write(json.dumps({'count': len(rows), 'references': rows}))
