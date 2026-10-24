from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import assistant_conversations as sink


class _Connections:
    def __init__(self, connection, configured=True):
        self.databases = {'assistant_conversations': connection} if configured else {}
        self.connection = connection

    def __getitem__(self, alias):
        if alias != 'assistant_conversations':
            raise KeyError(alias)
        return self.connection


class AssistantConversationSinkTests(SimpleTestCase):
    def setUp(self):
        self.cursor = MagicMock()
        self.connection = MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        self.account = SimpleNamespace(
            email='Learner@Example.test', subject_id=42, display_name='Example Learner',
        )
        self.ticket = {
            'id': 'ticket-1',
            'title': 'Cannot open module',
            'description': 'The module page is blank.',
            'category': 'Learning Support',
            'priority': 'high',
        }
        self.connections = _Connections(self.connection)
        self.connections_patch = patch.object(sink, 'connections', self.connections)
        self.connections_patch.start()
        self.addCleanup(self.connections_patch.stop)
        self.atomic_patch = patch.object(sink.transaction, 'atomic', return_value=MagicMock())
        self.atomic_patch.start()
        self.addCleanup(self.atomic_patch.stop)

    def test_inserts_a_learner_support_record_with_ticket_identity(self):
        self.cursor.fetchone.return_value = None
        portal = patch.object(sink, '_create_portal_ticket', return_value='KBC-000900')
        portal.start(); self.addCleanup(portal.stop)

        sink.record_ticket(account=self.account, ticket=self.ticket)

        inserts = [call.args for call in self.cursor.execute.call_args_list if 'INSERT INTO' in call.args[0]]
        self.assertEqual(len(inserts), 1)
        sql, params = inserts[0]
        self.assertIn('public.assistant_conversations', sql)
        self.assertEqual(params[:4], ['ticket-1', 'learner@example.test', 'learner', 'support'])
        self.assertIn('Support ticket: Cannot open module', params[4])
        self.assertEqual(params[5:], ['Your support ticket has been submitted to LMS Support.', True, 'KBC-000900'])

    def test_creates_portal_ticket_and_conversation_mapping(self):
        self.cursor.fetchone.side_effect = [None, (77,), (900,), (501,)]

        public_id = sink._create_portal_ticket(
            self.cursor, account=self.account, ticket=self.ticket, ticket_id='ticket-1',
        )

        self.assertEqual(public_id, 'KBC-000900')
        statements = [call.args[0] for call in self.cursor.execute.call_args_list]
        self.assertIn('public.tickets', '\n'.join(statements))
        self.assertIn('public.conversations', '\n'.join(statements))
        learner_insert = next(call.args for call in self.cursor.execute.call_args_list
                              if 'public.learners' in call.args[0])
        self.assertEqual(learner_insert[1][:4], ['42', 'Example Learner', 'learner@example.test', 'lms_learners'])
        ticket_insert = next(call.args for call in self.cursor.execute.call_args_list
                             if 'public.tickets' in call.args[0] and 'INSERT INTO' in call.args[0])
        self.assertEqual(ticket_insert[1][0:4], [900, 'KBC-000900', 77, 'Learning'])
        self.assertEqual(ticket_insert[1][5], 'High')

    def test_existing_ticket_copy_is_not_inserted_again(self):
        portal = patch.object(sink, '_create_portal_ticket', return_value='KBC-000900')
        portal.start(); self.addCleanup(portal.stop)
        self.cursor.fetchone.return_value = (1,)

        sink.record_ticket(account=self.account, ticket=self.ticket)

        self.assertFalse(any('INSERT INTO' in call.args[0] for call in self.cursor.execute.call_args_list))

    def test_missing_connection_is_visible_to_the_caller(self):
        missing = _Connections(self.connection, configured=False)
        with patch.object(sink, 'connections', missing):
            with self.assertRaises(sink.AssistantConversationSyncError):
                sink.record_ticket(account=self.account, ticket=self.ticket)
