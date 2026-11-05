"""Read-only local precursor to an explicitly approved provider inventory.

This command cannot approve activation: it makes no Graph requests and cannot
prove that every historical Teams meeting is represented in local columns.
"""
import json
from collections import defaultdict

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from coach_api.imported_meeting_inventory import classify_bookings
from coach_api.migrated_reviews import review_family


class Command(BaseCommand):
    help = 'Dry-run inventory of locally identifiable APTEM meeting ownership only.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', required=True)

    def handle(self, *args, **options):
        if not options['dry_run']:
            raise CommandError('Only --dry-run is supported.')
        database = connections['default']
        if database.vendor != 'postgresql':
            raise CommandError('An explicitly verified PostgreSQL target is required.')
        with transaction.atomic(using='default'):
            with database.cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                cursor.execute('''SELECT id, learner_id, aptem_review_id, review_type
                                  FROM "Learner".reviews''')
                sources = defaultdict(list)
                for source_id, learner_id, aptem_id, kind in cursor.fetchall():
                    if review_family(kind) in {'MCM', 'PR', 'PR_SKILLS_RADAR'}:
                        sources[(learner_id, f'imported-review:{aptem_id}')].append(source_id)
                cursor.execute('''SELECT id, learner_id, event_key, graph_event_id,
                                         meeting_link, event_type, review_instance_id,
                                         review_template_id, idempotency_key
                                  FROM "Learner".coach_calendar_event
                                  WHERE event_type IN ('mcr', 'progress-review')''')
                rows = []
                unmatched = 0
                ambiguous = 0
                possible_legacy = 0
                for (calendar_id, learner_id, event_key, graph_id, link, _kind,
                     native_id, native_template, idempotency) in cursor.fetchall():
                    matches = sources.get((learner_id, event_key), ())
                    if len(matches) == 1:
                        rows.append({'source_review_id': matches[0],
                                     'calendar_event_id': calendar_id,
                                     'graph_event_id': graph_id,
                                     'meeting_link': link})
                    elif len(matches) > 1:
                        ambiguous += 1
                    elif str(event_key).startswith('imported-review:'):
                        unmatched += 1
                    elif (not native_id and not native_template
                          and str(idempotency).startswith('learner-book:')):
                        possible_legacy += 1
        result = classify_bookings(rows, exhaustive=False)
        self.stdout.write(json.dumps({
            'locallyMatched': result['booking_count'],
            'unresolvedProvider': result['unresolved_count'],
            'ambiguousSource': ambiguous,
            'unmatchedImportedKey': unmatched,
            'possibleLegacyBooking': possible_legacy,
            'localConflictCounts': result['conflict_counts'],
            'inventoryComplete': False,
        }, sort_keys=True))
