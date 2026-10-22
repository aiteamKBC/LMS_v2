"""No-DB contract tests; real transaction/lock evidence lives in the PG suite."""
from contextlib import contextmanager, nullcontext
from copy import copy
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import learner_progression as progression
from .services.activation import ActivationFailed, locked_source, require_active_profile


def source(**values):
    return SimpleNamespace(**dict(dict(pk=11, id=11, uuid=uuid4(), programme_status='Ready to enrol',
        learner_type='apprenticeship', aptem_id=None, save=Mock()), **values))


class ActivationRecoveryTests(SimpleTestCase):
    def test_sweep_reports_activation_failure_instead_of_success_count(self):
        from io import StringIO
        from django.core.management.base import CommandError
        from .management.commands.advance_learner_statuses import Command
        path = 'learner_api.management.commands.advance_learner_statuses.'
        candidate = source(username='Synthetic')
        output = StringIO()
        with patch(path+'EnrolmentUser') as model, \
                patch(path+'advance_learner', side_effect=ActivationFailed('refused')) as advance:
            model.all_learners.filter.return_value.order_by.return_value.iterator.return_value = [candidate]
            with self.assertRaises(CommandError):
                Command(stdout=output).handle(check=False)
            advance.assert_called_once_with(candidate, strict=True)
        self.assertNotIn('advanced.', output.getvalue())

    def setUp(self):
        self.enterContext(patch.object(progression, '_programme_start_date', return_value=date(2026, 1, 1)))
        self.enterContext(patch.object(progression.timezone, 'localdate', return_value=date(2026, 10, 22)))

    def test_failed_activation_preserves_callers_status_and_is_observable(self):
        caller = source()
        fresh = copy(caller)
        with patch.object(progression, 'locked_source', return_value=nullcontext(fresh)), \
                patch('learner_api.active_users.sync_active_user', return_value=None), \
                self.assertLogs(progression.logger, 'WARNING') as messages:
            self.assertIsNone(progression.advance_learner(caller))
        self.assertEqual(caller.programme_status, 'Ready to enrol')
        self.assertIn('ActivationFailed', str(messages.output))

    def test_explicit_writer_gets_failure_not_success(self):
        caller = source()
        with patch.object(progression, 'locked_source', return_value=nullcontext(copy(caller))), \
                patch('learner_api.active_users.sync_active_user', return_value=None):
            with self.assertRaises(ActivationFailed):
                progression.advance_learner(caller, strict=True)
        self.assertEqual(caller.programme_status, 'Ready to enrol')

    def test_captured_ready_object_cannot_activate_current_withdrawn_source(self):
        caller = source()
        with patch.object(progression, 'locked_source', return_value=nullcontext(source(programme_status='Withdrawn'))), \
                patch('learner_api.active_users.sync_active_user') as sync:
            self.assertIsNone(progression.advance_learner(caller))
        sync.assert_not_called()
        self.assertEqual(caller.programme_status, 'Withdrawn')

    def test_future_normal_retry_uses_fresh_source_no_automatic_replay(self):
        caller = source()
        @contextmanager
        def fresh(_):
            yield copy(caller)
        with patch.object(progression, 'locked_source', side_effect=fresh), \
                patch('learner_api.active_users.sync_active_user', side_effect=[None, object()]) as sync:
            self.assertIsNone(progression.advance_learner(caller))
            self.assertEqual(sync.call_count, 1)
            self.assertEqual(progression.advance_learner(caller), 'Active')
            self.assertEqual(sync.call_count, 2)

    def test_identity_mismatch_refuses_before_mutation(self):
        caller = source()
        with patch('learner_api.services.activation.transaction.atomic', return_value=nullcontext()), \
                patch('learner_api.models.EnrolmentUser') as model:
            model.all_learners.using.return_value.select_for_update.return_value.filter.return_value.first.return_value = source()
            with self.assertRaises(ActivationFailed):
                with locked_source(caller):
                    self.fail('Identity mismatch must not enter the write block')
            model.all_learners.using.return_value.select_for_update.assert_called_once_with(nowait=True)
        caller.save.assert_not_called()

    def test_non_active_source_cannot_use_activation_success_wrapper(self):
        with patch('learner_api.active_users.sync_active_user') as sync:
            with self.assertRaises(ActivationFailed):
                require_active_profile(source())
        sync.assert_not_called()


class OwnershipAmbiguityTests(SimpleTestCase):
    def test_ambiguous_learner_projection_preserves_staff_authority_and_blocks_creation(self):
        from login.identity import account_payload
        from login.learner_enrolment import AmbiguousLearnerRecord, can_add_learner_record
        account = SimpleNamespace(id=7, subject_type='staff', subject_id=17, role='staff',
            email='synthetic@example.test', display_name='Synthetic', has_password=True, last_login_at=None)
        subject = SimpleNamespace(position='Tutor', access='coach', access_extra='enrolment')
        with patch('login.learner_enrolment.existing_learner_record', side_effect=AmbiguousLearnerRecord('review')):
            result = account_payload(account, subject=subject)
            self.assertNotIn('learnerRecordId', result)
            self.assertEqual(result['role'], 'staff')
            self.assertEqual(result['subjectId'], 17)
            self.assertEqual(set(result['accesses']), {'coach', 'enrolment'})
            self.assertNotIn('learner', [row['access'] for row in result['accessWorkspaces']])
            self.assertIn('review', can_add_learner_record(account))

    def test_ambiguous_email_never_picks_first_owner(self):
        from login.learner_enrolment import existing_learner_record
        with patch('login.learner_enrolment.EnrolmentUser') as model:
            model.all_learners.filter.return_value.__getitem__.return_value = [source(), source()]
            with self.assertRaises(DatabaseError):
                existing_learner_record('synthetic@example.test')

    def test_single_and_absent_matches_preserve_existing_mapping(self):
        from login.learner_enrolment import existing_learner_record
        owner = source()
        for rows, expected in [([], None), ([owner], owner)]:
            with self.subTest(count=len(rows)), patch('login.learner_enrolment.EnrolmentUser') as model:
                model.all_learners.filter.return_value.__getitem__.return_value = rows
                self.assertIs(existing_learner_record('synthetic@example.test'), expected)
