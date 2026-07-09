import json
from contextlib import nullcontext
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views


class CurriculumMutationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        views._CURRICULUM_CACHE.clear()
        views._CURRICULUM_CACHE['overview:operational'] = {'value': {'stale': True}, 'expires_at': 9999999999}

    def test_create_programme_invalidates_curriculum_cache(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'New Programme', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_create_programme_populates_required_sub_column(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'New Programme', 'standard': 'Standard Name', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['sub'], 'Standard Name')

    def test_create_programme_defaults_to_planned_status(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'New Programme', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme', 'status': 'planned'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['status'], 'planned')

    def test_create_programme_rejects_duplicate_name(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'Existing Programme'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'existing-programme', 'name': 'Existing Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'existing-programme', 'name': 'Existing Programme', 'status': 'active'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 409)
        self.assertIn('overview:operational', views._CURRICULUM_CACHE)

    def test_create_programme_allows_name_reuse_when_duplicate_is_archived(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'Archived Programme', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'archived-programme', 'name': 'Archived Programme', 'status': 'archived', 'is_archived': True}]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'archived-programme-2', 'name': 'Archived Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'archived-programme-2', 'name': 'Archived Programme', 'status': 'active'}):
            response = views.curriculum_programme_collection(request)

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(payload['created'])
        self.assertEqual(insert_row.call_args.args[1]['program_id'], 'archived-programme-2')

    def test_create_programme_allows_name_reuse_when_existing_programme_view_is_archived(self):
        request = self.factory.post(
            '/api/curriculum/programmes/',
            data=json.dumps({'name': 'Archived Programme'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'archived-programme', 'name': 'Archived Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'archived-programme', 'name': 'Archived Programme', 'status': 'archived'}), \
             patch.object(views, 'insert_row', return_value={'program_id': 'archived-programme-2', 'name': 'Archived Programme'}) as insert_row:
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['program_id'], 'archived-programme-2')

    def test_update_programme_accepts_full_editable_detail_payload(self):
        request = self.factory.patch(
            '/api/curriculum/programmes/apm/',
            data=json.dumps({
                'name': 'APM Level 4',
                'standard': 'Associate Project Manager',
                'level': 'L4',
                'status': 'draft',
                'owner': 'Curriculum Team',
                'color': '#7657d8',
                'description': 'Updated programme intent.',
            }),
            content_type='application/json',
        )

        with patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM'}), \
             patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM'}, [{'id': 1}])), \
             patch.object(views, 'has_column', return_value=True), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'apm', 'name': 'APM Level 4'}):
            response = views.curriculum_programme_detail(request, 'apm')

        self.assertEqual(response.status_code, 200)
        programme_update = next(call.args[3] for call in update_rows.call_args_list if 'name' in call.args[3])
        self.assertEqual(programme_update['name'], 'APM Level 4')
        self.assertEqual(programme_update['sub'], 'Associate Project Manager')
        self.assertEqual(programme_update['level'], 'L4')
        self.assertEqual(programme_update['status'], 'draft')
        self.assertEqual(programme_update['owner'], 'Curriculum Team')

    def test_delete_programme_archives_config_and_training_rows(self):
        request = self.factory.delete('/api/curriculum/programmes/apm/')

        with patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM'}, [{'id': 1}])), \
             patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM'}), \
             patch.object(views, 'archive_training_rows') as archive_training_rows, \
             patch.object(views, 'has_column', return_value=True), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows:
            response = views.curriculum_programme_detail(request, 'apm')

        self.assertEqual(response.status_code, 200)
        archive_training_rows.assert_called_once()
        config_update = update_rows.call_args.args[3]
        self.assertEqual(config_update['status'], 'archived')
        self.assertFalse(config_update['is_active'])
        self.assertTrue(config_update['is_archived'])

    def test_permanent_delete_programme_requires_archived_record(self):
        request = self.factory.delete('/api/curriculum/programmes/apm/?permanent=true')

        with patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM', 'status': 'active'}, [{'id': 1, 'is_archived': False}])), \
             patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM', 'status': 'active'}), \
             patch.object(views, 'delete_rows') as delete_rows:
            response = views.curriculum_programme_detail(request, 'apm')

        self.assertEqual(response.status_code, 409)
        delete_rows.assert_not_called()
        self.assertIn('overview:operational', views._CURRICULUM_CACHE)

    def test_permanent_delete_programme_removes_archived_config_and_training_rows(self):
        request = self.factory.delete('/api/curriculum/programmes/apm/?permanent=true')

        with patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM', 'status': 'archived'}, [{'id': 1, 'is_archived': True}])), \
             patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM', 'status': 'archived', 'is_archived': True}), \
             patch.object(views, 'has_column', return_value=True), \
             patch.object(views, 'delete_rows', return_value=[]) as delete_rows:
            response = views.curriculum_programme_detail(request, 'apm')

        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload['deleted'])
        self.assertTrue(payload['permanent'])
        deleted_tables = [call.args[0] for call in delete_rows.call_args_list]
        self.assertIn('Training_plan', deleted_tables)
        self.assertIn('training_plan_program_configs', deleted_tables)
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_generated_session_delete_is_rejected_without_archiving_parent(self):
        request = self.factory.delete('/api/curriculum/sessions/training-1-session-2/')

        with patch.object(views, 'fetch_all', return_value=[{'id': 1}]):
            response = views.curriculum_session_detail(request, 'training-1-session-2')

        self.assertEqual(response.status_code, 409)
        self.assertIn('overview:operational', views._CURRICULUM_CACHE)

    def test_group_module_attachment_is_scoped_and_invalidates_cache(self):
        request = self.factory.patch(
            '/api/curriculum/groups/group-1/modules/',
            data=json.dumps({'modules': [{'moduleName': 'Live Module', 'startDate': '2026-09-01'}]}),
            content_type='application/json',
        )

        with patch.object(
            views,
            'find_group_with_parent',
            return_value=(
                {'id': 'group-1', 'name': 'Group 1', 'programme': 'Programme', 'coach': 'Coach', 'tutor': 'Tutor'},
                {'id': 'cohort-1', 'name': 'Cohort 1', 'programme': 'Programme', 'startDate': '2026-09-01', 'endDate': '2027-09-01'},
                [],
            ),
        ), patch.object(views, 'insert_row', return_value={'id': 100, 'module_name': 'Live Module'}):
            response = views.curriculum_group_modules(request, 'group-1')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_preview_cohort_end_date_uses_curriculum_month_rule(self):
        request = self.factory.post(
            '/api/curriculum/preview/cohort-end-date/',
            data=json.dumps({'startDate': '2026-09-01', 'durationMonths': 24}),
            content_type='application/json',
        )

        response = views.curriculum_preview_cohort_end_date(request)
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['endDate'], '2028-08-31')
        self.assertTrue(payload['autoCalculated'])

    def test_preview_module_session_plan_skips_selected_holidays(self):
        request = self.factory.post(
            '/api/curriculum/preview/module-session-plan/',
            data=json.dumps({
                'startDate': '2026-09-07',
                'numberOfSessions': 3,
                'deliveryDays': ['Monday'],
                'holidays': [{'startDate': '2026-09-14', 'endDate': '2026-09-14'}],
            }),
            content_type='application/json',
        )

        response = views.curriculum_preview_module_session_plan(request)
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload['finalEndDate'], '2026-09-28')
        self.assertEqual(payload['skippedHolidays'], ['2026-09-14'])
        self.assertEqual([item['date'] for item in payload['sessions']], ['2026-09-07', '2026-09-21', '2026-09-28'])

    def test_create_cohort_persists_selected_holiday_ids_in_notes(self):
        request = self.factory.post(
            '/api/curriculum/cohorts/',
            data=json.dumps({
                'name': 'September 2026',
                'programme': 'Programme',
                'startDate': '2026-09-01',
                'durationMonths': 12,
                'holidayIds': [1, '2', '3'],
            }),
            content_type='application/json',
        )

        with patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'id': 1, 'Cohort_name': 'September 2026'}) as insert_row:
            response = views.curriculum_cohort_collection(request)

        self.assertEqual(response.status_code, 201)
        notes = insert_row.call_args.args[1]['notes']
        self.assertIn('__holiday_ids: 1|2|3', notes)

    def test_build_cohorts_exposes_selected_holiday_ids_from_notes(self):
        cohorts, _groups = views.build_cohorts_and_groups([
            {
                'Program': 'Programme',
                'Cohort_name': 'September 2026',
                'Starting_date_lable': '2026-09-01',
                'start_date': '2026-09-01',
                'end_date': '2027-08-31',
                'module_name': 'Module',
                'sessions_number': 1,
                'is_archived': False,
                '_meta': {
                    'cohort_id': 'programme-september-2026',
                    'holiday_ids': '1|2|3',
                },
            },
        ], [])

        self.assertEqual(cohorts[0]['holidayIds'], ['1', '2', '3'])

    def test_group_modules_get_is_scoped_to_group(self):
        payload = {
            'schema': views.CURRICULUM_SCHEMA,
            'groups': [
                {'id': 'group-a', 'name': 'A', 'modules': ['Module A']},
                {'id': 'group-b', 'name': 'B', 'modules': ['Module B']},
            ],
            'modules': [
                {'id': 'module-a', 'name': 'Module A', 'group': 'A'},
                {'id': 'module-b', 'name': 'Module B', 'group': 'B'},
            ],
        }

        with patch.object(views, 'get_cached_payload', return_value=payload):
            response = views.curriculum_group_modules(self.factory.get('/api/curriculum/groups/group-a/modules/'), 'group-a')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['count'], 1)
        self.assertEqual(body['results'][0]['id'], 'module-a')

    def test_programme_detail_returns_nested_structure(self):
        payload = {
            'schema': views.CURRICULUM_SCHEMA,
            'programmes': [{'id': 'program-apm', 'sourceId': 'apm', 'name': 'APM'}],
            'cohorts': [{'id': 'apm-cohort-1', 'name': 'Cohort 1', 'programme': 'APM', 'programmeId': 'program-apm'}],
            'groups': [{'id': 'group-1', 'name': 'Group 1', 'cohortId': 'apm-cohort-1', 'modules': ['Module 1']}],
            'modules': [{'id': 'module-1', 'name': 'Module 1', 'programme': 'APM', 'group': 'Group 1'}],
            'sessions': [{'id': 'session-1', 'programme': 'APM', 'module': 'Module 1'}],
        }

        with patch.object(views, 'get_cached_payload', return_value=payload):
            response = views.curriculum_programme_tree_detail(self.factory.get('/api/curriculum/programmes/apm/detail/'), 'apm')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['programme']['name'], 'APM')
        self.assertEqual(body['cohorts'][0]['groups'][0]['modules'][0]['id'], 'module-1')

    def test_cohort_and_group_collection_filters_are_parent_scoped(self):
        payload = {
            'schema': views.CURRICULUM_SCHEMA,
            'cohorts': [
                {'id': 'programme-a-cohort-1', 'name': 'Cohort 1', 'programme': 'Programme A', 'programmeId': 'program-programme-a'},
                {'id': 'programme-b-cohort-1', 'name': 'Cohort 1', 'programme': 'Programme B', 'programmeId': 'program-programme-b'},
            ],
            'groups': [
                {'id': 'group-1', 'name': 'Group 1', 'cohortId': 'programme-a-cohort-1', 'cohort': 'Cohort 1'},
                {'id': 'group-2', 'name': 'Group 2', 'cohortId': 'programme-b-cohort-1', 'cohort': 'Cohort 1'},
            ],
        }

        with patch.object(views, 'get_cached_payload', return_value=payload):
            cohort_response = views.curriculum_cohorts(self.factory.get('/api/curriculum/cohorts/?programme_id=program-programme-a'))
            group_response = views.curriculum_groups(self.factory.get('/api/curriculum/groups/?cohort_id=programme-a-cohort-1'))

        self.assertEqual(json.loads(cohort_response.content)['count'], 1)
        self.assertEqual(json.loads(cohort_response.content)['results'][0]['id'], 'programme-a-cohort-1')
        self.assertEqual(json.loads(group_response.content)['count'], 1)
        self.assertEqual(json.loads(group_response.content)['results'][0]['id'], 'group-1')

    def test_staff_lists_are_built_from_training_plan_assignment_columns(self):
        rows = [
            {'Tutor_name': 'Samar', 'coach_name': 'Ayman'},
            {'Tutor_name': 'Samar', 'coach_name': 'Unassigned'},
            {'Tutor_name': '', 'coach_name': 'Keith'},
        ]

        tutors = views.build_staff_profiles_from_training(rows, 'Tutor_name', 'tutor')
        coaches = views.build_staff_profiles_from_training(rows, 'coach_name', 'coach')

        self.assertEqual([item['name'] for item in tutors], ['Samar'])
        self.assertEqual([item['name'] for item in coaches], ['Ayman', 'Keith'])

    def test_module_authoring_quality_check_requires_scoped_completion_and_mappings(self):
        payload = {
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'live-session',
                            'expectedOtjh': 1.5,
                            'settings': {'recordingExpected': True},
                            'ksbMappings': [{'code': 'K1', 'type': 'main'}],
                        }
                    ],
                }
            ],
            'completionCriteria': {'quizzesCompletedRequired': True},
            'moduleKsbMappings': [{'code': 'K1', 'type': 'main'}],
        }

        checklist, score = views.module_authoring_quality_check(payload)

        self.assertEqual(score, 100)
        self.assertTrue(all(item['passed'] for item in checklist))

    def test_module_structure_patch_uses_scoped_authoring_save(self):
        request = self.factory.patch(
            '/api/curriculum/modules/MOD-1/structure/',
            data=json.dumps({'catalogueId': 'MOD-1', 'title': 'Scoped Module', 'weekStructure': []}),
            content_type='application/json',
        )

        with patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-1', 'title': 'Scoped Module'}) as save_structure, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_module_structure(request, 'MOD-1')

        self.assertEqual(response.status_code, 200)
        save_structure.assert_called_once()
        self.assertEqual(save_structure.call_args.args[0], 'MOD-1')
        insert_row.assert_not_called()

    def test_module_structure_get_returns_404_when_no_authoring_structure_exists(self):
        request = self.factory.get('/api/curriculum/modules/MOD-1/structure/')

        with patch.object(views, 'get_authoring_structure_payload', return_value=None):
            response = views.curriculum_module_structure(request, 'MOD-1')

        self.assertEqual(response.status_code, 404)

    def test_module_create_with_title_uses_authoring_module_not_training_plan(self):
        request = self.factory.post(
            '/api/curriculum/modules/',
            data=json.dumps({'title': 'New Authoring Module', 'programme': 'Programme A', 'weekStructure': []}),
            content_type='application/json',
        )

        with patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-NEW', 'title': 'New Authoring Module'}) as save_structure, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_module_collection(request)

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(body['created'])
        save_structure.assert_called_once()
        insert_row.assert_not_called()

    def test_module_create_with_explicit_authoring_type_does_not_depend_on_title_name_split(self):
        request = self.factory.post(
            '/api/curriculum/modules/',
            data=json.dumps({'moduleType': 'authoring', 'title': 'Authoring title', 'name': 'Legacy name', 'programme': 'Programme A'}),
            content_type='application/json',
        )

        with patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-NEW', 'title': 'Authoring title'}) as save_structure, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_module_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(save_structure.call_args.args[1]['title'], 'Authoring title')
        insert_row.assert_not_called()

    def test_training_module_structure_get_uses_ensure_import_flow(self):
        request = self.factory.get('/api/curriculum/modules/training-module-7/structure/')

        with patch.object(views, 'ensure_training_module_authoring_structure', return_value={'catalogueId': 'training-module-7', 'title': 'Imported'}) as ensure_import:
            response = views.curriculum_module_structure(request, 'training-module-7')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['catalogueId'], 'training-module-7')
        ensure_import.assert_called_once_with('training-module-7')

    def test_training_module_ensure_reuses_existing_source_authoring(self):
        with patch.object(views, 'training_row_by_id', return_value={'id': 7, 'module_name': 'Old Module', 'notes': '', '_meta': {}}), \
             patch.object(views, 'authoring_row_for_training_source', return_value={'module_catalogue_id': 'training-module-7'}), \
             patch.object(views, 'get_authoring_structure_payload', return_value={'catalogueId': 'training-module-7', 'title': 'Imported'}) as load_structure, \
             patch.object(views, 'save_module_authoring_structure') as save_structure:
            result = views.ensure_training_module_authoring_structure('training-module-7')

        self.assertEqual(result['catalogueId'], 'training-module-7')
        load_structure.assert_called_once_with('training-module-7')
        save_structure.assert_not_called()

    def test_authoring_only_module_delete_does_not_query_modules_table(self):
        request = self.factory.delete('/api/curriculum/modules/MOD-NEW/')

        with patch.object(views, 'authoring_module_exists', return_value={'module_catalogue_id': 'MOD-NEW'}), \
             patch.object(views, 'delete_module_authoring_structure', return_value=True) as delete_authoring, \
             patch.object(views, 'fetch_all') as fetch_all:
            response = views.curriculum_module_detail(request, 'MOD-NEW')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body['deleted'])
        self.assertTrue(body['deletedAuthoring'])
        delete_authoring.assert_called_once_with('MOD-NEW')
        fetch_all.assert_not_called()

    def test_training_module_delete_archives_delivery_without_deleting_authoring(self):
        request = self.factory.delete('/api/curriculum/modules/training-module-7/')

        with patch.object(views, 'fetch_all', return_value=[{'id': 7, 'notes': ''}]), \
             patch.object(views, 'archive_training_rows') as archive_training, \
             patch.object(views, 'delete_module_authoring_structure') as delete_authoring:
            response = views.curriculum_module_detail(request, 'training-module-7')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body['archived'])
        self.assertTrue(body['preservedAuthoring'])
        archive_training.assert_called_once()
        delete_authoring.assert_not_called()

    def test_module_collection_uses_authoring_summaries_without_full_structure_load(self):
        modules = [{'id': 'module-MOD-1', 'catalogueId': 'MOD-1', 'name': 'Old title', 'programme': 'Old programme'}]
        summaries = {
            'MOD-1': {
                'catalogueId': 'MOD-1',
                'title': 'Authoring title',
                'programmeName': 'Programme A',
                'description': 'Short description',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'sessionsNumber': 2,
                'startDate': '2026-07-05',
                'endDate': '2026-07-12',
                'qualityScore': 70,
                'lastUpdated': '2026-07-05',
                'weeks': 2,
                'ksbCount': 3,
                'lessonCount': 5,
                'quizCount': 1,
                'sessionNames': ['Live session'],
                'ksbCodes': ['K1', 'S1', 'B1'],
            }
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries), \
             patch.object(views, 'get_authoring_structure_payload') as load_structure:
            enriched = views.enrich_modules_with_authoring(modules)

        self.assertEqual(enriched[0]['name'], 'Authoring title')
        self.assertEqual(enriched[0]['weeks'], 2)
        self.assertEqual(enriched[0]['lessons'], 5)
        load_structure.assert_not_called()

    def test_module_collection_dedupes_imported_training_authoring_summary(self):
        modules = [{
            'id': 'training-module-7',
            'sourceId': 7,
            'sourceType': 'training_plan',
            'catalogueId': '',
            'name': 'Old delivery title',
            'programme': 'Programme A',
            'deliveryStatus': 'completed',
        }]
        summaries = {
            'training-module-7': {
                'catalogueId': 'training-module-7',
                'title': 'Authoring title',
                'programmeName': 'Programme A',
                'description': 'Short description',
                'status': 'published',
                'sourceType': 'training_plan',
                'sourceId': '7',
                'sessionsNumber': 2,
                'startDate': '2026-06-01',
                'endDate': '2026-06-08',
                'qualityScore': 50,
                'lastUpdated': '2026-07-05',
                'weeks': 2,
                'ksbCount': 1,
                'lessonCount': 2,
                'quizCount': 0,
                'sessionNames': [],
                'ksbCodes': ['K1'],
            }
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_modules_with_authoring(modules)

        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0]['catalogueId'], 'training-module-7')
        self.assertEqual(enriched[0]['name'], 'Authoring title')
        self.assertEqual(enriched[0]['deliveryStatus'], 'completed')
        self.assertEqual(enriched[0]['status'], 'published')

    def test_training_plan_module_can_have_completed_delivery_status(self):
        modules = views.build_modules(
            [],
            [{
                'id': 7,
                'Program': 'Programme A',
                'module_name': 'Completed Module',
                'sessions_number': 1,
                'start_date': '2026-01-01',
                'end_date': '2026-01-08',
                'notes': '',
                '_meta': {},
            }],
            [],
        )

        self.assertEqual(modules[0]['status'], 'published')
        self.assertEqual(modules[0]['authoringStatus'], 'published')
        self.assertEqual(modules[0]['deliveryStatus'], 'completed')

    def test_component_collection_create_uses_authoring_component_store(self):
        request = self.factory.post(
            '/api/curriculum/components/',
            data=json.dumps({
                'title': 'New component',
                'type': 'Quiz',
                'module': 'Module A',
                'programme': 'Programme A',
                'week': 'Week 2',
                'duration': 30,
                'ksbRefs': ['K1'],
                'status': 'draft',
                'contentSections': 2,
            }),
            content_type='application/json',
        )

        with patch.object(views, 'save_component_builder_payload', return_value={'id': 'component-1', 'title': 'New component'}) as save_component, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_component_collection(request)

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 201)
        self.assertTrue(body['created'])
        save_component.assert_called_once()
        insert_row.assert_not_called()

    def test_component_detail_patch_updates_authoring_component(self):
        request = self.factory.patch(
            '/api/curriculum/components/component-1/',
            data=json.dumps({'title': 'Updated component'}),
            content_type='application/json',
        )

        with patch.object(views, 'authoring_fetch_all', return_value=[{'id': 'component-1'}]), \
             patch.object(views, 'component_builder_rows', return_value=[{'id': 'component-1', 'title': 'Old', 'module': 'Module A', 'week': 'Week 1'}]), \
             patch.object(views, 'save_component_builder_payload', return_value={'id': 'component-1', 'title': 'Updated component'}) as save_component:
            response = views.curriculum_component_detail(request, 'component-1')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body['updated'])
        self.assertEqual(save_component.call_args.args[1], 'component-1')

    def test_component_detail_delete_removes_component_without_archiving_delivery(self):
        request = self.factory.delete('/api/curriculum/components/component-1/')

        with patch.object(views, 'authoring_fetch_all', return_value=[{'id': 'component-1'}]), \
             patch.object(views, 'authoring_delete') as authoring_delete, \
             patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'archive_training_rows') as archive_training:
            response = views.curriculum_component_detail(request, 'component-1')

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body['deleted'])
        self.assertEqual(authoring_delete.call_count, 2)
        archive_training.assert_not_called()
