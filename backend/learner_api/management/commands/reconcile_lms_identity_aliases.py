from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction

from learner_api.lms_alias_reconciliation import apply, inspect
from learner_api.models import LearnerProfile


class Command(BaseCommand):
    help = (
        'Find multi-email LMS identities and consolidate their identities, '
        'course memberships, and completion-only activity lineage into Learner SSOT.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Write the reconciliation to a verified Neon Child Branch.')
        parser.add_argument('--expected-branch-id', default='',
                            help='Exact Neon Child Branch id required with --apply.')

    def handle(self, *args, **options):
        database = router.db_for_write(LearnerProfile) or 'default'
        connection = connections[database]
        try:
            if options['apply']:
                with transaction.atomic(using=database):
                    with connection.cursor() as cursor:
                        result = apply(cursor, options['expected_branch_id'])
                prefix = 'APPLIED'
            else:
                with connection.cursor() as cursor:
                    _, _, result = inspect(cursor)
                prefix = 'DRY RUN'
        except ValueError as error:
            raise CommandError(str(error)) from error
        fields = ' '.join(f'{key}={value}' for key, value in sorted(result.items())
                          if key not in {'branch_id', 'run_key'})
        self.stdout.write(self.style.SUCCESS(f'{prefix} {fields}'))
        if not options['apply']:
            self.stdout.write('No rows were changed. Use --apply only with --expected-branch-id for a Child Branch.')
