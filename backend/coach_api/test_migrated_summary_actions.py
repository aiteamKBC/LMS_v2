"""Synthetic upload/generation regressions. No external requests or real artifacts."""
from copy import deepcopy
from inspect import unwrap
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase
from django.urls import resolve

from . import migrated_summary_upload as upload_api, migrated_intelligence_views as intelligence, views
from .migrated_summary_generation import parse_upload, summary_binding_response
from . import test_migrated_summary_binding as fixtures
from .test_migrated_summary_binding import OWNER


VTT = b'WEBVTT\nKind: captions\n\ncue-guid\n00:00:01.000 --> 00:00:03.000\n<v Coach>We agreed the next action.</v>\n\n2\n00:00:03.000 --> 00:00:05.000\n<v Learner>I will provide evidence.</v>\n'


class MigratedTranscriptValidationTests(SimpleTestCase):
    def test_vtt_reuses_speaker_extraction_without_headers_ids_or_timing(self):
        text, provenance = parse_upload(SimpleUploadedFile('meeting.vtt', VTT, 'text/vtt'))
        self.assertEqual(text, 'Coach: We agreed the next action.\nLearner: I will provide evidence.')
        self.assertEqual(provenance['contentHash'], hashlib.sha256(VTT).hexdigest())
        self.assertEqual(provenance['source'], 'uploaded_transcript')

    def test_txt_keeps_meaningful_lines_and_does_not_infer_speakers(self):
        text, _ = parse_upload(SimpleUploadedFile('meeting.TXT', b'\xef\xbb\xbfCoach: First line\r\n\r\nNext paragraph', 'text/plain'))
        self.assertEqual(text, 'Coach: First line\n\nNext paragraph')

    def test_invalid_uploads_fail_closed(self):
        cases = [
            ('meeting.pdf', b'text', 'application/pdf'), ('meeting.txt', b'', 'text/plain'),
            ('meeting.txt', b' \n\t ', 'text/plain'), ('meeting.txt', b'\xff\xfe', 'text/plain'),
            ('meeting.txt', b'text\x00binary', 'text/plain'), ('meeting.txt', b'text', 'image/png'),
            ('meeting.txt', b'x' * (5 * 1024 * 1024 + 1), 'text/plain'),
            ('meeting.vtt', b'WEBVTT\n\n', 'text/vtt'), ('meeting.vtt', b'Not a VTT file', 'text/vtt'),
            ('meeting.vtt', b'WEBVTT\n\nbad --> timing\nText', 'text/vtt'),
            ('meeting.vtt', b'WEBVTT\n\n00:99:01.000 --> 00:99:03.000\nText', 'text/vtt'),
            ('meeting.vtt', b'WEBVTT\n\n00:00:03.000 --> 00:00:01.000\nText', 'text/vtt'),
            ('meeting.vtt', b'WEBVTT\n\n00:00:01.000 --> 00:00:03.000', 'text/vtt'),
        ]
        for name, content, mime in cases:
            with self.subTest(name=name, size=len(content)), self.assertRaises(ValueError):
                parse_upload(SimpleUploadedFile(name, content, mime))

    def test_notes_style_and_region_blocks_do_not_become_spoken_text(self):
        content = VTT + b'\nNOTE internal note\n00:00:01.000 --> 00:00:03.000\nNot speech\n\nSTYLE\n::cue {color:red;}\n\nREGION\nid:region1'
        text, _ = parse_upload(SimpleUploadedFile('meeting.vtt', content, 'text/vtt'))
        self.assertNotIn('Not speech', text)
        self.assertNotIn('color', text)


class MigratedSummaryActionTests(TestCase):
    # Reuse synthetic fixture/helpers without rerunning inherited test methods.
    setUp = fixtures.MigratedBindingFlowTests.setUp
    check = fixtures.MigratedBindingFlowTests.check
    save = fixtures.MigratedBindingFlowTests.save

    def upload(self, name='meeting.txt', content=b'Coach: Synthetic spoken content', *, summary='Uploaded original',
               ai_error=None, during_generation=None, owner=OWNER, mime='text/plain'):
        request = self.factory.post('/', {'transcript': SimpleUploadedFile(name, content, mime)})
        request.login_account = SimpleNamespace(display_name='Synthetic coach')
        def generate(_context, text):
            if during_generation:
                during_generation()
            if ai_error:
                raise ai_error
            return {'overview': summary}, 'synthetic-model'
        with patch.object(upload_api, '_coach_review', return_value=(owner, self.definition)), \
             patch.object(views, 'openai_meeting_summary', side_effect=generate) as ai, \
             patch.object(views, 'fetch_coach_meeting_graph_snapshot') as graph, \
             patch.object(views, 'persist_coach_meeting_snapshots') as storage:
            response = unwrap(upload_api.migrated_review_summary_upload)(request, self.overlay.event_key)
        graph.assert_not_called()
        storage.assert_not_called()
        self.overlay.refresh_from_db()
        return response, ai

    def test_route_is_dedicated_to_migrated_uploads(self):
        match = resolve('/coach_api/migrated-reviews/imported-review:synthetic/summary/from-upload')
        self.assertIs(match.func, upload_api.migrated_review_summary_upload)

    def test_vtt_upload_without_teams_populates_once_and_keeps_provenance(self):
        self.calendar.delete()
        before = deepcopy(self.overlay.template_snapshot)
        response, ai = self.upload('meeting.vtt', VTT, mime='text/vtt')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ai.call_args.args[1], 'Coach: We agreed the next action.\nLearner: I will provide evidence.')
        self.assertEqual(self.overlay.answers, {'other': 'Keep this answer', 'recap': 'Uploaded original'})
        state = self.overlay.meeting_intelligence
        self.assertEqual(state['aiSummaryOriginal'], {'overview': 'Uploaded original'})
        source = state['aiSummaryProvenance']
        for key in ('uploadedAt', 'generatedAt', 'uploadedBy', 'generatedBy', 'model', 'transcriptHash', 'contentHash', 'filename'):
            self.assertTrue(source[key], key)
        self.assertEqual(source['uploadedBy'], OWNER)
        self.assertEqual(source['source'], 'uploaded_transcript')
        self.assertNotIn('transcriptArtifactId', source)
        self.assertNotIn('Synthetic spoken content', json.dumps(state))
        self.assertNotIn('We agreed the next action', json.dumps(state))
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(self.overlay.status, 'in-progress')
        data = json.loads(response.content)
        self.assertEqual(data['summaryBinding']['suggestionSource'], 'uploaded_transcript')
        self.assertEqual(data['summaryBinding']['status'], 'populated')
        self.assertEqual(data['reviewAnswers'], self.overlay.answers)

    def test_repeated_upload_keeps_original_and_ai_populated_answer(self):
        self.upload()
        original = deepcopy(self.overlay.meeting_intelligence['aiSummaryProvenance'])
        response, _ = self.upload(content=b'A second transcript', summary='New suggestion')
        self.assertEqual(self.overlay.answers['recap'], 'Uploaded original')
        self.assertEqual(self.overlay.meeting_intelligence['aiSummaryOriginal']['overview'], 'Uploaded original')
        self.assertEqual(self.overlay.meeting_intelligence['aiSummaryProvenance'], original)
        binding = json.loads(response.content)['summaryBinding']
        self.assertTrue(binding['replacementAvailable'])
        self.assertEqual(binding['suggestionText'], 'New suggestion')
        self.assertEqual(binding['status'], 'answer-preserved')

    def test_manual_edits_and_intentional_clears_survive_new_upload(self):
        self.upload()
        for answer in ('Final coach wording', ''):
            self.assertEqual(self.save({'recap': answer, 'other': 'Keep'}).status_code, 200)
            response, _ = self.upload(summary='Do not replace coach content')
            self.assertEqual(self.overlay.answers['recap'], answer)
            binding = json.loads(response.content)['summaryBinding']
            self.assertEqual(binding['state'], 'COACH_CLEARED' if not answer else 'COACH_EDITED')
            self.assertTrue(binding['replacementAvailable'])
            self.assertEqual(self.overlay.meeting_intelligence['aiSummaryOriginal']['overview'], 'Uploaded original')

    def test_both_sources_share_protection_without_mislabeling_the_original(self):
        self.upload()
        response, _ = self.check()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.overlay.answers['recap'], 'Uploaded original')
        self.assertEqual(self.overlay.meeting_intelligence['aiSummaryProvenance']['source'], 'uploaded_transcript')
        source = self.overlay.meeting_intelligence['latestSummarySuggestion']['provenance']
        self.assertEqual(source['source'], 'teams')
        self.assertEqual(source['transcriptArtifactId'], 'artifact-one')
        self.assertEqual(source['eventKey'], self.calendar.event_key)
        self.assertEqual(source['graphEventId'], self.calendar.graph_event_id)
        self.assertEqual(source['generatedBy'], OWNER)
        original_graph_id = self.calendar.graph_event_id
        self.calendar.graph_event_id = 'relinked-synthetic-meeting'
        self.calendar.save()
        _, ai = self.check()
        ai.assert_not_called()
        self.assertEqual(self.overlay.meeting_intelligence['latestSummarySuggestion']['provenance']['graphEventId'], original_graph_id)
        self.assertEqual(self.overlay.answers['recap'], 'Uploaded original')
        self.upload(summary='Later upload')
        self.assertEqual(summary_binding_response(self.overlay)['suggestionSource'], 'uploaded_transcript')

    def test_upload_after_teams_keeps_first_original(self):
        self.check()
        self.upload(summary='Uploaded suggestion')
        self.assertEqual(self.overlay.answers['recap'], 'Original AI facts')
        self.assertEqual(self.overlay.meeting_intelligence['aiSummaryOriginal']['overview'], 'Original AI facts')
        self.assertEqual(self.overlay.meeting_intelligence['aiSummaryProvenance']['source'], 'teams')

    def test_no_teams_association_does_not_block_upload_but_blocks_teams(self):
        self.calendar.delete()
        response, ai = self.check()
        self.assertEqual(response.status_code, 409)
        ai.assert_not_called()
        self.assertEqual(self.upload()[0].status_code, 200)

    def test_invalid_binding_or_upload_cannot_call_ai(self):
        before = deepcopy(self.overlay.meeting_intelligence)
        response, ai = self.upload('invalid.vtt', b'WEBVTT\n\nnot a cue', mime='text/vtt')
        self.assertEqual(response.status_code, 400)
        ai.assert_not_called()
        self.assertEqual(self.overlay.meeting_intelligence, before)
        for duplicate in (False, True):
            if duplicate:
                self.overlay.template_snapshot['sections'][0]['fields'][0]['semanticKey'] = 'meeting_summary'
                self.overlay.template_snapshot['sections'][0]['fields'][1]['semanticKey'] = 'meeting_summary'
            else:
                self.overlay.template_snapshot['sections'][0]['fields'][0].pop('semanticKey')
            self.overlay.save()
            response, ai = self.upload()
            self.assertEqual(response.status_code, 409)
            ai.assert_not_called()
            if duplicate:
                response, ai = self.check()
                self.assertEqual(response.status_code, 409)
                ai.assert_not_called()

    def test_ai_failure_preserves_answer_and_reports_partial_result_without_exception_text(self):
        self.save({'recap': 'Manual saved answer'})
        response, _ = self.upload(ai_error=RuntimeError('private provider exception'))
        self.assertEqual(response.status_code, 207)
        data = json.loads(response.content)
        self.assertTrue(data['partial'])
        self.assertEqual(data['summaryBinding']['generationStatus'], 'failed')
        self.assertEqual(self.overlay.answers['recap'], 'Manual saved answer')
        self.assertNotIn('private provider exception', response.content.decode())
        self.assertEqual(self.save({'recap': 'Still editable'}).status_code, 200)

    def test_oversized_summary_keeps_full_original_and_does_not_write_answer(self):
        response, _ = self.upload(summary='X' * 4001)
        self.assertNotIn('recap', self.overlay.answers)
        self.assertEqual(json.loads(response.content)['summaryBinding']['status'], 'summary-too-long')
        self.assertEqual(len(self.overlay.meeting_intelligence['aiSummaryOriginal']['overview']), 4001)
        self.save({'recap': 'Final coach answer'})
        response, _ = self.upload(summary='Y' * 4001)
        binding = json.loads(response.content)['summaryBinding']
        self.assertTrue(binding['summaryTooLong'])
        self.assertTrue(binding['replacementAvailable'])
        self.assertEqual(binding['suggestionText'], 'Y' * 4001)
        self.assertEqual(self.overlay.answers['recap'], 'Final coach answer')

    def test_long_transcript_records_input_limit_notice(self):
        with patch.object(views, 'COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS', 5):
            response, _ = self.upload()
        self.assertTrue(json.loads(response.content)['summaryBinding']['transcriptTruncated'])

    def test_late_upload_loads_latest_other_answers_and_keeps_newer_coach_edit(self):
        self.upload(during_generation=lambda: self.save({'other': 'Newer other answer'}))
        self.assertEqual(self.overlay.answers, {'other': 'Newer other answer', 'recap': 'Uploaded original'})
        self.upload(during_generation=lambda: self.save({'recap': 'Newer coach answer', 'other': 'Keep'}))
        self.assertEqual(self.overlay.answers, {'recap': 'Newer coach answer', 'other': 'Keep'})

    def test_both_sources_recheck_binding_before_writing(self):
        original = deepcopy(self.overlay.template_snapshot)
        def invalidate():
            duplicate = deepcopy(original)
            duplicate['sections'][0]['fields'][1]['semanticKey'] = 'meeting_summary'
            type(self.overlay).objects.filter(pk=self.overlay.pk).update(template_snapshot=duplicate)
        for source in ('teams', 'upload'):
            self.overlay.template_snapshot = original
            self.overlay.save()
            response, ai = self.check(during_fetch=invalidate) if source == 'teams' else self.upload(during_generation=invalidate)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.overlay.meeting_intelligence, {})
            self.assertNotIn('recap', self.overlay.answers)
            if source == 'teams':
                ai.assert_not_called()

    def test_upload_is_scoped_to_one_review_and_all_migrated_families_use_shared_context(self):
        other = type(self.overlay).objects.create(event_key='imported-review:other', owner_email=OWNER,
            learner_id=43, source_review_id=7002, template_snapshot=deepcopy(self.overlay.template_snapshot),
            status='in-progress', answers={'recap': 'Other learner'}, meeting_intelligence={'keep': True})
        for family, source_type, context_type in (
            ('MCM', 'Monthly Coaching Meeting', 'mcr'),
            ('PR', 'Progress Review', 'progress-review'),
            ('PR_SKILLS_RADAR', 'Progress Review with Skills Radar', 'progress-review'),
        ):
            self.overlay.template_snapshot['reviewFamily'] = family
            self.overlay.save()
            self.definition['historicalReview']['type'] = source_type
            self.definition['template']['reviewTypeCode'] = 'aptem_mcm' if family == 'MCM' else 'aptem_progress_review'
            response, ai = self.upload()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(ai.call_args.args[0].event_type, context_type)
        other.refresh_from_db()
        self.assertEqual(other.answers, {'recap': 'Other learner'})
        self.assertEqual(other.meeting_intelligence, {'keep': True})

    def test_stale_save_after_upload_and_party_read_use_existing_protections(self):
        stale = fixtures.answer_version(self.overlay)
        self.upload()
        self.assertEqual(self.save({'other': 'Stale answers'}, version=stale).status_code, 409)
        self.assertEqual(self.overlay.answers['recap'], 'Uploaded original')
        self.check = lambda: self.upload(summary='Original AI facts')
        fixtures.MigratedBindingFlowTests.test_party_views_get_saved_answer_without_intelligence(self)

    def test_frozen_or_unowned_review_is_rejected_before_and_after_generation(self):
        for status in ('awaiting-signature', 'completed', 'not-scheduled'):
            self.overlay.status = status; self.overlay.save()
            response, ai = self.upload()
            self.assertEqual(response.status_code, 409)
            ai.assert_not_called()
        self.overlay.status = 'in-progress'; self.overlay.save()
        response, ai = self.upload(owner='unrelated@example.invalid')
        self.assertEqual(response.status_code, 404)
        ai.assert_not_called()
        for change in ({'status': 'awaiting-signature'}, {'status': 'completed'}, {'owner_email': 'new@example.invalid'}):
            self.overlay.status = 'in-progress'; self.overlay.owner_email = OWNER; self.overlay.save()
            def freeze():
                type(self.overlay).objects.filter(pk=self.overlay.pk).update(**change)
            response, _ = self.upload(during_generation=freeze)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.overlay.meeting_intelligence, {})
            self.assertNotIn('recap', self.overlay.answers)

    def test_learner_employer_and_admin_view_as_cannot_upload(self):
        with patch.object(views, 'openai_meeting_summary') as ai:
            for role in ('learner', 'employer'):
                account = SimpleNamespace(role=role, subject_type=role, subject_id=42)
                with patch('login.permissions.authenticate_request', return_value=account), \
                     patch('login.permissions._accesses_of', return_value=frozenset()):
                    self.assertEqual(upload_api.migrated_review_summary_upload(self.factory.post('/'), self.overlay.event_key).status_code, 403)
            account = SimpleNamespace(role='admin', subject_type='staff', subject_id=99)
            with patch('login.permissions.authenticate_request', return_value=account), \
                 patch('login.permissions._accesses_of', return_value=frozenset({'super-admin'})), \
                 patch('coach_api.auth._staff_access', return_value='super-admin'), \
                 patch('coach_api.auth.StaffUser.objects.filter') as staff:
                staff.return_value.only.return_value.first.return_value = SimpleNamespace(id=99)
                request = self.factory.post('/?viewAsCoach=coach%40example.invalid')
                request.login_account = account
                response = upload_api.migrated_review_summary_upload(request, self.overlay.event_key)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(json.loads(response.content)['code'], 'coach_view_as_read_only')
            ai.assert_not_called()

    def test_upload_generated_pdf_still_uses_final_answer_once(self):
        # Existing PDF regression asserts saved coach wording exactly once and
        # existing documents are reused. Run it with the upload source instead.
        self.check = lambda: self.upload(summary='Original AI facts')
        fixtures.MigratedBindingFlowTests.test_pdf_uses_saved_answer_once_and_existing_pdf_is_not_regenerated(self)
