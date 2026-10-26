import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from . import support_ticket_files as files
from . import support_tickets as tickets


class SupportTicketsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(pk=10, subject_id=101, subject_type='learner',
                                       role='learner', is_active=True, display_name='Example Learner')
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        for target, value in [('authenticate_request', self.account), ('_accesses_of', frozenset())]:
            stub = patch.object(tickets, target, return_value=value)
            self.addCleanup(stub.stop)
            setattr(self, target, stub.start())
        stub = patch.object(tickets, 'connections', {'enrolment': connection})
        stub.start(); self.addCleanup(stub.stop)
        stub = patch.object(tickets.assistant_conversations, 'record_ticket')
        stub.start(); self.addCleanup(stub.stop)
        stub = patch.object(tickets.transaction, 'atomic', return_value=MagicMock())
        stub.start(); self.addCleanup(stub.stop)

    def call(self, view, body=None, ticket_id=None, csrf=True):
        request = self.factory.get('/learner_api/support/tickets/') if body is None else self.factory.post(
            '/learner_api/support/tickets/', json.dumps(body), content_type='application/json')
        request._dont_enforce_csrf_checks = csrf
        return view(request, **({'ticket_id': ticket_id} if ticket_id else {}))

    def test_lists_only_the_authenticated_account_and_returns_csrf(self):
        self.cursor.fetchall.return_value = []
        response = self.call(tickets.learner_tickets)
        self.assertEqual(response.status_code, 200)
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('owner_account_id=%s', sql)
        self.assertEqual(params, [10, 0])
        self.assertIn('csrfToken', json.loads(response.content))
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_anonymous_employer_and_staff_cannot_create_learner_tickets(self):
        for role in ('employer', 'staff'):
            self.account.role = role
            self.assertEqual(self.call(tickets.learner_tickets, {}).status_code, 403)
        self.authenticate_request.return_value = None
        self.assertEqual(self.call(tickets.learner_tickets).status_code, 401)
        self.cursor.execute.assert_not_called()

    def test_queue_requires_support_grant_or_admin(self):
        self.account.role = 'staff'
        self.assertEqual(self.call(tickets.staff_tickets).status_code, 403)
        self._accesses_of.return_value = frozenset({'coach'})
        self.assertEqual(self.call(tickets.staff_tickets).status_code, 403)
        self._accesses_of.return_value = frozenset({'support'})
        self.cursor.fetchall.return_value = []
        self.assertEqual(self.call(tickets.staff_tickets).status_code, 200)
        self.account.role = 'admin'
        self._accesses_of.return_value = frozenset()
        self.assertEqual(self.call(tickets.staff_tickets).status_code, 200)

    def test_ownership_cannot_be_supplied_by_the_client(self):
        response = self.call(tickets.learner_tickets, {'owner_account_id': 99})
        self.assertEqual(response.status_code, 400)
        self.cursor.execute.assert_not_called()

    def test_csrf_is_required_for_writes(self):
        response = self.call(tickets.learner_tickets, {}, csrf=False)
        self.assertEqual(response.status_code, 403)
        self.cursor.execute.assert_not_called()

    def test_create_retries_return_the_same_ticket_and_do_not_insert_duplicates(self):
        key = str(uuid4())
        payload = dict(requestId=key, title='Cannot save', description='An error appears.', category='Technical Issue', priority='medium')
        saved = {k: v for k, v in payload.items() if k != 'requestId'} | {'id': key}
        self.cursor.fetchone.return_value = (saved,)
        for _ in range(2):
            response = self.call(tickets.learner_tickets, payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['ticket']['id'], key)
        inserts = [call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('INSERT')]
        self.assertEqual(len(inserts), 2)
        for sql, args in inserts:
            self.assertIn('ON CONFLICT(id) DO NOTHING', sql)
            self.assertEqual(args[:3], [key, 10, 101])
        response = self.call(tickets.learner_tickets, payload | {'title': 'Different content'})
        self.assertEqual(response.status_code, 409)

    def test_other_owner_ticket_is_not_readable_or_replyable(self):
        self.cursor.fetchone.return_value = None
        key = uuid4()
        for body in (None, {'action': 'reply', 'requestId': str(uuid4()), 'body': 'Hello'}):
            response = self.call(tickets.learner_ticket, body, key)
            self.assertEqual(response.status_code, 404)
            self.assertIn('owner_account_id=%s', self.cursor.execute.call_args.args[0])
            self.assertEqual(self.cursor.execute.call_args.args[1], [str(key), 10])

    def test_learner_cannot_change_status_and_staff_stale_updates_conflict(self):
        self.cursor.fetchone.return_value = ({'status': 'in-progress'},)
        body = {'action': 'status', 'status': 'closed', 'expectedStatus': 'open'}
        self.assertEqual(self.call(tickets.learner_ticket, body, uuid4()).status_code, 403)
        self.account.role = 'admin'
        self.assertEqual(self.call(tickets.staff_ticket, body, uuid4()).status_code, 409)

    def test_retrying_reply_does_not_append_it_twice(self):
        key = str(uuid4())
        self.cursor.fetchone.return_value = ({'replies': [{'id': key, 'accountId': 10, 'body': 'Hello'}]},)
        response = self.call(tickets.learner_ticket, {'action': 'reply', 'requestId': key, 'body': 'Hello'}, uuid4())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(json.loads(response.content)['ticket']['replies']), 1)
        self.assertFalse(any(call.args[0].startswith('UPDATE') for call in self.cursor.execute.call_args_list))

    def test_validation_rejects_empty_and_invalid_category_before_write(self):
        valid = dict(requestId=str(uuid4()), title='Example', description='Details', category='Technical Issue', priority='low')
        for change in ({'title': ''}, {'description': 'x' * 10001}, {'category': 'unknown'}, {'priority': 'unknown'}):
            self.assertEqual(self.call(tickets.learner_tickets, valid | change).status_code, 400)
        self.cursor.execute.assert_not_called()

    def upload(self, view, payload, uploads, ticket_id=None, csrf=True):
        request = self.factory.post('/learner_api/support/tickets/', {
            'payload': json.dumps(payload), 'attachments': uploads,
        })
        request._dont_enforce_csrf_checks = csrf
        return view(request, **({'ticket_id': ticket_id} if ticket_id else {}))

    def test_create_with_attachments_is_atomic_and_retry_does_not_reupload(self):
        key = str(uuid4())
        payload = dict(requestId=key, title='Issue', description='Details', category='Technical Issue', priority='low')
        saved = {}

        def execute(sql, params):
            if sql.startswith('INSERT'):
                self.cursor.rowcount = 0 if saved else 1
                if not saved:
                    saved.update(json.loads(params[-1]))
            self.cursor.fetchone.return_value = (saved,)

        self.cursor.execute.side_effect = execute
        with patch.object(files, 'save') as save:
            for _ in range(2):
                response = self.upload(tickets.learner_tickets, payload, [SimpleUploadedFile('report.pdf', b'%PDF-report')])
                self.assertEqual(response.status_code, 200)
                attachment = json.loads(response.content)['ticket']['attachments'][0]
                self.assertEqual(attachment['name'], 'report.pdf')
                self.assertEqual(set(attachment), {'id', 'name', 'size', 'contentType'})
            save.assert_called_once()
            response = self.upload(tickets.learner_tickets, payload, [SimpleUploadedFile('report.pdf', b'%PDF-other!')])
            self.assertEqual(response.status_code, 409)
            self.assertEqual(save.call_count, 1)

    def test_reply_attachments_are_preserved_and_retry_does_not_append(self):
        ticket_id, reply_id = uuid4(), str(uuid4())
        ticket = {'replies': [], 'attachments': [{'id': 'original', 'name': 'original.txt', 'size': 1, 'contentType': 'text/plain'}]}
        self.cursor.fetchone.return_value = (ticket,)
        payload = {'action': 'reply', 'requestId': reply_id, 'body': 'See log'}
        with patch.object(files, 'save') as save:
            for _ in range(2):
                response = self.upload(tickets.learner_ticket, payload, [SimpleUploadedFile('error.log', b'example error')], ticket_id)
                self.assertEqual(response.status_code, 200)
            save.assert_called_once()
            public = json.loads(response.content)['ticket']
            self.assertEqual(len(public['replies']), 1)
            self.assertEqual(public['attachments'][0]['id'], 'original')
            self.assertEqual(public['replies'][0]['attachments'][0]['name'], 'error.log')
            self.assertNotIn('accountId', public['replies'][0])
            response = self.upload(tickets.learner_ticket, payload, [SimpleUploadedFile('error.log', b'changed')], ticket_id)
            self.assertEqual(response.status_code, 409)

    def test_forbidden_uploads_never_reach_storage(self):
        payload = {'action': 'reply', 'requestId': str(uuid4()), 'body': 'See file'}
        with patch.object(files, 'save') as save:
            self.cursor.fetchone.return_value = None
            self.assertEqual(self.upload(tickets.learner_ticket, payload, [SimpleUploadedFile('a.txt', b'a')], uuid4()).status_code, 404)
            self.assertEqual(self.upload(tickets.learner_ticket, payload, [SimpleUploadedFile('a.txt', b'a')], uuid4(), csrf=False).status_code, 403)
            for role in ('admin', 'staff', 'employer'):
                self.account.role = role
                self.assertEqual(self.upload(tickets.learner_ticket, payload, [SimpleUploadedFile('a.txt', b'a')], uuid4()).status_code, 403)
            self.account.role = 'admin'
            self.assertEqual(self.upload(tickets.staff_ticket, payload, [SimpleUploadedFile('a.txt', b'a')], uuid4()).status_code, 403)
            save.assert_not_called()

    def test_attachment_cannot_be_added_through_feedback(self):
        self.cursor.fetchone.return_value = ({'status': 'resolved'},)
        with patch.object(files, 'save') as save:
            response = self.upload(tickets.learner_ticket, {'action': 'feedback', 'rating': 5}, [SimpleUploadedFile('a.txt', b'a')], uuid4())
            self.assertEqual(response.status_code, 400)
            save.assert_not_called()

    def test_attachment_download_enforces_ticket_ownership_and_staff_grant(self):
        ticket_id, attachment_id = uuid4(), uuid4()
        item = {'id': str(attachment_id), 'name': 'error.log', 'size': 5, 'contentType': 'text/plain',
                'container': 'approved', 'blobName': 'private/key'}
        self.cursor.fetchone.return_value = ({'replies': [{'attachments': [item]}]},)
        request = self.factory.get('/attachment/')
        with patch.object(files.storage, 'download_blob_bytes', return_value=b'error') as download:
            response = tickets.learner_attachment(request, ticket_id=ticket_id, attachment_id=attachment_id)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content, b'error')
            self.assertIn('attachment;', response['Content-Disposition'])
            self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertEqual(self.cursor.execute.call_args.args[1], [str(ticket_id), self.account.pk])
            for role, grant, status in [('staff', set(), 403), ('staff', {'coach'}, 403), ('staff', {'support'}, 200), ('admin', set(), 200), ('employer', set(), 403)]:
                self.account.role = role
                self._accesses_of.return_value = grant
                self.assertEqual(tickets.staff_attachment(request, ticket_id=ticket_id, attachment_id=attachment_id).status_code, status)
            self.assertEqual(download.call_count, 3)
            download.reset_mock()
            self.account.role = 'learner'
            self.assertEqual(tickets.learner_attachment(request, ticket_id=ticket_id, attachment_id=uuid4()).status_code, 404)
            self.cursor.fetchone.return_value = None
            self.assertEqual(tickets.learner_attachment(request, ticket_id=ticket_id, attachment_id=attachment_id).status_code, 404)
            self.authenticate_request.return_value = None
            self.assertEqual(tickets.learner_attachment(request, ticket_id=ticket_id, attachment_id=attachment_id).status_code, 401)
            download.assert_not_called()

    def test_database_failure_cleans_only_attempt_blobs_and_returns_error(self):
        self.cursor.fetchone.return_value = ({'replies': []},)
        def save(prepared, staged):
            staged.append(('approved', prepared[0][0]['blobName']))
        def execute(sql, params):
            if sql.startswith('UPDATE'):
                raise DatabaseError('write failed')
        self.cursor.execute.side_effect = execute
        with patch.object(files, 'save', side_effect=save), patch.object(files.storage, 'delete_blob') as delete:
            response = self.upload(tickets.learner_ticket, {'action': 'reply', 'requestId': str(uuid4()), 'body': 'See file'},
                                   [SimpleUploadedFile('error.log', b'error')], uuid4())
            self.assertEqual(response.status_code, 503)
            delete.assert_called_once()


class SupportTicketFileTests(SimpleTestCase):
    def test_limits_and_unsupported_types_are_rejected(self):
        cases = [
            [SimpleUploadedFile('bad.exe', b'MZ')],
            [SimpleUploadedFile('empty.txt', b'')],
            [SimpleUploadedFile('x.txt', b'x')] * 6,
            [SimpleUploadedFile('big.txt', b'x' * (files.MAX_FILE_BYTES + 1))],
            [SimpleUploadedFile('x.txt', b'x' * files.MAX_FILE_BYTES) for _ in range(3)],
        ]
        for uploads in cases:
            with self.subTest(names=[upload.name for upload in uploads]), self.assertRaises(files.AttachmentError):
                files.prepare(uploads, str(uuid4()))

    def test_supported_extensions_do_not_require_browser_mime_mapping(self):
        for suffix in files.TYPES:
            prepared = files.prepare([SimpleUploadedFile('example' + suffix.upper(), b'content', content_type='application/octet-stream')], str(uuid4()))
            self.assertEqual(prepared[0][0]['contentType'], files.TYPES[suffix])
            self.assertEqual(prepared[0][0]['size'], 7)

    def test_missing_storage_is_visible_without_saving(self):
        prepared = files.prepare([SimpleUploadedFile('example.txt', b'content')], str(uuid4()))
        with patch.object(files.storage, 'azure_configured', return_value=False), self.assertRaises(files.AttachmentError) as error:
            files.save(prepared, [])
        self.assertEqual(error.exception.status, 503)

    def test_upload_failure_cleans_partial_batch(self):
        prepared = files.prepare([SimpleUploadedFile('one.txt', b'one'), SimpleUploadedFile('two.txt', b'two')], str(uuid4()))
        with patch.object(files.storage, 'azure_configured', return_value=True), \
             patch.object(files.storage, 'upload_to_quarantine', side_effect=[None, RuntimeError('storage unavailable')]), \
             patch.object(files.storage, 'move_blob') as move, \
             patch.object(files.storage, 'delete_blob') as delete, \
             patch('learner_api.evidence._scan', return_value='clean'), self.assertRaises(files.AttachmentError):
            try:
                with files.upload_session() as staged:
                    files.save(prepared, staged)
            finally:
                self.assertEqual(move.call_count, 1)
                self.assertEqual(delete.call_count, 3)

    def test_rejected_file_is_not_promoted(self):
        prepared = files.prepare([SimpleUploadedFile('one.txt', b'one')], str(uuid4()))
        with patch.object(files.storage, 'azure_configured', return_value=True), \
             patch.object(files.storage, 'upload_to_quarantine'), patch.object(files.storage, 'move_blob') as move, \
             patch.object(files.storage, 'delete_blob') as delete, \
             patch('learner_api.evidence._scan', return_value='infected'), self.assertRaises(files.AttachmentError):
            try:
                with files.upload_session() as staged:
                    files.save(prepared, staged)
            finally:
                move.assert_not_called()
                delete.assert_called_once()
