"""Aptem withdrawal is visible without changing the invitation lifecycle."""
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from . import aptem_status
from .learner_progression import access_gate, advance_learner
from .mappers import to_list_row
from .tests_directory import directory_learner


class AptemWithdrawalTests(SimpleTestCase):
    def test_directory_uses_current_aptem_withdrawal_without_fetching_documents(self):
        source = directory_learner()
        source._aptem_programme_status = ' withdrawn '
        with patch.object(source, 'refresh_from_db', side_effect=AssertionError('Deferred read')):
            self.assertEqual(to_list_row(source)['programmeStatus'], 'Withdrawn')
        self.assertEqual(source.programme_status, 'Delivery')

    def test_aptem_active_does_not_release_an_uninvited_learner(self):
        for external in ['Active', 'OnBreak', 'EnteredEpa', None, '']:
            source = SimpleNamespace(programme_status='Delivery', _aptem_programme_status=external)
            self.assertEqual(aptem_status.programme_status(source), 'Delivery')

    def test_local_withdrawal_is_preserved(self):
        source = SimpleNamespace(programme_status='Withdrawn', _aptem_programme_status='Active')
        self.assertEqual(aptem_status.programme_status(source), 'Withdrawn')

    def test_external_status_is_read_by_exact_aptem_id_once_per_record(self):
        source = SimpleNamespace(aptem_id=' 4176 ', programme_status='Active', save=Mock())
        cursor = MagicMock()
        cursor.fetchone.return_value = ('Withdrawn',)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(aptem_status, 'connections', {'enrolment': connection}):
            self.assertEqual(aptem_status.programme_status(source), 'Withdrawn')
            self.assertEqual(aptem_status.programme_status(source), 'Withdrawn')
        cursor.execute.assert_called_once_with(
            'SELECT "Program-Status" FROM "LMS"."Aptem_users" WHERE "ID"=%s', [4176])
        source.save.assert_not_called()
        self.assertEqual(source.programme_status, 'Active')

    def test_missing_or_invalid_aptem_id_never_matches_by_name(self):
        with patch.object(aptem_status, 'connections') as connections:
            for ident in [None, '', 'not-an-id', '-1', '0', '9' * 30]:
                source = SimpleNamespace(aptem_id=ident, programme_status='Delivery')
                self.assertEqual(aptem_status.programme_status(source), 'Delivery')
        connections.__getitem__.assert_not_called()

    def test_withdrawn_learner_cannot_advance_even_with_a_plan_date_and_invitation(self):
        for kind in ['commercial', 'apprenticeship']:
            source = SimpleNamespace(programme_status='Delivery', learner_type=kind,
                                     _aptem_programme_status='Withdrawn', save=Mock())
            with patch('learner_api.learner_progression._has_platform_invitation', return_value=True), \
                 patch('learner_api.learner_progression._has_assigned_learning_plan', return_value=True), \
                 patch('learner_api.learner_progression.compliance_documents_complete', return_value=True), \
                 patch('learner_api.active_users.sync_active_user') as sync:
                self.assertIsNone(advance_learner(source))
                self.assertFalse(access_gate(source)['blocked'])
                self.assertEqual(access_gate(source)['reasons'], [])
                sync.assert_not_called()
                source.save.assert_not_called()

    def test_learner_summary_displays_withdrawn_and_is_not_waiting_for_start(self):
        import json
        from datetime import date
        from django.test import RequestFactory
        from .learner_detail import learner_summary
        from .models import EnrolmentUser
        from .tests_invitation_readiness import learner

        source = learner(programme_status='Active', _aptem_programme_status='Withdrawn',
                         start_date=date(2025, 1, 1), end_date=date(2027, 1, 1))
        with patch.object(EnrolmentUser.all_learners, 'only') as query:
            query.return_value.get.return_value = source
            response = learner_summary.__wrapped__(RequestFactory().get('/'), 'commercial', 132)
        payload = json.loads(response.content)
        self.assertEqual(payload['programmeStatus'], 'Withdrawn')
        self.assertFalse(payload['isActive'])
        self.assertFalse(payload['accessGate']['blocked'])
        source.save.assert_not_called()
