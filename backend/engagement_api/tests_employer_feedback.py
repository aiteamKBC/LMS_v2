"""Employer/learner isolation, independent launch boundaries and durable retries.

Only disposable SQLite databases or mocked I/O are used; no mail or storage I/O.
"""
from contextlib import ExitStack, nullcontext
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import importlib
import json
from types import SimpleNamespace
from threading import Barrier, local
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import employer_feedback as employer, feedback, review_feedback as reviews
from . import tests_review_feedback as baseline
from .models import FeedbackEmployerReviewDelivery, FeedbackForm


class EmployerSyncTests(SimpleTestCase):
    def setUp(self):
        fixture = baseline.ReviewFeedbackSyncTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.f = fixture
        self.form = FeedbackForm(id=83, form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE,
                                 published_at=baseline.LAUNCH)
        reviews.FeedbackForm.objects.filter.return_value.order_by.return_value = [fixture.pr_form, self.form]
        fixture.rows.return_value = [baseline.source_row(review_type='Progress Review', completed_date=baseline.COMPLETED)]
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.object(FeedbackEmployerReviewDelivery.objects, 'filter', return_value=[]))
        self.create = self.stack.enter_context(mock.patch.object(FeedbackEmployerReviewDelivery.objects, 'get_or_create'))
        self.create.side_effect = lambda **kw: (FeedbackEmployerReviewDelivery(id=501, source_review_id=kw['source_review_id'], **kw['defaults']), True)
        self.resolve = self.stack.enter_context(mock.patch.object(employer, 'resolve_pending_delivery'))

    def test_completion_assigns_two_independent_forms_and_responses(self):
        for family in ('Progress Review', 'Progress Review (+ Skills Radar)'):
            with self.subTest(family=family):
                self.f.rows.return_value[0]['review_type'] = family
                result = reviews.sync_review_feedback(71)
                self.assertEqual((result['created'], result['employerCreated']), (1, 1))
                self.assertEqual(self.f.create.call_args.kwargs['defaults']['form'], self.f.pr_form)
                self.assertEqual(self.create.call_args.kwargs['defaults']['form'], self.form)
                self.assertEqual(self.resolve.call_args.args[0].learner_id, '71')

    def test_employer_template_works_without_a_student_template(self):
        reviews.FeedbackForm.objects.filter.return_value.order_by.return_value = [self.form]
        result = reviews.sync_review_feedback(71)
        self.assertEqual((result['created'], result['employerCreated']), (0, 1))

    def test_gateway_epa_is_learner_only_even_when_source_type_is_pr(self):
        reviews.FeedbackForm.objects.filter.return_value.order_by.return_value = [self.f.pr_form, self.form, self.f.epa_form]
        self.f.rows.return_value = [baseline.source_row(review_type='Progress Review', review_name='Gateway Review',
            status='Completed', completed_date=baseline.COMPLETED)]
        result = reviews.sync_review_feedback(71)
        self.assertEqual((result['created'], result['employerCreated']), (1, 0))
        self.assertEqual(self.f.create.call_args.kwargs['defaults']['form'], self.f.epa_form)
        self.create.assert_not_called()

    def test_existing_student_delivery_does_not_suppress_new_employer_assignment(self):
        self.f.existing.return_value = [SimpleNamespace(source_review_id=9001, learner_id='71')]
        result = reviews.sync_review_feedback(71)
        self.assertEqual((result['existing'], result['employerCreated']), (1, 1))

    def test_employer_publish_has_its_own_future_only_boundary(self):
        self.form.published_at = baseline.COMPLETED + timedelta(seconds=1)
        result = reviews.sync_review_feedback(71)
        self.assertEqual((result['created'], result['employerHistorical']), (1, 1))
        self.create.assert_not_called()

    def test_old_reopened_undated_future_incomplete_and_mcm_do_not_assign(self):
        cases = [
            (baseline.source_row(review_type='Monthly Coaching Meeting', completed_date=baseline.COMPLETED), []),
            (baseline.source_row(review_type='Skills Radar', completed_date=baseline.COMPLETED), []),
            (baseline.source_row(review_type='Progress Review', status='Completed'), []),
            (baseline.source_row(review_type='Progress Review'), []),
            (baseline.source_row(review_type='Progress Review', completed_date=baseline.NOW + timedelta(days=1)), []),
            (baseline.source_row(review_type='Progress Review', completed_date=baseline.COMPLETED), [baseline.overlay(meeting_intelligence={'reopenCompletedAt': (baseline.LAUNCH - timedelta(days=1)).isoformat()})]),
        ]
        for row, overlays in cases:
            with self.subTest(row=row['review_type'], date=row['completed_date']):
                self.f.rows.return_value = [row]
                self.f.overlays.return_value = overlays
                self.assertEqual(reviews.sync_review_feedback(71)['employerCreated'], 0)
        self.create.assert_not_called()


class EmployerResolutionTests(SimpleTestCase):
    def setUp(self):
        self.delivery = FeedbackEmployerReviewDelivery(id=501, learner_id='71', form_id=83,
            source_review_id=9001, review_type='Progress Review', completed_at=baseline.COMPLETED)
        self.learner = SimpleNamespace(pk=71, employer_id=7, employer='Synthetic employer')
        self.record = SimpleNamespace(pk=7, full_name='Synthetic Employer', email='employer@example.test')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.contact = self.stack.enter_context(mock.patch.object(employer, 'employer_contact', return_value='employer@example.test'))
        self.profiles = self.stack.enter_context(mock.patch.object(employer.Employer.objects, 'filter'))
        self.profiles.return_value.first.return_value = self.record
        self.accounts = self.stack.enter_context(mock.patch.object(employer.LoginAccount.objects, 'filter'))
        self.accounts.return_value.exists.return_value = True
        self.update = self.stack.enter_context(mock.patch.object(FeedbackEmployerReviewDelivery.objects, 'filter'))
        self.update.return_value.update.return_value = 1

    def test_verified_account_resolves_once_and_pins_recipient(self):
        employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertEqual(self.delivery.employer_id, 7)
        self.assertEqual(self.delivery.pending_reason, '')
        self.accounts.assert_called_once_with(subject_type='employer', role='employer', subject_id=7, is_active=True)
        self.learner.employer_id = 99
        employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertEqual(self.delivery.employer_id, 7)
        self.contact.assert_called_once()

    def test_missing_account_stays_pending_then_resolves_on_retry(self):
        self.accounts.return_value.exists.return_value = False
        employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertIsNone(self.delivery.employer_id)
        self.assertEqual(self.delivery.pending_reason, 'missing_employer_account')
        self.accounts.return_value.exists.return_value = True
        employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertEqual(self.delivery.employer_id, 7)
        self.assertEqual((self.delivery.form_id, self.delivery.source_review_id), (83, 9001))

    def test_invalid_explicit_link_cannot_fall_back_to_another_employer_email(self):
        self.profiles.return_value.first.return_value = None
        with mock.patch.object(employer.Employer.objects, 'annotate') as fallback:
            employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertEqual(self.delivery.pending_reason, 'invalid_employer_link')
        fallback.assert_not_called()
        self.accounts.assert_not_called()

    def test_email_only_requires_a_unique_employer_profile_and_active_account(self):
        self.learner.employer_id = None
        for matches, expected in (([], None), ([self.record, self.record], None), ([self.record], 7)):
            with self.subTest(matches=len(matches)), mock.patch.object(employer.Employer.objects, 'annotate') as query:
                query.return_value.filter.return_value.__getitem__.return_value = matches
                employer.resolve_pending_delivery(self.delivery, self.learner)
                self.assertEqual(self.delivery.employer_id, expected)

    def test_missing_contact_is_recorded_without_blocking_student(self):
        self.learner.employer_id = None
        self.contact.return_value = ''
        employer.resolve_pending_delivery(self.delivery, self.learner)
        self.assertEqual(self.delivery.pending_reason, 'missing_employer_link')
        self.assertIsNone(self.delivery.employer_id)

    def test_email_reconciliation_is_parameterized_and_excludes_explicit_other_employers(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [(71,)]
        with mock.patch.object(employer, 'connections', {'enrolment': SimpleNamespace(cursor=mock.Mock(return_value=cursor))}):
            self.assertEqual(employer.learners_with_employer_email(' Employer@Example.test '), [71])
        sql, params = cursor.execute.call_args.args
        self.assertIn('"Employer_id" IS NULL', sql)
        self.assertEqual(params, ['employer@example.test'])

    def test_employer_page_reconciles_email_only_learners_and_pending_requests(self):
        with (mock.patch.object(employer, 'learners_with_employer_email', return_value=[71]),
              mock.patch.object(employer.EnrolmentUser.all_learners, 'filter', return_value=[self.learner]) as learners,
              mock.patch.object(reviews, 'sync_review_feedback') as sync):
            self.update.return_value.__iter__.return_value = iter([])
            employer.reconcile_employer(7)
        sync.assert_called_once_with(71)
        self.assertIn(('pk__in', [71]), learners.call_args.args[0].children)


class EmployerAuthorizationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def account(self, role='employer', subject_id=7, subject_type='employer'):
        return SimpleNamespace(role=role, subject_type=subject_type, subject_id=subject_id, display_name='Synthetic Employer')

    def test_allowed_owner_readonly_staff_and_forbidden_identities(self):
        for account, write, status in (
            (self.account(), False, None), (self.account(), True, None),
            (self.account(subject_id=8), False, 404), (self.account(subject_id=8), True, 404),
            (None, False, 401), (None, True, 401),
            (self.account('learner', subject_type='learner'), False, 403),
            (self.account('learner', subject_type='learner'), True, 403),
            (self.account('staff', subject_type='staff'), False, None),
            (self.account('admin', subject_type='staff'), False, None),
            (self.account('staff', subject_type='staff'), True, 403),
            (self.account('admin', subject_type='staff'), True, 403),
        ):
            with self.subTest(role=getattr(account, 'role', None), write=write), mock.patch.object(employer, 'authenticate_request', return_value=account):
                _, error = employer.employer_scope(self.factory.get('/'), 7, write=write)
                self.assertEqual(error.status_code if error is not None else None, status)

    def test_queue_is_scoped_and_never_returns_pending_or_other_employer(self):
        query = mock.MagicMock()
        query.filter.return_value = query
        query.order_by.return_value = []
        with (mock.patch.object(employer, 'authenticate_request', return_value=self.account()),
              mock.patch.object(employer, 'reconcile_employer') as reconcile,
              mock.patch.object(FeedbackEmployerReviewDelivery.objects, 'select_related', return_value=query),
              mock.patch.object(employer.FeedbackResponse.objects, 'filter', return_value=[])):
            response = employer.forms(self.factory.get('/?employerId=999&learnerId=999'), 7)
        self.assertEqual(json.loads(response.content), {'forms': []})
        reconcile.assert_called_once_with(7)
        self.assertEqual(query.filter.call_args_list[0].kwargs['employer_id'], 7)
        self.assertEqual(query.filter.call_args_list[0].kwargs['pending_reason'], '')

    def test_save_ignores_forged_learner_and_employer_names_and_uses_owned_delivery(self):
        request = self.factory.post('/', data=json.dumps({'learnerId': 999, 'employerId': 999, 'learnerName': 'FORGED', 'answers': {}, 'submit': True}), content_type='application/json')
        delivery = SimpleNamespace(id=501, learner_id='71', employer_name='Snapshot', form=object())
        with (mock.patch.object(employer, 'authenticate_request', return_value=self.account()),
              mock.patch.object(employer, 'delivery_context', return_value=delivery) as context,
              mock.patch.object(feedback, 'save_owned_response', return_value=SimpleNamespace(status_code=200)) as save):
            self.assertEqual(employer.response_save(request, 7, 501).status_code, 200)
        context.assert_called_once_with(7, 501)
        self.assertEqual(save.call_args.kwargs['learner_id'], '71')
        self.assertEqual(save.call_args.kwargs['learner_name'], 'Synthetic Employer')
        self.assertEqual(save.call_args.kwargs['employer_review_delivery_id'], 501)

    def test_other_delivery_or_unpublished_form_cannot_be_saved_or_uploaded(self):
        with (mock.patch.object(employer, 'authenticate_request', return_value=self.account()),
              mock.patch.object(employer, 'delivery_context', return_value=None),
              mock.patch.object(feedback, 'save_owned_response') as save):
            self.assertEqual(employer.response_save(self.factory.post('/'), 7, 999).status_code, 404)
            self.assertEqual(employer.photo_upload(self.factory.post('/'), 7, 999, 12).status_code, 404)
        save.assert_not_called()

    def test_learner_cannot_open_employer_form_even_with_a_manual_assignment(self):
        form = FeedbackForm(id=83, form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE)
        with (mock.patch.object(feedback, '_forms_queryset') as query,
              mock.patch.object(feedback, '_assignment_for', return_value=object())):
            query.return_value.get.return_value = form
            self.assertEqual(feedback._learner_feedback_context('71', form_id=83), (None, None, None))

    def test_response_scoring_identity_cannot_collide_with_student_response(self):
        from .feedback_scoring import response_key
        response = SimpleNamespace(delivery_id=None, form_id=83, learner_id='71', employer_review_delivery_id=501)
        self.assertEqual(response_key(response), ('employer_review', 501))

    def test_employer_writes_require_csrf(self):
        from django.middleware.csrf import CsrfViewMiddleware
        request = self.factory.post('/engagement_api/feedback/employers/7/501/response/',
                                    data='{}', content_type='application/json')
        request.session = {}
        result = CsrfViewMiddleware(lambda r: None).process_view(request, employer.response_save, (), {'employer_id': 7, 'delivery_id': 501})
        self.assertEqual(result.status_code, 403)

    def test_private_employer_photo_cannot_be_read_by_the_related_learner(self):
        from .tests import _patched
        photo = SimpleNamespace(response=SimpleNamespace(form=FeedbackForm(form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE),
            delivery=None, employer_review_delivery_id=501, employer_review_delivery=SimpleNamespace(employer_id=7), learner_id='71'))
        account = self.account('learner', subject_id=71, subject_type='learner')
        with (_patched(account), mock.patch.object(employer, 'authenticate_request', return_value=account),
              mock.patch.object(feedback.FeedbackUpload.objects, 'select_related') as query,
              mock.patch.object(feedback.evidence_storage, 'download_blob_bytes') as storage):
            query.return_value.get.return_value = photo
            result = feedback.feedback_upload_content(self.factory.get('/'), 'synthetic-upload')
        self.assertEqual(result.status_code, 403)
        storage.assert_not_called()

    def test_shared_response_validation_preserves_independent_employer_identity(self):
        form = FeedbackForm(id=83, form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE, allow_save_continue=True)
        delivery = FeedbackEmployerReviewDelivery(id=501, form=form, learner_id='71', employer_id=7)
        question = SimpleNamespace(id=12, question_type='long_text', required=True, config={})
        response = feedback.FeedbackResponse(id=901, form=form, learner_id='71', employer_review_delivery=delivery)
        request = self.factory.post('/', data=json.dumps({'answers': {'12': 'Useful'}, 'submit': True}), content_type='application/json')
        with (mock.patch.object(feedback.FeedbackResponse.objects, 'filter') as query,
              mock.patch.object(feedback.FeedbackResponse.objects, 'select_for_update') as locked,
              mock.patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=[question]),
              mock.patch.object(feedback.EnrolmentUser.all_learners, 'get', return_value=SimpleNamespace(username='Synthetic Learner', programme='Synthetic Programme')),
              mock.patch.object(feedback.FeedbackAnswer.objects, 'update_or_create') as answer,
              mock.patch.object(feedback.transaction, 'atomic', side_effect=lambda: nullcontext()),
              mock.patch.object(response, 'save')):
            query.return_value.prefetch_related.return_value.first.return_value = None
            locked.return_value.get_or_create.return_value = (response, True)
            result = feedback.save_owned_response(request, learner_id='71', learner_name='Synthetic Employer', form=form,
                delivery=None, recipient=delivery, employer_review_delivery_id=501)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(response.status, 'completed')
        self.assertEqual(locked.return_value.get_or_create.call_args.kwargs['employer_review_delivery'], delivery)
        self.assertNotIn('review_delivery', locked.return_value.get_or_create.call_args.kwargs)
        self.assertEqual(locked.return_value.get_or_create.call_args.kwargs['defaults']['learner_name'], 'Synthetic Employer')
        answer.assert_called_once_with(response=response, question_id=12, defaults={'answer': 'Useful'})

    def test_migration_has_no_history_backfill_and_rejects_noncanonical_target(self):
        migration = importlib.import_module('engagement_api.migrations.0010_employer_review_feedback')
        schema = SimpleNamespace(connection=SimpleNamespace(vendor='postgresql', alias='enrolment'), execute=mock.Mock())
        with self.assertRaises(RuntimeError):
            migration.install(None, schema)
        self.assertNotIn('INSERT INTO', migration.SQL)
        self.assertIn('employer_review_delivery_id IS NULL', migration.SQL)

    def test_migration_state_resolves_the_new_delivery_and_response_relation(self):
        from django.db.migrations.loader import MigrationLoader
        state = MigrationLoader(None).project_state([('engagement_api', '0010_employer_review_feedback')])
        delivery = state.apps.get_model('engagement_api', 'FeedbackEmployerReviewDelivery')
        response = state.apps.get_model('engagement_api', 'FeedbackResponse')
        self.assertTrue(delivery._meta.get_field('source_review_id').unique)
        self.assertIs(response._meta.get_field('employer_review_delivery').related_model, delivery)

    def test_staff_recipient_report_shows_employer_pending_state_and_related_learner(self):
        form = FeedbackForm(id=83, form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE)
        delivery = FeedbackEmployerReviewDelivery(id=501, form=form, source_review_id=9001, learner_id='71',
            learner_name='Synthetic Learner', review_type='Progress Review', completed_at=baseline.COMPLETED,
            assigned_at=baseline.COMPLETED, employer_name='Synthetic Employer', employer_email='employer@example.test')
        with (mock.patch.object(feedback.FeedbackForm.objects, 'filter') as forms,
              mock.patch.object(feedback.FeedbackDeliveryRecipient.objects, 'select_related') as lectures,
              mock.patch.object(feedback.FeedbackAssignment.objects, 'filter') as manual,
              mock.patch.object(FeedbackEmployerReviewDelivery.objects, 'select_related') as employers,
              mock.patch.object(feedback.EnrolmentUser.all_learners, 'all') as learners,
              mock.patch.object(feedback.FeedbackResponse.objects, 'filter', return_value=[])):
            forms.return_value.values_list.return_value = [83]
            lectures.return_value.filter.return_value.order_by.return_value = []
            manual.return_value.order_by.return_value = []
            employers.return_value.filter.return_value.order_by.return_value = [delivery]
            learners.return_value.filter.return_value = [SimpleNamespace(id=71, username='Synthetic Learner', email='learner@example.test', programme='Synthetic')]
            row = feedback._form_recipient_rows(form)[0]
        self.assertEqual(row['recipientType'], 'employer')
        self.assertEqual(row['learnerName'], 'Synthetic Employer')
        self.assertEqual(row['relatedLearnerName'], 'Synthetic Learner')
        self.assertEqual(row['email'], 'employer@example.test')
        self.assertEqual(row['responseStatus'], 'pending_link')


class EmployerDeliveryTransactionTests(baseline.IsolatedDeliveryTransactionTests):
    def setUp(self):
        super().setUp()
        self.stack.enter_context(mock.patch.object(FeedbackEmployerReviewDelivery._meta, 'db_table', 'employer_test_deliveries'))
        from django.db import connections
        with connections[self.alias].schema_editor() as schema:
            schema.create_model(FeedbackEmployerReviewDelivery)
        self.employer_deliveries = FeedbackEmployerReviewDelivery.objects.db_manager(self.alias)
        self.stack.enter_context(mock.patch.object(FeedbackEmployerReviewDelivery, 'objects', self.employer_deliveries))
        self.stack.enter_context(mock.patch.object(employer, 'resolve_pending_delivery'))

    def test_pending_assignment_survives_template_version_change_and_retry(self):
        FeedbackForm.objects.create(title='Synthetic employer form', form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE,
            published_at=baseline.LAUNCH, status='published', created_by='Synthetic')
        reviews._source_rows.return_value = [baseline.source_row(review_type='Progress Review', completed_date=baseline.COMPLETED)]
        self.assertEqual(reviews.sync_review_feedback(71)['employerCreated'], 1)
        original = self.employer_deliveries.get()
        FeedbackForm.objects.filter(pk=original.form_id).update(is_current=False)
        FeedbackForm.objects.create(title='Synthetic employer version two', form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE,
            template_key=original.form.template_key, version=2, published_at=baseline.LAUNCH,
            status='published', created_by='Synthetic')
        self.assertEqual(reviews.sync_review_feedback(71)['employerExisting'], 1)
        self.assertEqual(self.employer_deliveries.count(), 1)
        self.assertEqual(self.employer_deliveries.get().form_id, original.form_id)
        self.assertIsNone(self.employer_deliveries.get().employer_id)

    def test_two_completion_workers_create_one_employer_assignment(self):
        from django.db import connections
        from django.db.models.query import QuerySet
        FeedbackForm.objects.create(title='Synthetic employer form', form_type=reviews.EMPLOYER_REVIEW_FORM_TYPE,
            published_at=baseline.LAUNCH, status='published', created_by='Synthetic')
        reviews._source_rows.return_value = [baseline.source_row(review_type='Progress Review', completed_date=baseline.COMPLETED)]
        barrier, seen = Barrier(2), local()
        original_get = QuerySet.get

        def race_get(query, *args, **kwargs):
            try:
                return original_get(query, *args, **kwargs)
            except FeedbackEmployerReviewDelivery.DoesNotExist:
                if query.model is FeedbackEmployerReviewDelivery and not getattr(seen, 'waited', False):
                    seen.waited = True
                    barrier.wait(timeout=10)
                raise

        def run():
            try:
                return reviews.sync_review_feedback(71)
            finally:
                connections[self.alias].close()

        with mock.patch.object(QuerySet, 'get', race_get), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertEqual(sum(result['employerCreated'] for result in results), 1)
        self.assertEqual(self.employer_deliveries.count(), 1)
