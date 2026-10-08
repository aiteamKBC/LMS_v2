"""Security boundary checks for the restricted Advanced Admin grant."""
import json
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import SimpleTestCase, override_settings
from django.test import RequestFactory
from django.http import JsonResponse
from django.core.management.base import CommandError

from login.api_gate import refusal_for
from login.management.commands.apply_advanced_admin_scope import select_named_rows
from login.advanced_admin import (
    _admin_marking_submission, _assignment_evidence, _coaching_connection_string, _profile_in_scope,
    _preview_document, learner_enrolment, learner_compliance,
    learner_compliance_file, learner_messages, learner_monthly_logs,
    learner_coaching_sessions, learner_inclusion, learner_inclusion_report_pdf,
    learner_legacy_assignment_document, learner_legacy_assignments,
    learner_legacy_marking,
    learner_audit_assignments, learner_audit_assignment_mark,
    learner_audit_assignment_source_mark,
    learner_audit_assignment_document,
    learner_component, learner_component_file, learner_cover, learner_learning,
    learner_wordpress_courses,
    learner_module_progress,
    learner_material, learner_material_media,
    learner_material_file, learner_submissions,
    learner_reviews, learner_review_pdf, _review_signature_summary,
    learner_original_review_pdf, learner_review_pdf_signatures,
    learner_coaching_session_detail,
    learner_coaching_reviews, _attach_archived_review_ids, learners,
    learner_lecture_workspace, learner_quality,
)
from login.aptem_review_signatures import progress_review_pdf_signatures
from login.aptem_signed_reviews import read_synced_review_pdf, sync_review_snapshots


class AdvancedAdminLearnerListTests(SimpleTestCase):
    def test_keeps_initial_ten_then_orders_added_learners_by_requested_cohort(self):
        first_added = datetime(2026, 10, 1, tzinfo=timezone.utc)
        later_added = datetime(2026, 10, 8, tzinfo=timezone.utc)
        scope_rows = [(str(number), 'ME', first_added) for number in range(1, 11)] + [
            ('11', 'PCP', later_added), ('12', 'ME', later_added),
            ('13', 'PCP', later_added), ('14', 'ME', later_added),
        ]
        profiles = [SimpleNamespace(
            id=number, aptem_id=number, enrolment_id=number,
            full_name=f'Learner {number:02d}', programme='Example programme',
            programme_status='Active', cohort='Earlier', group_name='Example group',
            coach_name='Example coach') for number in range(1, 11)]
        profiles += [SimpleNamespace(
            id=number, aptem_id=number, enrolment_id=number,
            full_name=f'Learner {number:02d}', programme='Example programme',
            programme_status='Active', cohort=cohort, group_name='Example group',
            coach_name='Example coach') for number, cohort in [
                (11, 'Other'), (12, 'Jun 2026'), (13, 'Jun 2026'), (14, 'Feb 2026')]]
        request = RequestFactory().get('/login_api/advanced-admin/learners/')
        with patch('login.advanced_admin.AdvancedAdminLearnerScope.objects') as scope, \
             patch('login.advanced_admin.LearnerProfile.objects') as learner_profiles:
            scope.values_list.return_value = scope_rows
            learner_profiles.filter.return_value.only.return_value = reversed(profiles)
            response = learners.__wrapped__.__wrapped__(request)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['count'], 14)
        self.assertEqual([row['id'] for row in payload['learners']],
                         list(range(1, 11)) + [14, 13, 12, 11])


class AdvancedAdminLectureWorkspaceTests(SimpleTestCase):
    def test_rejects_out_of_scope_and_unlinked_learners_before_reading_workspace(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/lecture-workspace/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.attendance_lectures.read_workspace') as reader:
            response = learner_lecture_workspace.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()

        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=None)), \
             patch('learner_api.attendance_lectures.read_workspace') as reader:
            response = learner_lecture_workspace.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 409)
        reader.assert_not_called()

    def test_returns_read_only_lecture_fields_for_only_the_scoped_enrolment(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/lecture-workspace/')
        source = SimpleNamespace(id=7)
        workspace = {
            'lectures': [{
                'id': 'one', 'sessionId': 'session-one', 'date': '2026-10-08',
                'title': 'Planning', 'moduleId': 'm1', 'module': 'Module One',
                'status': 'upcoming', 'joinUrl': 'https://private.invalid/meeting',
                'componentHref': '/learner/private', 'activities': [{
                    'id': 'activity-one', 'title': 'Practice', 'type': 'assignment',
                    'completed': False, 'href': '/learner/private'}],
                'recovery': {'joinUrl': 'https://private.invalid/catchup'},
            }],
            'modules': [{'id': 'm1', 'title': 'Module One'}],
            'mode': {'available': True, 'mode': 'live', 'requestedMode': None,
                     'status': 'active', 'managerAvailable': True},
            'recentActivity': [], 'timeZone': 'Europe/London',
            'csrfToken': 'secret',
        }
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.attendance_lectures.read_workspace', return_value=workspace) as reader:
            learners.only.return_value.filter.return_value.first.return_value = source
            response = learner_lecture_workspace.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        learners.only.return_value.filter.assert_called_once_with(pk=7)
        reader.assert_called_once_with(source, 'commercial')
        payload = json.loads(response.content)
        self.assertEqual(payload['lectures'][0]['title'], 'Planning')
        self.assertNotIn('joinUrl', payload['lectures'][0])
        self.assertNotIn('componentHref', payload['lectures'][0])
        self.assertEqual(payload['lectures'][0]['activities'], [{
            'id': 'activity-one', 'title': 'Practice', 'type': 'assignment',
            'completed': False}])
        self.assertNotIn('csrfToken', payload)

    def test_quality_queries_use_only_the_scoped_learner_roster_id(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/quality/')
        report = {'session_id': 'session-one', 'session_date': date(2026, 10, 8),
                  'subject': 'Planning', 'trainer': 'Tutor', 'teaching_quality_rating': 4,
                  'teaching_quality_comments': 'Clear examples', 'overall_judgement': 'Good',
                  'lms_module': 'Module One', 'duration_score': 3, 'engagement_score': 4,
                  'met_count': 2, 'partial_count': 1, 'not_met_count': 0,
                  'strengths': '["Clear examples"]', 'areas_for_development': '[]',
                  'ksb_coverage': '{"K1": "met"}', 'duration': '2 hours',
                  'lms_students_count': 1, 'attended_count': None,
                  'observation_state': None,
                  'checklist': '[{"order": 1, "item": "Session duration", "status": "Met", "evidence": "Two hours observed"}]'}
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('learner_api.attendance._kbc_attendance_connection_string', return_value='test-dsn'), \
             patch('psycopg.connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.side_effect = [[report], []]
            response = learner_quality.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([call.args[1] for call in cursor.execute.call_args_list], [['123'], ['123']])
        payload = json.loads(response.content)
        self.assertEqual(payload['lecture'], [])
        self.assertEqual(payload['tutor'][0]['durationScore'], 3)
        self.assertEqual(payload['tutor'][0]['strengths'], ['Clear examples'])
        self.assertEqual(payload['tutor'][0]['ksbCoverage'], {'K1': 'met'})
        self.assertEqual(payload['tutor'][0]['duration'], '2 hours')
        self.assertEqual(payload['tutor'][0]['checklist'][0]['evidence'], 'Two hours observed')
        self.assertIn('i.session_id=q.session_id', cursor.execute.call_args_list[0].args[0])
        self.assertIn('i.rendered_session_id=q.rendered_session_id', cursor.execute.call_args_list[1].args[0])


class AdvancedAdminReviewSignatureTests(SimpleTestCase):
    def test_shows_only_saved_signatures_and_does_not_require_manager_for_mcm(self):
        saved = {'advisor': datetime(2026, 9, 12, 10, tzinfo=timezone.utc)}
        result = _review_signature_summary('mcm', {}, saved)
        self.assertEqual(result['coach'], {
            'required': True, 'signed': True, 'signedAt': '2026-09-12T10:00:00+00:00',
        })
        self.assertEqual(result['student']['signed'], False)
        self.assertFalse(result['manager']['required'])

    def test_historical_signatures_are_unknown_when_no_local_signoff_exists(self):
        result = _review_signature_summary('pr', None, None)
        self.assertTrue(result['manager']['required'])
        self.assertIsNone(result['manager']['signed'])
        self.assertIsNone(result['manager']['signedAt'])

    def test_review_signatures_are_scoped_and_never_expose_signature_images(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/reviews/')
        profile = SimpleNamespace(id=42, aptem_id=123)
        overlay = SimpleNamespace(id=9, source_review_id=11, meeting_intelligence={},
                                  signature_requirements={'advisor': True, 'participant': True, 'employer': False})
        cursor = MagicMock()
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.connections') as databases, \
             patch('learner_api.review_history._review_rows', side_effect=[[], [{'id': 11}]]), \
             patch('learner_api.review_history._sections_by_review', return_value={}), \
             patch('learner_api.review_history._serialize_review', return_value={
                 'id': '11', 'aptemLearnerId': '123', 'name': 'MCM',
             }), \
             patch('coach_api.models.ImportedReviewInstance.objects') as overlays, \
             patch('coach_api.models.MigratedReviewSignature.objects') as signatures:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            overlays.filter.return_value.only.return_value = [overlay]
            signatures.filter.return_value.values.return_value = [{
                'overlay_id': 9, 'role': 'advisor',
                'signed_at': datetime(2026, 9, 12, 10, tzinfo=timezone.utc),
            }]
            response = learner_reviews.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        overlays.filter.assert_called_once_with(learner_id=42, source_review_id__in=[11])
        signatures.filter.assert_called_once_with(overlay_id__in=[9])
        row = json.loads(response.content)['mcm'][0]
        self.assertTrue(row['signatures']['coach']['signed'])
        self.assertFalse(row['signatures']['student']['signed'])
        self.assertFalse(row['signatures']['manager']['required'])
        self.assertNotIn('signature', row['signatures']['coach'])

    def test_review_pdf_prefers_the_saved_final_report_for_the_scoped_review(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/reviews/aptem-11/pdf/')
        profile = SimpleNamespace(id=42, aptem_id=123, enrolment_id=7)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.aptem_review_pdf.imported_review_for_source', return_value={
                 'id': '11', 'aptemLearnerId': '123',
             }), \
             patch('learner_api.aptem_review_pdf.original_review_pdf') as original, \
             patch('coach_api.models.MigratedReviewDocument.objects') as documents:
            learners.get.return_value = SimpleNamespace(id=7)
            documents.filter.return_value.values_list.return_value.first.return_value = b'%PDF-1.7 saved'
            response = learner_review_pdf.__wrapped__.__wrapped__(request, 42, 'aptem-11')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'%PDF-1.7 saved')
        self.assertEqual(response['Content-Type'], 'application/pdf')
        documents.filter.assert_called_once_with(overlay__learner_id=42, overlay__source_review_id=11)
        original.assert_not_called()

    def test_original_download_uses_aptem_even_when_a_local_report_exists(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/reviews/aptem-11/original-pdf/')
        profile = SimpleNamespace(id=42, aptem_id=123, enrolment_id=7)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.aptem_review_pdf.imported_review_for_source', return_value={
                 'id': '11', 'aptemLearnerId': '123',
             }), \
             patch('learner_api.aptem_review_pdf.original_review_pdf', return_value=b'%PDF-1.7 Aptem') as original:
            learners.get.return_value = SimpleNamespace(id=7)
            response = learner_original_review_pdf.__wrapped__.__wrapped__(request, 42, 'aptem-11')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'%PDF-1.7 Aptem')
        self.assertIn('attachment', response['Content-Disposition'])
        original.assert_called_once()

    def test_progress_signatures_are_read_from_pdf_boxes(self):
        import pymupdf

        document = pymupdf.open()
        page = document.new_page()
        pixels = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 2, 2), False)
        pixels.clear_with(0)
        page.insert_text((67, 100), 'Signature')
        page.insert_image(pymupdf.Rect(210, 75, 310, 110), pixmap=pixels)
        page.insert_text((67, 220), 'Signature')
        page.insert_text((67, 340), 'Signature')
        result = progress_review_pdf_signatures(document.tobytes())
        self.assertEqual(result, {'coach': True, 'manager': False, 'student': False})
        self.assertEqual(progress_review_pdf_signatures(b'not a PDF'),
                         {'coach': None, 'manager': None, 'student': None})

    def test_signature_endpoint_does_not_infer_local_or_unrelated_signatures(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/reviews/aptem-11/pdf-signatures/')
        profile = SimpleNamespace(id=42, aptem_id=123, enrolment_id=7)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.aptem_review_pdf.imported_review_for_source', return_value={
                 'id': '11', 'aptemLearnerId': '999',
             }), \
             patch('learner_api.aptem_review_pdf.original_review_pdf') as original:
            learners.get.return_value = SimpleNamespace(id=7)
            response = learner_review_pdf_signatures.__wrapped__.__wrapped__(request, 42, 'aptem-11')
        self.assertEqual(response.status_code, 404)
        original.assert_not_called()

    def test_coaching_detail_refuses_out_of_scope_learner_before_external_connection(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/coaching-sessions/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('psycopg.connect') as external:
            response = learner_coaching_session_detail.__wrapped__.__wrapped__(
                request, 42, uuid4())
        self.assertEqual(response.status_code, 404)
        external.assert_not_called()

    def test_coaching_detail_scopes_session_and_attendance_to_learner(self):
        session_id = uuid4()
        meeting_id = uuid4()
        report_id = uuid4()
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/coaching-sessions/')
        row = {
            'id': session_id, 'meeting_id': meeting_id, 'learner_name': 'Example Learner',
            'learner_email': 'learner@example.invalid', 'program_name': 'Programme',
            'group_name': 'Group', 'coach_name': 'Coach', 'manager_name': 'Manager',
            'manager_email': 'manager@example.invalid', 'component_type': 'progress_review',
            'planned_date': None, 'actual_start_at': None, 'actual_end_at': None,
            'session_status': 'completed', 'learner_attended': True,
            'manager_attended_raw': None, 'has_transcript': True,
            'ai_status': 'completed', 'report_status': 'completed',
            'report': {'executive_summary': 'Summary'},
        }
        transcript = {'content': 'Transcript', 'duration_seconds': 60, 'status': 'synced'}
        attendance = {'id': report_id, 'status': 'synced',
                      'total_participant_count': 3, 'meeting_start_at': None,
                      'meeting_end_at': None}
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin._coaching_connection_string', return_value='safe-test-dsn'), \
             patch('psycopg.connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.side_effect = [row, transcript, attendance]
            cursor.fetchall.return_value = [
                {'email': 'learner@example.invalid', 'total_attendance_seconds': 120,
                 'intervals': []},
                {'email': 'other@example.invalid', 'total_attendance_seconds': 90,
                 'intervals': []},
            ]
            response = learner_coaching_session_detail.__wrapped__.__wrapped__(
                request, 42, session_id)
        self.assertEqual(response.status_code, 200)
        queries = cursor.execute.call_args_list
        self.assertIn('c.learner_id=%s', queries[0].args[0])
        self.assertEqual(queries[0].args[1][:2], [session_id, 123])
        self.assertIn('lower(email)=lower(%s)', queries[3].args[0])
        self.assertEqual(queries[3].args[1], [report_id, 'learner@example.invalid',
                                              'manager@example.invalid'])
        body = json.loads(response.content)
        self.assertEqual(body['attendance']['learner']['durationSeconds'], 120)
        self.assertIsNone(body['attendance']['manager'])
        self.assertNotIn('other@example.invalid', response.content.decode())

    def test_coaching_reviews_come_from_scoped_external_components(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/coaching-reviews/')
        rows = [
            {'id': 11, 'component_type': 'progress_review', 'component_name': 'Progress Review 1',
             'status': 'Awaiting Signature', 'planned_date': None, 'completed_date': None,
             'case_owner': 'Coach', 'manager_name': 'Manager',
             'learner_name': 'Example Learner', 'learner_email': 'learner@example.invalid',
             'program_name': 'Programme',
             'group_name': 'Group'},
            {'id': 12, 'component_type': 'monthly_coaching', 'component_name': 'MCM 1',
             'status': 'Completed', 'planned_date': None, 'completed_date': None,
             'case_owner': 'Coach', 'manager_name': 'Manager',
             'learner_name': 'Example Learner', 'learner_email': 'learner@example.invalid',
             'program_name': 'Programme',
             'group_name': 'Group'},
        ]
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(id=42, aptem_id=123)), \
             patch('login.advanced_admin._coaching_connection_string', return_value='safe-test-dsn'), \
             patch('login.advanced_admin.connections'), \
             patch('learner_api.review_history._review_rows', side_effect=[[], []]) as archived_rows, \
             patch('psycopg.connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = rows
            response = learner_coaching_reviews.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        sql, params = cursor.execute.call_args.args
        self.assertIn('public.aptem_session_components', sql)
        self.assertIn('learner_id=%s', sql)
        self.assertEqual(params[0], 123)
        self.assertIn('default_transaction_read_only=on', connect.call_args.kwargs['options'])
        body = json.loads(response.content)
        self.assertEqual(body['pr'][0]['componentId'], 11)
        self.assertEqual(body['pr'][0]['status'], 'awaiting-signature')
        self.assertEqual(body['mcm'][0]['status'], 'completed')
        self.assertEqual(body['pr'][0]['aptemReviewId'], '')
        self.assertIsNone(archived_rows.call_args_list[1].args[2])

    def test_archived_pdf_id_requires_one_exact_source_and_archive_match(self):
        groups = {'pr': [
            {'completedDate': '2026-09-10', 'plannedDate': '2026-09-09', 'aptemReviewId': ''},
            {'completedDate': '2026-09-12', 'plannedDate': '2026-09-11', 'aptemReviewId': ''},
            {'completedDate': '2026-09-12', 'plannedDate': '2026-09-11', 'aptemReviewId': ''},
        ], 'mcm': []}
        archive = [
            {'review_type': 'Progress Review', 'review_data': {'aptem_learner_id': '123'},
             'completed_date': '2026-09-10', 'planned_scheduled_date': '2026-09-09',
             'aptem_review_id': 'correct'},
            {'review_type': 'Progress Review', 'review_data': {'aptem_learner_id': '999'},
             'completed_date': '2026-09-10', 'planned_scheduled_date': '2026-09-09',
             'aptem_review_id': 'other-learner'},
            {'review_type': 'Progress Review', 'review_data': {'aptem_learner_id': '123'},
             'completed_date': '2026-09-12', 'planned_scheduled_date': '2026-09-11',
             'aptem_review_id': 'ambiguous'},
        ]
        _attach_archived_review_ids(groups, archive, 123)
        self.assertEqual(groups['pr'][0]['aptemReviewId'], 'correct')
        self.assertEqual(groups['pr'][1]['aptemReviewId'], '')
        self.assertEqual(groups['pr'][2]['aptemReviewId'], '')

    def test_coaching_reviews_refuse_out_of_scope_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/coaching-reviews/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('psycopg.connect') as external:
            response = learner_coaching_reviews.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        external.assert_not_called()


class AdvancedAdminAptemSnapshotTests(SimpleTestCase):
    def test_latest_version_is_scoped_and_hash_checked(self):
        rows = [
            {'aptem_review_id': '77', 'review_type': 'Progress Review',
             'review_data': {'aptem_learner_id': '123', 'live_odata': {
                 'Id': 77, 'LearnerId': 123, 'ProgramId': 20}}},
            {'aptem_review_id': '88', 'review_type': 'Monthly Coaching Meeting',
             'review_data': {'aptem_learner_id': '123', 'live_odata': {
                 'Id': 88, 'LearnerId': 123, 'ProgramId': 10}}},
            {'aptem_review_id': '99', 'review_type': 'Progress Review',
             'review_data': {'aptem_learner_id': '999', 'live_odata': {
                 'Id': 99, 'LearnerId': 999, 'ProgramId': 20}}},
        ]
        with tempfile.TemporaryDirectory() as temporary, override_settings(BASE_DIR=Path(temporary)), \
             patch('login.aptem_signed_reviews.AptemReviewClient') as client_class, \
             patch('login.aptem_signed_reviews.progress_review_pdf_signatures',
                   return_value={'coach': True, 'student': True, 'manager': True}):
            client = client_class.return_value
            client.review_groups.side_effect = lambda _, programme: (
                [{'ItemId': 77, 'ItemType': 9, 'ProgramId': 20},
                 {'ItemId': 88, 'ItemType': 9, 'ProgramId': 20}]
                if programme == '20' else [])
            client.review_documents.side_effect = lambda _, review: (
                [{'Id': 11, 'ProgramId': None, 'CreateDateTime': '2026-01-01'},
                 {'Id': 12, 'ProgramId': None, 'CreateDateTime': '2026-01-02'}]
                if review == '77' else
                [{'Id': 13, 'ProgramId': None, 'CreateDateTime': '2026-01-03'}])
            client.download_pdf.side_effect = lambda document: f'%PDF-version-{document}'.encode()

            result = sync_review_snapshots(123, rows)
            self.assertEqual(result, {'eligible': 2, 'saved': 2, 'failed': 0})
            client.download_pdf.assert_any_call(12)
            client.download_pdf.assert_any_call(13)
            self.assertEqual(client.download_pdf.call_count, 2)
            review = {'aptemLearnerId': '123', 'aptemReviewId': '77'}
            self.assertEqual(read_synced_review_pdf(review), b'%PDF-version-12')
            self.assertIsNone(read_synced_review_pdf({**review, 'aptemLearnerId': '999'}))
            directory = Path(temporary) / 'private_media' / 'advanced_admin_aptem_reviews'
            (directory / '123' / '77' / '12.pdf').write_bytes(b'%PDF-tampered')
            self.assertIsNone(read_synced_review_pdf(review))


class AdvancedAdminGateTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role='staff', _staff_access='advanced-admin')

    def test_other_staff_and_learner_apis_are_closed_even_when_optional_gate_is_off(self):
        with patch('login.api_gate._enabled', return_value=False):
            for path in ('/coach_api/coach/marking-queue/', '/learner_api/evidence/commercial/1/',
                         '/login_api/admin/accounts/', '/api/batch/'):
                with self.subTest(path=path):
                    self.assertEqual(refusal_for(path, self.account).status_code, 403)

    def test_own_workspace_and_account_routes_are_open(self):
        for path in ('/login_api/advanced-admin/learners/', '/login_api/me/',
                     '/login_api/change-password/'):
            with self.subTest(path=path):
                self.assertIsNone(refusal_for(path, self.account))


class AdvancedAdminScopeTests(SimpleTestCase):
    def test_wordpress_courses_require_approved_learner_before_source_read(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/wordpress-courses/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.subject_source.read_learner') as reader:
            response = learner_wordpress_courses.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()

    def test_wordpress_courses_use_verified_email_and_require_more_than_five_completed(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/wordpress-courses/')
        profile = SimpleNamespace(aptem_id=123, email='learner@example.invalid', enrolment_id=7)
        course = {'id': 50, 'name': 'Example course', 'activities': [], 'results': []}
        below_threshold = {'id': 51, 'name': 'Five completed', 'activities': [], 'results': []}
        rows = [{'activity_id': number, 'title': f'Finished {number}',
                 'activity_type': 'video', 'status': 'completed'} for number in range(1, 7)]
        rows.extend([
            {'activity_id': 7, 'title': 'Unread', 'activity_type': 'audio', 'status': 'not_started'},
            {'activity_id': 8, 'title': 'Attempted', 'activity_type': 'Reading+Quiz', 'status': 'quiz_attempted'},
        ])
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('audit_api.last_audit_ledger_views._connection') as connection, \
             patch('learner_api.subject_source.read_learner', return_value={'groups': [course, below_threshold]}) as reader, \
             patch('learner_api.subject_source.source_rows', side_effect=[rows, rows[:5]]):
            response = learner_wordpress_courses.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        reader.assert_called_once_with(connection.return_value.cursor.return_value.__enter__.return_value,
                                       123, 'learner@example.invalid')
        payload = json.loads(response.content)
        self.assertEqual(len(payload['courses']), 1)
        self.assertEqual(payload['courses'][0]['id'], 50)
        self.assertEqual(payload['courses'][0]['completedActivities'], 6)
        self.assertEqual(payload['courses'][0]['startedActivities'], 7)
        self.assertNotIn('email', str(payload))

    def test_submission_plan_month_comes_from_saved_assignment_only(self):
        serialize = lambda row: {'id': str(row['id'])}
        saved = {'id': 1, 'full_submission': {'monthlyAssignment': {'month': '2026-09'}}}
        self.assertEqual(_admin_marking_submission(saved, serialize)['planMonth'], '2026-09')
        self.assertIsNone(_admin_marking_submission(
            {'id': 1, 'full_submission': {'monthlyAssignment': {'month': '2026-19'}}}, serialize)['planMonth'])
        self.assertNotIn('full_submission', _admin_marking_submission(saved, serialize))

    def test_module_progress_refuses_out_of_scope_learner_before_source_read(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/module-progress/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners:
            response = learner_module_progress.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        learners.only.assert_not_called()

    def test_module_progress_returns_only_learner_metrics_without_join_links(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/module-progress/')
        profile = SimpleNamespace(aptem_id=123, enrolment_id=7)
        source = SimpleNamespace(email='example@example.invalid')
        dashboard = {'modules': [], 'moduleLinks': {}, 'moduleProgress': {},
                     'months': {'2026-10': {'planned': 40, 'source': 'ssot'}},
                     'programmeStartDate': '2026-10-01',
                     'programmeEndDate': '2027-09-30',
                     'actual': [], 'actualAvailable': True,
                     'sessions': [{'id': 'session-1', 'moduleId': 'module-1',
                                   'title': 'Lesson', 'start': '2026-10-01T09:00:00Z',
                                   'end': None, 'minutes': 60, 'status': 'scheduled',
                                   'attended': None, 'joinUrl': 'private-join-link'}]}
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.canonical_learning.require_profile', return_value={'id': 7}), \
             patch('learner_api.canonical_learning.metrics_bulk', return_value={7: {'otjh': {'planned': 40, 'actual': 12}}}) as metrics, \
             patch('learner_api.dashboard_metrics.coach_otjh_target_to_date', return_value=20) as target, \
             patch('learner_api.training_plan_dashboard.read_dashboard', return_value=dashboard) as read:
            source.pk = 7
            learners.only.return_value.get.return_value = source
            response = learner_module_progress.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(source, section='overview')
        metrics.assert_called_once_with([7], learner_workspace=True)
        target.assert_called_once_with(source, {'planned': 40, 'actual': 12})
        progress = json.loads(response.content)['progress']
        self.assertEqual(progress['sessions'][0]['title'], 'Lesson')
        self.assertNotIn('joinUrl', progress['sessions'][0])
        self.assertEqual(progress['months'], dashboard['months'])
        self.assertEqual(progress['programmeStartDate'], '2026-10-01')
        self.assertEqual(progress['programmeEndDate'], '2027-09-30')
        self.assertEqual(progress['targetAsOfToday'], 20)

    def test_unknown_or_unapproved_learner_is_hidden(self):
        profile = SimpleNamespace(aptem_id=123)
        with patch('login.advanced_admin.LearnerProfile.objects') as learners, \
             patch('login.advanced_admin.AdvancedAdminLearnerScope.objects') as scope:
            learners.only.return_value.filter.return_value.first.return_value = profile
            scope.filter.return_value.exists.return_value = False
            self.assertIsNone(_profile_in_scope(42))
            scope.filter.assert_called_once_with(aptem_id='123')

    def test_approved_learner_is_returned(self):
        profile = SimpleNamespace(aptem_id=123)
        with patch('login.advanced_admin.LearnerProfile.objects') as learners, \
             patch('login.advanced_admin.AdvancedAdminLearnerScope.objects') as scope:
            learners.only.return_value.filter.return_value.first.return_value = profile
            scope.filter.return_value.exists.return_value = True
            self.assertIs(_profile_in_scope(42), profile)

    def test_out_of_scope_marking_is_denied_before_any_database_write(self):
        request = RequestFactory().patch('/login_api/advanced-admin/learners/42/submissions/')
        request.login_account = SimpleNamespace(display_name='Assessor', email='assessor@example.invalid')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin.connections') as databases:
            response = learner_submissions.__wrapped__(request, 42, uuid4())
        self.assertEqual(response.status_code, 404)
        databases.__getitem__.assert_not_called()

    def test_historical_assignments_refuse_out_of_scope_learner_before_source_read(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/legacy-assignments/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.legacy_assignments.classified_rows') as read:
            response = learner_legacy_assignments.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()

    def test_historical_document_refuses_evidence_from_another_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/legacy-assignments/7/file/open/')
        profile = SimpleNamespace(aptem_id=123, enrolment_id=42)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.legacy_assignments.classified_rows', return_value=[]) as read, \
             patch('learner_api.evidence_storage.get_read_sas') as sas:
            response = learner_legacy_assignment_document.__wrapped__.__wrapped__(request, 42, 7, 'file')
        self.assertEqual(response.status_code, 404)
        read.assert_called_once_with('commercial', 42, 'aptem:123:evidence:7')
        sas.assert_not_called()

    def test_historical_marking_checks_scope_and_source_before_writing(self):
        request = RequestFactory().post(
            '/login_api/advanced-admin/learners/42/legacy-assignments/7/mark/',
            data=json.dumps({'decision': 'accepted', 'feedback': 'Reviewed evidence.'}),
            content_type='application/json')
        request.login_account = SimpleNamespace(id=9, display_name='Assessor', email='assessor@example.invalid')
        profile = SimpleNamespace(aptem_id=123, enrolment_id=42)
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.legacy_assignments.classified_rows') as source, \
             patch('login.advanced_admin.connections') as databases:
            self.assertEqual(learner_legacy_marking.__wrapped__(request, 42, 7).status_code, 404)
        source.assert_not_called()
        databases.__getitem__.assert_not_called()
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.legacy_assignments.classified_rows', return_value=[]) as source, \
             patch('login.advanced_admin.connections') as databases:
            self.assertEqual(learner_legacy_marking.__wrapped__(request, 42, 7).status_code, 404)
        source.assert_called_once_with('commercial', 42, 'aptem:123:evidence:7')
        databases.__getitem__.assert_not_called()

    def test_historical_marking_requires_written_feedback(self):
        request = RequestFactory().post(
            '/login_api/advanced-admin/learners/42/legacy-assignments/7/mark/',
            data=json.dumps({'decision': 'accepted', 'feedback': ''}),
            content_type='application/json')
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123, enrolment_id=42)), \
             patch('learner_api.legacy_assignments.classified_rows') as source:
            self.assertEqual(learner_legacy_marking.__wrapped__(request, 42, 7).status_code, 400)
        source.assert_not_called()

    def test_historical_marking_appends_review_for_verified_evidence(self):
        request = RequestFactory().post(
            '/login_api/advanced-admin/learners/42/legacy-assignments/7/mark/',
            data=json.dumps({'decision': 'referred', 'feedback': 'Add source detail.'}),
            content_type='application/json')
        request.login_account = SimpleNamespace(id=9, display_name='Assessor', email='assessor@example.invalid')
        profile = SimpleNamespace(aptem_id=123, enrolment_id=42)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.legacy_assignments.classified_rows',
                   return_value=[{'evidence_id': 7}]), \
             patch('login.advanced_admin.connections') as databases:
            cursor = databases.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = (11, datetime(2026, 10, 8, tzinfo=timezone.utc))
            response = learner_legacy_marking.__wrapped__(request, 42, 7)
        self.assertEqual(response.status_code, 201)
        self.assertIn('insert into login."Advanced_admin_legacy_marks"', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1][:4],
                         ['123', 7, 'referred', 'Add source detail.'])

    def test_external_inclusion_and_coaching_refuse_out_of_scope_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('coach_api.support_tickets._connect') as inclusion, \
             patch('psycopg.connect') as coaching:
            inclusion_response = learner_inclusion.__wrapped__.__wrapped__(request, 42)
            coaching_response = learner_coaching_sessions.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(inclusion_response.status_code, 404)
        self.assertEqual(coaching_response.status_code, 404)
        inclusion.assert_not_called()
        coaching.assert_not_called()

    def test_read_only_preview_sources_refuse_out_of_scope_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin.connections') as databases:
            for view, args in ((learner_enrolment, (42,)),
                               (learner_compliance, (42,)),
                               (learner_compliance_file, (42, uuid4())),
                               (learner_messages, (42,)),
                               (learner_monthly_logs, (42,))):
                with self.subTest(view=view.__name__):
                    self.assertEqual(view.__wrapped__.__wrapped__(request, *args).status_code, 404)
        databases.__getitem__.assert_not_called()

    def test_enrolment_preview_omits_signature_images(self):
        self.assertEqual(_preview_document({'name': 'Example', 'Signature': 'data:image/png;base64,abc',
                                            'steps': [{'learner_signature': 'blob', 'answer': 'Yes'}]}),
                         {'name': 'Example', 'steps': [{'answer': 'Yes'}]})

    def test_monthly_log_preview_resolves_only_the_selected_linked_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/monthly-logs/')
        profile = SimpleNamespace(enrolment_id=7, aptem_id=123,
                                  full_name='Example', programme='PCP')
        owner = {'id': 42}
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.canonical_learning.require_profile', return_value=owner) as resolve, \
             patch('learner_api.monthly_logs.summary_data', return_value={
                 'months': [], 'total_months': 0, 'completed_months': 0,
                 'training_plan_totals': {},
             }) as summary:
            response = learner_monthly_logs.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        resolve.assert_called_once_with(7)
        self.assertEqual(summary.call_args.args[0]['_canonical_profile'], owner)
        self.assertTrue(summary.call_args.args[0]['_view_as'])

    def test_learning_material_refuses_out_of_scope_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/2/3/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.student_activity.student_activity') as material, \
             patch('learner_api.student_activity.source_material_file') as source_file:
            self.assertEqual(learner_material.__wrapped__.__wrapped__(request, 42, 2, 3).status_code, 404)
            self.assertEqual(learner_material_file.__wrapped__.__wrapped__(request, 42, 2, 3).status_code, 404)
        material.assert_not_called()
        source_file.assert_not_called()

    def test_course_covers_use_scoped_links_and_cannot_open_other_files(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/')
        profile = SimpleNamespace(enrolment_id=7)
        history = {'covers': {
            'legacy:1': '/curriculum_api/curriculum/uploads/archive/owned.png',
            'legacy:2': 'https://example.invalid/public.png'}}
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.EnrolmentUser.all_learners') as learners, \
             patch('learner_api.learner_detail.build_learner_detail', return_value={}), \
             patch('learner_api.student_activity.student_activity', return_value=JsonResponse(history)):
            learners.get.return_value = SimpleNamespace(id=7)
            result = learner_learning.__wrapped__.__wrapped__(request, 42)
        covers = json.loads(result.content)['historical']['covers']
        self.assertEqual(covers['legacy:1'],
                         '/login_api/advanced-admin/learners/42/learning/covers/legacy%3A1/')
        self.assertEqual(covers['legacy:2'], history['covers']['legacy:2'])
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('learner_api.student_activity.student_activity') as read:
            self.assertEqual(learner_cover.__wrapped__.__wrapped__(request, 42, 'legacy:1').status_code, 404)
        read.assert_not_called()
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('learner_api.student_activity.student_activity', return_value=JsonResponse(history)), \
             patch('curriculum_api.views.curriculum_uploaded_file') as serve:
            learner_cover.__wrapped__.__wrapped__(request, 42, 'legacy:1')
            self.assertEqual(learner_cover.__wrapped__.__wrapped__(request, 42, 'legacy:3').status_code, 404)
            self.assertEqual(learner_cover.__wrapped__.__wrapped__(request, 42, 'legacy:2').status_code, 404)
        serve.assert_called_once_with(request, 'archive/owned.png')

    def test_learning_material_is_read_only_and_rewrites_only_owned_file_urls(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/2/3/')
        profile = SimpleNamespace(enrolment_id=7)
        media = [{'url': '/learner_api/student-activity/commercial/7/2/3/source-file/'},
                 {'url': '/curriculum_api/curriculum/uploads/archive/owned.pdf'},
                 {'url': 'https://example.invalid/public.mp4'}]
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin._legacy_material_response',
                   return_value=JsonResponse({'can_attempt': True, 'csrf_token': 'secret', 'media': media})):
            response = learner_material.__wrapped__.__wrapped__(request, 42, 2, 3)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertFalse(payload['can_attempt'])
        self.assertEqual(payload['csrf_token'], '')
        self.assertEqual(payload['media'][0]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/2/3/source-file/')
        self.assertEqual(payload['media'][1]['url'],
                         '/login_api/advanced-admin/learners/42/learning/material/2/3/media/1/')
        self.assertEqual(payload['media'][2]['url'], media[2]['url'])

    def test_archived_media_requires_approved_learner_and_activity_media_slot(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/material/2/3/media/0/')
        response = JsonResponse({'media': [
            {'url': '/curriculum_api/curriculum/uploads/archive/owned.pdf'},
            {'url': 'https://example.invalid/public.mp4'}]})
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin._legacy_material_response') as material:
            self.assertEqual(learner_material_media.__wrapped__.__wrapped__(request, 42, 2, 3, 0).status_code, 404)
        material.assert_not_called()
        with patch('login.advanced_admin._profile_in_scope', return_value=SimpleNamespace(enrolment_id=7)), \
             patch('login.advanced_admin._legacy_material_response', return_value=response), \
             patch('curriculum_api.views.curriculum_uploaded_file') as serve:
            learner_material_media.__wrapped__.__wrapped__(request, 42, 2, 3, 0)
            self.assertEqual(learner_material_media.__wrapped__.__wrapped__(request, 42, 2, 3, 1).status_code, 404)
            self.assertEqual(learner_material_media.__wrapped__.__wrapped__(request, 42, 2, 3, 2).status_code, 404)
        serve.assert_called_once_with(request, 'archive/owned.pdf')

    def test_current_activity_and_files_refuse_out_of_scope_learner(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/components/a/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin._scoped_component') as component:
            self.assertEqual(learner_component.__wrapped__.__wrapped__(request, 42, 'a').status_code, 404)
            self.assertEqual(learner_component_file.__wrapped__.__wrapped__(
                request, 42, 'a', 'resource').status_code, 404)
        component.assert_not_called()

    def test_current_file_requires_an_authored_slot(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/learning/components/a/files/resource/')
        profile = SimpleNamespace(enrolment_id=7)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin._scoped_component',
                   return_value=(SimpleNamespace(), {'resourceUrl': '/curriculum_api/curriculum/uploads/owned.pdf'})), \
             patch('curriculum_api.views.curriculum_uploaded_file') as serve:
            learner_component_file.__wrapped__.__wrapped__(request, 42, 'a', 'resource')
        serve.assert_called_once_with(request, 'owned.pdf')

    def test_coaching_source_is_disabled_in_test_runner(self):
        with patch('login.advanced_admin.sys.argv', ['manage.py', 'test']), \
             patch.dict('os.environ', {'COACHING_SESSIONS_DATABASE_URL': 'postgresql://u:p@host.invalid/db'}):
            self.assertEqual(_coaching_connection_string(), '')

    def test_inclusion_does_not_match_blank_email_to_other_support_tickets(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/inclusion/')
        profile = SimpleNamespace(aptem_id=123, email='')
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('coach_api.support_tickets._connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = []
            response = learner_inclusion.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.execute.call_count, 2)
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [123])
        self.assertEqual(cursor.execute.call_args_list[1].args[1], [123])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_inclusion_response_contains_only_current_learner_report_fields(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/inclusion/')
        profile = SimpleNamespace(aptem_id=123, email='sample@example.invalid')
        report = {
            'id': uuid4(), 'status': 'active', 'overall_risk_level': 'Low',
            'progress_tier': 1, 'programme': 'Sample Programme',
            'organization_name': 'Example Organisation', 'coach_name': 'Sample Coach',
            'created_at': datetime(2026, 10, 7, tzinfo=timezone.utc),
            'updated_at': None, 'master_report': {
                'reportHeader': {'contacts': {'managerName': 'Sample Manager'}},
                'overview': {'overallScore': 127}, 'managerBrief': {'oneLineStatus': 'Saved'},
                'professionalNote': 'Saved note.',
            },
            'technology_report': None, 'visual_hearing_report': None,
            'dyslexia_report': None, 'adhd_report': None,
            'social_anxiety_report': None, 'mood_learning_capacity_report': None,
            'notes': [], 'evidence': [], 'is_archived': False,
        }
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('coach_api.support_tickets._connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.side_effect = [[report], [], []]
            response = learner_inclusion.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([call.args[1] for call in cursor.execute.call_args_list],
                         [[123], [123], ['sample@example.invalid']])
        payload = json.loads(response.content)
        self.assertEqual(len(payload['reports']), 1)
        self.assertEqual(payload['reports'][0]['organisation'], 'Example Organisation')
        self.assertEqual(payload['reports'][0]['reportHeader']['contacts']['managerName'], 'Sample Manager')
        self.assertEqual(payload['reports'][0]['managerBrief'], {'oneLineStatus': 'Saved'})
        self.assertEqual(payload['reports'][0]['overview'], {'overallScore': 127})
        self.assertEqual(payload['tickets'], [])
        self.assertEqual(payload['supportTickets'], [])

    def test_inclusion_pdf_refuses_out_of_scope_learner_before_source_read(self):
        report_id = uuid4()
        request = RequestFactory().get(f'/login_api/advanced-admin/learners/42/inclusion/reports/{report_id}/pdf/')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('coach_api.support_tickets._connect') as connect:
            response = learner_inclusion_report_pdf.__wrapped__.__wrapped__(request, 42, report_id)
        self.assertEqual(response.status_code, 404)
        connect.assert_not_called()

    def test_inclusion_pdf_requires_report_id_and_current_learner_id(self):
        report_id = uuid4()
        request = RequestFactory().get(f'/login_api/advanced-admin/learners/42/inclusion/reports/{report_id}/pdf/')
        profile = SimpleNamespace(aptem_id=123)
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('coach_api.support_tickets._connect') as connect, \
             patch('login.inclusion_report_pdf.build_inclusion_report_pdf') as render:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = None
            response = learner_inclusion_report_pdf.__wrapped__.__wrapped__(request, 42, report_id)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(cursor.execute.call_args.args[1], [report_id, 123])
        render.assert_not_called()

    def test_inclusion_pdf_download_uses_saved_report_and_private_response(self):
        report_id = uuid4()
        request = RequestFactory().get(f'/login_api/advanced-admin/learners/42/inclusion/reports/{report_id}/pdf/')
        profile = SimpleNamespace(aptem_id=123)
        saved = {'reportHeader': {'learnerName': 'Sample Learner'}, 'overview': {'overallScore': 20}}
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('coach_api.support_tickets._connect') as connect, \
             patch('login.inclusion_report_pdf.build_inclusion_report_pdf', return_value=b'%PDF-saved') as render:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = {
                'master_report': saved, 'learner_name': 'Sample Learner',
                'learner_email': 'sample@example.invalid', 'programme': 'Sample',
                'organization_name': 'Example', 'created_at': datetime(2026, 10, 7, tzinfo=timezone.utc),
            }
            response = learner_inclusion_report_pdf.__wrapped__.__wrapped__(request, 42, report_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'%PDF-saved')
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertIn('attachment;', response['Content-Disposition'])
        self.assertEqual(cursor.execute.call_args.args[1], [report_id, 123])
        self.assertIs(render.call_args.args[0], saved)


class AdvancedAdminScopeSelectionTests(SimpleTestCase):
    def test_requested_names_resolve_only_to_approved_unique_profiles(self):
        workbook = {'101': 'ME', '102': 'PCP'}
        profiles = [(101, 'Maryjane Example'), (102, 'Another Learner'),
                    (103, 'Outside Learner')]
        self.assertEqual(
            select_named_rows(workbook, profiles, ['Mary Jane Example']),
            {'101': 'ME'},
        )
        with self.assertRaises(CommandError):
            select_named_rows(workbook, profiles, ['Outside Learner'])
        with self.assertRaises(CommandError):
            select_named_rows(workbook, profiles, ['Maryjane Example', 'Mary Jane Example'])

    def test_ambiguous_names_are_rejected(self):
        with self.assertRaises(CommandError):
            select_named_rows({'101': 'ME', '102': 'ME'},
                              [(101, 'Same Name'), (102, 'Same Name')], ['Same Name'])


class AdvancedAdminAuditAssignmentTests(SimpleTestCase):
    def test_list_uses_scoped_aptem_id_and_preserves_plan_and_evidence_values(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/audit-assignments/')
        profile = SimpleNamespace(aptem_id=123)
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [(501, 'Case study', 'September 2026', None, 'Assignment', 'A', '11', None, None,
              [{'path': 'archive/Submission.docx', 'resolution': 'unique_path',
                'source_file_id': 'file-1', 'url': 'https://onedrive.live.com/example'}])],
            [(100, 11)],
            [(100, 11, 'Submission', 'PendingAssessment', datetime(2026, 9, 12, tzinfo=timezone.utc),
              None, [{'message': 'Original feedback'}], True, False, 'Answer', ['K1'], 150,
              'Assignment', False, None, None)],
            [(11, 4, 2.5, date(2026, 9, 1))],
            [(501, 'accepted', 'Reviewed.', 'Advanced Admin',
              datetime(2026, 10, 8, tzinfo=timezone.utc))],
        ]
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.connections') as databases, \
             patch('learner_api.legacy_marking.reviews_for_evidence', return_value={100: []}):
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignments.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [123])
        self.assertIn('"Last_audit".assigments_check', cursor.execute.call_args_list[0].args[0])
        self.assertEqual(cursor.execute.call_args_list[1].args[1], [123])
        self.assertEqual(cursor.execute.call_args_list[2].args[1], [123, [11], []])
        self.assertEqual(cursor.execute.call_args_list[3].args[1], [123, [11]])
        self.assertIn("lower(btrim(e.evidence_kind)) = 'file'",
                      cursor.execute.call_args_list[2].args[0])
        self.assertIn("evaluation->'admin_verified_ksb_codes'",
                      cursor.execute.call_args_list[2].args[0])
        item = json.loads(response.content)['items'][0]
        self.assertEqual(item['month'], '2026-09')
        self.assertEqual(item['actualHours'], 2.5)
        self.assertEqual(item['monthSource'], 'audit')
        self.assertEqual(item['evidence'][0]['verifiedKsbCodes'], ['K1'])
        self.assertEqual(item['sourceFiles'], [
            {'name': 'Submission.docx', 'url': 'https://onedrive.live.com/example'}])
        self.assertEqual(item['sourceMarkId'], 501)
        self.assertEqual(item['sourceReviews'][0]['decision'], 'accepted')
        self.assertEqual(item['status'], 'Completed')

    def test_misc_files_group_by_upload_month_and_component_name_with_report_hours(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/audit-assignments/')
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [],
            [(201, 77), (202, 78), (203, 78), (204, 79), (205, 80)],
            [(204, 79, 'October file', 'PendingAssessment',
              datetime(2026, 9, 30, 23, 30, tzinfo=timezone.utc), None, [], True, True,
              '', [], 10, 'Additional Job Activities', True, 7200, 'parsed'),
             (203, 78, 'Unreported file', 'Accepted',
              datetime(2026, 9, 13, tzinfo=timezone.utc), None, [], True, False,
              '', [], 10, 'Additional Job Activities', True, None, None),
             (202, 78, 'Second file', 'Accepted',
              datetime(2026, 9, 12, tzinfo=timezone.utc), None, [], True, True,
              '', ['S2'], 10, 'Additional Job Activities', True, 3600, 'parsed'),
             (201, 77, 'First file', 'Accepted',
              datetime(2026, 9, 11, tzinfo=timezone.utc), None, [], True, True,
              '', ['K1'], 10, 'Additional Job Activities', True, 7200, 'parsed'),
             (205, 80, 'Typo component file', 'Accepted',
              datetime(2026, 9, 10, tzinfo=timezone.utc), None, [], True, True,
              '', ['K2'], 10, 'Additioinal job activities', True, 1800, 'parsed')],
            [], [],
        ]
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin.connections') as databases, \
             patch('learner_api.legacy_marking.reviews_for_evidence', return_value={}):
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignments.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.execute.call_args_list[2].args[1], [123, [], []])
        sql = cursor.execute.call_args_list[2].args[0]
        self.assertIn("lower(btrim(e.evidence_kind)) = 'file'", sql)
        self.assertIn('(additional|additioinal)[[:space:]]+job', sql)
        self.assertIn('h.report_hash = md5(e.report_blob)', sql)
        items = json.loads(response.content)['items']
        self.assertEqual(len(items), 3)
        by_month_and_name = {(item['month'], item['name']): item for item in items}
        september = by_month_and_name['2026-09', 'Additional Job Activities']
        self.assertEqual(september['name'], 'Additional Job Activities')
        self.assertEqual(september['type'], 'Miscellaneous')
        self.assertEqual([evidence['id'] for evidence in september['evidence']], [203, 202, 201])
        self.assertEqual(september['actualHours'], 3)
        self.assertEqual(september['missingReportHours'], 1)
        self.assertEqual(september['status'], 'Completed')
        typo_group = by_month_and_name['2026-09', 'Additioinal job activities']
        self.assertEqual([evidence['id'] for evidence in typo_group['evidence']], [205])
        self.assertEqual(typo_group['actualHours'], 0.5)
        self.assertEqual(by_month_and_name['2026-10', 'Additional Job Activities']['status'],
                         'PendingAssessment')
        self.assertIsNone(by_month_and_name['2026-10', 'Additional Job Activities']['actualHours'])

    def test_check_assignment_sums_accepted_file_hours_when_no_recorded_total(self):
        request = RequestFactory().get('/login_api/advanced-admin/learners/42/audit-assignments/')
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [(601, 'Project assignment', 'October 2026', None, 'Assignment', None,
              None, '100', None, [])],
            [(100, 50), (101, 50)],
            [(100, 50, 'First file', 'Accepted', datetime(2026, 10, 1, tzinfo=timezone.utc),
              None, [], True, False, '', ['K1'], 60, 'Assignment', False, None, None),
             (101, 50, 'Second file', 'Accepted', datetime(2026, 10, 2, tzinfo=timezone.utc),
              None, [], True, False, '', ['S2'], 30, 'Assignment', False, None, None)],
            [],
            [],
        ]
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin.connections') as databases, \
             patch('learner_api.legacy_marking.reviews_for_evidence', return_value={}):
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignments.__wrapped__.__wrapped__(request, 42)
        self.assertEqual(response.status_code, 200)
        item = json.loads(response.content)['items'][0]
        self.assertEqual(item['name'], 'Project assignment')
        self.assertEqual(item['status'], 'Completed')
        self.assertEqual(item['actualHours'], 1.5)
        self.assertEqual([value['id'] for value in item['evidence']], [100, 101])
        self.assertIn("lower(btrim(e.evidence_kind)) = 'file'",
                      cursor.execute.call_args_list[2].args[0])

    def test_file_marking_stays_scoped_to_checked_assignments(self):
        profile = SimpleNamespace(aptem_id=123)
        cursor = MagicMock()
        cursor.fetchone.return_value = (201, 'Accepted work', 'blob', None, 77)
        with patch('login.advanced_admin.connections') as databases:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            result = _assignment_evidence(profile, 201)
        self.assertEqual(result[0], 201)
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [123, 201])
        self.assertIn('"Last_audit".assigments_check', sql)
        self.assertIn("lower(btrim(e.evidence_kind)) = 'file'", sql)
        self.assertIn('miscellan', sql)
        self.assertIn('(additional|additioinal)[[:space:]]+job', sql)

    def test_imported_file_can_be_marked_only_for_the_scoped_learner(self):
        request = RequestFactory().post('/mark/', data=json.dumps({
            'decision': 'accepted', 'feedback': 'Reviewed source file.',
        }), content_type='application/json')
        request.login_account = SimpleNamespace(id=7, display_name='Reviewer', email='')
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            (501, 'Project assignment', [{
                'path': 'archive/Work.pdf', 'resolution': 'unique_path',
                'source_file_id': 'file-1', 'url': 'https://onedrive.live.com/example',
            }], 'Assignment', 'A', None),
            (9, datetime(2026, 10, 8, tzinfo=timezone.utc)),
        ]
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin.connections') as databases:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignment_source_mark.__wrapped__(request, 42, 501)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(cursor.execute.call_args_list[0].args[1], [501, 123])
        self.assertEqual(cursor.execute.call_args_list[1].args[1],
                         ['123', 501, 'accepted', 'Reviewed source file.', 'Reviewer (Advanced Admin)', 7])

    def test_imported_mark_refuses_an_unresolved_file(self):
        request = RequestFactory().post('/mark/', data=json.dumps({
            'decision': 'accepted', 'feedback': 'Reviewed.',
        }), content_type='application/json')
        cursor = MagicMock()
        cursor.fetchone.return_value = (501, 'Project assignment', [{
            'path': 'archive/Work.pdf', 'resolution': 'unresolved',
            'url': 'https://onedrive.live.com/example',
        }], 'Assignment', 'A', None)
        with patch('login.advanced_admin._profile_in_scope',
                   return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin.connections') as databases:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignment_source_mark.__wrapped__(request, 42, 501)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_note_evidence_cannot_be_marked_or_opened_by_direct_url(self):
        profile = SimpleNamespace(aptem_id=123)
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        request = RequestFactory().post('/login_api/advanced-admin/learners/42/audit-assignments/evidence/100/mark/',
                                        data=json.dumps({'decision': 'accepted', 'feedback': 'Done'}),
                                        content_type='application/json')
        with patch('login.advanced_admin._profile_in_scope', return_value=profile), \
             patch('login.advanced_admin.connections') as databases:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            mark = learner_audit_assignment_mark.__wrapped__(request, 42, 100)
            document = learner_audit_assignment_document.__wrapped__.__wrapped__(
                RequestFactory().get('/'), 42, 100, 'report')
        self.assertEqual(mark.status_code, 404)
        self.assertEqual(document.status_code, 404)
        self.assertEqual(cursor.execute.call_count, 2)
        for call in cursor.execute.call_args_list:
            self.assertIn("lower(btrim(e.evidence_kind)) = 'file'", call.args[0])
            self.assertEqual(call.args[1], [123, 100])

    def test_mark_and_document_refuse_unscoped_evidence(self):
        request = RequestFactory().post('/login_api/advanced-admin/learners/42/audit-assignments/evidence/100/mark/',
                                        data=json.dumps({'decision': 'accepted', 'feedback': 'Done'}),
                                        content_type='application/json')
        with patch('login.advanced_admin._profile_in_scope', return_value=None), \
             patch('login.advanced_admin.connections') as databases:
            response = learner_audit_assignment_mark.__wrapped__(request, 42, 100)
            document = learner_audit_assignment_document.__wrapped__.__wrapped__(
                RequestFactory().get('/'), 42, 100, 'file')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(document.status_code, 404)
        databases.__getitem__.assert_not_called()

    def test_mark_requires_matching_assignment_evidence(self):
        request = RequestFactory().post('/login_api/advanced-admin/learners/42/audit-assignments/evidence/100/mark/',
                                        data=json.dumps({'decision': 'accepted', 'feedback': 'Done'}),
                                        content_type='application/json')
        with patch('login.advanced_admin._profile_in_scope', return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin._assignment_evidence', return_value=None), \
             patch('login.advanced_admin.connections') as databases:
            response = learner_audit_assignment_mark.__wrapped__(request, 42, 100)
        self.assertEqual(response.status_code, 404)
        databases.__getitem__.assert_not_called()

    def test_mark_appends_decision_only_for_owned_evidence(self):
        request = RequestFactory().post('/login_api/advanced-admin/learners/42/audit-assignments/evidence/100/mark/',
                                        data=json.dumps({'decision': 'accepted', 'feedback': 'Reviewed'}),
                                        content_type='application/json')
        request.login_account = SimpleNamespace(display_name='Sample Admin', email='', id=5)
        cursor = MagicMock()
        cursor.fetchone.return_value = (7, datetime(2026, 9, 13, tzinfo=timezone.utc))
        with patch('login.advanced_admin._profile_in_scope', return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin._assignment_evidence', return_value=(100, 'Upload', 'blob', None, 11)), \
             patch('login.advanced_admin.connections') as databases:
            databases.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = learner_audit_assignment_mark.__wrapped__(request, 42, 100)
        self.assertEqual(response.status_code, 201)
        self.assertIn('Advanced_admin_legacy_marks', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1][:4], ['123', 100, 'accepted', 'Reviewed'])

    def test_view_uses_only_the_scoped_evidence_blob(self):
        with patch('login.advanced_admin._profile_in_scope', return_value=SimpleNamespace(aptem_id=123)), \
             patch('login.advanced_admin._assignment_evidence', return_value=(100, 'Upload', 'owned-blob', None, 11)), \
             patch('learner_api.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.evidence_storage.get_read_sas', return_value='https://example.invalid/owned') as sign:
            response = learner_audit_assignment_document.__wrapped__.__wrapped__(
                RequestFactory().get('/'), 42, 100, 'file')
        self.assertEqual(response.status_code, 200)
        sign.assert_called_once_with('fetch-aptem-evidences', 'owned-blob')
