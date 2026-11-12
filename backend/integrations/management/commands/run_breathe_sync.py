from django.core.management.base import BaseCommand, CommandError
from django.conf import settings

from integrations.models import IntegrationConnection, IntegrationSyncRun
from integrations.services import ALLOWED_RESOURCES, create_sync_run, process_sync_run


class Command(BaseCommand):
    help = "Process a queued Breathe sync run, or queue one for a connection."

    def add_arguments(self, parser):
        parser.add_argument("--run-id")
        parser.add_argument("--connection-id")
        parser.add_argument("--resource", action="append", dest="resources")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        if not getattr(settings, "BREATHE_INTEGRATIONS_ENABLED", False):
            raise CommandError("Enable the persistent Breathe connector after provisioning its schema.")
        run_id = options.get("run_id")
        if run_id:
            try:
                process_sync_run(run_id)
            except IntegrationSyncRun.DoesNotExist as exc:
                raise CommandError("Sync run not found.") from exc
            self.stdout.write(self.style.SUCCESS(f"Processed sync run {run_id}."))
            return
        connection_id = options.get("connection_id")
        if not connection_id:
            raise CommandError("Provide --run-id or --connection-id.")
        try:
            connection = IntegrationConnection.objects.get(pk=connection_id)
        except IntegrationConnection.DoesNotExist as exc:
            raise CommandError("Connection not found.") from exc
        resources = options.get("resources") or list(ALLOWED_RESOURCES)
        run, duplicate = create_sync_run(connection, resources=resources, dry_run=options.get("dry_run", False))
        process_sync_run(run.id)
        self.stdout.write(self.style.SUCCESS(f"Processed sync run {run.id}{' (deduplicated)' if duplicate else ''}."))
