"""Review private recording copies and queue confirmed missing files."""

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.session_recording_review import review_ready_recordings


class Command(BaseCommand):
    help = 'Check a small recording slice and queue missing Azure files for the normal worker.'

    def add_arguments(self, parser):
        parser.add_argument('--full', action='store_true', help='Check every ready recording (operator audit).')

    def handle(self, *args, **options):
        result = review_ready_recordings(full=options['full'])
        self.stdout.write(f"Checked {result['checked']} saved recordings; {result['queued']} queued for repair; "
                          f"{result['errors']} need review.")
        if result['errors']:
            raise CommandError('Some saved recordings could not be verified; check worker logs.')
