"""Read-only Calendar / Review Instance lifecycle and ownership audit."""

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router

from coach_api.models import CoachCalendarEvent
from coach_api.management.commands.cleanup_named_test_review_events import OFFICIAL_EVENTS_TO_PRESERVE


APPROVED_LEGACY_TARGET_EVENT_IDS = frozenset({146, 148, 149, 150, 151, 152, 156})

# ---------------------------------------------------------------------------
# Two different learner ID SPACES meet in this audit. They are NOT the same
# numbers for the same person and must never be compared to each other:
#
#   CALENDAR space -- "Coach".coach_calendar_event.learner_id and
#       curriculum.review_instances.learner_id, both `integer`. This is the
#       learner profile mirror id (Ayman = 211, Aya = 248, QA = 647).
#   SUBMISSION space -- "Learner".learning_reflection_submissions.learner_id,
#       a `character varying`. This is the Learner-app id for the same people
#       (Ayman = '499', Aya = '101', QA = '501').
#
# Comparing a SUBMISSION column against a CALENDAR set is both a Postgres type
# error (text = smallint) and a silent misclassification, so the two sets are
# kept apart by name and by type: CALENDAR sets hold ints, SUBMISSION sets
# hold strings. The only reliable bridge between them is the meetingKey
# itself, which embeds the CALENDAR learner id (e.g. "mcr:211:1:2026-10-31").
#
# IDs are classification evidence only. Cleanup has a separate, stronger
# multi-attribute allowlist and never imports these sets as deletion authority.
# ---------------------------------------------------------------------------

# -- CALENDAR space (integer) ----------------------------------------------
CONFIRMED_TEST_CALENDAR_IDS = frozenset({
    129, 130, 133, 138,
})
CONFIRMED_TEST_LEARNER_IDS = frozenset({211})

# These were identified by the audit, but the owner requested authoritative
# identity verification before destructive classification.
TEST_CANDIDATE_CALENDAR_IDS = frozenset({
    132, 134, 135, 136, 161, 167, 168, 169, 174,
})
TEST_CANDIDATE_LEARNER_IDS = frozenset({248, 647})

# -- SUBMISSION space (character varying) ----------------------------------
#: Owner-confirmed Test learner in learning_reflection_submissions: Ayman,
#: whose calendar mirror id is 211 (see CONFIRMED_TEST_LEARNER_IDS).
CONFIRMED_TEST_SUBMISSION_LEARNER_IDS = frozenset({"499"})

#: Pending owner verification in the same table: Aya ('101', calendar 248) and
#: the QA launch learner ('501', calendar 647).
TEST_CANDIDATE_SUBMISSION_LEARNER_IDS = frozenset({"101", "501"})


def _rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


class Command(BaseCommand):
    help = (
        "Read-only Review Calendar / Review Instance consistency audit. "
        "Exits non-zero for real mismatches or orphans."
    )

    def handle(self, *args, **options):
        database = router.db_for_read(CoachCalendarEvent) or "default"
        failures = []

        with connections[database].cursor() as cursor:
            self.stdout.write("Status cross-tab")
            cursor.execute(
                """
                SELECT e.event_type,
                       e.status AS calendar_status,
                       i.status AS instance_status,
                       COUNT(*) AS rows
                  FROM "Coach".coach_calendar_event e
                  JOIN curriculum.review_instances i
                    ON i.id = NULLIF(BTRIM(e.review_instance_id), '')
                 GROUP BY e.event_type, e.status, i.status
                 ORDER BY e.event_type, e.status, i.status
                """
            )
            for row in _rows(cursor):
                self.stdout.write(
                    f"  {row['event_type']}: {row['calendar_status']} -> "
                    f"{row['instance_status']} ({row['rows']})"
                )

            cursor.execute(
                """
                WITH audited AS (
                    SELECT e.id AS calendar_id,
                           e.learner_id,
                           e.event_type,
                           e.status AS calendar_status,
                           e.sync_state,
                           NULLIF(BTRIM(e.review_template_id), '') AS calendar_template_id,
                           NULLIF(BTRIM(e.review_instance_id), '') AS calendar_instance_id,
                           i.id AS instance_id,
                           i.status AS instance_status,
                           CASE
                             -- Technical state is evaluated before ownership
                             -- labels, so a Test candidate cannot hide a real
                             -- lifecycle or linkage failure.
                             WHEN NULLIF(BTRIM(e.review_template_id), '') IS NULL
                               OR NULLIF(BTRIM(e.review_instance_id), '') IS NULL
                               THEN 'REAL_RECONCILIATION_REQUIRED'
                             WHEN i.id IS NULL THEN 'REAL_INSTANCE_NOT_FOUND'
                             WHEN i.calendar_event_id IS DISTINCT FROM e.id
                               THEN 'REAL_BACKLINK_MISMATCH'
                             WHEN i.learner_id IS DISTINCT FROM e.learner_id
                               THEN 'REAL_LEARNER_MISMATCH'
                             WHEN i.review_template_id IS DISTINCT FROM e.review_template_id
                               THEN 'REAL_TEMPLATE_MISMATCH'
                             WHEN i.occurrence_number IS DISTINCT FROM e.occurrence_number
                               THEN 'REAL_OCCURRENCE_MISMATCH'
                             WHEN LOWER(BTRIM(i.coach_email)) IS DISTINCT FROM
                                  LOWER(BTRIM(e.owner_email))
                               THEN 'REAL_COACH_MISMATCH'
                             WHEN i.status IS DISTINCT FROM e.status
                               THEN 'REAL_STATUS_MISMATCH'
                             WHEN e.id = ANY(%s::int[])
                              AND i.target_date IS DISTINCT FROM e.target_date
                               THEN 'OK_APPROVED_LEGACY_TARGET'
                             WHEN (SELECT COUNT(*)
                                     FROM "Coach".coach_calendar_event other
                                    WHERE NULLIF(BTRIM(other.review_instance_id), '') = i.id) > 1
                               THEN 'REAL_DUPLICATE_INSTANCE_LINK'
                             WHEN e.sync_state IN ('failed', 'reconciliation')
                               THEN 'EXTERNAL_RECONCILIATION_REQUIRED'
                             WHEN e.id = ANY(%s::int[]) THEN 'OK_APPROVED_OFFICIAL'
                             WHEN e.id = ANY(%s::int[]) THEN 'CONFIRMED_TEST'
                             WHEN e.id = ANY(%s::int[]) THEN 'TEST_CANDIDATE_REVIEW_REQUIRED'
                             ELSE 'OK'
                           END AS classification,
                           CASE
                             WHEN e.id = ANY(%s::int[]) THEN 'CONFIRMED_TEST'
                             WHEN e.id = ANY(%s::int[]) THEN 'OFFICIAL_EVENTS_TO_PRESERVE'
                             WHEN e.id = ANY(%s::int[]) THEN 'TEST_CANDIDATE'
                             ELSE 'REAL'
                           END AS data_classification
                      FROM "Coach".coach_calendar_event e
                      LEFT JOIN curriculum.review_instances i
                        ON i.id = NULLIF(BTRIM(e.review_instance_id), '')
                     WHERE e.event_type IN ('mcr', 'progress-review', 'review')
                        OR NULLIF(BTRIM(e.review_template_id), '') IS NOT NULL
                        OR NULLIF(BTRIM(e.review_instance_id), '') IS NOT NULL
                )
                SELECT * FROM audited
                 WHERE classification <> 'OK'
                 ORDER BY classification, calendar_id
                """,
                [
                    list(APPROVED_LEGACY_TARGET_EVENT_IDS),
                    list(OFFICIAL_EVENTS_TO_PRESERVE),
                    list(CONFIRMED_TEST_CALENDAR_IDS),
                    list(TEST_CANDIDATE_CALENDAR_IDS),
                    list(CONFIRMED_TEST_CALENDAR_IDS),
                    list(OFFICIAL_EVENTS_TO_PRESERVE),
                    list(TEST_CANDIDATE_CALENDAR_IDS),
                ],
            )
            calendar_findings = _rows(cursor)
            self.stdout.write("\nCalendar findings")
            for row in calendar_findings:
                self.stdout.write(
                    f"  {row['classification']}: calendar={row['calendar_id']} "
                    f"learner={row['learner_id']} type={row['event_type']} "
                    f"calendar_status={row['calendar_status']} "
                    f"instance={row['instance_id'] or '-'} "
                    f"instance_status={row['instance_status'] or '-'} "
                    f"sync={row['sync_state']} data={row['data_classification']}"
                )
                if row["classification"].startswith("REAL_"):
                    failures.append(row["classification"])

            cursor.execute(
                """
                WITH instance_audit AS (
                    SELECT i.id AS instance_id,
                           i.learner_id,
                           i.status AS instance_status,
                           i.calendar_event_id,
                           e.id AS calendar_id,
                           e.status AS calendar_status,
                           CASE
                             WHEN i.calendar_event_id IS NULL AND i.status = 'not-scheduled'
                               THEN 'OK_UNBOOKED'
                             WHEN i.calendar_event_id IS NULL
                               THEN 'ORPHAN_ACTIVE_INSTANCE_WITHOUT_CALENDAR'
                             WHEN e.id IS NULL THEN 'ORPHAN_DANGLING_CALENDAR_BACKLINK'
                             WHEN NULLIF(BTRIM(e.review_instance_id), '') IS DISTINCT FROM i.id
                               THEN 'ORPHAN_FORWARD_LINK_MISMATCH'
                             WHEN e.id = ANY(%s::int[])
                               THEN 'OK_APPROVED_LEGACY_TARGET'
                             WHEN e.id = ANY(%s::int[])
                               THEN 'OK_APPROVED_OFFICIAL'
                             WHEN i.learner_id = ANY(%s::int[]) THEN 'CONFIRMED_TEST'
                             WHEN i.learner_id = ANY(%s::int[])
                               THEN 'TEST_CANDIDATE_REVIEW_REQUIRED'
                             ELSE 'OK'
                           END AS classification,
                           CASE
                             WHEN i.learner_id = ANY(%s::int[]) THEN 'CONFIRMED_TEST'
                             WHEN e.id = ANY(%s::int[]) THEN 'OFFICIAL_EVENTS_TO_PRESERVE'
                             WHEN i.learner_id = ANY(%s::int[]) THEN 'TEST_CANDIDATE'
                             ELSE 'REAL'
                           END AS data_classification
                      FROM curriculum.review_instances i
                      LEFT JOIN "Coach".coach_calendar_event e ON e.id = i.calendar_event_id
                )
                SELECT * FROM instance_audit
                 WHERE classification NOT IN ('OK', 'OK_UNBOOKED')
                 ORDER BY classification, instance_id
                """,
                [
                    list(APPROVED_LEGACY_TARGET_EVENT_IDS),
                    list(OFFICIAL_EVENTS_TO_PRESERVE),
                    list(CONFIRMED_TEST_LEARNER_IDS),
                    list(TEST_CANDIDATE_LEARNER_IDS),
                    list(CONFIRMED_TEST_LEARNER_IDS),
                    list(OFFICIAL_EVENTS_TO_PRESERVE),
                    list(TEST_CANDIDATE_LEARNER_IDS),
                ],
            )
            instance_findings = _rows(cursor)
            self.stdout.write("\nInstance findings")
            for row in instance_findings:
                self.stdout.write(
                    f"  {row['classification']}: instance={row['instance_id']} "
                    f"learner={row['learner_id']} calendar={row['calendar_id'] or '-'} "
                    f"data={row['data_classification']}"
                )
                if row["classification"].startswith("ORPHAN_"):
                    failures.append(row["classification"])

            orphan_checks = {
                "ORPHAN_ANSWERS": ("curriculum.review_instance_answers", """
                    SELECT COUNT(*) FROM curriculum.review_instance_answers a
                     WHERE NOT EXISTS (
                         SELECT 1 FROM curriculum.review_instances i
                          WHERE i.id = a.review_instance_id)
                """),
                "ORPHAN_SIGNATURES": ("curriculum.review_instance_signatures", """
                    SELECT COUNT(*) FROM curriculum.review_instance_signatures s
                     WHERE NOT EXISTS (
                         SELECT 1 FROM curriculum.review_instances i
                          WHERE i.id = s.review_instance_id)
                """),
                "ORPHAN_MANUAL_OVERRIDES": ("curriculum.review_instance_manual_overrides", """
                    SELECT COUNT(*) FROM curriculum.review_instance_manual_overrides o
                     WHERE NOT EXISTS (
                         SELECT 1 FROM curriculum.review_instances i
                          WHERE i.id = o.review_instance_id)
                """),
                "DUPLICATE_INSTANCE_IDENTITY": (None, """
                    SELECT COUNT(*) FROM (
                        SELECT review_template_id, learner_id, occurrence_source,
                               occurrence_number, occurrence_ref
                          FROM curriculum.review_instances
                         WHERE learner_id <> ALL(%s)
                         GROUP BY review_template_id, learner_id, occurrence_source,
                                  occurrence_number, occurrence_ref
                        HAVING COUNT(*) > 1
                    ) duplicates
                """),
                "ORPHAN_ATTENDANCE": ('"Coach".coach_meeting_attendance', """
                    SELECT COUNT(*) FROM "Coach".coach_meeting_attendance a
                     WHERE NOT EXISTS (
                         SELECT 1 FROM "Coach".coach_calendar_event e
                          WHERE e.id = a.calendar_event_id OR e.event_key = a.event_key)
                """),
                # Total only -- no learner filter here. Every stale reference is
                # classified row by row below, in SUBMISSION id space, so this
                # count never has to know about either ID space.
                "MISSING_ASSIGNMENT_MEETINGS": ('"Learner".learning_reflection_submissions', """
                    SELECT COUNT(*)
                      FROM "Learner".learning_reflection_submissions s
                      LEFT JOIN "Coach".coach_calendar_event e
                        ON e.event_key = NULLIF(BTRIM(
                            s.full_submission #>> '{monthlyAssignment,meetingKey}'), '')
                     WHERE LOWER(BTRIM(s.activity_type)) = 'assignment'
                       AND NULLIF(BTRIM(
                           s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') IS NOT NULL
                       AND e.id IS NULL
                """),
            }
            self.stdout.write("\nOrphan and reference counts")
            for label, (relation, sql) in orphan_checks.items():
                if relation:
                    cursor.execute("select to_regclass(%s)", [relation])
                    if not cursor.fetchone()[0]:
                        self.stdout.write(f"  {label}: NOT_AVAILABLE ({relation})")
                        continue
                if label == "DUPLICATE_INSTANCE_IDENTITY":
                    # CALENDAR space: review_instances.learner_id is integer.
                    cursor.execute(sql, [list(CONFIRMED_TEST_LEARNER_IDS)])
                else:
                    cursor.execute(sql)
                count = cursor.fetchone()[0]
                self.stdout.write(f"  {label}: {count}")
                # Assignment references are classified row-by-row below so a
                # confirmed Test or pending candidate cannot be mistaken for a
                # production integrity failure.
                if count and label != "MISSING_ASSIGNMENT_MEETINGS":
                    failures.append(label)

            self.stdout.write("\nStale assignment meeting references")
            cursor.execute(
                """
                SELECT s.id::text AS submission_id,
                       s.learner_id::text AS submission_learner_id,
                       s.status,
                       NULLIF(BTRIM(
                           s.full_submission #>> '{monthlyAssignment,meetingKey}'),
                           '') AS meeting_key,
                       e.id AS referenced_calendar_id,
                       e.learner_id AS referenced_calendar_learner_id,
                       CASE
                         -- SUBMISSION id space (character varying), never the
                         -- CALENDAR sets. Explicitly cast so the array can
                         -- never be inferred as an integer type.
                         WHEN s.learner_id::text = ANY(%s::text[]) THEN 'CONFIRMED_TEST'
                         WHEN s.learner_id::text = ANY(%s::text[]) THEN 'TEST_CANDIDATE'
                         ELSE 'REAL'
                       END AS data_classification
                  FROM "Learner".learning_reflection_submissions s
                  LEFT JOIN "Coach".coach_calendar_event e
                    ON e.event_key = NULLIF(BTRIM(
                        s.full_submission #>> '{monthlyAssignment,meetingKey}'), '')
                 WHERE LOWER(BTRIM(s.activity_type)) = 'assignment'
                   AND NULLIF(BTRIM(
                       s.full_submission #>> '{monthlyAssignment,meetingKey}'), '') IS NOT NULL
                   AND e.id IS NULL
                 ORDER BY s.id
                """,
                [
                    sorted(CONFIRMED_TEST_SUBMISSION_LEARNER_IDS),
                    sorted(TEST_CANDIDATE_SUBMISSION_LEARNER_IDS),
                ],
            )
            stale_assignment_findings = _rows(cursor)
            for row in stale_assignment_findings:
                self.stdout.write(
                    f"  MISSING_ASSIGNMENT_MEETING: submission={row['submission_id']} "
                    f"learner={row['submission_learner_id']} status={row['status']} "
                    f"meetingKey={row['meeting_key']} event={row['referenced_calendar_id'] or '-'} "
                    f"data={row['data_classification']} recommended=CLEAR_STALE_MEETING_KEY"
                )
                if row['data_classification'] == 'REAL':
                    failures.append('MISSING_ASSIGNMENT_MEETING')

            self.stdout.write("\nConfirmed Test identity review")
            cursor.execute(
                """
                SELECT id AS calendar_id, learner_id, event_type, event_key,
                       target_date, scheduled_date, scheduled_time, status,
                       sync_state, NULLIF(BTRIM(review_instance_id), '') AS instance_id
                  FROM "Coach".coach_calendar_event
                 WHERE learner_id = ANY(%s::int[]) OR id = ANY(%s::int[])
                 ORDER BY learner_id, id
                """,
                [
                    list(CONFIRMED_TEST_LEARNER_IDS | TEST_CANDIDATE_LEARNER_IDS),
                    list(CONFIRMED_TEST_CALENDAR_IDS | TEST_CANDIDATE_CALENDAR_IDS),
                ],
            )
            for row in _rows(cursor):
                if row["calendar_id"] in CONFIRMED_TEST_CALENDAR_IDS:
                    label = "CONFIRMED_TEST"
                else:
                    label = "TEST_CANDIDATE_REVIEW_REQUIRED"
                self.stdout.write(
                    f"  {label}: calendar={row['calendar_id']} learner={row['learner_id']} "
                    f"type={row['event_type']} key={row['event_key']} "
                    f"target={row['target_date']} scheduled={row['scheduled_date']} "
                    f"{row['scheduled_time']} status={row['status']} sync={row['sync_state']} "
                    f"instance={row['instance_id'] or '-'}"
                )

        if failures:
            unique = sorted(set(failures))
            raise CommandError(
                "Review consistency audit found real failures: " + ", ".join(unique)
            )
        self.stdout.write(self.style.SUCCESS(
            "Review consistency audit passed: only OK, approved legacy, or confirmed Test rows remain."
        ))
