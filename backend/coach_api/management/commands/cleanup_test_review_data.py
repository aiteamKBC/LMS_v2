"""Safely remove only owner-confirmed Test Review data.

The command is intentionally narrower than every legacy cleanup/reconciliation
tool. Each Calendar row and saved assignment is guarded by a reviewed
multi-field fingerprint. Dry-run is the default and never calls Graph.
"""

from datetime import date, time

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction

from coach_api.management.commands.cleanup_legacy_reviews import (
    DEPENDENT_RELATIONS,
    GRAPH_DELETE_ALREADY_GONE,
    GRAPH_DELETE_NOT_REQUIRED,
    GRAPH_DELETE_SUCCESS,
    has_external_linkage,
    needs_external_action,
)
from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    clean_text,
    delete_calendar_event_from_graph_detailed,
    has_graph_credentials,
)


BACKUP_RELATION = '"Coach".test_review_cleanup_backup_20260917'


def _fingerprint(**values):
    return values


# Only Ayman's four Calendar rows are owner-confirmed Test data. Event 138 is
# intentionally dry-run-only until its full production fingerprint has been
# reviewed and recorded here. Aya and QA remain audit candidates; they are not
# deletion authority in this command.
APPROVED_TEST_EVENTS = {
    129: _fingerprint(learner_id=211, learner_name="Ayman Learner", event_type="mcr",
                      event_key="mcr:211:2:2026-11-30", target_date=date(2026, 11, 30), status="scheduled"),
    130: _fingerprint(learner_id=211, learner_name="Ayman Learner", event_type="mcr",
                      event_key="mcr:211:3:2026-12-30", target_date=date(2026, 12, 30), status="scheduled"),
    133: _fingerprint(learner_id=211, learner_name="Ayman Learner", event_type="mcr",
                      event_key="mcr:211:4:2027-01-29", target_date=date(2027, 1, 29), status="scheduled"),
    # Read-only verified against production on 2026-09-17. Note the event_key
    # is a `review:` key even though event_type is 'mcr' -- that is the real
    # stored value, not a typo, and it is exactly why the key is fingerprinted.
    138: _fingerprint(learner_id=211, learner_name="Ayman Learner", event_type="mcr",
                      event_key="review:211:REV-20260911222203147494:1",
                      target_date=date(2026, 11, 1),
                      review_instance_id="REVI-20260914152144124774C6663F80EFCA",
                      status="awaiting-signature"),
}

# A destructive phase must never run while any approved entry lacks the full
# key/target identity required by the cleanup contract. Event 138's identity is
# now complete and verified, so the remaining block is the OWNER APPROVAL for
# destroying its linked Review content (25 answers + 1 participant signature +
# 2 attendance rows). Clear this only on explicit owner sign-off.
INCOMPLETE_FINGERPRINT_EVENT_IDS = frozenset()

#: Event ids whose identity is verified but whose linked Review content has not
#: yet been signed off for destruction. Blocks every destructive phase exactly
#: like an incomplete fingerprint does.
AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS = frozenset({138})

# Every stale monthlyAssignment.meetingKey verified read-only on 2026-09-17.
# ALL of them get the SAME treatment: keep the submission, keep full_submission,
# clear only the dead nested pointer. Learner work is never deleted here, and
# rows are identified in SUBMISSION id space (learning_reflection_submissions
# .learner_id, a character varying) -- never by calendar/mirror learner id.
APPROVED_TEST_SUBMISSIONS = {
    "d14c4a32-8139-45c4-9b1e-92933ceb612d": {
        "learner_id": "499", "learner_name": "Ayman Learner",
        "activity_id": "COMP-202609150757465678MDBAA",
        "meeting_key": "mcr:211:1:2026-10-31", "status": "submitted_for_tutor_review",
    },
    "77c76d01-be3d-4641-baa4-4917f2032d8b": {
        "learner_id": "101", "learner_name": "Aya Aya Test",
        "activity_id": "COMP-20260911223023804OSWPDP",
        "meeting_key": "mcr:248:2:2026-09-22", "status": "submitted_for_tutor_review",
    },
    "bfffba78-3f83-4778-8edd-c6c853395072": {
        "learner_id": "101", "learner_name": "Aya Aya Test",
        "activity_id": "COMP-20260913231851931737-04",
        "meeting_key": "mcr:248:3:2026-10-05", "status": "draft",
    },
    "d551505d-478d-4210-93aa-9798703f04ae": {
        "learner_id": "101", "learner_name": "Aya Aya Test",
        "activity_id": "COMP-20260907095558869IHGOTD",
        "meeting_key": "mcr:248:1:2026-09-02", "status": "draft",
    },
    "321c6951-5916-43b9-9b50-b80b7d2fe538": {
        "learner_id": "501", "learner_name": "QA learner-launch-20260912232100",
        "activity_id": "COMP-2026091223312929380999F74E4FE3C2",
        "meeting_key": "mcr:647:1:2026-09-21", "status": "accepted",
    },
}


def _normalise(value):
    if isinstance(value, (date, time)):
        return value.isoformat()
    return clean_text(value) if isinstance(value, str) else value


class Command(BaseCommand):
    help = "Cancel and remove only strictly allowlisted confirmed Test Review data."

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--dry-run", action="store_true")
        mode.add_argument("--cancel-external", action="store_true")
        mode.add_argument("--apply", action="store_true")

    def _calendar_records(self):
        records = list(CoachCalendarEvent.objects.filter(
            id__in=APPROVED_TEST_EVENTS,
        ).order_by("id"))
        missing = sorted(set(APPROVED_TEST_EVENTS) - {record.id for record in records})
        if missing:
            raise CommandError(
                f"ABORT: allowlisted Test calendar id(s) {missing} are absent. "
                "Re-run the read-only audit and review the allowlist."
            )
        return records

    def _guard_calendar_fingerprints(self, records):
        problems = []
        for record in records:
            expected = APPROVED_TEST_EVENTS[record.id]
            changed = {}
            for field, expected_value in expected.items():
                actual = _normalise(getattr(record, field))
                wanted = _normalise(expected_value)
                if actual != wanted:
                    changed[field] = {"expected": wanted, "actual": actual}
            if changed:
                problems.append(f"event {record.id}: {changed}")
        if problems:
            raise CommandError(
                "ABORT: confirmed Test Calendar fingerprint changed; " + "; ".join(problems)
            )

    def _submission_rows(self, database):
        with connections[database].cursor() as cursor:
            cursor.execute(
                """
                SELECT s.id::text AS id, s.learner_id::text AS learner_id,
                       s.learner_name, s.activity_id, s.status,
                       s.full_submission #>> '{monthlyAssignment,meetingKey}' AS meeting_key,
                       e.id AS referenced_calendar_id,
                       e.learner_id AS referenced_calendar_learner_id
                  FROM "Learner".learning_reflection_submissions s
                  LEFT JOIN "Coach".coach_calendar_event e
                    ON e.event_key = NULLIF(BTRIM(
                        s.full_submission #>> '{monthlyAssignment,meetingKey}'), '')
                 WHERE s.id::text = ANY(%s)
                 ORDER BY s.id
                """,
                [list(APPROVED_TEST_SUBMISSIONS)],
            )
            columns = [column[0] for column in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
        missing = sorted(set(APPROVED_TEST_SUBMISSIONS) - {row["id"] for row in rows})
        if missing:
            raise CommandError(
                f"ABORT: allowlisted Test submission id(s) {missing} are absent."
            )
        problems = []
        for row in rows:
            expected = APPROVED_TEST_SUBMISSIONS[row["id"]]
            changed = {
                field: {"expected": value, "actual": clean_text(row.get(field))}
                for field, value in expected.items()
                if clean_text(row.get(field)) != value
            }
            if changed:
                problems.append(f"submission {row['id']}: {changed}")
        if problems:
            raise CommandError(
                "ABORT: confirmed Test assignment fingerprint changed; " + "; ".join(problems)
            )
        return rows

    def _instances_and_counts(self, records, database):
        instance_ids = sorted({
            clean_text(record.review_instance_id) for record in records
            if clean_text(record.review_instance_id)
        })
        ids = [record.id for record in records]
        counts = {}
        with connections[database].cursor() as cursor:
            if instance_ids:
                cursor.execute(
                    """
                    SELECT id, calendar_event_id, learner_id, status
                      FROM curriculum.review_instances
                     WHERE id = ANY(%s)
                     ORDER BY id
                    """,
                    [instance_ids],
                )
                columns = [column[0] for column in cursor.description]
                instances = [dict(zip(columns, row)) for row in cursor.fetchall()]
            else:
                instances = []
            if len(instances) != len(instance_ids):
                raise CommandError("ABORT: one or more linked Test Review Instances are missing.")
            for instance in instances:
                if instance["calendar_event_id"] not in ids:
                    raise CommandError(
                        f"ABORT: Test instance {instance['id']} points outside the allowlist."
                    )
            for relation in DEPENDENT_RELATIONS:
                cursor.execute("select to_regclass(%s)", [relation])
                if cursor.fetchone()[0]:
                    for record in records:
                        cursor.execute(
                            f"select count(*) from {relation} "
                            "where calendar_event_id = %s or event_key = %s",
                            [record.id, record.event_key],
                        )
                        counts[f"{relation} calendar={record.id}"] = cursor.fetchone()[0]
            for relation in (
                "curriculum.review_instance_answers",
                "curriculum.review_instance_signatures",
                "curriculum.review_instance_manual_overrides",
            ):
                cursor.execute("select to_regclass(%s)", [relation])
                if cursor.fetchone()[0]:
                    for instance_id in instance_ids:
                        cursor.execute(
                            f"select count(*) from {relation} where review_instance_id = %s",
                            [instance_id],
                        )
                        counts[f"{relation} instance={instance_id}"] = cursor.fetchone()[0]
        self._dependency_counts = counts
        return instances, counts

    def _guard_backup(self, records, instances, submissions, database):
        expected = {
            ("calendar", str(record.id)) for record in records
        } | {
            ("review_instance", instance["id"]) for instance in instances
        } | {
            # Submissions are retained, but their stale pointer is repaired in
            # the same apply transaction, so the current source row must still
            # be covered by the reviewed backup.
            ("assignment_submission", row["id"]) for row in submissions
        }
        backup_entity_types = {
            '"Coach".coach_meeting_attendance': "meeting_attendance",
            '"Coach".coach_meeting_attendance_reports': "meeting_attendance_report",
            '"Coach".coach_meeting_artifacts': "meeting_artifact",
            '"Coach".coach_meeting_summaries': "meeting_summary",
            "curriculum.review_instance_answers": "review_answer",
            "curriculum.review_instance_signatures": "review_signature",
            "curriculum.review_instance_manual_overrides": "review_manual_override",
        }
        with connections[database].cursor() as cursor:
            cursor.execute("select to_regclass(%s)", [BACKUP_RELATION])
            if not cursor.fetchone()[0]:
                raise CommandError(
                    f"ABORT: backup relation {BACKUP_RELATION} does not exist."
                )
            cursor.execute(
                f"select entity_type, entity_id, payload from {BACKUP_RELATION} "
                "where (entity_type, entity_id) in "
                "(select * from unnest(%s::text[], %s::text[]))",
                [[item[0] for item in expected], [item[1] for item in expected]],
            )
            backed_up = {
                (row[0], row[1]): row[2] for row in cursor.fetchall()
            }
            missing = sorted(expected - set(backed_up))
            if missing:
                raise CommandError(f"ABORT: backup is missing {missing}.")

            # A primary row with the right key is not enough: ON CONFLICT
            # DO NOTHING in the owner-run script may leave an old payload.
            current_rows = {}
            for record in records:
                cursor.execute(
                    'select to_jsonb(e) from "Coach".coach_calendar_event e where e.id = %s',
                    [record.id],
                )
                current_rows[("calendar", str(record.id))] = cursor.fetchone()[0]
            for instance in instances:
                cursor.execute(
                    "select to_jsonb(i) from curriculum.review_instances i where i.id = %s",
                    [instance["id"]],
                )
                current_rows[("review_instance", instance["id"])] = cursor.fetchone()[0]
            for submission in submissions:
                cursor.execute(
                    'select to_jsonb(s) from "Learner".learning_reflection_submissions s where s.id::text = %s',
                    [submission["id"]],
                )
                current_rows[("assignment_submission", submission["id"])] = cursor.fetchone()[0]
            stale = sorted(
                key for key in expected
                if current_rows.get(key) != backed_up.get(key)
            )
            if stale:
                raise CommandError(
                    f"ABORT: backup payload is stale for {stale}; "
                    "re-run owner backup preparation and verify it again."
                )

            # Verify every dependent row that the delete phase will remove.
            # Counts alone are not enough for primary targets, but this check
            # ensures no answer/signature/attendance row is left unbacked.
            for label, count in getattr(self, '_dependency_counts', {}).items():
                if not count:
                    continue
                relation, parent = label.split(" ", 1)
                parent_id = parent.split("=", 1)[1]
                entity_type = backup_entity_types.get(relation)
                if not entity_type:
                    continue
                parent_values = (
                    [str(record.id) for record in records]
                    if "calendar=" in parent
                    else [instance["id"] for instance in instances]
                )
                cursor.execute(
                    f"select count(*) from {BACKUP_RELATION} "
                    "where entity_type = %s and parent_id = any(%s)",
                    [entity_type, parent_values],
                )
                covered_count = cursor.fetchone()[0]
                if covered_count < count:
                    raise CommandError(
                        f"ABORT: backup is missing dependent {entity_type} rows "
                        f"({covered_count}/{count})."
                    )
        self.stdout.write(
            f"Backup check: {len(expected)}/{len(expected)} primary targets covered "
            "with current payloads."
        )

    def _report(self, records, instances, counts, submissions):
        self.stdout.write("Confirmed Test Review cleanup candidates")
        for record in records:
            self.stdout.write(
                f"  calendar={record.id} learner={record.learner_id} "
                f"type={record.event_type} key={record.event_key} status={record.status} "
                f"instance={clean_text(record.review_instance_id) or '-'} "
                f"external={'YES' if has_external_linkage(record) else 'NO'}"
            )
        self.stdout.write("Linked Review Instances")
        for instance in instances:
            self.stdout.write(
                f"  instance={instance['id']} calendar={instance['calendar_event_id']} "
                f"learner={instance['learner_id']} status={instance['status']}"
            )
        self.stdout.write("Dependencies")
        for relation, count in sorted(counts.items()):
            self.stdout.write(f"  {relation}: {count}")
        self.stdout.write("Confirmed Test assignment submissions")
        for submission in submissions:
            self.stdout.write(
                f"  submission={submission['id']} learner={submission['learner_id']} "
                f"meeting_key={submission['meeting_key']} status={submission['status']} "
                f"referenced_event={submission.get('referenced_calendar_id') or '-'} "
                f"action={'KEEP_SUBMISSION_CLEAR_MEETING_KEY' if not submission.get('referenced_calendar_id') else 'KEEP'}"
            )
        if INCOMPLETE_FINGERPRINT_EVENT_IDS:
            self.stdout.write(self.style.WARNING(
                "  dry-run-only incomplete fingerprints: "
                f"{sorted(INCOMPLETE_FINGERPRINT_EVENT_IDS)}"
            ))
        if AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS:
            self.stdout.write(self.style.WARNING(
                "  dry-run-only pending owner content approval: "
                f"{sorted(AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS)}"
            ))

    def _cancel_external(self, records, database):
        actionable = [record for record in records if needs_external_action(record)]
        unaddressable = [
            record.id for record in records
            if has_external_linkage(record) and not needs_external_action(record)
        ]
        if unaddressable:
            raise CommandError(
                f"ABORT: event id(s) {unaddressable} have links but no graph_event_id."
            )
        if actionable and not has_graph_credentials():
            raise CommandError("ABORT: Microsoft Graph credentials are unavailable.")
        failures = []
        for record in actionable:
            outcome, detail = delete_calendar_event_from_graph_detailed(record)
            self.stdout.write(f"  [{outcome}] calendar={record.id}")
            if outcome not in {
                GRAPH_DELETE_SUCCESS, GRAPH_DELETE_ALREADY_GONE, GRAPH_DELETE_NOT_REQUIRED,
            }:
                failures.append((record.id, detail))
        if failures:
            raise CommandError(
                f"ABORT: Teams cancellation failed for {failures}; local rows retained."
            )
        with transaction.atomic(using=database):
            CoachCalendarEvent.objects.filter(id__in=[r.id for r in records]).update(
                graph_event_id="", graph_web_link="", meeting_link="",
                graph_organizer_email="", meeting_provider="",
                sync_state=CoachCalendarEvent.SYNC_CANCELLED,
                last_graph_sync_error="",
            )

    def _delete_local(self, records, instances, submissions, database):
        ids = [record.id for record in records]
        keys = [record.event_key for record in records]
        instance_ids = [instance["id"] for instance in instances]
        deleted = {}
        with transaction.atomic(using=database):
            with connections[database].cursor() as cursor:
                for relation in DEPENDENT_RELATIONS:
                    cursor.execute("select to_regclass(%s)", [relation])
                    if cursor.fetchone()[0]:
                        cursor.execute(
                            f"delete from {relation} "
                            "where calendar_event_id = any(%s) or event_key = any(%s)",
                            [ids, keys],
                        )
                        deleted[relation] = cursor.rowcount
                for relation in (
                    "curriculum.review_instance_manual_overrides",
                    "curriculum.review_instance_signatures",
                    "curriculum.review_instance_answers",
                ):
                    cursor.execute("select to_regclass(%s)", [relation])
                    if cursor.fetchone()[0]:
                        cursor.execute(
                            f"delete from {relation} where review_instance_id = any(%s)",
                            [instance_ids],
                        )
                        deleted[relation] = cursor.rowcount
                cursor.execute(
                    "delete from curriculum.review_instances where id = any(%s)",
                    [instance_ids],
                )
                deleted["curriculum.review_instances"] = cursor.rowcount
            # Calendar rows go BEFORE the pointer repair: the repair's
            # NOT EXISTS check must see the post-delete world, otherwise a
            # submission pointing at a row this same run removes would be
            # judged "still resolvable", skipped, and left dangling.
            removed, _ = CoachCalendarEvent.objects.filter(id__in=ids).delete()
            deleted['"Coach".coach_calendar_event'] = removed
            with connections[database].cursor() as cursor:
                # Preserve learner work. Only clear the stale meetingKey, and
                # only once it no longer resolves to any Calendar event.
                cursor.execute(
                    '''
                    update "Learner".learning_reflection_submissions s
                       set full_submission = jsonb_set(
                           s.full_submission,
                           '{monthlyAssignment,meetingKey}',
                           'null'::jsonb,
                           true
                       )
                     where s.id::text = any(%s)
                       and nullif(btrim(
                           s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') is not null
                       and not exists (
                           select 1
                             from "Coach".coach_calendar_event e
                            where e.event_key = nullif(btrim(
                                s.full_submission #>> '{monthlyAssignment,meetingKey}'), '')
                       )
                    ''',
                    [[row["id"] for row in submissions]],
                )
                deleted["assignment_submission_pointer_repairs"] = cursor.rowcount
            remaining_events = CoachCalendarEvent.objects.filter(id__in=ids).count()
            with connections[database].cursor() as cursor:
                cursor.execute(
                    "select count(*) from curriculum.review_instances where id = any(%s)",
                    [instance_ids],
                )
                remaining_instances = cursor.fetchone()[0]
                # Final state must contain no dangling pointer to any key this
                # run deleted, and every allowlisted submission must survive.
                cursor.execute(
                    'select count(*) from "Learner".learning_reflection_submissions s '
                    "where nullif(btrim("
                    "s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') = any(%s)",
                    [keys],
                )
                dangling_pointers = cursor.fetchone()[0]
                cursor.execute(
                    'select count(*) from "Learner".learning_reflection_submissions '
                    "where id::text = any(%s)",
                    [[row["id"] for row in submissions]],
                )
                surviving_submissions = cursor.fetchone()[0]
            if dangling_pointers or surviving_submissions != len(submissions):
                raise CommandError(
                    "ABORT: post-delete verification failed -- "
                    f"{dangling_pointers} dangling assignment pointer(s) remain and "
                    f"{surviving_submissions}/{len(submissions)} submissions survived; "
                    "transaction rolled back."
                )
            if remaining_events or remaining_instances:
                raise CommandError(
                    "ABORT: post-delete verification failed; transaction rolled back."
                )
        return deleted

    def handle(self, *args, **options):
        cancel_external = options["cancel_external"]
        apply_changes = options["apply"]
        dry_run = options["dry_run"] or not (cancel_external or apply_changes)
        database = router.db_for_write(CoachCalendarEvent) or "default"

        records = self._calendar_records()
        self._guard_calendar_fingerprints(records)
        submissions = self._submission_rows(database)
        instances, counts = self._instances_and_counts(records, database)
        self._report(records, instances, counts, submissions)

        if dry_run:
            self.stdout.write(self.style.WARNING(
                "DRY RUN -- no database or Microsoft changes were made."
            ))
            return

        if INCOMPLETE_FINGERPRINT_EVENT_IDS:
            raise CommandError(
                "ABORT: destructive cleanup is disabled until full reviewed "
                "fingerprints are recorded for event id(s) "
                f"{sorted(INCOMPLETE_FINGERPRINT_EVENT_IDS)}."
            )

        if AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS:
            raise CommandError(
                "ABORT: destructive cleanup is disabled until the owner signs off "
                "on destroying the linked Review content (answers, signatures and "
                "attendance) of event id(s) "
                f"{sorted(AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS)}."
            )

        self._guard_backup(records, instances, submissions, database)
        if cancel_external:
            self._cancel_external(records, database)
            self.stdout.write(self.style.SUCCESS(
                "External phase complete. Re-run --dry-run, then use --apply."
            ))
            return

        still_external = [record.id for record in records if has_external_linkage(record)]
        if still_external:
            raise CommandError(
                f"ABORT: event id(s) {still_external} still have external linkage. "
                "Run --cancel-external first."
            )
        deleted = self._delete_local(records, instances, submissions, database)
        for relation, count in sorted(deleted.items()):
            self.stdout.write(f"  {relation}: {count}")
        self.stdout.write(self.style.SUCCESS("Confirmed Test Review cleanup complete."))
