"""Read-only Teams-to-LMS recording completeness check."""

import json

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.session_recordings_audit import audit_recordings


class Command(BaseCommand):
    help = 'Compare Teams recordings with saved LMS artifacts and Azure blobs without changing data.'

    def add_arguments(self, parser):
        parser.add_argument('--live-session-id', action='append', dest='live_session_ids', default=[],
                            help='Check only this session series; repeat for multiple series.')
        parser.add_argument('--json', action='store_true', help='Print a machine-readable report.')

    def handle(self, *args, **options):
        report = audit_recordings(options['live_session_ids'])
        if options['json']:
            self.stdout.write(json.dumps(report, indent=2))
        else:
            self.stdout.write(f"Checked {report['seriesChecked']} series and {report['graphRecordings']} Teams recordings; "
                              f"{report['readyRecordings']} of {report['savedRecordings']} LMS recordings are ready.")
            for issue in report['issues']:
                self.stdout.write(' '.join(str(issue.get(key, '')) for key in
                    ('code', 'seriesId', 'occurrenceId', 'artifactId', 'httpStatus')).rstrip())
        if report['issues']:
            raise CommandError(f"{len(report['issues'])} recording issue(s) need attention.")
        self.stdout.write(self.style.SUCCESS('All discovered Teams recordings are archived and present in Azure.'))
