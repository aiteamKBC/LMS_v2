"""Scoped reconciliation after an Aptem import or a failed completion callback."""
import json

from django.core.management.base import BaseCommand, CommandError

from engagement_api.review_feedback import sync_review_feedback


class Command(BaseCommand):
    help = 'Reconcile MCM/PR/EPA and employer PR feedback; preserve publication boundaries and historical deliveries.'

    def add_arguments(self, parser):
        parser.add_argument('--learner-id', type=int, action='append', required=True,
                            help='Created_users/enrolment ID (repeatable), not LearnerProfile ID.')
        parser.add_argument('--dry-run', action='store_true', help='Report wouldCreate counts without assignments or link updates.')
        parser.add_argument('--source-review-id', type=int, action='append',
                            help='Optional exact source Review IDs, with one --learner-id only (repeatable).')

    def handle(self, *args, **options):
        source_ids = options['source_review_id']
        if source_ids and len(set(options['learner_id'])) != 1:
            raise CommandError('--source-review-id requires exactly one enrolment --learner-id.')
        if any(value <= 0 for value in (options['learner_id'] or []) + (source_ids or [])):
            raise CommandError('Learner and source Review IDs must be positive.')
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
