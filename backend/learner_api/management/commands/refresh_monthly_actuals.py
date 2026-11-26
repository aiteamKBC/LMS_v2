"""Refresh only the profile IDs explicitly supplied by an operator."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from learner_api.monthly_actuals import refresh


def verify_database(using, expected_branch):
    with connections[using].cursor() as cursor:
        cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
        name, branch = cursor.fetchone()
    if not expected_branch or branch != expected_branch:
        raise CommandError('Database branch does not match --expected-branch; no refresh was run.')
    return name, branch


class Command(BaseCommand):
    help = 'Rebuild monthly actuals for explicit learner profile IDs. No discovery or recurring scan.'

    def add_arguments(self, parser):
        parser.add_argument('--learner-id', action='append', type=int, required=True)
        parser.add_argument('--database', default='enrolment')
        parser.add_argument('--expected-branch', required=True)

    def handle(self, *args, **options):
        ids = sorted(set(options['learner_id']))
        if not ids or len(ids) > 200 or any(not 0 < value < 2**63 for value in ids):
            raise CommandError('Supply between 1 and 200 positive, explicit learner profile IDs.')
        verify_database(options['database'], options['expected_branch'])
        changed, failed = 0, 0
        for ident in ids:
            try:
                changed += refresh(ident, using=options['database'])
            except Exception:
                failed += 1
        if failed:
            raise CommandError(f'Refreshed {changed} monthly target rows; {failed} requested profiles failed. '
                               'Their canonical read fallback remains active. No automatic retry was started.')
        self.stdout.write(self.style.SUCCESS(f'Refreshed {changed} monthly target rows for {len(ids)} requested profiles.'))
