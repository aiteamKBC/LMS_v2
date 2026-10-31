"""Real SQL for all-week import, retry, later saves and manual-link isolation.

Use only the verified non-production runner. Graph is a GET-only test double.
"""
import copy
import io
import json
import uuid
from unittest.mock import patch, Mock

from django.db import connection, DatabaseError
from django.core.management import call_command

from curriculum_api import views as v, teams_existing_series as service
from curriculum_api.tests import CurriculumPersistenceTransactionHarness
from curriculum_api import test_existing_series_workflow as fixtures
from curriculum_api.test_existing_series_workflow import LINK, OWNER


class ExistingSeriesPersistenceTests(CurriculumPersistenceTransactionHarness):
    databases = {'default', 'enrolment'}
    event = fixtures.ExistingSeriesWorkflowTests.event
    graph_read = fixtures.ExistingSeriesWorkflowTests.graph_read

    def setUp(self):
        super().setUp()
        self.module_id = 'MOD-SERIES-' + uuid.uuid4().hex.upper()
        self.addCleanup(self.clean_imported_series)
        tree = self.tree_payload(module_id=self.module_id)
        group = tree['cohorts'][0]['groups'][0]
        group.update(weekDays='Friday', startTime='09:00', endTime='11:00')
        module = group['modules'][0]
        module.update(startDate='2026-10-23', endDate='2026-10-30', weekDays='Friday')
        module['weekStructure'] = [
            {'id': 'WEEK-IMPORT-1', 'weekNumber': 1, 'title': 'October lesson', 'components': [
                {'id': 'COMP-IMPORT-1', 'type': 'live-session', 'title': 'Live one', 'settings': {'sessionPurpose': 'Keep outline'}}]},
            {'id': 'WEEK-IMPORT-2', 'weekNumber': 2, 'title': 'Winter lesson', 'components': [
                {'id': 'COMP-IMPORT-2', 'type': 'live-session', 'title': 'Live two', 'settings': {}}]},
        ]
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', tree)
        self.assertEqual(response.status_code, 200, response.content)
        self.module_id = module['catalogueId']
        self.url = f'/curriculum_api/curriculum/modules/{self.module_id}/teams-existing-series/'
        self.week_ids = ['WEEK-IMPORT-1', 'WEEK-IMPORT-2']
        v.ensure_live_session_tracking_tables()
        self.master_owned = True
        self.master_zone = 'GMT Standard Time'
        self.events = [
            self.event('E1', '2026-10-23T08:00:00Z', '2026-10-23T10:00:00Z'),
            self.event('E2', '2026-10-30T09:00:00Z', '2026-10-30T11:00:00Z'),
        ]
        self.online = {'id': 'ONLINE-SQL-TEST', 'joinWebUrl': LINK,
                       'participants': {'organizer': {'identity': {'user': {'id': OWNER}}}}}
        self.graph = Mock(side_effect=self.graph_read)
        for target, kwargs in [
            ('coach_api.views.microsoft_graph_request', {'new': self.graph}),
            ('coach_api.views.get_graph_settings', {'return_value': {'base_url': 'https://graph.microsoft.com/v1.0/'}}),
            ('curriculum_api.views.teams_meeting_default_organizer', {'return_value': 'owner@example.invalid'}),
        ]:
            patcher = patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)

    def preview(self, weeks=None):
        # Exercise both the shared command/service contract and its HTTP route.
        prepared = service.preview(self.module_id, {'weekIds': weeks or self.week_ids, 'link': LINK})
        response = self.post_json(self.url, {'action': 'preview', 'weekIds': weeks or self.week_ids, 'link': LINK})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['sessions'], prepared['sessions'])
        return response.json()

    def apply(self, token):
        response = self.post_json(self.url, {'action': 'apply', 'previewToken': token})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def components(self):
        return v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s',
                                      [self.module_id], 'display_order, id')

    def clean_imported_series(self):
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM curriculum.session_result_jobs WHERE live_session_id IN '
                           '(SELECT id FROM curriculum.live_sessions WHERE module_catalogue_id=%s)', [self.module_id])
        v.authoring_delete(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id])

    def test_preview_apply_replay_and_full_save_preserve_real_ids_and_dst_dates(self):
        before = v.module_structure_revision(self.module_id)
        review = self.preview()
        self.assertEqual((review['matched'], review['unmatched']), (2, 0))
        self.assertEqual(v.module_structure_revision(self.module_id), before)
        self.assertEqual(v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id]), [])
        result = self.apply(review['previewToken'])
        settings = [v.component_builder_settings(c) for c in self.components()]
        self.assertEqual([s['sessionDate'] for s in settings], ['2026-10-23', '2026-10-30'])
        ids = [s['teamsOccurrenceId'] for s in settings]
        self.assertEqual(len(set(ids)), 2)
        self.assertTrue(result['module']['structureRevision'])
        replay = self.apply(review['previewToken'])
        self.assertTrue(replay['alreadyLinked'])
        rows = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id])
        self.assertEqual(len(rows), 1)
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM curriculum.session_result_jobs WHERE live_session_id=%s', [rows[0]['id']])
            self.assertEqual(cursor.fetchone()[0], 1)
        v.save_module_authoring_structure(self.module_id, v.get_authoring_structure_payload(self.module_id))
        after = [v.component_builder_settings(c) for c in self.components()]
        self.assertEqual([s['teamsOccurrenceId'] for s in after], ids)
        self.assertEqual([s['sessionDate'] for s in after], ['2026-10-23', '2026-10-30'])
        self.assertEqual(after[0]['sessionPurpose'], 'Keep outline')
        self.assertTrue(all(call.args[0] == 'GET' for call in self.graph.call_args_list))

    def test_command_applies_and_replays_on_the_verified_sql_fixture_without_duplicate_rows(self):
        for _ in range(2):
            output = io.StringIO()
            call_command('link_existing_teams_series', module_id=self.module_id, join_url=LINK,
                         calendar_mailbox='owner@example.invalid', apply=True, stdout=output)
            result = json.loads(output.getvalue())
            self.assertEqual((result['action'], result['matched'], result['unmatched']), ('linked', 2, 0))
            self.assertNotIn(LINK, output.getvalue())
        self.assertTrue(result['alreadyLinked'])
        series = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id=%s', [self.module_id])
        self.assertEqual(len(series), 1)
        self.assertEqual(len(v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id=%s', [series[0]['id']])), 2)
        # A stale component payload must not move the original calendar to
        # another module. This is a real SQL ownership check, not a transport mock.
        v.link_live_session_series_to_module('MOD-UNRELATED', {'weekStructure': [{'components': [
            {'settings': {'teamsLiveSessionId': series[0]['id']}},
        ]}]})
        self.assertEqual(v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id=%s', [series[0]['id']])[0]['module_catalogue_id'], self.module_id)
        self.assertTrue(all(call.args[0] == 'GET' for call in self.graph.call_args_list))

    def test_manual_single_week_keeps_other_week_and_historical_occurrences(self):
        self.apply(self.preview()['previewToken'])
        before = self.components()
        original = copy.deepcopy(v.component_builder_settings(before[0]))
        series = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id])[0]
        occurrences = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [series['id']], 'id')
        response = self.post_json(f'/curriculum_api/curriculum/modules/{self.module_id}/teams-links/',
            {'weekIds': [self.week_ids[0]], 'link': 'https://teams.microsoft.com/manual-single'})
        self.assertEqual(response.status_code, 200, response.content)
        settings = [v.component_builder_settings(c) for c in self.components()]
        self.assertFalse(settings[0].get('teamsOccurrenceId'))
        self.assertFalse(settings[0].get('teamsLiveSessionId'))
        self.assertEqual(settings[0]['teamsCalendarBinding'], 'unverified')
        self.assertEqual(self.components()[1], before[1])
        stale = v.get_authoring_structure_payload(self.module_id)
        stale['weekStructure'][0]['components'][0]['settings'].update(original)
        stale['weekStructure'][0]['components'][0]['settings']['liveSessionUrl'] = 'https://teams.microsoft.com/manual-single'
        v.save_module_authoring_structure(self.module_id, stale)
        self.assertFalse(v.component_builder_settings(self.components()[0]).get('teamsOccurrenceId'))
        self.assertEqual(v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [series['id']], 'id'), occurrences)

    def test_linking_an_earlier_week_later_keeps_existing_ids_and_requeues_finished_sync(self):
        self.apply(self.preview([self.week_ids[1]])['previewToken'])
        series = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id])[0]
        old = v.component_builder_settings(self.components()[1])
        with connection.cursor() as cursor:
            cursor.execute("UPDATE curriculum.session_result_jobs SET state='complete' WHERE live_session_id=%s", [series['id']])
        self.apply(self.preview()['previewToken'])
        after = [v.component_builder_settings(row) for row in self.components()]
        self.assertEqual(after[1]['teamsOccurrenceId'], old['teamsOccurrenceId'])
        self.assertEqual(after[1]['teamsSessionNumber'], old['teamsSessionNumber'])
        self.assertNotEqual(after[0]['teamsOccurrenceId'], after[1]['teamsOccurrenceId'])
        self.assertEqual([s['sessionDate'] for s in after], ['2026-10-23', '2026-10-30'])
        self.assertEqual(v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [series['id']])[0]['repeat_occurrences'], 2)
        with connection.cursor() as cursor:
            cursor.execute('SELECT state,count(*) OVER() FROM curriculum.session_result_jobs WHERE live_session_id=%s', [series['id']])
            self.assertEqual(cursor.fetchone(), ('queued', 1))

    def test_partial_database_failure_rolls_back_every_series_occurrence_and_link(self):
        token = self.preview()['previewToken']
        original = v.update_authoring_rows
        before = copy.deepcopy(self.components())
        def fail_second(table, where, params, values):
            if table == v.AUTHORING_COMPONENTS_TABLE and params[0] == 'COMP-IMPORT-2':
                raise DatabaseError('Synthetic write failure')
            return original(table, where, params, values)
        with patch.object(v, 'update_authoring_rows', side_effect=fail_second):
            response = self.post_json(self.url, {'action': 'apply', 'previewToken': token})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.components(), before)
        self.assertEqual(v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id]), [])

    def test_shared_learner_link_matches_the_dated_source_and_never_an_unrelated_manual_url(self):
        from learner_api.shared_live_delivery import read_shared_live_delivery
        self.apply(self.preview()['previewToken'])
        source = v.authoring_module_exists(self.module_id)
        alias = 'MOD-SERIES-ALIAS-' + uuid.uuid4().hex.upper()
        week, component = 'WEEK-SHARED-' + uuid.uuid4().hex, 'COMP-SHARED-' + uuid.uuid4().hex
        def cleanup_alias():
            with connection.cursor() as cursor:
                cursor.execute('DELETE FROM curriculum.module_teams_shares WHERE module_catalogue_id=%s', [alias])
            for table in (v.AUTHORING_KSB_MAPPINGS_TABLE, v.AUTHORING_COMPONENTS_TABLE, v.AUTHORING_WEEKS_TABLE,
                          v.AUTHORING_COMPLETION_TABLE, v.AUTHORING_ADVANCED_TABLE):
                v.authoring_delete(table, 'module_catalogue_id = %s', [alias])
            v.authoring_delete(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [alias])
        self.addCleanup(cleanup_alias)
        v.authoring_upsert(v.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': alias, 'title': 'Synthetic shared second week',
            'programme_id': source.get('programme_id'), 'programme_name': source.get('programme_name'),
            'cohort_id': source.get('cohort_id'), 'cohort_name': source.get('cohort_name'),
            'group_name': source.get('group_name'),
            'group_id': source.get('group_id'), 'start_date': '2026-10-30', 'end_date': '2026-10-30',
            'sessions_number': 1, 'teams_shared_source_module_id': self.module_id,
        })
        v.authoring_upsert(v.AUTHORING_WEEKS_TABLE, ['id'], {
            'id': week, 'module_catalogue_id': alias, 'week_number': 1, 'title': 'Second source week', 'display_order': 0})
        settings = {'liveSessionLinkOverride': LINK, 'liveSessionUrl': LINK, 'sessionDate': '2026-10-30',
                    'sessionTime': '09:00', 'teamsCalendarBinding': 'unverified'}
        v.authoring_upsert(v.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': component, 'module_catalogue_id': alias, 'week_id': week, 'type': 'live_session',
            'title': 'Shared manual live card', 'display_order': 0, 'settings_json': v.json_db_value(settings)})
        delivered = read_shared_live_delivery([alias], [component])
        original = v.component_builder_settings(self.components()[1])
        self.assertEqual(delivered[component]['teamsOccurrenceId'], original['teamsOccurrenceId'])
        self.assertEqual(delivered[component]['sessionDate'], '2026-10-30')
        v.save_module_authoring_structure(alias, v.get_authoring_structure_payload(alias))
        stored = v.component_builder_settings(v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE, 'id=%s', [component])[0])
        self.assertEqual(stored['teamsCalendarBinding'], 'unverified')
        self.assertEqual(stored['sessionDate'], '2026-10-30', stored)
        self.assertEqual(stored['liveSessionLinkOverride'], LINK, stored)
        self.assertEqual(v.authoring_module_exists(alias)['teams_shared_source_module_id'], self.module_id)
        self.assertEqual(read_shared_live_delivery([alias], [component])[component]['teamsOccurrenceId'], original['teamsOccurrenceId'])
        v.update_authoring_rows(v.AUTHORING_COMPONENTS_TABLE, 'id=%s', [component], {
            'settings_json': v.json_db_value({**settings, 'liveSessionLinkOverride': 'https://teams.microsoft.com/unrelated'})})
        self.assertEqual(read_shared_live_delivery([alias], [component]), {})
