"""Synthetic reassignment contracts; no configured database or provider access."""
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from coach_api import migrated_completion_views, review_sources
from .learner_dates import save_enrolment_fields


class ReassignmentRegressionTests(SimpleTestCase):
    def test_assignment_reports_imported_handover_instead_of_silent_contact_only_save(self):
        source = SimpleNamespace(pk=501, aptem_id='700', case_owner='New Coach',
                                 coach_name='New Coach', coach_email='new@example.invalid', save=Mock())
        profile = SimpleNamespace(pk=901, enrolment_id=501, aptem_id=700,
                                  coach_name='Previous Coach', coach_email='old@example.invalid', save=Mock())
        with patch('learner_api.learner_dates.transaction.atomic'), \
                patch('learner_api.learner_dates.learner_profile_for_source', return_value=profile):
            result = save_enrolment_fields(source, {'case_owner': source.case_owner,
                'coach_name': source.coach_name, 'coach_email': source.coach_email})
        self.assertIsInstance(result, dict)
        self.assertIn('reviewHandover', result)

    def test_authorized_party_read_uses_exact_profile_not_former_coach_caseload(self):
        profile = SimpleNamespace(pk=901)
        overlay = SimpleNamespace(learner_id=901, owner_email='old@example.invalid',
                                  event_key='imported-review:source-1', status='completed')
        definition = {'migratedForm': True, 'readOnly': True, 'sections': []}
        def read(owner, key, **kwargs):
            return dict(definition) if kwargs.get('learners') == [profile] else None
        with patch.object(migrated_completion_views.LearnerProfile.objects, 'filter') as profiles, \
                patch('coach_api.views._imported_review_definition', side_effect=read), \
                patch.object(migrated_completion_views, 'writable_keys', return_value=set()), \
                patch.object(migrated_completion_views.migrated_monthly_log, 'signing_option', return_value=None):
            profiles.return_value.first.return_value = profile
            result = migrated_completion_views._party_definition(overlay, SimpleNamespace(role='employer'))
        self.assertIsNotNone(result)
        self.assertTrue(result['readOnly'])

    def test_unbooked_future_review_uses_current_stored_responsibility(self):
        event = {'sourceStatus': 'Planned', 'status': 'not-scheduled',
                 'ownerName': 'New Coach', 'ownerEmail': 'new@example.invalid',
                 'coachName': 'Historical Reviewer', 'coachEmail': 'old@example.invalid'}
        result = review_sources.apply_imported_state(event)
        self.assertEqual(result['coachName'], 'New Coach')
        self.assertEqual(result['coachEmail'], 'new@example.invalid')

    def test_completed_review_retains_historical_reviewer(self):
        event = {'sourceStatus': 'Completed', 'status': 'completed',
                 'ownerName': 'New Coach', 'ownerEmail': 'new@example.invalid',
                 'coachName': 'Historical Reviewer', 'coachEmail': 'old@example.invalid'}
        self.assertEqual(review_sources.apply_imported_state(event)['coachName'], 'Historical Reviewer')

    def test_local_completed_overlay_keeps_stored_owner_after_a_later_reassignment(self):
        event = {'sourceStatus': 'Planned', 'ownerName': 'Third Coach', 'ownerEmail': 'third@example.invalid'}
        overlay = SimpleNamespace(owner_email='second@example.invalid', status='completed', source_review_id=91,
            template_snapshot={'sections': [{}]}, event_key='imported-review:synthetic', completed_at=None)
        result = review_sources.apply_imported_state(event, overlay=overlay)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['coachEmail'], 'second@example.invalid')
        self.assertNotEqual(result['coachName'], 'Third Coach')

    def test_blocked_overlay_never_claims_new_current_assignment_owns_review(self):
        event = {'sourceStatus': 'Planned', 'ownerName': 'New Coach', 'ownerEmail': 'new@example.invalid'}
        overlay = SimpleNamespace(owner_email='old@example.invalid', status='in-progress', source_review_id=91,
            template_snapshot={'sections': [{}]}, event_key='imported-review:synthetic', completed_at=None)
        result = review_sources.apply_imported_state(event, overlay=overlay)
        self.assertEqual(result['coachEmail'], 'old@example.invalid')
