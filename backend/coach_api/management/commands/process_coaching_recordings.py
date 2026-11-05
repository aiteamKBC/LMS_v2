from django.core.management.base import BaseCommand, CommandError
from coach_api.recordings_jobs import run_one


class Command(BaseCommand):
    help = 'Process durable coach calendar/evidence jobs; recordings stay in SharePoint.'

    def add_arguments(self, parser):
        parser.add_argument('--coach-email', default='')
        parser.add_argument('--kind', choices=('metadata', 'archive', 'all'), default='metadata')
        parser.add_argument('--limit', type=int, default=100)

    def handle(self, **options):
        if options['limit'] < 1:
            raise CommandError('Choose a positive job limit.')
        if options['kind'] == 'archive':
            raise CommandError('Coach calendar recordings use SharePoint only; Azure copying is disabled.')
        kinds = ('calendar', 'evidence', 'attendance')
        count = failures = 0
        while count < options['limit']:
            status = run_one(kinds, owner=options['coach_email'].strip().casefold() or None)
            if status is None:
                break
            count += 1
            failures += status == 'failed'
        self.stdout.write(f'Processed {count} job(s); failed={failures}. Inspect calendar/evidence status for acceptance.')
        if failures:
            raise CommandError('Some coaching recording jobs failed. Previous evidence and retry state were retained.')
