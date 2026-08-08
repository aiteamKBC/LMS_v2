import json
import threading
from unittest.mock import patch

from django.db import connection
from django.test import Client, RequestFactory, SimpleTestCase, TestCase

from . import views
from .ksb_coverage import build_coverage


class CurriculumGroupModuleMatchingTests(SimpleTestCase):
    def test_module_belongs_to_group_uses_stored_module_ids(self):
        group = {
            'id': 'GROUP-1',
            'name': 'G1',
            'moduleIds': ['MOD-20260805143221794F2NN00'],
            'modules': ['Module'],
        }
        module = {
            'id': 'module-MOD-20260805143221794F2NN00',
            'moduleCatalogueId': 'MOD-20260805143221794F2NN00',
            'name': 'Renamed in catalogue',
            'groupId': '',
            'group': '',
        }

        self.assertTrue(views.module_belongs_to_group(module, group))

    def test_stored_module_ids_win_over_stale_module_group_context(self):
        group = {
            'id': 'GROUP-1',
            'name': 'G1',
            'moduleIds': ['MOD-20260805143221794F2NN00'],
            'modules': [],
        }
        module = {
            'moduleCatalogueId': 'MOD-20260805143221794F2NN00',
            'name': 'Module',
            'groupId': 'GROUP-OLD',
            'group': 'Old group',
        }

        self.assertTrue(views.module_belongs_to_group(module, group))

    def test_group_membership_uses_module_group_id_even_when_stored_module_ids_are_stale(self):
        group = {
            'id': 'GROUP-1',
            'moduleIds': ['MOD-KEEP'],
        }
        modules = [
            {'moduleCatalogueId': 'MOD-KEEP', 'groupId': 'GROUP-1'},
            {'moduleCatalogueId': 'MOD-STALE', 'groupId': 'GROUP-1'},
        ]

        filtered = [
            module for module in modules
            if views.module_belongs_to_group(module, group)
        ]

        self.assertEqual([module['moduleCatalogueId'] for module in filtered], ['MOD-KEEP', 'MOD-STALE'])


class CurriculumTeamsMeetingTests(TestCase):
    def setUp(self):
        self.client = Client()
        views._AUTHORING_TABLES_READY = False
        views._LIVE_SESSIONS_TABLE_READY = False
        views._LIVE_SESSION_TRACKING_TABLES_READY = False
        views.ensure_module_authoring_tables()
        views.ensure_live_sessions_table()
        views.authoring_delete(views.LIVE_SESSIONS_TABLE)

    @patch('coach_api.views.microsoft_graph_request')
    @patch('coach_api.views.has_graph_credentials', return_value=True)
    @patch('coach_api.views.get_graph_settings', return_value={
        'tenant_id': 'tenant',
        'client_id': 'client',
        'client_secret': 'secret',
        'scope': 'https://graph.microsoft.com/.default',
        'base_url': 'https://graph.microsoft.com/v1.0',
        'timezone': 'GMT Standard Time',
    })
    def test_creates_calendar_backed_teams_meeting(self, _settings, _credentials, graph_request):
        graph_request.side_effect = [
            {
                'id': 'event-1',
                'webLink': 'https://outlook.office.com/calendar/item',
                'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/meetup-join/example'},
            },
            {
                'value': [{
                    'id': 'meeting-1',
                    'meetingOptionsWebUrl': 'https://teams.microsoft.com/meetingOptions/example',
                }],
            },
            {},
        ]
        response = self.client.post(
            '/curriculum_api/curriculum/teams-meetings/',
            data=json.dumps({
                'title': 'Risk workshop',
                'organizerEmail': 'tutor@example.com',
                'attendees': ['student1@example.com', 'student2@example.com'],
                'presenters': ['presenter@example.com'],
                'localStartDateTime': '2026-07-30T15:30',
                'startDateTimeUtc': '2026-07-30T12:30:00.000Z',
                'durationMinutes': 60,
                'repeat': 'weekly',
                'repeatOccurrences': 6,
                'lobbyBypass': 'invited',
                'recording': 'record-transcribe',
                'spokenLanguage': 'en-GB',
                'requestResponses': True,
                'allowNewTimeProposals': True,
                'hideAttendees': False,
                'transactionId': 'TEAMS-TEST',
                'moduleDraftId': 'module-draft-1',
                'moduleTitle': 'Risk module',
                'scheduledOccurrences': [
                    {
                        'sessionNumber': index + 1,
                        'startDateTimeUtc': value,
                        'durationMinutes': 60,
                    }
                    for index, value in enumerate([
                        '2026-07-30T12:30:00Z',
                        '2026-08-06T12:30:00Z',
                        '2026-08-13T12:30:00Z',
                        '2026-08-20T12:30:00Z',
                        '2026-08-27T12:30:00Z',
                        '2026-09-03T12:30:00Z',
                    ])
                ],
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        result = response.json()
        self.assertEqual(result['meeting']['eventId'], 'event-1')
        self.assertTrue(result['meeting']['liveSessionId'].startswith('LIVE-'))
        self.assertIn('teams.microsoft.com', result['meeting']['joinUrl'])
        self.assertEqual(result['meeting']['repeatOccurrences'], 6)
        self.assertEqual(result['meeting']['trackedOccurrences'], 6)
        self.assertEqual(result['meeting']['onlineMeetingId'], 'meeting-1')
        self.assertTrue(result['meeting']['trackingReady'])
        self.assertTrue(result['meeting']['settingsApplied'])

        create_call = graph_request.call_args_list[0]
        self.assertEqual(create_call.args[:2], ('POST', 'users/tutor%40example.com/events'))
        event_payload = create_call.kwargs['payload']
        self.assertTrue(event_payload['isOnlineMeeting'])
        self.assertEqual(len(event_payload['attendees']), 3)
        self.assertEqual(event_payload['recurrence']['range']['numberOfOccurrences'], 6)
        meeting_patch = graph_request.call_args_list[2].kwargs['payload']
        self.assertEqual(meeting_patch['allowedPresenters'], 'roleIsPresenter')
        self.assertEqual(meeting_patch['lobbyBypassSettings'], {
            'scope': 'invited',
            'isDialInBypassEnabled': False,
        })
        self.assertTrue(meeting_patch['allowRecording'])
        self.assertTrue(meeting_patch['recordAutomatically'])
        self.assertTrue(meeting_patch['allowTranscription'])
        self.assertEqual(meeting_patch['meetingSpokenLanguageTag'], 'en-GB')
        presenter = next(item for item in meeting_patch['participants']['attendees'] if item['upn'] == 'presenter@example.com')
        self.assertEqual(presenter['role'], 'presenter')
        live_session = views.authoring_fetch_all(
            views.LIVE_SESSIONS_TABLE,
            'id = %s',
            [result['meeting']['liveSessionId']],
        )[0]
        self.assertEqual(live_session['module_draft_id'], 'module-draft-1')
        self.assertEqual(live_session['repeat_pattern'], 'weekly')
        self.assertEqual(live_session['repeat_occurrences'], 6)
        self.assertEqual(live_session['status'], 'active')
        self.assertEqual(live_session['online_meeting_id'], 'meeting-1')
        self.assertEqual(live_session['presenters'], ['presenter@example.com'])
        occurrences = views.authoring_fetch_all(
            views.LIVE_SESSION_OCCURRENCES_TABLE,
            'live_session_id = %s',
            [result['meeting']['liveSessionId']],
        )
        self.assertEqual(len(occurrences), 6)

    @patch('coach_api.views.microsoft_graph_request')
    @patch('coach_api.views.has_graph_credentials', return_value=True)
    @patch('coach_api.views.get_graph_settings', return_value={
        'tenant_id': 'tenant',
        'client_id': 'client',
        'client_secret': 'secret',
        'scope': 'https://graph.microsoft.com/.default',
        'base_url': 'https://graph.microsoft.com/v1.0',
        'timezone': 'GMT Standard Time',
    })
    def test_schedule_update_keeps_wizard_dates_when_shifted_instances_fail(self, _settings, _credentials, graph_request):
        live_session_id = 'LIVE-SHIFT-WARNING'
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {
            'id': live_session_id,
            'organizer_email': 'tutor@example.com',
            'graph_event_id': 'event-1',
            'module_title': 'Risk module',
            'start_datetime': '2026-08-05T08:30:00Z',
            'duration_minutes': 120,
            'repeat_pattern': 'weekly',
            'repeat_occurrences': 6,
            'join_url': 'https://teams.microsoft.com/l/meetup-join/example',
            'web_link': 'https://outlook.office.com/calendar/item',
            'status': 'active',
        })
        instance_reads = {'count': 0}

        def graph_side_effect(method, path, payload=None):
            if method == 'PATCH' and path == 'users/tutor%40example.com/events/event-1':
                return {
                    'id': 'event-1',
                    'webLink': 'https://outlook.office.com/calendar/item',
                    'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/l/meetup-join/example'},
                }
            if method == 'GET' and path.startswith('users/tutor%40example.com/events/event-1/instances?'):
                instance_reads['count'] += 1
                if instance_reads['count'] > 1:
                    return {'value': []}
                return {
                    'value': [
                        {'id': f'instance-{index}', 'start': {'dateTime': value}}
                        for index, value in enumerate([
                            '2026-08-05T08:30:00',
                            '2026-08-12T08:30:00',
                            '2026-08-19T08:30:00',
                            '2026-08-26T08:30:00',
                            '2026-09-02T08:30:00',
                            '2026-09-09T08:30:00',
                        ], start=1)
                    ],
                }
            if method == 'PATCH' and path.endswith('/instance-6'):
                raise RuntimeError('ErrorOccurrenceCrossingBoundary')
            if method in {'PATCH', 'POST', 'DELETE'}:
                return {}
            raise AssertionError(f'Unexpected Graph call: {method} {path}')

        graph_request.side_effect = graph_side_effect

        response = self.client.patch(
            f'/curriculum_api/curriculum/teams-meetings/{live_session_id}/schedule/',
            data=json.dumps({
                'title': 'Risk module',
                'organizerEmail': 'tutor@example.com',
                'eventId': 'event-1',
                'localStartDateTime': '2026-09-02T09:30',
                'startDateTimeUtc': '2026-09-02T08:30:00Z',
                'durationMinutes': 120,
                'repeat': 'weekly',
                'repeatOccurrences': 6,
                'scheduledOccurrences': [
                    {
                        'sessionNumber': index + 1,
                        'startDateTimeUtc': value,
                        'durationMinutes': 120,
                    }
                    for index, value in enumerate([
                        '2026-09-02T08:30:00Z',
                        '2026-09-09T08:30:00Z',
                        '2026-09-16T08:30:00Z',
                        '2026-09-23T08:30:00Z',
                        '2026-10-07T08:30:00Z',
                        '2026-10-14T08:30:00Z',
                    ])
                ],
            }),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        result = response.json()
        self.assertEqual(result['meeting']['trackedOccurrences'], 6)
        self.assertEqual(result['warnings'][0]['code'], 'teams_shifted_occurrence_recreated')
        self.assertTrue(any(call.args[:2] == ('DELETE', 'users/tutor%40example.com/events/instance-6') for call in graph_request.call_args_list))
        occurrences = views.authoring_fetch_all(
            views.LIVE_SESSION_OCCURRENCES_TABLE,
            'live_session_id = %s',
            [live_session_id],
            'session_number asc',
        )
        self.assertEqual([row['scheduled_start'].date().isoformat() for row in occurrences], [
            '2026-09-02',
            '2026-09-09',
            '2026-09-16',
            '2026-09-23',
            '2026-10-07',
            '2026-10-14',
        ])

    @patch('coach_api.views.microsoft_graph_request')
    @patch('coach_api.views.has_graph_credentials', return_value=True)
    def test_artifact_sync_backfills_online_meeting_id_from_join_url(self, _credentials, graph_request):
        live_session_id = 'LIVE-MISSING-MEETING-ID'
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {
            'id': live_session_id,
            'organizer_email': 'tutor@example.com',
            'join_url': 'https://teams.microsoft.com/l/meetup-join/example',
            'online_meeting_id': '',
            'status': 'active',
        })
        graph_request.side_effect = [
            {
                'value': [{
                    'id': 'meeting-recovered',
                    'meetingOptionsWebUrl': 'https://teams.microsoft.com/meetingOptions/recovered',
                }],
            },
            {'value': []},
            {'value': []},
            {'value': []},
        ]

        response = self.client.post(
            f'/curriculum_api/curriculum/teams-meetings/{live_session_id}/artifacts/',
            data='{}',
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        saved = views.authoring_fetch_all(
            views.LIVE_SESSIONS_TABLE,
            'id = %s',
            [live_session_id],
        )[0]
        self.assertEqual(saved['online_meeting_id'], 'meeting-recovered')
        self.assertEqual(
            saved['meeting_options_url'],
            'https://teams.microsoft.com/meetingOptions/recovered',
        )
        self.assertIn('users/tutor%40example.com/onlineMeetings?', graph_request.call_args_list[0].args[1])
        self.assertEqual(
            graph_request.call_args_list[1].args[1],
            'users/tutor%40example.com/onlineMeetings/meeting-recovered/attendanceReports',
        )

    @patch('coach_api.views.has_graph_credentials', return_value=True)
    @patch('coach_api.views.get_graph_settings', return_value={
        'tenant_id': 'tenant',
        'client_id': 'client',
        'client_secret': 'secret',
        'scope': 'https://graph.microsoft.com/.default',
        'base_url': 'https://graph.microsoft.com/v1.0',
        'timezone': 'GMT Standard Time',
    })
    def test_requires_organizer_when_no_default_is_configured(self, _settings, _credentials):
        with patch.dict('os.environ', {'MICROSOFT_TEAMS_ORGANIZER_EMAIL': ''}):
            response = self.client.post(
                '/curriculum_api/curriculum/teams-meetings/',
                data=json.dumps({'title': 'Live session'}),
                content_type='application/json',
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn('Organizer email is required', response.json()['error'])


class CurriculumPersistenceTests(TestCase):
    def setUp(self):
        views._AUTHORING_TABLES_READY = False
        views._PROGRAMME_CONFIG_DEDUP_READY = False
        views._TABLE_COLUMNS_CACHE.clear()
        views.invalidate_curriculum_cache()
        self.client = Client()
        self.ensure_programmes_table()
        self.ensure_ksb_profiles_table()
        views.ensure_module_authoring_tables()
        views.ensure_staff_profile_tables()
        self.clear_curriculum_tables()
        self.seed_ksb_profile()

    def ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table_name = 'curriculum.programmes'
            else:
                table_name = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table_name} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    sub varchar(255),
                    standard varchar(255),
                    level varchar(64),
                    owner varchar(255),
                    created_by varchar(255),
                    color varchar(32),
                    description text,
                    structure_type varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def ensure_ksb_profiles_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table_name = 'curriculum.ksb_profiles'
                json_type = 'jsonb'
            else:
                table_name = 'ksb_profiles'
                json_type = 'text'
            cursor.execute(
                f"""
                create table if not exists {table_name} (
                    id varchar(128) primary key,
                    name varchar(255),
                    programme_name varchar(255),
                    programme_id varchar(128),
                    ksb_profile_id varchar(128),
                    legacy_numeric_id bigint,
                    ksb_items {json_type},
                    is_active boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def clear_curriculum_tables(self):
        table_names = [
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_COMPLETION_TABLE,
            views.AUTHORING_ADVANCED_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.STAFF_PROFILE_TABLES['coach'],
            views.STAFF_PROFILE_TABLES['tutor'],
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'ksb_profiles',
            'programmes',
        ]
        with connection.cursor() as cursor:
            for table in table_names:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    def seed_ksb_profile(self):
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {views.authoring_table_name('ksb_profiles')}
                (id, name, programme_name, programme_id, ksb_profile_id, ksb_items, is_active)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    'KSBP-DATA',
                    'Data Analyst KSBs',
                    'Data Analyst',
                    'PROG-DATA',
                    'KSBP-DATA',
                    json.dumps([{'id': 'KSB-K1', 'code': 'K1', 'type': 'knowledge', 'description': 'Data basics'}]),
                    True,
                ],
            )

    def post_json(self, path, payload):
        return self.client.post(path, data=json.dumps(payload), content_type='application/json')

    def patch_json(self, path, payload):
        return self.client.patch(path, data=json.dumps(payload), content_type='application/json')

    def tree_payload(self, programme_id='PROG-DATA', cohort_id='COHORT-DATA-1', group_id='GROUP-DATA-1', module_id='MOD-DATA-1'):
        return {
            'programme': {
                'id': programme_id,
                'name': 'Data Analyst',
                'standard': 'Data Analyst',
                'level': '4',
                'structureType': 'scheduled',
            },
            'cohorts': [{
                'id': cohort_id,
                'name': 'September 2026',
                'programmeId': programme_id,
                'startDate': '2026-09-01',
                'endDate': '2027-08-31',
                'durationMonths': 12,
                'groups': [{
                    'id': group_id,
                    'name': 'Group A',
                    'coach': 'Coach One',
                    'tutor': 'Tutor One',
                    'weekDays': 'Wednesday',
                    'startTime': '10:00',
                    'endTime': '12:00',
                    'modules': [{
                        'moduleName': 'Data Foundations',
                        'catalogueId': module_id,
                        'startDate': '2026-09-02',
                        'endDate': '2026-09-09',
                        'sessionsNumber': 2,
                        'weekDays': 'Wednesday',
                        'coach': 'Coach One',
                        'tutor': 'Tutor One',
                        'weekStructure': [{
                            'id': 'WEEK-DATA-1',
                            'weekNumber': 1,
                            'title': 'Week 1',
                            'components': [{
                                'id': 'COMP-DATA-1',
                                'type': 'reading',
                                'title': 'Read data brief',
                                'ksbMappings': [{
                                    'id': 'KSBMAP-DATA-1',
                                    'code': 'K1',
                                    'description': 'Data basics',
                                    'classification': 'main',
                                    'weight': 1,
                                    'sourceType': 'framework',
                                    'sourceId': 'KSBP-DATA',
                                }],
                            }],
                        }],
                    }],
                }],
            }],
            'removeMissing': False,
            'hydrationComplete': True,
        }

    def row(self, table, key, value):
        rows = views.authoring_fetch_all(table, f'{key} = %s', [value])
        self.assertTrue(rows, f'Expected {table}.{key}={value}')
        return rows[0]

    def count(self, table, key, value):
        return len(views.authoring_fetch_all(table, f'{key} = %s', [value]))

    def resolve_structures(self, *identifiers):
        response = self.post_json(
            '/curriculum_api/curriculum/modules/resolve-structures/',
            {'modules': [{'requestId': item, 'identifier': item} for item in identifiers]},
        )
        self.assertEqual(response.status_code, 200, response.content)
        return {item['requestId']: item for item in response.json()['results']}

    def test_tree_save_persists_components_without_a_module_builder_save(self):
        """A wizard-created module's components must land in the normalized tables
        immediately, so resolve-structures reports them with no manual Save."""
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)

        result = self.resolve_structures('MOD-DATA-1')['MOD-DATA-1']
        self.assertTrue(result['found'])
        self.assertTrue(result['hasComponents'])
        self.assertEqual(result['componentCount'], 1)

    def test_integer_weeks_count_never_replaces_the_authored_week_structure(self):
        """`weeks` is a session count in the attachment payload. Treating it as a
        structure silently dropped every authored week and component."""
        payload = self.tree_payload()
        module = payload['cohorts'][0]['groups'][0]['modules'][0]
        module['weeks'] = 2  # the integer form the wizard sends alongside weekStructure

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.row(views.AUTHORING_WEEKS_TABLE, 'id', 'WEEK-DATA-1')['module_catalogue_id'], 'MOD-DATA-1')

    def test_reattaching_without_a_structure_keeps_the_stored_components(self):
        """The wizard re-sends an attachment carrying only the integer session
        count. That must not wipe the weeks/components already stored."""
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)

        payload = self.tree_payload()
        module = payload['cohorts'][0]['groups'][0]['modules'][0]
        module.pop('weekStructure')
        module['weeks'] = 5  # integer session count only, no authored structure

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        # Falls back to the stored structure rather than treating 5 as the weeks.
        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        result = self.resolve_structures('MOD-DATA-1')['MOD-DATA-1']
        self.assertTrue(result['hasComponents'])
        self.assertEqual(result['componentCount'], 1)

    def test_group_module_attachment_persists_supplied_components(self):
        """POST /groups/<id>/modules/ with authored weeks must write the normalized
        rows straight away instead of waiting for a Module Builder save."""
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {
            'moduleName': 'Attached Module',
            'catalogueId': 'MOD-ATTACH-1',
            'sessionsNumber': 1,
            'startDate': '2026-09-16',
            'weekStructure': [{
                'id': 'WEEK-ATTACH-1',
                'weekNumber': 1,
                'title': 'Week 1',
                'components': [{
                    'id': 'COMP-ATTACH-1',
                    'type': 'reading',
                    'title': 'Attached reading',
                }],
            }],
        })
        self.assertIn(response.status_code, (200, 201), response.content)

        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-ATTACH-1'), 1)
        result = self.resolve_structures('MOD-ATTACH-1')['MOD-ATTACH-1']
        self.assertTrue(result['found'])
        self.assertTrue(result['hasComponents'])
        self.assertEqual(result['componentCount'], 1)

    def test_attachment_session_count_handles_both_weeks_forms(self):
        self.assertEqual(views.attachment_session_count({'sessionsNumber': 4, 'weeks': 9}), 4)
        self.assertEqual(views.attachment_session_count({'weeks': 6}), 6)
        self.assertEqual(views.attachment_session_count({'weeks': '3'}), 3)
        self.assertEqual(views.attachment_session_count({'weeks': [{'id': 'W1'}, {'id': 'W2'}]}), 2)
        self.assertEqual(views.attachment_session_count({}), 0)

    def test_attachment_week_structure_rejects_non_list_weeks(self):
        self.assertEqual(views.attachment_week_structure({'weeks': 5}), [])
        self.assertEqual(views.attachment_week_structure({'weeks': '5'}), [])
        self.assertEqual(views.attachment_week_structure({'weeks': [1, 2]}), [])
        self.assertEqual(views.attachment_week_structure({'weekStructure': [], 'weeks': 5}), [])

        authored = [{'id': 'WEEK-1', 'components': []}]
        self.assertEqual(views.attachment_week_structure({'weeks': authored}), authored)
        self.assertEqual(views.attachment_week_structure({'weekStructure': authored, 'weeks': 5}), authored)
        # Falls back to what is already stored only when nothing is supplied.
        self.assertEqual(views.attachment_week_structure({}, {'weekStructure': authored}), authored)

    def test_save_rejects_an_integer_week_structure_instead_of_dropping_weeks(self):
        errors = views.validate_module_authoring_payload({'title': 'Module', 'weekStructure': 4})
        self.assertTrue(any(item['path'] == 'weekStructure' for item in errors), errors)

        with self.assertRaises(views.ModuleAuthoringValidationError):
            views.save_module_authoring_structure('MOD-INT-WEEKS', {'title': 'Module', 'weekStructure': 4})

    def test_intentionally_empty_module_resolves_as_empty_not_missing(self):
        payload = self.tree_payload()
        payload['cohorts'][0]['groups'][0]['modules'][0]['weekStructure'] = []

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        result = self.resolve_structures('MOD-DATA-1')['MOD-DATA-1']
        self.assertTrue(result['found'])
        self.assertFalse(result.get('missing', False))
        self.assertFalse(result['hasComponents'])
        self.assertEqual(result['componentCount'], 0)

    def test_unknown_module_resolves_as_missing(self):
        result = self.resolve_structures('MOD-NOT-A-REAL-MODULE')['MOD-NOT-A-REAL-MODULE']
        self.assertFalse(result['found'])
        self.assertTrue(result['missing'])
        self.assertEqual(result['componentCount'], 0)

    def test_resaving_the_tree_does_not_duplicate_weeks_or_components(self):
        for _ in range(2):
            response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
            self.assertEqual(response.status_code, 200, response.content)

        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)

    def test_create_programme_tree_with_component_ksb_mapping(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        cohort = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        component = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-DATA-1')
        mapping = self.row(views.AUTHORING_KSB_MAPPINGS_TABLE, 'id', 'KSBMAP-DATA-1')

        self.assertEqual(cohort['programme_id'], 'PROG-DATA')
        self.assertIn('GROUP-DATA-1', views.as_json_value(cohort['group_ids'], []))
        self.assertEqual(group['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')
        self.assertEqual(module['tutor_name'], 'Tutor One')
        self.assertEqual(component['module_catalogue_id'], 'MOD-DATA-1')
        self.assertEqual(mapping['component_id'], 'COMP-DATA-1')

    def test_live_session_link_is_saved_in_dedicated_component_column(self):
        payload = self.tree_payload()
        component = payload['cohorts'][0]['groups'][0]['modules'][0]['weekStructure'][0]['components'][0]
        component.update({
            'type': 'live-session',
            'title': 'Live data workshop',
            'settings': {
                'liveSessionUrl': 'https://teams.microsoft.com/l/meetup-join/test-meeting',
                'teamsLiveSessionId': 'LIVE-TEST-1',
            },
        })

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        saved = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-DATA-1')
        self.assertEqual(
            saved['live_sessions_link'],
            'https://teams.microsoft.com/l/meetup-join/test-meeting',
        )

    def test_tree_save_syncs_coach_and_each_module_tutor_profile(self):
        views.authoring_upsert(views.STAFF_PROFILE_TABLES['coach'], ['id'], {
            'id': 'COACH-ONE',
            'name': 'Coach One',
            'email': 'coach.one@example.com',
            'assigned_group_ids': views.json_db_value([]),
            'is_archived': False,
        })
        views.authoring_upsert(views.STAFF_PROFILE_TABLES['tutor'], ['id'], {
            'id': 'TUTOR-ONE',
            'name': 'Tutor One',
            'email': 'tutor.one@example.com',
            'assigned_module_ids': views.json_db_value([]),
            'is_archived': False,
        })
        views.authoring_upsert(views.STAFF_PROFILE_TABLES['tutor'], ['id'], {
            'id': 'TUTOR-TWO',
            'name': 'Tutor Two',
            'email': 'tutor.two@example.com',
            'assigned_module_ids': views.json_db_value([]),
            'is_archived': False,
        })
        payload = self.tree_payload()
        payload['cohorts'][0]['groups'][0]['modules'].append({
            'moduleName': 'Applied Dashboards',
            'catalogueId': 'MOD-DATA-2',
            'startDate': '2026-09-16',
            'endDate': '2026-09-23',
            'sessionsNumber': 2,
            'weekDays': 'Wednesday',
            'coach': 'Coach One',
            'tutor': 'Tutor Two',
            'weekStructure': [{
                'id': 'WEEK-DATA-2',
                'weekNumber': 1,
                'title': 'Week 1',
                'components': [],
            }],
        })

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        coach = self.row(views.STAFF_PROFILE_TABLES['coach'], 'id', 'COACH-ONE')
        tutor_one = self.row(views.STAFF_PROFILE_TABLES['tutor'], 'id', 'TUTOR-ONE')
        tutor_two = self.row(views.STAFF_PROFILE_TABLES['tutor'], 'id', 'TUTOR-TWO')
        self.assertIn('GROUP-DATA-1', views.as_json_value(coach['assigned_group_ids'], []))
        self.assertIn('MOD-DATA-1', views.as_json_value(tutor_one['assigned_module_ids'], []))
        self.assertNotIn('MOD-DATA-2', views.as_json_value(tutor_one['assigned_module_ids'], []))
        self.assertIn('MOD-DATA-2', views.as_json_value(tutor_two['assigned_module_ids'], []))

    def test_global_ksb_coverage_uses_framework_definitions(self):
        response = self.client.get('/curriculum_api/curriculum/ksb-coverage/')
        self.assertEqual(response.status_code, 200, response.content)

        payload = response.json()
        self.assertEqual(payload['scope'], 'all')
        self.assertEqual(payload['summary']['overall']['required'], 1)
        self.assertEqual(payload['summary']['overall']['missing'], 1)
        self.assertEqual(payload['items'][0]['code'], 'K1')
        self.assertEqual(payload['items'][0]['source_id'], 'KSBP-DATA')

    def test_delete_ksb_framework_removes_profile_row(self):
        response = self.client.delete('/curriculum_api/curriculum/ksb-frameworks/KSBP-DATA/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['deleted'])
        self.assertFalse(views.authoring_fetch_all('ksb_profiles', 'id = %s', ['KSBP-DATA']))

    def test_required_count_can_exclude_mapping_only_ksbs(self):
        coverage = build_coverage(
            [{'code': 'K1', 'type': 'knowledge', 'source_type': 'framework', 'source_id': 'KSBP-DATA'}],
            [
                {'id': 'MAP-1', 'module_catalogue_id': 'MOD-1', 'ksb_code': 'K1', 'source_type': 'framework', 'source_id': 'KSBP-DATA', 'weight': 100},
                {'id': 'MAP-2', 'module_catalogue_id': 'MOD-1', 'ksb_code': 'K99', 'source_type': 'framework', 'source_id': 'KSBP-DATA', 'weight': 100},
            ],
            [{'module_catalogue_id': 'MOD-1', 'title': 'Module 1'}],
            [],
            [],
            include_mapping_only=False,
        )

        self.assertEqual(coverage['summary']['overall']['required'], 1)
        self.assertEqual([item['code'] for item in coverage['items']], ['K1'])

    def test_add_cohort_without_removing_existing_when_hydration_incomplete(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = True
        second['hydrationComplete'] = False

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotEqual(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')['status'], 'archived')
        self.assertNotEqual(self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')['status'], 'archived')

    def test_tree_save_removes_missing_rows_when_hydrated(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = True
        second['hydrationComplete'] = True

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['removedMissing'])
        self.assertFalse(views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', ['COHORT-DATA-1']))
        self.assertFalse(views.authoring_fetch_all(views.GROUPS_TABLE, 'group_id = %s', ['GROUP-DATA-1']))

    def test_tree_save_explicitly_removes_deleted_cohort(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = False
        second['hydrationComplete'] = False
        second['removeCohortIds'] = ['COHORT-DATA-1']

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('COHORT-DATA-1', response.json()['removedCohortIds'])
        self.assertIn('GROUP-DATA-1', response.json()['removedGroupIds'])
        self.assertFalse(views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', ['COHORT-DATA-1']))
        self.assertFalse(views.authoring_fetch_all(views.GROUPS_TABLE, 'group_id = %s', ['GROUP-DATA-1']))

    def test_programme_card_counts_cohorts_without_delivery_modules(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], {
            'cohort_id': 'COHORT-DATA-2',
            'cohort_name': 'October 2026',
            'programme_id': 'PROG-DATA',
            'programme_name': 'Data Analyst',
            'start_date': '2026-10-01',
            'end_date': '2027-09-30',
            'status': 'planned',
            'group_ids': views.json_db_value([]),
            'module_names': views.json_db_value([]),
            'holiday_ids': views.json_db_value([]),
        })
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], {
            'cohort_id': 'COHORT-DATA-ARCHIVED',
            'cohort_name': 'Archived Cohort',
            'programme_id': 'PROG-DATA',
            'programme_name': 'Data Analyst',
            'status': 'archived',
            'group_ids': views.json_db_value([]),
            'module_names': views.json_db_value([]),
            'holiday_ids': views.json_db_value([]),
        })

        programmes = views.build_programmes(
            views.get_training_rows(),
            views.get_program_config_rows(),
            views.get_ksb_profile_rows(),
        )
        programme = next(item for item in programmes if item['id'] == 'PROG-DATA')

        self.assertEqual(programme['cohorts'], 2)
        self.assertEqual(programme['modules'], 1)

    def test_programme_detail_only_returns_the_selected_programme_tree(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        other = self.tree_payload(
            programme_id='PROG-OTHER',
            cohort_id='COHORT-OTHER-1',
            group_id='GROUP-OTHER-1',
            module_id='MOD-OTHER-1',
        )
        other['programme']['name'] = 'Other Programme'
        other['programme']['standard'] = 'Other Standard'
        self.post_json('/curriculum_api/curriculum/programmes/tree/', other)

        response = self.client.get('/curriculum_api/curriculum/programmes/PROG-DATA/detail/')
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()

        self.assertEqual([item['id'] for item in payload['flat']['cohorts']], ['COHORT-DATA-1'])
        self.assertEqual([item['id'] for item in payload['flat']['groups']], ['GROUP-DATA-1'])
        self.assertEqual([item['id'] for item in payload['cohorts']], ['COHORT-DATA-1'])
        self.assertEqual([item['id'] for item in payload['cohorts'][0]['groups']], ['GROUP-DATA-1'])

    def test_post_add_module_does_not_detach_existing_modules(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        response = self.post_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {
            'moduleName': 'Data Visualisation',
            'catalogueId': 'MOD-DATA-2',
            'startDate': '2026-09-16',
            'sessionsNumber': 1,
        })
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['group_id'], 'GROUP-DATA-1')
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-2')['group_id'], 'GROUP-DATA-1')

    def test_patch_replace_group_modules_detaches_omitted_modules(self):
        self.test_post_add_module_does_not_detach_existing_modules()
        response = self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/modules/', {'modules': [{
            'moduleName': 'Data Visualisation',
            'catalogueId': 'MOD-DATA-2',
            'startDate': '2026-09-16',
            'sessionsNumber': 1,
        }]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['group_id'])
        self.assertEqual(self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-2')['group_id'], 'GROUP-DATA-1')

    def test_move_group_updates_both_cohort_group_ids_and_modules(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = False
        self.post_json('/curriculum_api/curriculum/programmes/tree/', second)

        response = self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'cohortId': 'COHORT-DATA-2'})
        self.assertEqual(response.status_code, 200, response.content)
        old_ids = views.as_json_value(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')['group_ids'], [])
        new_ids = views.as_json_value(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-2')['group_ids'], [])
        self.assertNotIn('GROUP-DATA-1', old_ids)
        self.assertIn('GROUP-DATA-1', new_ids)
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-2')
        self.assertEqual(module['programme_id'], 'PROG-DATA')

    def test_id_edits_preserve_parent_relationships(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.patch_json('/curriculum_api/curriculum/cohorts/COHORT-DATA-1/', {'name': 'Renamed Cohort'})
        self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'name': 'Renamed Group', 'coach': 'Coach Two', 'tutor': 'Tutor Two'})
        self.patch_json('/curriculum_api/curriculum/modules/MOD-DATA-1/', {'name': 'Renamed Module'})

        cohort = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(cohort['programme_id'], 'PROG-DATA')
        self.assertEqual(group['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(group['programme_id'], 'PROG-DATA')
        self.assertEqual(group['coach_name'], 'Coach Two')
        self.assertEqual(group['tutor_name'], 'Tutor Two')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')


class CurriculumCacheTests(SimpleTestCase):
    """Guards the authoring cache's correctness properties.

    The cache is process-local and TTL-based, so the risky failure modes are all
    about invalidation rather than hit rate: a stale entry surviving a write, or a
    failed build being memoised.
    """

    def setUp(self):
        views.invalidate_curriculum_cache()
        self.addCleanup(views.invalidate_curriculum_cache)

    def test_value_is_cached_and_factory_runs_once(self):
        calls = []

        def factory():
            calls.append(1)
            return 'value'

        results = [views.cached_curriculum_value('k', factory) for _ in range(3)]
        self.assertEqual(results, ['value'] * 3)
        self.assertEqual(len(calls), 1)

    def test_invalidation_forces_a_rebuild(self):
        views.cached_curriculum_value('k', lambda: 'first')
        views.invalidate_curriculum_cache()
        self.assertEqual(views.cached_curriculum_value('k', lambda: 'second'), 'second')

    def test_failed_build_is_not_cached(self):
        def boom():
            raise RuntimeError('build failed')

        with self.assertRaises(RuntimeError):
            views.cached_curriculum_value('k', boom)
        # A failure must not be memoised, otherwise one transient DB error would
        # serve an error (or a hole) for the whole TTL.
        self.assertNotIn('k', views._CURRICULUM_CACHE)
        self.assertEqual(views.cached_curriculum_value('k', lambda: 'recovered'), 'recovered')

    def test_slow_build_does_not_block_other_keys(self):
        started = threading.Event()
        release = threading.Event()
        other = {}

        def slow():
            started.set()
            release.wait(5)
            return 'slow'

        builder = threading.Thread(target=lambda: views.cached_curriculum_value('slow', slow))
        builder.start()
        try:
            self.assertTrue(started.wait(5))
            reader = threading.Thread(
                target=lambda: other.setdefault('value', views.cached_curriculum_value('fast', lambda: 'fast'))
            )
            reader.start()
            reader.join(3)
            # The factory must run outside the lock; otherwise a cold-database build
            # serialises every other curriculum read behind it.
            self.assertEqual(other.get('value'), 'fast')
        finally:
            release.set()
            builder.join(5)

    def test_write_during_an_in_flight_build_discards_the_stale_result(self):
        started = threading.Event()
        release = threading.Event()

        def slow():
            started.set()
            release.wait(5)
            return 'pre-write rows'

        builder = threading.Thread(target=lambda: views.cached_curriculum_value('race', slow))
        builder.start()
        try:
            self.assertTrue(started.wait(5))
            views.invalidate_curriculum_cache()
        finally:
            release.set()
            builder.join(5)

        self.assertNotIn('race', views._CURRICULUM_CACHE)
        self.assertEqual(views.cached_curriculum_value('race', lambda: 'post-write rows'), 'post-write rows')

    def test_invalidation_is_global_so_every_write_clears_every_key(self):
        # Curriculum writes cascade widely: a module edit changes the overview, the
        # programme tree, the module list and any resolve-structures entry naming it.
        # Rather than enumerate that fan-out per write, invalidation clears the whole
        # cache — the trade-off is a cold rebuild after each write, in exchange for
        # making a missed key impossible. This test fails if it is ever narrowed to
        # targeted eviction without the per-key mapping being proven first.
        for key in ('overview:operational:compact', 'overview:all:full', 'modules:all:enriched'):
            views.cached_curriculum_value(key, lambda: 'pre-write')
        views.cached_curriculum_value(
            views.structure_payloads_cache_key(['MOD-A'], include_staff=False),
            lambda: 'pre-write',
        )
        self.assertNotEqual(views._CURRICULUM_CACHE, {})

        views.invalidate_curriculum_cache()

        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_invalidation_clears_the_table_exists_cache(self):
        views._TABLE_EXISTS_CACHE['curriculum.example'] = True
        views.invalidate_curriculum_cache()
        self.assertEqual(views._TABLE_EXISTS_CACHE, {})


class StructurePayloadsCacheKeyTests(SimpleTestCase):
    """Guards the cache identity used by the resolve-structures endpoint.

    Two properties matter and pull in opposite directions: requests that would
    produce different bodies must never share an entry, while requests that differ
    only in identifier order or duplication must share one, or the endpoint caches
    nothing useful.
    """

    def key(self, ids, **options):
        options = {'include_staff': False, 'include_quality': False, 'include_extra': False, **options}
        return views.structure_payloads_cache_key(ids, **options)

    def test_each_shaping_flag_changes_the_key(self):
        base = self.key(['MOD-A'])
        for flag in ('include_staff', 'include_quality', 'include_extra'):
            with self.subTest(flag=flag):
                self.assertNotEqual(base, self.key(['MOD-A'], **{flag: True}))

    def test_every_flag_combination_is_distinct(self):
        keys = {
            self.key(['MOD-A'], include_staff=staff, include_quality=quality, include_extra=extra)
            for staff in (False, True)
            for quality in (False, True)
            for extra in (False, True)
        }
        # Eight combinations, eight entries: no pair of differently-shaped responses
        # can be served from one another's cache slot.
        self.assertEqual(len(keys), 8)

    def test_an_added_option_does_not_collide_with_the_current_shape(self):
        # The key is derived from the options actually passed, so a future caller that
        # introduces a flag gets a fresh entry rather than inheriting today's body.
        self.assertNotEqual(self.key(['MOD-A']), self.key(['MOD-A'], include_learners=False))

    def test_reordered_and_duplicated_identifiers_reuse_one_entry(self):
        # Safe to share: the builder returns a mapping keyed by catalogue id, so the
        # request order never reaches the response.
        self.assertEqual(self.key(['MOD-A', 'MOD-B']), self.key(['MOD-B', 'MOD-A']))
        self.assertEqual(self.key(['MOD-A', 'MOD-B']), self.key(['MOD-B', 'MOD-A', 'MOD-A']))
        self.assertEqual(self.key(['MOD-A', ' MOD-B ']), self.key(['MOD-B', 'MOD-A']))

    def test_different_identifier_sets_do_not_collide(self):
        self.assertNotEqual(self.key(['MOD-A']), self.key(['MOD-B']))
        self.assertNotEqual(self.key(['MOD-A']), self.key(['MOD-A', 'MOD-B']))
        # A subset must not read a superset's entry: the builder only returns rows for
        # the ids it was given, so the bodies genuinely differ.
        self.assertNotEqual(self.key(['MOD-A', 'MOD-B']), self.key(['MOD-A', 'MOD-B', 'MOD-C']))

    def test_identifier_count_is_not_confusable_by_concatenation(self):
        # 'MOD-A' + 'B' must not hash the same as 'MOD-AB': ids are space-joined and
        # the count is in the key, so neither can be forged from the other.
        self.assertNotEqual(self.key(['MOD-A', 'B']), self.key(['MOD-AB']))

    def test_key_length_is_bounded_for_large_requests(self):
        # A resolve request may name hundreds of modules; the key must stay short or the
        # process cache holds megabytes of keys for the whole TTL. Only the count digits
        # vary with input size — the identifiers themselves are hashed to a fixed width.
        one = self.key(['MOD-A'])
        many = self.key([f'MOD-{index}' for index in range(500)])
        self.assertLess(len(many), 160)
        self.assertEqual(len(many) - len(one), len('500') - len('1'))

    def test_distinct_flags_produce_distinct_cached_values(self):
        # End-to-end through the cache itself, not just the key function.
        views.invalidate_curriculum_cache()
        self.addCleanup(views.invalidate_curriculum_cache)
        lite = views.cached_curriculum_value(self.key(['MOD-A']), lambda: 'lite')
        full = views.cached_curriculum_value(self.key(['MOD-A'], include_extra=True), lambda: 'full')
        self.assertEqual((lite, full), ('lite', 'full'))

    def test_equivalent_requests_hit_one_cached_build(self):
        views.invalidate_curriculum_cache()
        self.addCleanup(views.invalidate_curriculum_cache)
        builds = []

        def factory():
            builds.append(1)
            return 'payloads'

        views.cached_curriculum_value(self.key(['MOD-A', 'MOD-B']), factory)
        views.cached_curriculum_value(self.key(['MOD-B', 'MOD-A']), factory)
        self.assertEqual(len(builds), 1)


class CurriculumReferenceEtagTests(SimpleTestCase):
    """Covers the ETag/304 behaviour on the reference-data helper."""

    def _request(self, if_none_match=None):
        headers = {'If-None-Match': if_none_match} if if_none_match else {}
        return RequestFactory().get('/curriculum/standards/', headers=headers)

    def test_first_response_carries_a_validator_and_a_body(self):
        response = views.reference_json_response(self._request(), {'results': [1, 2, 3]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['ETag'])
        self.assertEqual(json.loads(response.content)['results'], [1, 2, 3])

    def test_matching_validator_returns_304_with_no_body(self):
        payload = {'results': [1, 2, 3]}
        etag = views.reference_json_response(self._request(), payload)['ETag']
        revalidated = views.reference_json_response(self._request(etag), payload)
        self.assertEqual(revalidated.status_code, 304)
        self.assertEqual(revalidated.content, b'')
        self.assertEqual(revalidated['ETag'], etag)

    def test_changed_content_changes_the_validator_and_returns_200(self):
        etag = views.reference_json_response(self._request(), {'results': [1]})['ETag']
        changed = views.reference_json_response(self._request(etag), {'results': [1, 2]})
        # A stale validator must never yield 304, otherwise a standards import would
        # stay invisible to every client that already holds the old ETag.
        self.assertEqual(changed.status_code, 200)
        self.assertNotEqual(changed['ETag'], etag)

    def test_reference_responses_are_never_publicly_cacheable(self):
        response = views.reference_json_response(self._request(), {'results': []})
        # These endpoints sit behind authentication, so a shared cache must not keep
        # them even though the content is user-independent.
        self.assertIn('private', response['Cache-Control'])
        self.assertNotIn('public', response['Cache-Control'])

    def test_handles_a_multi_value_if_none_match_header(self):
        payload = {'results': ['x']}
        etag = views.reference_json_response(self._request(), payload)['ETag']
        response = views.reference_json_response(self._request(f'"other", {etag}'), payload)
        self.assertEqual(response.status_code, 304)
