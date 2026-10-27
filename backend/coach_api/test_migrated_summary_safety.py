"""Session selection, concurrency and saved-work regressions; synthetic I/O only."""
from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone as utc
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import connection, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from . import migrated_intelligence_views as intelligence, migrated_summary_attempts as attempts, views
from .migrated_session_scope import booking_window, current_reports, scope_snapshot, select_artifacts
from . import test_migrated_summary_binding as binding_tests, test_migrated_summary_actions as action_tests
from .test_migrated_summary_binding import OWNER
from .models import ImportedReviewInstance


@override_settings(TIME_ZONE='Europe/London')
class SessionSelectionTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(scheduled_date=date(2026, 10, 22), scheduled_time=time(10), duration_minutes=60)

    def artifact(self, key='current', start='2026-10-22T09:05:00Z', end='2026-10-22T09:30:00Z', call='call-one'):
        return {'graph_artifact_id': key, 'artifact_type': 'transcript', 'created_datetime': start, 'end_datetime': end, 'call_id': call}

    def test_old_and_future_calls_are_excluded_without_deleting_input_history(self):
        rows = [self.artifact(), self.artifact('old', '2026-10-21T09:00:00Z', '2026-10-21T09:30:00Z', 'old'),
                self.artifact('future', '2026-10-23T09:00:00Z', '2026-10-23T09:30:00Z', 'future')]
        before = deepcopy(rows)
        selected, error = select_artifacts(self.record, {'artifacts': rows})
        self.assertIsNone(error)
        self.assertEqual([row['graph_artifact_id'] for row in selected], ['current'])
        self.assertEqual(rows, before)

    def test_segments_for_one_call_are_kept_including_a_segment_after_booked_end(self):
        rows = [self.artifact(), self.artifact('later', '2026-10-22T10:00:00Z', '2026-10-22T10:15:00Z')]
        self.assertEqual(select_artifacts(self.record, {'artifacts': rows}), (rows, None))

    def test_adjacent_calls_at_exact_booking_boundaries_are_excluded(self):
        rows = [self.artifact(), self.artifact('before', '2026-10-22T08:00:00Z', '2026-10-22T09:00:00Z', 'before'),
                self.artifact('after', '2026-10-22T10:00:00Z', '2026-10-22T10:30:00Z', 'after')]
        self.assertEqual(select_artifacts(self.record, {'artifacts': rows}), ([rows[0]], None))

    def test_multiple_matching_calls_or_missing_timing_require_explicit_resolution(self):
        cases = [[self.artifact(), self.artifact('other', call='call-two')],
                 [self.artifact(start='', end='', call='')],
                 [self.artifact(), self.artifact('unknown', start='', end='', call='other')],
                 [self.artifact(call=''), self.artifact('other', call='')],
                 [self.artifact(start='invalid', end='invalid')]]
        for rows in cases:
            with self.subTest(rows=rows):
                self.assertEqual(select_artifacts(self.record, {'artifacts': rows})[1], 'TRANSCRIPT_SESSION_AMBIGUOUS')

    def test_known_call_identity_can_resolve_an_undated_segment(self):
        rows = [self.artifact(), self.artifact('segment', start='', end='')]
        self.assertEqual(select_artifacts(self.record, {'artifacts': rows}), (rows, None))

    def test_a_report_extends_the_window_for_an_early_start_and_overtime(self):
        report = {'meetingStartDateTime': '2026-10-22T08:50:00Z', 'meetingEndDateTime': '2026-10-22T10:30:00Z'}
        row = self.artifact(start='2026-10-22T08:51:00Z', end='2026-10-22T08:55:00Z')
        self.assertEqual(select_artifacts(self.record, {'artifacts': [row], 'attendanceReports': [report]}), ([row], None))

    def test_distinct_report_windows_are_ambiguous_even_without_call_ids(self):
        reports = [{'meetingStartDateTime': f'2026-10-22T09:{minute}:00Z', 'meetingEndDateTime': '2026-10-22T09:50:00Z'} for minute in ('00', '20')]
        self.assertEqual(select_artifacts(self.record, {'attendanceReports': reports})[1], 'TRANSCRIPT_SESSION_AMBIGUOUS')

    def test_reports_from_other_dates_and_naive_invalid_times_cannot_confirm_end(self):
        for start, end in [('2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z'), ('invalid', ''),
                           ('2026-10-22T09:00:00', '2026-10-22T09:30:00'), ('2026-10-22T09:30:00Z', '2026-10-22T09:00:00Z')]:
            self.assertEqual(current_reports(self.record, {'attendanceReports': [{'meetingStartDateTime': start, 'meetingEndDateTime': end}]}), [])

    def test_dst_and_overnight_duration_use_elapsed_instants(self):
        for day, start_time, duration in [(date(2026, 10, 25), time(1, 30), 90), (date(2026, 3, 29), time(0, 30), 120), (date(2026, 10, 22), time(23, 30), 120)]:
            self.record.scheduled_date, self.record.scheduled_time, self.record.duration_minutes = day, start_time, duration
            start, end = booking_window(self.record)
            self.assertEqual((end - start).total_seconds(), duration * 60)
            self.assertEqual(start.tzinfo, utc.utc)

    def test_metadata_fields_are_supported_and_unrelated_attendance_is_filtered(self):
        row = {'graph_artifact_id': 't1', 'artifact_type': 'transcript', 'metadata': {
            'createdDateTime': '2026-10-22T09:00:00Z', 'endDateTime': '2026-10-22T09:30:00Z', 'callId': 'one'}}
        old = {'meetingStartDateTime': '2026-10-21T09:00:00Z', 'meetingEndDateTime': '2026-10-21T09:30:00Z', 'records': []}
        result = scope_snapshot(self.record, {'artifacts': [row], 'attendanceReports': [old]})
        self.assertEqual(result['artifacts'], [row])
        self.assertEqual(result['attendance']['reportCount'], 0)

    def test_transcript_query_is_limited_to_selected_ids_and_empty_selection_reads_nothing(self):
        record = SimpleNamespace(event_key='synthetic', graph_event_id='graph-current')
        with patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
                patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=True), \
                patch.object(views, 'connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('current', 'Only current session')]
            result = views.stored_coach_meeting_transcript_for_summary(record, artifact_ids=['current'])
            self.assertEqual(result['text'], 'Only current session')
            self.assertIn('graph_artifact_id IN (%s)', cursor.execute.call_args.args[0])
            self.assertEqual(cursor.execute.call_args.args[1], ['synthetic', 'graph-current', 'current'])
            cursor.execute.reset_mock()
            self.assertIsNone(views.stored_coach_meeting_transcript_for_summary(record, artifact_ids=[]))
            cursor.execute.assert_not_called()
            # D03: omitting an explicit allowlist now selects the booked call;
            # it must never restore the old unfiltered event-wide query.
            with patch.object(views, 'coach_meeting_transcript_selection', return_value={'artifactIds': ['current']}):
                views.stored_coach_meeting_transcript_for_summary(record)
            self.assertIn('graph_artifact_id IN', cursor.execute.call_args.args[0])
            self.assertEqual(cursor.execute.call_args.args[1], ['synthetic', 'graph-current', 'current'])


class TransportAndLockTests(SimpleTestCase):
    def test_check_session_takes_parent_locks_before_the_overlay(self):
        definition = {'instance': {'id': 'imported-review:synthetic', 'learnerId': 21},
                      'historicalReview': {'id': 501}, 'template': {'reviewTypeCode': 'aptem_mcm'}}
        overlay = SimpleNamespace(learner_id=21, source_review_id=501, template_snapshot={'sections': [{}]})
        calendar = SimpleNamespace(owner_email=OWNER, event_type='mcr', graph_event_id='meeting', sync_state='synced')
        order = []
        query = MagicMock()
        query.first.return_value = overlay
        query.select_for_update.return_value.first.side_effect = lambda: order.append('overlay') or overlay
        with patch.object(intelligence, '_coach_review', return_value=(OWNER, definition)), \
                patch.object(views.ImportedReviewInstance.objects, 'filter', return_value=query), \
                patch.object(views, 'lock_learner_calendar', side_effect=lambda *_: order.append('learner')), \
                patch('coach_api.review_sources.booking_for_overlay', side_effect=lambda *_, **kw: order.append('calendar') or calendar):
            self.assertIs(intelligence._association(SimpleNamespace(), definition['instance']['id'], lock=True)[1], calendar)
        self.assertEqual(order, ['learner', 'calendar', 'overlay', 'calendar'])

    def test_attendance_transport_retains_permission_and_network_failure_categories(self):
        for status in (401, 403, 429, 500, None):
            with self.subTest(status=status):
                failure = RuntimeError('Synthetic Graph error')
                if status:
                    failure.__cause__ = HTTPError('https://example.invalid', status, 'Synthetic', {}, None)
                def graph(_method, path):
                    if '/attendanceReports' in path:
                        raise failure
                    return {'value': []}
                with patch.object(views, 'has_graph_credentials', return_value=True), \
                        patch.object(views, 'coach_meeting_graph_target', return_value=('/synthetic', None)), \
                        patch.object(views, 'microsoft_graph_request', side_effect=graph), \
                        patch.object(views, 'coach_meeting_expected_attendees', return_value=[]), \
                        patch.object(views.logger, 'exception'):
                    snapshot, error, code = views.fetch_coach_meeting_graph_snapshot(SimpleNamespace(event_key='synthetic'))
                self.assertIsNone(error)
                self.assertEqual(code, 207)
                self.assertEqual(snapshot['resourceErrors']['attendance'], 'permission' if status in (401, 403) else 'fetch')
                self.assertTrue(snapshot['errors'])


class SummaryPersistenceSafetyTests(TestCase):
    setUp = binding_tests.MigratedBindingFlowTests.setUp
    check = binding_tests.MigratedBindingFlowTests.check
    save = binding_tests.MigratedBindingFlowTests.save
    upload = action_tests.MigratedSummaryActionTests.upload

    def test_graph_and_ai_run_without_an_endpoint_transaction(self):
        depth = len(connection.savepoint_ids)
        def outside():
            self.assertEqual(len(connection.savepoint_ids), depth)
        response, _ = self.check(during_fetch=outside, during_generation=outside)
        self.assertEqual(response.status_code, 200)
        response, _ = self.upload(during_generation=outside)
        self.assertEqual(response.status_code, 200)

    def test_ai_wait_preserves_concurrent_other_answer_summary_edit_and_explicit_clear(self):
        for answer in ('Coach final answer', ''):
            self.overlay.answers = {'other': 'Old'}
            self.overlay.meeting_intelligence = {}
            self.overlay.save()
            response, _ = self.check(during_generation=lambda: self.save({'recap': answer, 'other': 'Newer answer'}))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(self.overlay.answers, {'recap': answer, 'other': 'Newer answer'})

    def test_completion_owner_booking_and_template_changes_reject_late_generation(self):
        self.overlay.delete()
        self.calendar.delete()
        self.template.delete()
        for change in ('status', 'owner', 'slot', 'graph', 'cancel', 'template'):
            with self.subTest(change=change):
                self.setUp()
                def mutate():
                    if change == 'status':
                        ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(status='completed')
                    elif change == 'owner':
                        ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(owner_email='other@example.invalid')
                    elif change == 'template':
                        template = deepcopy(self.overlay.template_snapshot)
                        template['sections'][0]['fields'][0]['title'] = 'Different question'
                        ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(template_snapshot=template)
                    else:
                        update = {'scheduled_time': time(15)} if change == 'slot' else {'status': 'cancelled'} if change == 'cancel' else {'graph_event_id': 'different-meeting'}
                        type(self.calendar).objects.filter(pk=self.calendar.pk).update(**update)
                response, _ = self.check(during_generation=mutate)
                self.assertEqual(response.status_code, 409)
                self.assertNotIn('recap', self.overlay.answers)
                self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)
                self.overlay.delete()
                self.calendar.delete()
                self.template.delete()

    def test_upload_rechecks_learner_and_source_identity_after_generation(self):
        def reassign():
            ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(learner_id=43, source_review_id=7002)
            self.definition['instance']['learnerId'] = 43
            self.definition['historicalReview']['id'] = '7002'
        response, _ = self.upload(during_generation=reassign)
        self.assertEqual(response.status_code, 409)
        self.assertNotIn('recap', self.overlay.answers)
        self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)

    def test_competing_teams_or_upload_attempt_is_rejected_without_duplicate_ai(self):
        def compete():
            second, second_ai = self.check()
            self.assertEqual(json.loads(second.content)['code'], 'SUMMARY_IN_PROGRESS')
            second_ai.assert_not_called()
            second, second_ai = self.upload()
            self.assertEqual(json.loads(second.content)['code'], 'SUMMARY_IN_PROGRESS')
            second_ai.assert_not_called()
        response, ai = self.check(during_generation=compete)
        self.assertEqual(response.status_code, 200)
        ai.assert_called_once()
        self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)

    def test_failure_releases_attempt_and_explicit_retry_succeeds(self):
        for source in ('teams', 'upload'):
            with self.subTest(source=source):
                self.overlay.meeting_intelligence = {}
                self.overlay.save()
                action = self.check if source == 'teams' else self.upload
                action(ai_error=RuntimeError('Synthetic failure'))
                self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)
                response, ai = action()
                self.assertEqual(response.status_code, 200)
                ai.assert_called_once()

    def test_expired_attempt_can_be_replaced_and_old_cleanup_cannot_clear_new_attempt(self):
        self.overlay.meeting_intelligence = {'_summaryAttempt': {'id': 'old', 'owner': OWNER, 'expiresAt': (timezone.now() - timedelta(minutes=1)).isoformat()}}
        self.overlay.save()
        with transaction.atomic():
            locked = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
            token = attempts.claim(locked)
        attempts.release(self.overlay.pk, OWNER, 'old')
        self.overlay.refresh_from_db()
        self.assertTrue(attempts.owns(self.overlay, token))
        attempts.release(self.overlay.pk, OWNER, token)
        self.overlay.refresh_from_db()
        self.assertNotIn('_summaryAttempt', self.overlay.meeting_intelligence)

    def test_unmatched_and_multiple_call_transcripts_remain_resources_without_ai(self):
        start = datetime.combine(self.calendar.scheduled_date, self.calendar.scheduled_time, ZoneInfo(settings.TIME_ZONE))
        for rows in ([{'artifact_type': 'transcript', 'graph_artifact_id': 'unknown'}],
                     [{'artifact_type': 'transcript', 'graph_artifact_id': str(i), 'call_id': str(i), 'created_datetime': start.isoformat()} for i in (1, 2)]):
            response, ai = self.check(snapshot={**self.snapshot, 'artifacts': rows})
            self.assertIn(response.status_code, (200, 207))
            ai.assert_not_called()
            self.assertNotIn('summary', self.overlay.meeting_intelligence)
            self.assertNotIn('recap', self.overlay.answers)

    def test_verified_ended_report_and_resource_failures_remain_distinct_after_persistence(self):
        self.calendar.scheduled_date = timezone.localdate() + timedelta(days=1)
        self.calendar.save()
        for failure, status in [(None, 200), ('fetch', 207), ('permission', 207)]:
            snapshot = {**self.snapshot, 'errors': ['Attendance reports unavailable'] if failure else [],
                        'resourceErrors': {'attendance': failure} if failure else {}}
            response, ai = self.check(snapshot=snapshot, transcript=None)
            data = json.loads(response.content)
            self.assertEqual(response.status_code, status)
            self.assertIsNone(data['intelligence']['meetingEndCode'])
            self.assertEqual(data['intelligence']['meetingEndStatus'], 'attendance-confirmed')
            self.assertEqual(data['intelligence']['resourceErrors'], {'attendance': failure} if failure else {})
            self.assertEqual(data['partial'], bool(failure))
            self.assertNotIn('recap', self.overlay.answers)
            ai.assert_not_called()

    def test_a_newer_attempt_wins_without_receiving_the_old_generation(self):
        def replace():
            state = dict(ImportedReviewInstance.objects.get(pk=self.overlay.pk).meeting_intelligence)
            state['_summaryAttempt']['id'] = 'new-request'
            ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(meeting_intelligence=state)
        response, _ = self.check(during_generation=replace)
        self.assertEqual(json.loads(response.content)['code'], 'SUMMARY_SUPERSEDED')
        self.assertEqual(self.overlay.meeting_intelligence['_summaryAttempt']['id'], 'new-request')
        self.assertNotIn('recap', self.overlay.answers)
