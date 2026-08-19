import json
import threading
from unittest.mock import patch

from django.db import connection
from django.test import Client, RequestFactory, SimpleTestCase, TestCase

from . import views
from .ksb_coverage import build_coverage


class ComponentOwnedKsbMappingTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.ensure_module_authoring_tables()
        for table in (
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_MODULES_TABLE,
        ):
            views.authoring_delete(table)

    def _component_row(self, mappings):
        views.authoring_upsert(views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': 'MOD-KSB-SOT',
            'programme_id': 'PROG-KSB-SOT',
            'programme_name': 'Programme',
            'title': 'Module',
        })
        views.authoring_upsert(views.AUTHORING_WEEKS_TABLE, ['id'], {
            'id': 'WEEK-KSB-SOT',
            'module_catalogue_id': 'MOD-KSB-SOT',
            'week_number': 1,
            'title': 'Week',
        })
        return views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-KSB-SOT',
            'week_id': 'WEEK-KSB-SOT',
            'module_catalogue_id': 'MOD-KSB-SOT',
            'type': 'reading',
            'title': 'Component',
            'expected_otjh': 3,
            'points': 10,
            'ksb_mappings': views.json_db_value(mappings),
        })

    @patch('curriculum_api.views.ksb_exists_in_source', return_value=True)
    @patch('curriculum_api.views.source_record_exists', return_value=True)
    def test_weight_class_validation_requires_allowed_enum(self, _source, _ksb):
        valid = {
            'code': 'K1',
            'sourceType': 'standard',
            'sourceId': 'STD-1',
            'classification': 'main',
            'weight': 50,
            'weightClass': 'hard',
        }
        self.assertEqual(views.validate_ksb_mapping_payload(valid, 'mapping'), [])

        invalid = {**valid, 'weightClass': 'medium'}
        errors = views.validate_ksb_mapping_payload(invalid, 'mapping')
        self.assertTrue(any(error['path'] == 'mapping.weight_class' for error in errors))

    def test_component_stores_multiple_ksbs_with_distinct_weight_classes(self):
        row = self._component_row([
            {'id': 'MAP-1', 'ksb_code': 'K1', 'weight': 50, 'weight_class': 'hard'},
            {'id': 'MAP-2', 'ksb_code': 'S4', 'weight': 30, 'weight_class': 'soft'},
            {'id': 'MAP-3', 'ksb_code': 'B2', 'weight': 20, 'weight_class': 'possible'},
        ])

        mappings = views.component_ksb_mappings_from_row(row)
        self.assertEqual([mapping['ksb_code'] for mapping in mappings], ['K1', 'S4', 'B2'])
        self.assertEqual([mapping['weight'] for mapping in mappings], [50, 30, 20])
        self.assertEqual([mapping['weight_class'] for mapping in mappings], ['hard', 'soft', 'possible'])
        self.assertEqual(float(row['expected_otjh']), 3)

    def test_projection_sync_is_derived_from_component_source(self):
        row = self._component_row([
            {
                'id': 'MAP-1',
                'ksb_code': 'K1',
                'source_type': 'standard',
                'source_id': 'STD-1',
                'classification': 'main',
                'weight': 50,
                'weight_class': 'hard',
            },
            {
                'id': 'MAP-2',
                'ksb_code': 'S4',
                'source_type': 'standard',
                'source_id': 'STD-1',
                'classification': 'secondary',
                'weight': 30,
                'weight_class': 'soft',
            },
        ])

        views.sync_component_ksb_projection('COMP-KSB-SOT', component_row=row)
        rows = views.active_mapping_rows(views.authoring_fetch_all(
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            'component_id = %s',
            ['COMP-KSB-SOT'],
            'ksb_code',
        ))

        self.assertEqual([row['ksb_code'] for row in rows], ['K1', 'S4'])
        self.assertEqual([float(row['weight']) for row in rows], [50, 30])
        self.assertEqual([row['weight_class'] for row in rows], ['hard', 'soft'])


class CrossCohortGroupNameCollisionTests(SimpleTestCase):
    """Group names repeat across cohorts, so identity matching must use ids.

    Regression cover for a wizard save that landed a module on a same-named
    group in a different cohort. The target group was then left with no module
    rows, which the read path reports as an unassigned tutor and a "TBD"
    delivery window because both are derived from the child modules.
    """

    AUG_GROUP = 'GROUP-AUG-0001'
    SEP_GROUP = 'GROUP-SEP-0001'
    AUG_COHORT = 'COHORT-AUG-0001'
    SEP_COHORT = 'COHORT-SEP-0001'

    def test_ids_conflict_when_both_sides_name_different_rows(self):
        self.assertTrue(views.identity_ids_conflict(self.SEP_GROUP, [self.AUG_GROUP]))
        self.assertFalse(views.identity_ids_conflict(self.SEP_GROUP, [self.SEP_GROUP]))

    def test_ids_do_not_conflict_when_either_side_is_unknown(self):
        # A legacy row with no id, or a caller that only knows the name, must
        # stay on the permissive name-based path rather than being rejected.
        self.assertFalse(views.identity_ids_conflict('', [self.AUG_GROUP]))
        self.assertFalse(views.identity_ids_conflict(self.SEP_GROUP, []))
        self.assertFalse(views.identity_ids_conflict(self.SEP_GROUP, ['', None]))

    def test_shared_group_name_alone_still_satisfies_the_name_matcher(self):
        # Documents *why* the id guard is needed: the pooled id+name comparison
        # cannot tell two cohorts' "G1-Wed" apart on its own.
        self.assertTrue(views.identity_values_match_context(
            [self.SEP_GROUP, 'G1-Wed'],
            [self.AUG_GROUP, 'G1-Wed'],
        ))

    def test_differing_cohort_ids_are_rejected_by_the_id_guard(self):
        self.assertTrue(views.identity_ids_conflict(self.SEP_COHORT, [self.AUG_COHORT]))


class CurriculumGroupModuleMatchingTests(SimpleTestCase):
    def test_staff_profile_name_ignores_placeholder_values(self):
        self.assertEqual(views.staff_profile_name({'name': 'EMPTY_STRING', 'email': 'EMPTY_STRING'}), '')
        self.assertEqual(views.staff_profile_email({'email': 'EMPTY_STRING'}), '')
        self.assertEqual(views.staff_profile_name({'name': 'Unassigned'}), '')
        self.assertTrue(views.is_blank_staff_assignment('EMPTY_STRING'))

    def test_blank_staff_profiles_are_not_returned_even_with_assignments(self):
        tutor_profiles = views.build_staff_profiles(
            [],
            [{
                'id': 'TUTOR-BLANK',
                'name': 'EMPTY_STRING',
                'email': 'EMPTY_STRING',
                'assigned_module_ids': ['MOD-1'],
                'is_archived': False,
            }],
            'tutor',
            modules=[],
            groups=[],
        )
        coach_profiles = views.build_staff_profiles(
            [],
            [{
                'id': 'COACH-BLANK',
                'name': 'EMPTY_STRING',
                'email': 'EMPTY_STRING',
                'assigned_group_ids': ['GROUP-1'],
                'is_archived': False,
            }],
            'coach',
            modules=[],
            groups=[],
        )
        self.assertEqual(tutor_profiles, [])
        self.assertEqual(coach_profiles, [])

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
        views.reset_schema_ready_flags()
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
        # presenters is jsonb on PostgreSQL but text on SQLite, so the raw row
        # is a list on one vendor and a JSON string on the other. Decode it the
        # way every production reader does rather than asserting one vendor's
        # physical storage encoding.
        self.assertEqual(views.as_json_value(live_session['presenters'], []), ['presenter@example.com'])
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
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self.client = Client()
        self.ensure_programmes_table()
        self.ensure_ksb_profiles_table()
        views.ensure_module_authoring_tables()
        views.ensure_staff_profile_tables()
        self.clear_curriculum_tables()
        self.clear_staff_profile_tables()
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
                    status varchar(32),
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

    def clear_staff_profile_tables(self):
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {views.table_name("coaches")}')
            cursor.execute(f'delete from {views.table_name("tutors")}')

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
                                    # weight_class is the canonical delivery
                                    # weighting; 'main' maps to 'hard'.
                                    'weight_class': 'hard',
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

    def assertRemovedFromCurriculum(self, cohort_id, group_id):
        """A removed cohort/group is soft-deleted, not physically dropped.

        Curriculum rows are retained on delete (migrations 0040/0041) so that
        historical learner progress stays joinable to the curriculum it was
        delivered against. "Removed" therefore means two things, and both are
        asserted here: the row carries its soft-delete markers, and it no
        longer appears in the read model the UI builds from.
        """
        cohort = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', cohort_id)
        self.assertTrue(views.row_has_deleted_at(cohort), f'{cohort_id} should carry deleted_at')
        self.assertEqual(cohort['status'], 'archived')

        group = self.row(views.GROUPS_TABLE, 'group_id', group_id)
        self.assertTrue(views.row_has_deleted_at(group), f'{group_id} should carry deleted_at')

        cohorts, groups = views.build_cohorts_and_groups()
        self.assertNotIn(cohort_id, [item.get('id') for item in cohorts])
        self.assertNotIn(group_id, [item.get('id') for item in groups])

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

    def seed_same_titled_module(self, module_catalogue_id, component_count):
        """Persist a second module sharing 'Data Foundations' as its title."""
        payload = self.tree_payload(
            programme_id='PROG-OTHER',
            cohort_id='COHORT-OTHER-1',
            group_id='GROUP-OTHER-1',
            module_id=module_catalogue_id,
        )
        module = payload['cohorts'][0]['groups'][0]['modules'][0]
        week = module['weekStructure'][0]
        template = week['components'][0]
        week['components'] = [
            {**template, 'id': f'COMP-{module_catalogue_id}-{index}'}
            for index in range(component_count)
        ]
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

    def test_title_only_resolve_refuses_to_guess_between_same_titled_modules(self):
        """Resolving by title must never silently pick a winner.

        Two modules can legitimately share a title across programmes. Before this
        guard the endpoint ranked title matches by component count and returned the
        heaviest, so a group could be served another programme's content with no
        signal that a guess had been made. The ambiguity is reported instead.
        """
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        # Deliberately heavier than MOD-DATA-1 (1 component): under the old
        # component-count tie-break this is exactly the row that would have won.
        self.seed_same_titled_module('MOD-OTHER-1', component_count=3)

        result = self.resolve_structures('Data Foundations')['Data Foundations']

        self.assertFalse(result['found'])
        self.assertTrue(result['ambiguous'])
        # Not 'missing': the content exists, so the UI must not tell the user to
        # go create the module in Module Builder.
        self.assertFalse(result['missing'])
        self.assertEqual(
            sorted(result['ambiguousCatalogueIds']),
            ['MOD-DATA-1', 'MOD-OTHER-1'],
        )
        self.assertIsNone(result.get('module'))

    def test_exact_id_wins_over_a_colliding_title(self):
        """An id is an assertion, not a guess: title collisions must not weaken it."""
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        self.seed_same_titled_module('MOD-OTHER-1', component_count=3)

        result = self.resolve_structures('MOD-DATA-1')['MOD-DATA-1']

        self.assertTrue(result['found'])
        self.assertFalse(result.get('ambiguous', False))
        # The heavier same-titled module must not be substituted in.
        self.assertEqual(result['catalogueId'], 'MOD-DATA-1')
        self.assertEqual(result['componentCount'], 1)

    def test_unique_title_still_resolves(self):
        """The title fallback stays useful when it is unambiguous."""
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        result = self.resolve_structures('Data Foundations')['Data Foundations']

        self.assertTrue(result['found'])
        self.assertEqual(result['catalogueId'], 'MOD-DATA-1')

    def test_tree_save_persists_module_scheduling_values(self):
        payload = self.tree_payload()
        module = payload['cohorts'][0]['groups'][0]['modules'][0]
        module.update({
            'startDate': '2026-09-18',
            'endDate': '2026-09-30',
            'sessionsNumber': 1,
            'weekDays': 'Friday',
            'startTime': '09:30',
            'endTime': '11:30',
            'tutor': 'Unassigned',
        })

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        row = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(views.format_date(row['start_date']), '2026-09-18')
        self.assertEqual(views.format_date(row['end_date']), '2026-09-30')
        self.assertEqual(row['sessions_number'], 1)
        self.assertEqual(row['session_week_day'], 'Friday')
        self.assertEqual(row['session_start_time'], '09:30')
        self.assertEqual(row['session_end_time'], '11:30')
        self.assertIsNone(row['tutor_name'])

    def test_tree_update_resaves_visible_module_delivery_and_builder_weeks(self):
        first = self.tree_payload()
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        self.assertEqual(response.status_code, 200, response.content)

        second = self.tree_payload()
        second['partialTree'] = True
        second['cohorts'][0]['groups'][0]['modulesPartial'] = True
        module = second['cohorts'][0]['groups'][0]['modules'][0]
        module.update({
            'startDate': '2026-09-16',
            'endDate': '2026-10-14',
            'sessionsNumber': 5,
            'weeks': 5,
            'tutor': 'Tutor Two',
            'weekStructure': [
                {
                    'id': f'WEEK-DATA-{index}',
                    'weekNumber': index,
                    'title': f'Week {index}',
                    'components': [],
                }
                for index in range(1, 6)
            ],
        })

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)

        row = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(views.format_date(row['start_date']), '2026-09-16')
        self.assertEqual(views.format_date(row['end_date']), '2026-10-14')
        self.assertEqual(row['sessions_number'], 5)
        self.assertEqual(row['tutor_name'], 'Tutor Two')
        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 5)

        result = self.resolve_structures('MOD-DATA-1')['MOD-DATA-1']
        self.assertTrue(result['found'])
        self.assertEqual(len(result['module']['weekStructure']), 5)

    def test_tree_save_programme_is_active_even_when_client_sends_draft(self):
        payload = self.tree_payload(programme_id='PROG-DRAFT')
        payload['programme']['name'] = 'Draft Programme'
        payload['programme']['status'] = 'draft'

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['programme']['status'], 'active')

        response = self.client.get('/curriculum_api/curriculum/programmes/')
        self.assertEqual(response.status_code, 200, response.content)
        active = next(item for item in response.json()['programmes'] if item['sourceId'] == 'PROG-DRAFT')
        self.assertEqual(active['status'], 'active')

        response = self.client.get('/curriculum_api/curriculum/programmes/?visibility=all')
        self.assertEqual(response.status_code, 200, response.content)
        active = next(item for item in response.json()['programmes'] if item['sourceId'] == 'PROG-DRAFT')
        self.assertEqual(active['status'], 'active')

        payload['programme']['status'] = 'active'
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', payload)
        self.assertEqual(response.status_code, 200, response.content)

        response = self.client.get('/curriculum_api/curriculum/programmes/')
        self.assertEqual(response.status_code, 200, response.content)
        active = next(item for item in response.json()['programmes'] if item['sourceId'] == 'PROG-DRAFT')
        self.assertEqual(active['status'], 'active')

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

    def test_coverage_mappings_report_component_otjh(self):
        coverage = build_coverage(
            [{'code': 'K1', 'type': 'knowledge', 'source_type': 'framework', 'source_id': 'KSBP-DATA'}],
            [
                {'id': 'MAP-1', 'module_catalogue_id': 'MOD-1', 'component_id': 'COMP-1', 'ksb_code': 'K1', 'source_type': 'framework', 'source_id': 'KSBP-DATA', 'weight': 100},
                {'id': 'MAP-2', 'module_catalogue_id': 'MOD-1', 'ksb_code': 'K1', 'source_type': 'framework', 'source_id': 'KSBP-DATA', 'weight': 50},
            ],
            [{'module_catalogue_id': 'MOD-1', 'title': 'Module 1'}],
            [],
            [{'id': 'COMP-1', 'title': 'Component 1', 'type': 'reading', 'expected_otjh': '1.50'}],
        )

        mappings = {mapping['mapping_id']: mapping for mapping in coverage['items'][0]['mappings']}
        # Component-level mapping reports the component's expected OTJH.
        self.assertEqual(mappings['MAP-1']['component_otjh'], 1.5)
        self.assertEqual(mappings['MAP-1']['componentOtjh'], 1.5)
        # A module-level mapping is not attached to a component, so it has none.
        self.assertEqual(mappings['MAP-2']['component_otjh'], 0)

    def test_add_cohort_without_removing_existing_when_hydration_incomplete(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = True
        second['hydrationComplete'] = False

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotEqual(self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'COHORT-DATA-1')['status'], 'archived')
        # curriculum.groups lost its `status` column in migration 0013; group
        # removal is now recorded as a soft delete, so "still live" means no
        # deleted_at rather than a non-archived status.
        self.assertIsNone(self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')['deleted_at'])

    def test_tree_save_removes_missing_rows_when_hydrated(self):
        first = self.tree_payload()
        self.post_json('/curriculum_api/curriculum/programmes/tree/', first)
        second = self.tree_payload(cohort_id='COHORT-DATA-2', group_id='GROUP-DATA-2', module_id='MOD-DATA-2')
        second['removeMissing'] = True
        second['hydrationComplete'] = True

        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', second)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['removedMissing'])
        self.assertRemovedFromCurriculum('COHORT-DATA-1', 'GROUP-DATA-1')

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
        self.assertRemovedFromCurriculum('COHORT-DATA-1', 'GROUP-DATA-1')

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
        other_module = other['cohorts'][0]['groups'][0]['modules'][0]
        other_module['weekStructure'][0]['id'] = 'WEEK-OTHER-1'
        other_module['weekStructure'][0]['components'][0]['id'] = 'COMP-OTHER-1'
        self.post_json('/curriculum_api/curriculum/programmes/tree/', other)

        response = self.client.get('/curriculum_api/curriculum/programmes/PROG-DATA/detail/')
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()

        self.assertEqual([item['id'] for item in payload['flat']['cohorts']], ['COHORT-DATA-1'])
        self.assertEqual([item['id'] for item in payload['flat']['groups']], ['GROUP-DATA-1'])
        self.assertEqual([item['moduleCatalogueId'] for item in payload['flat']['modules']], ['MOD-DATA-1'])
        self.assertEqual(payload['flat']['modules'][0]['name'], 'Data Foundations')
        self.assertEqual(payload['flat']['modules'][0]['weekStructure'][0]['id'], 'WEEK-DATA-1')
        self.assertEqual([item['id'] for item in payload['cohorts']], ['COHORT-DATA-1'])
        self.assertEqual([item['id'] for item in payload['cohorts'][0]['groups']], ['GROUP-DATA-1'])
        self.assertEqual([item['moduleCatalogueId'] for item in payload['cohorts'][0]['groups'][0]['modules']], ['MOD-DATA-1'])

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
        # Tutor ownership moved from curriculum.groups to curriculum.modules
        # in migration 0023, which dropped groups.tutor_name.
        self.assertEqual(module['tutor_name'], 'Tutor Two')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')

    def test_module_patch_alias_preserves_components_and_delivery_metadata(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

        response = self.patch_json('/curriculum_api/curriculum/modules/catalogue-module-MOD-DATA-1/', {
            'name': 'Renamed From Wizard',
        })
        self.assertEqual(response.status_code, 200, response.content)

        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(module['title'], 'Renamed From Wizard')
        self.assertEqual(module['programme_id'], 'PROG-DATA')
        self.assertEqual(module['cohort_id'], 'COHORT-DATA-1')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')
        self.assertEqual(module['session_week_day'], 'Wednesday')
        self.assertEqual(module['session_start_time'], '10:00')
        self.assertEqual(module['session_end_time'], '12:00')
        self.assertEqual(self.count(views.AUTHORING_WEEKS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)
        self.assertEqual(self.count(views.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id', 'MOD-DATA-1'), 1)

    def test_component_post_patch_delete_writes_components_table(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

        created = self.post_json('/curriculum_api/curriculum/components/', {
            'id': 'COMP-API-1',
            'module': 'Data Foundations',
            'moduleCatalogueId': 'MOD-DATA-1',
            'weekId': 'WEEK-DATA-1',
            'weekNumber': 1,
            'title': 'API reading',
            'type': 'reading',
            'expectedOtjh': 1.5,
        })
        self.assertEqual(created.status_code, 201, created.content)
        component = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-API-1')
        self.assertEqual(component['module_catalogue_id'], 'MOD-DATA-1')
        self.assertEqual(component['week_id'], 'WEEK-DATA-1')
        self.assertEqual(component['title'], 'API reading')

        patched = self.patch_json('/curriculum_api/curriculum/components/COMP-API-1/', {
            'title': 'API reading updated',
            'points': 7,
        })
        self.assertEqual(patched.status_code, 200, patched.content)
        component = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-API-1')
        self.assertEqual(component['title'], 'API reading updated')
        self.assertEqual(component['points'], 7)

        deleted = self.client.delete('/curriculum_api/curriculum/components/COMP-API-1/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        component = self.row(views.AUTHORING_COMPONENTS_TABLE, 'id', 'COMP-API-1')
        self.assertTrue(views.row_has_deleted_at(component))

    def test_group_read_path_reports_tutor_assigned_through_modules(self):
        """A tutor assigned to a group must be readable back from the group payload.

        groups.tutor_name was dropped in migration 0023, so the group PATCH fans the
        tutor out to the group's module rows. The group read path must recover it
        from there instead of always reporting 'Unassigned'.
        """
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'tutor': 'Tutor Two'})

        detail = next(
            item for item in views.group_authoring_detail_rows()
            if item['id'] == 'GROUP-DATA-1'
        )
        self.assertEqual(detail['tutor'], 'Tutor Two')

        _cohorts, groups = views.build_cohorts_and_groups()
        group = next(item for item in groups if item['id'] == 'GROUP-DATA-1')
        self.assertEqual(group['tutor'], 'Tutor Two')

    def test_group_reports_tutor_from_wizard_payload(self):
        """The tree payload assigns 'Tutor One' to the group, so the read path
        must report that name rather than the old hardcoded 'Unassigned'."""
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

        detail = next(
            item for item in views.group_authoring_detail_rows()
            if item['id'] == 'GROUP-DATA-1'
        )
        self.assertEqual(detail['tutor'], 'Tutor One')

    def test_group_without_tutor_reports_unassigned(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {'tutor': ''})

        detail = next(
            item for item in views.group_authoring_detail_rows()
            if item['id'] == 'GROUP-DATA-1'
        )
        self.assertEqual(detail['tutor'], 'Unassigned')

    def test_group_staff_assignments_accept_email_identifiers_and_store_canonical_names(self):
        self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())

        coach = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Two',
            'email': 'coach.two@example.com',
        })
        tutor = self.post_json('/curriculum_api/curriculum/tutors/', {
            'name': 'Tutor Two',
            'email': 'tutor.two@example.com',
        })
        self.assertEqual(coach.status_code, 201, coach.content)
        self.assertEqual(tutor.status_code, 201, tutor.content)

        response = self.patch_json('/curriculum_api/curriculum/groups/GROUP-DATA-1/', {
            'coach': 'coach.two@example.com',
            'tutor': 'tutor.two@example.com',
        })
        self.assertEqual(response.status_code, 200, response.content)

        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        coach_row = views.find_staff_profile_row('coach', 'coach.two@example.com')
        tutor_row = views.find_staff_profile_row('tutor', 'tutor.two@example.com')

        self.assertEqual(group['coach_name'], 'Coach Two')
        # Tutor ownership moved from curriculum.groups to curriculum.modules
        # in migration 0023, which dropped groups.tutor_name.
        self.assertEqual(module['tutor_name'], 'Tutor Two')
        self.assertEqual(module['group_id'], 'GROUP-DATA-1')
        self.assertIn('GROUP-DATA-1', views.as_json_value(coach_row.get('assigned_group_ids'), []))
        self.assertIn('MOD-DATA-1', views.as_json_value(tutor_row.get('assigned_module_ids'), []))

    def test_create_coach_profile_is_idempotent_for_duplicate_email(self):
        first = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Primary',
            'email': 'coach.duplicate@example.com',
            'phone': '07123456789',
        })
        self.assertEqual(first.status_code, 201, first.content)

        second = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Alias',
            'email': 'coach.duplicate@example.com',
            'phone': '07999999999',
        })
        self.assertEqual(second.status_code, 200, second.content)
        self.assertFalse(second.json()['created'])
        self.assertTrue(second.json()['duplicate'])

        matching = views.staff_profile_rows_by_identity('coach', 'Coach Alias', 'coach.duplicate@example.com', include_archived=True)
        self.assertEqual(len(matching), 1)
        self.assertFalse(views.staff_profile_is_archived(matching[0]))
        self.assertEqual(views.staff_profile_name(matching[0]), 'Coach Primary')

    def test_create_coach_profile_allows_same_name_with_different_email_and_overview_keeps_both(self):
        first = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Same Name',
            'email': 'coach.same.one@example.com',
        })
        second = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Same Name',
            'email': 'coach.same.two@example.com',
        })
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)

        overview = views.build_curriculum_payload('all')
        matches = [item for item in overview['coaches'] if item['name'] == 'Coach Same Name']
        self.assertEqual(len(matches), 2)
        self.assertEqual(
            sorted(item['email'] for item in matches),
            ['coach.same.one@example.com', 'coach.same.two@example.com'],
        )

    def test_create_coach_profile_restores_archived_duplicate_in_place(self):
        created = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Restore',
            'email': 'coach.restore@example.com',
        })
        self.assertEqual(created.status_code, 201, created.content)
        created_id = created.json()['profile']['id']

        deleted = self.client.delete(f'/curriculum_api/curriculum/coaches/{created_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)

        restored = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Restore Updated',
            'email': 'coach.restore@example.com',
            'phone': '07999999999',
        })
        self.assertEqual(restored.status_code, 200, restored.content)
        self.assertFalse(restored.json()['created'])
        self.assertTrue(restored.json()['restored'])
        self.assertEqual(restored.json()['profile']['id'], created_id)
        self.assertEqual(restored.json()['profile']['name'], 'Coach Restore Updated')
        self.assertEqual(restored.json()['profile']['phone'], '07999999999')

        matching = views.staff_profile_rows_by_identity('coach', 'Coach Restore Updated', 'coach.restore@example.com', include_archived=True)
        self.assertEqual(len(matching), 1)
        self.assertFalse(views.staff_profile_is_archived(matching[0]))

    def test_delete_coach_archives_all_duplicate_rows_for_same_email(self):
        created = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Archive All',
            'email': 'coach.archive@example.com',
        })
        self.assertEqual(created.status_code, 201, created.content)
        created_id = created.json()['profile']['id']

        views.insert_row('coaches', views.staff_profile_payload('coach', {
            'id': 'COACH-DUP-ARCHIVE-2',
            'name': 'Coach Archive Alias',
            'email': 'coach.archive@example.com',
            'phone': '07000000000',
        }))

        deleted = self.client.delete(f'/curriculum_api/curriculum/coaches/{created_id}/')
        self.assertEqual(deleted.status_code, 200, deleted.content)
        self.assertEqual(deleted.json()['count'], 2)

        matching = views.staff_profile_rows_by_identity('coach', 'Coach Archive All', 'coach.archive@example.com', include_archived=True)
        self.assertEqual(len(matching), 2)
        self.assertTrue(all(views.staff_profile_is_archived(row) for row in matching))

    def test_patch_coach_profile_rejects_email_change_to_existing_email(self):
        first = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Rename One',
            'email': 'coach.one@example.com',
        })
        second = self.post_json('/curriculum_api/curriculum/coaches/', {
            'name': 'Coach Rename Two',
            'email': 'coach.two@example.com',
        })
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(second.status_code, 201, second.content)

        response = self.patch_json(
            f'/curriculum_api/curriculum/coaches/{second.json()["profile"]["id"]}/',
            {'email': 'coach.one@example.com'},
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertIn('already exists', response.json()['error'])


class CurriculumCacheTests(SimpleTestCase):
    """Guards the authoring cache's correctness properties.

    The cache has a process-local L1 and a Django-cache L2, so the risky failure
    modes are about invalidation: a stale entry surviving a write, or a failed
    build being memoised.
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


class CurriculumPayloadPerformanceTests(SimpleTestCase):
    def test_compact_payload_does_not_build_session_details(self):
        rows = {
            'training': [],
            'modules': [],
            'authoring_modules': [],
            'ksb_profiles': [],
            'program_configs': [],
            'holidays': [],
            'tutors': [],
            'coaches': [],
            'tutor_modules': [],
        }
        with patch.object(views, 'build_sessions', side_effect=AssertionError('must stay lazy')), \
             patch.object(views, 'build_sessions_from_authoring_modules', side_effect=AssertionError('must stay lazy')), \
             patch.object(views, 'build_programmes', return_value=[]), \
             patch.object(views, 'build_cohorts_and_groups', return_value=([], [])), \
             patch.object(views, 'build_ksb_data', return_value=([], [])):
            payload = views.build_curriculum_payload_from_rows(rows, compact=True)
        self.assertEqual(payload['sessions'], [])

    def test_pagination_is_opt_in_and_reports_total_count(self):
        request = RequestFactory().get('/curriculum/modules/', {'page': 2, 'page_size': 2})
        results, metadata = views.paginate_curriculum_results(request, ['a', 'b', 'c', 'd', 'e'])
        self.assertEqual(results, ['c', 'd'])
        self.assertEqual(metadata, {
            'count': 5,
            'page': 2,
            'pageSize': 2,
            'pages': 3,
            'hasNext': True,
            'hasPrevious': True,
        })

    def test_pagination_caps_untrusted_page_size(self):
        request = RequestFactory().get('/curriculum/components/', {'page_size': 100000})
        results, metadata = views.paginate_curriculum_results(request, list(range(300)))
        self.assertEqual(len(results), 250)
        self.assertEqual(metadata['pageSize'], 250)


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


class StaffProfileSchemaRepairTests(TestCase):
    def setUp(self):
        views._STAFF_PROFILE_TABLES_READY = False
        views._TABLE_COLUMNS_CACHE.clear()
        views.invalidate_curriculum_cache()

    def test_ensure_staff_profile_tables_does_not_restore_removed_staff_columns(self):
        for table in ("coaches", "tutors"):
            with connection.cursor() as cursor:
                cursor.execute(f'drop table if exists {views.table_name(table)}')
                cursor.execute(
                    f'''
                    create table {views.table_name(table)} (
                        id varchar(128) primary key,
                        name varchar(255) not null,
                        email varchar(255) not null default ''
                    )
                    '''
                )

        views.ensure_staff_profile_tables()

        self.assertNotIn("status", views.column_names("coaches"))
        self.assertNotIn("status", views.column_names("tutors"))
        self.assertNotIn("specialisms", views.column_names("coaches"))
        self.assertNotIn("specialisms", views.column_names("tutors"))
        self.assertIn("assigned_group_ids", views.column_names("coaches"))
        self.assertIn("assigned_module_ids", views.column_names("tutors"))


class ProgrammeLearnerKsbProgressTests(TestCase):
    """The programme card's KSB bar reports learner achievement, not design mapping.

    ``ksbMapped``/``ksbTotal`` answer "how much of the standard does the design
    touch". ``learnerKsbProgressPercentage`` answers "how much have the learners
    actually evidenced". They are separate fields because they are separate
    questions, and the card must never silently substitute one for the other.
    """

    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        # Borrow the persistence suite's schema fixtures so the helper runs its
        # real query path instead of bailing out on a missing table — a test that
        # only exercises the except branch would pass no matter what the maths did.
        CurriculumPersistenceTests.ensure_programmes_table(self)
        CurriculumPersistenceTests.ensure_ksb_profiles_table(self)
        views.ensure_module_authoring_tables()

    PROGRESS_FIELDS = (
        'learnerKsbProgressPercentage',
        'learnerKsbConsumedWeight',
        'learnerKsbExpectedWeight',
        'learnerKsbLearnerCount',
        'learnerKsbCodesStarted',
        'learnerKsbCodesComplete',
        'learnerKsbCodesTotal',
    )

    def test_missing_programme_reports_zero_rather_than_raising(self):
        result = views.programme_learner_ksb_progress('PROG-DOES-NOT-EXIST', [])
        for field in self.PROGRESS_FIELDS:
            self.assertIn(field, result)
        self.assertEqual(result['learnerKsbProgressPercentage'], 0)
        self.assertEqual(result['learnerKsbLearnerCount'], 0)

    def test_result_always_carries_every_field_so_the_card_reads_one_shape(self):
        # A card that receives `undefined` for the percentage renders an empty
        # bar that is indistinguishable from real 0% progress, so the contract is
        # that the key is always present.
        result = views.programme_learner_ksb_progress('', None)
        self.assertEqual(set(self.PROGRESS_FIELDS) - set(result), set())

    def test_percentage_never_exceeds_one_hundred(self):
        # Guards the cap: an over-weighted activity must not push a programme
        # past 100%, which would make the bar overflow its track.
        result = views.programme_learner_ksb_progress('PROG-DOES-NOT-EXIST', [])
        self.assertLessEqual(result['learnerKsbProgressPercentage'], 100)
        self.assertGreaterEqual(result['learnerKsbProgressPercentage'], 0)


class ProgrammeConfigSelectionTests(SimpleTestCase):
    def test_display_config_prefers_latest_active_duplicate_when_timestamps_are_strings(self):
        old_archived = {
            'programme_id': 'PROG-OLD',
            'name': 'User Flow',
            'is_archived': True,
            'updated_at': '2026-08-17T16:19:19.470000+00:00',
        }
        latest_active = {
            'programme_id': 'PROG-NEW',
            'name': 'User Flow',
            'is_archived': False,
            'updated_at': '2026-08-17T16:42:41.350000+00:00',
        }

        selected = views.unique_program_configs_for_display([old_archived, latest_active])

        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]['programme_id'], 'PROG-NEW')
        self.assertEqual(
            views.preferred_program_config_by_name([old_archived, latest_active], 'User Flow')['programme_id'],
            'PROG-NEW',
        )

    def test_is_archived_false_is_the_programme_display_source_of_truth(self):
        config = {
            'programme_id': 'PROG-SHOW',
            'name': 'User Flow',
            'is_archived': False,
            'status': 'archived',
            'deleted_at': '2026-08-17T16:19:19.470000+00:00',
        }

        self.assertFalse(views.is_archived_program_config(config))
        self.assertEqual(views.programme_config_status(config), 'active')

    def test_build_programmes_returns_every_unarchived_programme_row(self):
        configs = [
            {
                'programme_id': 'PROG-FOUDA',
                'name': 'Fouda-Programme',
                'is_archived': False,
                'updated_at': '2026-08-17T15:42:32.000000+00:00',
            },
            {
                'programme_id': 'PROG-USER-FLOW',
                'name': 'User Flow',
                'is_archived': False,
                'updated_at': '2026-08-17T16:42:41.350000+00:00',
            },
        ]

        with patch('curriculum_api.views.free_programme_fetch_all', return_value=[]), \
             patch('curriculum_api.views.cohort_authoring_detail_rows', return_value=[]), \
             patch('curriculum_api.views.active_learner_programme_counts', return_value={}), \
             patch('curriculum_api.views.programme_component_ksb_mapping_count', return_value=0):
            programmes = views.build_programmes([], configs, [], include_config_only=False)

        self.assertEqual([programme['sourceId'] for programme in programmes], ['PROG-FOUDA', 'PROG-USER-FLOW'])
        self.assertEqual([programme['isArchived'] for programme in programmes], [False, False])

    def test_active_duplicate_names_are_not_collapsed_for_display(self):
        configs = [
            {'programme_id': 'PROG-A', 'name': 'User Flow', 'is_archived': False},
            {'programme_id': 'PROG-B', 'name': 'User Flow', 'is_archived': False},
        ]

        selected = views.unique_program_configs_for_display(configs)

        self.assertEqual([config['programme_id'] for config in selected], ['PROG-A', 'PROG-B'])


class ProgrammeIntegrityRegressionTests(TestCase):
    """Regression cover for the Curriculum programme integrity audit.

    Each test here pins a bug that allowed programme rows or their children to
    be corrupted: stale identity aliases, placeholder programme ids, global
    free-course deletes, and unguarded hard deletes.
    """

    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self.client = Client()
        self._create_programmes_table()
        views.ensure_module_authoring_tables()
        views.ensure_free_programme_tables()
        self._clear()

    def _create_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table} (
                    programme_id varchar(128) primary key,
                    name varchar(255),
                    level varchar(64),
                    color varchar(32),
                    description text,
                    is_archived boolean,
                    ksb_profile_source_id varchar(128),
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        tables = [
            views.FREE_PROGRAMME_COMPONENTS_TABLE,
            views.FREE_PROGRAMME_MODULES_TABLE,
            views.FREE_COURSES_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'programmes',
        ]
        with connection.cursor() as cursor:
            for table in tables:
                try:
                    cursor.execute(f'delete from {views.authoring_table_name(table)}')
                except Exception:
                    pass

    def _insert_programme(self, programme_id, name):
        views.insert_row('programmes', {
            'programme_id': programme_id,
            'name': name,
            'color': '#6941c6',
            'is_archived': False,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })

    def _programme_rows(self):
        return views.fetch_all(f'select * from {views.table_name("programmes")}')

    # ---------------- programme identity ----------------

    def test_identity_reads_the_real_programme_id_column(self):
        self.assertEqual(
            views.programme_config_identity({'programme_id': 'PROG-REAL'}),
            'PROG-REAL',
        )

    def test_identity_falls_back_to_legacy_aliases(self):
        self.assertEqual(views.programme_config_identity({'program_id': 'PROG-OLD'}), 'PROG-OLD')
        self.assertEqual(views.programme_config_identity({}), '')

    def test_existing_programme_is_updated_not_duplicated(self):
        self._insert_programme('PROG-KEEP', 'Keeper')

        result = views.ensure_programme_config_for_authoring('Keeper', 'PROG-KEEP')

        self.assertEqual(result['sourceId'], 'PROG-KEEP')
        rows = self._programme_rows()
        self.assertEqual(len(rows), 1, f'expected no duplicate row, got {rows}')

    def test_matching_by_id_survives_when_only_programme_id_is_set(self):
        # The original bug: matching read program_id/id only, so a row keyed on
        # programme_id never matched and a duplicate was inserted instead.
        self._insert_programme('PROG-ALIAS', 'Alias Programme')

        views.ensure_programme_config_for_authoring('Renamed Alias', 'PROG-ALIAS')

        rows = self._programme_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(views.clean_str(rows[0].get('name')), 'Renamed Alias')

    # ---------------- placeholder ids ----------------

    def test_placeholder_programme_ids_are_recognised(self):
        for value in ('programme-local', 'PROGRAMME-LOCAL', 'local', 'undefined', '', 'local-MOD-1'):
            self.assertTrue(views.is_placeholder_programme_id(value), value)
        self.assertFalse(views.is_placeholder_programme_id('PROG-20260101000000000000'))

    def test_placeholder_id_never_becomes_a_persisted_programme(self):
        views.ensure_programme_config_for_authoring('Real Programme Name', 'programme-local')

        ids = [views.programme_config_identity(row) for row in self._programme_rows()]
        self.assertNotIn('programme-local', ids)
        for value in ids:
            self.assertTrue(value.startswith('PROG-'), f'unexpected programme id {value!r}')

    def test_placeholder_id_attaches_to_existing_programme_by_name(self):
        self._insert_programme('PROG-EXIST', 'Shared Name')

        result = views.ensure_programme_config_for_authoring('Shared Name', 'programme-local')

        self.assertEqual(result['sourceId'], 'PROG-EXIST')
        self.assertEqual(len(self._programme_rows()), 1)

    def test_programme_name_is_never_used_as_an_identifier(self):
        views.ensure_programme_config_for_authoring('Fouda-Programme', '')

        ids = [views.programme_config_identity(row) for row in self._programme_rows()]
        self.assertNotIn('Fouda-Programme', ids)
        self.assertTrue(all(value.startswith('PROG-') for value in ids), ids)

    # ---------------- free-course deletion scoping ----------------

    def _seed_free_course(self, programme_id, course_id, week_id):
        views.free_programme_upsert(views.FREE_COURSES_TABLE, ['id'], {
            'id': course_id,
            'course_name': f'Course {course_id}',
            'display_order': 1,
        })
        views.free_programme_upsert(views.FREE_PROGRAMME_MODULES_TABLE, ['id'], {
            'id': week_id,
            'course_id': course_id,
            'course_name': f'Course {course_id}',
            'week_number': 1,
            'display_order': 1,
        })
        views.free_programme_upsert(views.FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], {
            'id': f'COMP-{week_id}',
            'free_module_id': week_id,
            'programme_id': programme_id,
            'type': 'reading',
            'title': 'Component',
            'display_order': 1,
        })

    def _free_ids(self, table):
        return {
            views.clean_str(row.get('id'))
            for row in views.free_programme_fetch_all(table)
        }

    def test_deleting_one_programmes_free_courses_leaves_the_other_intact(self):
        self._insert_programme('PROG-AAA', 'Programme A')
        self._insert_programme('PROG-BBB', 'Programme B')
        self._seed_free_course('PROG-AAA', 'COURSE-A', 'WEEK-A')
        self._seed_free_course('PROG-BBB', 'COURSE-B', 'WEEK-B')

        views.delete_free_programme_data('PROG-AAA')

        self.assertNotIn('COURSE-A', self._free_ids(views.FREE_COURSES_TABLE))
        self.assertNotIn('WEEK-A', self._free_ids(views.FREE_PROGRAMME_MODULES_TABLE))
        # Programme B must be completely untouched.
        self.assertIn('COURSE-B', self._free_ids(views.FREE_COURSES_TABLE))
        self.assertIn('WEEK-B', self._free_ids(views.FREE_PROGRAMME_MODULES_TABLE))
        remaining = views.free_programme_fetch_all(views.FREE_PROGRAMME_COMPONENTS_TABLE)
        self.assertEqual(
            {views.clean_str(row.get('programme_id')) for row in remaining},
            {'PROG-BBB'},
        )

    def test_free_course_delete_without_a_programme_id_deletes_nothing(self):
        self._insert_programme('PROG-AAA', 'Programme A')
        self._seed_free_course('PROG-AAA', 'COURSE-A', 'WEEK-A')

        weeks, courses = views.delete_free_programme_data('')

        self.assertEqual((weeks, courses), (set(), set()))
        self.assertIn('COURSE-A', self._free_ids(views.FREE_COURSES_TABLE))
        self.assertIn('WEEK-A', self._free_ids(views.FREE_PROGRAMME_MODULES_TABLE))

    def test_no_unconditional_delete_predicates_remain_in_curriculum_views(self):
        import inspect
        source = inspect.getsource(views)
        self.assertNotIn("free_programme_delete(FREE_PROGRAMME_MODULES_TABLE, '1 = 1')", source)
        self.assertNotIn("free_programme_delete(FREE_COURSES_TABLE, '1 = 1')", source)

    # ---------------- delete / archive safety ----------------

    def _seed_cohort(self, programme_id, cohort_id):
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], {
            'cohort_id': cohort_id,
            'cohort_name': 'Cohort',
            'programme_id': programme_id,
            'programme_name': 'Programme A',
        })

    def test_programme_with_dependents_is_archived_not_deleted(self):
        self._insert_programme('PROG-DEP', 'Programme A')
        self._seed_cohort('PROG-DEP', 'COHORT-DEP')

        response = self.client.delete('/curriculum_api/curriculum/programmes/PROG-DEP/')

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertTrue(body.get('archived'))
        self.assertFalse(body.get('permanent'))
        # The programme row and its cohort must both survive.
        rows = self._programme_rows()
        self.assertEqual(len(rows), 1)
        self.assertTrue(views.truthy(rows[0].get('is_archived')))
        cohorts = views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE)
        self.assertEqual(len(cohorts), 1)

    def test_dependency_counts_report_children(self):
        self._insert_programme('PROG-DEP2', 'Programme A')
        self._seed_cohort('PROG-DEP2', 'COHORT-X')

        counts = views.programme_dependency_counts('PROG-DEP2', {'programme_id': 'PROG-DEP2'})

        self.assertEqual(counts.get(views.COHORT_AUTHORING_DETAILS_TABLE), 1)

    def test_unknown_programme_delete_returns_404(self):
        response = self.client.delete('/curriculum_api/curriculum/programmes/PROG-DOES-NOT-EXIST/')
        self.assertEqual(response.status_code, 404)

    # ---------------- archive visibility ----------------

    def test_is_archived_is_the_single_archive_signal(self):
        self.assertTrue(views.is_archived_program_config({'is_archived': True}))
        self.assertFalse(views.is_archived_program_config({'is_archived': False}))
        # A legacy is_active=false row is NOT treated as archived any more.
        self.assertFalse(views.is_archived_program_config({'is_active': False, 'is_archived': False}))
        self.assertEqual(views.programme_config_status({'is_active': False, 'is_archived': False}), 'active')

    # ---------------- module authoring ----------------

    def test_saving_a_module_without_a_programme_creates_no_junk_programme(self):
        self.assertIsNone(views.ensure_programme_config_for_authoring('Unassigned programme', 'programme-local'))
        self.assertEqual(self._programme_rows(), [])
