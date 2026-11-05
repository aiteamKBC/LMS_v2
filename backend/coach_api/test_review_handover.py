"""Private SQLite rows and deterministic interleavings; not real lock acceptance."""
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from . import review_handover as handover, views, migrated_initialization
from .models import ImportedReviewInstance, MigratedReviewSignature, MigratedReviewDocument, MigratedReviewRevision
from . import test_migrated_summary_binding as binding_fixtures


OLD, NEW = 'old@example.invalid', 'new@example.invalid'
TYPES = {'MCM': 'Monthly Coaching Meeting', 'PR': 'Progress Review',
         'PR_SKILLS_RADAR': 'Progress Review (+ Skills Radar)', 'PSP': 'Personal Support Plan'}


class HandoverDatabaseBoundaryTests(SimpleTestCase):
    def test_native_assignment_does_not_enter_imported_storage_or_transaction(self):
        user = SimpleNamespace(pk=501, aptem_id=None)
        profile = SimpleNamespace(pk=901, enrolment_id=501, aptem_id=None)
        with patch.object(handover, 'shared_assignment_database') as boundary, \
                patch.object(handover, 'source_reviews') as sources:
            self.assertIsNone(handover.save_assignment(user, profile, {'coach_email': NEW}, {}))
        boundary.assert_not_called(); sources.assert_not_called()

    def test_unverified_aliases_block_review_writes_with_explicit_result(self):
        user = SimpleNamespace(pk=501, aptem_id=700)
        profile = SimpleNamespace(pk=901, enrolment_id=501, aptem_id=700)
        with patch.object(handover, 'shared_assignment_database', return_value=False), \
                patch.object(handover, 'source_reviews') as sources:
            saved, result = handover.save_assignment(user, profile, {'coach_email': NEW}, {})
        self.assertFalse(saved)
        self.assertEqual(result['blocked'], [{'code': 'shared_database_verification_required'}])
        sources.assert_not_called()

    def test_stale_old_coach_initialization_cannot_create_an_overlay_after_reassignment(self):
        definition = {'canInitialize': True, 'readOnly': True, 'historicalReview': {'id': '91', 'type': TYPES['PR']},
                      'instance': {'learnerId': 901, 'id': 'imported-review:synthetic'}}
        with patch.object(migrated_initialization.transaction, 'atomic'), \
                patch.object(views, 'lock_learner_calendar') as lock, \
                patch.object(handover.LearnerProfile.objects, 'filter') as profiles, \
                patch.object(migrated_initialization, 'resolve_template') as template, \
                patch.object(ImportedReviewInstance.objects, 'get_or_create') as create:
            profiles.return_value.values_list.return_value.first.return_value = NEW
            with self.assertRaisesMessage(ValueError, 'assignment changed'):
                migrated_initialization.initialize_imported_review(OLD, definition)
        lock.assert_called_once_with(901); template.assert_not_called(); create.assert_not_called()

    def test_independent_memory_databases_are_not_one_transaction(self):
        self.assertFalse(handover.shared_assignment_database())

    def test_alias_equality_is_conservative_and_never_connects(self):
        config = {'ENGINE': 'django.db.backends.postgresql', 'HOST': 'synthetic.invalid', 'NAME': 'synthetic',
                  'USER': 'synthetic', 'PORT': '5432', 'OPTIONS': {}}
        for key in ('HOST', 'NAME', 'USER', 'PORT', 'OPTIONS'):
            other = {**config, key: 'different'}
            with self.subTest(key=key), patch.object(handover, 'connections', {
                'default': SimpleNamespace(settings_dict=config), 'enrolment': SimpleNamespace(settings_dict=other)}):
                self.assertFalse(handover.shared_assignment_database())
        with patch.object(handover, 'connections', {key: SimpleNamespace(settings_dict=dict(config))
                                                  for key in ('default', 'enrolment')}):
            self.assertTrue(handover.shared_assignment_database())


class HandoverPersistenceTests(TestCase):
    def source(self, number=1, family='MCM', **kwargs):
        return {'id': number, 'learner_id': 901, 'aptemReviewId': f'SYNTHETIC-{number}',
                'aptemLearnerId': '700', 'type': TYPES[family], 'status': 'scheduled', 'completedDate': None, **kwargs}

    def overlay(self, source, status='scheduled', **kwargs):
        return ImportedReviewInstance.objects.create(event_key=f"imported-review:{source['aptemReviewId']}",
            owner_email=OLD, learner_id=901, source_review_id=source['id'], status=status,
            template_snapshot={'sections': [{'key': 'synthetic'}]}, answers={'recap': 'Saved answer'},
            progress_snapshot={'hours': 12}, signature_requirements={'advisor': True, 'participant': True},
            meeting_intelligence={'reviewRevision': 2, 'summary': {'overview': 'Keep'}}, **kwargs)

    def save(self, rows, booking=None, profile_error=None):
        user = SimpleNamespace(pk=501, aptem_id='700', save=Mock())
        profile = SimpleNamespace(pk=901, enrolment_id=501, aptem_id=700, coach_email=OLD, save=Mock())
        profile.save.side_effect = profile_error
        fields = {'case_owner': 'New Coach', 'coach_name': 'New Coach', 'coach_email': NEW}
        with patch.object(handover, 'shared_assignment_database', return_value=True), \
                patch.object(views, 'lock_learner_calendar') as lock, \
                patch.object(handover.EnrolmentUser.all_learners, 'using') as users, \
                patch.object(handover.LearnerProfile.objects, 'using') as profiles, \
                patch.object(handover.StaffUser.objects, 'using') as staff, \
                patch.object(handover, 'source_reviews', return_value=rows), \
                patch.object(handover, 'booking_for_imported_review', return_value=booking), \
                patch.object(views, 'microsoft_graph_request') as graph:
            users.return_value.select_for_update.return_value.get.return_value = user
            profiles.return_value.select_for_update.return_value.get.return_value = profile
            staff.return_value.filter.return_value.only.return_value.__getitem__.return_value = [SimpleNamespace(email=NEW)]
            result = handover.save_assignment(user, profile, fields, {key: fields[key] for key in ('coach_name', 'coach_email')})
        graph.assert_not_called()
        lock.assert_called_once_with(901)
        user.save.assert_called_once_with(using='default', update_fields=list(fields))
        self.assertEqual(profile.coach_email, NEW)
        return result

    def test_four_families_transfer_unbooked_states_without_changing_saved_work(self):
        number = 0
        for family in TYPES:
            for status in ('not-scheduled', 'scheduled', 'in-progress', 'awaiting-signature'):
                number += 1
                with self.subTest(family=family, status=status):
                    source = self.source(number, family)
                    overlay = self.overlay(source, status)
                    before = ImportedReviewInstance.objects.values().get(pk=overlay.pk)
                    self.assertEqual(handover.transfer_locked(overlay, source, None, NEW), 'transferred')
                    after = ImportedReviewInstance.objects.values().get(pk=overlay.pk)
                    self.assertEqual(after['owner_email'], NEW)
                    self.assertEqual({k:v for k,v in before.items() if k not in {'owner_email', 'updated_at'}},
                                     {k:v for k,v in after.items() if k not in {'owner_email', 'updated_at'}})
                    self.assertEqual(handover.transfer_locked(overlay, source, None, NEW), 'unchanged')
                    self.assertEqual(ImportedReviewInstance.objects.values().get(pk=overlay.pk), after)

    def test_assignment_service_transfers_only_exact_source_and_keeps_completed(self):
        active_source, historical_source = self.source(), self.source(2)
        active, historical = self.overlay(active_source), self.overlay(historical_source, 'completed', completed_at=timezone.now())
        before = ImportedReviewInstance.objects.values().get(pk=historical.pk)
        saved, result = self.save([active_source, historical_source])
        self.assertTrue(saved)
        self.assertEqual(result['transferred'], [active.event_key])
        self.assertEqual(result['historical'], [historical.event_key])
        self.assertEqual(ImportedReviewInstance.objects.values().get(pk=historical.pk), before)

    def test_profile_failure_rolls_back_all_overlay_transfers(self):
        sources = [self.source(1), self.source(2)]
        overlays = [self.overlay(source) for source in sources]
        before = list(ImportedReviewInstance.objects.order_by('pk').values())
        with self.assertRaisesMessage(RuntimeError, 'Synthetic profile failure'):
            self.save(sources, profile_error=RuntimeError('Synthetic profile failure'))
        self.assertEqual(list(ImportedReviewInstance.objects.order_by('pk').values()), before)
        self.assertEqual(len(overlays), 2)

    def test_reopened_active_review_transfers_but_archived_completed_snapshot_is_unchanged(self):
        source = self.source(); overlay = self.overlay(source, 'in-progress')
        revision = MigratedReviewRevision.objects.create(overlay=overlay, number=2,
            snapshot={'owner_email': OLD, 'status': 'completed', 'answers': {'recap': 'Approved'}},
            reason_code='correction-required', note='', actor_account_id=18, actor_email=OLD,
            pdf_bytes=b'archived-signed-pdf', pdf_sha256='synthetic')
        before = MigratedReviewRevision.objects.values().get(pk=revision.pk)
        _, result = self.save([source])
        self.assertEqual(result['transferred'], [overlay.event_key])
        self.assertEqual(MigratedReviewRevision.objects.values().get(pk=revision.pk), before)

    def test_source_completion_overrides_inconsistent_local_scheduled_state(self):
        source = self.source(status='completed')
        overlay = self.overlay(source)
        self.assertEqual(handover.transfer_locked(overlay, source, None, NEW), 'historical')
        overlay.refresh_from_db(); self.assertEqual(overlay.owner_email, OLD)

    def test_all_existing_booking_states_are_blocked_without_touching_meeting_or_review(self):
        source = self.source()
        overlay = self.overlay(source)
        before = ImportedReviewInstance.objects.values().get(pk=overlay.pk)
        for status in ('scheduled', 'in-progress', 'completed', 'awaiting-signature', 'failed', 'cancelled'):
            booking = SimpleNamespace(status=status, owner_email=OLD, graph_organizer_email=OLD,
                                      graph_event_id='synthetic-event', meeting_link='https://example.invalid/meeting', save=Mock())
            with self.subTest(status=status):
                _, result = self.save([source], booking)
                self.assertEqual(result['blocked'], [{'reviewId': overlay.event_key, 'code': 'booking_handover_required'}])
                booking.save.assert_not_called()
                self.assertEqual(booking.owner_email, OLD)
                self.assertEqual(ImportedReviewInstance.objects.values().get(pk=overlay.pk), before)

    def test_uninitialized_review_follows_assignment_without_creating_overlay(self):
        _, result = self.save([self.source()])
        self.assertEqual(result['uninitialized'], ['imported-review:SYNTHETIC-1'])
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_stale_new_coach_initialization_cannot_duplicate_a_blocked_foreign_overlay(self):
        source = self.source(); overlay = self.overlay(source)
        definition = {'canInitialize': True, 'readOnly': True, 'historicalReview': {'id': str(source['id']), 'type': source['type']},
            'instance': {'learnerId': 901, 'id': overlay.event_key}, 'migratedProgrammeKey': 'synthetic'}
        with patch.object(views, 'lock_learner_calendar'), \
                patch.object(handover.LearnerProfile.objects, 'filter') as profiles, \
                patch.object(migrated_initialization, 'lock_template_family'), \
                patch.object(migrated_initialization, 'resolve_template', side_effect=AssertionError('Reached template before checking stored owner')) as template:
            profiles.return_value.values_list.return_value.first.return_value = NEW
            with self.assertRaisesMessage(ValueError, 'different Coach'):
                migrated_initialization.initialize_imported_review(NEW, definition)
        template.assert_not_called()
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        overlay.refresh_from_db(); self.assertEqual(overlay.owner_email, OLD)

    def test_signoff_keeps_real_signer_and_reopened_history(self):
        source = self.source()
        overlay = self.overlay(source, 'awaiting-signature')
        signature = MigratedReviewSignature.objects.create(overlay=overlay, role='advisor', signer_account_id=18,
            signer_name='Historical Coach', signer_email=OLD, signature='synthetic-image', signed_at=timezone.now())
        revision = MigratedReviewRevision.objects.create(overlay=overlay, number=1,
            snapshot={'owner_email': OLD, 'answers': {'recap': 'Archived'}}, reason_code='correction-required',
            note='', actor_account_id=18, actor_email=OLD)
        before_signature = MigratedReviewSignature.objects.values().get(pk=signature.pk)
        before_revision = MigratedReviewRevision.objects.values().get(pk=revision.pk)
        self.assertEqual(handover.transfer_locked(overlay, source, None, NEW), 'transferred')
        self.assertEqual(MigratedReviewSignature.objects.values().get(pk=signature.pk), before_signature)
        self.assertEqual(MigratedReviewRevision.objects.values().get(pk=revision.pk), before_revision)

    def test_existing_signed_pdf_blocks_unfinished_handover(self):
        source = self.source(); overlay = self.overlay(source, 'awaiting-signature')
        doc = MigratedReviewDocument.objects.create(overlay=overlay, pdf_bytes=b'synthetic-frozen', sha256='synthetic')
        self.assertEqual(handover.transfer_locked(overlay, source, None, NEW), 'signed_snapshot_handover_required')
        doc.refresh_from_db(); overlay.refresh_from_db()
        self.assertEqual(bytes(doc.pdf_bytes), b'synthetic-frozen'); self.assertEqual(overlay.owner_email, OLD)

    def test_wrong_source_and_foreign_learner_never_transfer(self):
        source = self.source(); overlay = self.overlay(source)
        for altered in ({**source, 'id': 92}, {**source, 'learner_id': 92}, {**source, 'aptemReviewId': 'OTHER'}):
            with self.subTest(source=altered):
                self.assertEqual(handover.transfer_locked(overlay, altered, None, NEW), 'source_association_conflict')
        overlay.refresh_from_db(); self.assertEqual(overlay.owner_email, OLD)

    def test_old_coach_pending_writer_revalidates_owner_after_handover(self):
        source = self.source(); overlay = self.overlay(source, 'in-progress')
        definition = {'instance': {'id': overlay.event_key, 'learnerId': 901}, 'historicalReview': {'id': str(source['id'])}}
        self.assertIsNotNone(views._owned_migrated_overlay(OLD, definition))
        self.save([source])  # deterministic interleaving between initial read and final locked write
        self.assertIsNone(views._owned_migrated_overlay(OLD, definition, lock=True, lock_calendar=True))
        self.assertEqual(views._owned_migrated_overlay(NEW, definition, lock=True).pk, overlay.pk)
        overlay.refresh_from_db(); self.assertEqual(overlay.answers, {'recap': 'Saved answer'})

    def test_conflicting_aptem_source_identity_is_reported_without_overlay_change(self):
        source = self.source(aptemLearnerId='999'); overlay = self.overlay(source)
        _, result = self.save([source])
        self.assertEqual(result['blocked'][0]['code'], 'source_association_conflict')
        overlay.refresh_from_db(); self.assertEqual(overlay.owner_email, OLD)


class HandoverInFlightTests(TestCase):
    setUp = binding_fixtures.MigratedBindingFlowTests.setUp
    check = binding_fixtures.MigratedBindingFlowTests.check

    def reassign_booked_learner(self):
        user = SimpleNamespace(pk=501, aptem_id=700, save=Mock())
        profile = SimpleNamespace(pk=42, enrolment_id=501, aptem_id=700, coach_email=self.overlay.owner_email, save=Mock())
        source = {'id': self.overlay.source_review_id, 'learner_id': 42, 'aptemReviewId': 'binding-test',
                  'type': TYPES['MCM'], 'status': 'scheduled'}
        with patch.object(handover, 'shared_assignment_database', return_value=True), \
                patch.object(views, 'lock_learner_calendar'), \
                patch.object(handover.EnrolmentUser.all_learners, 'using') as users, \
                patch.object(handover.LearnerProfile.objects, 'using') as profiles, \
                patch.object(handover.StaffUser.objects, 'using') as staff, \
                patch.object(handover, 'source_reviews', return_value=[source]), \
                patch.object(handover, 'booking_for_imported_review', return_value=self.calendar):
            users.return_value.select_for_update.return_value.get.return_value = user
            profiles.return_value.select_for_update.return_value.get.return_value = profile
            staff.return_value.filter.return_value.only.return_value.__getitem__.return_value = [SimpleNamespace(email=NEW)]
            saved, result = handover.save_assignment(user, profile, {'coach_email': NEW}, {'coach_email': NEW})
        self.assertTrue(saved)
        self.assertEqual(result['blocked'], [{'reviewId': self.overlay.event_key, 'code': 'booking_handover_required'}])
        self.assertEqual(profile.coach_email, NEW)
        return profile

    def test_reassignment_during_check_session_cannot_publish_old_coach_generation(self):
        before = dict(self.overlay.answers)
        def reassign():
            self.reassign_booked_learner()
            # The fresh caseload read excludes the former Coach. This doubles
            # that unmanaged source boundary, not the locked write guard.
            binding_fixtures.intelligence._coach_review.return_value = (None, None)
        response, ai = self.check(during_fetch=reassign)
        self.assertIn(response.status_code, (404, 409))
        ai.assert_not_called()
        self.overlay.refresh_from_db(); self.calendar.refresh_from_db()
        self.assertEqual(self.overlay.answers, before)
        self.assertEqual(self.overlay.owner_email, binding_fixtures.OWNER)
        self.assertEqual(self.calendar.owner_email, binding_fixtures.OWNER)

    def test_reassignment_between_background_fetch_and_persist_fails_closed(self):
        from .background_meeting_sync import imported_context
        from .migrated_session_scope import persist_imported_snapshot
        profile = self.reassign_booked_learner()
        with patch.object(views, '_imported_review_definition', return_value=None) as source, \
                patch.object(views, 'persist_coach_meeting_snapshots') as persist, \
                patch.object(views, 'stored_coach_meeting_snapshot') as stored:
            # Exactly the command's revalidation adapter, after the calendar
            # and overlay locks; actual PostgreSQL scheduling remains separate.
            with self.assertRaises(handover.ReviewIdentityConflict):
                persist_imported_snapshot(self.calendar, self.snapshot, expected_version='unused',
                    context={'overlayId': self.overlay.pk}, revalidate=lambda row: imported_context(row))
        source.assert_called_once_with(binding_fixtures.OWNER, self.overlay.event_key, pdf_only=True)
        persist.assert_not_called(); stored.assert_not_called()
        self.assertEqual(profile.coach_email, NEW)
