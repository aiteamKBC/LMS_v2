"""Explicit business-rule operation. Default invocation is read-only."""
import csv
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from coach_api.auto_review_reconciliation import run_batch, REPORT_COLUMNS


class Command(BaseCommand):
    help = "Classify legacy Aptem Native MCMs; apply only reviewed single-candidate pairs."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--actor-id", type=int, required=True)
        actions = parser.add_mutually_exclusive_group()
        actions.add_argument("--dry-run", action="store_true")
        actions.add_argument("--apply", action="store_true")
        parser.add_argument("--reason", default="")
        parser.add_argument("--expected-count", type=int)
        parser.add_argument("--calendar-event-id", type=int, action="append", dest="calendar_event_ids")
        parser.add_argument("--report-csv", type=Path, help="Private local report; no answers or meeting URLs.")

    def handle(self, *args, **options):
        try:
            result = run_batch(**{key: options[key] for key in (
                "actor_id", "apply", "reason", "expected_count", "calendar_event_ids")})
        except (ValueError, PermissionError) as exc:
            raise CommandError(str(exc)) from exc
        if options["report_csv"]:
            with options["report_csv"].open("w", newline="", encoding="utf-8") as report:
                writer = csv.DictWriter(report, fieldnames=REPORT_COLUMNS, extrasaction="ignore")
                writer.writeheader()
                writer.writerows(result["rows"])
        self.stdout.write(json.dumps(result, indent=2, default=str))
        if any(row["status"] == "BLOCKED" for row in result["outcomes"]):
            raise CommandError("Some pairs were blocked; inspect the per-row report. Independent successful pairs remain applied.")
