"""The change log keeps what changed, not everything a record holds."""
from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from curriculum_api import quality, versioning
from system_audit import writes


class TeamsSystemKeysTests(SimpleTestCase):
    def test_teams_ids_and_links_become_one_linked_flag(self):
        settings = {
            'teamsEventId': 'AAMk-event', 'teamsOnlineMeetingId': 'MSo-meeting',
            'teamsMeetingUrl': 'https://teams.microsoft.com/l/meetup-join/x',
            'liveSessionUrl': 'https://teams.microsoft.com/l/meetup-join/x',
            'teamsLiveSessionId': 'LIVE-1', 'teamsRecording': 'record', 'title': 'Week 1',
        }
        kept = versioning.logged_settings(settings)
        self.assertEqual(kept, {'teamsRecording': 'record', 'title': 'Week 1', 'teamsMeeting': 'Linked'})

    def test_a_push_that_only_writes_teams_ids_records_nothing_new(self):
        before = versioning.build_snapshot('component', {'id': 'c1', 'settings_json': {'teamsRecording': 'record'}})
        after = versioning.build_snapshot('component', {'id': 'c1', 'settings_json': {
            'teamsRecording': 'record', 'teamsEventId': 'AAMk-event', 'teamsMeetingUrl': 'https://x',
        }})
        changes = versioning.diff_snapshots(before, after)
        self.assertEqual(changes, [{'field': 'settings.teamsMeeting', 'from': '', 'to': 'Linked', 'truncated': False}])

    def test_older_snapshots_are_compared_in_todays_shape(self):
        stored = {'id': 'c1', 'settings_json': {'teamsEventId': 'AAMk-event', 'teamsRecording': 'record'}}
        current = versioning.build_snapshot('component', {'id': 'c1', 'settings_json': {
            'teamsEventId': 'AAMk-event', 'teamsRecording': 'none',
        }})
        changes = versioning.diff_snapshots(versioning.logged_view('component', stored), current)
        self.assertEqual([change['field'] for change in changes], ['settings.teamsRecording'])

    def test_microsoft_calendar_ids_are_not_kept_on_a_live_session(self):
        snapshot = versioning.build_snapshot('live_session', {
            'id': 'LIVE-1', 'graph_event_id': 'AAMk', 'online_meeting_id': 'MSo', 'recording': 'record',
        })
        self.assertNotIn('graph_event_id', snapshot)
        self.assertNotIn('online_meeting_id', snapshot)
        self.assertEqual(snapshot['recording'], 'record')


class CondensedFieldTests(SimpleTestCase):
    def test_an_invite_list_is_a_count_and_what_moved(self):
        change = versioning.change_entry(
            'settings.teamsAttendees',
            ['a@example.invalid', 'b@example.invalid'],
            ['b@example.invalid', 'c@example.invalid', 'd@example.invalid'],
        )
        self.assertEqual(change['from'], '2 invited')
        self.assertEqual(change['to'], '3 invited (+2, -1)')
        self.assertNotIn('example.invalid', change['from'] + change['to'])

    def test_free_text_says_it_changed_and_never_what_it_said(self):
        for field, before, after in (
            ('description', 'Old wording', 'New wording'),
            ('settings.contentHtml', '<p>old</p>', '<p>new</p>'),
            ('settings.instructions', 'Do this', 'Do that'),
            ('settings.anything', 'x' * 300, 'y' * 300),
        ):
            change = versioning.change_entry(field, before, after)
            self.assertEqual((change['from'], change['to'], change.get('text')), ('', 'Text changed', True), field)

    def test_ordinary_settings_keep_their_before_and_after(self):
        change = versioning.change_entry('settings.sessionDay', 'Thursday', 'Wednesday')
        self.assertEqual((change['from'], change['to']), ('Thursday', 'Wednesday'))
        self.assertNotIn('text', change)


class BurstMergeTests(SimpleTestCase):
    now = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)

    def entry(self, **overrides):
        previous = {
            'id': 7, 'action': 'updated', 'actor_email': 'Tutor@example.invalid',
            'created_at': self.now - timedelta(minutes=4), 'version_label': '', 'content_status': '',
        }
        previous.update(overrides.pop('previous', {}))
        entry = {
            'entity_type': 'component', 'entity_id': 'c1', 'action': 'updated',
            'actor_email': 'tutor@example.invalid', 'previous': previous,
            'version_label': '', 'content_status': '',
        }
        entry.update(overrides)
        return entry

    def test_the_same_person_editing_on_within_ten_minutes_extends_one_line(self):
        self.assertEqual(versioning.burst_target(self.entry(), self.now)['id'], 7)

    def test_a_different_person_an_older_line_or_a_non_edit_starts_a_new_line(self):
        self.assertIsNone(versioning.burst_target(self.entry(actor_email='coach@example.invalid'), self.now))
        self.assertIsNone(versioning.burst_target(
            self.entry(previous={'created_at': self.now - timedelta(minutes=11)}), self.now))
        self.assertIsNone(versioning.burst_target(self.entry(action='archived'), self.now))
        self.assertIsNone(versioning.burst_target(self.entry(previous={'action': 'created'}), self.now))
        self.assertIsNone(versioning.burst_target(self.entry(actor_email=''), self.now))

    def test_a_save_naming_a_new_version_is_its_own_line(self):
        self.assertIsNone(versioning.burst_target(self.entry(version_label='1.1'), self.now))

    def test_merged_fields_run_from_the_first_value_to_the_last(self):
        merged = versioning.merge_changes(
            [{'field': 'title', 'from': 'A', 'to': 'B'}, {'field': 'points', 'from': '1', 'to': '2'}],
            [{'field': 'title', 'from': 'B', 'to': 'C'}, {'field': 'points', 'from': '2', 'to': '1'}],
        )
        self.assertEqual(merged, [{'field': 'title', 'from': 'A', 'to': 'C', 'truncated': False}])

    def test_text_that_changed_stays_changed(self):
        text = {'field': 'description', 'from': '', 'to': 'Text changed', 'text': True}
        self.assertEqual(len(versioning.merge_changes([text], [dict(text)])), 1)


class EmptyEditTests(SimpleTestCase):
    def test_an_update_that_changes_only_ignored_keys_writes_nothing(self):
        previous = {'id': 1, 'revision_no': 3, 'snapshot': versioning.build_snapshot(
            'component', {'id': 'c1', 'settings_json': {'updatedAt': '1'}})}
        item = {
            'entity_type': 'component', 'entity_id': 'c1', 'deleted': False,
            'snapshot': versioning.build_snapshot('component', {'id': 'c1', 'settings_json': {'updatedAt': '2'}}),
            'actor': {'email': 'a@example.invalid', 'name': 'A'}, 'actor_type': 'user',
            'reason': '', 'source': '', 'metadata': {}, 'action_override': '', 'triggered_by': None,
        }
        self.assertIsNone(versioning.build_revision('component', item, {'c1': previous}, {}))

    def test_the_trail_skips_an_edit_whose_saves_cancelled_out(self):
        clause, _ = writes.revision_workspace_clause('')
        self.assertIn(writes.EMPTY_EDIT_CLAUSE, clause)
        clause, _ = writes.revision_workspace_clause('curriculum')
        self.assertIn(writes.EMPTY_EDIT_CLAUSE, clause)


class WindowTests(SimpleTestCase):
    def test_curriculum_studio_reads_its_whole_history_and_the_rest_seven_days(self):
        self.assertEqual(quality.window_limit('curriculum'), quality.UNLIMITED_WINDOW_DAYS)
        for workspace in ('learner', 'coach', 'admin', 'enrolment', ''):
            self.assertEqual(quality.window_limit(workspace), 7, workspace)
