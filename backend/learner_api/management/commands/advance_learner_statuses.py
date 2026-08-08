"""Advance eligible learners through the automatic enrolment lifecycle.

Run this once per day (shortly after midnight in the programme's local
timezone). Signing routes and normal enrolment reads use the same function, so
the command is an idempotent safety net for days with no user activity.

    python manage.py advance_learner_statuses
    python manage.py advance_learner_statuses --check
"""
from django.core.management.base import BaseCommand

from ...constants import DELIVERY_PROGRAMME_STATUS
from ...learner_progression import READY_TO_ENROL_STATUS, advance_learner
from ...models import EnrolmentUser


class Command(BaseCommand):
    help = "Advance signed learners to Ready to enrol and dated learners to Active."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check",
            action="store_true",
            help="Report candidates without changing their status.",
        )

    def handle(self, *args, **options):
        candidates = EnrolmentUser.all_learners.filter(
            programme_status__in=(DELIVERY_PROGRAMME_STATUS, READY_TO_ENROL_STATUS)
        ).order_by("id")
        advanced = 0

        for learner in candidates.iterator():
            before = (learner.programme_status or "").strip()
            if options["check"]:
                # The progression helper performs writes by design; a copied
                # learner lets --check evaluate eligibility without mutating DB.
                from ...learner_progression import (
                    _learner_kind,
                    _programme_start_date,
                    compliance_documents_complete,
                )
                from django.utils import timezone

                after = before
                if before == DELIVERY_PROGRAMME_STATUS and compliance_documents_complete(_learner_kind(learner), learner.pk):
                    after = READY_TO_ENROL_STATUS
                if after == READY_TO_ENROL_STATUS:
                    start = _programme_start_date(learner)
                    if start and start <= timezone.localdate():
                        after = "Active"
                if after == before:
                    continue
            else:
                after = advance_learner(learner)
                if not after:
                    continue

            advanced += 1
            self.stdout.write(f"{learner.username or learner.pk}: {before} -> {after}")

        verb = "would be advanced" if options["check"] else "advanced"
        self.stdout.write(self.style.SUCCESS(f"{advanced} learner(s) {verb}."))
