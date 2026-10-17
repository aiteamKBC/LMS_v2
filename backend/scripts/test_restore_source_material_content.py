"""Content recovery boundaries; synthetic inputs, no DB or HTTP."""
from copy import deepcopy
from types import SimpleNamespace
import json
import unittest
import urllib.error
from unittest.mock import Mock, patch

import restore_source_material_content as recovery


class MaterialContentRecoveryTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start(); self.addCleanup(guard.stop)
        guard = patch.object(recovery.subject_content, 'settings', SimpleNamespace(
            KBC_LMS_API_KEY='synthetic-secret', KBC_LMS_SCHEMA_URL='https://source.test/all-students-schema'))
        guard.start(); self.addCleanup(guard.stop)
        self.definition = {'source_activity_id': 'material:10', 'source_activity_title': 'Lesson', 'source_material_id': None}
        self.schema = {'material_id': 10, 'material_title': 'Lesson', 'component_type': 'lesson',
                       'content_type': 'recording', 'iframe_url': 'https://video.test/lesson', 'source': {}}

    def test_missing_video_is_playable_and_does_not_import_learner_results(self):
        self.schema.update(completed=True, user_id=1, time_spent_seconds=999)
        result = recovery.material_values(self.definition, None, self.schema)
        rendered = recovery.stored_definition(result)
        self.assertTrue(rendered['available'])
        self.assertEqual(rendered['media'][0]['kind'], 'video')
        self.assertNotIn('completed', result['payload'])
        self.assertNotIn('user_id', result['payload'])
        self.assertNotIn('time_spent_seconds', result['payload'])

    def test_inline_reading_has_no_expiring_source_viewer_dependency(self):
        self.schema.update(content_type='text', text_body='<p>Authored content</p>',
                           iframe_url='https://source.test/text-body?token=temporary')
        result = recovery.material_values(self.definition, None, self.schema)
        self.assertIsNone(result['source_url'])
        self.assertEqual(recovery.stored_definition(result)['media'], [])
        self.assertEqual(recovery.stored_definition(result)['reading_html'], '<p>Authored content</p>')
        self.assertNotIn('temporary', str(result))

    def test_placeholder_history_and_unrelated_metadata_are_preserved(self):
        existing = {'material_id': 10, 'source_system': 'old_lms', 'deleted_at': None,
                    'payload': {'historical_only': True, 'completed': True,
                                'completion_records': [{'source': 'retained'}], 'configured_duration': 20}}
        original = deepcopy(existing)
        result = recovery.material_values(self.definition, existing, self.schema)
        self.assertEqual(existing, original)
        for key in ('completed', 'completion_records', 'configured_duration'):
            self.assertEqual(result['payload'][key], existing['payload'][key])
        self.assertFalse(result['payload']['historical_only'])
        self.assertFalse(recovery.needs_content({**existing, **result}))

    def test_wrong_id_quiz_namespace_and_conflicting_link_are_rejected(self):
        for definition, schema in [
            (self.definition, {**self.schema, 'material_id': 11}),
            ({**self.definition, 'source_activity_id': 'quiz:10'}, self.schema),
            ({**self.definition, 'source_material_id': 11}, self.schema),
        ]:
            with self.subTest(definition=definition, schema=schema):
                with self.assertRaises(ValueError):
                    recovery.material_values(definition, None, schema)

    def test_json_encoded_historical_payload_retains_its_saved_fields(self):
        existing = {'material_id': 10, 'source_system': 'old_lms', 'deleted_at': None,
                    'payload': json.dumps({'historical_only': True, 'completed': True, 'source': 'historical'})}
        self.assertTrue(recovery.needs_content(existing))
        restored = recovery.material_values(self.definition, existing, self.schema)
        self.assertTrue(restored['payload']['completed'])

    def test_existing_authored_or_archived_content_is_not_overwritten(self):
        for extra in ({'payload': {'text_body': 'Existing lesson'}},
                      {'backup_status': 'available', 'blob_container': 'files', 'blob_name': 'lesson.pdf'},
                      {'payload': {'historical_only': True, 'source': {'attachments': [{'attachment_id': 1}]}}}):
            existing = {'material_id': 10, 'source_system': 'old_lms', 'deleted_at': None, **extra}
            self.assertFalse(recovery.needs_content(existing))
            with self.assertRaises(ValueError):
                recovery.material_values(self.definition, existing, self.schema)

    def test_unsafe_or_empty_source_is_not_marked_restored(self):
        for url in ('javascript:alert(1)', 'https://source.test/?api_key=synthetic-secret', ''):
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    recovery.material_values(self.definition, None, {**self.schema, 'iframe_url': url})

    def test_source_404_is_reported_without_fabricating_content(self):
        with patch.object(recovery, 'fetch_schema', side_effect=urllib.error.HTTPError(
                'https://source.test/private-url', 404, 'Not found', {}, None)):
            ident, schema, error = recovery.fetch_result(10)
        self.assertEqual(ident, 10)
        self.assertIsNone(schema)
        self.assertEqual(error['http_status'], 404)
        self.assertNotIn('private-url', str(error))

    def test_source_access_refusal_stops_further_requests(self):
        for status in (401, 403, 429):
            with self.subTest(status=status):
                with patch.object(recovery, 'fetch_result', return_value=(10, None,
                        {'material_id': 10, 'http_status': status})) as fetch:
                    results = recovery.fetch_results([10, 11, 12], delay=0)
                fetch.assert_called_once_with(10)
                self.assertEqual(results[1][2]['error_type'], 'SourceRequestsStopped')
                self.assertEqual(results[2][2]['blocked_by_http_status'], status)
                self.assertIsNone(results[2][2]['http_status'])

    def test_login_only_link_is_not_counted_as_restored_content(self):
        schema = {**self.schema, 'source': {'requires_lms_login': True}}
        with patch.object(recovery, 'fetch_schema', return_value=schema):
            ident, content, error = recovery.fetch_result(10)
        self.assertEqual(ident, 10)
        self.assertIsNone(content)
        self.assertEqual(error['error_type'], 'OriginalLoginRequired')
        with patch.object(recovery, 'fetch_schema', return_value={**schema, 'text_body': 'Real brief'}):
            self.assertIsNone(recovery.fetch_result(10)[2])

    def test_missing_material_does_not_stop_other_materials_and_requests_are_paced(self):
        with patch.object(recovery, 'fetch_result', side_effect=[
                (10, None, {'material_id': 10, 'http_status': 404}),
                (11, {'material_id': 11}, None)]) as fetch:
            with patch.object(recovery.time, 'sleep') as sleep:
                results = recovery.fetch_results([10, 11], delay=2)
        self.assertEqual(fetch.call_count, 2)
        sleep.assert_called_once_with(2)
        self.assertEqual(results[1][1]['material_id'], 11)

    def test_material_allowlist_preserves_unselected_catalogue_for_verification(self):
        definitions = [
            {'source_activity_id': 'material:10'},
            {'source_activity_id': 'material:11'},
        ]
        cursor = Mock()
        cursor.execute.side_effect = [Mock(fetchall=lambda: definitions), Mock(fetchall=lambda: [])]
        state = {'courses': [{'id': 1, 'source_course_ref': '20'}]}
        args = SimpleNamespace(aptem_id=1, course_ids=[20], material_ids=[10])
        with patch.object(recovery, 'learner_state', return_value=state):
            _, inventory, _, selected = recovery.read_scope(cursor, args)
        self.assertEqual(inventory, definitions)
        self.assertEqual(selected, [(definitions[0], None)])

    def test_pdf_companion_manifest_is_retained_and_viewer_uses_pdf_route(self):
        self.schema.update(content_type='pdf',
            iframe_url='https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fsource.test%2Fwp-json%2Fkbc-lms%2Fv1%2Fmaterial%2F10%2Fview%3Fattachment_id%3D20',
            source={'attachments': [{'attachment_id': 20, 'mime_type': 'application/pdf'}, {'attachment_id': 21}]})
        result = recovery.material_values(self.definition, None, self.schema)
        self.assertEqual(len(result['payload']['source']['attachments']), 2)
        self.assertEqual(recovery.stored_definition(result)['media'][0]['kind'], 'pdf')


class LinkedAssignmentRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.guard = patch.object(recovery.subject_content, 'settings', SimpleNamespace(
            KBC_LMS_API_KEY='synthetic', KBC_LMS_SCHEMA_URL='https://source.test/schema'))
        self.guard.start(); self.addCleanup(self.guard.stop)
        self.file = '/curriculum_api/curriculum/uploads/assignments/brief.pdf'
        self.definition = {'source_activity_id': 'material:10', 'source_activity_type': 'assignment',
                           'source_activity_title': 'Case assignment', 'source_course_id': 20,
                           'source_section_title': 'Week 07: Structure', 'source_material_id': None}
        self.course = {'id': 20, 'source_course_ref': '30', 'curriculum_module_ref': 'MODULE'}
        self.week = {'id': 'WEEK', 'module_catalogue_id': 'MODULE', 'title': 'Week 07: Structure',
                     'week_number': 8, 'deleted_at': None}
        self.component = {'id': 'COMPONENT', 'module_catalogue_id': 'MODULE', 'week_id': 'WEEK',
            'type': 'assignment', 'title': 'Case assignment', 'deleted_at': None,
            'settings_json': {'assignmentBrief': '<p>Case task</p><a href="' + self.file + '">Brief</a>',
                              'assignmentFileUrl': self.file, 'unrelated': 'retain'} }

    def build(self, **changes):
        return recovery.linked_assignment_schema(changes.get('definition', self.definition),
            changes.get('course', self.course), changes.get('component', self.component),
            changes.get('week', self.week))

    def test_matching_teaching_week_survives_holiday_ordinal_shift(self):
        original = deepcopy(self.component)
        schema, files = self.build()
        self.assertEqual(self.component, original)
        self.assertEqual(files, [self.file])
        self.assertEqual(schema['source']['provider'], 'linked_curriculum_snapshot')
        self.assertNotIn('unrelated', str(schema))
        stored = recovery.material_values(self.definition, None, schema)
        player = recovery.stored_definition(stored)
        self.assertTrue(player['available'])
        self.assertIn('Case task', player['reading_html'])
        self.assertEqual(player['media'][0]['url'], self.file)

    def test_wrong_module_title_type_or_week_cannot_supply_content(self):
        for changes in ({'module_catalogue_id': 'OTHER'}, {'title': 'Other assignment'},
                        {'type': 'reading'}, {'week_id': 'OTHER'}, {'deleted_at': 'deleted'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.build(component={**self.component, **changes})
        with self.assertRaises(ValueError):
            self.build(week={**self.week, 'title': 'Week 08: Structure'})
        with self.assertRaises(ValueError):
            self.build(definition={**self.definition, 'source_course_id': 99})

    def test_missing_brief_and_unverified_file_paths_are_rejected(self):
        settings = self.component['settings_json']
        for path in ('https://source.test/brief.pdf', '/curriculum_api/curriculum/uploads/../private',
                     '/curriculum_api/curriculum/uploads/%2e%2e/private', self.file + '?token=secret'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.build(component={**self.component, 'settings_json': {**settings, 'assignmentFileUrl': path}})
        with self.assertRaises(ValueError):
            self.build(component={**self.component, 'settings_json': {**settings, 'assignmentBrief': ''}})


if __name__ == '__main__':
    unittest.main()
