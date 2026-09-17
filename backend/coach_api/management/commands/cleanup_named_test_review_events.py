"""Cancel and remove three owner-confirmed test MCM calendar events.

This is intentionally separate from ``cleanup_legacy_reviews``.  That command
targets a historical structural set; this one can only act on the three named
test rows below and refuses to continue if any audited identity field changes.

Usage, in order::

    python manage.py cleanup_named_test_review_events --dry-run
    python manage.py cleanup_named_test_review_events --cancel-external
    python manage.py cleanup_named_test_review_events --apply

``--apply`` repeats the idempotent Microsoft cancellation before deleting the
local rows and their event-owned attendance/artifact/summary dependencies.
"""
from django.core.management.base import CommandError
from django.db import connections, router

from coach_api.management.commands.cleanup_legacy_reviews import (
    DEPENDENT_RELATIONS,
    GRAPH_DELETE_ALREADY_GONE,
    GRAPH_DELETE_NOT_REQUIRED,
    GRAPH_DELETE_SUCCESS,
    Command as LegacyCleanupCommand,
    has_external_linkage,
    needs_external_action,
)
from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    clean_text,
    delete_calendar_event_from_graph_detailed,
    has_graph_credentials,
)


APPROVED_TEST_EVENTS = {
    128: {
        "learner_id": 211,
        "event_key": "mcr:211:1:2026-10-31",
        "target_date": "2026-10-31",
        "scheduled_date": "2026-10-31",
        "scheduled_time": "09:00:00",
    },
    137: {
        "learner_id": 248,
        "event_key": "mcr:248:1:2026-09-02",
        "target_date": "2026-09-02",
        "scheduled_date": "2026-09-24",
        "scheduled_time": "12:30:00",
    },
    144: {
        "learner_id": 248,
        "event_key": "mcr:248:3:2026-10-05",
        "target_date": "2026-10-05",
        "scheduled_date": "2026-09-29",
        "scheduled_time": "06:30:00",
    },
}

OFFICIAL_EVENTS_TO_PRESERVE = frozenset({154, 160})


def _iso(value):
    return value.isoformat() if value is not None else None


class Command(LegacyCleanupCommand):
    help = (
        "Cancel Teams invitations and delete the named test MCM events "
        "128, 137 and 144 without touching any other calendar row."
    )

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--dry-run",
            action="store_true",
            help="Default. Validate and report the three rows; write nothing.",
        )
        mode.add_argument(
            "--cancel-external",
            action="store_true",
            help="Cancel only their external Teams/Graph invitations.",
        )
        mode.add_argument(
            "--apply",
            action="store_true",
            help="Cancel external invitations, then delete only the three local rows.",
        )

    def _candidates(self):
        records = list(
            CoachCalendarEvent.objects.filter(id__in=APPROVED_TEST_EVENTS).order_by("id")
        )
        found = {record.id for record in records}
        missing = sorted(set(APPROVED_TEST_EVENTS) - found)
        if missing:
            raise CommandError(
                f"ABORT: approved test event id(s) {missing} do not exist. "
                "Refusing a partial cleanup."
            )
        return records

    def _guard_approved_identity(self, records):
        problems = []
        for record in records:
            expected = APPROVED_TEST_EVENTS[record.id]
            actual = {
                "learner_id": record.learner_id,
                "event_key": record.event_key,
                "target_date": _iso(record.target_date),
                "scheduled_date": _iso(record.scheduled_date),
                "scheduled_time": _iso(record.scheduled_time),
            }
            changed = {
                key: {"expected": expected[key], "actual": actual[key]}
                for key in expected
                if actual[key] != expected[key]
            }
            if record.event_type != "mcr":
                changed["event_type"] = {
                    "expected": "mcr",
                    "actual": record.event_type,
                }
            if record.status != CoachCalendarEvent.STATUS_SCHEDULED:
                changed["status"] = {
                    "expected": CoachCalendarEvent.STATUS_SCHEDULED,
                    "actual": record.status,
                }
            if changed:
                problems.append(f"event {record.id}: {changed}")
        if problems:
            raise CommandError(
                "ABORT: an approved test row changed since the production audit; "
                "refusing to act. " + "; ".join(problems)
            )

    def _guard_no_recorded_activity(self, records, database):
        active = [
            record.id
            for record in records
            if record.review_completed_at is not None
            or record.manager_signed_at is not None
            or bool(record.review_responses)
        ]
        if active:
            raise CommandError(
                f"ABORT: test event id(s) {active} contain review/signature data."
            )

        ids = [record.id for record in records]
        keys = [record.event_key for record in records]
        with connections[database].cursor() as cursor:
            for relation in DEPENDENT_RELATIONS:
                cursor.execute("select to_regclass(%s)", [relation])
                if not cursor.fetchone()[0]:
                    continue
                cursor.execute(
                    f"select count(*) from {relation} "
                    "where calendar_event_id = any(%s) or event_key = any(%s)",
                    [ids, keys],
                )
                count = cursor.fetchone()[0]
                if count:
                    raise CommandError(
                        f"ABORT: {relation} contains {count} row(s) for the named test "
                        "events. Recorded meeting activity must be reviewed first."
                    )

    def _guard_external_addressability(self, records):
        unaddressable = [
            record.id
            for record in records
            if has_external_linkage(record) and not needs_external_action(record)
        ]
        if unaddressable:
            raise CommandError(
                "ABORT: test event id(s) "
                f"{unaddressable} carry a Teams/web link but no graph_event_id. "
                "Their external meetings cannot be cancelled safely."
            )

    def _report(self, records):
        actionable = [record for record in records if needs_external_action(record)]
        self.stdout.write("")
        self.stdout.write("Named test MCM cleanup candidates")
        self.stdout.write("=" * 80)
        for record in records:
            self.stdout.write(
                f"id={record.id} learner_id={record.learner_id} "
                f"scheduled={record.scheduled_date} {record.scheduled_time} "
                f"sync_state={record.sync_state} "
                f"external_action={'YES' if needs_external_action(record) else 'NO'} "
                f"external_linkage={'YES' if has_external_linkage(record) else 'NO'}"
            )
        self.stdout.write("=" * 80)
        self.stdout.write(f"  exact candidates: {len(records)}")
        self.stdout.write(f"  Graph DELETE calls: {len(actionable)}")
        return actionable

    def _cancel_external(self, actionable):
        if not actionable:
            self.stdout.write("PHASE 1: no graph_event_id values; nothing to cancel.")
            return {}, []
        if not has_graph_credentials():
            raise CommandError(
                "ABORT: Microsoft Graph credentials are unavailable; refusing local deletion."
            )

        outcomes, failures = {}, []
        self.stdout.write(f"PHASE 1: cancelling {len(actionable)} test Teams meeting(s)...")
        for record in actionable:
            outcome, detail = delete_calendar_event_from_graph_detailed(record)
            outcomes[record.id] = outcome
            line = f"  [{outcome}] event id={record.id}"
            if outcome == GRAPH_DELETE_SUCCESS:
                self.stdout.write(self.style.SUCCESS(line))
            elif outcome == GRAPH_DELETE_ALREADY_GONE:
                self.stdout.write(line + " (already gone)")
            elif outcome == GRAPH_DELETE_NOT_REQUIRED:
                self.stdout.write(line)
            else:
                failures.append((record, detail))
                self.stderr.write(self.style.ERROR(line + f": {detail}"))
        return outcomes, failures

    def _verify_targeted(self):
        remaining = list(
            CoachCalendarEvent.objects.filter(id__in=APPROVED_TEST_EVENTS)
            .order_by("id")
            .values_list("id", flat=True)
        )
        if remaining:
            raise CommandError(
                f"Cleanup verification failed: test event id(s) {remaining} still exist."
            )

        official = {
            event_id: (template_id, instance_id)
            for event_id, template_id, instance_id in CoachCalendarEvent.objects.filter(
                id__in=OFFICIAL_EVENTS_TO_PRESERVE
            ).values_list("id", "review_template_id", "review_instance_id")
        }
        missing = sorted(OFFICIAL_EVENTS_TO_PRESERVE - set(official))
        unlinked = sorted(
            event_id
            for event_id, (template_id, instance_id) in official.items()
            if not clean_text(template_id) or not clean_text(instance_id)
        )
        if missing or unlinked:
            raise CommandError(
                "Cleanup verification failed for official events: "
                f"missing={missing}, unlinked={unlinked}."
            )
        self.stdout.write(
            "Verification: test events absent; official events 154 and 160 still linked."
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        cancel_external = options["cancel_external"]
        dry_run = options["dry_run"] or not (apply_changes or cancel_external)
        database = router.db_for_write(CoachCalendarEvent) or "default"

        records = self._candidates()
        self._guard_approved_identity(records)
        self._guard_no_curriculum_linkage(records)
        self._guard_no_recorded_activity(records, database)
        self._guard_external_addressability(records)
        actionable = self._report(records)

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "DRY RUN -- nothing changed in Microsoft or the database.\n"
                "Next: python manage.py cleanup_named_test_review_events --cancel-external"
            ))
            return

        self._guard_backup(records, database)

        outcomes, failures = self._cancel_external(actionable)
        if failures:
            raise CommandError(
                f"ABORT: {len(failures)} Teams cancellation(s) failed. "
                "No local rows were deleted."
            )

        blocked = [
            record_id
            for record_id, outcome in outcomes.items()
            if outcome not in (
                GRAPH_DELETE_SUCCESS,
                GRAPH_DELETE_ALREADY_GONE,
                GRAPH_DELETE_NOT_REQUIRED,
            )
        ]
        if blocked:
            raise CommandError(
                f"ABORT: unresolved external outcomes for event ids {blocked}."
            )

        if cancel_external:
            self.stdout.write(self.style.SUCCESS(
                "PHASE 1 complete. No database rows were deleted.\n"
                "Next: python manage.py cleanup_named_test_review_events --apply"
            ))
            return

        deleted = self._delete_local(records, database)
        for relation, count in deleted.items():
            self.stdout.write(f"  {relation}: {count}")
        self._verify_targeted()
        self.stdout.write(self.style.SUCCESS("Named test event cleanup complete."))
