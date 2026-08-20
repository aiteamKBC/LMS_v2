"""Extend stored cohort end dates by the holiday days they never counted.

A cohort's practical end date used to be the duration rule alone: start date
plus the duration, less a day. The holidays applied to the cohort were only ever
read by ``build_module_session_plan``, which skips a session landing on one and
pushes it to the next slot -- keeping the session count and stretching the
calendar span. So the sessions ran past the practical end date the cohort
carried, and nothing reported the gap.

``cohort_practical_end_date`` now folds the holiday days into the date, and every
write path uses it. Cohorts stored before that keep their unextended dates until
something saves them, which for a cohort nobody is editing is never. This
command repairs those rows.

For each cohort it re-derives the date from the same helper the editor and the
API use, so a repaired row is identical to one saved today, then recomputes the
apprenticeship end date from the moved practical end via the stored EPA period.

What it will not touch:

* a cohort whose ``apprenticeship_end_override`` is set keeps that authored date
  -- a human typed it, and the practical end moving is not licence to discard it;
* a cohort with no start date or no duration, which has no rule to apply;
* a cohort already carrying the extended date (idempotent: running twice is a
  no-op, and the extension is measured over the base period so it cannot creep).

A cohort whose end date was authored by hand is indistinguishable in storage from
one the old rule produced -- both are just a date in ``end_date``. This command
therefore only rewrites a row whose stored date equals the *unextended* rule for
its start date and duration, which is what the old code would have written. A
hand-authored date that happens to equal that is rewritten too; pass
--only-cohort to work through those individually if that matters to you.

Dry-run by default: pass --apply to write.
"""

from django.core.management.base import BaseCommand
from django.db import connection, transaction

from ... import views


class Command(BaseCommand):
    help = (
        'Extend stored cohort practical/apprenticeship end dates by the holiday '
        'days the old duration-only rule never counted. Dry-run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write the repaired dates. Without it the command only reports.',
        )
        parser.add_argument(
            '--only-cohort', dest='only_cohort', default=None,
            help='Repair a single cohort id rather than every stored cohort.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']
        only_cohort = (options.get('only_cohort') or '').strip()

        views.reset_schema_ready_flags()
        try:
            holiday_rows = [] if not views.holiday_table_name() else views.get_holiday_rows()
        except (Exception, AssertionError) as exc:
            self.stderr.write(self.style.ERROR(f'Could not read the holidays table: {exc}'))
            return

        rows = views.cohort_authoring_detail_rows()
        if only_cohort:
            rows = [row for row in rows if views.clean_str(row.get('cohortId')) == only_cohort]
            if not rows:
                self.stderr.write(self.style.ERROR(f'No stored cohort with id {only_cohort}.'))
                return

        planned = []
        skipped_authored = 0
        skipped_incomplete = 0
        already_correct = 0

        for row in rows:
            cohort_id = views.clean_str(row.get('cohortId'))
            start_date = views.format_date(row.get('startDate'))
            duration_months = views.parse_int(row.get('durationMonths'), 0)
            stored_end = views.format_date(row.get('practicalEndDate') or row.get('endDate'))

            if not start_date or duration_months <= 0 or not stored_end:
                skipped_incomplete += 1
                continue

            base_end = views.format_date(views.calculate_cohort_end_date(start_date, duration_months))
            extended_end = views.format_date(views.cohort_practical_end_date(
                start_date, duration_months, row.get('holidayIds'), holiday_rows,
            ))

            if not base_end or not extended_end or extended_end == stored_end:
                already_correct += 1
                continue

            # Only a date matching the *unextended* rule can be one the old code
            # wrote. Anything else is a human's, and is left alone.
            if stored_end != base_end:
                skipped_authored += 1
                continue

            epa_months = views.parse_epa_months(row.get('epaMonths'))
            override = views.format_date(row.get('apprenticeshipEndOverride'))
            _, apprenticeship_end = views.cohort_epa_dates(extended_end, epa_months, override)

            planned.append({
                'cohortId': cohort_id,
                'cohortName': views.clean_str(row.get('cohortName')),
                'startDate': start_date,
                'durationMonths': duration_months,
                'from': stored_end,
                'to': extended_end,
                'days': (views.parse_date(extended_end) - views.parse_date(base_end)).days,
                'apprenticeshipFrom': views.format_date(row.get('apprenticeshipEndDate')),
                'apprenticeshipTo': views.format_date(apprenticeship_end),
                'apprenticeshipOverride': bool(override),
            })

        for item in planned:
            note = ' (apprenticeship end authored, left as is)' if item['apprenticeshipOverride'] else ''
            self.stdout.write(
                f"{item['cohortId']} {item['cohortName']}: "
                f"practical {item['from']} -> {item['to']} (+{item['days']} holiday days), "
                f"apprenticeship {item['apprenticeshipFrom'] or '--'} -> {item['apprenticeshipTo'] or '--'}{note}"
            )

        self.stdout.write('')
        self.stdout.write(
            f'{len(rows)} cohorts read: {len(planned)} to extend, {already_correct} already correct, '
            f'{skipped_authored} with a hand-set end date, {skipped_incomplete} without a start date or duration.'
        )

        if not planned:
            self.stdout.write(self.style.SUCCESS('Nothing to do.'))
            return

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run. Re-run with --apply to write these dates.'))
            return

        table = views.authoring_table_name(views.COHORT_AUTHORING_DETAILS_TABLE)
        written = 0
        with transaction.atomic():
            with connection.cursor() as cursor:
                for item in planned:
                    # apprenticeship_end_date caches whichever of the EPA rule and
                    # the authored override applies; cohort_epa_dates already
                    # resolved that, so the cached value follows the practical end.
                    cursor.execute(
                        f'''update {table}
                               set end_date = %s,
                                   apprenticeship_end_date = %s,
                                   updated_at = current_timestamp
                             where cohort_id = %s''',
                        [item['to'], item['apprenticeshipTo'] or None, item['cohortId']],
                    )
                    written += cursor.rowcount

        views.invalidate_curriculum_cache()
        self.stdout.write(self.style.SUCCESS(f'{written} cohort rows updated.'))
