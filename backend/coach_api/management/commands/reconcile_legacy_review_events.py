"""Link a NAMED, ALLOWLISTED set of real, already-booked legacy MCM/Progress
Review CoachCalendarEvent rows to their canonical Curriculum review_instance,
without touching the booking itself.

Background: before the generic learner MCM/PR request path required an
official Curriculum occurrence (see learner_api.calendar
._resolve_direct_cycle_event_key), a handful of real bookings were created
with review_template_id/review_instance_id left blank. Those meetings are
real -- they must never be deleted (see cleanup_legacy_reviews, which is a
completely separate, narrower operation for the unrelated *test/demo* rows).
This command only ADDS the missing Curriculum linkage to specific, named rows
whose real-booking status has already been confirmed out of band.

Matching reuses learner_api.calendar._generated_cycle_events -- the exact
function coach_timetable_schedule_event / learner_calendar_book /
_resolve_direct_cycle_event_key already use to resolve a learner's canonical
Curriculum occurrences. Nothing here recomputes a recurrence date; a row is
only ever linked to a real occurrence Curriculum's own engine produced.

Usage, in order:

    python manage.py reconcile_legacy_review_events --event-id 152 \\
        --event-id 156 --dry-run

    python manage.py reconcile_legacy_review_events --event-id 152 \\
        --event-id 156 --apply

Default is --dry-run (read-only). Every id must be on ALLOWED_EVENT_IDS
below -- this command refuses to touch anything else, so it can never become
a general-purpose backfill by accident. The approved rows predate canonical
Curriculum target dates, so APPROVED_LEGACY_MAPPINGS records the one reviewed
occurrence each row is allowed to use when its old target date does not match.
"""
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    ReviewTemplateUnavailableError,
    clean_text,
    ensure_review_instance_for_calendar_record,
    resolve_caseload_source_row,
)

#: The only ids this command will ever act on -- seven confirmed-real MCM
#: bookings created before the generic-request linkage guard existed. Every
#: other legacy unlinked row (the test/demo set handled by
#: cleanup_legacy_reviews) is out of scope here on purpose.
ALLOWED_EVENT_IDS = frozenset({146, 148, 149, 150, 151, 152, 156})

# These assignment-created bookings stored the learner-selected booking date
# as target_date. Each override points only to the October MCM occurrence 1
# that production's Curriculum engine returned during the owner-reviewed
# dry-run. It is deliberately guarded by that exact legacy target date; a
# changed row falls back to normal exact matching and is never silently
# remapped.
APPROVED_LEGACY_MAPPINGS = {
    146: {
        "legacy_target_date": "2026-10-05", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    148: {
        "legacy_target_date": "2026-10-26", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    149: {
        "legacy_target_date": "2026-10-28", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    150: {
        "legacy_target_date": "2026-10-27", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    151: {
        "legacy_target_date": "2026-10-27", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    152: {
        "legacy_target_date": "2026-10-29", "source": "mcr",
        "canonical_target_date": "2026-10-15", "occurrence_number": 1,
    },
    156: {
        "legacy_target_date": "2026-10-30", "source": "mcr",
        "canonical_target_date": "2026-10-16", "occurrence_number": 1,
    },
}

#: Review event types this command understands. Matches CoachCalendarEvent's
#: own review-driven vocabulary; the seven allowlisted rows are all 'mcr'.
RECONCILABLE_EVENT_TYPES = ("mcr", "progress-review")


def _blank(value) -> bool:
    """True for None, '', and whitespace-only -- the same "missing" the rest
    of the review architecture uses (clean_text-based, never a bare falsy
    check, since '' and ' ' must be treated identically to NULL)."""
    return not clean_text(value)


class ReconciliationOutcome:
    def __init__(self, event_id, decision, **details):
        self.event_id = event_id
        self.decision = decision
        self.details = details


def resolve_learner_and_source(record):
    """(mirror, source_row) for this event's learner, or (None, None).

    Module-level (rather than a Command method) so tests can patch this one
    seam -- the only place this command talks to LearnerProfile/EnrolmentUser
    -- without needing real Postgres-only enrolment rows under sqlite.
    """
    from learner_api.models import LearnerProfile

    mirror = LearnerProfile.objects.filter(id=record.learner_id).first()
    if mirror is None:
        return None, None
    source = resolve_caseload_source_row(mirror)
    return mirror, source


def generated_occurrences(mirror, source):
    """Every canonical Curriculum occurrence for this learner -- the exact
    function _resolve_direct_cycle_event_key/coaching_events_for_learner
    already use. No recurrence math lives in this command."""
    from learner_api.calendar import _generated_cycle_events

    return _generated_cycle_events(source, mirror, set())


class Command(BaseCommand):
    help = (
        "Link named, allowlisted legacy MCM/Progress Review CoachCalendarEvent "
        "rows to their canonical Curriculum review_instance, without touching "
        "the existing booking (date/time/Teams link/etc)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--event-id", action="append", type=int, dest="event_ids", required=True,
            help="A CoachCalendarEvent id to reconcile. Repeatable. Must be one of "
                 f"{sorted(ALLOWED_EVENT_IDS)}.",
        )
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--dry-run", action="store_true",
            help="Default. Report the match/decision for each id. Writes nothing.",
        )
        mode.add_argument(
            "--apply", action="store_true",
            help="Actually link SAFE_TO_LINK rows. Every other decision still writes nothing.",
        )

    # ------------------------------------------------------------- matching

    def _match_canonical_occurrence(self, record, generated):
        """Every generated occurrence of this event's own review type whose
        canonical targetDate exactly equals the existing row's target_date --
        never the nearest date, never scheduled_date. See Phase 2 of the
        reconciliation spec: 0 -> NO_MATCH, >1 -> AMBIGUOUS, exactly 1 -> safe.
        """
        target_iso = record.target_date.isoformat() if record.target_date else None
        exact_matches = [
            occurrence for occurrence in generated
            if occurrence.get("source") == record.event_type
            and occurrence.get("targetDate") == target_iso
        ]
        if exact_matches:
            return exact_matches

        approved = APPROVED_LEGACY_MAPPINGS.get(record.id)
        if (
            not approved
            or target_iso != approved["legacy_target_date"]
            or record.event_type != approved["source"]
        ):
            return []

        return [
            {
                **occurrence,
                "legacyReconciliation": {
                    "legacyTargetDate": target_iso,
                    "canonicalTargetDate": approved["canonical_target_date"],
                },
            }
            for occurrence in generated
            if occurrence.get("source") == approved["source"]
            and occurrence.get("targetDate") == approved["canonical_target_date"]
            and occurrence.get("occurrenceNumber") == approved["occurrence_number"]
        ]

    # ------------------------------------------------------------- one row

    def _evaluate(self, record):
        """Read-only: resolve the decision for one row. Never writes."""
        from curriculum_api import review_instances as curriculum_review_instances

        already_template = not _blank(record.review_template_id)
        already_instance = not _blank(record.review_instance_id)
        if already_template and already_instance:
            return ReconciliationOutcome(
                record.id, "ALREADY_LINKED",
                review_template_id=record.review_template_id,
                review_instance_id=record.review_instance_id,
            )
        if already_template != already_instance:
            # Half-linked is not a state this command knows how to repair --
            # report it rather than guess which half is wrong.
            return ReconciliationOutcome(
                record.id, "ERROR",
                message=(
                    "Row is partially linked (review_template_id="
                    f"{record.review_template_id!r}, review_instance_id="
                    f"{record.review_instance_id!r}) -- refusing to guess which "
                    "half is correct."
                ),
            )

        mirror, source = resolve_learner_and_source(record)
        if mirror is None:
            return ReconciliationOutcome(record.id, "NO_MATCH", message="No learner profile found for this event's learner_id.")
        if source is None:
            return ReconciliationOutcome(record.id, "NO_MATCH", message="No enrolment/commercial source row (start date) found for this learner.")

        generated = generated_occurrences(mirror, source)
        matches = self._match_canonical_occurrence(record, generated)

        if not matches:
            return ReconciliationOutcome(
                record.id, "NO_MATCH",
                message=(
                    "No canonical Curriculum occurrence of this Review type resolves to "
                    f"target_date={record.target_date}. Curriculum did not produce this date."
                ),
                programme=clean_text(getattr(mirror, "programme", "")),
            )
        if len(matches) > 1:
            return ReconciliationOutcome(
                record.id, "AMBIGUOUS",
                message="More than one canonical occurrence resolves to the same target_date.",
                candidates=[
                    {"reviewTemplateId": m["reviewTemplateId"], "occurrenceNumber": m["occurrenceNumber"]}
                    for m in matches
                ],
            )

        matched = matches[0]
        template_id = matched["reviewTemplateId"]
        occurrence_number = matched["occurrenceNumber"]

        existing_instance = curriculum_review_instances.find_review_instance(
            template_id, mirror.id, occurrence_number,
        )
        if existing_instance:
            linked_event_id = clean_text(existing_instance.get("calendar_event_id"))
            if linked_event_id and linked_event_id != str(record.id):
                return ReconciliationOutcome(
                    record.id, "CONFLICT",
                    message=(
                        f"review_instance {existing_instance.get('id')} is already linked to a "
                        f"DIFFERENT CoachCalendarEvent ({linked_event_id}). Refusing to reassign it."
                    ),
                    matched=matched,
                    existing_instance=existing_instance,
                )

        return ReconciliationOutcome(
            record.id, "SAFE_TO_LINK",
            matched=matched,
            existing_instance=existing_instance,
            mirror=mirror,
        )

    def _apply(self, record, outcome):
        """Write the linkage for one SAFE_TO_LINK row, atomically. Never
        touches scheduling/Teams/sync fields -- only review_template_id,
        occurrence_number, review_instance_id (and, on the review_instances
        side, its own status/calendar_event_id), exactly what
        ensure_review_instance_for_calendar_record already updates for a
        first-time linkage on the normal scheduling path.
        """
        matched = outcome.details["matched"]
        with transaction.atomic():
            # Refetch inside the transaction: another process may have linked
            # this row between the dry-run read and this write.
            fresh = CoachCalendarEvent.objects.select_for_update().get(pk=record.pk)
            if not _blank(fresh.review_template_id) or not _blank(fresh.review_instance_id):
                return ReconciliationOutcome(
                    record.id, "ALREADY_LINKED",
                    review_template_id=fresh.review_template_id,
                    review_instance_id=fresh.review_instance_id,
                )
            fresh.review_template_id = matched["reviewTemplateId"]
            fresh.occurrence_number = matched["occurrenceNumber"]
            try:
                # The calendar row keeps its audited legacy target date. Only
                # the Review Instance receives Curriculum's canonical date;
                # ensure_review_instance_for_calendar_record does not persist
                # target_date in its calendar update_fields.
                fresh.target_date = date.fromisoformat(matched["targetDate"])
                ensure_review_instance_for_calendar_record(fresh, matched)
            except ReviewTemplateUnavailableError as exc:
                # Raising inside transaction.atomic() rolls back everything
                # written so far for this row -- no half-linked state survives.
                raise CommandError(f"event {record.id}: {exc}") from exc
        fresh.refresh_from_db()
        return ReconciliationOutcome(
            record.id, "LINKED",
            review_template_id=fresh.review_template_id,
            review_instance_id=fresh.review_instance_id,
        )

    # ---------------------------------------------------------------- report

    def _print_row(self, record, outcome):
        w = self.stdout.write
        w("")
        w(f"event id={record.id} key={record.event_key}")
        w(f"  learner={clean_text(record.learner_name) or '-'} <{clean_text(record.learner_email) or '-'}> (learner_id={record.learner_id})")
        w(f"  event_type={record.event_type} status={record.status}")
        w(f"  target_date={record.target_date} scheduled_date={record.scheduled_date} scheduled_time={record.scheduled_time}")
        w(f"  current review_template_id={record.review_template_id!r} review_instance_id={record.review_instance_id!r}")
        details = outcome.details
        if outcome.decision in ("SAFE_TO_LINK", "CONFLICT") and "matched" in details:
            matched = details["matched"]
            w(
                f"  matched: review_template_id={matched['reviewTemplateId']} "
                f"name={matched.get('title')!r} reviewTypeCode={matched.get('reviewTypeCode')} "
                f"occurrenceNumber={matched['occurrenceNumber']} canonicalTargetDate={matched['targetDate']}"
            )
            legacy_mapping = matched.get("legacyReconciliation")
            if legacy_mapping:
                w(
                    "  approved legacy mapping: "
                    f"legacyTargetDate={legacy_mapping['legacyTargetDate']} -> "
                    f"canonicalTargetDate={legacy_mapping['canonicalTargetDate']}"
                )
            existing = details.get("existing_instance")
            if existing:
                w(
                    f"  existing review_instance: id={existing.get('id')} status={existing.get('status')} "
                    f"calendar_event_id={existing.get('calendar_event_id') or '-'}"
                )
            else:
                w("  existing review_instance: none")
        if outcome.decision == "AMBIGUOUS":
            w(f"  candidates={details.get('candidates')}")
        if "message" in details:
            w(f"  {details['message']}")
        if outcome.decision == "LINKED":
            w(f"  -> LINKED: review_template_id={details['review_template_id']} review_instance_id={details['review_instance_id']}")
        w(f"  decision: {outcome.decision}")

    # ---------------------------------------------------------------- handle

    def handle(self, *args, **options):
        event_ids = options["event_ids"] or []
        apply_changes = options["apply"]
        dry_run = options["dry_run"] or not apply_changes

        unlisted = sorted(set(event_ids) - ALLOWED_EVENT_IDS)
        if unlisted:
            raise CommandError(
                f"ABORT: event id(s) {unlisted} are not on the approved reconciliation "
                f"allowlist {sorted(ALLOWED_EVENT_IDS)}. This command only reconciles "
                "specific, pre-confirmed real bookings -- it is not a general backfill."
            )
        if not event_ids:
            raise CommandError("ABORT: at least one --event-id is required.")

        records = list(CoachCalendarEvent.objects.filter(id__in=event_ids).order_by("id"))
        found_ids = {r.id for r in records}
        missing = sorted(set(event_ids) - found_ids)
        if missing:
            raise CommandError(f"ABORT: event id(s) {missing} do not exist.")

        bad_type = [r for r in records if r.event_type not in RECONCILABLE_EVENT_TYPES]
        if bad_type:
            raise CommandError(
                "ABORT: event id(s) "
                + ", ".join(str(r.id) for r in bad_type)
                + f" are not a reconcilable review type ({RECONCILABLE_EVENT_TYPES})."
            )

        self.stdout.write(
            self.style.WARNING("DRY RUN -- no writes will be made.") if dry_run
            else self.style.WARNING("APPLY MODE -- SAFE_TO_LINK rows will be written.")
        )

        summary = {}
        for record in records:
            outcome = self._evaluate(record)
            if apply_changes and outcome.decision == "SAFE_TO_LINK":
                outcome = self._apply(record, outcome)
            self._print_row(record, outcome)
            summary[outcome.decision] = summary.get(outcome.decision, 0) + 1

        self.stdout.write("")
        self.stdout.write("=" * 80)
        for decision in sorted(summary):
            self.stdout.write(f"  {decision}: {summary[decision]}")
        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "Nothing was written. Re-run with --apply to link SAFE_TO_LINK rows."
            ))
