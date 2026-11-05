"""Archive eligibility with real selection SQL on synthetic SQLite rows.

Graph/Azure and imported source reads are explicit doubles. This is not
PostgreSQL locking, deployed schema, provider or playable-byte acceptance.
"""
from contextlib import contextmanager
from datetime import date, time
from io import StringIO
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import recording_archive as archive
from .management.commands.archive_meeting_recordings import Command
from .review_sources import ReviewIdentityConflict


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql, params):
        return self.cursor.execute(sql.replace('%s', '?').replace('::jsonb', ''), params)

    def __getattr__(self, name):
        return getattr(self.cursor, name)


@override_settings(TIME_ZONE='UTC')
class ImportedRecordingArchiveTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS Coach")
        self.db.execute('''CREATE TABLE Coach.coach_meeting_artifacts (
            event_key text, graph_artifact_id text, owner_email text,
            graph_organizer_email text, graph_event_id text, artifact_type text,
            created_datetime text, blob_name text, blob_container text,
            blob_size_bytes integer, blob_content_type text, blob_uploaded_at text,
            blob_upload_error text, updated_at text, calendar_event_id integer,
            call_id text, content_correlation_id text, end_datetime text,
            metadata text, last_seen_at text,
            UNIQUE(event_key, artifact_type, graph_artifact_id))''')
        self.db.execute('''CREATE TABLE Coach.coach_meeting_attendance (
            event_key text, is_current boolean, updated_at text)''')
        self.record = SimpleNamespace(event_key='imported-review:synthetic',
            owner_email='coach@example.invalid', graph_organizer_email='organizer@example.invalid',
            graph_event_id='graph-synthetic', scheduled_date=date(2026, 10, 24),
            scheduled_time=time(10), duration_minutes=60)
        self.artifact = {'artifact_type': 'recording', 'graph_artifact_id': 'recording-1',
            'created_datetime': '2026-10-24T10:05:00Z', 'end_datetime': '2026-10-24T10:55:00Z',
            'call_id': 'call-1'}
        self.snapshot = {'artifacts': [self.artifact], 'attendanceReports': [],
                         'storage': {'stored': True}, 'partial': False, 'errors': []}
        self.mock('coach_api.recording_archive.connections', {'archive-test': self})
        self.mock('coach_api.recording_archive.blob_columns_ready', return_value=True)
        self.records = self.mock('coach_api.models.CoachCalendarEvent.objects')
        self.records.using.return_value.filter.return_value.first.return_value = self.record
        self.records.filter.return_value.first.return_value = self.record
        self.context = self.mock('coach_api.background_meeting_sync.imported_context',
                                 return_value={'family': 'PR', 'completed': True})
        self.stored = self.mock('coach_api.views.stored_coach_meeting_snapshot',
                                side_effect=lambda *a, **kw: self.snapshot)

    def mock(self, name, *args, **kwargs):
        p = patch(name, *args, **kwargs)
        result = p.start()
        self.addCleanup(p.stop)
        return result

    @contextmanager
    def cursor(self):
        cursor = self.db.cursor()
        try:
            yield Cursor(cursor)
        finally:
            cursor.close()

    def row(self, *, key=None, error='temporary upload failure', blob='', **changes):
        values = dict(event_key=key or self.record.event_key, graph_artifact_id='recording-1',
            owner_email=self.record.owner_email, graph_organizer_email=self.record.graph_organizer_email,
            graph_event_id=self.record.graph_event_id, artifact_type='recording',
            created_datetime='2026-10-24T10:05:00Z', blob_name=blob, blob_upload_error=error)
        values.update(changes)
        self.db.execute(f'INSERT INTO Coach.coach_meeting_artifacts ({",".join(values)}) VALUES ({",".join("?" for _ in values)})', list(values.values()))

    def pending(self, limit=25):
        return archive.pending_recordings('archive-test', limit=limit)

    def test_failed_imported_upload_remains_retryable_for_all_supported_families_and_stages(self):
        self.row()
        for family in ('MCM', 'PR', 'PR_SKILLS_RADAR', 'PSP'):
            for stage in ('scheduled', 'in-progress', 'awaiting-signature', 'completed'):
                with self.subTest(family=family, stage=stage):
                    self.context.return_value = {'family': family, 'status': stage, 'completed': stage == 'completed'}
                    self.assertEqual([r['event_key'] for r in self.pending()], [self.record.event_key])

    def test_upload_failure_then_later_success_persists_reference_and_stops_retry(self):
        self.row(error='')
        with patch.object(archive, 'archive_configured', return_value=True), \
             patch.object(archive, 'recordings_container', return_value='synthetic-private'), \
             patch.object(archive, 'upload_blob', side_effect=[RuntimeError('synthetic failure'), None]):
            failed = archive.archive_recording(self.record.event_key, 'recording-1', b'fake-video', database='archive-test')
            self.assertFalse(failed['archived'])
            self.assertEqual(len(self.pending()), 1)
            success = archive.archive_recording(self.record.event_key, 'recording-1', b'fake-video', database='archive-test')
        self.assertTrue(success['archived'])
        stored = archive.stored_recording_blob(self.record.event_key, 'recording-1', 'archive-test')
        self.assertEqual(stored['container'], 'synthetic-private')
        self.assertEqual(stored['size_bytes'], 10)
        self.assertEqual(self.pending(), [])

    def test_native_failed_upload_is_not_newly_eligible(self):
        self.row(key='progress-review:native:1')
        self.context.return_value = None
        self.assertEqual(self.pending(), [])

    def test_existing_fresh_candidates_keep_priority_and_pass_limit(self):
        self.row(key='native-fresh', error='')
        self.row()
        self.assertEqual([r['event_key'] for r in self.pending(limit=1)], ['native-fresh'])
        self.context.assert_not_called()
        self.assertEqual([r['event_key'] for r in self.pending(limit=2)], ['native-fresh', self.record.event_key])

    def test_archived_rows_and_transcripts_are_not_retry_candidates(self):
        self.row(blob='already-saved')
        self.row(artifact_type='transcript')
        self.assertEqual(self.pending(), [])

    def test_unverified_source_or_missing_calendar_fails_closed(self):
        self.row()
        self.records.using.return_value.filter.return_value.first.return_value = None
        self.assertEqual(self.pending(), [])
        self.records.using.return_value.filter.return_value.first.return_value = self.record
        self.context.side_effect = ReviewIdentityConflict('synthetic conflict')
        self.assertEqual(self.pending(), [])

    def test_old_owner_organizer_or_graph_event_is_not_retried(self):
        for field in ('owner_email', 'graph_organizer_email', 'graph_event_id'):
            with self.subTest(field=field):
                self.db.execute('DELETE FROM Coach.coach_meeting_artifacts')
                self.row(**{field: 'other'})
                self.assertEqual(self.pending(), [])

    def test_reschedule_ambiguous_or_unavailable_stored_evidence_is_not_retried(self):
        self.row()
        for change in ({'partial': True}, {'storage': {'stored': False}},
                       {'artifacts': []}, {'artifacts': [{**self.artifact, 'created_datetime': '2025-01-01T10:00:00Z', 'end_datetime': '2025-01-01T11:00:00Z'}]},
                       {'artifacts': [self.artifact, {**self.artifact, 'call_id': 'other-call'}]}):
            with self.subTest(change=change):
                old = self.snapshot
                self.snapshot = {**old, **change}
                self.assertEqual(self.pending(), [])
                self.snapshot = old

    def test_claimed_off_window_recording_can_retry_and_other_call_cannot(self):
        from .imported_recording_archive import prepare_archive
        from .migrated_session_scope import SessionContext

        self.record.pk = 51
        self.artifact = {**self.artifact, 'created_datetime': '2026-10-28T10:00:00Z',
                         'end_datetime': '2026-10-28T10:30:00Z'}
        self.snapshot = {**self.snapshot, 'artifacts': [self.artifact,
            {**self.artifact, 'graph_artifact_id': 'other-video', 'call_id': 'other-call'}]}
        self.row()
        self.row(graph_artifact_id='other-video')
        self.context.return_value = {'family': 'PR', 'overlayId': 9, 'completed': False}
        with patch('coach_api.models.ImportedReviewInstance.objects') as overlays, \
             patch('coach_api.bound_actual_session.bound_session', return_value=SimpleNamespace(
                 context=SessionContext('call-1', 'report-1', 'meeting-1', 1))):
            overlays.using.return_value.filter.return_value.first.return_value = SimpleNamespace(pk=9)
            eligible = self.pending()
            self.assertEqual([row['graph_artifact_id'] for row in eligible], ['recording-1'])
            attempt = prepare_archive(self.record, eligible[0], 'archive-test')
            self.assertEqual(attempt.context['boundSelectionVersion'], 1)
            self.assertEqual(attempt.context['boundCallId'], 'call-1')
            with self.assertRaises(ReviewIdentityConflict):
                prepare_archive(self.record, {**eligible[0],
                    'graph_artifact_id': 'other-video'}, 'archive-test')

    def test_command_skips_already_archived_and_graph_failure_never_uploads(self):
        # Characterize the unchanged generic command branch. Imported command
        # publication/revalidation is exercised in test_imported_archive_interleavings.
        self.context.return_value = None
        self.row(error='')
        rows = self.pending()
        command = Command(stdout=StringIO(), stderr=StringIO())
        module = 'coach_api.management.commands.archive_meeting_recordings'
        with patch(f'{module}.archive_configured', return_value=True), \
             patch(f'{module}.blob_columns_ready', return_value=True), \
             patch(f'{module}.pending_recordings', return_value=rows), \
             patch(f'{module}.recordings_container', return_value='synthetic'), \
             patch(f'{module}.recording_is_archived', return_value=True) as archived, \
             patch('coach_api.views.coach_meeting_graph_target', return_value=('synthetic-target', None)) as target, \
             patch(f'{module}.download_recording_from_graph', return_value=(b'', '', 'Graph unavailable')) as download, \
             patch(f'{module}.archive_recording') as upload, \
             patch.object(command, '_archive_transcripts'), patch.object(command, '_archive_live_sessions'):
            command.handle(limit=25, event_key='', dry_run=False)
            target.assert_not_called()
            archived.return_value = False
            command.handle(limit=25, event_key='', dry_run=False)
            download.assert_called_once()
            upload.assert_not_called()
        self.assertEqual(len(self.pending()), 1)

    def test_missing_archive_configuration_or_signing_failure_is_unavailable(self):
        self.row(blob='saved')
        with patch.object(archive, 'archive_configured', return_value=False), \
             patch.object(archive, 'get_read_sas') as sign:
            self.assertEqual(archive.archived_recording_url(self.record.event_key, 'recording-1', 'archive-test'), '')
            sign.assert_not_called()
        with patch.object(archive, 'archive_configured', return_value=True), \
             patch.object(archive, 'get_read_sas', side_effect=RuntimeError('synthetic signing failure')):
            self.assertEqual(archive.archived_recording_url(self.record.event_key, 'recording-1', 'archive-test'), '')

    def test_metadata_refresh_preserves_existing_archive_reference(self):
        from . import views
        self.row(blob='saved', blob_container='synthetic-private', blob_size_bytes=10, error='')
        before = archive.stored_recording_blob(self.record.event_key, 'recording-1', 'archive-test')
        self.record.event_type, self.record.learner_name, self.record.learner_email = 'progress-review', 'Synthetic', 'synthetic@example.invalid'
        with patch.object(views, 'connections', {'archive-test': self}), \
             patch.object(views.transaction, 'atomic', return_value=self.db), \
             patch.object(views.router, 'db_for_write', return_value='archive-test'), \
             patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
             patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=False):
            result = views.persist_coach_meeting_snapshots(self.record, artifacts=[self.artifact],
                attendance_reports=[], attendance_tracker={})
        self.assertTrue(result['stored'])
        self.assertEqual(archive.stored_recording_blob(self.record.event_key, 'recording-1', 'archive-test'), before)

    def test_stored_archive_drives_imported_availability_and_protected_redirect(self):
        import json
        from learner_api.imported_meeting_resources import stored_resources, stored_recording
        self.row(blob='saved', blob_container='synthetic-private')
        with patch.object(archive.router, 'db_for_read', return_value='archive-test'), \
             patch.object(archive, 'archive_configured', return_value=True), \
             patch.object(archive, 'get_read_sas', return_value='https://synthetic.invalid/private'):
            response = stored_resources(self.record, include_attendance=False)
            self.assertTrue(json.loads(response.content)['artifacts'][0]['content_available'])
            self.assertNotIn(b'https://synthetic.invalid/private', response.content)
            playback = stored_recording(RequestFactory().get('/content/'), self.record, 'recording-1')
            self.assertEqual(playback.status_code, 302)
            self.assertEqual(playback['Location'], 'https://synthetic.invalid/private')
            self.assertEqual(stored_recording(RequestFactory().get('/content/'), self.record, 'different-recording').status_code, 404)
