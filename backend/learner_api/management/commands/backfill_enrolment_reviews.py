"""Backfill enrolment."Enrolment_Reviews" from existing coach_calendar_event rows.

The enrolment record of booked reviews was added after learners had already
started booking, so this replays the reviews already sitting in
"Coach".coach_calendar_event into it. Idempotent: keyed on Event_key, so
re-running updates rather than duplicates.

    python manage.py backfill_enrolment_reviews            # apply
    python manage.py backfill_enrolment_reviews --dry-run  # show plan only
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from coach_api.models import CoachCalendarEvent

from ...calendar import ONBOARDING_REVIEW_LABELS, ONBOARDING_REVIEW_TYPES, _case_owner_record
from ...learner_detail import SOURCE_MODELS
from ...mappers import _s
from ...models import EnrolmentReview

CONN = "enrolment"


class Command(BaseCommand):
    help = 'Backfill enrolment."Enrolment_Reviews" from existing calendar bookings.'

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be written without committing (rolls back).",
        )

    def _learner_for(self, learner_id):
        """Find the source learner row and its kind, for Learner_kind/Coach_id."""
        for kind, model in SOURCE_MODELS.items():
            learner = model.all_learners.filter(pk=learner_id).first()
            if learner is not None:
                return kind, learner
        return "", None

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        records = CoachCalendarEvent.objects.filter(
            event_type__in=ONBOARDING_REVIEW_TYPES
        ).order_by("id")

        created = updated = skipped = 0
        try:
            with transaction.atomic(using=CONN):
                for record in records:
                    kind, learner = self._learner_for(record.learner_id)
                    if learner is None:
                        self.stdout.write(
                            self.style.WARNING(
                                f"  skip {record.event_key}: learner {record.learner_id} not found"
                            )
                        )
                        skipped += 1
                        continue

                    _email, _name, coach_id = _case_owner_record(learner)
                    is_cancelled = record.status == CoachCalendarEvent.STATUS_CANCELLED
                    _obj, was_created = EnrolmentReview.objects.update_or_create(
                        event_key=record.event_key,
                        defaults={
                            "review_type": _s(record.event_type),
                            "review_label": ONBOARDING_REVIEW_LABELS.get(_s(record.event_type), ""),
                            "learner_kind": kind,
                            "learner_id": record.learner_id,
                            "learner_name": _s(record.learner_name),
                            "learner_email": _s(record.learner_email),
                            "coach_id": coach_id,
                            "coach_name": _s(record.owner_name),
                            "coach_email": _s(record.owner_email),
                            "scheduled_date": record.scheduled_date,
                            "scheduled_time": record.scheduled_time,
                            "duration_minutes": record.duration_minutes or 60,
                            "status": (
                                EnrolmentReview.STATUS_CANCELLED
                                if is_cancelled
                                else EnrolmentReview.STATUS_BOOKED
                            ),
                            "notes": _s(record.notes),
                            "meeting_provider": _s(record.meeting_provider),
                            "meeting_link": _s(record.meeting_link) or _s(record.graph_web_link),
                            "graph_event_id": _s(record.graph_event_id),
                            "invite_sent": bool(_s(record.graph_event_id)),
                            "sync_error": _s(record.last_graph_sync_error),
                            # The calendar row predates this table, so its own
                            # creation time is the best "booked at" available.
                            "booked_at": record.created_at,
                            "cancelled_at": timezone.now() if is_cancelled else None,
                        },
                    )
                    verb = "create" if was_created else "update"
                    self.stdout.write(f"  {verb} {record.event_key} ({record.status})")
                    if was_created:
                        created += 1
                    else:
                        updated += 1

                self.stdout.write(
                    f"\ncreated={created} updated={updated} skipped={skipped} "
                    f"total={EnrolmentReview.objects.count()}"
                )
                if dry_run:
                    self.stdout.write(self.style.WARNING("--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("Committed."))
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Backfill failed (rolled back): {exc}"))
            raise
