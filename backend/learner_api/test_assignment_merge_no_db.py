"""Merged contact/assignment contracts, with database and external IO forbidden.

Run directly with the backend virtualenv. PostgreSQL lock/rollback acceptance
remains a separate integration check; these tests validate alias propagation.
"""
import sys
from pathlib import Path

if __name__ == '__main__':
    sys.path[0] = str(Path(__file__).resolve().parent.parent)
    import ast
    from unittest.mock import patch

    from learner_api.test_contact_boundaries_no_db import guard
    sys.addaudithook(guard)
    from django.conf import settings
    tree = ast.parse((Path(__file__).resolve().parent.parent / 'config/settings.py').read_text(encoding='utf-8'))
    apps = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == 'INSTALLED_APPS' for target in node.targets))
    settings.configure(SECRET_KEY='synthetic-only', INSTALLED_APPS=apps, USE_TZ=True,
        BASE_DIR=Path(__file__).resolve().parent.parent,
        ROOT_URLCONF='assignment_merge_test_urls',
        DATABASES={alias: {'ENGINE': 'django.db.backends.dummy'} for alias in ('default', 'enrolment')},
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
        ALLOWED_HOSTS=['testserver'])
    import django
    with patch.object(sys, 'argv', [__file__, 'test']):
        django.setup()
    import types
    from django.urls import include, path
    urls = types.ModuleType('assignment_merge_test_urls')
    urls.urlpatterns = [path('coach_api/', include('coach_api.urls'))]
    sys.modules[urls.__name__] = urls

import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from coach_api import review_handover, review_sources, views as coach_views
from learner_api.learner_dates import save_enrolment_fields
from learner_api import tests_case_owner_sync


class MixedAssignmentSaveTests(SimpleTestCase):
    def test_contact_date_and_assignment_keep_both_outcomes(self):
        for saved in (True, False):
            with self.subTest(saved=saved):
                source = SimpleNamespace(learner_start_date='2028-01-01', learner_end_date='stale', save=Mock())
                profile = Mock()
                fields = {'case_owner': 'Synthetic Coach', 'coach_name': 'Synthetic Coach',
                          'coach_email': 'coach@example.invalid', 'phone_number': '123',
                          'learner_start_date': '2028-01-01'}
                projection = {key: fields[key] for key in ('learner_start_date', 'coach_name', 'coach_email')}
                result = {'transferred': ['imported-review:synthetic']} if saved else {'blocked': [{'code': 'synthetic'}]}
                with patch('learner_api.learner_dates.learner_profile_for_source', return_value=profile) as resolve, \
                        patch.object(review_handover, 'save_assignment', return_value=(saved, result)) as assign, \
                        patch('learner_api.learner_dates.save_verified_contact_fields') as contacts:
                    self.assertEqual(save_enrolment_fields(source, fields), {'reviewHandover': result})
                assign.assert_called_once_with(source, profile, fields, projection, using='enrolment')
                resolve.assert_called_once_with(source, heal=False)
                if saved:
                    contacts.assert_not_called()
                else:
                    contacts.assert_called_once_with(source, fields, profile_fields=projection)
                source.save.assert_not_called()

    def test_native_assignment_with_contact_keeps_verified_save(self):
        source, profile = Mock(), Mock()
        fields = {'case_owner': 'Synthetic', 'coach_name': 'Synthetic',
                  'coach_email': 'coach@example.invalid', 'username': 'Synthetic Learner'}
        with patch('learner_api.learner_dates.learner_profile_for_source', return_value=profile), \
                patch.object(review_handover, 'save_assignment', return_value=None), \
                patch('learner_api.learner_dates.save_verified_contact_fields') as contacts:
            self.assertIsNone(save_enrolment_fields(source, fields))
        contacts.assert_called_once_with(source, fields, profile_fields={
            'coach_name': 'Synthetic', 'coach_email': 'coach@example.invalid'})


class AssignmentAliasTests(SimpleTestCase):
    def setUp(self):
        self.user = SimpleNamespace(pk=501, aptem_id=700, save=Mock())
        self.profile = SimpleNamespace(pk=901, id=901, enrolment_id=501, aptem_id=700, save=Mock())
        self.fields = {'case_owner': 'Synthetic', 'coach_name': 'Synthetic', 'coach_email': 'new@example.invalid'}
        self.projection = {key: self.fields[key] for key in ('coach_name', 'coach_email')}
        self.enterContext(patch.object(review_handover, 'shared_assignment_database', return_value=True))
        self.atomic = self.enterContext(patch.object(review_handover.transaction, 'atomic'))
        self.lock = self.enterContext(patch.object(coach_views, 'lock_learner_calendar'))
        self.managers = []
        for manager, row in ((review_handover.EnrolmentUser.all_learners, self.user),
                             (review_handover.LearnerProfile.objects, self.profile)):
            using = self.enterContext(patch.object(manager, 'using'))
            using.return_value.select_for_update.return_value.get.return_value = row
            self.managers.append(using)
        staff = self.enterContext(patch.object(review_handover.StaffUser.objects, 'using'))
        staff.return_value.filter.return_value.only.return_value.__getitem__.return_value = [Mock()]
        self.managers.append(staff)
        self.source = {'id': 1, 'learner_id': 901, 'aptemReviewId': 'synthetic',
                       'type': 'Monthly Coaching Meeting', 'status': 'scheduled'}
        self.rows = self.enterContext(patch.object(review_handover, 'source_reviews', return_value=[self.source]))
        self.overlay = SimpleNamespace(pk=12, source_review_id=1, event_key='imported-review:synthetic',
                                       status='scheduled', completed_at=None)
        self.overlays = self.enterContext(patch.object(review_handover.ImportedReviewInstance.objects, 'using'))
        self.overlays.return_value.filter.return_value.order_by.return_value = [self.overlay]
        self.overlays.return_value.select_for_update.return_value.get.return_value = self.overlay
        self.booking = self.enterContext(patch.object(review_handover, 'booking_for_imported_review', return_value=None))
        self.transfer = self.enterContext(patch.object(review_handover, 'transfer_locked', return_value='transferred'))
        self.contacts = self.enterContext(patch('learner_api.services.contact_sync.save_verified_contact_fields'))

    def test_assignment_uses_enrolment_for_every_lock_read_and_write(self):
        saved, result = review_handover.save_assignment(
            self.user, self.profile, self.fields, self.projection, using='enrolment')
        self.assertTrue(saved)
        self.assertEqual(result['transferred'], ['imported-review:synthetic'])
        self.atomic.assert_called_once_with(using='enrolment')
        self.lock.assert_called_once_with(901, using='enrolment')
        for manager in self.managers:
            manager.assert_called_once_with('enrolment')
        self.assertTrue(all(call.args == ('enrolment',) for call in self.overlays.call_args_list))
        self.rows.assert_called_once_with(901, using='enrolment')
        self.booking.assert_called_once_with(self.profile, self.source, self.overlay, lock=True, using='enrolment')
        self.transfer.assert_called_once_with(self.overlay, self.source, None, 'new@example.invalid', using='enrolment')
        self.user.save.assert_called_once_with(using='enrolment', update_fields=list(self.fields))
        self.profile.save.assert_called_once_with(using='enrolment', update_fields=[*self.projection, 'updated_at'])

    def test_mixed_contact_save_cannot_bypass_identity_verification(self):
        fields = {**self.fields, 'phone_number': '123'}
        review_handover.save_assignment(self.user, self.profile, fields, self.projection, using='enrolment')
        self.contacts.assert_called_once_with(self.user, fields, profile_fields=self.projection)
        self.user.save.assert_not_called()
        self.profile.save.assert_not_called()

    def test_coach_picker_and_board_use_source_before_calendar_lock_order(self):
        order = []
        self.managers[0].return_value.select_for_update.return_value.get.side_effect = (
            lambda **kwargs: (order.append('source'), self.user)[1])
        self.lock.side_effect = lambda *args, **kwargs: order.append('calendar')
        review_handover.save_assignment(self.user, self.profile, self.fields, self.projection, using='enrolment')
        self.assertEqual(order, ['source', 'calendar'])

    def test_contact_failure_exits_the_handover_transaction_with_error(self):
        failure = DatabaseError('Synthetic identity refusal')
        self.contacts.side_effect = failure
        with self.assertRaises(DatabaseError):
            review_handover.save_assignment(self.user, self.profile,
                {**self.fields, 'username': 'Synthetic'}, self.projection, using='enrolment')
        self.assertIs(self.atomic.return_value.__exit__.call_args.args[1], failure)

    def test_contact_save_on_default_is_refused_before_review_writes(self):
        with self.assertRaises(DatabaseError):
            review_handover.save_assignment(self.user, self.profile,
                {**self.fields, 'username': 'Synthetic'}, self.projection)
        self.atomic.assert_not_called()
        self.transfer.assert_not_called()


class AssignmentEndpointTests(SimpleTestCase):
    setUp = tests_case_owner_sync.CaseOwnerSaveTests.setUp
    patch = tests_case_owner_sync.CaseOwnerSaveTests.patch

    def test_locked_edit_returns_handover_result_and_keeps_strict_activation(self):
        from learner_api import views
        outcome = {'reviewHandover': {'blocked': [{'code': 'booking_handover_required'}]}}
        with patch.object(views, 'save_enrolment_fields', return_value=outcome), \
                patch.object(views, 'advance_learner') as advance, \
                patch.object(views, 'validate_learner_dates') as validate:
            response = self.patch(views.enrolment_user_detail, {'caseOwner': 'Synthetic'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), outcome)
        advance.assert_called_once_with(self.source, strict=True)
        self.assertEqual(validate.call_count, 2)


class BookingAliasTests(SimpleTestCase):
    def test_transfer_keeps_signature_document_and_owner_operations_on_enrolment(self):
        overlay = SimpleNamespace(source_review_id=1, learner_id=901, event_key='imported-review:synthetic',
            status='scheduled', completed_at=None, template_snapshot={'sections': [{}]},
            owner_email='old@example.invalid', migrated_signatures=Mock(), save=Mock())
        overlay.migrated_signatures.using.return_value.values_list.return_value = []
        source = {'id': 1, 'learner_id': 901, 'aptemReviewId': 'synthetic',
                  'type': 'Monthly Coaching Meeting', 'status': 'scheduled'}
        with patch.object(review_handover.MigratedReviewDocument.objects, 'using') as documents:
            documents.return_value.filter.return_value.exists.return_value = False
            self.assertEqual(review_handover.transfer_locked(
                overlay, source, None, 'new@example.invalid', using='enrolment'), 'transferred')
        overlay.migrated_signatures.using.assert_called_once_with('enrolment')
        documents.assert_called_once_with('enrolment')
        overlay.save.assert_called_once_with(using='enrolment', update_fields=['owner_email', 'updated_at'])

    def test_calendar_lock_uses_requested_connection(self):
        with patch.object(coach_views.CoachCalendarSequence.objects, 'using') as using:
            coach_views.lock_learner_calendar(901, using='enrolment')
        using.assert_called_once_with('enrolment')
        using.return_value.select_for_update.return_value.get_or_create.assert_called_once_with(
            learner_id=901, event_type=coach_views.LEARNER_CALENDAR_LOCK_SCOPE, defaults={'last_sequence': 0})

    def test_booking_resolver_passes_alias_to_calendar_and_reconciliation_reads(self):
        profile = SimpleNamespace(id=901, enrolment_id=501, learner_type='apprenticeship')
        source = {'id': 1, 'aptemReviewId': 'synthetic', 'type': 'Monthly Coaching Meeting', 'status': 'scheduled'}
        with patch.object(coach_views.CoachCalendarEvent.objects, 'using') as using, \
                patch.object(review_sources, 'linked_booking', return_value=None) as linked:
            review_sources.booking_for_imported_review(profile, source, lock=True, using='enrolment')
        using.assert_called_once_with('enrolment')
        self.assertEqual(linked.call_args.kwargs, {'using': 'enrolment'})
        self.assertIs(linked.call_args.args[1], using.return_value.select_for_update.return_value.filter.return_value)

    def test_reconciliation_lookup_keeps_the_owning_alias(self):
        from coach_api import reconciliation_links
        record = SimpleNamespace(pk=12, review_instance_id=9, event_key='other', learner_id=999,
                                 event_type='other')
        with patch.object(reconciliation_links, 'active_links') as links:
            links.return_value.using.return_value.select_related.return_value = []
            self.assertIsNone(review_sources.linked_booking(
                {'eventKey': 'synthetic', 'source': 'mcr'}, [record], using='enrolment'))
        links.return_value.using.assert_called_once_with('enrolment')


if __name__ == '__main__':
    labels = sys.argv[1:] or (
        'learner_api.test_assignment_merge_no_db', 'learner_api.test_aptem_handover',
        'coach_api.test_review_handover.HandoverDatabaseBoundaryTests',
        'learner_api.tests_activation_recovery', 'learner_api.tests_header_dates',
        'learner_api.tests_status_profile_sync', 'learner_api.tests_account_identity_sync',
    )
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in labels)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
