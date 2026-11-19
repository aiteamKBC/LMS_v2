"""Scoped reconciliation after an Aptem import or a failed completion callback."""
import json

from django.core.management.base import BaseCommand, CommandError

from engagement_api.review_feedback import sync_review_feedback
from engagement_api.review_feedback_reconciliation import reconcile_imported_reviews


class Command(BaseCommand):
    help = 'Reconcile MCM/PR/EPA and employer PR feedback; preserve publication boundaries and historical deliveries.'

    def add_arguments(self, parser):
        scope = parser.add_mutually_exclusive_group(required=True)
        scope.add_argument('--learner-id', type=int, action='append',
                           help='Created_users/enrolment ID (repeatable), not LearnerProfile ID.')
        scope.add_argument('--discover', action='store_true', help='Discover imported Review profiles in bounded batches.')
        parser.add_argument('--batch-size', type=int, default=100)
        parser.add_argument('--dry-run', action='store_true', help='Report wouldCreate counts without assignments or link updates.')
        parser.add_argument('--source-review-id', type=int, action='append',
                            help='Optional exact source Review IDs, with one --learner-id only (repeatable).')

    def handle(self, *args, **options):
        if not 1 <= options['batch_size'] <= 1000:
            raise CommandError('--batch-size must be between 1 and 1000.')
        source_ids = options['source_review_id']
        if source_ids and (options['discover'] or len(set(options['learner_id'] or [])) != 1):
            raise CommandError('--source-review-id requires exactly one enrolment --learner-id and no --discover.')
        if any(value <= 0 for value in (options['learner_id'] or []) + (source_ids or [])):
            raise CommandError('Learner and source Review IDs must be positive.')
        if options['discover']:
            totals = reconcile_imported_reviews(batch_size=options['batch_size'], dry_run=options['dry_run'])
            self.stdout.write(json.dumps(totals, sort_keys=True))
            if totals['failedProfiles']:
                raise CommandError('Some Review feedback profiles failed; committed sources remain retryable.')
            return
        totals = {}
        for learner_id in set(options['learner_id']):
            for source_id in sorted(set(source_ids)) if source_ids else [None]:
                kwargs = {'source_review_id': source_id} if source_id is not None else {}
                if options['dry_run']:
                    kwargs['dry_run'] = True
                result = sync_review_feedback(learner_id, **kwargs)
                for key, value in result.items():
                    totals[key] = totals.get(key, 0) + value
        self.stdout.write(json.dumps(totals, sort_keys=True))
