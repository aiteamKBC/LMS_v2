"""Check GOV.UK's bank holiday feed and bring curriculum.england_holidays into line.

The work itself lives in ``curriculum_api.england_holidays`` -- shared with the
background refresh and the "Check GOV.UK now" button, so all three agree on what
counts as a change and all three record what they found. This command is the
hands-on way in: run it from cron, or run it to see what the feed is saying.

Dry-run by default: pass --apply to write.

    python manage.py fetch_england_holidays          # report only
    python manage.py fetch_england_holidays --apply  # write, and record the check

The table is created and seeded by
sql/2026-09-13_curriculum_england_holidays.sql, and the ledger this command
writes to by sql/2026-09-14_curriculum_england_holiday_syncs.sql.
"""

from django.core.management.base import BaseCommand

from ... import england_holidays, views


class Command(BaseCommand):
    help = (
        "Check GOV.UK's bank holidays and update curriculum.england_holidays "
        'to match. Dry-run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write the changes. Without it the command only reports.',
        )

    def handle(self, *args, **options):
        apply_changes = options['apply']

        views.reset_schema_ready_flags()
        summary = england_holidays.run_sync(source='command', apply=apply_changes)

        if summary['status'] != 'ok':
            self.stderr.write(self.style.ERROR(summary['message']))
            return

        for item in summary['added']:
            self.stdout.write(f"+ {item['date']} {item['title']}{self.note(item)}")
        for item in summary['moved']:
            self.stdout.write(
                f"> {item['title']}: {item['previousDate']} -> {item['date']}{self.note(item)}"
            )
        for item in summary['changed']:
            was = item.get('previous') or {}
            self.stdout.write(
                f"~ {item['date']} {was.get('title', '')} -> {item['title']}{self.note(item)}"
            )
        for item in summary['withdrawn']:
            self.stdout.write(f"- {item['date']} {item['title']} is no longer a bank holiday")

        self.stdout.write('')
        self.stdout.write(
            f"{summary['feedCount']} holidays in the feed "
            f"({summary.get('feedStart')} to {summary.get('feedEnd')}): "
            f"{len(summary['added'])} new, {len(summary['moved'])} moved, "
            f"{len(summary['changed'])} changed, {len(summary['withdrawn'])} withdrawn, "
            f"{summary['unchanged']} already correct."
        )
        if summary['agedOut']:
            dates = [item['date'] for item in summary['agedOut']]
            self.stdout.write(
                f'{len(dates)} stored holidays are older than the feed window '
                f'({min(dates)} to {max(dates)}) and are left as they are.'
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                'Dry run. Re-run with --apply to write these holidays.'
            ))
            return

        self.stdout.write(self.style.SUCCESS(
            f"{len(summary['added'])} added, {len(summary['moved'])} moved, "
            f"{len(summary['changed'])} updated, {len(summary['withdrawn'])} removed, "
            f"{summary['feedCount']} confirmed against the feed."
        ))

    @staticmethod
    def note(item):
        return f" ({item['notes']})" if item.get('notes') else ''
