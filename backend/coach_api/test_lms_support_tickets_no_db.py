"""Exercise the real coach/CSRF guards with session, ORM and storage doubles."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.db import DatabaseError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from coach_api import auth, lms_support_tickets as tickets
from login import permissions


class CoachLmsTicketsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(pk=7, subject_id=8, subject_type='staff', role='staff', display_name='Example Coach')
        self.staff = SimpleNamespace(id=8, email=' Coach@Example.invalid ', access='coach', access_extra=[], username='Coach')
        self.learners = [SimpleNamespace(id=12, enrolment_id=101, full_name='Commercial Example', kind='commercial'),
                         SimpleNamespace(id=13, enrolment_id=102, full_name='Apprentice Example', kind='apprenticeship'),
                         SimpleNamespace(id=101, enrolment_id=None, full_name='Unlinked')]
        self.cursor = MagicMock()
        self.cursor.fetchall.return_value = []
        self.cursor.fetchone.return_value = None
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.stub(tickets, 'connections', {'enrolment': connection})
        self.stub(tickets.transaction, 'atomic', return_value=MagicMock())
        self.caseload = self.stub(tickets, 'caseload_learners', side_effect=lambda _: self.learners)
        self.authenticate = self.stub(permissions, 'authenticate_request', side_effect=self.session)
        self.stub(auth.StaffUser.objects, 'filter', return_value=MagicMock()).return_value.only.return_value.first.side_effect = lambda: self.staff
        self.stub(auth, '_invalidate_dashboard_after_mutation', side_effect=lambda view, request, response, email: response)
        self.download = self.stub(tickets.files, 'download', return_value=HttpResponse(b'example'))
        self.key, self.file_key = uuid4(), uuid4()
        self.file = dict(id=str(self.file_key), name='issue.log', size=7, contentType='text/plain', container='private', blobName='secret-key')
        self.saved = dict(id=str(self.key), title='Cannot open lesson', description='Details', status='in-progress',
                          assignedTo='Support Agent', assignedTeam='Support', attachments=[self.file], replies=[], messages=0, timeline=[])

    def stub(self, obj, name, *args, **kwargs):
        patcher = patch.object(obj, name, *args, **kwargs)
        value = patcher.start()
        self.addCleanup(patcher.stop)
        return value

    def session(self, request):
        request.login_account = self.account
        return self.account

    def call(self, view=tickets.collection, *, body=None, method=None, query='', csrf=True):
        method = method or ('post' if body is not None else 'get')
        path = '/coach_api/coach/lms-support-tickets' + query
        request = self.factory.get(path) if method == 'get' else getattr(self.factory, method)(path, json.dumps(body or {}), content_type='application/json')
        request._dont_enforce_csrf_checks = csrf
        args = {} if view == tickets.collection else {'ticket_id': self.key}
        if view == tickets.attachment:
            args['attachment_id'] = self.file_key
        return view(request, **args)

    def reply_body(self, **extra):
        return {'requestId': str(uuid4()), 'body': 'I can help with this.', **extra}

    def updates(self):
        return [call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('UPDATE')]

    def test_list_uses_authenticated_coach_and_enrolment_bridge_for_both_learner_kinds(self):
        self.cursor.fetchall.return_value = [(self.saved, 101), ({**self.saved, 'id': str(uuid4())}, 102)]
        response = self.call(query='?learnerId=999&offset=100')
        self.assertEqual(response.status_code, 200)
        self.caseload.assert_called_once_with('coach@example.invalid')
        sql, params = self.cursor.execute.call_args.args
        self.assertIn('enrolment_id=ANY(%s)', sql)
        self.assertEqual(params, [[101, 102], 100])
        payload = json.loads(response.content)
        self.assertEqual([row['learnerId'] for row in payload['tickets']], [12, 13])
        self.assertNotIn('secret-key', response.content.decode())
        self.assertFalse(payload['readOnly'])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_pagination_and_empty_caseload(self):
        self.cursor.fetchall.return_value = [(self.saved, 101)] * 101
        payload = json.loads(self.call().content)
        self.assertEqual((len(payload['tickets']), payload['nextOffset']), (100, 100))
        self.learners = []
        self.cursor.execute.reset_mock()
        self.assertEqual(json.loads(self.call().content)['tickets'], [])
        self.cursor.execute.assert_not_called()

    def test_roles_and_anonymous_are_refused_before_ticket_queries(self):
        for role in ('learner', 'employer'):
            self.account.role = role
            self.assertEqual(self.call().status_code, 403)
        self.account.role = 'staff'
        self.staff.access = 'support'
        self.assertEqual(self.call().status_code, 403)
        self.authenticate.side_effect = None
        self.authenticate.return_value = None
        self.assertEqual(self.call().status_code, 401)
        self.cursor.execute.assert_not_called()

    def test_secondary_coach_grant_can_read(self):
        self.staff.access = 'tutor'
        self.staff.access_extra = 'coach'
        self.assertEqual(self.call().status_code, 200)

    def test_coach_identity_cannot_be_replaced_by_client(self):
        for query in ('?viewAsCoach=other@example.invalid', '?ownerEmail=other@example.invalid'):
            self.assertEqual(self.call(query=query).status_code, 403)
        self.assertEqual(self.call(tickets.detail, body=self.reply_body(learnerId=999)).status_code, 400)
        self.cursor.execute.assert_not_called()

    def test_admin_view_as_is_read_only(self):
        self.staff.access = 'super-admin'
        self.account.role = 'admin'
        selected = SimpleNamespace(id=55, email='selected@example.invalid')
        self.stub(auth, '_find_coach_staff', return_value=selected)
        self.assertEqual(self.call().status_code, 403)
        response = self.call(query='?viewAsCoach=selected@example.invalid')
        self.assertTrue(json.loads(response.content)['readOnly'])
        self.caseload.assert_called_with('selected@example.invalid')
        self.assertEqual(self.call(tickets.detail, body=self.reply_body(), query='?viewAsCoach=selected@example.invalid').status_code, 403)
        self.assertEqual(self.updates(), [])

    def test_off_caseload_read_reply_and_download_are_not_found(self):
        self.cursor.fetchone.return_value = (self.saved, 999)
        for view, body in ((tickets.detail, None), (tickets.detail, self.reply_body()), (tickets.attachment, None)):
            self.assertEqual(self.call(view, body=body).status_code, 404)
            sql, params = self.cursor.execute.call_args.args
            self.assertIn('enrolment_id=ANY(%s)', sql)
            self.assertEqual(params, [str(self.key), [101, 102]])
        self.download.assert_not_called()
        self.assertEqual(self.updates(), [])

    def test_access_is_revoked_when_learner_moves_to_another_coach(self):
        self.cursor.fetchone.return_value = (self.saved, 101)
        self.assertEqual(self.call(tickets.detail).status_code, 200)
        self.learners = self.learners[1:]
        self.assertEqual(self.call(tickets.attachment).status_code, 404)
        self.assertEqual(self.call(tickets.detail, body=self.reply_body()).status_code, 404)
        self.download.assert_not_called()

    def test_reply_is_attributed_and_preserves_support_actions_and_files(self):
        self.cursor.fetchone.return_value = (self.saved, 101)
        body = self.reply_body()
        response = self.call(tickets.detail, body=body)
        self.assertEqual(response.status_code, 200)
        sql, params = self.updates()[0]
        saved = json.loads(params[0])
        self.assertEqual(params[1:], [str(self.key), 101])
        for field in ('status', 'assignedTo', 'assignedTeam', 'attachments', 'timeline'):
            self.assertEqual(saved[field], self.saved[field])
        self.assertEqual(saved['replies'][0]['accountId'], 7)
        self.assertEqual(saved['replies'][0]['senderRole'], 'Coach')
        self.assertNotIn('accountId', response.content.decode())
        self.assertIn('FOR UPDATE', self.cursor.execute.call_args_list[0].args[0])
        self.assertEqual(self.call(tickets.detail, body=body).status_code, 200)
        self.assertEqual(len(self.updates()), 1)
        self.assertEqual(self.call(tickets.detail, body={**body, 'body': 'Changed'}).status_code, 409)

    def test_coach_cannot_change_state_assignment_or_upload(self):
        for extra in ({'status': 'closed'}, {'assignedTo': 'Coach'}, {'action': 'assign'}, {'attachments': [self.file]}):
            self.assertEqual(self.call(tickets.detail, body=self.reply_body(**extra)).status_code, 400)
        self.assertEqual(self.call(tickets.detail, method='patch', body=self.reply_body()).status_code, 405)
        self.assertEqual(self.updates(), [])

    def test_csrf_is_enforced(self):
        self.assertEqual(self.call(tickets.detail, body=self.reply_body(), csrf=False).status_code, 403)
        self.cursor.execute.assert_not_called()

    def test_downloads_ticket_and_reply_attachments_only_after_scope_check(self):
        self.cursor.fetchone.return_value = (self.saved, 101)
        self.assertEqual(self.call(tickets.attachment).content, b'example')
        self.download.assert_called_with(self.file)
        self.saved['attachments'] = []
        self.saved['replies'] = [{'id': 'reply', 'attachments': [self.file]}]
        self.assertEqual(self.call(tickets.attachment).status_code, 200)
        self.saved['replies'] = []
        self.assertEqual(self.call(tickets.attachment).status_code, 404)

    def test_database_failure_is_an_error_not_an_empty_queue(self):
        self.cursor.execute.side_effect = DatabaseError('unavailable')
        response = self.call()
        self.assertEqual(response.status_code, 503)
        self.assertIn('unavailable', json.loads(response.content)['error'])
