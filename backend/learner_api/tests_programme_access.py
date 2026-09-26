import json
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import ApiSessionGateMiddleware, refusal_for
from .programme_access import DRAFTING_PATHS, learning_access, refusal, submission_refusal


class ProgrammeAccessTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(programme='Marketing', cohort='October 2026', start_date='2025-01-01')
        self.account = SimpleNamespace(role='learner', subject_id=499)
        self.cursor = MagicMock()
        self.cursor.fetchone.return_value = (date(2026, 10, 1),)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = self.cursor
        self.connections = patch('learner_api.programme_access.connections', {'default': connection})
        self.connections.start()
        self.addCleanup(self.connections.stop)
        self.now = patch('django.utils.timezone.now', return_value=datetime(2026, 9, 12, tzinfo=timezone.utc)).start()
        self.addCleanup(patch.stopall)

    def test_cohort_date_wins_over_an_earlier_individual_date(self):
        self.assertEqual(learning_access(self.source), {'blocked': True, 'startDate': '2026-10-01'})
        self.assertEqual(self.cursor.execute.call_args.args[1], ['Marketing', 'October 2026'])

    def test_all_learning_opens_on_the_cohort_start_day_in_uk_time(self):
        # UK midnight, still the previous UTC day. No per-module date gate.
        self.now.return_value = datetime(2026, 9, 30, 23, 0, tzinfo=timezone.utc)
        self.source.start_date = '2027-01-01'
        self.assertFalse(learning_access(self.source)['blocked'])

    def test_missing_cohort_date_does_not_fall_back_to_an_earlier_individual_date(self):
        self.cursor.fetchone.return_value = (None,)
        self.assertEqual(learning_access(self.source), {'blocked': True, 'startDate': ''})

    def test_direct_and_batch_activity_reads_cannot_bypass_the_start_date(self):
        with patch('login.api_gate._enabled', return_value=True), \
                patch('old_otjh.gate.refusal', return_value=None), \
                patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.return_value = self.source
            for path in ['/learner_api/quizzes/1/', '/learner_api/student-activity/commercial/499/1/2/attempts/']:
                with self.subTest(path=path):
                    response = refusal_for(path, self.account)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(json.loads(response.content)['code'], 'programme_not_started')

    def test_post_progress_is_refused_before_the_view_can_write(self):
        handler = MagicMock(return_value=HttpResponse('saved'))
        middleware = ApiSessionGateMiddleware(handler)
        with patch.object(middleware, '_account', return_value=self.account), \
                patch('login.api_gate._enabled', return_value=True), \
                patch('old_otjh.gate.refusal', return_value=None), \
                patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.return_value = self.source
            for path in ['/learner_api/time-tracking/start/', '/learner_api/videos/video-1/complete/',
                         '/learner_api/components/reading-1/complete/', '/learner_api/quizzes/1/submit/',
                         '/learner_api/evidence/commercial/499/', '/learner_api/monthly-reports/commercial/499/']:
                with self.subTest(path=path):
                    self.assertEqual(middleware(RequestFactory().post(path, {})).status_code, 403)
            handler.assert_not_called()
            self.now.return_value = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
            self.assertEqual(middleware(RequestFactory().post('/learner_api/components/reading-1/complete/', {})).status_code, 200)
            handler.assert_called_once()

    def test_preview_reads_and_staff_review_do_not_need_a_start_check(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            for path in ['/learner_api/learner-summary/commercial/499/', '/learner_api/overview-week/commercial/499/',
                         '/learner_api/training-plan-dashboard/commercial/499/', '/learner_api/evidence/commercial/499/']:
                self.assertIsNone(refusal(path, self.account))
            self.assertIsNone(refusal('/learner_api/quizzes/1/', SimpleNamespace(role='staff')))
            manager.only.assert_not_called()

    def test_failed_schedule_check_is_retryable_and_does_not_allow_progress(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.side_effect = DatabaseError('offline')
            response = refusal('/learner_api/time-tracking/start/', self.account, 'POST')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['code'], 'programme_access_unavailable')

    def test_admin_learner_actions_do_not_wait_for_the_programme_start_date(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            for path in ['/learner_api/time-tracking/start/', '/learner_api/quizzes/1/submit/',
                         '/learner_api/components/reading-1/complete/',
                         '/learner_api/student-activity/commercial/499/1/2/attempts/']:
                self.assertIsNone(refusal(path, SimpleNamespace(role='admin'), 'POST'))
            manager.only.assert_not_called()

    def test_drafting_is_open_before_the_cohort_starts(self):
        # Writing helpers and draft material: no start check, no learner lookup.
        paths = sorted(DRAFTING_PATHS) + [
            '/learner_api/reflection/submissions/',
            '/learner_api/evidence/commercial/499/upload/',
            '/learner_api/evidence/apprenticeship/499/6f1c2a4e-0b7d-4c1e-9a53-2d8e7f4b1c90/',
        ]
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            for path in paths:
                for method in ('POST', 'DELETE'):
                    with self.subTest(path=path, method=method):
                        self.assertIsNone(refusal(path, self.account, method))
            manager.only.assert_not_called()

    def test_submitting_and_completing_still_wait_for_the_start_date(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.return_value = self.source
            for path in ['/learner_api/time-tracking/start/', '/learner_api/quizzes/1/submit/',
                         '/learner_api/videos/video-1/complete/', '/learner_api/components/reading-1/complete/',
                         '/learner_api/student-activity/commercial/499/1/2/attempts/',
                         '/learner_api/monthly-reports/commercial/499/', '/learner_api/evidence/commercial/499/',
                         '/learner_api/reflection/some-new-endpoint/',
                         '/learner_api/evidence/commercial/499/upload/extra/']:
                with self.subTest(path=path):
                    response = refusal(path, self.account, 'POST')
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(json.loads(response.content)['code'], 'programme_not_started')

    def test_submission_refusal_before_and_after_the_start_date(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.return_value = self.source
            response = submission_refusal(self.account)
            self.assertEqual(response.status_code, 403)
            body = json.loads(response.content)
            self.assertEqual(body['code'], 'programme_not_started')
            self.assertEqual(body['error'], 'Submissions open on 2026-10-01. Save your work as a draft until then.')
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.now.return_value = datetime(2026, 10, 1, 9, tzinfo=timezone.utc)
            self.assertIsNone(submission_refusal(self.account))
            for account in (SimpleNamespace(role='admin'), SimpleNamespace(role='staff'), None):
                self.assertIsNone(submission_refusal(account))

    def test_submission_refusal_fails_closed_when_the_date_cannot_be_checked(self):
        with patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.side_effect = DatabaseError('offline')
            response = submission_refusal(self.account)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['code'], 'programme_access_unavailable')


class ReflectionSubmissionStartDateTests(SimpleTestCase):
    """The save endpoint: drafts go through early, submissions are refused unwritten."""

    def post(self, mode):
        from . import reflection_submissions
        account = SimpleNamespace(role='learner', subject_id=499)
        body = {'learnerKind': 'apprenticeship', 'learnerId': '499', 'activityType': 'assignment',
                'activityId': 'component-1', 'assignmentAnswer': 'Answer', 'whatYouLearned': 'Learned',
                'businessImpact': 'Impact', 'submissionMode': mode}
        request = RequestFactory().post('/learner_api/reflection/submissions/', json.dumps(body), content_type='application/json')
        request.login_account = account
        refused = JsonResponse({'error': 'Submissions open on 2026-10-01.', 'code': 'programme_not_started'}, status=403)
        # The first database step after the start check. Reaching it means the
        # request was not held back; stopping there keeps the test off any database.
        reached_save = RuntimeError('reached the save')
        with patch('login.permissions.authenticate_request', return_value=account),                 patch('learner_api.programme_access.submission_refusal', return_value=refused) as gate,                 patch.object(reflection_submissions, '_reflection_lineage', side_effect=reached_save) as write:
            try:
                response = reflection_submissions.create_reflection_submission(request)
            except RuntimeError as exc:
                self.assertIs(exc, reached_save)
                response = None
        return response, gate, write

    def test_submit_is_refused_before_anything_is_written(self):
        response, gate, write = self.post('submit')
        self.assertEqual(response.status_code, 403)
        gate.assert_called_once()
        write.assert_not_called()

    def test_draft_save_is_not_held_back(self):
        response, gate, write = self.post('draft')
        gate.assert_not_called()
        # It went on to the save -- i.e. it was not stopped at the start date.
        self.assertIsNone(response)
        write.assert_called_once()
