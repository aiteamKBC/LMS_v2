"""Exercise the real rename endpoints with isolated storage and no network/DB."""
import copy
import json
from contextlib import nullcontext
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views


class EntityRenameTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.stub('invalidate_curriculum_cache')
        self.stub('log_curriculum_decision')
        self.enterContext(patch.object(views.transaction, 'atomic', side_effect=lambda: nullcontext()))
        self.stub('lock_record_row')

    def stub(self, name, **kwargs):
        return self.enterContext(patch.object(views, name, **kwargs))

    def request(self, payload=None):
        return self.factory.patch('/synthetic/', json.dumps(payload or {'name': 'New name'}),
                                  content_type='application/json')

    def assert_programme_rename(self, name):
        stored = {'programme_id': 'PROG-1', 'program_id': 'PROG-1', 'name': 'Old name',
                  'level': 'LVL-4', 'status': 'active', 'required_otjh': 432}
        self.stub('ensure_program_config_archive_columns')
        self.stub('programme_config_by_identifier', return_value=stored)
        self.stub('programme_config_key_column', return_value='programme_id')
        self.stub('programme_config_id', return_value='PROG-1')
        self.stub('programme_record_revision', return_value='rev-1')
        self.stub('first_programme_response', return_value={'id': 'PROG-1', 'name': name})
        children = self.stub('propagate_programme_name')
        write = self.stub('update_rows')
        with patch('curriculum_api.placement_rename.propagate_programme_name_to_learners') as learners:
            response = views.curriculum_programme_detail(self.request({'name': name}), 'PROG-1')
        self.assertEqual(response.status_code, 200, response.content)
        args = write.call_args.args
        self.assertEqual(args[:3], ('programmes', '"programme_id" = %s', ['PROG-1']))
        self.assertEqual(set(args[3]), {'name', 'updated_at'})
        self.assertEqual(args[3]['name'], name)
        children.assert_called_once_with('PROG-1', name)
        learners.assert_called_once_with('PROG-1', 'Old name', name)

    def test_programme_rename_updates_only_its_label_by_id(self):
        self.assert_programme_rename('New name')

    def test_programme_case_only_rename_also_refreshes_child_labels(self):
        self.assert_programme_rename('OLD NAME')

    def test_cohort_rename_preserves_dates_status_and_parent_links(self):
        stored = {'cohort_id': 'COH-1', 'cohort_name': 'Old name', 'programme_id': 'PROG-1',
                  'start_date': '2026-09-01', 'end_date': '2027-08-31',
                  'apprenticeship_end_date': '2027-11-30', 'status': 'planned',
                  'duration_months': 12, 'epa_months': 3, 'group_ids': ['GRP-1']}
        self.stub('resolve_cohort_row', return_value=stored)
        self.stub('fetch_cohort_row', return_value=stored)
        self.stub('cohort_record_revision', return_value='rev-2')
        write = self.stub('update_cohort_fields')
        with patch('curriculum_api.cohort_rename.propagate_cohort_name') as children:
            response = views.curriculum_cohort_detail(self.request(), 'COH-1')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(write.call_args.args, ('COH-1', {'cohort_name': 'New name'}))
        children.assert_called_once_with(stored, 'New name')

    def test_group_rename_does_not_replan_modules_or_repair_relationships(self):
        stored = {'group_id': 'GRP-1', 'group_name': 'Old name', 'cohort_id': 'COH-1',
                  'programme_id': 'PROG-1', 'session_week_day': 'Tuesday',
                  'session_start_time': '11:00', 'session_end_time': '13:00'}
        self.stub('resolve_group_row', return_value=stored)
        write = self.stub('update_group_fields', return_value={**stored, 'group_name': 'New name'})
        self.stub('group_record_revision', return_value='rev-2')
        replan = self.stub('persist_group_module_session_dates')
        repair = self.stub('repair_curriculum_parent_links')
        resync = self.stub('resync_group_module_delivery_counts')
        calendars = self.stub('stale_teams_calendar_modules')
        with patch('curriculum_api.placement_rename.propagate_group_name_to_learners') as children:
            response = views.curriculum_group_detail(self.request(), 'GRP-1')
        self.assertEqual(response.status_code, 200, response.content)
        write.assert_called_once_with('GRP-1', {'group_name': 'New name'})
        children.assert_called_once_with(stored, 'New name')
        for operation in (replan, repair, resync, calendars):
            operation.assert_not_called()
        self.assertEqual(json.loads(response.content)['teamsCalendarsToUpdate'], [])

    def module_fixture(self):
        stored = {'module_catalogue_id': 'MOD-1', 'title': 'Old name', 'group_id': 'GRP-1',
                  'cohort_id': 'COH-1', 'programme_id': 'PROG-1', 'sessions_number': 8,
                  'session_week_day': 'Tuesday', 'session_start_time': '11:00', 'session_end_time': '13:00'}
        other = {**stored, 'module_catalogue_id': 'MOD-2', 'title': 'Other module'}
        structure = {'catalogueId': 'MOD-1', 'title': 'Old name', 'groupId': 'GRP-1',
                     'cohortId': 'COH-1', 'programmeId': 'PROG-1', 'sessionsNumber': 8,
                     'weeksNumber': 1, 'startDate': '2026-09-01', 'endDate': '2026-11-01',
                     'weekStructure': [{'id': 'WEEK-1', 'title': 'Week 1', 'weekNumber': 1,
                                        'components': [{'id': 'COMP-1', 'type': 'live-session',
                                                        'title': 'Session', 'settings': {
                                                            'meetingId': 'MEETING-1', 'eventId': 'EVENT-1',
                                                            'date': '2026-09-29', 'joinUrl': 'https://example.invalid/join'}}]}]}
        self.stub('resolve_stored_module_catalogue_id', return_value='MOD-1')
        self.stub('authoring_module_exists', return_value=stored)
        self.stub('module_structure_revision', return_value='rev-1')
        self.stub('get_authoring_structure_payload', side_effect=lambda _: copy.deepcopy(structure))
        archived = self.stub('archived_programme_module_edit_error', return_value=None)
        self.stub('lock_module_structure_row')
        save = self.stub('save_module_authoring_structure')
        calendars = self.stub('stale_teams_calendar_modules')
        notify = self.stub('notify_staff_assignment_change')
        self.stub('authoring_fetch_all', return_value=[stored, other])
        self.stub('surviving_authoring_module_rows', side_effect=lambda rows: rows)
        group_write = self.stub('update_group_fields')

        def update(table, where, params, values):
            self.assertEqual((table, where, params), (views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-1']))
            stored.update(values)
            structure['title'] = stored['title']
            return [stored]

        write = self.stub('update_authoring_rows', side_effect=update)
        return stored, other, structure, write, group_write, save, calendars, notify, archived

    def test_module_rename_preserves_ids_live_sessions_and_other_modules(self):
        stored, other, structure, write, group_write, save, calendars, notify, _ = self.module_fixture()
        before = copy.deepcopy(structure)
        other_before = copy.deepcopy(other)
        response = views.curriculum_module_detail(self.request(), 'MOD-1')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(set(write.call_args.args[3]), {'title', 'updated_at'})
        self.assertEqual(stored['module_catalogue_id'], 'MOD-1')
        self.assertEqual(other, other_before)
        self.assertEqual(structure, {**before, 'title': 'New name'})
        self.assertEqual(group_write.call_args.args[0], 'GRP-1')
        self.assertEqual(set(group_write.call_args.args[1]), {'module_names'})
        self.assertEqual(views.parse_json_value(group_write.call_args.args[1]['module_names'], []), ['New name', 'Other module'])
        for operation in (save, calendars, notify):
            operation.assert_not_called()
        body = json.loads(response.content)
        self.assertEqual(body['module']['weekStructure'], before['weekStructure'])
        self.assertEqual(body['teamsCalendarsToUpdate'], [])

    def test_module_rename_still_rejects_a_stale_revision(self):
        _, _, _, write, group_write, _, _, _, _ = self.module_fixture()
        response = views.curriculum_module_detail(self.request({'name': 'New name', 'expectedRevision': 'stale'}), 'MOD-1')
        self.assertEqual(response.status_code, 409, response.content)
        write.assert_not_called()
        group_write.assert_not_called()

    def test_module_rename_keeps_the_archived_programme_guard(self):
        _, _, _, write, _, _, _, _, archived = self.module_fixture()
        archived.return_value = views.json_error('Archived programme', status=409)
        response = views.curriculum_module_detail(self.request(), 'MOD-1')
        self.assertEqual(response.status_code, 409, response.content)
        write.assert_not_called()

    def test_schedule_fields_are_not_mistaken_for_a_rename(self):
        self.assertTrue(views.curriculum_name_only_patch({'name': 'New', 'expectedRevision': 'rev-1'}))
        self.assertTrue(views.curriculum_name_only_patch({'title': 'New'}, allow_title=True))
        for payload in ({'name': 'New', 'weekDays': 'Monday'}, {'name': 'New', 'groupId': 'GRP-2'},
                        {'name': ''}, {'title': 'New'}):
            self.assertFalse(views.curriculum_name_only_patch(payload), payload)
