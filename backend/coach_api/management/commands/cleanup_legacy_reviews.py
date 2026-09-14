"""Remove the legacy hard-coded MCM / Progress Review Coach calendar records.

These are the rows the old fixed-interval generators left behind (30 days for
Monthly Coaching, 12 weeks for Progress Review), before Curriculum's Review
architecture became the source of truth. They are identified structurally, not
by date:

    event_type IN ('mcr', 'progress-review')
    AND review_template_id is blank
    AND review_instance_id is blank

A row matching that has no link to curriculum.review_templates and no
review instance, so nothing in the new architecture depends on it. Every other
Coach review row -- including every event_type='review' custom-type row -- is
left strictly alone.

Two phases, because they have different failure semantics:

    PHASE 1  cancel the external Microsoft Teams/Graph meetings.
             Irreversible, not transactional, must happen first.
    PHASE 2  delete the 23 rows and their local dependencies from Neon,
             inside one transaction that rolls back on any error.

Phase 2 only starts once every row needing an external action reports SUCCESS,
ALREADY_GONE or NOT_REQUIRED. A single FAILED row (auth, permission, network,
5xx) stops the whole command before the transaction opens -- deleting the
database row would otherwise strand a live Teams meeting with no stored
identifier to cancel it by.

Usage, in order:

    python manage.py cleanup_legacy_reviews --dry-run
    python manage.py cleanup_legacy_reviews --cancel-external
    python manage.py cleanup_legacy_reviews --apply

``--apply`` re-runs phase 1 first. That is deliberate and safe: Graph DELETE is
idempotent here, an already-cancelled meeting comes back 404 and classifies as
ALREADY_GONE, so running --cancel-external beforehand is a checkpoint rather
than a prerequisite.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction
from django.db.models import Value
from django.db.models.functions import Coalesce, Trim

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    COACH_MEETING_ARTIFACTS_RELATION,
    COACH_MEETING_ATTENDANCE_RELATION,
    COACH_MEETING_ATTENDANCE_REPORTS_RELATION,
    COACH_MEETING_SUMMARIES_RELATION,
    GRAPH_DELETE_ALREADY_GONE,
    GRAPH_DELETE_FAILED,
    GRAPH_DELETE_NOT_REQUIRED,
    GRAPH_DELETE_SUCCESS,
    clean_text,
    delete_calendar_event_from_graph_detailed,
    has_graph_credentials,
)

LEGACY_EVENT_TYPES = ("mcr", "progress-review")
BACKUP_RELATION = '"Coach".legacy_review_calendar_backup_20260913'
EXPECTED_COUNT = 23

# The local tables that hang off a calendar event. Each carries BOTH
# calendar_event_id and event_key (see the INSERTs in coach_api.views), and an
# older row may have been written with only one populated, so both are matched.
DEPENDENT_RELATIONS = (
    COACH_MEETING_ATTENDANCE_RELATION,
    COACH_MEETING_ATTENDANCE_REPORTS_RELATION,
    COACH_MEETING_ARTIFACTS_RELATION,
    COACH_MEETING_SUMMARIES_RELATION,
)


def needs_external_action(record):
    """True when Microsoft still holds something for this row.

    graph_event_id is the only addressable handle -- a meeting_link or
    graph_web_link without it cannot be deleted through Graph, but it still
    means the row had a real Teams meeting, so it is reported.
    """
    return bool(clean_text(record.graph_event_id))


def has_external_linkage(record):
    return bool(
        clean_text(record.graph_event_id)
        or clean_text(record.graph_web_link)
        or clean_text(record.meeting_link)
    )


class Command(BaseCommand):
    help = (
        "Cancel the external Teams meetings for the legacy MCM/Progress Review "
        "calendar rows, then delete those rows and their local dependencies."
    )

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--dry-run", action="store_true",
            help="Default. Report the candidates and what would happen. Changes nothing, locally or in Microsoft.",
        )
        mode.add_argument(
            "--cancel-external", action="store_true",
            help="PHASE 1 only: cancel the external Teams meetings. Deletes nothing from the database.",
        )
        mode.add_argument(
            "--apply", action="store_true",
            help="PHASE 1 then PHASE 2: cancel external meetings, then delete the rows transactionally.",
        )
        parser.add_argument(
            "--expect-count", type=int, default=EXPECTED_COUNT,
            help=f"Abort unless exactly this many candidates are found (default {EXPECTED_COUNT}).",
        )

    # ---------------------------------------------------------------- helpers

    @staticmethod
    def _legacy_queryset():
        """Exactly the audit predicate:

            event_type IN ('mcr','progress-review')
            AND NULLIF(BTRIM(review_template_id),'') IS NULL
            AND NULLIF(BTRIM(review_instance_id), '') IS NULL

        Coalesce+Trim rather than .exclude(__regex): the columns are Django
        CharFields but rows written by raw SQL can hold a genuine NULL, and a
        plain .exclude() on a non-nullable field drops NULL rows instead of
        matching them -- which would silently miss legacy rows.
        """
        return (
            CoachCalendarEvent.objects.filter(event_type__in=LEGACY_EVENT_TYPES)
            .annotate(
                _tpl=Trim(Coalesce("review_template_id", Value(""))),
                _inst=Trim(Coalesce("review_instance_id", Value(""))),
            )
            .filter(_tpl="", _inst="")
        )

    def _candidates(self):
        """The legacy set, ordered for a stable report."""
        return list(self._legacy_queryset().order_by("event_type", "learner_id", "target_date", "id"))

    def _guard_count(self, records, expected):
        if len(records) != expected:
            raise CommandError(
                f"ABORT: expected exactly {expected} legacy candidates, found {len(records)}. "
                "The database has changed since the audit -- re-run the audit SQL before proceeding."
            )

    def _guard_no_curriculum_linkage(self, records):
        """Belt and braces on the queryset, then the inverse link.

        review_instances.calendar_event_id is NOT backed by a foreign key
        (it is cross-schema and coach_calendar_event is Django-managed), so an
        instance can point AT a candidate whose own review_instance_id is
        blank. Deleting that row would leave a dangling pointer inside the new
        architecture, so this aborts rather than guessing.
        """
        bad = [r for r in records if clean_text(r.review_template_id) or clean_text(r.review_instance_id)]
        if bad:
            raise CommandError(
                f"ABORT: {len(bad)} candidate(s) carry Curriculum linkage: "
                + ", ".join(str(r.id) for r in bad)
            )

        from curriculum_api import views as curriculum_views

        ids = [r.id for r in records]
        try:
            rows = curriculum_views.fetch_all(
                "select id, calendar_event_id from "
                + curriculum_views.table_name("review_instances")
                + " where calendar_event_id = any(%s)",
                [ids],
            )
        except Exception as exc:
            raise CommandError(
                f"ABORT: could not check curriculum.review_instances for inverse links ({exc}). "
                "Refusing to delete without that check."
            ) from exc
        if rows:
            detail = ", ".join(f"{r['id']}->event {r['calendar_event_id']}" for r in rows)
            raise CommandError(
                f"ABORT: {len(rows)} curriculum review instance(s) point at a candidate "
                f"via calendar_event_id: {detail}. Investigate -- the new architecture must not be touched."
            )

    def _guard_backup(self, records, database):
        ids = [r.id for r in records]
        with connections[database].cursor() as cursor:
            # to_regclass needs the quoted form: the schema is "Coach" with a
            # capital C, and an unquoted identifier would be folded to lower
            # case and resolve to nothing.
            cursor.execute("select to_regclass(%s)", [BACKUP_RELATION])
            exists = cursor.fetchone()[0]
            if not exists:
                raise CommandError(
                    f"ABORT: backup table {BACKUP_RELATION} does not exist. "
                    "Create it before deleting anything."
                )
            cursor.execute(
                f"select count(*) from {BACKUP_RELATION} where id = any(%s)", [ids]
            )
            covered = cursor.fetchone()[0]
        if covered != len(ids):
            raise CommandError(
                f"ABORT: backup covers {covered} of {len(ids)} candidate rows. "
                "Refusing to delete unbacked rows."
            )
        self.stdout.write(f"Backup check: {covered}/{len(ids)} candidate rows present in {BACKUP_RELATION}.")

    # ----------------------------------------------------------- reporting

    def _report(self, records):
        external = [r for r in records if has_external_linkage(r)]
        actionable = [r for r in records if needs_external_action(r)]
        local_only = [r for r in records if not has_external_linkage(r)]

        self.stdout.write("")
        self.stdout.write("Legacy MCM / Progress Review candidates")
        self.stdout.write("=" * 120)
        for record in records:
            self.stdout.write(
                f"id={record.id} key={record.event_key}\n"
                f"    type={record.event_type} status={record.status}\n"
                f"    learner={clean_text(record.learner_name) or '-'} <{clean_text(record.learner_email) or '-'}> (learner_id={record.learner_id})\n"
                f"    owner={clean_text(record.owner_name) or '-'} <{clean_text(record.owner_email) or '-'}>\n"
                f"    target_date={record.target_date} scheduled_date={record.scheduled_date}\n"
                f"    meeting_provider={clean_text(record.meeting_provider) or '-'}\n"
                f"    graph_event_id={clean_text(record.graph_event_id) or '-'}\n"
                f"    graph_organizer_email={clean_text(record.graph_organizer_email) or '-'}\n"
                f"    graph_web_link={clean_text(record.graph_web_link) or '-'}\n"
                f"    meeting_link={clean_text(record.meeting_link) or '-'}\n"
                f"    external Graph action required: "
                f"{'YES' if needs_external_action(record) else ('NO (link only, nothing addressable)' if has_external_linkage(record) else 'NO')}"
            )
        self.stdout.write("=" * 120)
        by_type = {}
        for record in records:
            by_type[record.event_type] = by_type.get(record.event_type, 0) + 1
        for event_type in sorted(by_type):
            self.stdout.write(f"  {event_type}: {by_type[event_type]}")
        self.stdout.write(f"  total legacy   = {len(records)}")
        self.stdout.write(f"  external-linked = {len(external)}")
        self.stdout.write(f"  local-only      = {len(local_only)}")
        self.stdout.write(f"  Graph DELETE calls that will be attempted = {len(actionable)}")
        if len(external) != len(actionable):
            self.stdout.write(self.style.WARNING(
                f"  NOTE: {len(external) - len(actionable)} row(s) carry a meeting/web link but no graph_event_id. "
                "Nothing addressable to cancel; the Teams meeting (if any) is left in place."
            ))
        return actionable

    # ------------------------------------------------------------- phase 1

    def _cancel_external(self, actionable):
        if not actionable:
            self.stdout.write("PHASE 1: no rows carry a graph_event_id. Nothing to cancel.")
            return {}, []
        if not has_graph_credentials():
            raise CommandError(
                "ABORT: Microsoft Graph credentials are not configured, but "
                f"{len(actionable)} row(s) need an external cancellation."
            )

        self.stdout.write("")
        self.stdout.write(f"PHASE 1: cancelling {len(actionable)} external Teams meeting(s)...")
        outcomes, failures = {}, []
        for record in actionable:
            outcome, detail = delete_calendar_event_from_graph_detailed(record)
            outcomes[record.id] = outcome
            mailbox = clean_text(record.graph_organizer_email) or clean_text(record.owner_email)
            line = f"  [{outcome}] id={record.id} key={record.event_key} mailbox={mailbox}"
            if outcome == GRAPH_DELETE_SUCCESS:
                self.stdout.write(self.style.SUCCESS(line))
            elif outcome == GRAPH_DELETE_ALREADY_GONE:
                self.stdout.write(line + "  (already deleted in Microsoft -- safe to continue)")
            elif outcome == GRAPH_DELETE_NOT_REQUIRED:
                self.stdout.write(line)
            else:
                failures.append((record, detail))
                self.stderr.write(self.style.ERROR(line + f"\n      {detail}"))
        return outcomes, failures

    # ------------------------------------------------------------- phase 2

    def _delete_local(self, records, database):
        ids = [r.id for r in records]
        keys = [r.event_key for r in records]
        deleted = {}
        with transaction.atomic(using=database):
            with connections[database].cursor() as cursor:
                for relation in DEPENDENT_RELATIONS:
                    cursor.execute("select to_regclass(%s)", [relation])
                    if not cursor.fetchone()[0]:
                        deleted[relation] = "table absent -- skipped"
                        continue
                    cursor.execute(
                        f"delete from {relation} "
                        "where calendar_event_id = any(%s) or event_key = any(%s)",
                        [ids, keys],
                    )
                    deleted[relation] = cursor.rowcount
            removed, _ = CoachCalendarEvent.objects.filter(id__in=ids).delete()
            deleted['"Coach".coach_calendar_event'] = removed
        return deleted

    def _verify(self, database):
        self.stdout.write("")
        self.stdout.write("Verification")
        remaining = self._legacy_queryset().count()
        self.stdout.write(f"  A. legacy rows remaining (expect 0): {remaining}")

        with connections[database].cursor() as cursor:
            cursor.execute(f"select count(*) from {BACKUP_RELATION}")
            self.stdout.write(f"  B. backup rows retained (expect {EXPECTED_COUNT}): {cursor.fetchone()[0]}")

            orphans = {}
            for relation in DEPENDENT_RELATIONS:
                cursor.execute("select to_regclass(%s)", [relation])
                if not cursor.fetchone()[0]:
                    continue
                cursor.execute(
                    f"select count(*) from {relation} d "
                    'where not exists (select 1 from "Coach".coach_calendar_event e '
                    "where e.event_key = d.event_key)"
                )
                orphans[relation] = cursor.fetchone()[0]
            self.stdout.write("  C. orphaned meeting rows (expect 0 each):")
            for relation, count in orphans.items():
                self.stdout.write(f"       {relation}: {count}")

        from curriculum_api import views as curriculum_views

        for table in ("review_types", "review_templates", "review_instances"):
            rows = curriculum_views.fetch_all(
                f"select count(*) as n from {curriculum_views.table_name(table)}"
            )
            self.stdout.write(f"  D. curriculum.{table}: {rows[0]['n']} rows (untouched)")

        self.stdout.write(
            "  E. Occurrences are NOT persisted: the Curriculum engine recomputes MCM/PR "
            "on every calendar read from review_types + review_templates recurrence + "
            'enrolment."Created_users"."Start_date". Nothing is regenerated into the database here.'
        )

    # ---------------------------------------------------------------- handle

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        cancel_external = options["cancel_external"]
        dry_run = options["dry_run"] or not (apply_changes or cancel_external)
        expected = options["expect_count"]

        database = router.db_for_write(CoachCalendarEvent) or "default"
        records = self._candidates()
        self._guard_count(records, expected)
        actionable = self._report(records)

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(
                "DRY RUN -- nothing was changed, locally or in Microsoft.\n"
                "Next: python manage.py cleanup_legacy_reviews --cancel-external"
            ))
            return

        # Guards that protect the new architecture run before ANY external
        # call, so an aborted run leaves Microsoft untouched too.
        self._guard_no_curriculum_linkage(records)
        if apply_changes:
            self._guard_backup(records, database)

        outcomes, failures = self._cancel_external(actionable)

        if failures:
            raise CommandError(
                f"ABORT: {len(failures)} external cancellation(s) FAILED. "
                "No database rows were deleted -- deleting them would strand a live Teams "
                "meeting with no stored identifier to cancel it by. Resolve the Graph "
                "errors above and re-run."
            )

        blocked = [
            record_id for record_id, outcome in outcomes.items()
            if outcome not in (GRAPH_DELETE_SUCCESS, GRAPH_DELETE_ALREADY_GONE, GRAPH_DELETE_NOT_REQUIRED)
        ]
        if blocked:
            raise CommandError(f"ABORT: unresolved external outcomes for event ids {blocked}.")

        if cancel_external:
            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS(
                "PHASE 1 complete. No database rows were deleted.\n"
                "Next: python manage.py cleanup_legacy_reviews --apply"
            ))
            return

        self.stdout.write("")
        self.stdout.write(f"PHASE 2: deleting {len(records)} legacy row(s) and their local dependencies...")
        deleted = self._delete_local(records, database)
        for relation, count in deleted.items():
            self.stdout.write(f"  {relation}: {count}")

        self._verify(database)
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Cleanup complete."))
        self.stdout.write(
            "Progress Review history ("
            '"Learner".progress_review_runs / _source_snapshots / _pptx_files) was NOT touched: '
            "those tables carry no event_key or calendar_event_id, so no row can be proven to "
            "belong to a deleted calendar event."
        )
