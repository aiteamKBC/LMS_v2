from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from learner_api.monthly_actual_cache import (
    refresh_invalidated,
    refresh_learner,
    sync_completed_hours,
)


class Command(BaseCommand):
    help = 'Refresh canonical monthly actual snapshots from the durable invalidation queue.'
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--learner-profile-id', action='append', type=int, dest='profile_ids')
        parser.add_argument('--limit', type=int, default=25)
        parser.add_argument('--sync-completed-hours', action='store_true')
        parser.add_argument('--expected-branch-id', required=True)

    def handle(self, *args, **options):
        database = 'enrolment'
        connection = connections[database]
        if connection.vendor != 'postgresql':
            raise CommandError('Monthly actual refresh requires the PostgreSQL application database.')
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_setting('neon.branch_id',true)")
            branch_id = cursor.fetchone()[0]
        if branch_id != options['expected_branch_id']:
            raise CommandError('Database branch does not match --expected-branch-id; nothing written.')
        profile_ids = sorted(set(options.get('profile_ids') or []))
        if options['sync_completed_hours'] and not profile_ids:
            raise CommandError('--sync-completed-hours requires an exact --learner-profile-id.')
        if profile_ids:
            for profile_id in profile_ids:
                if options['sync_completed_hours']:
                    result = sync_completed_hours(profile_id, database=database)
                    self.stdout.write(f"Profile {profile_id}: completed_hours {result['before']} -> {result['after']}")
                result = refresh_learner(profile_id, database=database)
                self.stdout.write(f"Profile {profile_id}: refreshed {result['updated']} monthly rows")
            return
        counts = refresh_invalidated(limit=options['limit'], database=database)
        self.stdout.write(
            f"Refreshed {counts['refreshed']}; busy {counts['busy']}; failed {counts['failed']}."
        )
