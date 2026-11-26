"""Security and identity checks without database or external services."""
import json
from contextlib import ExitStack, contextmanager, nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from . import learner_review_prepare as api


class LearnerReviewPrepareTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.request = self.factory.post('/prepare-review', '{}', content_type='application/json')
        self.request._dont_enforce_csrf_checks = True
        self.account = SimpleNamespace(role='learner', subject_id=71)
        self.learner = SimpleNamespace(pk=71, aptem_id='501', learner_type='commercial')
        self.profile = SimpleNamespace(pk=17, id=17, aptem_id=501, coach_email='coach@example.invalid')
        self.definition = {'instance': {'id': 'imported-review:synthetic', 'learnerId': 17},
                           'historicalReview': {'id': 101, 'type': 'Monthly Coaching Meeting', 'status': 'not-scheduled'},
                           'sourceStatus': 'Not Scheduled', 'canInitialize': True, 'readOnly': True}

    def test_rejects_other_roles_and_view_as_before_any_write(self):
        for role in ('admin', 'staff', 'employer'):
            self.account.role = role
            with self.subTest(role=role), patch.object(api, 'authenticate_request', return_value=self.account), \
                 patch.object(api, 'initialize_imported_review') as initialize:
                self.assertEqual(api.prepare_learner_review(self.request, 'imported-review:synthetic').status_code, 403)
                initialize.assert_not_called()

    def test_prepare_requires_csrf_and_rejects_learner_view_as(self):
        protected = self.factory.post('/prepare-review', '{}', content_type='application/json')
        with patch.object(api, 'authenticate_request', return_value=self.account), \
             patch.object(api, 'initialize_imported_review') as initialize:
            self.assertEqual(api.prepare_learner_review(protected, 'imported-review:synthetic').status_code, 403)
            preview = self.factory.post('/prepare-review?viewAsLearner=71', '{}', content_type='application/json')
            preview._dont_enforce_csrf_checks = True
            self.assertEqual(api.prepare_learner_review(preview, 'imported-review:synthetic').status_code, 403)
            initialize.assert_not_called()

    def test_learner_initializes_selected_owned_review_without_booking(self):
        overlay = SimpleNamespace(owner_email='coach@example.invalid', learner_id=17, source_review_id=101)
        query = MagicMock()
        query.__getitem__.return_value = []
        with patch.object(api, 'authenticate_request', return_value=self.account), \
             patch.object(api.EnrolmentUser.all_learners, 'filter') as learners, \
             patch.object(api, 'review_profile_for_source', return_value=self.profile), \
             patch.object(api, 'source_for_learner', return_value=SimpleNamespace(kind='aptem')), \
             patch.object(api.transaction, 'atomic', return_value=nullcontext()), \
             patch('coach_api.views.lock_learner_calendar'), patch.object(api, 'lock_template_family'), \
             patch.object(api.ImportedReviewInstance.objects, 'filter', return_value=query), \
             patch('coach_api.views._imported_review_definition', return_value=self.definition), \
             patch.object(api, 'initialize_imported_review', return_value=(overlay, True)) as initialize, \
             patch.object(api, '_party_definition', return_value={'readOnly': False}):
            learners.return_value.first.return_value = self.learner
            response = api.prepare_learner_review(self.request, 'imported-review:synthetic')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['readOnly'], False)
            initialize.assert_called_once_with('coach@example.invalid', self.definition)

    def test_foreign_profile_and_unsupported_family_are_not_initialized(self):
        query = MagicMock()
        query.__getitem__.return_value = []
        with patch.object(api, 'authenticate_request', return_value=self.account), \
             patch.object(api.EnrolmentUser.all_learners, 'filter') as learners, \
             patch.object(api, 'review_profile_for_source', return_value=self.profile), \
             patch.object(api, 'source_for_learner', return_value=SimpleNamespace(kind='aptem')), \
             patch.object(api.transaction, 'atomic', return_value=nullcontext()), \
             patch('coach_api.views.lock_learner_calendar'), patch.object(api, 'lock_template_family'), \
             patch.object(api.ImportedReviewInstance.objects, 'filter', return_value=query), \
             patch('coach_api.views._imported_review_definition', return_value=self.definition), \
             patch.object(api, 'initialize_imported_review') as initialize:
            learners.return_value.first.return_value = self.learner
            self.definition['instance']['learnerId'] = 999
            self.assertEqual(api.prepare_learner_review(self.request, 'imported-review:synthetic').status_code, 404)
            self.definition['instance']['learnerId'] = 17
            self.definition['historicalReview']['type'] = 'Unsupported Review'
            self.assertEqual(api.prepare_learner_review(self.request, 'imported-review:synthetic').status_code, 404)
            initialize.assert_not_called()

    def test_existing_form_is_reused_and_never_reinitialized(self):
        overlay = SimpleNamespace(owner_email='coach@example.invalid', learner_id=17, source_review_id=101,
                                  answers={'field': 'preserved'})
        query = MagicMock()
        query.__getitem__.return_value = [overlay]
        self.definition.update(migratedForm=True, canInitialize=False)
        with patch.object(api, 'authenticate_request', return_value=self.account), \
             patch.object(api.EnrolmentUser.all_learners, 'filter') as learners, \
             patch.object(api, 'review_profile_for_source', return_value=self.profile), \
             patch.object(api, 'source_for_learner', return_value=SimpleNamespace(kind='aptem')), \
             patch.object(api.transaction, 'atomic', return_value=nullcontext()), \
             patch('coach_api.views.lock_learner_calendar'), patch.object(api, 'lock_template_family'), \
             patch.object(api.ImportedReviewInstance.objects, 'filter', return_value=query), \
             patch('coach_api.views._imported_review_definition', return_value=self.definition), \
             patch.object(api, 'initialize_imported_review') as initialize, \
             patch.object(api, '_party_definition', return_value={'readOnly': False}):
            learners.return_value.first.return_value = self.learner
            response = api.prepare_learner_review(self.request, 'imported-review:synthetic')
            self.assertEqual(response.status_code, 200)
            initialize.assert_not_called()
            self.assertEqual(overlay.answers, {'field': 'preserved'})

    def test_admin_preview_is_read_only_and_cannot_initialize(self):
        self.account.role = 'admin'
        request = self.factory.get('/preview')
        definition = {**self.definition, 'previewOnly': True, 'readOnly': False}
        model = SimpleNamespace(all_learners=MagicMock())
        model.all_learners.filter.return_value.first.return_value = self.learner
        overlays = MagicMock()
        overlays.__getitem__.return_value = []
        with patch.object(api, 'authenticate_request', return_value=self.account), \
             patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': model}), \
             patch.object(api, 'review_profile_for_source', return_value=self.profile), \
             patch.object(api, 'source_for_learner', return_value=SimpleNamespace(kind='aptem')), \
             patch.object(api.ImportedReviewInstance.objects, 'filter', return_value=overlays), \
             patch('coach_api.views._imported_review_definition', return_value=definition) as resolve, \
             patch.object(api, 'initialize_imported_review') as initialize:
            response = api.preview_learner_review(request, 'imported-review:synthetic', 'commercial', 71)
            self.assertEqual(response.status_code, 200)
            body = json.loads(response.content)
            self.assertTrue(body['readOnly'])
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertNotIn('historicalReview', body)
            self.assertTrue(resolve.call_args.kwargs['preview_only'])
            initialize.assert_not_called()

    def test_preview_refuses_learner_and_employer(self):
        request = self.factory.get('/preview')
        for role in ('learner', 'employer'):
            with self.subTest(role=role), patch.object(api, 'authenticate_request', return_value=SimpleNamespace(role=role)):
                self.assertEqual(api.preview_learner_review(request, 'imported-review:synthetic', 'commercial', 71).status_code, 403)

    @contextmanager
    def _preview_as(self, account, definition):
        """Resolve a learner for the preview endpoint, yielding the two mocks
        that must stay untouched when the caller is not authorized."""
        model = SimpleNamespace(all_learners=MagicMock())
        model.all_learners.filter.return_value.first.return_value = self.learner
        overlays = MagicMock()
        overlays.__getitem__.return_value = []
        with ExitStack() as stack:
            stack.enter_context(patch.object(api, 'authenticate_request', return_value=account))
            stack.enter_context(patch('learner_api.learner_detail.SOURCE_MODELS', {'commercial': model}))
            stack.enter_context(patch.object(api, 'review_profile_for_source', return_value=self.profile))
            stack.enter_context(patch.object(api, 'source_for_learner', return_value=SimpleNamespace(kind='aptem')))
            stack.enter_context(patch.object(api.ImportedReviewInstance.objects, 'filter', return_value=overlays))
            resolve = stack.enter_context(
                patch('coach_api.views._imported_review_definition', return_value=definition))
            initialize = stack.enter_context(patch.object(api, 'initialize_imported_review'))
            yield resolve, initialize

    def _preview(self):
        return api.preview_learner_review(
            self.factory.get('/preview'), 'imported-review:synthetic', 'commercial', 71)

    def test_coach_preview_is_confined_to_their_own_caseload(self):
        """A coach signs in as staff, so only the assigned coach_email may read."""
        account = SimpleNamespace(role='staff', email='other-coach@example.invalid')
        definition = {**self.definition, 'previewOnly': True, 'readOnly': False}
        with self._preview_as(account, definition) as (resolve, initialize):
            response = self._preview()
            self.assertEqual(response.status_code, 403)
            self.assertIn('caseload', json.loads(response.content)['detail'])
            # The form is never resolved for a learner this account does not own.
            resolve.assert_not_called()
            initialize.assert_not_called()

    def test_coach_preview_of_own_learner_is_read_only(self):
        # Addresses differ only by case between the login account and the profile.
        account = SimpleNamespace(role='staff', email='Coach@Example.Invalid')
        definition = {**self.definition, 'previewOnly': True, 'readOnly': False}
        with self._preview_as(account, definition) as (resolve, initialize):
            response = self._preview()
            self.assertEqual(response.status_code, 200)
            body = json.loads(response.content)
            self.assertTrue(body['readOnly'])
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertNotIn('historicalReview', body)
            self.assertTrue(resolve.call_args.kwargs['preview_only'])
            initialize.assert_not_called()

    def test_preview_refuses_staff_when_the_learner_has_no_assigned_coach(self):
        account = SimpleNamespace(role='staff', email='coach@example.invalid')
        self.profile.coach_email = ''
        with self._preview_as(account, {**self.definition, 'previewOnly': True}) as (resolve, initialize):
            self.assertEqual(self._preview().status_code, 403)
            resolve.assert_not_called()
            initialize.assert_not_called()

    def test_admin_preview_rejects_wrong_learner_kind(self):
        model = SimpleNamespace(all_learners=MagicMock())
        model.all_learners.filter.return_value.first.return_value = self.learner
        with patch.object(api, 'authenticate_request', return_value=SimpleNamespace(role='admin')), \
             patch('learner_api.learner_detail.SOURCE_MODELS', {'apprenticeship': model}), \
             patch('coach_api.views._imported_review_definition') as definition:
            response = api.preview_learner_review(self.factory.get('/preview'), 'imported-review:synthetic', 'apprenticeship', 71)
            self.assertEqual(response.status_code, 404)
            definition.assert_not_called()

    def test_unbooked_answers_allow_only_student_fields(self):
        from .migrated_respondents import merge_party_answers
        from .test_migrated_template_sync import field, form
        snapshot = form(field('coach'), field('learner', respondentRoles=['participant']))
        snapshot['templateSource'] = {'family': 'MCM'}
        overlay = SimpleNamespace(status='not-scheduled', template_snapshot=snapshot,
                                  answers={'coach': 'preserve existing coach answer'})
        result = merge_party_answers(overlay, {'learner': 'student answer'}, 'participant')
        self.assertEqual(result['coach'], 'preserve existing coach answer')
        self.assertEqual(result['learner'], 'student answer')
        with self.assertRaises(PermissionError):
            merge_party_answers(overlay, {'coach': 'unauthorized edit'}, 'participant')
