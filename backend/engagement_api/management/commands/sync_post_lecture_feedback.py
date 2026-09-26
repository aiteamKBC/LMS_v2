from django.core.management.base import BaseCommand

from engagement_api.feedback_delivery import sync_post_lecture_feedback_from_attendance


class Command(BaseCommand):
    help = 'Reconcile finalized curriculum attendance into post-lecture feedback deliveries.'

    def add_arguments(self, parser):
        parser.add_argument('--live-session-id', action='append', dest='live_session_ids', default=[])
        parser.add_argument('--occurrence-id', action='append', dest='occurrence_ids', default=[])

    def handle(self, *args, **options):
        result = sync_post_lecture_feedback_from_attendance(
            live_session_ids=options['live_session_ids'],
            occurrence_ids=options['occurrence_ids'],
        )
        self.stdout.write(self.style.SUCCESS(
            'Feedback attendance sync: '
            f"{result['occurrencesProcessed']} occurrence(s), "
            f"{result['formsMatched']} form match(es), "
            f"{result['recipientsMatched']} recipient(s), "
            f"{result['recipientsRevoked']} revoked, "
            f"{result['unmatchedPresentAttendees']} unmatched present attendee(s)."
        ))
