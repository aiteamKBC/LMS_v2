"""Process durable accepted-study jobs; never rebuild historical progress."""
from collections import Counter
from django.core.management.base import BaseCommand, CommandError
from engagement_api.shared_reward_setup import require_same_database, require_global_ready

class Command(BaseCommand):
    help = "Retry a bounded batch of durable shared-reward jobs without scanning or awarding historical progress."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        require_same_database()
        require_global_ready()
        if not 1 <= options["limit"] <= 1000:
            raise CommandError("Batch limit must be from 1 to 1000.")
        from engagement_api.shared_rewards import reconcile_pending
        from engagement_api.saved_progress_rewards import reconcile_pending_saved
        results = reconcile_pending(options["limit"]) + reconcile_pending_saved(options["limit"])
        counts = Counter(row["status"] for row in results)
        self.stdout.write("Processed " + str(len(results)) + " durable jobs. " + ", ".join(key+"="+str(value) for key,value in sorted(counts.items())))

