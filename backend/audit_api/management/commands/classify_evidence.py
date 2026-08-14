"""Classify learner evidence from its CONTENT (text/vision), batch by batch.

    python manage.py classify_evidence --limit 20
    python manage.py classify_evidence --aptem-id 14548 --month 2026-06
"""

from django.core.management.base import BaseCommand

from audit_api.evidence_classifier import classify_batch


class Command(BaseCommand):
    help = "Classify Aptem evidence items from their content into audit categories."

    def add_arguments(self, parser):
        parser.add_argument("--aptem-id", type=int, default=None)
        parser.add_argument("--month", type=str, default=None)
        parser.add_argument("--limit", type=int, default=50)
        parser.add_argument("--workers", type=int, default=1)
        parser.add_argument("--shard", type=int, default=0)
        parser.add_argument("--shards", type=int, default=1)

    def handle(self, *args, **options):
        summary = classify_batch(
            aptem_id=options["aptem_id"],
            month=options["month"],
            limit=options["limit"],
            workers=options["workers"],
            shard=options["shard"],
            shards=options["shards"],
            log=lambda line: self.stdout.write(line),
        )
        self.stdout.write(self.style.SUCCESS(
            f"processed={summary['processed']} failed={summary['failed']} "
            f"misfiled={summary['mismatches']} (batch of {summary['pending_batch']})"
        ))
