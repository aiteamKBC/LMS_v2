"""Ticket closure regression tests: no live database or external effects."""
from contextlib import nullcontext
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from learner_api import assistant_conversations as portal, support_tickets as local
from . import quality_tickets


class FeedbackTicketIdentityTests(SimpleTestCase):
    def test_closure_uses_only_the_response_identity_and_learner_from_storage(self):
        with patch.object(local, 'close_feedback_ticket', return_value='closed') as close:
            response = SimpleNamespace(pk=41, enrolment_id='17')
            self.assertEqual(quality_tickets.close_response_ticket(response, actor_name='Staff'), 'closed')
            close.assert_called_once_with(ticket_id=str(quality_tickets.quality_ticket_id(41)), enrolment_id=17, actor_name='Staff')
            self.assertNotEqual(quality_tickets.quality_ticket_id(41), quality_tickets.quality_ticket_id(42))
            response.enrolment_id = 'guest:4'
            self.assertEqual(quality_tickets.close_response_ticket(response, actor_name='Staff'), 'not_required')
            close.assert_called_once()


class LocalTicketCloseTests(SimpleTestCase):
    def setUp(self):
        self.cursor = MagicMock()
        self.db = MagicMock()
        self.db.cursor.return_value.__enter__.return_value = self.cursor
        self.saved = {'id': 'ticket-1', 'assignedTeam': 'Quality Team', 'status': 'open',
                      'timeline': [{'event': 'Opened'}], 'replies': [{'body': 'Preserve'}], 'priority': 'high'}
        self.cursor.fetchone.side_effect = lambda: (json.dumps(self.saved), 27)
        for item in [patch.object(local, 'connections', {'enrolment': self.db}),
                     patch.object(local.transaction, 'atomic', return_value=nullcontext()),
                     patch.object(local, 'canonical_learner_id', return_value=27)]:
            item.start(); self.addCleanup(item.stop)
        self.remote = self.enterContext(patch.object(portal, 'close_open_quality_ticket', return_value='Closed'))

    def close(self):
        return local.close_feedback_ticket(ticket_id='ticket-1', enrolment_id=17, actor_name='Staff')

    def updates(self):
        return [call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('UPDATE')]

    def test_closes_only_target_row_after_remote_confirmation_preserving_other_fields(self):
        self.assertEqual(self.close(), 'closed')
        self.remote.assert_called_once_with(ticket_id='ticket-1')
        sql, params = self.updates()[0]
        self.assertIn('WHERE id=%s', sql)
        self.assertEqual(params[1], 'ticket-1')
        updated = json.loads(params[0])
        self.assertEqual(updated['status'], 'closed')
        self.assertEqual(updated['timeline'][-1]['event'], 'Closed')
        self.assertEqual(updated['replies'], self.saved['replies'])
        self.assertEqual(updated['priority'], 'high')
        self.saved = updated
        self.assertEqual(self.close(), 'closed')
        self.assertEqual(len(self.updates()), 1)  # No duplicate closure history.

    def test_missing_ticket_does_not_create_one(self):
        self.cursor.fetchone.side_effect = None
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.close(), 'not_required')
        self.remote.assert_not_called()
        self.assertFalse(self.updates())

    def test_other_learner_or_team_is_rejected_without_changing_remote(self):
        for row in [(self.saved, 99), ({**self.saved, 'assignedTeam': 'LMS Support'}, 27)]:
            self.cursor.fetchone.side_effect = None
            self.cursor.fetchone.return_value = row
            with self.assertRaises(local.TicketError):
                self.close()
        self.remote.assert_not_called()

    def test_non_open_states_are_preserved(self):
        for status in ('resolved', 'in-progress'):
            self.saved['status'] = status
            self.assertEqual(self.close(), 'not_required')
        self.remote.assert_not_called()
        self.saved['status'] = 'open'
        self.remote.return_value = 'Pending'
        self.assertEqual(self.close(), 'not_required')
        self.assertFalse(self.updates())

    def test_remote_failure_does_not_report_local_closure(self):
        self.remote.side_effect = portal.AssistantConversationSyncError('offline')
        with self.assertRaises(portal.AssistantConversationSyncError):
            self.close()
        self.assertFalse(self.updates())

    def test_local_write_failure_can_retry_after_remote_already_closed(self):
        def execute(sql, params):
            if sql.startswith('UPDATE'):
                raise DatabaseError('offline')
        self.cursor.execute.side_effect = execute
        with self.assertRaises(DatabaseError):
            self.close()
        self.cursor.execute.side_effect = None
        self.assertEqual(self.close(), 'closed')


class PortalTicketCloseTests(SimpleTestCase):
    def setUp(self):
        self.cursor = MagicMock()
        db = MagicMock()
        db.cursor.return_value.__enter__.return_value = self.cursor
        connections = MagicMock(databases={'assistant_conversations': {}})
        connections.__getitem__.return_value = db
        self.enterContext(patch.object(portal, 'connections', connections))
        self.enterContext(patch.object(portal.transaction, 'atomic', return_value=nullcontext()))

    def close(self):
        return portal.close_open_quality_ticket(ticket_id='ticket-1')

    def updates(self):
        return [call.args for call in self.cursor.execute.call_args_list if call.args[0].startswith('UPDATE')]

    def test_updates_only_existing_open_quality_ticket_and_sets_closed_time(self):
        self.cursor.fetchall.return_value = [(9, 'Open', 'Quality Team')]
        self.assertEqual(self.close(), 'Closed')
        sql, params = self.updates()[0]
        self.assertIn("status='Closed', closed_at=NOW()", sql)
        self.assertIn("WHERE id=%s AND status='Open'", sql)
        self.assertEqual(params, [9])
        lookup = self.cursor.execute.call_args_list[1].args
        self.assertIn("metadata->>'lms_ticket_id'=%s FOR UPDATE", lookup[0])
        self.assertEqual(lookup[1], ['ticket-1'])

    def test_closed_and_pending_are_never_overwritten(self):
        for status in ('Closed', 'Pending'):
            self.cursor.fetchall.return_value = [(9, status, 'Quality Team')]
            self.assertEqual(self.close(), status)
        self.assertFalse(self.updates())

    def test_missing_duplicate_and_wrong_team_records_fail_without_writes(self):
        for rows in ([], [(9, 'Open', 'LMS Support')], [(9, 'Open', 'Quality Team'), (10, 'Open', 'Quality Team')]):
            self.cursor.fetchall.return_value = rows
            with self.assertRaises(portal.AssistantConversationSyncError):
                self.close()
        self.assertFalse(self.updates())
