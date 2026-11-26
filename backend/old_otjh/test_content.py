from unittest.mock import patch, Mock
from django.test import SimpleTestCase, override_settings

from . import content, repository as repo, retained_content, live_attempts


class SourceContentTests(SimpleTestCase):
    def setUp(self):
        live = patch.object(live_attempts, 'read', return_value={})
        live.start()
        self.addCleanup(live.stop)
        self.learner = {'aptem_id': 42, 'lms_id': 8}
        self.row = {'id': 10, 'category': 'reading+quiz', 'title': 'Part3', 'source_ref': 'la:7:99', 'group_id': 7, 'activity_id': 99}
        self.definition = {'activity_id': 99, 'title': 'Part3', 'quiz_id': 99, 'quiz_questions': []}
        self.answers = {'activity_id': 99, 'group_id': 7, 'quiz_attempted': True, 'quiz_passed': True,
                        'quiz_score': 100, 'quiz_maximum_score': 100, 'quiz_attempt_number': 1,
                        'quiz_answers': [{'question_id': 1, 'question_body': 'What was reviewed?',
                                          'learner_answer': 'The record', 'correct_answer': 'The record', 'is_correct': True}]}
        content._cache.clear()
        content._preview_cache.clear()
        content._backup_cache.clear()
        content._auth_failure = None

    def resolve(self, definitions=None, snapshots=None, answers=None, row=None):
        def query(sql, params):
            if 'learner_source' in sql or 'lm.quiz_attempts' in sql:
                return []
            if 'lms_material_snapshots' in sql:
                return snapshots or []
            if 'activity_results' in sql:
                self.assertEqual(params[0], 8)
                return answers or []
            return definitions or []
        with patch.object(repo, 'query', side_effect=query), patch.object(content, 'live_material', return_value={'error': 'source_authentication'}) as live:
            result = content.resolve(self.learner, [row or self.row])
        return result[10], live

    def test_part3_quiz_uses_learner_answers_when_definition_questions_are_empty(self):
        result, live = self.resolve(definitions=[self.definition], answers=[self.answers])
        self.assertTrue(result['available'])
        self.assertIsNone(result['parts'][0]['url'])
        self.assertEqual(result['parts'][0]['quiz']['attempt']['quiz_body']['questions'][0]['learner_selected_answers'], ['The record'])
        live.assert_not_called()

    def test_snapshot_embed_restores_empty_legacy_text_definition(self):
        result, _ = self.resolve(definitions=[{'activity_id': 99, 'reading_text_body': ''}], snapshots=[{
            'material_id': 99, 'payload': '{"material_id":99,"iframe_url":"https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/99/text-body?token=test"}', 'source_url': None}])
        self.assertTrue(result['available'])
        self.assertIn('/99/text-body?', result['parts'][0]['url'])

    def test_quiz_permalink_does_not_embed_wordpress_login(self):
        result, _ = self.resolve(definitions=[self.definition], answers=[self.answers], snapshots=[{
            'material_id': 99, 'payload': {'content_type': 'quiz', 'iframe_url': 'https://kentbusinesscollege.org/quizzes/99/'}, 'source_url': None}])
        self.assertIsNone(result['parts'][0]['url'])
        self.assertTrue(result['available'])

    def test_missing_definition_is_not_silently_dropped_from_bundle(self):
        result, _ = self.resolve(row={**self.row, 'source_ref': 'rq:7:99:100'}, definitions=[self.definition], answers=[self.answers])
        self.assertEqual([p['id'] for p in result['parts']], [99, 100])
        self.assertFalse(result['available'])
        self.assertFalse(result['parts'][1]['available'])

    def test_saved_answers_can_restore_a_missing_quiz_definition(self):
        result, _ = self.resolve(answers=[self.answers])
        self.assertTrue(result['available'])
        self.assertEqual(result['parts'][0]['quiz']['attempt']['score'], 100)

    def test_another_groups_answers_never_fill_this_attempt(self):
        result, _ = self.resolve(definitions=[self.definition], answers=[{**self.answers, 'group_id': 777}])
        self.assertFalse(result['available'])
        self.assertIsNone(result['parts'][0]['quiz']['attempt'])

    def test_assignment_id_cannot_be_mistaken_for_lms_activity_id(self):
        with patch.object(repo, 'query') as query:
            result = content.resolve(self.learner, [{**self.row, 'category': 'assignment', 'documents': [{'id': 1}]}])
        query.assert_not_called()
        self.assertEqual(result[10], {'parts': [], 'available': True})

    def test_material_urls_reject_executable_and_credential_urls(self):
        for url in ('javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.org/file'):
            self.assertIsNone(content.http_url(url))

    def test_empty_assignment_blocks_review_but_register_row_is_reviewable(self):
        with patch.object(repo, 'query') as query:
            result = content.review(self.learner, [{**self.row, 'category': 'assignment', 'documents': []},
                                                  {**self.row, 'id': 11, 'category': 'attendance'}])
        query.assert_not_called()
        self.assertFalse(result['ready'])
        self.assertEqual([x['id'] for x in result['issues']], [10])

    @override_settings(KBC_LMS_API_KEY='test-key')
    def test_live_material_key_stays_on_fixed_origin_and_redirects_are_refused(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.return_value = b'{"material_id":99,"iframe_url":"https://example.org/file.pdf"}'
        with patch.object(content.urllib.request, 'build_opener') as build:
            build.return_value.open.return_value = response
            self.assertEqual(content.live_material(99)['material_id'], 99)
        request = build.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/material/99/schema')
        self.assertIsInstance(build.call_args.args[0], content.NoRedirect)

    def test_arbitrary_source_urls_are_never_fetched_server_side(self):
        with patch.object(content.urllib.request, 'build_opener') as build:
            self.assertIsNone(content.check_source('https://untrusted.example/private'))
        build.assert_not_called()

    def test_source_404_marks_part_unavailable(self):
        part = {'id': 99, 'url': 'https://kentbusinesscollege.org/file.pdf', 'available': True}
        with patch.object(content, 'check_source', return_value='source_unavailable'):
            content.validate_parts([part])
        self.assertFalse(part['available'])

    def test_explicit_reading_pair_is_scoped_to_group_and_not_duplicated(self):
        part = {'id': 99, 'title': 'Quiz', 'url': None, 'html': None, 'quiz': {'state': 'attempted'}}
        with patch.object(repo, 'query', return_value=[{'reading_activity_id': 100}]) as query, patch.object(content, 'catalogue', return_value={
            100: {'activity_id': 100, 'title': 'Reading', 'reading_iframe_url': 'https://example.org/reading.pdf'}
        }):
            result = content.add_companions(7, [part])
        self.assertEqual(query.call_args.args[1], [7, 99])
        self.assertEqual([p['id'] for p in result], [100, 99])

    def test_original_assignment_evidence_is_projected_without_writing(self):
        evidence = {'row_id': 10, 'month': '2026-07', 'evidence_id': 88, 'evidence_name': 'Essay.docx',
                    'file_blob': 'student/Essay.docx', 'report_blob': 'student/assessment.pdf', 'note_content': 'Learner reflection'}
        with patch.object(repo, 'query', side_effect=[[evidence], []]) as query:
            docs = repo.source_documents(self.learner, [10])
        self.assertEqual([d['source_kind'] for d in docs], ['file', 'report', 'note'])
        self.assertEqual(docs[1]['display_name'], 'Assessment report - Essay.pdf')
        self.assertEqual(query.call_args_list[0].args[1], [42, [10]])
        for call in query.call_args_list:
            self.assertTrue(call.args[0].lstrip().startswith('SELECT'))
            self.assertIn('deleted_at', call.args[0])

    def test_deleted_manual_document_is_not_resurrected_by_source_projection(self):
        evidence = {'row_id': 10, 'month': '2026-07', 'evidence_id': 88, 'evidence_name': 'Essay.docx',
                    'file_blob': 'student/Essay.docx', 'report_blob': None, 'note_content': None}
        with patch.object(repo, 'query', side_effect=[[evidence], [{'manual_activity_id': 10, 'blob_name': 'student/Essay.docx'}]]):
            self.assertEqual(repo.source_documents(self.learner, [10]), [])

    def test_live_shared_link_takes_precedence_over_old_snapshot(self):
        url, _ = content.display_content({'reading_iframe_url': 'https://example.org/updated.pdf',
            'material': {'iframe_url': 'https://example.org/old.pdf'}})
        self.assertEqual(url, 'https://example.org/updated.pdf')

    def test_empty_html_shell_does_not_count_as_content(self):
        for value in ('<p>&nbsp;</p>', '<script>something()</script>', '<!--content--><p> </p>'):
            self.assertFalse(content.meaningful_html(value))

    def test_working_authored_body_survives_an_expired_external_viewer(self):
        part = {'id': 99, 'url': 'https://kentbusinesscollege.org/old', 'html': '<p>Original lesson</p>', 'available': True}
        with patch.object(content, 'check_source', return_value='source_unavailable'), patch.object(content, 'live_material') as live:
            content.validate_parts([part])
        self.assertTrue(part['available'])
        self.assertIsNone(part['url'])
        live.assert_not_called()

    def test_retained_quiz_is_read_by_aptem_id_and_exact_component(self):
        attempt = {'component_id': 99, 'title': 'Retained quiz', 'quiz_body': {'questions': [
            {'question_id': 1, 'question_text': 'Original question', 'learner_selected_answers': ['Original answer']}]}}
        with patch.object(repo, 'query', side_effect=[[], [{'component_id': '99', 'attempt': attempt}]]) as query:
            result = retained_content.read(self.learner, {99})
        self.assertEqual(query.call_args_list[0].args[1], [42, 42, ['99']])
        self.assertEqual(query.call_args_list[1].args[1], [42, ['99']])
        self.assertEqual(result[99]['quiz']['attempt']['quiz_body']['questions'][0]['learner_selected_answers'], ['Original answer'])

    def test_mismatched_retained_attempt_payload_is_rejected(self):
        with patch.object(repo, 'query', side_effect=[[], [{'component_id': '99', 'attempt': {
            'component_id': 100, 'quiz_body': {'questions': [{'question_text': 'Wrong activity'}]}}}]]):
            self.assertEqual(retained_content.read(self.learner, {99}), {})

    def test_retained_quiz_restores_missing_catalogue_without_live_api(self):
        saved = {'urls': [], 'groups': set(), 'quiz': {'state': 'attempted', 'attempt': {'quiz_body': {
            'questions': [{'question_text': 'A retained question'}]}}}}
        with patch.object(retained_content, 'read', return_value={99: saved}):
            result, live = self.resolve()
        self.assertTrue(result['available'])
        self.assertEqual(result['parts'][0]['quiz'], saved['quiz'])
        live.assert_not_called()

    def test_retained_quiz_cannot_override_an_explicit_different_group(self):
        saved = {'urls': [], 'groups': {'777'}, 'quiz': {'state': 'attempted', 'attempt': {'quiz_body': {
            'questions': [{'question_text': 'Wrong group'}]}}}}
        with patch.object(retained_content, 'read', return_value={99: saved}):
            result, _ = self.resolve()
        self.assertFalse(result['available'])

    def test_reading_body_is_used_if_legacy_and_snapshot_urls_both_fail(self):
        part = {'id': 99, 'url': 'https://kentbusinesscollege.org/old', 'alternate_urls': ['https://kentbusinesscollege.org/snapshot'],
                'html': '<p>Retained reading</p>', 'available': True}
        with patch.object(content, 'check_source', return_value='source_unavailable'):
            content.validate_parts([part])
        self.assertTrue(part['available'])
        self.assertNotIn('alternate_urls', part)

    def test_get_only_material_retries_head_without_any_api_key(self):
        from urllib.error import HTTPError
        with patch.object(content.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = [HTTPError('https://kentbusinesscollege.org/file',405,'',{},None), Mock()]
            content.open_source('https://kentbusinesscollege.org/file')
        requests = [call.args[0] for call in build.return_value.open.call_args_list]
        self.assertEqual([r.method for r in requests], ['HEAD','GET'])
        self.assertTrue(all('X-kbc-api-key' not in r.headers for r in requests))

    def test_file_redirect_may_stay_on_kbc_but_cannot_reach_login_or_another_host(self):
        from urllib.error import HTTPError
        for target in ('/wp-admin/', '/wp-login.php', '/', 'https://external.example/file'):
            with patch.object(content.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = HTTPError('https://kentbusinesscollege.org/file',302,'',{'Location':target},None)
                with self.assertRaises(ValueError):
                    content.open_source('https://kentbusinesscollege.org/file')
                self.assertEqual(build.return_value.open.call_count, 1)
        with patch.object(content.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = [HTTPError('https://kentbusinesscollege.org/file',302,'',{'Location':'/wp-content/uploads/file.pdf'},None), Mock()]
            content.open_source('https://kentbusinesscollege.org/file')
            self.assertEqual(build.return_value.open.call_args.args[0].full_url, 'https://kentbusinesscollege.org/wp-content/uploads/file.pdf')

    def test_saved_material_file_restores_a_broken_viewer_without_exposing_storage_fields(self):
        backup = {'material_id': 99, 'blob_container': 'private-source', 'blob_name': 'source.pdf', 'blob_content_type': 'application/pdf'}
        part = {'id': 99, 'url': 'https://kentbusinesscollege.org/expired', 'html': None, 'available': True,
                '_backup': backup, 'document': content.backup_document(self.learner, {**self.row, 'month': '2026-07'}, backup)}
        with patch.object(content, 'check_source', return_value='source_unavailable'), patch.object(content, 'backup_available', return_value=True), patch.object(content, 'live_material') as live:
            content.validate_parts([part])
        self.assertTrue(part['available'])
        self.assertIsNone(part['url'])
        self.assertIn('/material-documents/10/99/?aptem_id=42&month=2026-07', part['document']['url'])
        self.assertNotIn('_backup', part)
        self.assertNotIn('blob_name', str(part))
        live.assert_not_called()

    def test_missing_backup_file_cannot_pass_the_review_gate(self):
        part = {'id': 99, 'url': None, 'html': None, 'available': True, '_backup': {'material_id': 99}}
        with patch.object(content, 'backup_available', return_value=False):
            content.validate_parts([part])
        self.assertFalse(part['available'])

    def test_office_shell_does_not_hide_a_missing_original_file(self):
        from urllib.error import HTTPError
        url = 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fkentbusinesscollege.org%2Ffile.docx'
        with patch.object(content, 'open_source', side_effect=HTTPError('https://kentbusinesscollege.org/file.docx',404,'',{},None)) as opened:
            self.assertEqual(content.check_source(url), 'source_unavailable')
        opened.assert_called_once_with('https://kentbusinesscollege.org/file.docx')

    def test_live_quiz_definition_is_previewable_without_fabricating_an_attempt(self):
        material = {'material_id': 99, 'content_type': 'quiz', 'quiz': {
            'quiz_body': '<p>Read each question</p>', 'questions': [{'question_id': 1,
                'question_body': 'Original question', 'options': [{'option_body': 'A', 'is_correct': True}]}],
            'solutions': [{'learner_answer': 'Never a learner answer'}]}}
        result, _ = self.resolve(snapshots=[{'material_id': 99, 'payload': material}])
        part = result['parts'][0]
        self.assertFalse(part['available'])
        self.assertIsNone(part['quiz']['attempt'])
        self.assertEqual(part['quiz']['definition']['questions'][0]['question_text'], 'Original question')
        self.assertNotIn('is_correct', part['quiz']['definition']['questions'][0]['answer_options'][0])
        self.assertNotIn('Never a learner answer', str(part))

    def test_a_score_and_definition_without_saved_answers_cannot_enable_signing(self):
        definition = {**self.definition, 'quiz_questions': [{'question_id': 1, 'question_body': 'Original question'}]}
        result, _ = self.resolve(definitions=[definition], answers=[{**self.answers, 'quiz_answers': []}])
        self.assertFalse(result['available'])
        self.assertFalse(result['parts'][0]['quiz']['answers_available'])

    def test_explicit_missing_companion_stays_visible_and_blocks_completion(self):
        part = {'id': 99, 'title': 'Quiz', 'url': None, 'html': None, 'quiz': {'state': 'attempted'}, 'available': True}
        with patch.object(repo, 'query', return_value=[{'reading_activity_id': 100}]), patch.object(content, 'catalogue', return_value={}), patch.object(content, 'live_material', return_value={'error': 'source_unavailable'}):
            result = content.add_companions(7, [part])
        self.assertEqual([p['id'] for p in result], [100, 99])
        self.assertFalse(result[0]['available'])

    def test_audio_player_shell_must_reference_an_available_audio_file(self):
        from urllib.error import HTTPError
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.headers = {'Content-Type': 'text/html'}
        response.geturl.return_value = 'https://kentbusinesscollege.org/material/99/audio-player'
        response.read.return_value = b'<audio><source src="https://kentbusinesscollege.org/missing.mp3"></audio>'
        with patch.object(content, 'open_source', side_effect=[response, HTTPError('https://kentbusinesscollege.org/missing.mp3', 404, '', {}, None)]):
            self.assertEqual(content.check_source(response.geturl()), 'source_unavailable')

    def test_pdf_at_an_extensionless_material_endpoint_bypasses_office(self):
        url = 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fkentbusinesscollege.org%2Fmaterial%2F99%2Fview%3Ftoken%3Dtest'
        actual, _ = content.display_content({'reading_iframe_url': url, 'reading_type': 'pdf'})
        self.assertEqual(actual, 'https://kentbusinesscollege.org/material/99/view?token=test')

    def test_fresh_original_attempt_restores_only_the_requested_identity(self):
        with patch.object(live_attempts, 'read', return_value={(7, 99): self.answers}) as read:
            result, _ = self.resolve(definitions=[self.definition])
        read.assert_called_once_with(self.learner, {(7, 99)})
        self.assertTrue(result['available'])
        self.assertEqual(result['parts'][0]['quiz']['attempt']['score'], 100)
