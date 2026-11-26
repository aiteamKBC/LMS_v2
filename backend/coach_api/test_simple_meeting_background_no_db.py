"""Background APTEM meeting reader; synthetic provider and no database I/O."""
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .management.commands.sync_coach_meeting_snapshots import Command


class ImportedMeetingBackgroundTests(SimpleTestCase):
    def test_unclaimed_review_refresh_keeps_two_calls_and_excludes_other_meeting(self):
        record = SimpleNamespace(event_key='imported-review:synthetic',
            graph_event_id='calendar-event', meeting_link='https://teams.microsoft.com/synthetic')
        def artifact(name, call, meeting):
            return {'artifact_type': 'recording', 'graph_artifact_id': name,
                    'call_id': call, 'metadata': {'meetingId': meeting}}
        snapshot = {'artifacts': [artifact('early', 'call-one', 'meeting-one'),
                                  artifact('late', 'call-two', 'meeting-one'),
                                  artifact('foreign', 'call-three', 'other-meeting')],
                    'attendanceReports': [], 'attendance': {'records': []},
                    'attendanceTracker': {}, 'errors': [], 'partial': False}
        previous = {'artifacts': [], 'attendanceReports': [], 'attendanceTracker': {},
                    'storage': {'stored': True}, 'partial': False}
        target = SimpleNamespace(online_meeting_id='meeting-one')

        def resolve(_record, *, identity_out):
            identity_out['target'] = target
            return 'users/synthetic/onlineMeetings/meeting-one', None

        def fetch(_record, **options):
            self.assertEqual(options['target_resolver'](_record),
                             ('users/synthetic/onlineMeetings/meeting-one', None))
            self.assertEqual(options['transcript_content_selector'](_record, [], []), [])
            return snapshot, None, 200

        command = Command(stdout=StringIO())
        with patch.object(command, '_matching_records', return_value=[record]), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.imported_context',
                   return_value={'family': 'MCM', 'overlayId': None}), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.coach_meeting_snapshot_tables_ready',
                   return_value=True), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.stored_coach_meeting_snapshot',
                   return_value=previous), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.fetch_coach_meeting_graph_snapshot',
                   side_effect=fetch), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.persist_coach_meeting_snapshots',
                   return_value={'stored': True, 'resourceRefresh': 'partial'}) as persist:
            command.handle(**{'all': False, 'recent': False, 'event_key': record.event_key,
                'owner_email': '', 'limit': 1, 'lookback_hours': 24, 'lead_minutes': 10,
                'dry_run': False, 'allow_missing_tables': False})

        payload = persist.call_args.kwargs['imported_refresh']
        self.assertEqual(payload['meeting_id'], 'meeting-one')
        self.assertEqual({row['graph_artifact_id'] for row in payload['snapshot']['artifacts']},
                         {'early', 'late'})
        self.assertTrue(all(row['metadata']['_lms_verified_online_meeting_id'] == 'meeting-one'
                            for row in payload['snapshot']['artifacts']))
        self.assertTrue(payload['snapshot']['partial'])
