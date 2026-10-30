"""Regression cases for imported meeting bindings; no Graph or database access."""
import copy
import ast
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

from curriculum_api.teams_external_calendar import external_calendar_settings, external_main_calendar, inherited_main_link, meeting_settings


class ExternalCalendarAttachmentTests(unittest.TestCase):
    def setUp(self):
        self.link = 'https://example.invalid/existing-meeting'
        self.series = {'id': 'LIVE-1', 'join_url': self.link, 'online_meeting_id': 'ONLINE-1'}
        self.occurrences = [
            {'id': f'OCC-{n}', 'session_number': n, 'join_url': self.link, 'status': 'scheduled',
             'scheduled_start': f'2026-09-{day}T11:00:00Z', 'scheduled_end': f'2026-09-{day}T13:00:00Z'}
            for n, day in [(1, '11'), (2, '18')]
        ]

    def attach(self, settings=None, date='2026-09-18', claimed=None):
        return external_calendar_settings(settings or {}, self.series,
                                          {'date': date, 'startTime': '12:00'}, self.occurrences,
                                          claimed if claimed is not None else set(), 'Europe/London')

    def test_inserted_week_matches_current_plan_without_moving_occurrences(self):
        before = copy.deepcopy(self.occurrences)
        patch = self.attach({'teamsOccurrenceId': 'OCC-1', 'teamsSessionNumber': 1,
                             'sessionDate': '2026-09-11', 'recordingUrl': 'keep-recording'})
        self.assertEqual(patch['teamsOccurrenceId'], 'OCC-2')
        self.assertEqual(patch['sessionDate'], '2026-09-18')
        self.assertEqual(patch['sessionTime'], '12:00')
        self.assertEqual(patch['teamsCalendarBinding'], 'matched')
        self.assertNotIn('recordingUrl', patch)
        self.assertNotIn('teamsAttendees', patch)
        self.assertEqual(self.occurrences, before)

    def test_missing_date_keeps_join_link_without_claiming_another_booking(self):
        patch = self.attach({'teamsOccurrenceId': 'OCC-2'}, date='2026-12-25')
        self.assertEqual(patch['liveSessionUrl'], self.link)
        self.assertEqual(patch['teamsOccurrenceId'], '')
        self.assertEqual(patch['teamsSessionNumber'], 0)
        self.assertEqual(patch['teamsStartDateTimeUtc'], '')
        self.assertEqual(patch['teamsCalendarBinding'], 'missing')
        self.assertEqual(patch['sessionDate'], '2026-12-25')

    def test_duplicate_date_requires_review(self):
        self.occurrences.append({**self.occurrences[1], 'id': 'OTHER'})
        self.assertEqual(self.attach()['teamsCalendarBinding'], 'ambiguous')
        self.assertEqual(self.attach()['teamsOccurrenceId'], '')

    def test_occurrence_cannot_be_assigned_twice(self):
        claimed = set()
        self.assertEqual(self.attach(claimed=claimed)['teamsOccurrenceId'], 'OCC-2')
        self.assertEqual(self.attach(claimed=claimed)['teamsOccurrenceId'], '')

    def test_cancelled_occurrence_does_not_confirm_date(self):
        self.occurrences[1]['status'] = 'cancelled'
        self.assertEqual(self.attach()['teamsCalendarBinding'], 'missing')

    def test_different_replacement_never_borrows_old_meeting_identity(self):
        self.assertIsNone(self.attach({'liveSessionLinkOverride': 'https://example.invalid/other'}))
        self.occurrences[1]['join_url'] = 'https://example.invalid/other'
        self.assertEqual(self.attach()['teamsCalendarBinding'], 'missing')

    def test_matching_uses_calendar_timezone(self):
        self.occurrences[1].update(scheduled_start='2026-09-17T23:30:00Z', scheduled_end='2026-09-18T01:30:00Z')
        patch = self.attach()
        self.assertEqual(patch['teamsOccurrenceId'], 'OCC-2')
        self.assertEqual(patch['sessionTime'], '00:30')


class MainLinkInheritanceTests(unittest.TestCase):
    def test_unanimous_replacement_wins_and_additional_meetings_are_excluded(self):
        self.assertEqual(inherited_main_link([
            {'liveSessionLinkOverride': 'https://example.invalid/imported'},
            {'liveSessionUrl': 'https://example.invalid/imported'},
            {'extraTeamsMeetingUrl': 'https://example.invalid/extra', 'liveSessionLinkOverride': 'extra'},
        ], {'join_url': 'https://example.invalid/old'}), ('https://example.invalid/imported', True))

    def test_partial_replacement_does_not_choose_a_default(self):
        with self.assertRaises(ValueError):
            inherited_main_link([{'liveSessionLinkOverride': 'one'}, {'liveSessionUrl': 'two'}])

    def test_tracked_series_can_have_different_occurrence_links(self):
        self.assertEqual(inherited_main_link([{'liveSessionUrl': 'one'}, {'liveSessionUrl': 'two'}],
                                             {'join_url': 'series'}), ('series', False))

    def test_untracked_pasted_link_is_inherited_without_a_booking(self):
        self.assertEqual(inherited_main_link([{'liveSessionUrl': 'external'}]), ('external', True))
        self.assertEqual(inherited_main_link([]), ('', False))


class ImportedCalendarGuardTests(unittest.TestCase):
    def test_imported_series_is_protected_even_with_calendar_identifiers(self):
        self.assertTrue(external_main_calendar(series={'meeting_type': 'linked-external', 'graph_event_id': 'EVENT'}))

    def test_pasted_main_link_needs_no_series_to_be_protected(self):
        self.assertTrue(external_main_calendar([{'liveSessionUrl': 'https://example.invalid/original'}]))

    def test_replacement_of_managed_series_is_protected(self):
        self.assertTrue(external_main_calendar([{'liveSessionLinkOverride': 'https://example.invalid/imported'}],
                                              {'join_url': 'https://example.invalid/lms'}))

    def test_additional_link_never_blocks_main_calendar_creation(self):
        extra = {'extraTeamsMeetingUrl': 'https://example.invalid/extra',
                 'liveSessionUrl': 'https://example.invalid/extra', 'teamsMeetingScope': 'additional'}
        self.assertFalse(external_main_calendar([extra]))
        self.assertFalse(external_main_calendar([{'legacySettings': json.dumps(extra)}]))
        self.assertFalse(external_main_calendar([{'teamsMeetingScope': 'additional', 'liveSessionUrl': 'reserved'}]))

    def test_legacy_metadata_is_recovered_without_overriding_current_values(self):
        self.assertEqual(meeting_settings({'legacySettings': '{invalid', 'teamsMeetingScope': 'main'})['teamsMeetingScope'], 'main')
        self.assertEqual(meeting_settings({'legacySettings': '{"teamsMeetingScope":"additional"}',
                                          'teamsMeetingScope': 'main'})['teamsMeetingScope'], 'main')

    def test_managed_occurrence_links_do_not_become_imported(self):
        self.assertFalse(external_main_calendar([{'liveSessionUrl': 'https://example.invalid/instance'}],
                                               {'join_url': 'https://example.invalid/lms'}))

    def test_normalisation_keeps_additional_identity_out_of_legacy_storage(self):
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        names = {'allowed_component_setting_keys', 'normalise_component_settings_payload'}
        namespace = {'json': json, 'frontend_component_type': lambda value: value,
                     'component_settings_defaults': lambda _kind: {'liveSessionUrl': ''},
                     'as_json_value': lambda value, fallback: json.loads(value) if isinstance(value, str) else value or fallback}
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in
                    {'LEGACY_SETTING_KEYS', 'RECORDING_SOURCE_SETTING_KEYS', 'LIVE_SESSION_TRACKING_SETTING_KEYS'} for target in node.targets):
                namespace[node.targets[0].id] = ast.literal_eval(node.value)
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
        extra = {'teamsMeetingScope': 'additional', 'extraTeamsMeetingUrl': 'https://example.invalid/extra',
                 'extraTeamsLiveSessionId': 'EXTRA', 'extraTeamsStartDateTimeUtc': '2026-10-02T11:00:00Z'}
        saved = namespace['normalise_component_settings_payload']('live-session', {'legacySettings': json.dumps(extra)})
        for key, value in extra.items():
            self.assertEqual(saved[key], value)
        self.assertNotIn('legacySettings', saved)


class ImportedCalendarEndpointTests(unittest.TestCase):
    """Execute endpoint guards with all storage/transport boundaries in memory."""

    def setUp(self):
        self.components = []
        self.series = []
        self.graph = Mock(side_effect=AssertionError('Graph must not be called'))
        self.calendar_groups = Mock(side_effect=RuntimeError('creation-path-reached'))
        self.read = Mock(side_effect=lambda table, *_args, **_kwargs: self.series if table == 'series' else self.components)
        class Response(dict):
            def __init__(self, body, status=200):
                super().__init__(body)
                self.status_code = status
        self.ns = {
            '__package__': 'curriculum_api', 'csrf_exempt': lambda fn: fn,
            'JsonResponse': Response, 'json_error': lambda message, status=400, **fields: Response({'error': message, **fields}, status),
            'clean_str': lambda value: str(value or '').strip(),
            'LIVE_SESSIONS_TABLE': 'series', 'AUTHORING_COMPONENTS_TABLE': 'components',
            'authoring_fetch_all': self.read, 'active_component_rows': lambda rows: rows,
            'frontend_component_type': lambda value: str(value).replace('_', '-'),
            'as_json_value': lambda value, fallback: json.loads(value) if isinstance(value, str) else value or fallback,
            'authoring_module_exists': lambda _module: True, 'resolve_stored_module_catalogue_id': lambda value: value,
            'ensure_live_sessions_table': Mock(), 'ensure_live_session_tracking_tables': Mock(),
            'teams_meeting_default_organizer': lambda: '',
            'json_body': lambda _request: {'moduleCatalogueId': 'MODULE'},
            'teams_schedule_settings': lambda settings, *_args, **_kwargs: settings,
            'calendar_groups': self.calendar_groups,
        }
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        names = {'module_has_external_teams_calendar', 'external_teams_calendar_refusal', 'component_builder_settings',
                 'curriculum_teams_meeting', 'curriculum_teams_meeting_schedule'}
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), self.ns)
        transport = types.ModuleType('coach_api.views')
        transport.microsoft_graph_request = self.graph
        transport.has_graph_credentials = lambda: True
        transport.get_graph_settings = lambda: {}
        modules = patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': transport})
        modules.start()
        self.addCleanup(modules.stop)
        # The requested standard editor now verifies the original calendar
        # instead of rejecting every imported series. The real access/binding
        # boundary is covered by test_teams_original_calendar and HTTP tests.
        original = types.ModuleType('curriculum_api.teams_original_calendar')
        original.calendar_authorized = lambda _id: False
        self.prepare_original = Mock(return_value=self.ns['json_error']('Connect the original calendar.', status=409, code='original_calendar_access'))
        original.original_calendar_request = lambda _view: self.prepare_original
        original_modules = patch.dict(sys.modules, {'curriculum_api.teams_original_calendar': original})
        original_modules.start()
        self.addCleanup(original_modules.stop)
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)

    def test_direct_repeated_create_cannot_replace_pasted_main_link(self):
        self.components = [{'type': 'live_session', 'settings_json': {}, 'live_sessions_link': 'https://example.invalid/original'}]
        before = copy.deepcopy(self.components)
        for _attempt in range(2):
            result = self.ns['curriculum_teams_meeting'](types.SimpleNamespace(method='POST'))
            self.assertEqual(result.status_code, 409)
            self.assertEqual(result['code'], 'external_teams_calendar')
        self.assertEqual(self.components, before)
        self.calendar_groups.assert_not_called()
        self.graph.assert_not_called()

    def test_additional_only_component_can_reach_main_creation(self):
        self.components = [{'type': 'live_session', 'settings_json': {
            'legacySettings': json.dumps({'extraTeamsMeetingUrl': 'https://example.invalid/extra', 'teamsMeetingScope': 'additional'})},
            'live_sessions_link': 'https://example.invalid/extra'}]
        with self.assertRaisesRegex(RuntimeError, 'creation-path-reached'):
            self.ns['curriculum_teams_meeting'](types.SimpleNamespace(method='POST'))
        self.graph.assert_not_called()

    def test_imported_calendar_keeps_creation_blocked_and_verifies_the_original_before_patch(self):
        self.series = [{'id': 'LIVE', 'module_catalogue_id': 'MODULE', 'meeting_type': 'linked-external',
                        'status': 'active', 'graph_event_id': 'EXTERNAL-EVENT', 'join_url': 'https://example.invalid/original'}]
        result = self.ns['curriculum_teams_meeting'](types.SimpleNamespace(method='POST'))
        self.assertEqual(result['code'], 'external_teams_calendar')
        result = self.ns['curriculum_teams_meeting_schedule'](types.SimpleNamespace(method='PATCH'), 'LIVE')
        self.assertEqual(result.status_code, 409)
        self.assertEqual(result['code'], 'original_calendar_access')
        self.prepare_original.assert_called_once()
        self.assertEqual(self.prepare_original.call_args.args[1], 'LIVE')
        self.calendar_groups.assert_not_called()
        self.graph.assert_not_called()

    def test_managed_calendar_with_pasted_override_blocks_schedule_write(self):
        self.series = [{'id': 'LIVE', 'module_catalogue_id': 'MODULE', 'status': 'active', 'join_url': 'https://example.invalid/old'}]
        self.components = [{'type': 'live_session', 'settings_json': {
            'liveSessionLinkOverride': 'https://example.invalid/imported'}}]
        result = self.ns['curriculum_teams_meeting_schedule'](types.SimpleNamespace(method='PATCH'), 'LIVE')
        self.assertEqual(result['code'], 'external_calendar_read_only')
        self.graph.assert_not_called()
