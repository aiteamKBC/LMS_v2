import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase
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
