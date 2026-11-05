"""Claim-free imported meeting selection; synthetic Graph and storage only."""
from copy import deepcopy
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from . import migrated_intelligence_views as intelligence, views
from .actual_session_resolution import VerifiedMeetingTarget, review_meeting_target
from .migrated_session_scope import (meeting_artifacts, meeting_reports,
                                     reconcile_meeting_reports,
                                     persist_imported_snapshot, snapshot_version)
from .models import CoachCalendarEvent
from .test_migrated_summary_binding import OWNER


class MeetingSelectorTests(TestCase):
    def test_two_calls_are_distinct_and_wrong_meeting_is_excluded(self):
        record = SimpleNamespace(graph_event_id='event-1')
        def row(name, call, meeting='meeting-1'):
            return {'artifact_type': 'transcript', 'graph_artifact_id': name,
                    'call_id': call, 'metadata': {'meetingId': meeting},
                    'created_datetime': '2026-10-20T10:00:00Z',
                    'end_datetime': '2026-10-20T10:20:00Z'}
        rows, error = meeting_artifacts(record, {'artifacts': [
            row('a', 'call-1'), row('b', 'call-2'), row('wrong', 'call-3', 'meeting-2')]},
            'meeting-1', trusted_fetch=True)
        self.assertEqual({item['graph_artifact_id'] for item in rows}, {'a', 'b'})
        self.assertEqual(error, 'MEETING_ARTIFACT_CONFLICT')

    def test_conflicting_duplicate_artifact_id_is_never_selected(self):
        record = SimpleNamespace(graph_event_id='event-1')
        rows = [{'artifact_type': 'transcript', 'graph_artifact_id': 'same',
                 'call_id': call, 'metadata': {}, 'created_datetime': '2026-10-20T10:00:00Z',
                 'end_datetime': '2026-10-20T10:20:00Z'} for call in ('call-1', 'call-2')]
        selected, error = meeting_artifacts(record, {'artifacts': rows}, 'meeting-1', trusted_fetch=True)
        self.assertEqual(selected, [])
        self.assertEqual(error, 'MEETING_ARTIFACT_CONFLICT')

    def test_reports_are_meeting_level_and_not_filtered_by_booking_date(self):
        reports, error = meeting_reports({'attendanceReports': [
            {'id': 'early', 'meetingStartDateTime': '2026-10-20T10:00:00Z',
             'meetingEndDateTime': '2026-10-20T10:20:00Z'},
            {'id': 'late', 'meetingStartDateTime': '2026-11-20T10:00:00Z',
             'meetingEndDateTime': '2026-11-20T10:20:00Z'}]})
        self.assertIsNone(error)
        self.assertEqual([row['id'] for row in reports], ['early', 'late'])

    def test_repeated_report_cannot_reduce_saved_attendance(self):
        old = {'id': 'report-one', 'meetingStartDateTime': '2026-10-20T10:00:00Z',
               'meetingEndDateTime': '2026-10-20T10:30:00Z',
               'totalParticipantCount': 1, 'attendedCount': 1,
               'records': [{'id': 'person-one', 'email': 'one@example.invalid',
                            'totalAttendanceSeconds': 900}]}
        for incoming in ({**old, 'records': [], 'attendedCount': 0},
                         {**old, 'records': [{**old['records'][0],
                                             'totalAttendanceSeconds': 0}]}):
            with self.subTest(incoming=incoming):
                reports, reduced = reconcile_meeting_reports([old], [incoming])
                self.assertTrue(reduced)
                self.assertEqual(reports, [old])
        later = {'id': 'report-two', 'meetingStartDateTime': '2026-11-20T10:00:00Z',
                 'meetingEndDateTime': '2026-11-20T10:30:00Z', 'records': []}
        reports, reduced = reconcile_meeting_reports([old], [later])
        self.assertFalse(reduced)
        self.assertEqual(reports, [old, later])


class SimpleMeetingCheckSessionTests(TestCase):
    def setUp(self):
        from .test_migrated_summary_binding import MigratedBindingFlowTests
        MigratedBindingFlowTests.setUp(self)

    def artifact(self, name, call, kind='transcript', meeting='meeting-1'):
        row = {'artifact_type': kind, 'graph_artifact_id': name, 'call_id': call,
               'created_datetime': '2026-10-20T10:00:00Z',
               'end_datetime': '2026-10-20T10:20:00Z',
               'metadata': {'meetingId': meeting, 'callId': call}}
        if kind == 'transcript':
            row.update(transcript_text=f'{name} decisions',
                       transcript_vtt=f'WEBVTT\n\n{name} decisions')
        return row

    def check(self, artifacts, *, reports=(), stored=None):
        saved = {'artifacts': deepcopy(stored or []), 'attendanceReports': [],
                 'attendance': {'expectedAttendees': []}, 'attendanceTracker': {},
                 'storage': {'stored': True}, 'partial': False, 'errors': []}
        writes = []
        target = SimpleNamespace(online_meeting_id='meeting-1')
        snapshot = {'artifacts': deepcopy(artifacts), 'attendanceReports': list(reports),
                    'attendance': {'expectedAttendees': []}, 'attendanceTracker': {},
                    'transcriptCollectionComplete': True, 'errors': [], 'resourceErrors': {},
                    'partial': False}
        def resolve(_record, *, identity_out):
            identity_out['target'] = target
            return 'users/synthetic/onlineMeetings/meeting-1', None
        def fetch(record, **options):
            self.assertEqual(options['target_resolver'](record),
                             ('users/synthetic/onlineMeetings/meeting-1', None))
            metadata = [row for row in snapshot['artifacts'] if row['artifact_type'] == 'transcript']
            options['transcript_content_selector'](record, snapshot['attendanceReports'], metadata)
            return deepcopy(snapshot), None, 200
        def persist(_record, **kwargs):
            writes.extend(deepcopy(kwargs['artifacts']))
            retained = {(row['artifact_type'], row['graph_artifact_id']): row
                        for row in saved['artifacts']}
            retained.update({(row['artifact_type'], row['graph_artifact_id']): row
                             for row in deepcopy(kwargs['artifacts'])})
            saved.update(artifacts=list(retained.values()),
                         attendanceReports=deepcopy(kwargs['attendance_reports']),
                         attendance={'expectedAttendees': []})
            return {'stored': True}
        def transcript(_record, *, artifact_ids):
            rows = [row for row in saved['artifacts']
                    if row['artifact_type'] == 'transcript' and row['graph_artifact_id'] in artifact_ids
                    and row.get('transcript_text')]
            return ({'artifactId': ','.join(row['graph_artifact_id'] for row in rows),
                     'text': '\n'.join(row['transcript_text'] for row in rows)} if rows else None)
        with patch.object(intelligence, '_coach_review', return_value=(OWNER, self.definition)), \
             patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=resolve), \
             patch.object(views, 'fetch_coach_meeting_graph_snapshot', side_effect=fetch), \
             patch.object(views, 'persist_coach_meeting_snapshots', side_effect=persist), \
             patch.object(views, 'stored_coach_meeting_snapshot', side_effect=lambda *_a, **_k: deepcopy(saved)), \
             patch.object(views, 'stored_coach_meeting_transcript_for_summary', side_effect=transcript), \
             patch.object(views, 'openai_meeting_summary') as ai, \
             patch('coach_api.recording_archive.archived_recording_url', return_value=''):
            response = unwrap(intelligence.migrated_review_check_session)(
                RequestFactory().post('/'), self.overlay.event_key)
        self.overlay.refresh_from_db()
        return response, writes, saved, ai

    def test_early_and_late_calls_display_without_a_claim(self):
        for scheduled in (date(2026, 10, 26), date(2026, 10, 18)):
            with self.subTest(scheduled=scheduled):
                self.calendar.scheduled_date = scheduled
                self.calendar.save(update_fields=['scheduled_date'])
                response, writes, saved, ai = self.check([
                    self.artifact('first', 'call-1'), self.artifact('video', 'call-1', 'recording')])
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual({row['graph_artifact_id'] for row in writes}, {'first', 'video'})
                self.assertEqual([row['graph_artifact_id'] for row in json.loads(response.content)['artifacts']],
                                 ['first', 'video'])
                self.assertNotIn('actualSession', self.overlay.meeting_intelligence)
                ai.assert_not_called()

    def test_attendance_only_other_day_is_visible_on_the_following_stored_get(self):
        report = {'id': 'early-report', 'meetingStartDateTime': '2026-10-20T10:00:00Z',
                  'meetingEndDateTime': '2026-10-20T10:30:00Z', 'records': []}
        response, _writes, saved, ai = self.check([], reports=[report])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content)['attendance']['reportCount'], 1)
        self.assertEqual(saved['attendanceReports'][0]['_lms_verified_online_meeting_id'], 'meeting-1')
        with patch.object(intelligence, '_association',
                          return_value=(self.overlay, self.calendar, self.definition)), \
             patch.object(views, 'stored_coach_meeting_snapshot', return_value=saved):
            stored = unwrap(intelligence.migrated_review_intelligence)(
                RequestFactory().get('/'), self.overlay.event_key)
        self.assertEqual(stored.status_code, 200, stored.content)
        self.assertEqual([item['id'] for item in json.loads(stored.content)['attendance']['reports']],
                         ['early-report'])
        ai.assert_not_called()

    def test_two_calls_and_wrong_meeting_remain_separate(self):
        response, writes, _saved, ai = self.check([
            self.artifact('first', 'call-1'), self.artifact('second', 'call-2'),
            self.artifact('foreign', 'call-3', meeting='meeting-2')])
        self.assertEqual(response.status_code, 207, response.content)
        self.assertEqual({row['graph_artifact_id'] for row in writes}, {'first', 'second'})
        self.assertEqual({row['graph_artifact_id'] for row in json.loads(response.content)['artifacts']},
                         {'first', 'second'})
        ai.assert_not_called()

    def test_metadata_retry_does_not_replace_saved_transcript_body(self):
        prior = self.artifact('first', 'call-1')
        prior['metadata'].update(_lms_graph_event_id=self.calendar.graph_event_id,
                                 _lms_verified_online_meeting_id='meeting-1')
        metadata = self.artifact('first', 'call-1')
        metadata.pop('transcript_text')
        metadata.pop('transcript_vtt')
        response, writes, saved, ai = self.check([metadata], stored=[prior])
        self.assertEqual(response.status_code, 207, response.content)
        self.assertEqual(writes, [])
        self.assertEqual(saved['artifacts'][0]['transcript_text'], 'first decisions')
        ai.assert_not_called()

    def test_missing_later_recording_listing_keeps_verified_saved_recording(self):
        prior = self.artifact('video-one', 'call-1', kind='recording')
        prior['metadata'].update(_lms_graph_event_id=self.calendar.graph_event_id,
                                 _lms_verified_online_meeting_id='meeting-1')
        response, writes, saved, ai = self.check([], stored=[prior])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(writes, [])
        self.assertEqual([row['graph_artifact_id'] for row in saved['artifacts']], ['video-one'])
        self.assertEqual([row['graph_artifact_id'] for row in json.loads(response.content)['artifacts']],
                         ['video-one'])
        ai.assert_not_called()

    def test_three_checks_keep_one_row_per_provider_artifact(self):
        stored = None
        for _ in range(3):
            response, _writes, saved, ai = self.check([
                self.artifact('first', 'call-1'), self.artifact('second', 'call-2')], stored=stored)
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual({row['graph_artifact_id'] for row in saved['artifacts']}, {'first', 'second'})
            self.assertEqual(len(saved['artifacts']), 2)
            ai.assert_not_called()
            stored = saved['artifacts']

    def test_known_shared_booking_link_blocks_target_resolution(self):
        self.calendar.meeting_link = 'https://teams.microsoft.com/l/meetup-join/synthetic'
        self.calendar.save(update_fields=['meeting_link'])
        CoachCalendarEvent.objects.create(event_key='imported-review:other-synthetic',
            owner_email=OWNER, learner_id=99, event_type='progress-review',
            target_date=date(2026, 10, 26), graph_event_id='other-event',
            meeting_link=self.calendar.meeting_link)
        target = VerifiedMeetingTarget('users/synthetic/onlineMeetings/meeting-1',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'meeting-1', self.calendar.pk,
            self.calendar.graph_event_id, 'fingerprint', self.calendar.meeting_link)
        def strict(_record, *, identity_out):
            identity_out['target'] = target
            return target.base_path, None
        with patch('coach_api.actual_session_resolution.strict_imported_meeting_target', side_effect=strict):
            base, error = review_meeting_target(self.calendar)
        self.assertEqual(base, '')
        self.assertEqual(error['code'], 'MEETING_TARGET_AMBIGUOUS')

    def test_shared_booking_created_during_graph_wait_blocks_publication(self):
        self.calendar.meeting_link = 'https://teams.microsoft.com/l/meetup-join/synthetic'
        self.calendar.save(update_fields=['meeting_link'])
        previous = {'artifacts': [], 'attendanceReports': [], 'attendanceTracker': {},
                    'storage': {'stored': True}, 'partial': False}
        CoachCalendarEvent.objects.create(event_key='imported-review:other-late',
            owner_email=OWNER, learner_id=99, event_type='progress-review',
            target_date=date(2026, 10, 26), graph_event_id='different-event',
            meeting_link=self.calendar.meeting_link)
        with patch.object(views, 'stored_coach_meeting_snapshot', return_value=previous), \
             patch.object(views, 'persist_coach_meeting_snapshots') as persist:
            result = persist_imported_snapshot(self.calendar,
                {'artifacts': [], 'attendanceReports': [], 'attendance': {},
                 'attendanceTracker': {}}, expected_version=snapshot_version(previous),
                context={'overlayId': self.overlay.pk}, meeting_id='meeting-1',
                start_review=False)
        self.assertEqual(result, {'stored': False, 'reason': 'snapshot_context_changed'})
        persist.assert_not_called()

    def test_meeting_writer_never_upserts_metadata_over_saved_transcript_body(self):
        prior = self.artifact('first', 'call-1')
        prior['metadata'].update(_lms_graph_event_id=self.calendar.graph_event_id,
                                 _lms_verified_online_meeting_id='meeting-1')
        incoming = deepcopy(prior)
        incoming.pop('transcript_text')
        incoming.pop('transcript_vtt')
        previous = {'artifacts': [prior], 'attendanceReports': [],
                    'attendanceTracker': {}, 'storage': {'stored': True}, 'partial': False}
        snapshot = {'artifacts': [incoming], 'attendanceReports': [],
                    'attendance': {'expectedAttendees': []}, 'attendanceTracker': {},
                    'errors': [], 'resourceErrors': {}, 'partial': False}
        with patch.object(views, 'stored_coach_meeting_snapshot', return_value=previous), \
             patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': True}) as persist:
            result = persist_imported_snapshot(self.calendar, snapshot,
                expected_version=snapshot_version(previous),
                context={'overlayId': self.overlay.pk}, meeting_id='meeting-1',
                start_review=False)
        self.assertEqual(result['resourceRefresh'], 'partial')
        self.assertEqual(persist.call_args.kwargs['artifacts'], [])

    def test_saved_off_window_preview_uses_verified_meeting_marker(self):
        self.calendar.scheduled_date = date(2026, 10, 26)
        self.calendar.save(update_fields=['scheduled_date'])
        saved = self.artifact('first', 'call-1')
        saved['metadata'].update(_lms_graph_event_id=self.calendar.graph_event_id,
                                 _lms_verified_online_meeting_id='meeting-1')
        self.overlay.meeting_intelligence = {'transcriptStatus': 'available'}
        self.overlay.save(update_fields=['meeting_intelligence'])
        snapshot = {'artifacts': [saved], 'attendanceReports': [],
                    'attendance': {'expectedAttendees': []}, 'storage': {'stored': True}}
        request = RequestFactory().get('/content/?preview=1')
        with patch.object(views, 'authenticated_coach_email', return_value=OWNER), \
             patch.object(views, 'coach_meeting_artifact_record', return_value=self.calendar), \
             patch.object(views, '_imported_review_definition', return_value=self.definition), \
             patch.object(intelligence, '_association', return_value=(self.overlay, self.calendar, self.definition)), \
             patch.object(views, 'stored_coach_meeting_snapshot', return_value=snapshot), \
             patch.object(views, 'stored_coach_meeting_transcript_for_summary',
                          return_value={'artifactId': 'first', 'text': 'Verified early decisions'}), \
             patch.object(views, 'coach_meeting_graph_target') as graph:
            response = unwrap(views.coach_timetable_event_artifact_content)(
                request, self.calendar.event_key, 'transcript', 'combined')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'Verified early decisions', response.content)
        graph.assert_not_called()
