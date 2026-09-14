"""Date synchronization tests with no database access."""
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from .active_users import sync_active_user
from .learner_dates import save_enrolment_fields
from .models import LearnerProfile


class LearnerDateSyncTests(SimpleTestCase):
    def test_exact_profile_columns(self):
        self.assertEqual(LearnerProfile._meta.get_field('learner_start_date').column, 'Learner_Start_date')
        self.assertEqual(LearnerProfile._meta.get_field('learner_end_date').column, 'Learner_end_date')

    def test_save_and_clear_copy_both_dates_to_linked_profile(self):
        for start, end in [('2028-01-01', '2028-12-31'), (None, None), ('2028-01-01', None)]:
            with self.subTest(start=start, end=end):
                source = SimpleNamespace(pk=132, learner_start_date=start, learner_end_date=end, save=Mock())
                profile = SimpleNamespace(pk=901, save=Mock())
                with patch('learner_api.learner_dates.transaction.atomic') as atomic, \
                        patch('learner_api.learner_dates.learner_profile_for_source', return_value=profile) as resolve:
                    save_enrolment_fields(source, {'learner_start_date': start})
                atomic.assert_called_once_with(using='enrolment')
                resolve.assert_called_once_with(source)
                self.assertEqual(profile.learner_start_date, start)
                self.assertEqual(profile.learner_end_date, end)
                profile.save.assert_called_once_with(using='enrolment', update_fields=['learner_start_date', 'learner_end_date', 'updated_at'])

    def test_no_profile_keeps_dates_for_later_activation(self):
        source = Mock()
        with patch('learner_api.learner_dates.transaction.atomic'), \
                patch('learner_api.learner_dates.learner_profile_for_source', return_value=None):
            save_enrolment_fields(source, {'learner_end_date': None})
        source.save.assert_called_once_with(update_fields=['learner_end_date'])

    def test_profile_failure_exits_transaction_with_error(self):
        source = SimpleNamespace(learner_start_date=None, learner_end_date=None, save=Mock())
        failure = DatabaseError('profile write failed')
        profile = Mock()
        profile.save.side_effect = failure
        with patch('learner_api.learner_dates.transaction.atomic') as atomic, \
                patch('learner_api.learner_dates.learner_profile_for_source', return_value=profile):
            with self.assertRaises(DatabaseError):
                save_enrolment_fields(source, {'learner_start_date': None})
        self.assertIs(atomic.return_value.__exit__.call_args.args[1], failure)

    def test_unrelated_edit_does_not_touch_profile(self):
        source = Mock()
        with patch('learner_api.learner_dates.learner_profile_for_source') as resolve:
            save_enrolment_fields(source, {'phone_number': '07000000000'})
        resolve.assert_not_called()

    def test_activation_copies_header_dates_into_new_profile(self):
        source = SimpleNamespace(id=132, programme_status='Active', learner_start_date='2028-01-01', learner_end_date='2028-12-31')
        with patch('learner_api.apprenticeship_agreement._group_dates', return_value=(None, None, None)), \
                patch('learner_api.active_users.get_training_plan', return_value=[]), \
                patch('learner_api.active_users.transaction.atomic'), \
                patch('learner_api.active_users.learner_profile_for_source', return_value=None), \
                patch('learner_api.active_users.hydrate_source_training_plan', return_value=[]), \
                patch('learner_api.active_users._resolve_linkable_programme_id', return_value=None), \
                patch('learner_api.active_users._linkable_placement_ids', return_value=(None, None)), \
                patch('learner_api.active_users.LearnerProfile.objects.create') as create, \
                patch('learner_api.active_users.replace_training_plan'), \
                patch('learner_api.active_users.refresh_learner_ksb_snapshot'):
            sync_active_user(source)
        self.assertEqual(create.call_args.kwargs['learner_start_date'], '2028-01-01')
        self.assertEqual(create.call_args.kwargs['learner_end_date'], '2028-12-31')
        self.assertEqual(create.call_args.kwargs['enrolment_id'], 132)
