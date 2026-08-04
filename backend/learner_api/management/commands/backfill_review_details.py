"""Rebuild the per-review-type detail tables from Enrolment_Reviews.Form_answers.

The detail tables are a one-directional projection of the answers document, so
they can always be rebuilt from it. Use this after adding a column, or if a
projection was skipped because the database was briefly unreachable.

Idempotent: keyed on Review_id, so re-running updates rather than duplicates.

    python manage.py backfill_review_details            # apply
    python manage.py backfill_review_details --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from ...models import EnrolmentReview
from ...review_tables import MAPPINGS, sync_review_detail

CONN = "enrolment"


class Command(BaseCommand):
    help = "Rebuild the per-review-type detail tables from the answers document."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be written without committing (rolls back).",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        reviews = EnrolmentReview.objects.filter(
            review_type__in=list(MAPPINGS)
        ).order_by("id")

        counts = {}
        try:
            with transaction.atomic(using=CONN):
                for review in reviews:
                    sync_review_detail(review)
                    counts[review.review_type] = counts.get(review.review_type, 0) + 1
                    self.stdout.write(f"  {review.review_type:20} {review.event_key}")

                total = sum(counts.values())
                self.stdout.write(f"\nprojected {total} review(s): {counts or '{}'}")
                for model, _fields in MAPPINGS.values():
                    self.stdout.write(f"  {model._meta.db_table}: {model.objects.count()} row(s)")

                if dry_run:
                    self.stdout.write(self.style.WARNING("--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("Committed."))
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Backfill failed (rolled back): {exc}"))
            raise
