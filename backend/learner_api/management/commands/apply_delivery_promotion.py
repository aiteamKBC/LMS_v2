"""Move learners whose onboarding reviews are already fully signed to Delivery.

Promotion normally happens the moment the last signature is saved (see
learning_plan.promote_to_delivery_if_ready, called from the sign endpoint).
Learners who finished signing *before* that hook existed were never
re-evaluated, so they sit at Onboarding with nothing left to do.

This sweeps them up. Idempotent — a learner already past the pre-delivery
statuses is left alone, so it is safe to re-run.

    python manage.py apply_delivery_promotion --check
    python manage.py apply_delivery_promotion
"""
from django.core.management.base import BaseCommand

from ...constants import DELIVERY_PROGRAMME_STATUS
from ...learning_plan import PRE_DELIVERY_STATUSES, onboarding_complete
from ...models import EnrolmentReview, EnrolmentUser


class Command(BaseCommand):
    help = "Promote learners with all onboarding reviews signed to Delivery."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="List who would be promoted, without writing anything.",
        )

    def handle(self, *args, **options):
        dry_run = options["check"]

        # Only learners who actually have reviews are candidates.
        pairs = set(
            EnrolmentReview.objects.exclude(status="cancelled")
            .values_list("learner_kind", "learner_id")
        )
        self.stdout.write(f"Checking {len(pairs)} learner(s) with reviews…")

        promoted = 0
        for kind, learner_id in sorted(pairs, key=lambda p: (p[0] or "", p[1] or 0)):
            if not onboarding_complete(kind, learner_id):
                continue

            learner = EnrolmentUser.all_learners.filter(pk=learner_id).first()
            if learner is None:
                continue

            current = (learner.programme_status or "").strip()
            if current not in PRE_DELIVERY_STATUSES:
                continue

            name = learner.username or f"id={learner_id}"
            self.stdout.write(f"  {name}: {current or '(no status)'} -> {DELIVERY_PROGRAMME_STATUS}")
            if not dry_run:
                learner.programme_status = DELIVERY_PROGRAMME_STATUS
                learner.save(update_fields=["programme_status"])
            promoted += 1

        if dry_run:
            self.stdout.write(self.style.SUCCESS(f"{promoted} learner(s) would be promoted."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Promoted {promoted} learner(s) to Delivery."))
