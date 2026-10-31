import unittest
from .teams_update_preservation import calendar_occurrence_details, unresolved_saved_bindings


class SavedBindingChecks(unittest.TestCase):
    def component(self, **changes):
        return {'id': 'COMP', 'settings': {'teamsLiveSessionId': 'LIVE', 'teamsOccurrenceId': 'OCC', **changes}}

    def test_missing_identity_blocks_a_schedule_update(self):
        self.assertEqual(unresolved_saved_bindings('LIVE', [self.component()], [{'id': 'OTHER'}]), ['COMP'])

    def test_historical_and_cancelled_ids_remain_known(self):
        for status in ('scheduled', 'completed', 'cancelled', 'superseded'):
            with self.subTest(status=status):
                self.assertEqual(unresolved_saved_bindings('LIVE', [self.component()], [{'id': 'OCC', 'status': status}]), [])

    def test_other_calendars_additional_meetings_and_manual_links_are_not_adopted(self):
        for changes in ({'teamsLiveSessionId': 'OTHER'}, {'teamsMeetingScope': 'additional'},
                        {'extraTeamsMeetingUrl': 'https://example.invalid/extra'},
                        {'liveSessionLinkOverride': 'https://example.invalid/other'},
                        {'teamsLiveSessionId': '', 'teamsOccurrenceId': ''}):
            with self.subTest(changes=changes):
                self.assertEqual(unresolved_saved_bindings('LIVE', [self.component(**changes)], []), [])

    def test_an_override_of_the_same_main_link_does_not_hide_a_broken_identity(self):
        self.assertEqual(unresolved_saved_bindings('LIVE', [self.component(liveSessionLinkOverride='LINK')], [], join_url='LINK'), ['COMP'])

    def test_an_existing_id_wins_over_a_legacy_session_number(self):
        self.assertEqual(unresolved_saved_bindings('LIVE', [self.component(teamsSessionNumber=1)],
            [{'id': 'OTHER', 'session_number': 1}, {'id': 'OCC', 'session_number': 8}]), [])

    def test_imported_instance_ids_are_not_treated_as_separate_meetings(self):
        rows = [{'id': 'OCC', 'join_url': 'LINK', 'graph_event_id': 'INSTANCE'},
                {'id': 'EXTRA', 'join_url': 'OTHER-LINK', 'graph_event_id': 'OTHER-EVENT'}]
        result = calendar_occurrence_details({'meeting_type': 'linked-external', 'join_url': 'LINK', 'graph_event_id': 'MASTER'}, rows)
        self.assertEqual([row['graph_event_id'] for row in result], ['MASTER', 'OTHER-EVENT'])
        self.assertEqual([row['graph_event_id'] for row in rows], ['INSTANCE', 'OTHER-EVENT'])

    def test_managed_standalone_details_are_unchanged(self):
        rows = [{'graph_event_id': 'SEPARATE-EVENT', 'join_url': 'SEPARATE-LINK'}]
        self.assertIs(calendar_occurrence_details({'meeting_type': 'live-session'}, rows), rows)
