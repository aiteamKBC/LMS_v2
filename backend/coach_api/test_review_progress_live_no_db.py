"""Native Calculate ownership/freeze regressions without database fixtures."""
from contextlib import ExitStack
from copy import deepcopy
from datetime import date, datetime, timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from learner_api.review_live_inputs import UnavailableReviewProgress
from . import views
from curriculum_api import review_instances as engine, review_types


class NativeLiveProgressEndpointTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.row = {'id': 'REVI-synthetic', 'learner_id': 101, 'coach_email': 'coach@example.test',
                    'status': 'in-progress', 'progress_snapshot': {'old': 'frozen'}}
        self.source = SimpleNamespace(pk=201, learner_start_date=date(2024, 1, 1))
        self.profile = SimpleNamespace(pk=101, id=101, enrolment_id=201)
        self.now = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
        self.snapshot = {'schemaVersion': 5, 'actualHoursSource': 'canonical_learning.dashboard'}
        def stub(target, **kwargs):
            return self.stack.enter_context(patch(target, **kwargs))
        stub('coach_api.views.authenticated_coach_email', return_value='coach@example.test')
        stub('coach_api.reconciliation_links.for_native', return_value=None)
        stub('curriculum_api.review_instances.get_review_instance', return_value=self.row)
        stub('curriculum_api.review_instances.review_instance_form_definition', return_value={
            'template': {'reviewTypeCode': review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW}})
        manager = stub('coach_api.views.LearnerProfile.objects.filter')
        manager.return_value.first.return_value = self.profile
        stub('coach_api.views.fetch_source_schedule_rows', return_value=({101: self.source}, {}))
        stub('coach_api.views.resolve_review_anchor_date', return_value=(date(2024, 1, 1), None))
        stub('coach_api.views.timezone.now', return_value=self.now)
        self.builder = stub('coach_api.views.build_progress_snapshot', return_value=self.snapshot)
        self.real_save = unwrap(engine.save_review_instance_progress_snapshot)
        self.save = stub('curriculum_api.review_instances.save_review_instance_progress_snapshot')
        stub('coach_api.views._coach_review_instance_definition', return_value={'progressSnapshot': self.snapshot})

    def call(self):
        request = RequestFactory().post('/', json.dumps({'learnerId': 999, 'calculatedAt': '2000-01-01'}),
                                        content_type='application/json')
        return unwrap(views.coach_review_instance_progress)(request, self.row['id'])

    def test_native_calculate_uses_owned_profile_source_and_server_clock(self):
        self.assertEqual(self.call().status_code, 200)
        self.builder.assert_called_once_with(self.source, self.profile,
            learner_start_date=date(2024, 1, 1), calculated_at=self.now, calculated_by='coach@example.test')
        self.save.assert_called_once_with(self.row, self.snapshot, actor='coach@example.test')

    def test_other_coach_cannot_read_or_replace_the_snapshot(self):
        self.row['coach_email'] = 'other@example.test'
        self.assertEqual(self.call().status_code, 404)
        self.builder.assert_not_called()
        self.save.assert_not_called()

    def test_failed_canonical_identity_keeps_the_previous_snapshot(self):
        before = deepcopy(self.row)
        self.builder.side_effect = UnavailableReviewProgress('The consolidated learner identity needs review.')
        self.assertEqual(self.call().status_code, 409)
        self.save.assert_not_called()
        self.assertEqual(self.row, before)

    def test_awaiting_signature_and_completed_results_cannot_be_overwritten(self):
        self.save.side_effect = lambda *a, **kw: self.real_save(*a, **kw)
        for status in (engine.STATUS_AWAITING_SIGNATURE, engine.STATUS_COMPLETED):
            self.row['status'] = status
            before = deepcopy(self.row['progress_snapshot'])
            self.assertEqual(self.call().status_code, 409)
            self.assertEqual(self.row['progress_snapshot'], before)

    def test_unauthenticated_learner_and_employer_cannot_calculate(self):
        for account, status in ((None, 401), (SimpleNamespace(role='learner', subject_type='learner'), 403),
                                (SimpleNamespace(role='employer', subject_type='employer'), 403)):
            with self.subTest(status=status), patch('login.permissions.authenticate_request', return_value=account):
                response = views.coach_review_instance_progress(RequestFactory().post('/'), self.row['id'])
                self.assertEqual(response.status_code, status)
        self.builder.assert_not_called()

    def test_admin_view_as_remains_read_only(self):
        account = SimpleNamespace(role='admin', subject_type='staff', subject_id=1)
        request = RequestFactory().post('/?viewAsCoach=coach@example.test')
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('coach_api.auth.StaffUser.objects.filter') as staff, \
             patch('coach_api.auth._staff_access', return_value='super-admin'):
            staff.return_value.only.return_value.first.return_value = SimpleNamespace(access='super-admin')
            self.assertEqual(views.coach_review_instance_progress(request, self.row['id']).status_code, 403)
        self.builder.assert_not_called()

    def test_get_is_not_an_implicit_recalculation(self):
        response = unwrap(views.coach_review_instance_progress)(RequestFactory().get('/'), self.row['id'])
        self.assertEqual(response.status_code, 405)
        self.builder.assert_not_called()
        self.save.assert_not_called()
