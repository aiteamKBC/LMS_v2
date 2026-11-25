"""Explicit additive maintenance; never invoked on application startup."""
import json
from uuid import uuid4

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from curriculum_api.source_activity_ksbs import add_mapping, CACHE_GENERATION_KEY


class Command(BaseCommand):
    help = 'Add one source-activity KSB with an exact definition and expected legacy version.'

    def add_arguments(self, parser):
        parser.add_argument('--source-activity-id', type=int, required=True)
        parser.add_argument('--standard-ksb-id', type=int, required=True)
        parser.add_argument('--expected-version', type=int, required=True)
        parser.add_argument('--actor', required=True)
        parser.add_argument('--legacy-code')
        parser.add_argument('--database', default='default')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        if not options['apply']:
            raise CommandError('No changes made. Explicit --apply is required.')
        alias = options['database']
        connection = connections[alias]
        if connection.vendor != 'postgresql':
            raise CommandError('PostgreSQL is required.')
        # This maintenance entry point is limited to the verified Development
        # branch. Production execution is not authorized by this integration.
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
            if cursor.fetchone() != ('neondb', 'br-raspy-sky-abvs8lq9'):
                raise CommandError('Not the approved Development database; no changes made.')
        try:
            with transaction.atomic(using=alias):
                result = add_mapping(connection.connection,
                    source_activity_id=options['source_activity_id'],
                    standard_ksb_id=options['standard_ksb_id'],
                    expected_version=options['expected_version'], actor=options['actor'],
                    legacy_code=options['legacy_code'])
                if result['changed']:
                    from config.cache_versions import bump_generation
                    from django.core.cache import cache
                    from learner_api.progress_cache import NAMESPACE
                    def invalidate():
                        bump_generation(NAMESPACE)
                        try:
                            cache.set(CACHE_GENERATION_KEY, uuid4().hex, timeout=None)
                        except Exception as error:
                            raise CommandError('Mapping committed, but response cache invalidation failed; retry cache invalidation before serving cached results.') from error
                    transaction.on_commit(invalidate, using=alias)
        except ValueError as error:
            raise CommandError(str(error)) from error
        self.stdout.write(json.dumps(result))
