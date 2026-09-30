from __future__ import annotations

import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from read_models.worker import process_once, worker_identity
from read_models.registry import registered


class Command(BaseCommand):
    help = "Process the durable shared read-model outbox."

    def add_arguments(self, parser):
        parser.add_argument("--forever", action="store_true")
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--poll-seconds", type=float, default=2.0)
        parser.add_argument(
            "--model",
            help="Process only one registered model key (useful for staged canaries).",
        )

    def handle(self, *args, **options):
        identity = worker_identity()
        model_key = str(options.get("model") or "").strip() or None
        if model_key:
            try:
                registered(model_key)
            except KeyError as exc:
                raise CommandError(str(exc)) from exc
        while True:
            close_old_connections()
            result = process_once(
                limit=options["limit"], worker_id=identity, model_key=model_key,
            )
            self.stdout.write(
                "claimed={claimed} completed={completed} failed={failed} groups={groups}".format(**result)
            )
            if not options["forever"]:
                return
            time.sleep(max(float(options["poll_seconds"]), 0.1))

