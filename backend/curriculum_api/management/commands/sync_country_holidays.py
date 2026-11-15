"""Run daily to refresh saved country/year caches before their 30-day expiry."""
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = __doc__

    def add_arguments(self, parser):
        parser.add_argument('--force', action='store_true')

    def handle(self, *args, **options):
        from curriculum_api.country_calendars import sync_saved
        results = sync_saved(due_only=not options['force'])
        failures = [row for row in results if row['status'] != 'ok']
        self.stdout.write(f'Country calendars checked: {len(results)}; failures: {len(failures)}')
        if failures:
            raise CommandError('Some calendars could not be refreshed. Inspect Holiday Calendars for details.')
