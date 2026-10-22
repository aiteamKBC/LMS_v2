"""Preview or apply contact projection for one externally verified identity pair."""
from django.core.management.base import BaseCommand, CommandError

from learner_api.services.identity_reconciliation import IdentityReconciliationError, reconcile_identity


class Command(BaseCommand):
    help = "Reconcile contacts for an existing source/profile/UUID pair; never link or create learners."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--source-id", type=int, required=True)
        parser.add_argument("--profile-id", type=int, required=True)
        parser.add_argument("--expected-uuid", required=True)
        parser.add_argument("--database", required=True, help="Verified owning connection alias for both schemas.")
        parser.add_argument("--apply", action="store_true", help="Commit contact changes; default is preview.")

    def handle(self, *args, **options):
        try:
            result = reconcile_identity(options["source_id"], options["profile_id"], options["expected_uuid"],
                                        using=options["database"], apply=options["apply"])
        except IdentityReconciliationError as exc:
            raise CommandError(f"Identity reconciliation failed: {exc.code}") from None
        self.stdout.write(f"{result.status}: {','.join(result.changed_fields) or 'no changes'}")
