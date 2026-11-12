from datetime import date, timedelta

from django.core.management.base import BaseCommand

from integrations.models import (
    AvailabilityBlock,
    DepartmentMapping,
    ExternalPersonLink,
    ExternalTrainingRecord,
    IntegrationConnection,
    IntegrationSyncRun,
    IntegrationTenant,
    ManagerRelationship,
    ManagerSignatoryGrant,
    SchedulingConflict,
)


class Command(BaseCommand):
    help = "Purge Breathe projections after the tenant retention anchor plus one year."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        cutoff = date.today() - timedelta(days=365)
        tenants = list(IntegrationTenant.objects.filter(retention_anchor__lte=cutoff))
        total = 0
        for tenant in tenants:
            tenant_id = tenant.id
            for model in (
                AvailabilityBlock,
                DepartmentMapping,
                ExternalPersonLink,
                ExternalTrainingRecord,
                ManagerRelationship,
                ManagerSignatoryGrant,
                SchedulingConflict,
                IntegrationSyncRun,
                IntegrationConnection,
            ):
                rows = model.objects.filter(tenant_id=tenant_id)
                if options["dry_run"]:
                    total += rows.count()
                else:
                    deleted, _ = rows.delete()
                    total += deleted
            if not options["dry_run"]:
                tenant.active = False
                tenant.save(update_fields=("active", "updated_at"))
        verb = "Would purge" if options["dry_run"] else "Purged"
        self.stdout.write(self.style.SUCCESS(f"{verb} {total} integration rows across {len(tenants)} tenant(s)."))
