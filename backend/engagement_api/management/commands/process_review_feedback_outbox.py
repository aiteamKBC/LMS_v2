"""Explicit local-sandbox command. Never scheduled or called by HTTP entrypoints."""
import json

from django.core.management.base import BaseCommand, CommandError

from engagement_api.review_feedback_consumer import ConsumerSafetyError, process_once


class Command(BaseCommand):
    help = 'Run one bounded Review outbox pass on a marked local test database only; defaults to preview.'
    # The command performs its own strict target checks. Global application
    # checks must not issue database queries before that sandbox gate.
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--expected-data-directory', required=True)
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--apply', action='store_true', help='Write only to the verified local test database.')
        mode.add_argument('--dry-run', action='store_true', help='Preview only (the default).')
        parser.add_argument('--limit', type=int, default=20)
        parser.add_argument('--max-queries', type=int, default=500)
        parser.add_argument('--max-seconds', type=float, default=20)
        parser.add_argument('--max-errors', type=int, default=3)

    def handle(self, *args, **options):
        try:
            result = process_once(expected_data_directory=options['expected_data_directory'],
                                  apply=options['apply'], limit=options['limit'],
                                  max_queries=options['max_queries'], max_seconds=options['max_seconds'],
                                  max_errors=options['max_errors'])
        except ConsumerSafetyError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(json.dumps(result, sort_keys=True))
        if result['failed'] or result['blocked'] or result['stopped'] != 'batch_complete':
            raise CommandError('Pass stopped or contains pending failures; see the counts above. No automatic retry.')
