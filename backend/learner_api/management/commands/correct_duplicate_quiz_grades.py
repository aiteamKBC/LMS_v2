import json

from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from learner_api.quiz_grade_corrections import run_correction


class Command(BaseCommand):
    help = "Preview or auditably correct a specified legacy quiz duplicate-choice error."

    def add_arguments(self, parser):
        parser.add_argument("--quiz", type=int, required=True)
        parser.add_argument("--question", type=int, required=True)
        parser.add_argument("--apply", action="store_true")
        parser.add_argument("--expected-plan")
        parser.add_argument("--expect-host")
        parser.add_argument("--expect-database")

    def handle(self, *args, **options):
        config = connections["enrolment"].settings_dict
        if options["quiz"] <= 0 or options["question"] <= 0:
            raise CommandError("Quiz and question IDs must be positive.")
        if options["apply"]:
            if not all(options.get(k) for k in ("expected_plan", "expect_host", "expect_database")):
                raise CommandError("Apply requires the preview digest and verified host/database.")
            if config["HOST"] != options["expect_host"] or config["NAME"] != options["expect_database"]:
                raise CommandError("Database target differs from the verified target.")
        elif options.get("expected_plan"):
            raise CommandError("Use --apply with --expected-plan.")
        try:
            result = run_correction(options["quiz"], options["question"],
                                    expected_digest=options["expected_plan"] if options["apply"] else None)
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        result["mode"] = "applied" if options["apply"] else "read-only preview"
        self.stdout.write(json.dumps(result, indent=2))
