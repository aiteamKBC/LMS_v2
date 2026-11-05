"""Scoped reconciliation after an Aptem import or a failed completion callback."""
import json

from django.core.management.base import BaseCommand

from engagement_api.review_feedback import sync_review_feedback


class Command(BaseCommand):
    help = 'Reconcile MCM/PR feedback for explicit enrolment learner IDs; never backfill old completions.'

    def add_arguments(self, parser):
        parser.add_argument('--learner-id', type=int, action='append', required=True,
                            help='Created_users/enrolment ID (repeatable), not LearnerProfile ID.')

    def handle(self, *args, **options):
        totals = {}
        for learner_id in set(options['learner_id']):
            for key, value in sync_review_feedback(learner_id).items():
                totals[key] = totals.get(key, 0) + value
        self.stdout.write(json.dumps(totals, sort_keys=True))
