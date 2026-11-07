"""Explicit per-review MCM exceptions; defaults to a read-only preview.

No master template, Aptem source, signature image, booking identity or draft
answers are changed. Already submitted reviews finish through the normal
completion rules; unsubmitted forms still require an explicit submission.
"""
from copy import deepcopy
from datetime import date, datetime
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import connection, connections, transaction
from django.utils import timezone

from coach_api.migrated_completion import complete
from coach_api.migrated_completion_views import _mirror_status
from coach_api.migrated_reviews import review_family, validate_answers
from coach_api.migrated_signature_rules import WAIVER_KEY, requirements_for_overlay, signature_waiver
from coach_api.migrated_template_sync import active_answers
from coach_api.models import ImportedReviewInstance
from coach_api.review_sources import booking_for_overlay
from coach_api.views import get_learner_db_alias, lock_learner_calendar
from learner_api.models import LearnerProfile


UK = ZoneInfo("Europe/London")


def source_for(overlay):
    """Read only the source identity/status/date; never copy learner answers."""
    with connections[get_learner_db_alias()].cursor() as cursor:
        cursor.execute('SELECT review_type, planned_scheduled_date, status, completed_date '
                       'FROM "Learner".reviews WHERE id=%s AND learner_id=%s',
                       [overlay.source_review_id, overlay.learner_id])
        return cursor.fetchone()


def meeting_day(value):
    if isinstance(value, datetime):
        return value.astimezone(UK).date() if timezone.is_aware(value) else value.date()
    return value if isinstance(value, date) else None


def validate_review(overlay, owner, cutoff, calendar, source, *, already_waived=False):
    if (overlay.owner_email.strip().casefold() != owner
            or not overlay.source_review_id or not overlay.template_snapshot.get("sections")
            or not source or review_family(source[0]) != "MCM"
            or (overlay.template_snapshot.get("templateSource") or {}).get("family") != "MCM"):
        raise CommandError("Review identity or MCM family does not match the approved scope.")
    assigned = LearnerProfile.objects.filter(pk=overlay.learner_id).values_list("coach_email", flat=True).first()
    if str(assigned or "").strip().casefold() != owner:
        raise CommandError("The learner is no longer assigned to the selected coach.")
    statuses = {"not-scheduled", "scheduled", "in-progress", "awaiting-signature"}
    if already_waived:
        statuses.add("completed")
    if (overlay.status not in statuses or (not already_waived and source[3])
            or str(source[2] or "").strip().casefold() == "cancelled"
            or (not already_waived and str(source[2] or "").strip().casefold() == "completed")):
        raise CommandError("Completed, cancelled or unsupported reviews cannot be waived.")
    if calendar and (calendar.owner_email.strip().casefold() != owner or calendar.event_type != "mcr"
                     or calendar.status == "cancelled"):
        raise CommandError("The existing calendar booking does not match the approved scope.")
    # Prefer the actual saved appointment over the source's planned date.
    day = meeting_day(calendar.scheduled_date) if calendar and calendar.scheduled_date else meeting_day(source[1])
    if day is None or day >= cutoff:
        raise CommandError("The review has no dated meeting before the exclusive cutoff.")
    return day


class Command(BaseCommand):
    help = "Preview or apply an audited signature waiver to explicitly selected historical imported MCMs."

    def add_arguments(self, parser):
        parser.add_argument("--owner-email", required=True)
        parser.add_argument("--before", required=True, help="Exclusive meeting-date cutoff in Europe/London.")
        parser.add_argument("--review-id", action="append", type=int, required=True, help="ImportedReviewInstance primary key; repeat for each approved record.")
        parser.add_argument("--actor-email", required=True)
        parser.add_argument("--reason", required=True)
        parser.add_argument("--expected-database", required=True, help="Verified database name, checked before any writes.")
        parser.add_argument("--expected-branch", required=True, help="Verified Neon branch ID (sqlite for isolated tests).")
        parser.add_argument("--apply", action="store_true", help="Without this flag no data is written.")

    def handle(self, *args, **options):
        owner, actor = (options[key].strip().casefold() for key in ("owner_email", "actor_email"))
        try:
            validate_email(owner)
            validate_email(actor)
            cutoff = date.fromisoformat(options["before"])
        except (ValidationError, ValueError) as exc:
            raise CommandError("Valid owner/actor email addresses and an ISO cutoff date are required.") from exc
        if cutoff > timezone.now().astimezone(UK).date() or not options["reason"].strip():
            raise CommandError("A non-future cutoff and an audit reason are required.")
        actual_database = str(connection.settings_dict["NAME"])
        actual_branch = "sqlite" if connection.vendor == "sqlite" else None
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_setting('neon.branch_id', true)")
                actual_database, actual_branch = cursor.fetchone()
        if actual_database != options["expected_database"] or actual_branch != options["expected_branch"]:
            raise CommandError("The connected database/branch does not match the expected target. Nothing changed.")
        ids = sorted(set(options["review_id"]))
        previews = []
        # One transaction: a changed association or failed completion rolls back
        # every waiver in this explicitly selected batch.
        with transaction.atomic():
            initial = list(ImportedReviewInstance.objects.filter(pk__in=ids).order_by("learner_id", "pk"))
            if len(initial) != len(ids):
                raise CommandError("One or more selected review IDs do not exist. Nothing changed.")
            if options["apply"]:
                for learner_id in sorted({row.learner_id for row in initial}):
                    lock_learner_calendar(learner_id)
            for initial_row in initial:
                calendar = booking_for_overlay(initial_row, lock=options["apply"])
                query = ImportedReviewInstance.objects.select_for_update() if options["apply"] else ImportedReviewInstance.objects
                overlay = query.get(pk=initial_row.pk)
                if (overlay.event_key, overlay.learner_id, overlay.source_review_id, overlay.owner_email) != (
                        initial_row.event_key, initial_row.learner_id, initial_row.source_review_id, initial_row.owner_email):
                    raise CommandError("A review association changed. Nothing changed.")
                source = source_for(overlay)
                existing = signature_waiver(overlay, "MCM")
                day = validate_review(overlay, owner, cutoff, calendar, source, already_waived=bool(existing))
                if overlay.status == "awaiting-signature":
                    validate_answers(overlay.template_snapshot, active_answers(overlay.template_snapshot, overlay.answers), completing=True)
                metadata = deepcopy(overlay.meeting_intelligence or {})
                if WAIVER_KEY in metadata and (not existing or existing["before"] != cutoff.isoformat()
                                               or existing["meetingDate"] != day.isoformat()):
                    raise CommandError("A different or invalid waiver already exists. Nothing changed.")
                if existing:
                    previews.append((overlay.pk, "already-waived"))
                    continue
                metadata[WAIVER_KEY] = {
                    "version": 1, "eventKey": overlay.event_key, "sourceReviewId": overlay.source_review_id,
                    "learnerId": overlay.learner_id, "meetingDate": day.isoformat(), "before": cutoff.isoformat(),
                    "appliedAt": timezone.now().astimezone(UK).isoformat(), "appliedBy": actor,
                    "reason": options["reason"].strip(), "previousRequirements": deepcopy(overlay.signature_requirements),
                    "calendarId": calendar.pk if calendar else None,
                    "dateBasis": "calendar" if calendar and calendar.scheduled_date else "source-planned",
                }
                if options["apply"]:
                    overlay.meeting_intelligence = metadata
                    overlay.signature_requirements = requirements_for_overlay(overlay, "MCM")
                    overlay.save(update_fields=["meeting_intelligence", "signature_requirements", "updated_at"])
                    if overlay.status == "awaiting-signature":
                        # This form was already submitted. Preserve its answers
                        # and existing signatures; do not manufacture a new sign-off.
                        complete(overlay)
                        _mirror_status(overlay)
                previews.append((overlay.pk, "complete-submitted" if overlay.status in {"awaiting-signature", "completed"} else "waive-only"))
        for pk, action in previews:
            self.stdout.write(f"Review {pk}: {action}")
        self.stdout.write(self.style.SUCCESS(f"{'Applied' if options['apply'] else 'DRY RUN'}: {len(previews)} selected reviews; master templates and signature images unchanged."))
