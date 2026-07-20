import json
import importlib
import tempfile
from io import StringIO
from contextlib import nullcontext
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import RequestFactory, SimpleTestCase

from . import views
from .ksb_coverage import build_coverage, coverage_status


class CurriculumMutationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        views._CURRICULUM_CACHE.clear()
        views._CURRICULUM_CACHE['overview:operational'] = {'value': {'stale': True}, 'expires_at': 9999999999}

    def test_create_programme_invalidates_curriculum_cache(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
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
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'New Programme', 'standard': 'Standard Name', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['sub'], 'Standard Name')

    def test_create_programme_persists_programme_details(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({
                'name': 'New Programme',
                'standard': 'Standard Name',
                'level': 'L4',
                'description': 'Programme description',
                'color': '#123456',
            }),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme'}):
            response = views.curriculum_programme_collection(request)

        payload = insert_row.call_args.args[1]
        self.assertEqual(response.status_code, 201)
        self.assertEqual(payload['standard'], 'Standard Name')
        self.assertEqual(payload['level'], 'L4')
        self.assertEqual(payload['description'], 'Programme description')

    def test_create_programme_defaults_to_planned_status(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'New Programme', 'color': '#123456'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'program_id': 'new-programme', 'name': 'New Programme'}) as insert_row, \
             patch.object(views, 'programme_response', return_value={'sourceId': 'new-programme', 'name': 'New Programme', 'status': 'planned'}):
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['status'], 'planned')

    def test_create_programme_reuses_duplicate_name(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'Existing Programme'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'existing-programme', 'name': 'Existing Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'existing-programme', 'name': 'Existing Programme', 'status': 'active'}), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_programme_collection(request)

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(body['created'])
        update_rows.assert_called_once()
        insert_row.assert_not_called()
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_create_programme_reuses_duplicate_name_even_with_new_explicit_id(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'Existing Programme', 'programId': 'new-explicit-id'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'existing-programme', 'name': 'Existing Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'existing-programme', 'name': 'Existing Programme', 'status': 'active'}), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_programme_collection(request)

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(body['created'])
        self.assertEqual(update_rows.call_args.args[2], ['existing-programme'])
        insert_row.assert_not_called()

    def test_create_programme_is_idempotent_for_existing_explicit_id(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'Existing Programme', 'programId': 'existing-programme'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'existing-programme', 'name': 'Existing Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'existing-programme', 'name': 'Existing Programme', 'status': 'active'}), \
             patch.object(views, 'update_rows', return_value=[]), \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_programme_collection(request)

        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(body['created'])
        insert_row.assert_not_called()

    def test_authoring_programme_config_reuses_existing_name_with_new_id(self):
        with patch.object(views, 'ensure_program_config_archive_columns'), \
             patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'PROG-EXISTING', 'name': 'Fouda-Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'PROG-EXISTING', 'name': 'Fouda-Programme'}), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows, \
             patch.object(views, 'insert_row') as insert_row:
            programme = views.ensure_programme_config_for_authoring('Fouda-Programme', 'PROG-NEW')

        self.assertEqual(programme['sourceId'], 'PROG-EXISTING')
        self.assertEqual(update_rows.call_args.args[2], ['PROG-EXISTING'])
        insert_row.assert_not_called()

    def test_duplicate_programme_configs_are_merged_by_name(self):
        views._PROGRAMME_CONFIG_DEDUP_READY = False
        configs = [
            {'id': 107, 'program_id': 'PROG-OLD', 'name': 'Fouda-Programme', 'updated_at': None},
            {'id': 108, 'program_id': 'PROG-NEW', 'name': 'Fouda-Programme', 'updated_at': None},
        ]

        with patch.object(views, 'get_program_config_rows_raw', return_value=configs), \
             patch.object(views, 'table_exists', return_value=True), \
             patch.object(views, 'has_column', side_effect=lambda _table, column: column in {'program_id', 'programme_id', 'programme_name'}), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows, \
             patch.object(views, 'delete_rows', return_value=[]) as delete_rows:
            views.merge_duplicate_program_configs_by_name()

        updated_reference = [
            call for call in update_rows.call_args_list
            if call.args[0] == views.AUTHORING_MODULES_TABLE and call.args[2] == ['PROG-OLD']
        ]
        self.assertTrue(updated_reference)
        self.assertEqual(updated_reference[0].args[3]['programme_id'], 'PROG-NEW')
        delete_rows.assert_called_once()

    def test_create_programme_allows_name_reuse_when_duplicate_is_archived(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/programmes/',
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
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'Archived Programme'}),
            content_type='application/json',
        )

        with patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'archived-programme', 'name': 'Archived Programme'}]), \
             patch.object(views, 'programme_response', return_value={'sourceId': 'archived-programme', 'name': 'Archived Programme', 'status': 'archived'}), \
             patch.object(views, 'insert_row', return_value={'program_id': 'archived-programme-2', 'name': 'Archived Programme'}) as insert_row:
            response = views.curriculum_programme_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(insert_row.call_args.args[1]['program_id'], 'archived-programme-2')

    def test_build_programmes_hides_duplicate_config_only_programme_when_delivery_exists(self):
        rows = [{
            'id': 1,
            'Program': 'Fouda-Programme',
            'module_name': 'Fouda-Module',
            'Cohort_name': 'Fouda-Cohort',
            'group_name': 'Fouda-Group',
            'sessions_number': 6,
            'is_archived': False,
            '_meta': {
                'program_id': 'PROG-DELIVERY',
                'cohort_id': 'COHORT-1',
                'group_id': 'GROUP-1',
            },
        }]
        configs = [
            {'id': 3, 'program_id': 'PROG-CONFIG-ONLY', 'name': 'Fouda-Programme', 'status': 'active', 'is_active': True},
            {'id': 2, 'program_id': 'PROG-DELIVERY', 'name': 'Fouda-Programme', 'status': 'active', 'is_active': True},
        ]

        programmes = views.build_programmes(rows, configs, [], include_config_only=True)

        self.assertEqual(len([item for item in programmes if item['name'] == 'Fouda-Programme']), 1)
        self.assertEqual(programmes[0]['sourceId'], 'PROG-DELIVERY')

    def test_update_programme_accepts_full_editable_detail_payload(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/programmes/apm/',
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

    def test_delete_programme_deletes_config_and_archives_delivery_rows(self):
        request = self.factory.delete('/curriculum_api/curriculum/programmes/apm/')

        with patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM'}, [{'id': 1}])), \
             patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM'}), \
             patch.object(views, 'archive_training_rows') as archive_training_rows, \
             patch.object(views, 'has_column', return_value=True), \
             patch.object(views, 'delete_rows', return_value=[]) as delete_rows:
            response = views.curriculum_programme_detail(request, 'apm')

        self.assertEqual(response.status_code, 200)
        archive_training_rows.assert_called_once()
        delete_rows.assert_called_once_with('programmes', '"program_id" = %s', ['apm'])

    def test_archive_training_rows_uses_curriculum_tables_without_training_plan(self):
        rows = [{
            'id': '61296',
            'notes': '__program_id: PROG-1\n__cohort_id: COHORT-1\n__group_id: GROUP-1\n__module_catalogue_id: MOD-1',
            '_meta': {
                'program_id': 'PROG-1',
                'cohort_id': 'COHORT-1',
                'group_id': 'GROUP-1',
                'module_catalogue_id': 'MOD-1',
            },
        }]

        def table_exists(table):
            return table != 'Training_plan'

        with patch.object(views, 'table_exists', side_effect=table_exists), \
             patch.object(views, 'filtered_payload', side_effect=lambda _table, payload: payload), \
             patch.object(views, 'update_rows', return_value=[]) as update_rows:
            archived = views.archive_training_rows(rows)

        self.assertEqual(archived, [])
        updated_tables = [call.args[0] for call in update_rows.call_args_list]
        self.assertEqual(updated_tables, ['modules', 'groups', 'cohorts'])
        self.assertEqual(update_rows.call_args_list[0].args[1], '"module_catalogue_id" in (%s)')
        self.assertEqual(update_rows.call_args_list[0].args[2], ['MOD-1'])
        self.assertEqual(update_rows.call_args_list[0].args[3]['status'], 'archived')

    def test_permanent_delete_programme_requires_archived_record(self):
        request = self.factory.delete('/curriculum_api/curriculum/programmes/apm/?permanent=true')

        with patch.object(views, 'rows_for_programme', return_value=({'sourceId': 'apm', 'name': 'APM', 'status': 'active'}, [{'id': 1, 'is_archived': False}])), \
             patch.object(views, 'programme_config_by_identifier', return_value={'program_id': 'apm', 'name': 'APM', 'status': 'active'}), \
             patch.object(views, 'delete_rows') as delete_rows:
            response = views.curriculum_programme_detail(request, 'apm')

        self.assertEqual(response.status_code, 409)
        delete_rows.assert_not_called()
        self.assertIn('overview:operational', views._CURRICULUM_CACHE)

    def test_permanent_delete_programme_removes_archived_config_and_training_rows(self):
        request = self.factory.delete('/curriculum_api/curriculum/programmes/apm/?permanent=true')

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
        self.assertIn('programmes', deleted_tables)
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_generated_session_delete_is_rejected_without_archiving_parent(self):
        request = self.factory.delete('/curriculum_api/curriculum/sessions/training-1-session-2/')

        with patch.object(views, 'fetch_all', return_value=[{'id': 1}]):
            response = views.curriculum_session_detail(request, 'training-1-session-2')

        self.assertEqual(response.status_code, 409)
        self.assertIn('overview:operational', views._CURRICULUM_CACHE)

    def test_group_module_attachment_is_scoped_and_invalidates_cache(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/groups/group-1/modules/',
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
        ), patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'has_column', return_value=False), \
             patch.object(views, 'insert_row', return_value={'id': 100, 'module_name': 'Live Module'}), \
             patch.object(views, 'ensure_canonical_module_for_training_row', return_value='MOD-LIVE'), \
             patch.object(views, 'link_training_row_to_catalogue', return_value=True):
            response = views.curriculum_group_modules(request, 'group-1')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(views._CURRICULUM_CACHE, {})

    def test_group_module_attachment_rejects_invalid_explicit_catalogue_id(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/groups/group-1/modules/',
            data=json.dumps({'modules': [{'moduleName': 'Live Module', 'moduleCatalogueId': '10'}]}),
            content_type='application/json',
        )

        with patch.object(
            views,
            'find_group_with_parent',
            return_value=(
                {'id': 'group-1', 'name': 'Group 1', 'programme': 'Programme'},
                {'id': 'cohort-1', 'name': 'Cohort 1', 'programme': 'Programme'},
                [],
            ),
        ), patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_group_modules(request, 'group-1')

        self.assertEqual(response.status_code, 400)
        insert_row.assert_not_called()

    def test_preview_cohort_end_date_uses_curriculum_month_rule(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/preview/cohort-end-date/',
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
            '/curriculum_api/curriculum/preview/module-session-plan/',
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
            '/curriculum_api/curriculum/cohorts/',
            data=json.dumps({
                'name': 'September 2026',
                'programme': 'Programme',
                'startDate': '2026-09-01',
                'durationMonths': 12,
                'holidayIds': [1, '2', '3'],
            }),
            content_type='application/json',
        )

        with patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'id': 1, 'Cohort_name': 'September 2026'}) as insert_row, \
             patch.object(views, 'authoring_upsert', return_value={}):
            response = views.curriculum_cohort_collection(request)

        self.assertEqual(response.status_code, 201)
        notes = insert_row.call_args.args[1]['notes']
        self.assertIn('__holiday_ids: 1|2|3', notes)

    def test_create_cohort_persists_authoring_detail_row(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/cohorts/',
            data=json.dumps({
                'name': 'September 2026',
                'programme': 'Programme',
                'programmeId': 'program-programme',
                'startDate': '2026-09-01',
                'durationMonths': 12,
                'holidayIds': [1, '2'],
                'holidays': [
                    {'id': 1, 'label': 'Bank holiday', 'start_date': '2026-12-25', 'end_date': '2026-12-25', 'type': 'bank', 'color': '#f59e0b'},
                    {'id': 2, 'label': 'New year', 'start_date': '2027-01-01', 'end_date': '2027-01-01', 'type': 'bank', 'color': '#f59e0b'},
                ],
            }),
            content_type='application/json',
        )

        with patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'id': 1, 'Cohort_name': 'September 2026'}), \
             patch.object(views, 'authoring_upsert', return_value={}) as authoring_upsert:
            response = views.curriculum_cohort_collection(request)

        self.assertEqual(response.status_code, 201)
        table, keys, payload = authoring_upsert.call_args.args
        self.assertEqual(table, views.COHORT_AUTHORING_DETAILS_TABLE)
        self.assertEqual(keys, ['cohort_id'])
        self.assertEqual(payload['cohort_name'], 'September 2026')
        self.assertEqual(payload['programme_id'], 'program-programme')
        self.assertEqual(payload['duration_months'], 12)
        self.assertEqual(json.loads(payload['holiday_ids']), ['1', '2'])
        self.assertEqual(json.loads(payload['holiday_summary'])['selected'], 2)

    def test_cohort_authoring_payload_includes_holidays_in_range(self):
        payload = views.cohort_authoring_payload(
            {
                'id': 'cohort-1',
                'name': 'Cohort 1',
                'programme': 'Programme',
                'programmeId': 'program-programme',
                'startDate': '2026-09-01',
                'endDate': '2027-08-31',
                'holidayIds': ['holiday-1'],
            },
            rows=[{'id': 10, 'module_name': 'Module 1', 'notes': '__duration_months: 12'}],
            groups=[{'id': 'group-1'}],
            holiday_rows=[
                {'id': 'holiday-1', 'label': 'Christmas', 'start_date': '2026-12-25', 'end_date': '2026-12-25', 'type': 'bank', 'color': '#f59e0b'},
                {'id': 'holiday-2', 'label': 'Out of range', 'start_date': '2028-01-01', 'end_date': '2028-01-01', 'type': 'bank', 'color': '#f59e0b'},
            ],
        )

        self.assertEqual(payload['duration_months'], 12)
        self.assertEqual(json.loads(payload['training_plan_ids']), ['10'])
        self.assertEqual(json.loads(payload['group_ids']), ['group-1'])
        self.assertEqual(json.loads(payload['module_names']), ['Module 1'])
        self.assertEqual(json.loads(payload['holiday_ids']), ['holiday-1'])
        self.assertEqual(json.loads(payload['selected_holidays'])[0]['label'], 'Christmas')
        self.assertEqual(json.loads(payload['holidays_in_range'])[0]['id'], 'holiday-1')

    def test_cohort_authoring_payload_uses_canonical_programme_id(self):
        payload = views.cohort_authoring_payload(
            {
                'id': 'cohort-1',
                'name': 'Cohort 1',
                'programme': 'Programme',
                'programmeId': 'program-prog-20260708145423972769',
                'startDate': '2026-09-01',
                'endDate': '2027-08-31',
            },
            rows=[],
            groups=[],
            holiday_rows=[],
        )

        self.assertEqual(payload['programme_id'], 'PROG-20260708145423972769')

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
            response = views.curriculum_group_modules(self.factory.get('/curriculum_api/curriculum/groups/group-a/modules/'), 'group-a')

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
            response = views.curriculum_programme_tree_detail(self.factory.get('/curriculum_api/curriculum/programmes/apm/detail/'), 'apm')

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
            cohort_response = views.curriculum_cohorts(self.factory.get('/curriculum_api/curriculum/cohorts/?programme_id=program-programme-a'))
            group_response = views.curriculum_groups(self.factory.get('/curriculum_api/curriculum/groups/?cohort_id=programme-a-cohort-1'))

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
                            'ksbMappings': [{'code': 'K1', 'type': 'main', 'weight': 40}],
                        }
                    ],
                }
            ],
            'completionCriteria': {'quizzesCompletedRequired': True},
            'moduleKsbMappings': [{'code': 'K1', 'type': 'main', 'weight': 40}],
        }

        checklist, score = views.module_authoring_quality_check(payload)

        self.assertEqual(score, 100)
        self.assertTrue(all(item['passed'] for item in checklist))

    def test_module_structure_patch_uses_scoped_authoring_save(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/modules/MOD-1/structure/',
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

    def test_module_structure_patch_returns_validation_errors(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/modules/MOD-1/structure/',
            data=json.dumps({
                'catalogueId': 'MOD-1',
                'title': 'Scoped Module',
                'weekStructure': [
                    {
                        'id': 'WEEK-1',
                        'title': 'Week 1',
                        'components': [
                            {
                                'id': 'COMP-1',
                                'type': 'video',
                                'title': 'Video',
                                'expectedOtjh': 1,
                                'points': 10,
                                'settings': {
                                    'sourceType': 'YouTube',
                                    'videoUrl': 'https://vimeo.com/123',
                                    'contentStatus': 'Ready for QA',
                                    'version': '1.0',
                                },
                            },
                        ],
                    },
                ],
            }),
            content_type='application/json',
        )

        response = views.curriculum_module_structure(request, 'MOD-1')
        body = json.loads(response.content)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(body['error'], 'Module authoring validation failed.')
        self.assertEqual(body['validationErrors'][0]['path'], 'weekStructure.0.components.0.settings.videoUrl')

    def test_module_authoring_validation_allows_valid_video_source(self):
        errors = views.validate_module_authoring_payload({
            'title': 'Scoped Module',
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'video',
                            'title': 'Video',
                            'expectedOtjh': 1,
                            'points': 10,
                            'settings': {
                                'sourceType': 'YouTube',
                                'videoUrl': 'https://www.youtube.com/watch?v=abc123',
                                'requiredProgressPercentage': 80,
                                'contentStatus': 'Ready for QA',
                                'version': '1.0',
                            },
                        },
                    ],
                },
            ],
        })

        self.assertEqual(errors, [])

    def test_module_authoring_validation_allows_recording_placeholder_url(self):
        errors = views.validate_module_authoring_payload({
            'title': 'Scoped Module',
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'recording-placeholder',
                            'title': 'Recorded session',
                            'expectedOtjh': 1,
                            'points': 10,
                            'settings': {
                                'source': 'External link',
                                'recordingUrl': 'https://teams.microsoft.com/l/meetup-join/recording',
                                'contentStatus': 'Ready for QA',
                                'version': '1.0',
                            },
                        },
                    ],
                },
            ],
        })

        self.assertEqual(errors, [])

    def test_module_authoring_validation_requires_recording_url_before_qa(self):
        errors = views.validate_module_authoring_payload({
            'title': 'Scoped Module',
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'recording-placeholder',
                            'title': 'Recorded session',
                            'expectedOtjh': 1,
                            'points': 10,
                            'settings': {
                                'source': 'External link',
                                'contentStatus': 'Ready for QA',
                                'version': '1.0',
                            },
                        },
                    ],
                },
            ],
        })

        self.assertEqual(errors[0]['path'], 'weekStructure.0.components.0.settings.recordingUrl')

    def test_module_authoring_validation_preserves_draft_shortcode_video_settings(self):
        payload = {
            'title': 'Legacy Module',
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'video',
                            'title': 'Legacy shortcode video',
                            'expectedOtjh': 1,
                            'points': 10,
                            'settings': {
                                'sourceType': 'Shortcode',
                                'provider': 'Shortcode',
                                'shortcode': '[legacy_video id="42"]',
                                'contentStatus': 'Draft',
                                'unknownString': 'keep me',
                                'unknownNumber': 0,
                                'unknownFalse': False,
                                'ignoredObject': {'skip': True},
                                'ignoredNull': None,
                            },
                        },
                    ],
                },
            ],
        }

        errors = views.validate_module_authoring_payload(payload)
        settings = payload['weekStructure'][0]['components'][0]['settings']
        legacy_settings = json.loads(settings['legacySettings'])

        self.assertEqual(errors, [])
        self.assertEqual(settings['sourceType'], 'Shortcode')
        self.assertEqual(settings['provider'], 'Shortcode')
        self.assertEqual(settings['legacySourceType'], 'Shortcode')
        self.assertTrue(settings['legacyUnsupportedSource'])
        self.assertEqual(legacy_settings['unknownString'], 'keep me')
        self.assertEqual(legacy_settings['unknownNumber'], 0)
        self.assertFalse(legacy_settings['unknownFalse'])
        self.assertNotIn('ignoredObject', legacy_settings)
        self.assertNotIn('ignoredNull', legacy_settings)

    def test_module_authoring_validation_blocks_ready_shortcode_video(self):
        errors = views.validate_module_authoring_payload({
            'title': 'Legacy Module',
            'weekStructure': [
                {
                    'title': 'Week 1',
                    'components': [
                        {
                            'type': 'video',
                            'title': 'Legacy shortcode video',
                            'expectedOtjh': 1,
                            'points': 10,
                            'settings': {
                                'sourceType': 'Shortcode',
                                'provider': 'Shortcode',
                                'contentStatus': 'Ready for QA',
                            },
                        },
                    ],
                },
            ],
        })

        self.assertEqual(errors[0]['path'], 'weekStructure.0.components.0.settings.sourceType')
        self.assertIn('Legacy Shortcode', errors[0]['message'])

    def test_module_structure_get_returns_404_when_no_authoring_structure_exists(self):
        request = self.factory.get('/curriculum_api/curriculum/modules/MOD-1/structure/')

        with patch.object(views, 'get_authoring_structure_payload', return_value=None):
            response = views.curriculum_module_structure(request, 'MOD-1')

        self.assertEqual(response.status_code, 404)

    def test_module_create_with_title_uses_authoring_module_not_training_plan(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/modules/',
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
            '/curriculum_api/curriculum/modules/',
            data=json.dumps({'moduleType': 'authoring', 'title': 'Authoring title', 'name': 'Legacy name', 'programme': 'Programme A'}),
            content_type='application/json',
        )

        with patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-NEW', 'title': 'Authoring title'}) as save_structure, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_module_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(save_structure.call_args.args[1]['title'], 'Authoring title')
        insert_row.assert_not_called()

    def test_module_create_reuses_existing_authoring_catalogue_for_same_identity(self):
        request = self.factory.post(
            '/curriculum_api/curriculum/modules/',
            data=json.dumps({
                'moduleType': 'authoring',
                'title': 'Fouda-Module',
                'programmeId': 'PROG-1',
                'programmeName': 'Fouda-Programme',
                'cohortId': 'COHORT-1',
                'cohortName': 'Fouda-Cohort',
                'groupId': 'GROUP-1',
                'groupName': 'Fouda-Group',
            }),
            content_type='application/json',
        )

        with patch.object(views, 'find_existing_authoring_catalogue_id_for_payload', return_value='MOD-EXISTING'), \
             patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-EXISTING', 'title': 'Fouda-Module'}) as save_structure, \
             patch.object(views, 'insert_row') as insert_row:
            response = views.curriculum_module_collection(request)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(save_structure.call_args.args[0], 'MOD-EXISTING')
        self.assertEqual(save_structure.call_args.args[1]['catalogueId'], 'MOD-EXISTING')
        insert_row.assert_not_called()

    def test_training_module_structure_get_uses_ensure_import_flow(self):
        request = self.factory.get('/curriculum_api/curriculum/modules/training-module-7/structure/')

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
        request = self.factory.delete('/curriculum_api/curriculum/modules/MOD-NEW/')

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
        request = self.factory.delete('/curriculum_api/curriculum/modules/training-module-7/')

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

    def test_module_collection_merges_best_authoring_twin_by_delivery_identity(self):
        modules = [{
            'id': 'training-module-7',
            'sourceId': 7,
            'sourceType': 'training_plan',
            'catalogueId': '',
            'name': 'Delivery Module',
            'programme': 'Programme A',
            'cohortId': 'cohort-1',
            'cohort': 'Cohort 1',
            'groupId': 'group-1',
            'group': 'Group 1',
            'status': 'published',
            'deliveryStatus': 'active',
        }]
        summaries = {
            'MOD-EMPTY': {
                'catalogueId': 'MOD-EMPTY',
                'title': 'Delivery Module',
                'programmeName': 'Programme A',
                'cohortId': 'cohort-1',
                'cohort': 'Cohort 1',
                'groupId': 'group-1',
                'group': 'Group 1',
                'description': '',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'sessionsNumber': 6,
                'startDate': '2026-07-01',
                'endDate': '2026-08-01',
                'qualityScore': 50,
                'lastUpdated': '2026-07-05',
                'weeks': 6,
                'ksbCount': 0,
                'lessonCount': 6,
                'quizCount': 0,
                'sessionNames': [],
                'ksbCodes': [],
            },
            'MOD-MAPPED': {
                'catalogueId': 'MOD-MAPPED',
                'title': 'Delivery Module',
                'programmeName': 'Programme A',
                'cohortId': 'cohort-1',
                'cohort': 'Cohort 1',
                'groupId': 'group-1',
                'group': 'Group 1',
                'description': '',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'sessionsNumber': 6,
                'startDate': '2026-07-01',
                'endDate': '2026-08-01',
                'qualityScore': 67,
                'lastUpdated': '2026-07-06',
                'weeks': 6,
                'ksbCount': 9,
                'lessonCount': 32,
                'quizCount': 1,
                'sessionNames': ['Live session'],
                'ksbCodes': ['K1', 'K3', 'K5', 'S1', 'S3', 'S7', 'B1', 'B3', 'B7'],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_modules_with_authoring(modules)

        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0]['catalogueId'], 'MOD-MAPPED')
        self.assertEqual(enriched[0]['ksbCount'], 9)
        self.assertEqual(enriched[0]['lessons'], 32)
        self.assertEqual(enriched[0]['status'], 'published')
        self.assertEqual(enriched[0]['authoringStatus'], 'draft')
        self.assertEqual(enriched[0]['deliveryStatus'], 'active')

    def test_build_sessions_uses_authoring_live_session_names(self):
        rows = [{
            'id': 7,
            'Program': 'Programme A',
            'module_name': 'Delivery Module',
            'Cohort_name': 'Cohort 1',
            'group_name': 'Group 1',
            'sessions_number': 3,
            'start_date': '2026-07-01',
            'session_week_day': 'Wednesday',
            'session_start_time': '09:30',
            'session_end_time': '11:30',
            'Tutor_name': 'Tutor A',
            'notes': '',
            '_meta': {
                'program_id': 'PROG-1',
                'cohort_id': 'cohort-1',
                'group_id': 'group-1',
            },
        }]
        summaries = {
            'MOD-MAPPED': {
                'catalogueId': 'MOD-MAPPED',
                'title': 'Delivery Module',
                'programmeName': 'Programme A',
                'cohortId': 'cohort-1',
                'cohort': 'Cohort 1',
                'groupId': 'group-1',
                'group': 'Group 1',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'qualityScore': 80,
                'weeks': 3,
                'ksbCount': 2,
                'lessonCount': 6,
                'quizCount': 0,
                'sessionNames': ['Intro live', 'Applied live', 'Review live'],
                'ksbCodes': ['K1', 'S1'],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            sessions = views.build_sessions(rows, [], [{'program_id': 'PROG-1', 'name': 'Programme A'}])

        self.assertEqual([session['title'] for session in sessions], ['Intro live', 'Applied live', 'Review live'])
        self.assertEqual(sessions[0]['programmeId'], 'program-prog-1')
        self.assertEqual(sessions[0]['cohortId'], 'cohort-1')
        self.assertEqual(sessions[0]['groupId'], 'group-1')

    def test_training_row_module_catalogue_id_prefers_column_over_notes(self):
        row = {
            'module_catalogue_id': 'MOD-COLUMN',
            'notes': '__module_catalogue_id: MOD-NOTES',
            '_meta': {'module_catalogue_id': 'MOD-NOTES'},
        }

        self.assertEqual(views.training_row_module_catalogue_id(row), 'MOD-COLUMN')

    def test_stale_numeric_note_reference_is_not_canonical(self):
        row = {
            'module_catalogue_id': None,
            'notes': '__module_catalogue_id: 10',
            '_meta': {'module_catalogue_id': '10'},
        }

        self.assertEqual(views.training_row_module_catalogue_id(row), '')
        self.assertEqual(views.training_row_stale_legacy_module_catalogue_id(row), '10')

    def test_invalid_populated_column_is_not_silently_canonical(self):
        row = {
            'module_catalogue_id': '10',
            'notes': '__module_catalogue_id: MOD-NOTES',
            '_meta': {'module_catalogue_id': 'MOD-NOTES'},
        }

        self.assertEqual(views.training_row_module_catalogue_id(row), '')
        self.assertEqual(views.training_row_invalid_explicit_module_catalogue_id(row), '10')

    def test_create_cohort_with_module_populates_canonical_link(self):
        with patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'unique_cohort_id', return_value='COHORT-1'), \
             patch.object(views, 'training_plan_can_store_module_rows', return_value=True), \
             patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'insert_row', return_value={'id': 7, 'notes': '', 'module_name': 'Module A'}), \
             patch.object(views, 'ensure_canonical_module_for_training_row', return_value='MOD-1') as ensure_module, \
             patch.object(views, 'persist_cohort_authoring_detail') as persist_detail:
            response = views.create_curriculum_cohort({
                'name': 'Cohort 1',
                'programme': 'Programme A',
                'programmeId': 'PROG-1',
                'moduleName': 'Module A',
            })

        self.assertEqual(response.status_code, 201)
        ensure_module.assert_called_once()
        persisted_row = persist_detail.call_args.args[1][0]
        self.assertEqual(persisted_row['module_catalogue_id'], 'MOD-1')

    def test_create_group_with_module_populates_canonical_link(self):
        cohort = {'id': 'COHORT-1', 'name': 'Cohort 1', 'programme': 'Programme A', 'startDate': '2026-01-01', 'endDate': '2026-12-31'}
        with patch.object(views.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(views, 'unique_group_id', return_value='GROUP-1'), \
             patch.object(views, 'training_plan_can_store_module_rows', return_value=True), \
             patch.object(views, 'find_training_rows_by_cohort', return_value=(cohort, [{'id': 1, 'group_name': ''}])), \
             patch.object(views, 'insert_row', return_value={'id': 8, 'notes': '', 'module_name': 'Module A'}), \
             patch.object(views, 'ensure_canonical_module_for_training_row', return_value='MOD-1') as ensure_module:
            response = views.create_curriculum_group({
                'name': 'Group 1',
                'cohortId': 'COHORT-1',
                'moduleName': 'Module A',
            })

        self.assertEqual(response.status_code, 201)
        ensure_module.assert_called_once()

    def test_rename_cohort_preserves_stable_cohort_id_in_notes(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/cohorts/programme-a-old-cohort/',
            data=json.dumps({
                'name': 'Renamed Cohort',
                'programmeId': 'PROG-1',
                'startDate': '2026-01-01',
                'endDate': '2026-12-31',
                'color': '#6941c6',
            }),
            content_type='application/json',
        )
        cohort = {
            'id': 'programme-a-old-cohort',
            'name': 'Old Cohort',
            'programmeId': 'program-prog-1',
            'startDate': '2026-01-01',
            'endDate': '2026-12-31',
        }
        rows = [{'id': 1, 'notes': '', 'Cohort_name': 'Old Cohort'}]

        with patch.object(views, 'find_training_rows_by_cohort', return_value=(cohort, rows)), \
             patch.object(views, 'training_plan_can_store_module_rows', return_value=True), \
             patch.object(views, 'update_training_rows', return_value=rows) as update_training_rows, \
             patch.object(views, 'persist_cohort_authoring_detail'), \
             patch.object(views, 'invalidate_curriculum_cache'):
            response = views.curriculum_cohort_detail(request, 'programme-a-old-cohort')

        payload = update_training_rows.call_args.args[1]
        self.assertEqual(response.status_code, 200)
        self.assertIn('__cohort_id: programme-a-old-cohort', payload['notes'])
        self.assertIn('__program_id: PROG-1', payload['notes'])

    def test_rename_group_preserves_stable_group_id_in_notes(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/groups/programme-a-old-cohort-old-group/',
            data=json.dumps({
                'name': 'Renamed Group',
                'programmeId': 'PROG-1',
                'cohortId': 'programme-a-old-cohort',
                'weekDays': 'Wed',
                'startTime': '09:30',
                'endTime': '11:30',
                'color': '#334155',
            }),
            content_type='application/json',
        )
        group = {
            'id': 'programme-a-old-cohort-old-group',
            'name': 'Old Group',
            'cohortId': 'programme-a-old-cohort',
            'programmeId': 'program-prog-1',
        }
        rows = [{'id': 1, 'notes': '', 'group_name': 'Old Group'}]

        with patch.object(views, 'find_training_rows_by_group', return_value=(group, rows)), \
             patch.object(views, 'training_plan_can_store_module_rows', return_value=True), \
             patch.object(views, 'update_training_rows', return_value=rows) as update_training_rows, \
             patch.object(views, 'persist_group_authoring_detail'), \
             patch.object(views, 'safe_authoring_module_rows', return_value=[]), \
             patch.object(views, 'sync_group_staff_profile_links'), \
             patch.object(views, 'invalidate_curriculum_cache'):
            response = views.curriculum_group_detail(request, 'programme-a-old-cohort-old-group')

        payload = update_training_rows.call_args.args[1]
        self.assertEqual(response.status_code, 200)
        self.assertIn('__cohort_id: programme-a-old-cohort', payload['notes'])
        self.assertIn('__group_id: programme-a-old-cohort-old-group', payload['notes'])
        self.assertIn('__group_name: Renamed Group', payload['notes'])

    def backfill_fetch_fixture(self, invalid_column=False):
        training_row = {
            'id': 7,
            'Program': 'Programme A',
            'Cohort_name': 'Cohort 1',
            'group_name': 'Group 1',
            'module_name': 'Module A',
            'module_catalogue_id': '10' if invalid_column else None,
            'notes': '__module_catalogue_id: 10',
            '_meta': {'module_catalogue_id': '10', 'program_id': 'PROG-1', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1'},
        }
        module_row = {
            'module_catalogue_id': 'MOD-1',
            'programme_id': 'PROG-1',
            'programme_name': 'Programme A',
            'cohort_id': 'COHORT-1',
            'cohort_name': 'Cohort 1',
            'group_id': 'GROUP-1',
            'group_name': 'Group 1',
            'title': 'Module A',
            'source_type': '',
            'source_id': '',
            'imported_from_training_plan_id': '',
        }

        def fake_fetch(query, params=None):
            if '"Training_plan"' in query:
                return [training_row]
            if 'modules' in query:
                return [module_row]
            if 'programmes' in query:
                return [{'program_id': 'PROG-1', 'name': 'Programme A'}]
            return []

        return fake_fetch

    def backfill_fixture(self, training_rows, module_rows, program_configs=None, mappings=None, components=None, weeks=None):
        def fake_fetch(query, params=None):
            if 'information_schema.columns' in query:
                return [{
                    'table_schema': views.CURRICULUM_SCHEMA,
                    'table_name': 'Training_plan',
                    'column_name': views.TRAINING_MODULE_CATALOGUE_COLUMN,
                    'data_type': 'character varying',
                    'character_maximum_length': 128,
                    'is_nullable': 'YES',
                    'column_default': None,
                }]
            if 'pg_indexes' in query:
                return [{
                    'schemaname': views.CURRICULUM_SCHEMA,
                    'tablename': 'Training_plan',
                    'indexname': 'curriculum_training_plan_module_catalogue_idx',
                    'indexdef': 'CREATE INDEX curriculum_training_plan_module_catalogue_idx ON curriculum."Training_plan" USING btree (module_catalogue_id)',
                }]
            if '"Training_plan"' in query and 'where module_catalogue_id = %s' in query:
                selected = str((params or [''])[0])
                return [{'id': row.get('id')} for row in training_rows if row.get('module_catalogue_id') == selected]
            if '"Training_plan"' in query:
                return training_rows
            if 'modules' in query:
                return module_rows
            if 'ksb_mappings' in query:
                return mappings or []
            if 'components' in query:
                return components or []
            if 'weeks' in query:
                return weeks or []
            if 'programmes' in query:
                return program_configs or [{'program_id': 'PROG-1', 'name': 'Programme A'}]
            return []

        return fake_fetch

    def backfill_training_row(self, **overrides):
        row = {
            'id': 7,
            'Program': 'Programme A',
            'Cohort_name': 'Cohort 1',
            'group_name': 'Group 1',
            'module_name': 'Module A',
            'module_catalogue_id': None,
            'notes': '',
            '_meta': {'program_id': 'PROG-1', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1'},
        }
        row.update(overrides)
        return row

    def backfill_module_row(self, module_id='MOD-1', **overrides):
        row = {
            'module_catalogue_id': module_id,
            'programme_id': 'PROG-1',
            'programme_name': 'Programme A',
            'cohort_id': 'COHORT-1',
            'cohort_name': 'Cohort 1',
            'group_id': 'GROUP-1',
            'group_name': 'Group 1',
            'title': 'Module A',
            'source_type': '',
            'source_id': '',
            'imported_from_training_plan_id': '',
            'status': 'draft',
        }
        row.update(overrides)
        return row

    def test_backfill_default_dry_run_is_read_only_and_stale_refs_do_not_block_matching(self):
        output = StringIO()
        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fetch_fixture()), \
             patch.object(views, 'link_training_row_to_catalogue') as link:
            call_command('backfill_module_catalogue_links', stdout=output)

        self.assertIn('Mode: DRY-RUN (read-only)', output.getvalue())
        self.assertIn('Newly matchable: 1', output.getvalue())
        self.assertIn('Stale legacy references: 1', output.getvalue())
        self.assertIn('Errors: 0', output.getvalue())
        link.assert_not_called()

    def test_backfill_invalid_column_does_not_fallback_to_matching(self):
        output = StringIO()
        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fetch_fixture(invalid_column=True)):
            call_command('backfill_module_catalogue_links', stdout=output)

        self.assertIn('Newly matchable: 0', output.getvalue())
        self.assertIn('Invalid explicit links: 1', output.getvalue())

    def test_backfill_apply_requires_flag_and_rolls_back_on_link_failure(self):
        output = StringIO()
        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fetch_fixture()), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links.Command._schema_mismatch_reasons', return_value=[]), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links.transaction.atomic', return_value=nullcontext()), \
             patch.object(views, 'link_training_row_to_catalogue', return_value=False):
            with self.assertRaises(CommandError):
                call_command('backfill_module_catalogue_links', '--apply', stdout=output)

    def test_backfill_rejects_weak_cross_programme_title_only_match(self):
        output = StringIO()
        training_rows = [self.backfill_training_row()]
        module_rows = [self.backfill_module_row('MOD-OTHER', programme_id='PROG-2', programme_name='Programme B')]

        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)):
            call_command('backfill_module_catalogue_links', stdout=output)

        self.assertIn('Newly matchable: 0', output.getvalue())
        self.assertIn('Cross-programme candidate only.', output.getvalue())

    def test_backfill_resolution_template_is_deterministically_ordered(self):
        output = StringIO()
        training_rows = [self.backfill_training_row()]
        module_rows = [
            self.backfill_module_row('MOD-B'),
            self.backfill_module_row('MOD-A'),
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = f'{directory}/template.json'
            with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)):
                call_command('backfill_module_catalogue_links', '--write-resolution-template', path, stdout=output)
            first = open(path, encoding='utf-8').read()

            with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)):
                call_command('backfill_module_catalogue_links', '--write-resolution-template', path, stdout=StringIO())
            second = open(path, encoding='utf-8').read()

        payload = json.loads(first)
        resolution = payload['resolutions'][0]
        self.assertEqual(first, second)
        self.assertEqual(resolution['trainingPlanRowId'], 7)
        self.assertEqual(resolution['candidateModuleCatalogueIds'], ['MOD-A', 'MOD-B'])
        self.assertEqual(
            set(resolution['candidateMetadata'][0]),
            {
                'moduleCatalogueId', 'title', 'programmeId', 'programmeName', 'cohortId', 'cohortName',
                'groupIds', 'groupName', 'sourceType', 'sourceId', 'authoringStatus', 'weekCount',
                'componentCount', 'liveSessionCount', 'ksbMappingCount', 'completionCriteriaPresent',
                'advancedDetailsPresent', 'createdAt', 'updatedAt', 'isEmptyShell', 'emptyShell',
                'referencedTrainingPlanRowIds',
            },
        )

    def test_backfill_invalid_manual_candidate_is_rejected(self):
        training_rows = [self.backfill_training_row()]
        module_rows = [self.backfill_module_row('MOD-A'), self.backfill_module_row('MOD-B')]

        with tempfile.TemporaryDirectory() as directory:
            path = f'{directory}/resolution.json'
            with open(path, 'w', encoding='utf-8') as handle:
                json.dump({'resolutions': [{'trainingPlanRowId': 7, 'selectedModuleCatalogueId': 'MOD-MISSING'}]}, handle)
            with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)):
                with self.assertRaises(CommandError):
                    call_command('backfill_module_catalogue_links', '--resolution-file', path, stdout=StringIO())

    def test_backfill_cross_programme_manual_candidate_is_rejected(self):
        training_rows = [self.backfill_training_row()]
        module_rows = [
            self.backfill_module_row('MOD-A', source_type='training_plan', source_id='7'),
            self.backfill_module_row('MOD-B', programme_id='PROG-2', programme_name='Programme B', source_type='training_plan', source_id='7'),
        ]

        with tempfile.TemporaryDirectory() as directory:
            path = f'{directory}/resolution.json'
            with open(path, 'w', encoding='utf-8') as handle:
                json.dump({'resolutions': [{'trainingPlanId': 7, 'selectedModuleCatalogueId': 'MOD-B'}]}, handle)
            with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
                 patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)):
                with self.assertRaises(CommandError):
                    call_command('backfill_module_catalogue_links', '--resolution-file', path, stdout=StringIO())

    def test_backfill_apply_blocks_unresolved_ambiguous_rows(self):
        training_rows = [self.backfill_training_row()]
        module_rows = [self.backfill_module_row('MOD-A'), self.backfill_module_row('MOD-B')]

        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, module_rows)), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links.transaction.atomic', return_value=nullcontext()):
            with self.assertRaises(CommandError):
                call_command('backfill_module_catalogue_links', '--apply', stdout=StringIO())

    def test_backfill_apply_allows_legitimate_unmatched_rows(self):
        output = StringIO()
        training_rows = [self.backfill_training_row(module_name='Delivery only')]

        with patch('curriculum_api.management.commands.backfill_module_catalogue_links._table_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._column_exists', return_value=True), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links._fetch_all', side_effect=self.backfill_fixture(training_rows, [])), \
             patch('curriculum_api.management.commands.backfill_module_catalogue_links.transaction.atomic', return_value=nullcontext()), \
             patch.object(views, 'link_training_row_to_catalogue') as link:
            call_command('backfill_module_catalogue_links', '--apply', stdout=output)

        self.assertIn('Unmatched: 1', output.getvalue())
        self.assertIn('No Training_plan rows required updates.', output.getvalue())
        link.assert_not_called()

    def test_training_plan_module_catalogue_migration_reverse_drops_index_and_column(self):
        migration = importlib.import_module('curriculum_api.migrations.0002_training_plan_module_catalogue_link')
        executed = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def execute(self, sql):
                executed.append(' '.join(sql.split()).lower())

        class Connection:
            vendor = 'postgresql'

            def cursor(self):
                return Cursor()

        class SchemaEditor:
            connection = Connection()

        migration.remove_training_plan_module_catalogue_link(None, SchemaEditor())

        self.assertTrue(any('drop index if exists curriculum.curriculum_training_plan_module_catalogue_idx' in sql for sql in executed))
        self.assertTrue(any('drop column if exists module_catalogue_id' in sql for sql in executed))

    def test_enrich_modules_prefers_explicit_canonical_link_over_signature_match(self):
        modules = [{
            'id': 'training-module-7',
            'sourceId': 7,
            'sourceType': 'training_plan',
            'catalogueId': 'MOD-CANONICAL',
            'moduleCatalogueId': 'MOD-CANONICAL',
            'name': 'Duplicate Title',
            'programme': 'Programme A',
            'cohortId': 'COHORT-1',
            'cohort': 'Cohort 1',
            'groupId': 'GROUP-1',
            'group': 'Group 1',
            'ksbCount': 0,
            'ksbCodes': [],
            'sessionNames': [],
        }]
        summaries = {
            'MOD-CANONICAL': {
                'catalogueId': 'MOD-CANONICAL',
                'title': 'Authored With Evidence',
                'programmeName': 'Programme A',
                'cohortId': 'COHORT-1',
                'cohort': 'Cohort 1',
                'groupId': 'GROUP-1',
                'group': 'Group 1',
                'description': 'Evidence lives here',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'weeks': 2,
                'lessonCount': 4,
                'quizCount': 1,
                'ksbCount': 3,
                'qualityScore': 90,
                'sessionsNumber': 2,
                'sessionNames': ['Real session'],
                'ksbCodes': ['K1', 'S1', 'B1'],
            },
            'MOD-EMPTY-TWIN': {
                'catalogueId': 'MOD-EMPTY-TWIN',
                'title': 'Duplicate Title',
                'programmeName': 'Programme A',
                'cohortId': 'COHORT-1',
                'cohort': 'Cohort 1',
                'groupId': 'GROUP-1',
                'group': 'Group 1',
                'description': '',
                'status': 'published',
                'sourceType': 'training_plan',
                'sourceId': '7',
                'weeks': 0,
                'lessonCount': 0,
                'quizCount': 0,
                'ksbCount': 0,
                'qualityScore': 0,
                'sessionsNumber': 0,
                'sessionNames': [],
                'ksbCodes': [],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_modules_with_authoring(modules)

        self.assertEqual(enriched[0]['moduleId'], 'MOD-CANONICAL')
        self.assertEqual(enriched[0]['catalogueId'], 'MOD-CANONICAL')
        self.assertEqual(enriched[0]['name'], 'Authored With Evidence')
        self.assertEqual(enriched[0]['ksbCount'], 3)

    def test_build_sessions_uses_canonical_module_week_and_component_ids(self):
        rows = [{
            'id': 7,
            'Program': 'Programme A',
            'module_name': 'Delivery Module',
            'Cohort_name': 'Cohort 1',
            'group_name': 'Group 1',
            'sessions_number': 1,
            'start_date': '2026-07-01',
            'notes': '',
            'module_catalogue_id': 'MOD-CANONICAL',
            '_meta': {
                'program_id': 'PROG-1',
                'cohort_id': 'COHORT-1',
                'group_id': 'GROUP-1',
            },
        }]
        summaries = {
            'MOD-CANONICAL': {
                'catalogueId': 'MOD-CANONICAL',
                'title': 'Delivery Module',
                'programmeName': 'Programme A',
                'cohortId': 'COHORT-1',
                'cohort': 'Cohort 1',
                'groupId': 'GROUP-1',
                'group': 'Group 1',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'qualityScore': 80,
                'weeks': 1,
                'ksbCount': 1,
                'lessonCount': 1,
                'quizCount': 0,
                'sessionNames': ['Authored live'],
                'ksbCodes': ['K1'],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries), \
             patch.object(views, 'authoring_session_links', return_value=[{'weekId': 'WEEK-1', 'componentId': 'COMP-1', 'title': 'Authored live'}]):
            sessions = views.build_sessions(rows, [], [{'program_id': 'PROG-1', 'name': 'Programme A'}])

        self.assertEqual(sessions[0]['moduleId'], 'MOD-CANONICAL')
        self.assertEqual(sessions[0]['moduleCatalogueId'], 'MOD-CANONICAL')
        self.assertEqual(sessions[0]['deliveryModuleId'], 'training-module-7')
        self.assertEqual(sessions[0]['weekId'], 'WEEK-1')
        self.assertEqual(sessions[0]['componentId'], 'COMP-1')

    def test_programme_scope_uses_linked_canonical_modules_before_legacy_twins(self):
        module_rows = [
            {'module_catalogue_id': 'MOD-CANONICAL', 'title': 'Duplicate Title', 'programme_id': 'OTHER', 'programme_name': 'Programme A'},
            {'module_catalogue_id': 'MOD-EMPTY', 'title': 'Duplicate Title', 'programme_id': 'PROG-1', 'programme_name': 'Programme A', 'source_type': 'training_plan', 'source_id': '7'},
        ]
        training_rows = [{
            'id': 7,
            'Program': 'Programme A',
            'module_name': 'Duplicate Title',
            'module_catalogue_id': 'MOD-CANONICAL',
            'notes': '',
            '_meta': {'program_id': 'PROG-1', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1'},
        }]

        def fetch_authoring(table, *args, **kwargs):
            if table == views.AUTHORING_MODULES_TABLE:
                return module_rows
            if table == views.AUTHORING_KSB_MAPPINGS_TABLE:
                return [{'id': 'KSBMAP-1', 'module_catalogue_id': 'MOD-CANONICAL', 'ksb_code': 'K1', 'classification': 'main', 'weight': 100}]
            return []

        with patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'authoring_fetch_all', side_effect=fetch_authoring), \
             patch.object(views, 'get_training_rows', return_value=training_rows), \
             patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'PROG-1', 'name': 'Programme A'}]):
            scoped_modules, _weeks, _components, scoped_mappings = views.authoring_scope_data('programme', 'program-prog-1')

        self.assertEqual([row['module_catalogue_id'] for row in scoped_modules], ['MOD-CANONICAL'])
        self.assertEqual({row['module_catalogue_id'] for row in scoped_mappings}, {'MOD-CANONICAL'})

    def test_programme_counts_include_authoring_only_curriculum_modules(self):
        programmes = [{
            'id': 'program-prog-1',
            'sourceId': 'PROG-1',
            'name': 'Programme A',
            'standard': 'Programme A',
            'modules': 1,
            'cohorts': 1,
            'groups': 1,
            'structureType': 'scheduled',
        }]
        modules = [{
            'id': 'training-module-7',
            'sourceId': 7,
            'sourceType': 'training_plan',
            'catalogueId': 'MOD-DELIVERY',
            'name': 'Delivery Module',
            'programmeId': 'program-prog-1',
            'programme': 'Programme A',
            'cohortId': 'cohort-1',
            'cohort': 'Cohort 1',
            'groupId': 'group-1',
            'group': 'Group 1',
        }]
        summaries = {
            'MOD-AUTHORING': {
                'catalogueId': 'MOD-AUTHORING',
                'title': 'Authoring Only Module',
                'programmeId': 'PROG-1',
                'programmeName': 'Programme A',
                'cohortId': 'cohort-2',
                'cohort': 'Cohort 2',
                'groupId': 'group-2',
                'group': 'Group 2',
                'description': '',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'sessionsNumber': 6,
                'startDate': '',
                'endDate': '',
                'qualityScore': 10,
                'lastUpdated': '',
                'weeks': 6,
                'ksbCount': 0,
                'lessonCount': 6,
                'quizCount': 0,
                'sessionNames': [],
                'ksbCodes': [],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_programmes_with_module_counts(programmes, modules)

        self.assertEqual(enriched[0]['modules'], 2)
        self.assertEqual(enriched[0]['cohorts'], 2)
        self.assertEqual(enriched[0]['groups'], 2)

    def test_programmes_include_module_only_authoring_programmes(self):
        summaries = {
            'MOD-AUTHORING': {
                'catalogueId': 'MOD-AUTHORING',
                'title': 'Authoring Only Module',
                'programmeId': 'PROG-AUTHORING',
                'programmeName': 'Authoring Programme',
                'cohortId': '',
                'cohort': '',
                'groupId': '',
                'group': '',
                'description': '',
                'status': 'draft',
                'sourceType': 'authoring',
                'sourceId': '',
                'sessionsNumber': 4,
                'startDate': '',
                'endDate': '',
                'qualityScore': 10,
                'lastUpdated': '2026-07-18',
                'weeks': 4,
                'ksbCount': 0,
                'lessonCount': 4,
                'quizCount': 0,
                'sessionNames': [],
                'ksbCodes': [],
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_programmes_with_module_counts([], [])

        self.assertEqual(len(enriched), 1)
        self.assertEqual(enriched[0]['name'], 'Authoring Programme')
        self.assertEqual(enriched[0]['sourceId'], 'PROG-AUTHORING')
        self.assertEqual(enriched[0]['status'], 'planned')
        self.assertEqual(enriched[0]['modules'], 1)
        self.assertEqual(enriched[0]['weeks'], 4)

    def test_archived_authoring_modules_do_not_create_active_programmes(self):
        summaries = {
            'MOD-ARCHIVED': {
                'catalogueId': 'MOD-ARCHIVED',
                'title': 'Archived Module',
                'programmeId': 'PROG-ARCHIVED',
                'programmeName': 'Archived Programme',
                'status': 'archived',
                'authoringStatus': 'archived',
                'weeks': 4,
            },
        }

        with patch.object(views, 'authoring_catalogue_summaries', return_value=summaries):
            enriched = views.enrich_programmes_with_module_counts([], [])

        self.assertEqual(enriched, [])

    def test_training_module_structure_get_uses_resolved_authoring_catalogue(self):
        request = self.factory.get('/curriculum_api/curriculum/modules/training-module-61287/structure/')
        structure = {
            'catalogueId': 'MOD-BEST',
            'title': 'Fouda-Module',
            'weekStructure': [{'id': 'week-1', 'components': [{'id': 'component-1'}]}],
        }

        with patch.object(views, 'resolve_authoring_catalogue_id', return_value='MOD-BEST'), \
             patch.object(views, 'get_authoring_structure_payload', return_value=structure) as get_structure:
            response = views.curriculum_module_structure(request, 'training-module-61287')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['catalogueId'], 'MOD-BEST')
        get_structure.assert_called_once_with('MOD-BEST')

    def test_training_module_structure_patch_saves_to_resolved_authoring_catalogue(self):
        request = self.factory.patch(
            '/curriculum_api/curriculum/modules/training-module-61287/structure/',
            data=json.dumps({'catalogueId': 'MOD-BEST', 'title': 'Fouda-Module', 'weekStructure': []}),
            content_type='application/json',
        )

        with patch.object(views, 'resolve_authoring_catalogue_id', return_value='MOD-BEST'), \
             patch.object(views, 'save_module_authoring_structure', return_value={'catalogueId': 'MOD-BEST'}) as save_structure:
            response = views.curriculum_module_structure(request, 'training-module-61287')

        self.assertEqual(response.status_code, 200)
        save_structure.assert_called_once()
        self.assertEqual(save_structure.call_args.args[0], 'MOD-BEST')
        self.assertEqual(save_structure.call_args.args[1]['sourceId'], '61287')

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
            '/curriculum_api/curriculum/components/',
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
            '/curriculum_api/curriculum/components/component-1/',
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
        request = self.factory.delete('/curriculum_api/curriculum/components/component-1/')

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


class CurriculumKsbCoverageTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.modules = [
            {'module_catalogue_id': 'MOD-1', 'programme_id': 'PROG-1', 'programme_name': 'Programme', 'title': 'Module 1'},
            {'module_catalogue_id': 'MOD-2', 'programme_id': 'PROG-1', 'programme_name': 'Programme', 'title': 'Module 2'},
            {'module_catalogue_id': 'MOD-3', 'programme_id': 'PROG-1', 'programme_name': 'Programme', 'title': 'Module 3'},
            {'module_catalogue_id': 'MOD-4', 'programme_id': 'PROG-1', 'programme_name': 'Programme', 'title': 'Module 4'},
        ]
        self.weeks = [
            {'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'week_number': 1, 'title': 'Week 1'},
            {'id': 'WEEK-2', 'module_catalogue_id': 'MOD-2', 'week_number': 2, 'title': 'Week 2'},
            {'id': 'WEEK-3', 'module_catalogue_id': 'MOD-3', 'week_number': 3, 'title': 'Week 3'},
            {'id': 'WEEK-4', 'module_catalogue_id': 'MOD-4', 'week_number': 4, 'title': 'Week 4'},
        ]
        self.components = [
            {'id': 'COMP-A', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1', 'type': 'live_session', 'title': 'Component A'},
            {'id': 'COMP-B', 'module_catalogue_id': 'MOD-2', 'week_id': 'WEEK-2', 'type': 'video', 'title': 'Component B'},
            {'id': 'COMP-C', 'module_catalogue_id': 'MOD-3', 'week_id': 'WEEK-3', 'type': 'quiz', 'title': 'Component C'},
            {'id': 'COMP-D', 'module_catalogue_id': 'MOD-4', 'week_id': 'WEEK-4', 'type': 'assignment', 'title': 'Component D'},
        ]
        self.required = [
            {'ksb_id': 'K1.1', 'code': 'K1.1', 'title': 'Knowledge 1.1', 'description': 'Know the thing', 'ksb_type': 'knowledge', 'source_type': 'framework', 'source_id': 'ksb-1'},
            {'ksb_id': 'K1.2', 'code': 'K1.2', 'title': 'Knowledge 1.2', 'description': '', 'ksb_type': 'knowledge', 'source_type': 'framework', 'source_id': 'ksb-1'},
            {'ksb_id': 'S3', 'code': 'S3', 'title': 'Skill 3', 'description': '', 'ksb_type': 'skill', 'source_type': 'framework', 'source_id': 'ksb-1'},
            {'ksb_id': 'B2', 'code': 'B2', 'title': 'Behaviour 2', 'description': '', 'ksb_type': 'behaviour', 'source_type': 'framework', 'source_id': 'ksb-1'},
        ]

    def mapping(self, mapping_id, module_id, week_id, component_id, code, weight, classification='main'):
        return {
            'id': mapping_id,
            'module_catalogue_id': module_id,
            'week_id': week_id,
            'component_id': component_id,
            'ksb_id': code,
            'ksb_code': code,
            'ksb_description': f'Description for {code}',
            'source_type': 'framework',
            'source_id': 'ksb-1',
            'classification': classification,
            'weight': weight,
        }

    def test_coverage_status_boundaries(self):
        self.assertEqual(coverage_status(0), 'missing')
        self.assertEqual(coverage_status(60), 'partial')
        self.assertEqual(coverage_status(100), 'fully_covered')
        self.assertEqual(coverage_status(130), 'over_allocated')

    def test_multi_module_aggregation_and_trace(self):
        mappings = [
            self.mapping('KSBMAP-1', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 40, 'main'),
            self.mapping('KSBMAP-2', 'MOD-2', 'WEEK-2', 'COMP-B', 'K1.1', 20, 'secondary'),
            self.mapping('KSBMAP-3', 'MOD-3', 'WEEK-3', 'COMP-C', 'K1.1', 20, 'secondary'),
            self.mapping('KSBMAP-4', 'MOD-4', 'WEEK-4', 'COMP-D', 'K1.1', 20, 'possible'),
        ]

        coverage = build_coverage(self.required, mappings, self.modules, self.weeks, self.components)
        item = next(row for row in coverage['items'] if row['code'] == 'K1.1')

        self.assertEqual(item['raw_total_weight'], 100)
        self.assertEqual(item['status'], 'fully_covered')
        self.assertEqual(item['occurrence_count'], 4)
        self.assertEqual(item['module_count'], 4)
        self.assertEqual(item['week_count'], 4)
        self.assertEqual(item['component_count'], 4)
        self.assertEqual(len(item['mappings']), 4)
        self.assertEqual(item['mappings'][0]['programme_id'], 'PROG-1')
        self.assertEqual(item['mappings'][0]['component_id'], 'COMP-A')

    def test_trace_mapping_includes_group_and_mapping_level(self):
        modules = [
            {**self.modules[0], 'group_id': 'GROUP-1', 'group_name': 'Group One'},
        ]
        components = [
            {
                **self.components[0],
                'settings_json': json.dumps({
                    'selectedGroupNames': ['Group One', 'Group Two'],
                    'selectedGroupKeys': ['ignored-when-names-exist'],
                }),
            },
        ]
        coverage = build_coverage(
            self.required,
            [self.mapping('KSBMAP-1', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 50, 'main')],
            modules,
            self.weeks[:1],
            components,
        )
        mapping = next(row for row in coverage['items'] if row['code'] == 'K1.1')['mappings'][0]

        self.assertEqual(mapping['mapping_level'], 'component')
        self.assertEqual(mapping['group_id'], 'GROUP-1')
        self.assertEqual(mapping['group_name'], 'Group One')
        self.assertEqual(mapping['groups'], ['Group One', 'Group Two'])

    def test_programme_scope_uses_programme_id_and_dedupes_delivery_twins(self):
        module_rows = [
            {
                'module_catalogue_id': 'MOD-MAPPED',
                'title': 'Fouda-Module',
                'programme_id': 'PROG-OLD',
                'programme_name': 'Programme A',
                'cohort_id': 'COHORT-1',
                'cohort_name': 'Cohort 1',
                'group_id': 'GROUP-1',
                'group_name': 'Group 1',
                'source_type': 'authoring',
                'source_id': '',
            },
            {
                'module_catalogue_id': 'MOD-EMPTY',
                'title': 'Fouda-Module',
                'programme_id': 'Programme A',
                'programme_name': 'Programme A',
                'cohort_id': 'COHORT-1',
                'cohort_name': 'Cohort 1',
                'group_id': 'GROUP-1',
                'group_name': 'Group 1',
                'source_type': 'training_plan',
                'source_id': '7',
            },
            {
                'module_catalogue_id': 'MOD-RISK',
                'title': 'Risk Management',
                'programme_id': 'PROG-1',
                'programme_name': 'Programme A',
                'cohort_id': 'COHORT-1',
                'cohort_name': 'Cohort 1',
                'group_id': 'GROUP-1',
                'group_name': 'Group 1',
                'source_type': 'training_plan',
                'source_id': '8',
            },
        ]
        mapping_rows = [
            self.mapping('KSBMAP-1', 'MOD-MAPPED', '', '', 'K1.1', 50),
            self.mapping('KSBMAP-2', 'MOD-RISK', '', '', 'K1.2', 50),
        ]
        training_rows = [
            {
                'id': 7,
                'Program': 'Programme A',
                'module_name': 'Fouda-Module',
                'Cohort_name': 'Cohort 1',
                'group_name': 'Group 1',
                '_meta': {'program_id': 'PROG-1', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1'},
            },
            {
                'id': 8,
                'Program': 'Programme A',
                'module_name': 'Risk Management',
                'Cohort_name': 'Cohort 1',
                'group_name': 'Group 1',
                '_meta': {'program_id': 'PROG-1', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1'},
            },
        ]

        def fetch_authoring(table, *args, **kwargs):
            if table == views.AUTHORING_MODULES_TABLE:
                return module_rows
            if table == views.AUTHORING_WEEKS_TABLE:
                return []
            if table == views.AUTHORING_COMPONENTS_TABLE:
                return []
            if table == views.AUTHORING_KSB_MAPPINGS_TABLE:
                return mapping_rows
            return []

        with patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'authoring_fetch_all', side_effect=fetch_authoring), \
             patch.object(views, 'get_training_rows', return_value=training_rows), \
             patch.object(views, 'get_program_config_rows', return_value=[{'program_id': 'PROG-1', 'name': 'Programme A'}]):
            scoped_modules, _weeks, _components, scoped_mappings = views.authoring_scope_data('programme', 'program-prog-1')

        self.assertEqual([row['module_catalogue_id'] for row in scoped_modules], ['MOD-MAPPED', 'MOD-RISK'])
        self.assertEqual({row['module_catalogue_id'] for row in scoped_mappings}, {'MOD-MAPPED', 'MOD-RISK'})

    def test_occurrence_count_counts_mapping_rows_not_distinct_components(self):
        mappings = [
            self.mapping('KSBMAP-1', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 40, 'main'),
            self.mapping('KSBMAP-2', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 20, 'secondary'),
        ]

        coverage = build_coverage(self.required, mappings, self.modules, self.weeks, self.components)
        item = next(row for row in coverage['items'] if row['code'] == 'K1.1')

        self.assertEqual(item['occurrence_count'], 2)
        self.assertEqual(item['component_count'], 1)
        self.assertEqual(item['week_count'], 1)
        self.assertEqual(item['module_count'], 1)

    def test_module_and_week_level_mappings_are_included(self):
        module_mapping = self.mapping('KSBMAP-MOD', 'MOD-1', '', '', 'K1.1', 50, 'main')
        week_mapping = self.mapping('KSBMAP-WEEK', 'MOD-1', 'WEEK-1', '', 'K1.2', 30, 'secondary')

        coverage = build_coverage(self.required, [module_mapping, week_mapping], self.modules, self.weeks, self.components)
        by_code = {item['code']: item for item in coverage['items']}

        self.assertEqual(by_code['K1.1']['occurrence_count'], 1)
        self.assertEqual(by_code['K1.1']['component_count'], 0)
        self.assertEqual(by_code['K1.1']['mappings'][0]['mapping_level'], 'module')
        self.assertEqual(by_code['K1.2']['occurrence_count'], 1)
        self.assertEqual(by_code['K1.2']['week_count'], 1)
        self.assertEqual(by_code['K1.2']['component_count'], 0)
        self.assertEqual(by_code['K1.2']['mappings'][0]['mapping_level'], 'week')

    def test_missing_partial_full_and_over_allocated_are_reported(self):
        mappings = [
            self.mapping('KSBMAP-1', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 100),
            self.mapping('KSBMAP-2', 'MOD-2', 'WEEK-2', 'COMP-B', 'K1.2', 60),
            self.mapping('KSBMAP-3', 'MOD-3', 'WEEK-3', 'COMP-C', 'S3', 130),
        ]

        by_code = {item['code']: item for item in build_coverage(self.required, mappings, self.modules, self.weeks, self.components)['items']}

        self.assertEqual(by_code['B2']['status'], 'missing')
        self.assertEqual(by_code['B2']['raw_total_weight'], 0)
        self.assertEqual(by_code['K1.2']['status'], 'partial')
        self.assertEqual(by_code['K1.1']['status'], 'fully_covered')
        self.assertEqual(by_code['S3']['status'], 'over_allocated')
        self.assertEqual(by_code['S3']['raw_total_weight'], 130)

    def test_week_module_programme_summary_counts(self):
        mappings = [
            self.mapping('KSBMAP-1', 'MOD-1', 'WEEK-1', 'COMP-A', 'K1.1', 100),
            self.mapping('KSBMAP-2', 'MOD-2', 'WEEK-2', 'COMP-B', 'K1.2', 60),
            self.mapping('KSBMAP-3', 'MOD-3', 'WEEK-3', 'COMP-C', 'S3', 130),
        ]

        summary = build_coverage(self.required, mappings, self.modules, self.weeks, self.components)['summary']

        self.assertEqual(summary['overall']['required'], 4)
        self.assertEqual(summary['overall']['fully_covered'], 1)
        self.assertEqual(summary['overall']['partial'], 1)
        self.assertEqual(summary['overall']['missing'], 1)
        self.assertEqual(summary['overall']['over_allocated'], 1)
        self.assertEqual(summary['knowledge']['required'], 2)
        self.assertEqual(summary['skills']['over_allocated'], 1)
        self.assertEqual(summary['behaviours']['missing'], 1)

    def test_mapping_validation_rejects_bad_classification_weight_and_source(self):
        with patch.object(views, 'source_record_exists', return_value=True), \
             patch.object(views, 'ksb_exists_in_source', return_value=False):
            errors = views.validate_ksb_mapping_payload({
                'code': 'K9',
                'classification': 'practice',
                'weight': 0,
                'sourceType': 'framework',
                'sourceId': 'ksb-1',
            })

        messages = [error['message'] for error in errors]
        self.assertIn('Classification must be main, secondary, or possible.', messages)
        self.assertIn('Weight must be greater than zero.', messages)
        self.assertIn('K9 does not belong to the selected KSB framework source.', messages)

    def test_duplicate_mapping_detection(self):
        errors = views.validate_mapping_duplicates([
            {'code': 'K1.1', 'sourceType': 'framework', 'sourceId': 'ksb-1'},
            {'code': 'k1.1', 'sourceType': 'framework', 'sourceId': 'ksb-1'},
        ], 'mappings')

        self.assertEqual(errors[0]['message'], 'This KSB is already mapped to this component.')
