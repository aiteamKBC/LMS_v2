"""Module assignments and live authored content, without a database or writes."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .learning_plan import _effective_plan_ids, learning_plan, module_learners
from .learner_detail import (
    _append_week_quizzes,
    _live_session_occurrence_fallbacks,
    _resolve_from_master,
)
from .mappers import get_training_plan, stored_training_plan, training_plan_field


MODULE = {
    'moduleId': 'MOD-NEW', 'moduleTitle': 'New module', 'programmeId': 'PROG-1',
    'programmeName': 'Programme', 'groupName': 'Group', 'hours': 12, 'startDate': '', 'endDate': '',
}


def learner(**changes):
    return SimpleNamespace(**{
        'id': 101, 'pk': 101, 'username': 'Learner', 'email': 'learner@example.test',
        'programme': 'Programme', 'group': 'Group', 'cohort': 'Cohort',
        'programme_status': 'Delivery', 'learner_type': 'commercial',
        'learning_plan': None, 'training_plan': None, 'free_courses': [], 'save': Mock(), **changes,
    })


class ModuleAssignmentTests(SimpleTestCase):
    def test_both_plan_columns_use_the_same_precedence_for_reads_and_writes(self):
        for training in ([MODULE], json.dumps([MODULE])):
            source = learner(training_plan=training, learning_plan=[{'moduleId': 'OLD'}])
            self.assertEqual(get_training_plan(source), [MODULE])
            self.assertEqual(training_plan_field(source), 'training_plan')
        source = learner(learning_plan=[MODULE])
        self.assertEqual(get_training_plan(source), [MODULE])
        self.assertEqual(training_plan_field(source), 'learning_plan')

    def test_clearing_a_plan_does_not_restore_old_csv_or_group_assignments(self):
        source = learner(training_plan=[], learning_plan=[MODULE], modules='Old course')
        self.assertEqual(get_training_plan(source), [])
        with patch('learner_api.learning_plan._group_module_ids') as preset:
            self.assertEqual(_effective_plan_ids(source, {}), [])
        preset.assert_not_called()

    def test_unsaved_legacy_csv_remains_readable(self):
        source = learner(modules='Historic course')
        self.assertIsNone(stored_training_plan(source))
        self.assertEqual(get_training_plan(source)[0]['moduleTitle'], 'Historic course')

    def test_saving_empty_training_plan_keeps_it_empty_in_the_response(self):
        source = learner(training_plan=[MODULE])
        request = RequestFactory().patch('/', data=json.dumps({'modules': []}), content_type='application/json')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')), \
                patch('learner_api.learning_plan.EnrolmentUser') as model, \
                patch('learner_api.learning_plan._all_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._programme_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._group_module_ids', return_value=['MOD-NEW']), \
                patch('learner_api.learning_plan.advance_learner'), \
                patch('learner_api.learning_plan.sync_learning_plan_mirror') as sync_mirror:
            model.all_learners.get.return_value = source
            response = learning_plan(request, 101)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['plan'], [])
        self.assertTrue(json.loads(response.content)['saved'])
        source.save.assert_called_once_with(update_fields=['training_plan'])
        sync_mirror.assert_called_once_with(source)

    def test_builder_assignment_uses_the_same_column_and_preserves_other_learners(self):
        source, other = learner(training_plan=[]), learner(id=102, pk=102, learning_plan=[])
        request = RequestFactory().patch('/', data=json.dumps({'learnerIds': ['101']}), content_type='application/json')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')), \
                patch('learner_api.learning_plan._all_modules', return_value=[MODULE]), \
                patch('learner_api.learning_plan._picker_learners', return_value=[source, other]), \
                patch('learner_api.learning_plan._group_module_ids', return_value=[]), \
                patch('learner_api.learning_plan.advance_learner'), \
                patch('learner_api.learning_plan.sync_learning_plan_mirror') as sync_mirror:
            response = module_learners(request, 'MOD-NEW')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(get_training_plan(source), [MODULE])
        self.assertEqual(get_training_plan(other), [])
        source.save.assert_called_once_with(update_fields=['training_plan'])
        other.save.assert_not_called()
        sync_mirror.assert_called_once_with(source)


class LiveAssignedModuleTests(SimpleTestCase):
    def resolve(self, rows, modules=None, weeks=None, components=None, assigned=None, shared_delivery=None, **options):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        supplied = iter(rows)
        # These cases author KSBs on the component itself; the separate mapping
        # table is empty. Keep that read from consuming a fixture for another query.
        cursor.fetchall.side_effect = lambda: (
            [] if 'FROM curriculum.ksb_mappings' in cursor.execute.call_args.args[0]
            else next(supplied)
        )
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}), \
                patch('learner_api.shared_live_delivery.read_shared_live_delivery', return_value=shared_delivery or {}):
            result = _resolve_from_master(modules or [], weeks or [], components or [], assigned_modules=assigned, **options)
        return result, cursor

    def test_new_assignment_is_visible_before_it_has_weeks(self):
        result, cursor = self.resolve([[('MOD-NEW', 'Renamed module')], [], []], assigned=[MODULE])
        self.assertEqual(result, (['Renamed module'], [], []))
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [['MOD-NEW']])

    def test_content_added_after_assignment_is_read_live_without_reassigning(self):
        html = '<iframe src="https://example.test/lesson"></iframe>'
        result, cursor = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-NEW', 'W-NEW', 'MOD-NEW', 'reading', 'New activity', '',
              {'readingContent': html}, '', 0, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        self.assertEqual(result[2][0]['componentId'], 'C-NEW')
        self.assertEqual(result[2][0]['contentHtml'], html)
        self.assertEqual(result[2][0]['moduleId'], 'MOD-NEW')
        for table in ('curriculum.quiz_component_links', 'curriculum.ksb_mappings'):
            query = next(call for call in cursor.execute.call_args_list if table in call.args[0])
            self.assertIn('JOIN curriculum.components', query.args[0])
            self.assertEqual(query.args[1], [['MOD-NEW'], ['C-NEW']])

    def test_removing_the_video_removes_the_component_from_the_learner(self):
        """A coach clearing videoUrl in Module Builder is a content removal: the
        component has nothing left to do, so it leaves the learner's tree."""
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-VID', 'W-NEW', 'MOD-NEW', 'video', 'Watch this', '', {'videoUrl': ''},
              '', 0, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        # The week survives the removal; only the emptied component goes.
        self.assertEqual(result[0], ['New module'])
        self.assertEqual([w['weekId'] for w in result[1]], ['W-NEW'])
        self.assertEqual(result[2], [])

    def test_dated_archived_recording_opens_its_existing_event_component(self):
        rows = [
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Event week', 1, 0)],
            [('C-EVENT', 'W-NEW', 'MOD-NEW', 'video', 'Recorded Event', '',
              {'videoUrl': '', 'recordingSeriesId': 'LIVE-1',
               'recordingSessionNumber': 3, 'recordingDate': '2026-10-02'},
              '', 0, [], False, None, False)],
            [],
        ]
        result, _ = self.resolve(rows, assigned=[MODULE])
        event = result[2][0]
        self.assertEqual((event['weekId'], event['recordingSeriesId'], event['recordingSessionNumber'],
                          event['recordingDate']), ('W-NEW', 'LIVE-1', 3, '2026-10-02'))
        self.assertIsNone(event['videoUrl'])
        identity, _ = self.resolve(rows, assigned=[MODULE], identities_only=True)
        self.assertEqual([component['componentId'] for component in identity[2]], ['C-EVENT'])

    def test_video_authored_as_an_embed_is_not_mistaken_for_a_removed_one(self):
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-VID', 'W-NEW', 'MOD-NEW', 'video', 'Watch this',
              '', {'embedCode': '<iframe src="https://example.test/v"></iframe>'},
              '', 0, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        self.assertEqual(result[2][0]['componentId'], 'C-VID')
        self.assertEqual(result[2][0]['videoUrl'], 'https://example.test/v')

    def test_video_component_keeping_other_content_stays_without_its_player(self):
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-VID', 'W-NEW', 'MOD-NEW', 'video', 'Watch this', '',
              {'videoUrl': '', 'readingContent': '<p>Notes</p>'}, '', 0, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        self.assertEqual(result[2][0]['componentId'], 'C-VID')
        self.assertIsNone(result[2][0]['videoUrl'])
        self.assertEqual(result[2][0]['contentHtml'], '<p>Notes</p>')

    def test_missing_live_session_link_uses_the_unique_module_occurrence_on_its_local_date(self):
        result, cursor = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-LIVE', 'W-NEW', 'MOD-NEW', 'live_session', 'Live lesson', '',
              {'sessionDate': '2026-10-06'}, '', 0,
              [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
            [('MOD-NEW', 'LIVE-1', 'GMT Standard Time', 'OCC-1', 1,
              datetime(2026, 10, 6, 8, 30))],
        ], assigned=[MODULE])

        live = result[2][0]
        self.assertEqual(live['teamsLiveSessionId'], 'LIVE-1')
        self.assertEqual(live['teamsSessionNumber'], 1)
        self.assertIn('curriculum.live_session_occurrences', cursor.execute.call_args_list[-1].args[0])

    def test_existing_live_session_link_is_not_replaced_or_queried_again(self):
        result, cursor = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-LIVE', 'W-NEW', 'MOD-NEW', 'live_session', 'Live lesson', '',
              {'sessionDate': '2026-10-06', 'teamsLiveSessionId': 'LIVE-SAVED', 'teamsSessionNumber': 7}, '', 0,
              [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])

        live = result[2][0]
        self.assertEqual((live['teamsLiveSessionId'], live['teamsSessionNumber']), ('LIVE-SAVED', 7))
        self.assertFalse(any('curriculum.live_session_occurrences' in call.args[0] for call in cursor.execute.call_args_list))

    def test_shared_card_uses_source_occurrence_when_reading_weeks_disagree(self):
        delivery = {'teamsLiveSessionId': 'LIVE-SOURCE', 'teamsSessionNumber': 11,
                    'sessionDate': '2026-12-30', 'sessionTime': '12:00',
                    'sessionDateTimeUtc': '2026-12-30T12:00:00+00:00', 'durationMinutes': 120,
                    'liveSessionUrl': 'https://teams.microsoft.com/l/meetup-join/source'}
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 11', 12, 11)],
            [('C-LIVE', 'W-NEW', 'MOD-NEW', 'live_session', 'Live lesson', '',
              {'sessionDate': '2026-12-16', 'sessionTime': '09:00'}, '', 0,
              [{'code': 'K1', 'weight': 1}], False, None, False)], [], [],
        ], assigned=[MODULE], shared_delivery={'C-LIVE': delivery})
        live = result[2][0]
        for key, value in delivery.items():
            self.assertEqual(live[key], value, key)
        self.assertEqual((live['componentId'], live['weekId'], live['moduleId']), ('C-LIVE', 'W-NEW', 'MOD-NEW'))

    def test_additional_week_meeting_uses_its_own_results(self):
        result, cursor = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-LIVE', 'W-NEW', 'MOD-NEW', 'live_session', 'Extra lesson', '',
              {'sessionDate': '2026-10-06', 'teamsLiveSessionId': 'LIVE-MAIN',
               'teamsSessionNumber': 7, 'extraTeamsMeetingUrl': 'https://teams.example/extra',
               'extraTeamsLiveSessionId': 'LIVE-EXTRA'}, '', 0,
              [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])

        live = result[2][0]
        self.assertEqual((live['teamsLiveSessionId'], live['teamsSessionNumber']), ('LIVE-EXTRA', 1))
        self.assertIs(live['additionalMeeting'], True)
        self.assertFalse(any('curriculum.live_session_occurrences' in call.args[0] for call in cursor.execute.call_args_list))

    def test_unbooked_additional_id_does_not_replace_the_main_meeting(self):
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-LIVE', 'W-NEW', 'MOD-NEW', 'live_session', 'Main lesson', '',
              {'teamsLiveSessionId': 'LIVE-MAIN', 'teamsSessionNumber': 7,
               'extraTeamsLiveSessionId': 'LIVE-STALE'}, '', 0,
              [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])

        live = result[2][0]
        self.assertEqual((live['teamsLiveSessionId'], live['teamsSessionNumber']), ('LIVE-MAIN', 7))
        self.assertNotIn('additionalMeeting', live)

    def test_ambiguous_live_session_date_is_not_attached_to_either_occurrence(self):
        rows = [
            ('MOD-NEW', 'LIVE-1', 'GMT Standard Time', 'OCC-1', 1, datetime(2026, 10, 6, 8, 30)),
            ('MOD-NEW', 'LIVE-2', 'GMT Standard Time', 'OCC-2', 1, datetime(2026, 10, 6, 14, 30)),
        ]
        self.assertNotIn(('MOD-NEW', '2026-10-06'), _live_session_occurrence_fallbacks(rows))

    def test_live_session_fallback_matches_the_series_local_date(self):
        rows = [
            ('MOD-NEW', 'LIVE-1', 'Egypt Standard Time', 'OCC-1', 1,
             datetime(2026, 10, 5, 22, 30, tzinfo=timezone.utc)),
        ]
        fallback = _live_session_occurrence_fallbacks(rows)
        self.assertEqual(fallback[('MOD-NEW', '2026-10-06')]['teamsSessionNumber'], 1)

    def test_removing_a_video_does_not_touch_other_components_in_the_week(self):
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')],
            [('W-NEW', 'MOD-NEW', 'Week 1', 1, 0)],
            [('C-VID', 'W-NEW', 'MOD-NEW', 'video', 'Watch this', '', {'videoUrl': ''},
              '', 0, [{'code': 'K1', 'weight': 1}], False, None, False),
             ('C-READ', 'W-NEW', 'MOD-NEW', 'reading', 'Read this', '',
              {'readingContent': '<p>Body</p>'}, '', 1, [{'code': 'K1', 'weight': 1}], False, None, False)],
            [],
        ], assigned=[MODULE])
        self.assertEqual([c['componentId'] for c in result[2]], ['C-READ'])

    def test_a_standalone_delete_is_not_read_as_a_parent_cascade(self):
        """The exemption that keeps cascade-hidden content available to an
        already-assigned learner must not swallow standalone deletes.

        ``soft_delete_payload`` stamps ``deleted_via_parent`` as NULL when
        nothing above the row took it down, but rows written before that fix
        carry an empty string. Both mean "deleted on its own", so the SQL tests
        emptiness -- ``IS NOT NULL`` matched every deleted row and left deleted
        components on the learner's page forever.
        """
        _, cursor = self.resolve([[('MOD-NEW', 'New module')], [], []], assigned=[MODULE])
        for sql, _params in [call.args for call in cursor.execute.call_args_list]:
            if 'deleted_via_parent' in sql:
                self.assertNotIn('deleted_via_parent IS NOT NULL', sql)
                self.assertIn("COALESCE", sql)

    def test_current_membership_replaces_stale_children(self):
        result, cursor = self.resolve([[('MOD-NEW', 'New module')], [], []],
            modules=['Old module'], weeks=[{'moduleId': 'MOD-OLD', 'module': 'Old module'}], assigned=[MODULE])
        self.assertEqual(result, (['New module'], [], []))
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [['MOD-NEW']])

    def test_explicitly_removed_assignments_cannot_reappear_from_snapshot(self):
        result, cursor = self.resolve([], modules=['Old module'], assigned=[])
        self.assertEqual(result, ([], [], []))
        cursor.execute.assert_not_called()

    def test_new_module_can_contain_only_a_published_module_level_quiz(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [('MOD-NEW', 'New module', 'PROG-1', 'Programme')],
            [(90, 'MOD-NEW', '')],
            [(90, '', 'Assessment', 3, 30, 'Minutes', '', '', '')],
            [],
            [],  # No authored component or revision owns this independent quiz.
        ]
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}):
            weeks, components = _append_week_quizzes([], [], assigned_modules=[MODULE])
        self.assertEqual(weeks[0]['moduleId'], 'MOD-NEW')
        self.assertEqual(components[0]['quizMeta']['quizId'], 90)
        self.assertTrue(components[0]['isQuiz'])

    def test_current_quiz_selection_overrides_stale_normalized_link_in_each_projection(self):
        cached = {'module_titles': {'MOD-NEW': 'New module'},
                  'weeks': [('W1', 'MOD-NEW', 'Week 1', 1, 0)], 'quiz_links': {'Q': 10}}
        for options in ({}, {'compact_content': True}, {'resolved_metadata': cached},
                        {'compact': True, 'identities_only': True, 'catalogue_facts': True}):
            with self.subTest(options=options):
                linked = [('Q', 10, 10, 'Old quiz', 3, 10, 'Minutes')] if options.get('catalogue_facts') else [('Q', 10)]
                rows = [[('MOD-NEW', 'New module')], [('W1', 'MOD-NEW', 'Week 1', 1, 0)],
                        [('Q', 'W1', 'MOD-NEW', 'quiz', 'Assessment', '', {'linkedQuizId': '11'}, '', 0, [], False, None, False)]]
                if 'resolved_metadata' in options:
                    rows = rows[2:]
                if 'resolved_metadata' not in options:
                    rows.append(linked)
                rows.append([(10, 'Old quiz', 3, 10, 'Minutes'), (11, 'New quiz', 5, 20, 'Minutes')])
                result, _ = self.resolve(rows, assigned=[MODULE], **options)
                self.assertEqual(result[2][0]['quizMeta']['quizId'], 11)

    def test_explicitly_cleared_quiz_cannot_reuse_normalized_link(self):
        for value in ('', None):
            with self.subTest(value=value):
                result, _ = self.resolve([
                    [('MOD-NEW', 'New module')], [('W1', 'MOD-NEW', 'Week 1', 1, 0)],
                    [('Q', 'W1', 'MOD-NEW', 'quiz', 'Assessment', '', {'linkedQuizId': value}, '', 0, [], False, None, False)],
                    [('Q', 10)], [(10, 'Old quiz', 3, 10, 'Minutes')],
                ], assigned=[MODULE])
                self.assertFalse(result[2][0]['isQuiz'])
                self.assertIsNone(result[2][0]['quizMeta'])

    def test_legacy_quiz_without_builder_selection_still_uses_normalized_link(self):
        result, _ = self.resolve([
            [('MOD-NEW', 'New module')], [('W1', 'MOD-NEW', 'Week 1', 1, 0)],
            [('Q', 'W1', 'MOD-NEW', 'quiz', 'Assessment', '', {}, '', 0, [], False, None, False)],
            [('Q', 10)], [(10, 'Legacy quiz', 3, 10, 'Minutes')],
        ], assigned=[MODULE])
        self.assertEqual(result[2][0]['quizMeta']['quizId'], 10)

    def test_deleted_new_module_does_not_regain_its_quizzes(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch('learner_api.learner_detail.connections', {'enrolment': connection}):
            self.assertEqual(_append_week_quizzes([], [], assigned_modules=[MODULE]), ([], []))
