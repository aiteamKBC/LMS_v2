"""Run the Knowledge Base ingestion worker.

    python manage.py process_knowledge_jobs --once     # cron: one job, then exit
    python manage.py process_knowledge_jobs --loop     # systemd / local terminal

Runs outside Gunicorn, at low priority, one job at a time across the server.
"""
import os
import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from knowledge_base import jobs
from knowledge_base.repository import Repository

IDLE_MIN, IDLE_MAX = 15, 120


class Command(BaseCommand):
    help = "Process queued Knowledge Base books."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--once", action="store_true", help="Process at most one job, then exit.")
        mode.add_argument("--loop", action="store_true", help="Keep processing; back off when idle.")

    def handle(self, *args, **options):
        if hasattr(os, "nice"):
            try:
                os.nice(15)
            except OSError:
                pass
        repo = Repository()
        worker_id, host, pid = jobs.worker_identity()
        throttle = jobs.make_throttle()
        idle = IDLE_MIN
        while True:
            close_old_connections()
            repo.worker_seen(worker_id, host, pid, "1")
            outcome = jobs.run_one(repo, throttle=throttle)
            if outcome:
                self.stdout.write(f"Knowledge job finished: {outcome}")
                idle = IDLE_MIN
            if not options["loop"]:
                return
            if outcome is None:
                time.sleep(idle)
                idle = min(IDLE_MAX, idle * 2)
