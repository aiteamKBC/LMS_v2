"""No database setup: these tests forbid DB access and mock only repository I/O."""
from contextlib import nullcontext
from copy import deepcopy
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase, override_settings
from PIL import Image, ImageDraw

from . import gate, repository as repo, service, storage, views


def account(role='learner', subject_id=7, email=' Student@Example.org '):
    return SimpleNamespace(id=101 if role == 'learner' else 202, is_active=True,
                           role=role, subject_type='learner' if role == 'learner' else 'staff',
                           subject_id=subject_id, email=email, display_name='Test signer')


@override_settings(OLD_OTJH_ENABLED=True)
class TransitionTests(SimpleTestCase):
    def setUp(self):
        self.user = account()
        self.record = {'id': 7, 'email': 'student@example.org', 'name': 'Test student',
                       'programme': 'Programme', 'aptem_id': '00042'}
        self.history = [{'aptem_id': 42, 'learner_id': 9, 'learner_name': 'Test student',
                         'programme_name': 'Programme', 'coach_email': 'coach@example.org', 'coach_name': 'Coach'}]
        self.transition = {'id': 1, 'learner_id': 7, 'aptem_id': 42,
                           'required_months': ['2026-07', '2026-08'], 'completed_at': None}
        self.sources = [{'month': m, 'row_count': 1, 'planned_hours': 2, 'actual_hours': 1,
                         'not_accepted_hours': 0} for m in self.transition['required_months']]
        self.signs, self.finals, self.pending, self.events = [], [], [], []
        self.rows = [{'id': 3, 'title': 'Original activity', 'actual_hours': 1, 'documents': []}]
        self.mocks = {}
        behaviors = {
            'student': lambda ident: deepcopy(self.record) if ident == 7 else None,
            'linked_learners': lambda _: [{'id': 7}],
            'historical_learner': lambda _: deepcopy(self.history),
            'staff': lambda _: {'access': 'coach', 'email': 'coach@example.org'},
            'transition': lambda _, lock=False: deepcopy(self.transition),
            'source_months': lambda _: deepcopy(self.sources),
            'signatures': lambda _: deepcopy(self.signs),
            'finalizations': lambda _: deepcopy(self.finals),
            'pending_revisions': lambda _: deepcopy(self.pending),
            'month_rows': lambda *_: deepcopy(self.rows),
            'content_review': lambda *_: {'ready': True, 'issues': []},
            'activity_row': lambda learner, month, ident: {'id': 3, 'activity_id': 9} if ident == 3 else None,
            'activity_parts': lambda *_: [{'id': 9, 'title': 'Activity', 'url': 'https://example.org/reading', 'html': None, 'quiz': None}],
            'report_profile': lambda *_: {'start_date': None, 'planned_end_date': None, 'first_evidence_date': None},
            'atomic': nullcontext,
            'save_signature': self.save_sign,
            'save_learner_signature': lambda *_: None,
            'finalize': self.finalize,
            'set_completed': self.set_complete,
            'event': lambda *args: self.events.append(args),
        }
        for name, fn in behaviors.items():
            p = patch.object(repo, name, side_effect=fn)
            self.mocks[name] = p.start()
            self.addCleanup(p.stop)
        self.addCleanup(patch.stopall)
        self.save_file = patch.object(storage, 'save', return_value='a' * 32).start()
        self.delete_file = patch.object(storage, 'delete').start()

    def learner(self):
        return service.resolve_authenticated_learner(self.user)

    def save_sign(self, learner, month, role, name, file_id, digest):
        self.signs[:] = [s for s in self.signs if (s['report_month'], s['signer_role']) != (month, role)]
        self.signs.append({'id': len(self.signs) + 1, 'report_month': month, 'signer_role': role,
                           'signer_name': name, 'file_id': file_id, 'signed_at': '2026-09-07T10:00:00Z',
                           'snapshot_hash': digest})

    def finalize(self, learner, month, digest, row_count, actor, reason=None, metadata=None):
        self.finals[:] = [f for f in self.finals if f['report_month'] != month]
        self.finals.append({'id': len(self.finals) + 1, 'report_month': month,
                            'event_type': 'reopened' if reason else 'finalized', 'created_at': '2026-09-07T10:00:00Z'})

    def set_complete(self, transition_id, complete):
        self.transition['completed_at'] = '2026-09-07T10:00:00Z' if complete else None
        return self.transition['completed_at']

    def signed(self, month='2026-07', roles=('learner', 'coach')):
        for role in roles:
            self.save_sign(self.learner(), month, role, 'Signer', 'a' * 32, 'original-digest')

    def request(self, method='get', path='/audit_api/last-audit/manual/rows?month=2026-07', data=None, user=None):
        factory = RequestFactory()
        r = factory.get(path) if method == 'get' else factory.post(path, data or {}, content_type='application/json')
        r.login_account = user or self.user
        r._dont_enforce_csrf_checks = True
        return r

    def test_identity_uses_session_and_stored_aptem_id(self):
        self.assertEqual(self.learner()['aptem_id'], 42)
        self.mocks['student'].assert_called_once_with(7)

    def test_email_comparison_is_trimmed_case_insensitive(self):
        self.record['email'] = '  STUDENT@example.ORG '
        self.assertEqual(self.learner()['id'], 7)

    @override_settings(OLD_OTJH_COACH_BOOKING_URLS={
        'coach@example.org': 'https://example.org/book/first',
        'second@example.org': 'https://example.org/book/second',
    })
    def test_summary_booking_follows_current_source_coach(self):
        self.assertEqual(service.summary(self.learner())['learner']['coach_booking_url'],
                         'https://example.org/book/first')
        self.history[0]['coach_email'] = ' Second@Example.org '
        self.assertEqual(service.summary(self.learner())['learner']['coach_booking_url'],
                         'https://example.org/book/second')
        self.history[0]['coach_email'] = 'unconfigured@example.org'
        self.assertIsNone(service.summary(self.learner())['learner']['coach_booking_url'])

    def test_missing_email_requires_support(self):
        self.user.email = ''
        with self.assertRaises(service.ServiceError): self.learner()

    def test_changed_email_requires_support(self):
        self.user.email = 'other@example.org'
        with self.assertRaises(service.ServiceError): self.learner()

    def test_blank_aptem_id_follows_new_lms(self):
        self.record['aptem_id'] = ' '
        self.assertTrue(service.summary(self.learner())['can_access_lms'])

    def test_invalid_aptem_id_is_not_new_learner(self):
        self.record['aptem_id'] = 'broken-link'
        with self.assertRaises(service.ServiceError): self.learner()

    def test_missing_historical_match_does_not_grant_lms(self):
        self.history.clear()
        with self.assertRaises(service.ServiceError): self.learner()

    def test_duplicate_historical_match_discloses_no_record(self):
        self.history *= 2
        response = views.summary(self.request())
        self.assertEqual(response.status_code, 409)
        self.assertNotIn('learners', json.loads(response.content))

    def test_duplicate_stored_aptem_links_require_review(self):
        self.mocks['linked_learners'].side_effect = lambda _: [{'id': 7}, {'id': 8}]
        with self.assertRaises(service.ServiceError): self.learner()

    def test_changed_stored_link_refuses_old_transition_files(self):
        self.transition['aptem_id'] = 43
        with patch.object(repo, 'document', return_value={'month': '2026-07'}):
            self.assertEqual(views.document(self.request(), 99).status_code, 409)

    def test_student_cannot_supply_another_aptem_id(self):
        response = views.rows(self.request(path='/audit_api/last-audit/manual/rows?aptem_id=43&month=2026-07'))
        self.assertEqual(response.status_code, 404)
        self.mocks['month_rows'].assert_not_called()

    def test_student_cannot_supply_another_id_or_email(self):
        response = views.rows(self.request(path='/audit_api/last-audit/manual/rows?learner_id=8&month=2026-07'))
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_use_coach_permissions(self):
        with self.assertRaises(service.ServiceError): service.coach_actor(self.user)
        self.assertEqual(views.coach_learners(self.request()).status_code, 403)

    def test_coach_cannot_access_other_coachs_student(self):
        self.history[0]['coach_email'] = 'someone-else@example.org'
        with self.assertRaises(service.ServiceError): service.coach_learner(account('staff'), 42)

    def test_live_staff_grant_required(self):
        self.mocks['staff'].side_effect = lambda _: {'email': 'coach@example.org', 'access': 'curriculum'}
        with self.assertRaises(service.ServiceError): service.coach_actor(account('staff'))

    def test_required_months_stay_fixed(self):
        self.sources.append({**self.sources[0], 'month': '2026-06'})
        data = service.summary(self.learner())
        self.assertEqual([m['month'] for m in data['months']], ['2026-07', '2026-08'])
        self.assertEqual(data['additional_source_months'], ['2026-06'])

    def test_no_data_is_not_vacuously_complete(self):
        self.transition['required_months'] = []
        self.sources.clear()
        self.assertFalse(service.summary(self.learner())['can_access_lms'])

    def test_invalid_and_post_cutoff_months_refused(self):
        for month in ['2026-13', '2026-00', '2026-09', '2026-7', '../2026-07']:
            with self.subTest(month=month), self.assertRaises(service.ServiceError): service.month_detail(self.learner(), month)

    def test_complete_requires_learner_signature(self):
        for roles in [(), ('coach',)]:
            self.signs.clear(); self.signed(roles=roles)
            with self.subTest(roles=roles), self.assertRaises(service.ServiceError):
                service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.mocks['finalize'].assert_not_called()

    def test_pending_revision_blocks_completion(self):
        self.signed(); self.pending.append({'month': '2026-07', 'count': 1})
        with self.assertRaises(service.ServiceError): service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.mocks['finalize'].assert_not_called()

    def test_complete_without_source_rows_is_refused(self):
        self.signed(); self.sources.clear()
        with self.assertRaises(service.ServiceError): service.complete(self.learner(), '2026-07', self.user, 'learner')

    def test_complete_is_idempotent_and_transactional(self):
        self.signed()
        for _ in range(2): service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.mocks['finalize'].assert_called_once()
        self.assertEqual(len([e for e in self.events if e[2] == 'completed']), 1)
        self.assertIn(((7,), {'lock': True}), self.mocks['transition'].call_args_list)

    def test_all_months_complete_opens_lms(self):
        for month in self.transition['required_months']:
            self.signed(month); service.complete(self.learner(), month, self.user, 'learner')
        result = service.summary(self.learner())
        self.assertTrue(result['can_access_lms'])
        self.assertEqual(result['completed_months'], 2)
        self.assertIsNotNone(result['completed_at'])

    def test_completed_month_signature_is_read_only(self):
        self.signed(); service.complete(self.learner(), '2026-07', self.user, 'learner')
        with self.assertRaises(service.ServiceError):
            service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', service.digest(self.rows), {})
        self.save_file.assert_not_called()

    def test_source_edits_are_live_and_preserve_signatures(self):
        self.signed(); service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.rows[0]['title'] = 'Updated in the other system'
        detail = service.month_detail(self.learner(), '2026-07')
        self.assertEqual(detail['rows'][0]['title'], 'Updated in the other system')
        self.assertEqual(detail['student_signature']['snapshot_hash'], 'original-digest')
        self.assertEqual(detail['status'], 'complete')

    def test_external_reopening_is_read_live(self):
        self.signed(); service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.finals[0]['event_type'] = 'reopened'
        self.assertEqual(service.month_detail(self.learner(), '2026-07')['status'], 'ready_to_complete')

    def test_reopening_requires_admin_and_reason_and_preserves_signatures(self):
        self.signed(); service.complete(self.learner(), '2026-07', self.user, 'learner')
        for role, reason in [('learner', 'Correction'), ('coach', 'Correction'), ('admin', '')]:
            with self.subTest(role=role), self.assertRaises(service.ServiceError):
                service.reopen(self.learner(), '2026-07', account('staff'), role, reason)
        detail = service.reopen(self.learner(), '2026-07', account('admin'), 'admin', 'Correction requested')
        self.assertEqual(detail['status'], 'ready_to_complete')
        self.assertEqual(detail['student_signature']['snapshot_hash'], 'original-digest')
        self.assertEqual(self.events[-1][5]['reason'], 'Correction requested')

    def test_coach_signature_cannot_replace_learner_signature(self):
        self.signed(roles=('learner',))
        service.sign(self.learner(), '2026-07', account('staff'), 'coach', b'png', service.digest(self.rows), {})
        student_sign = next(s for s in self.signs if s['signer_role'] == 'learner')
        self.assertEqual(student_sign['snapshot_hash'], 'original-digest')
        self.assertEqual(next(e for e in self.events if e[2] == 'signed')[5]['signer_role'], 'coach')
        self.mocks['save_learner_signature'].assert_not_called()

    def test_committed_signature_is_not_deleted_if_response_refresh_fails(self):
        with patch.object(service, 'month_detail', side_effect=DatabaseError('read failed')):
            with self.assertRaises(DatabaseError):
                service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', service.digest(self.rows), {})
        self.mocks['save_signature'].assert_called_once()
        self.delete_file.assert_not_called()

    def test_changed_review_digest_refused_without_upload(self):
        with self.assertRaises(service.ServiceError):
            service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', 'stale', {})
        self.save_file.assert_not_called()

    def test_sign_records_authenticated_role_and_metadata(self):
        service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', service.digest(self.rows), {})
        self.assertEqual(self.signs[0]['signer_role'], 'learner')
        self.assertEqual(self.events[0][3].id, self.user.id)
        self.assertIn('file_sha256', self.events[0][5])

    def test_failed_write_cleans_new_image(self):
        self.mocks['save_signature'].side_effect = DatabaseError('simulated')
        with self.assertRaises(DatabaseError):
            service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', service.digest(self.rows), {})
        self.delete_file.assert_called_once()

    def test_gets_do_not_mutate(self):
        service.summary(self.learner()); service.month_detail(self.learner(), '2026-07')
        for name in ['save_signature', 'save_learner_signature', 'finalize', 'set_completed', 'event']:
            self.mocks[name].assert_not_called()

    def test_missing_document_is_not_disclosed(self):
        with patch.object(repo, 'document', return_value=None):
            self.assertEqual(views.document(self.request(), 99).status_code, 404)

    def test_student_cannot_use_activity_write_on_shared_path(self):
        legacy = Mock()
        wrapped = views.dispatch(legacy, views.rows)
        response = wrapped(self.request('post'))
        self.assertEqual(response.status_code, 405)
        legacy.assert_not_called()

    def test_batch_dispatch_resolves_identity_even_without_middleware(self):
        request = RequestFactory().get('/audit_api/last-audit/cohort/')
        legacy, scoped = Mock(), Mock(return_value=JsonResponse({'ok': True}))
        with patch.object(views, 'authenticate_request', return_value=self.user):
            views.dispatch(legacy, scoped)(request)
        scoped.assert_called_once(); legacy.assert_not_called()

    def test_csrf_is_required_for_signing(self):
        request = self.request('post', '/audit_api/learners/42/signoff/', {'month': '2026-07'})
        request._dont_enforce_csrf_checks = False
        self.assertEqual(views.signoff(request, 42).status_code, 403)

    def test_single_month_signoff_records_an_imported_capture(self):
        request = RequestFactory().post('/audit_api/learners/42/signoff/', {
            'month': '2026-07', 'snapshot_digest': service.digest(self.rows),
            'confirmed': 'true', 'capture_method': 'import',
            'signature': SimpleUploadedFile('signature.png', b'test-image', content_type='image/png'),
        })
        request.login_account = self.user
        request._dont_enforce_csrf_checks = True
        with patch.object(storage, 'sanitize', return_value=b'clean-png'):
            response = views.signoff(request, 42)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.events[0][5]['capture_method'], 'import')

    def test_new_lms_gate_refuses_direct_and_batch_paths(self):
        from login.api_gate import refusal_for
        with patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'}):
            self.assertEqual(refusal_for('/learner_api/learners/7/', self.user).status_code, 403)
        self.assertIsNone(gate.refusal('/audit_api/old-otjh/me/summary/', self.user))
        self.assertIsNone(gate.refusal('/learner_api/anything', account('staff')))

    def test_errors_do_not_disclose_database_exception(self):
        self.mocks['student'].side_effect = DatabaseError('secret connection details')
        response = views.summary(self.request())
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'secret', response.content)

    def test_missing_transition_storage_cannot_open_lms(self):
        self.mocks['transition'].side_effect = DatabaseError('missing transition table')
        response = gate.refusal('/learner_api/learner-detail/commercial/7/', self.user)
        self.assertEqual(response.status_code, 503)
        self.assertIn(b'records_unavailable', response.content)
        self.assertNotIn(b'missing transition table', response.content)

    def test_month_target_is_not_the_activity_planned_total(self):
        self.history[0]['planned_hours_monthly'] = '{"2026-07":31,"2026-08":0}'
        result = service.summary(self.learner())
        self.assertEqual(result['months'][0]['training_plan_target'], 31)
        self.assertEqual(result['months'][0]['planned_hours'], 2)
        self.assertEqual(result['months'][1]['training_plan_target'], 0)

    def test_embedded_activity_is_read_from_the_authorized_month_and_row(self):
        response = views.rows(self.request(path='/audit_api/last-audit/manual/rows?month=2026-07&activity_id=3'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['parts'][0]['id'], 9)
        args = self.mocks['activity_row'].call_args.args
        self.assertEqual((args[0]['aptem_id'], args[1], args[2]), (42, '2026-07', 3))

    def test_missing_content_prevents_signature_storage_and_month_completion(self):
        self.mocks['content_review'].side_effect = lambda *_: {'ready': False, 'issues': [{'id': 3}]}
        with self.assertRaises(service.ServiceError) as error:
            service.sign(self.learner(), '2026-07', self.user, 'learner', b'image', service.digest(self.rows), {})
        self.assertEqual(error.exception.code, 'content_unavailable')
        self.save_file.assert_not_called()
        self.mocks['save_signature'].assert_not_called()
        self.signed()
        with self.assertRaises(service.ServiceError) as error:
            service.complete(self.learner(), '2026-07', self.user, 'learner')
        self.assertEqual(error.exception.code, 'content_unavailable')
        self.mocks['finalize'].assert_not_called()

    def test_content_preflight_keeps_the_authenticated_learner_scope(self):
        response = views.content_review(self.request(path='/audit_api/old-otjh/content-check/?month=2026-07'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['snapshot_digest'], service.digest(self.rows))
        response = views.content_review(self.request(path='/audit_api/old-otjh/content-check/?month=2026-07&aptem_id=999'))
        self.assertEqual(response.status_code, 404)

    def test_original_evidence_preview_checks_learner_and_month_before_reading(self):
        doc = {'source_evidence_id': 88, 'source_kind': 'note', 'month': '2026-07', 'body': 'Original learner reflection', 'display_name': 'Reflection.txt'}
        with patch.object(repo, 'source_documents', return_value=[doc]) as read:
            response = views.source_document(self.request(path='/audit_api/old-otjh/source-documents/3/88/note/'), 3, 88, 'note')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b'Original learner reflection')
            self.assertEqual(read.call_args.args[0]['aptem_id'], 42)
            self.assertEqual(read.call_args.args[1], [3])
            response = views.source_document(self.request(path='/audit_api/old-otjh/source-documents/3/88/note/?aptem_id=999'), 3, 88, 'note')
            self.assertEqual(response.status_code, 404)
            doc['month'] = '2026-09'
            response = views.source_document(self.request(), 3, 88, 'note')
            self.assertEqual(response.status_code, 400)

    def test_office_preview_is_issued_only_for_an_authorized_record_document(self):
        doc = {'container': 'documents', 'blob_name': 'report.pptx', 'month': '2026-07'}
        with patch.object(repo, 'document', return_value=doc), patch.object(views.evidence_storage, 'azure_configured', return_value=True), patch.object(views.evidence_storage, 'get_read_sas', return_value='https://example.blob.core.windows.net/documents/report.pptx?read=only') as sas:
            response = views.document(self.request(path='/audit_api/old-otjh/documents/5/?preview=office'), 5)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(json.loads(response.content)['url'].startswith('https://view.officeapps.live.com/op/embed.aspx?src='))
            sas.assert_called_once_with('documents', 'report.pptx')
            response = views.document(self.request(path='/audit_api/old-otjh/documents/5/?preview=office&aptem_id=999'), 5)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(sas.call_count, 1)

    def test_material_backup_is_scoped_to_this_learner_month_and_activity(self):
        from . import content
        row = {'id': 3, 'month': '2026-07', 'category': 'reading+quiz', 'source_ref': 'la:7:99', 'title': 'Reading'}
        backup = {'material_id': 99, 'title': 'Reading', 'blob_container': 'private-source', 'blob_name': 'original.pdf', 'blob_content_type': 'application/pdf'}
        with patch.object(repo, 'activity_row', return_value=row), patch.object(content, 'catalogue', return_value={99: {'backup': backup}}), patch.object(views.evidence_storage, '_service_client') as storage:
            storage.return_value.get_blob_client.return_value.download_blob.return_value.chunks.return_value = iter([b'%PDF-original'])
            response = views.material_document(self.request(path='/audit_api/old-otjh/material-documents/3/99/?month=2026-07'), 3, 99)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(b''.join(response.streaming_content), b'%PDF-original')
            self.assertEqual(storage.call_count, 1)
            for query, ident in [('month=2026-07&aptem_id=999',99), ('month=2026-09',99), ('month=2026-07',100)]:
                response = views.material_document(self.request(path=f'/audit_api/old-otjh/material-documents/3/{ident}/?{query}'), 3, ident)
                self.assertIn(response.status_code, (400,404))
            self.assertEqual(storage.call_count, 1)

    def test_embedded_activity_cannot_select_another_learner_or_missing_row(self):
        for query in ('month=2026-07&activity_id=3&aptem_id=999', 'month=2026-07&activity_id=999',
                      'month=2026-09&activity_id=3'):
            response = views.rows(self.request(path=f'/audit_api/last-audit/manual/rows?{query}'))
            self.assertIn(response.status_code, (400, 404))
        self.mocks['activity_parts'].assert_not_called()

    def test_coach_content_access_uses_the_assigned_learner_scope(self):
        request = self.request(path='/audit_api/last-audit/manual/rows?month=2026-07&activity_id=3&aptem_id=42', user=account('staff'))
        self.assertEqual(views.rows(request).status_code, 200)
        self.history[0]['coach_email'] = 'someone-else@example.org'
        self.assertEqual(views.rows(request).status_code, 404)

    def test_mutation_detail_keeps_protected_document_links(self):
        result = views.public_detail(self.learner(), {'rows': [{'documents': [{'id': 71}]}]})
        self.assertEqual(result['rows'][0]['documents'][0]['url'], '/audit_api/old-otjh/documents/71/?aptem_id=42')

    def test_invalid_or_missing_targets_stay_unavailable(self):
        for value in [None, '{bad json', {'2026-07': 'NaN'}, {'2026-07': -1}]:
            self.history[0]['planned_hours_monthly'] = value
            self.assertIsNone(service.summary(self.learner())['months'][0]['training_plan_target'])

    def test_explicit_ksb_codes_are_normalized_without_inference(self):
        self.assertEqual(repo.ksb_codes('{"K":[{"code":"K1"}],"S":[{"code":"s6"}]}'), ['K1', 'S6'])
        self.assertEqual(repo.ksb_codes(['K1', 'K1', 'leadership', 'B2']), ['K1', 'B2'])
        self.assertEqual(repo.ksb_codes(None), [])
        self.assertEqual(repo.ksb_codes({'K': 4, 'S': 'S6', 'B': [{'code': 'B2'}]}), ['B2'])


    def bulk_months(self):
        return list(self.transition['required_months'])

    def test_learner_signature_alone_completes_single_month(self):
        result = service.sign(self.learner(), '2026-07', self.user, 'learner', b'png', service.digest(self.rows), {})
        self.assertEqual(result['status'], 'complete')
        self.assertIsNone(result['coach_signature'])
        self.mocks['save_learner_signature'].assert_called_once()
        self.assertEqual([e[2] for e in self.events], ['signed', 'completed'])

    def test_coach_signature_alone_does_not_complete(self):
        result = service.sign(self.learner(), '2026-07', account('staff'), 'coach', b'png', service.digest(self.rows), {})
        self.assertNotEqual(result['status'], 'complete')
        self.mocks['finalize'].assert_not_called()
        self.mocks['save_learner_signature'].assert_not_called()

    def test_bulk_learner_completes_every_month_without_material_reads(self):
        self.mocks['content_review'].side_effect = AssertionError('Materials must not be fetched')
        self.mocks['month_rows'].side_effect = AssertionError('Full activity rows must not be fetched')
        result = service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'clean-png', {})
        self.assertEqual(result['signed_months'], self.bulk_months())
        self.assertEqual(result['completed_months'], self.bulk_months())
        self.assertTrue(result['summary']['can_access_lms'])
        self.assertEqual(result['summary']['completed_months'], 2)
        self.assertIsNotNone(result['summary']['completed_at'])
        self.assertTrue(all(m['status'] == 'complete' and not m['coach_signature'] for m in result['summary']['months']))
        self.save_file.assert_called_once_with(b'clean-png')
        self.mocks['save_learner_signature'].assert_called_once_with(self.learner(), 'Test signer', b'clean-png')
        self.assertEqual({s['file_id'] for s in self.signs}, {'a' * 32})
        for event in self.events:
            self.assertFalse(event[5]['material_check_performed'])
        self.mocks['atomic'].assert_called_once()

    def test_bulk_coach_cannot_complete_without_learner(self):
        result = service.sign_months(self.learner(), self.bulk_months(), account('staff'), 'coach', b'coach', {})
        self.assertEqual(result['completed_months'], [])
        self.assertFalse(result['summary']['can_access_lms'])
        self.assertEqual({s['signer_role'] for s in self.signs}, {'coach'})
        self.mocks['save_learner_signature'].assert_not_called()
        self.mocks['finalize'].assert_not_called()

    def test_bulk_keeps_existing_coach_images(self):
        self.signed(roles=('coach',))
        before = deepcopy(self.signs[0])
        result = service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'learner', {})
        self.assertTrue(result['summary']['can_access_lms'])
        self.assertEqual(next(s for s in self.signs if s['signer_role'] == 'coach'), before)

    def test_bulk_retry_preserves_images_finalizations_and_enrolment_capture(self):
        selected = self.bulk_months()
        service.sign_months(self.learner(), selected, self.user, 'learner', b'first', {})
        before, events = deepcopy(self.signs), deepcopy(self.events)
        result = service.sign_months(self.learner(), selected, self.user, 'learner', b'retry', {})
        self.assertEqual(result['signed_months'], [])
        self.assertEqual(result['completed_months'], [])
        self.assertEqual(result['skipped_months'], selected)
        self.assertEqual(self.signs, before)
        self.assertEqual(self.events, events)
        self.save_file.assert_called_once()
        self.mocks['save_learner_signature'].assert_called_once()

    def test_bulk_prior_learner_signatures_can_finish_without_new_files(self):
        for month in self.bulk_months():
            self.signed(month, roles=('learner',))
        before = deepcopy(self.signs)
        result = service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'unused', {})
        self.assertTrue(result['summary']['can_access_lms'])
        self.assertEqual(result['signed_months'], [])
        self.assertEqual(self.signs, before)
        self.save_file.assert_not_called()
        self.mocks['save_learner_signature'].assert_called_once_with(self.learner(), 'Test signer', b'unused')

    def test_bulk_uses_required_month_scope_even_when_materials_or_rows_are_missing(self):
        self.sources.clear()
        self.pending.append({'month': '2026-07', 'count': 2})
        self.mocks['content_review'].side_effect = AssertionError('Do not download materials')
        result = service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.assertTrue(result['summary']['can_access_lms'])
        self.assertEqual(result['summary']['months'][0]['pending_revisions'], 2)
        self.assertEqual(result['summary']['months'][0]['row_count'], 0)
        self.assertEqual(self.mocks['finalize'].call_args.kwargs['metadata']['snapshot_kind'], 'monthly_summary')

    def test_bulk_invalid_or_partial_scope_never_uploads(self):
        for months in [[], {}, ['2026-07'], ['2026-07', '2026-07'], ['2026-07', '2026-09'],
                       [{'month': '2026-07', 'snapshot_digest': 'a' * 64}]]:
            with self.subTest(months=months), self.assertRaises(service.ServiceError):
                service.sign_months(self.learner(), months, self.user, 'learner', b'png', {})
        self.save_file.assert_not_called()
        self.mocks['save_signature'].assert_not_called()

    def test_bulk_scope_change_after_upload_aborts_and_cleans_capture(self):
        read_transition = self.mocks['transition'].side_effect
        def changed(learner_id, lock=False):
            transition = read_transition(learner_id, lock=lock)
            if lock:
                transition['required_months'].append('2026-06')
            return transition
        self.mocks['transition'].side_effect = changed
        with self.assertRaises(service.ServiceError):
            service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.delete_file.assert_called_once_with('a' * 32)
        self.mocks['save_signature'].assert_not_called()

    def test_bulk_profile_failure_aborts_and_cleans_shared_capture(self):
        self.mocks['save_learner_signature'].side_effect = DatabaseError('write failed')
        with self.assertRaises(DatabaseError):
            service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.delete_file.assert_called_once_with('a' * 32)
        self.mocks['set_completed'].assert_not_called()

    def test_bulk_finalization_failure_aborts_and_cleans_shared_capture(self):
        self.mocks['finalize'].side_effect = DatabaseError('write failed')
        with self.assertRaises(DatabaseError):
            service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.delete_file.assert_called_once_with('a' * 32)
        self.mocks['set_completed'].assert_not_called()

    def test_bulk_upload_failure_never_changes_record(self):
        self.save_file.side_effect = service.ServiceError('Storage unavailable')
        with self.assertRaises(service.ServiceError):
            service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.mocks['save_signature'].assert_not_called()
        self.mocks['finalize'].assert_not_called()

    def test_bulk_monitor_cannot_sign_or_complete(self):
        with self.assertRaises(service.ServiceError):
            service.sign_months(self.learner(), self.bulk_months(), account('staff'), 'monitor', b'png', {})
        self.save_file.assert_not_called()

    def test_bulk_multipart_contract_keeps_identity_and_public_image_scope(self):
        request = RequestFactory().post('/audit_api/old-otjh/sign-months/', {
            'months': json.dumps(self.bulk_months()), 'confirmed': 'true', 'capture_method': 'upload',
            'signature': SimpleUploadedFile('signature.png', b'test-image', content_type='image/png')})
        request.login_account = self.user
        request._dont_enforce_csrf_checks = True
        with patch.object(storage, 'sanitize', return_value=b'clean-png'):
            response = views.bulk_signoff(request)
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.content)
        self.assertTrue(data['summary']['can_access_lms'])
        self.assertEqual(set(data['summary']['months'][0]['student_signature']), {'url', 'signed_at', 'signer_name'})
        self.assertIsNone(data['summary']['months'][0]['coach_signature'])

    def test_bulk_endpoint_refuses_identity_override_and_missing_csrf(self):
        request = self.request('post', '/audit_api/old-otjh/sign-months/?aptem_id=999')
        self.assertEqual(views.bulk_signoff(request).status_code, 404)
        request = self.request('post', '/audit_api/old-otjh/sign-months/')
        request._dont_enforce_csrf_checks = False
        self.assertEqual(views.bulk_signoff(request).status_code, 403)
        self.save_file.assert_not_called()

    def test_live_signoffs_do_not_rebuild_activity_report(self):
        learner = self.learner()
        self.assertIsNone(service.signoff_state(learner, '2026-07')['coach_signature'])
        self.signed(roles=('coach',))
        self.assertIsNotNone(service.signoff_state(learner, '2026-07')['coach_signature'])
        self.mocks['month_rows'].assert_not_called()
        self.mocks['report_profile'].assert_not_called()

    def test_bulk_concurrent_completion_preserves_saved_capture(self):
        read_transition = self.mocks['transition'].side_effect
        def concurrent(learner_id, lock=False):
            if lock:
                for month in self.bulk_months():
                    self.signed(month, roles=('learner',))
                    self.finalize(self.learner(), month, 'existing', 1, self.user)
            return read_transition(learner_id, lock=lock)
        self.mocks['transition'].side_effect = concurrent
        result = service.sign_months(self.learner(), self.bulk_months(), self.user, 'learner', b'png', {})
        self.assertEqual(result['signed_months'], [])
        self.assertEqual(result['completed_months'], [])
        self.assertTrue(result['summary']['can_access_lms'])
        self.delete_file.assert_called_once()
        self.mocks['save_learner_signature'].assert_not_called()


class EnrolmentSignatureTests(SimpleTestCase):
    def test_one_capture_can_serve_multiple_months_for_the_same_learner(self):
        rows = [{'learner_id': 7, 'signer_role': 'learner', 'report_month': month, 'file_id': 'a' * 32}
                for month in ['2026-07', '2026-08']]
        with patch.object(repo, 'query', return_value=rows):
            self.assertEqual(repo.signature_owner('a' * 32)['learner_id'], 7)

    def test_shared_capture_cannot_cross_learner_or_role_boundaries(self):
        first = {'learner_id': 7, 'signer_role': 'learner', 'report_month': '2026-07', 'file_id': 'a' * 32}
        for other in [{**first, 'learner_id': 8}, {**first, 'signer_role': 'coach'}]:
            with patch.object(repo, 'query', return_value=[first, other]):
                self.assertIsNone(repo.signature_owner('a' * 32))

    def test_saved_capture_uses_image_data_format_and_scoped_identity(self):
        import base64
        learner = {'id': 7, 'aptem_id': 42}
        with patch.object(repo, 'query', return_value=[{'id': 7}]) as query:
            repo.save_learner_signature(learner, 'Learner name', b'clean-png')
        sql, params = query.call_args.args
        self.assertIn('UPDATE enrolment."Created_users"', sql)
        self.assertIn('WHERE id=%s AND', sql)
        self.assertIn('"Learner_signature_saved_at"=now()', sql)
        self.assertTrue(params[0].startswith('data:image/png;base64,'))
        self.assertEqual(base64.b64decode(params[0].split(',', 1)[1]), b'clean-png')
        self.assertEqual(params[1:], ['Learner name', 7, '42'])

    def test_changed_enrolment_link_aborts_the_write(self):
        with patch.object(repo, 'query', return_value=[]), self.assertRaises(service.ServiceError) as raised:
            repo.save_learner_signature({'id': 7, 'aptem_id': 42}, 'Learner', b'clean-png')
        self.assertEqual(raised.exception.code, 'identity_review_required')


class SignatureValidationTests(SimpleTestCase):
    def image(self, format='PNG'):
        image = Image.new('RGB', (160, 70), 'white')
        ImageDraw.Draw(image).line([(5, 30), (90, 5), (150, 60)], fill='black', width=3)
        file = BytesIO(); image.save(file, format=format)
        return file.getvalue()

    def test_png_and_jpeg_are_reencoded_as_png(self):
        for fmt in ['PNG', 'JPEG']:
            clean = storage.sanitize(SimpleUploadedFile('signature.bin', self.image(fmt)))
            self.assertEqual(Image.open(BytesIO(clean)).format, 'PNG')

    def test_svg_corrupt_and_oversized_files_are_refused(self):
        for data in [b'<svg onload="alert(1)"></svg>', b'not-an-image', b'a' * (storage.MAX_BYTES + 1)]:
            with self.assertRaises(service.ServiceError): storage.sanitize(SimpleUploadedFile('signature.png', data, content_type='image/png'))

    def test_uniform_blank_image_is_refused(self):
        out = BytesIO(); Image.new('RGB', (100, 100), 'white').save(out, 'PNG')
        with self.assertRaises(service.ServiceError): storage.sanitize(SimpleUploadedFile('signature.png', out.getvalue()))

    def test_path_traversal_cannot_address_signature_storage(self):
        with self.assertRaises(service.ServiceError): storage._key('../other.png')
