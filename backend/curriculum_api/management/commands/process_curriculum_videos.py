"""Drain/recover the durable video queue; does not call Microsoft or send mail."""
import time

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.video_imports import enabled, run_pending


class Command(BaseCommand):
    help = 'Detect saved video changes and process Bunny imports. Use --watch for a durable worker.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true')
        parser.add_argument('--limit', type=int, default=20)

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError('BUNNY_STREAM_ENABLED must be enabled after migrations 0077 and 0078.')
        while True:
            count = run_pending(max(1, min(options['limit'], 100)))
            self.stdout.write(f'Checked {count} pending video imports.')
            if not options['watch']:
                break
            time.sleep(15)
