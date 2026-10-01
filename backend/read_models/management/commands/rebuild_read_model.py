from django.core.management.base import BaseCommand, CommandError

from read_models.registry import registered
from read_models.repository import put_read_model


class Command(BaseCommand):
    help = "Rebuild one registered shared read model and overwrite its scoped row."

    def add_arguments(self, parser):
        parser.add_argument("--model", required=True)
        parser.add_argument("--scope-type", required=True)
        parser.add_argument("--scope-id", required=True)

    def handle(self, *args, **options):
        try:
            spec = registered(options["model"])
        except KeyError as exc:
            raise CommandError(str(exc)) from exc
        if spec.scope_type != options["scope_type"]:
            raise CommandError(f"Expected scope type {spec.scope_type!r}.")
        payload = spec.builder(options["scope_id"])
        value = put_read_model(
            spec.model_key,
            spec.scope_type,
            options["scope_id"],
            payload,
            schema_version=spec.schema_version,
            ttl_seconds=spec.ttl_seconds,
        )
        if value is None:
            raise CommandError("The shared read-model table is unavailable.")
        self.stdout.write(self.style.SUCCESS(f"refreshed_at={value.refreshed_at.isoformat()}"))
