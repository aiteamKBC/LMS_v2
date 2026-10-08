"""Pull the latest Aptem PDF version for a scoped Advanced Admin learner."""

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connections

from login.advanced_admin import _profile_in_scope
from login.aptem_signed_reviews import AptemUnavailable, sync_review_snapshots


class Command(BaseCommand):
    help = 'Save current Aptem review PDF versions for one scoped learner.'

    def add_arguments(self, parser):
        parser.add_argument('--profile-id', type=int, required=True)

    def handle(self, *args, **options):
        profile = _profile_in_scope(options['profile_id'])
        if profile is None:
            raise CommandError('Learner is outside the Advanced Admin scope.')
        try:
            with connections['default'].cursor() as cursor:
                cursor.execute('''SELECT aptem_review_id, review_type, review_data
                    FROM "Learner".reviews WHERE learner_id = %s
                    AND completed_date IS NOT NULL AND aptem_review_id IS NOT NULL''',
                               [profile.id])
                rows = [dict(zip(('aptem_review_id', 'review_type', 'review_data'), row))
                        for row in cursor.fetchall()]
            result = sync_review_snapshots(profile.aptem_id, rows)
        except (DatabaseError, AptemUnavailable) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write('Aptem review PDFs: '
                          f"eligible={result['eligible']} saved={result['saved']} failed={result['failed']}")
        if result['failed']:
            raise CommandError('Some Aptem review PDFs could not be verified or saved.')
