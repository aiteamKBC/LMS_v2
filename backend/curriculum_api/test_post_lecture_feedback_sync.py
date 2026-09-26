from unittest import mock

from django.test import SimpleTestCase

from curriculum_api.management.commands import process_session_results


class PostLectureFeedbackResultHookTests(SimpleTestCase):
    def test_result_hook_scopes_feedback_sync_to_processed_series(self):
        with mock.patch(
            'engagement_api.feedback_delivery.sync_post_lecture_feedback_from_attendance'
        ) as sync:
            process_session_results.sync_post_lecture_feedback('LIVE-1')

        sync.assert_called_once_with(live_session_ids=['LIVE-1'])

    def test_feedback_failure_does_not_fail_successful_teams_result_job(self):
        with (
            mock.patch(
                'engagement_api.feedback_delivery.sync_post_lecture_feedback_from_attendance',
                side_effect=RuntimeError('synthetic failure'),
            ),
            self.assertLogs(process_session_results.__name__, level='WARNING') as logs,
        ):
            process_session_results.sync_post_lecture_feedback('LIVE-1')

        self.assertIn('Post-lecture feedback sync failed for LIVE-1', logs.output[0])
