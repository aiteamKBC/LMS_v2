"""Synthetic recovery regressions; persistence and storage are mocked."""
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase

from . import recovered_activity_content as recovery
from . import canonical_learning as canonical


class RecoveredActivityContentTests(SimpleTestCase):
    def setUp(self):
        self.owner = {'id': 7, 'enrolment_id': 9}
        self.record = {'id': 20, 'source_system': 'old_lms', 'component_type': 'old_lms_recovered',
            'kind': 'reading_quiz', 'source_activity_id': 'old_lms:actual:reading_quiz:30:2026-06',
            'source_payload': {'old_schema': {'kind': 'reading_quiz', 'ref': '30', 'month': '2026-06'}},
            'component_title': 'Recovered Old LMS 30', 'actual_seconds': 1848,
            'accepted': True, 'reporting_month': '2026-06', 'ksbs': []}
        self.material = {'progress_id': 20, 'material_record_id': 40, 'material_id': 30,
            'material_title': 'Original learning activity', 'material_payload': {
                'reading_text_body': '<p>Original reading.</p>', 'quiz_questions': [
                    {'question_id': 1, 'question_text': 'Example question?',
                     'correct_answer': 'Do not expose', 'options': [{'option_text': 'Example', 'correct': True}]}]},
            'material_content_type': 'reading_quiz', 'material_backup_status': 'pending'}
        self.item = {'id': 50, 'title': 'Recovered Old LMS 30', 'category': 'Old Lms Recovered'}

    def test_exact_original_reference_required_and_media_namespace_preserved(self):
        self.assertEqual(recovery.reference(self.record), 30)
        for change in ({'source_system': 'journal'}, {'component_type': 'reading'}, {'kind': 'video'},
                       {'source_activity_id': 'material:30'}, {'source_activity_id': 'old_lms:actual:reading_quiz:31:2026-06'},
                       {'source_activity_id': 'old_lms:actual:reading_quiz:30:2026-07'}, {'source_payload': []}):
            self.assertIsNone(recovery.reference({**self.record, **change}))
        video = deepcopy(self.record)
        video.update(kind='video', source_activity_id='old_lms:actual:media:30:2026-06')
        video['source_payload']['old_schema']['kind'] = 'video'
        self.assertEqual(recovery.reference(video), 30)

    def test_no_recovery_marker_means_no_title_or_content(self):
        with patch.object(recovery, 'query', return_value=[]) as query:
            self.assertEqual(recovery.titles(self.owner, [self.record]), {})
            self.assertEqual(recovery.material_parts(self.item, self.owner, self.record), [])
        sql, params = query.call_args.args
        self.assertEqual(params, [7, [20]])
        for predicate in ('p.learner_id=%s', 's.learner_id=p.learner_id', "->>'version'='1'",
                          "->>'basis'='verified-old-schema-reference'", 's.source_activity_id=p.source_activity_id'):
            self.assertIn(predicate, sql)

    def test_unrelated_records_do_not_read_recovery_links(self):
        with patch.object(recovery, 'query') as query:
            self.assertEqual(recovery.titles(self.owner, [{'id': 1, 'component_type': 'reading'}]), {})
        query.assert_not_called()

    def test_mismatched_material_and_ambiguous_links_fail_closed(self):
        for rows in ([{**self.material, 'material_id': 31}], [self.material, {**self.material, 'material_record_id': 41}],
                     [{**self.material, 'progress_id': 99}]):
            with self.subTest(rows=len(rows)), patch.object(recovery, 'query', return_value=rows):
                self.assertEqual(recovery.titles(self.owner, [self.record]), {})

    def test_text_and_original_questions_render_without_invented_attempt_or_answers(self):
        before = deepcopy(self.record)
        with patch.object(recovery, 'query', return_value=[self.material]):
            part = recovery.material_parts(self.item, self.owner, self.record)[0]
        self.assertEqual(part['title'], 'Original learning activity')
        self.assertEqual(part['html'], '<p>Original reading.</p>')
        self.assertIsNone(part['quiz']['attempt'])
        self.assertFalse(part['quiz']['answers_available'])
        question = part['quiz']['definition']['questions'][0]
        self.assertNotIn('correct_answer', question)
        self.assertEqual(question['answer_options'], [{'option_text': 'Example'}])
        self.assertEqual(self.record, before)

    def test_video_uses_original_safe_url_when_no_stored_file_exists(self):
        material = {**self.material, 'material_content_type': 'video',
                    'material_payload': {'video_iframe_url': 'https://example.test/original-video'}}
        with patch.object(recovery, 'query', return_value=[material]):
            part = recovery.material_parts(self.item, self.owner, self.record)[0]
        self.assertEqual(part['url'], 'https://example.test/original-video')
        self.assertIsNone(part['content_type'])

    def test_original_description_is_retained_without_inventing_missing_questions(self):
        material = {**self.material, 'material_payload': {'quiz_body': '<p>Original instructions.</p>', 'quiz_questions': []}}
        with patch.object(recovery, 'query', return_value=[material]):
            part = recovery.material_parts(self.item, self.owner, self.record)[0]
        self.assertIn('<p>Original instructions.</p>', part['html'])
        self.assertIn('questions are not currently available', part['html'])
        self.assertIsNone(part['quiz'])

    def test_cleared_media_is_not_restored_from_generic_url(self):
        material = {**self.material, 'material_content_type': 'video', 'material_payload': {
            'lms_cleared_media_fields': ['video_iframe_url'], 'iframe_url': 'https://example.test/removed'}}
        with patch.object(recovery, 'query', return_value=[material]):
            part = recovery.material_parts(self.item, self.owner, self.record)[0]
        self.assertIsNone(part['url'])
        self.assertIn('not currently available', part['html'])

    def test_unsafe_urls_do_not_reach_player(self):
        for value in ('javascript:alert(1)', '//example.test/file', 'https://user:secret@example.test/file',
                      'https://example.test/\nfile', '<iframe src="https://example.test"></iframe>'):
            self.assertIsNone(recovery.safe_url(value))

    def test_private_backup_reuses_existing_storage_signer(self):
        material = {**self.material, 'material_backup_status': 'available',
            'material_blob_container': 'private', 'material_blob_name': 'test.pdf',
            'material_blob_content_type': 'application/pdf'}
        with patch.object(recovery, 'query', return_value=[material]), \
             patch('learner_api.material_storage.read_url', return_value='https://example.test/signed') as signer:
            part = recovery.material_parts(self.item, self.owner, self.record)[0]
        self.assertEqual(part['url'], 'https://example.test/signed')
        self.assertEqual(part['content_type'], 'application/pdf')
        signer.assert_called_once()

    def test_monthly_display_changes_title_only_preserving_signed_learning_facts(self):
        before = deepcopy(self.record)
        with patch.object(canonical, 'query', return_value=[]), patch.object(recovery, 'query', return_value=[]):
            old_row = canonical.rows_for(self.owner, [self.record])[0]
        with patch.object(canonical, 'query', return_value=[]), patch.object(recovery, 'query', return_value=[self.material]):
            new_row = canonical.rows_for(self.owner, [self.record])[0]
        self.assertEqual(new_row, {**old_row, 'title': 'Original learning activity'})
        self.assertEqual(self.record, before)

    def test_canonical_material_view_uses_recovered_route(self):
        with patch.object(recovery, 'query', return_value=[self.material]), patch.object(canonical, 'query') as query:
            parts = canonical.material_parts(self.item, self.owner, self.record)
        self.assertEqual(parts[0]['title'], 'Original learning activity')
        query.assert_not_called()
