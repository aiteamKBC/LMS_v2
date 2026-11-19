"""Read-only post-restore Progress Review integrity report."""

import json

from django.core.management.base import BaseCommand, CommandError

from progress_reviews_api.integrity import build_integrity_report


class Command(BaseCommand):
    help = "Report Progress Review run/PPTX/learner integrity without changing data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--json",
            action="store_true",
            help="Write the complete machine-readable report as JSON.",
        )

    def handle(self, *args, **options):
        report = build_integrity_report()
        if options["json"]:
            self.stdout.write(json.dumps(report, sort_keys=True))
        else:
            for name, check in report["checks"].items():
                status = "PASS" if check["count"] == 0 else "FAIL"
                self.stdout.write(f"{status} {name}: {check['count']}")

        if not report["ok"]:
            raise CommandError("Progress Review integrity check failed.")
        if not options["json"]:
            self.stdout.write(self.style.SUCCESS("Progress Review integrity check passed."))

