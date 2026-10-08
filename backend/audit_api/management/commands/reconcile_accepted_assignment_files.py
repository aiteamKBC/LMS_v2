"""Complete Aptem assignment components with accepted file evidence.

Dry-run by default. Existing actual hours are preserved; only missing hours
are filled from the sum of accepted File evidence spent_time (minutes).
Run this after importing new Aptem evidence to reconcile the Last_audit mirror.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


ACCEPTED_FILES = """
    with accepted_files as (
        select e.learner_id, e.component_id,
               sum(e.spent_time) / 60 as recorded_hours
        from fetching_evidence.evidence_items e
        where lower(btrim(e.evidence_kind)) = 'file'
          and nullif(btrim(e.file_blob), '') is not null
          and lower(btrim(e.evidence_status)) = 'accepted'
        group by e.learner_id, e.component_id
    )
"""

NEEDS_COMPLETION = "lower(btrim(coalesce(a.status, ''))) <> 'completed'"
NEEDS_UPDATE = f"({NEEDS_COMPLETION} or (a.actual_hours is null and af.recorded_hours is not null))"

PREVIEW_SQL = ACCEPTED_FILES + f"""
    select count(*) as matching_components,
           count(distinct a.aptem_id) as matching_learners,
           count(*) filter (where {NEEDS_COMPLETION}) as incomplete_components,
           count(*) filter (where a.actual_hours is null and af.recorded_hours is not null) as missing_hours,
           count(*) filter (where {NEEDS_UPDATE}) as changes_needed
    from "Last_audit".learner_assignments a
    join accepted_files af on af.learner_id = a.aptem_id
                          and af.component_id = a.component_id
"""

UPDATE_SQL = ACCEPTED_FILES + f"""
    update "Last_audit".learner_assignments a
    set status = case when {NEEDS_COMPLETION} then 'Completed' else a.status end,
        actual_hours = coalesce(a.actual_hours, af.recorded_hours),
        updated_at = now()
    from accepted_files af
    where af.learner_id = a.aptem_id and af.component_id = a.component_id
      and {NEEDS_UPDATE}
"""


class Command(BaseCommand):
    help = 'Reconcile accepted Aptem File assignments into Last_audit; dry-run by default.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Write scoped status and missing-hour changes.')
        parser.add_argument('--expect-matching', type=int, help='Expected matching component count when applying.')
        parser.add_argument('--expect-updates', type=int, help='Expected changed component count when applying.')

    def handle(self, *args, **options):
        database = connections['enrolment']
        if database.vendor != 'postgresql':
            raise CommandError('The enrolment database must be PostgreSQL.')
        if options['apply'] and (options['expect_matching'] is None or options['expect_updates'] is None):
            raise CommandError('--apply requires --expect-matching and --expect-updates from a fresh dry run.')

        self.stdout.write(f"Target: enrolment / {database.settings_dict['NAME']}")
        if not options['apply']:
            with database.cursor() as cursor:
                cursor.execute(PREVIEW_SQL)
                matching, learners, incomplete, missing_hours, changes = cursor.fetchone()
            self.stdout.write(
                f'Matching components: {matching}; learners: {learners}; '
                f'not complete: {incomplete}; missing hours: {missing_hours}; updates: {changes}.')
            self.stdout.write('Dry run; no changes made.')
            return

        with transaction.atomic(using='enrolment'):
            with database.cursor() as cursor:
                cursor.execute(PREVIEW_SQL)
                matching, learners, incomplete, missing_hours, changes = cursor.fetchone()
                if (matching, changes) != (options['expect_matching'], options['expect_updates']):
                    raise CommandError('Assignment source changed since the dry run; no changes made.')
                cursor.execute(UPDATE_SQL)
                if cursor.rowcount != changes:
                    raise CommandError('Assignment update count differed from the preview; no changes made.')
                cursor.execute(PREVIEW_SQL)
                remaining = cursor.fetchone()[-1]
                if remaining:
                    raise CommandError('Assignment reconciliation did not verify; no changes made.')
        self.stdout.write(self.style.SUCCESS(
            f'Updated and verified {changes} components across {learners} matching learners '
            f'({incomplete} completions, {missing_hours} missing-hour values).'))
