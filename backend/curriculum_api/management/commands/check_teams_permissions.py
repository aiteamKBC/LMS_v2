"""Read-only Microsoft permission check for one Teams meeting.

    python manage.py check_teams_permissions <live_session_id>
    python manage.py check_teams_permissions <live_session_id> --json

Reads only (GET requests to Microsoft Graph and one read of the LMS series
row). It never writes to Microsoft or the LMS, sends nothing, grants nothing,
and never prints the access token or client secret.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.teams_permission_check import check_live_session


class Command(BaseCommand):
    help = 'Read-only check of whether the LMS app may manage one Teams meeting, with the admin commands to verify it.'

    def add_arguments(self, parser):
        parser.add_argument('live_session_id')
        parser.add_argument('--json', action='store_true', help='Print the full report as JSON.')

    def handle(self, *args, live_session_id, **options):
        try:
            report = check_live_session(live_session_id)
        except LookupError as exc:
            raise CommandError(str(exc)) from exc
        if options['json']:
            self.stdout.write(json.dumps(report, indent=2, default=str))
            return
        self.stdout.write(f"Checked {report['checkedAt']} (read-only). Verdict: {report['verdict'].upper()}")
        self.stdout.write(f"App client ID: {report['app']['clientId']}  ({report['app']['permissionContext']})")
        self.stdout.write(f"Organiser: {report['organizer']['email']}  object ID used: {report['organizer']['objectId']}")
        self.stdout.write(f"Graph path: {report['meeting']['graphPath'] or '(no online meeting ID saved)'}")
        for item in report['checks']:
            self.stdout.write(f"[{item['status'].upper():7}] {item['key']}: {item['summary']}")
            error = item.get('graphError') or {}
            if error:
                self.stdout.write(f"          HTTP {error.get('status')} {error.get('code')}: {error.get('message')} "
                                  f"(request-id {error.get('requestId') or '-'}, at {error.get('at') or '-'})")
        for action in report['actions']:
            self.stdout.write(f'ACTION: {action}')
        self.stdout.write('')
        for line in report['adminCommands']:
            self.stdout.write(line)
