import json
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import ApiSessionGateMiddleware, refusal_for
from .programme_access import learning_access, refusal


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
                         '/learner_api/reflection/submissions/', '/learner_api/evidence/commercial/499/',
                         '/learner_api/monthly-reports/commercial/499/']:
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
