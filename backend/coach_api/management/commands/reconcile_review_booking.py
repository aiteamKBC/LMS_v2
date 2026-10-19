"""One exact pair at a time; dry-run is the default. No bulk/nearest-date mode."""
import json

from django.core.management.base import BaseCommand, CommandError
from coach_api import review_reconciliation as service
from coach_api.reconciliation_schema import ReconciliationSchemaNotDeployed


class Command(BaseCommand):
    help = "Inspect/preview/apply/reverse an explicitly approved historical Native MCM association."

    def add_arguments(self, parser):
        parser.add_argument("--actor-id", type=int, required=True, help="Active KBC admin account ID; server-shell access is also required.")
        parser.add_argument("--calendar-event-id", type=int)
        parser.add_argument("--source-review-id", type=int)
        actions = parser.add_mutually_exclusive_group()
        actions.add_argument("--apply", action="store_true")
        actions.add_argument("--reverse", type=int, metavar="RECONCILIATION_ID")
        actions.add_argument("--inspect", action="store_true")
        actions.add_argument("--dry-run", action="store_true")
        parser.add_argument("--reason", default="")

    def handle(self, *args, **options):
        try:
            if options["reverse"]:
                if options["calendar_event_id"] or options["source_review_id"]:
                    raise ValueError("Reversal accepts the exact reconciliation ID only.")
                result = service.reverse(reconciliation_id=options["reverse"], actor_id=options["actor_id"], reason=options["reason"])
            else:
                if not options["calendar_event_id"]:
                    raise ValueError("An exact --calendar-event-id is required.")
                if options["inspect"]:
                    result = service.candidates(calendar_event_id=options["calendar_event_id"], actor_id=options["actor_id"])
                else:
                    if not options["source_review_id"]:
                        raise ValueError("An exact --source-review-id is required; dates are not accepted.")
                    params = {key: options[key] for key in ("calendar_event_id", "source_review_id", "actor_id")}
                    result = service.apply(**params, reason=options["reason"]) if options["apply"] else service.preview(**params)
        except ReconciliationSchemaNotDeployed as exc:
            raise CommandError(json.dumps({"code": exc.code, "detail": str(exc), "changes": []})) from exc
        except (ValueError, PermissionError) as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps(result, indent=2, default=str))
