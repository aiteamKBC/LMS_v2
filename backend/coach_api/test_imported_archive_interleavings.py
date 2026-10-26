"""Controlled command/provider interleavings, not PostgreSQL concurrency proof."""
from contextlib import contextmanager, nullcontext
from copy import deepcopy
from datetime import date
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, override_settings

from . import recording_archive as archive, test_imported_recording_archive as fixtures
from .management.commands.archive_meeting_recordings import Command
from .review_sources import ReviewIdentityConflict


@override_settings(TIME_ZONE='UTC')
class ImportedArchiveInterleavingTests(SimpleTestCase):
    mock = fixtures.ImportedRecordingArchiveTests.mock
    row = fixtures.ImportedRecordingArchiveTests.row
    pending = fixtures.ImportedRecordingArchiveTests.pending

    def setUp(self):
        fixtures.ImportedRecordingArchiveTests.setUp(self)
        self.record.pk = 1
        self.records.using.return_value.select_for_update.return_value.get.side_effect = lambda **kw: deepcopy(self.record)
        self.row(error='')
        self.blobs, self.before_upload_return, self.before_update = {}, None, None
        self.download = self.mock('coach_api.management.commands.archive_meeting_recordings.download_recording_from_graph',
                                  return_value=(b'synthetic-video', 'video/mp4', ''))
        self.target = self.mock('coach_api.views.coach_meeting_graph_target', return_value=('synthetic-target', None))
        self.strict = self.mock('coach_api.actual_session_resolution.review_meeting_target',
                                side_effect=self.verified_target)
        self.mock('coach_api.recording_archive.archive_configured', return_value=True)
        self.mock('coach_api.management.commands.archive_meeting_recordings.archive_configured', return_value=True)
        self.mock('coach_api.management.commands.archive_meeting_recordings.blob_columns_ready', return_value=True)
        self.mock('coach_api.recording_archive.recordings_container', return_value='private-synthetic')
        self.mock('coach_api.management.commands.archive_meeting_recordings.recordings_container', return_value='private-synthetic')
        self.mock('coach_api.recording_archive.router.db_for_read', return_value='archive-test')
        self.mock('coach_api.recording_archive.router.db_for_write', return_value='archive-test')
        self.mock('django.db.transaction.atomic', side_effect=lambda **kw: nullcontext())
        self.upload = self.mock('coach_api.recording_archive.upload_blob', side_effect=self.upload_blob)
        self.delete = self.mock('coach_api.recording_archive.delete_blob', side_effect=lambda c, n: self.blobs.pop((c, n), None))
        self.mock('coach_api.recording_archive.blob_exists', side_effect=lambda c, n: (c, n) in self.blobs)
        self.transcripts = self.mock('coach_api.management.commands.archive_meeting_recordings.Command._archive_transcripts')
        self.lectures = self.mock('coach_api.management.commands.archive_meeting_recordings.Command._archive_live_sessions')

    def verified_target(self, record, *, identity_out):
        identity_out['target'] = SimpleNamespace(base_path='verified-target',
                                                  online_meeting_id='verified-meeting')
        return 'verified-target', None

    @contextmanager
    def cursor(self):
        raw = self.db.cursor()
        cursor = fixtures.Cursor(raw)
        execute = cursor.execute
        def run(sql, params):
            if 'update ' in sql.lower() and 'blob_container' in sql.lower() and self.before_update:
                hook, self.before_update = self.before_update, None
                hook(sql, params, execute)
            else:
                execute(sql, params)
        cursor.execute = run
        try:
            yield cursor
        finally:
            raw.close()

    def upload_blob(self, stream, container, name, *args, **kwargs):
        self.blobs[container, name] = stream.read()
        if self.before_upload_return:
            hook, self.before_upload_return = self.before_upload_return, None
            hook()

    def run_command(self, **options):
        command = Command(stdout=StringIO(), stderr=StringIO())
        command.handle(**{'limit': 25, 'event_key': '', 'dry_run': False, **options})
        return command.stdout._out.getvalue() + command.stderr._out.getvalue()

    def saved(self):
        return archive.stored_recording_blob(self.record.event_key, 'recording-1', 'archive-test')

    def assert_playable_reference(self, expected=None):
        stored = self.saved()
        self.assertIsNotNone(stored)
        self.assertIn((stored['container'], stored['blob_name']), self.blobs)
        if expected is not None:
            self.assertEqual(stored, expected)
        return stored

    def test_older_upload_failure_cannot_clear_newer_success(self):
        winner = []
        def other_worker_then_failure():
            self.run_command()
            winner.append(self.saved())
            raise RuntimeError('synthetic older upload failure')
        self.before_upload_return = other_worker_then_failure
        self.run_command()
        self.assert_playable_reference(winner[0])
        self.delete.assert_not_called()

    def test_newer_failure_does_not_prevent_older_success(self):
        def failed_worker():
            with patch.object(archive, 'upload_blob', side_effect=RuntimeError('synthetic failure')):
                self.run_command()
        self.before_upload_return = failed_worker
        self.run_command()
        self.assert_playable_reference()

    def test_two_successes_preserve_first_committed_reference_and_do_not_overwrite_bytes(self):
        winner = []
        def other_worker():
            self.run_command()
            winner.append(self.saved())
        self.before_upload_return = other_worker
        self.run_command()
        self.assert_playable_reference(winner[0])
        self.assertEqual(len(self.blobs), 2)  # Private attempts; only one published artifact.
        self.delete.assert_not_called()

    def test_database_failure_does_not_delete_a_blob_used_by_successful_worker(self):
        winner = []
        def completed_worker():
            self.run_command()
            winner.append(self.saved())
            self.before_update = lambda *args: (_ for _ in ()).throw(DatabaseError('synthetic persistence failure'))
        self.before_upload_return = completed_worker
        self.run_command()
        self.assert_playable_reference(winner[0])
        self.delete.assert_not_called()

    def test_upload_success_database_failure_leaves_unreferenced_bytes_for_safe_retry(self):
        self.before_update = lambda *args: (_ for _ in ()).throw(DatabaseError('synthetic failure'))
        self.run_command()
        self.assertIsNone(self.saved())
        self.assertEqual(len(self.blobs), 1)
        self.delete.assert_not_called()
        self.run_command()
        self.assert_playable_reference()

    def test_ambiguous_commit_failure_never_deletes_potentially_committed_blob(self):
        def commit_then_connection_error(sql, params, execute):
            execute(sql, params)
            raise DatabaseError('synthetic lost commit acknowledgement')
        self.before_update = commit_then_connection_error
        self.run_command()
        self.assert_playable_reference()
        self.delete.assert_not_called()

    def test_retry_after_success_does_no_provider_work(self):
        self.run_command()
        stored = self.assert_playable_reference()
        self.download.reset_mock()
        self.upload.reset_mock()
        self.run_command()
        self.assert_playable_reference(stored)
        self.download.assert_not_called()
        self.upload.assert_not_called()

    def test_imported_download_uses_verified_target_not_generic_first_result(self):
        self.run_command()
        self.assert_playable_reference()
        self.download.assert_called_once_with('verified-target', 'recording-1')
        self.target.assert_not_called()

    def test_ambiguous_imported_target_fails_before_download_or_upload(self):
        self.strict.side_effect = lambda record, *, identity_out: ('', {'code': 'MEETING_TARGET_AMBIGUOUS'})
        self.run_command()
        self.assertIsNone(self.saved())
        self.download.assert_not_called()
        self.upload.assert_not_called()
        self.target.assert_not_called()

    def test_stored_meeting_marker_must_match_verified_download_meeting(self):
        self.snapshot = {**self.snapshot, 'artifacts': [{**self.artifact, 'metadata': {
            'meetingId': 'stored-other-meeting',
            '_lms_graph_event_id': self.record.graph_event_id,
            '_lms_verified_online_meeting_id': 'stored-other-meeting'}}]}
        self.run_command()
        self.assertIsNone(self.saved())
        self.download.assert_not_called()
        self.upload.assert_not_called()

    def test_changed_verified_target_after_download_is_not_published(self):
        calls = 0
        def changed(record, *, identity_out):
            nonlocal calls
            calls += 1
            identity_out['target'] = SimpleNamespace(base_path='verified-target',
                online_meeting_id='verified-meeting' if calls == 1 else 'other-meeting')
            return 'verified-target', None
        self.strict.side_effect = changed
        self.run_command()
        self.assertIsNone(self.saved())
        self.upload.assert_not_called()

    def test_preselected_stale_candidate_keeps_committed_reference_without_graph(self):
        selected = self.pending()
        self.run_command()
        winner = self.assert_playable_reference()
        self.target.reset_mock()
        with patch('coach_api.management.commands.archive_meeting_recordings.pending_recordings', return_value=selected):
            self.run_command()
        self.assert_playable_reference(winner)
        self.target.assert_not_called()

    def test_metadata_refresh_during_upload_does_not_lose_metadata_or_archive(self):
        self.before_upload_return = lambda: self.db.execute(
            "UPDATE Coach.coach_meeting_artifacts SET metadata = ?", ['{"refreshed": true}'])
        self.run_command()
        self.assert_playable_reference()
        self.assertEqual(self.db.execute('SELECT metadata FROM Coach.coach_meeting_artifacts').fetchone()[0], '{"refreshed": true}')

    def test_changed_owner_organizer_booking_or_source_after_download_never_uploads(self):
        for field, value in [('owner_email', 'new@example.invalid'), ('graph_organizer_email', 'other@example.invalid'),
                             ('scheduled_date', date(2026, 10, 25)), ('graph_event_id', 'changed-event')]:
            original = getattr(self.record, field)
            with self.subTest(field=field):
                self.download.side_effect = lambda *a: (setattr(self.record, field, value) or b'bytes', 'video/mp4', '')
                self.run_command()
                self.assertIsNone(self.saved())
                self.upload.assert_not_called()
                setattr(self.record, field, original)
        self.download.side_effect = None

    def test_context_change_during_upload_cannot_publish_archive(self):
        def change():
            self.record.owner_email = 'other@example.invalid'
        self.before_upload_return = change
        self.run_command()
        self.assertIsNone(self.saved())
        self.delete.assert_not_called()

    def test_source_revalidation_failure_during_upload_cannot_publish_archive(self):
        self.before_upload_return = lambda: setattr(self.context, 'side_effect', ReviewIdentityConflict('synthetic source change'))
        self.run_command()
        self.assertIsNone(self.saved())
        self.delete.assert_not_called()

    def test_wrong_saved_provenance_is_refused_before_graph(self):
        self.db.execute("UPDATE Coach.coach_meeting_artifacts SET graph_event_id = 'other-event'")
        self.run_command()
        self.target.assert_not_called()
        self.download.assert_not_called()
        self.upload.assert_not_called()

    def test_unavailable_or_ambiguous_stored_recording_is_refused_before_graph(self):
        for changes in [{'artifacts': []}, {'partial': True},
                        {'artifacts': [self.artifact, {**self.artifact, 'call_id': 'other-call'}]}]:
            with self.subTest(changes=changes):
                old = self.snapshot
                self.snapshot = {**old, **changes}
                self.run_command()
                self.target.assert_not_called()
                self.snapshot = old

    def test_interruption_after_upload_does_not_delete_or_overwrite_attempt_on_retry(self):
        class Interrupted(BaseException):
            pass
        self.before_upload_return = lambda: (_ for _ in ()).throw(Interrupted())
        with self.assertRaises(Interrupted):
            self.run_command()
        self.assertIsNone(self.saved())
        first = set(self.blobs)
        self.run_command()
        self.assert_playable_reference()
        self.assertEqual(len(self.blobs), 2)
        self.assertTrue(first < set(self.blobs))
        self.delete.assert_not_called()

    def test_event_scoped_imported_selection_precedes_global_limit(self):
        self.db.execute("UPDATE Coach.coach_meeting_artifacts SET blob_upload_error = 'retry'")
        self.row(key='unrelated', error='', created_datetime='2026-10-25T10:00:00Z')
        self.run_command(event_key=self.record.event_key, limit=1)
        self.assert_playable_reference()
        self.assertEqual(self.db.execute("SELECT blob_name FROM Coach.coach_meeting_artifacts WHERE event_key='unrelated'").fetchone()[0], '')

    def test_scoped_imported_command_never_drains_unrelated_transcripts_or_lectures(self):
        self.run_command(event_key=self.record.event_key)
        self.transcripts.assert_not_called()
        self.lectures.assert_not_called()

    def test_missing_explicit_calendar_does_not_run_unrelated_work(self):
        self.records.using.return_value.filter.return_value.first.return_value = None
        self.run_command(event_key='imported-review:missing')
        self.target.assert_not_called()
        self.transcripts.assert_not_called()
        self.lectures.assert_not_called()

    def test_imported_dry_run_does_no_provider_or_write_work(self):
        before = self.db.execute('SELECT * FROM Coach.coach_meeting_artifacts').fetchall()
        self.run_command(event_key=self.record.event_key, dry_run=True)
        self.target.assert_not_called()
        self.upload.assert_not_called()
        self.delete.assert_not_called()
        self.assertEqual(self.db.execute('SELECT * FROM Coach.coach_meeting_artifacts').fetchall(), before)

    def test_conditional_publication_preserves_a_reference_committed_before_sql_update(self):
        def publish_winner(sql, params, execute):
            self.blobs['private-synthetic', 'winner.mp4'] = b'winner'
            self.db.execute("UPDATE Coach.coach_meeting_artifacts SET blob_container='private-synthetic', blob_name='winner.mp4'")
            execute(sql, params)
        self.before_update = publish_winner
        self.run_command()
        self.assertEqual(self.assert_playable_reference()['blob_name'], 'winner.mp4')
        self.delete.assert_not_called()

    def test_provider_work_is_outside_calendar_and_overlay_locks(self):
        self.context.return_value = {**self.context.return_value, 'overlayId': 3}
        depth, events = 0, []
        @contextmanager
        def atomic(**kw):
            nonlocal depth
            self.assertEqual(kw['using'], 'archive-test')
            depth += 1
            try:
                yield
            finally:
                depth -= 1
        def calendar_lock(**kw):
            self.assertGreater(depth, 0)
            events.append('calendar')
            return deepcopy(self.record)
        def overlay_lock(**kw):
            self.assertGreater(depth, 0)
            self.assertEqual(events[-1], 'calendar')
            self.assertEqual(kw['pk'], 3)
            events.append('overlay')
        def upload(*args, **kw):
            self.assertEqual(depth, 0)
            return self.upload_blob(*args, **kw)
        with patch('django.db.transaction.atomic', side_effect=atomic), \
             patch('coach_api.models.ImportedReviewInstance.objects') as overlays:
            overlays.using.return_value.select_for_update.return_value.get.side_effect = overlay_lock
            self.records.using.return_value.select_for_update.return_value.get.side_effect = calendar_lock
            self.upload.side_effect = upload
            self.run_command()
            overlays.using.assert_called_with('archive-test')
        self.assert_playable_reference()
        self.assertEqual(events, ['calendar', 'overlay'] * 3)

    def test_completed_and_signed_reviews_are_resource_only(self):
        for family in ('MCM', 'PR', 'PR_SKILLS_RADAR', 'PSP'):
            for status in ('awaiting-signature', 'completed'):
                with self.subTest(family=family, status=status):
                    self.db.execute("UPDATE Coach.coach_meeting_artifacts SET blob_name='',blob_upload_error=''")
                    self.context.return_value = {'family': family, 'status': status, 'completed': status == 'completed'}
                    self.run_command()
                    self.assert_playable_reference()
        self.records.update.assert_not_called()

    def test_native_command_keeps_legacy_upload_path_and_unscoped_auxiliary_passes(self):
        self.record.event_key = 'progress-review:native-synthetic'
        self.db.execute('UPDATE Coach.coach_meeting_artifacts SET event_key=?', [self.record.event_key])
        self.context.return_value = None
        self.run_command()
        self.assert_playable_reference()
        self.assertEqual(self.saved()['blob_name'], archive.build_blob_name(self.record.event_key, 'recording-1', 'video/mp4'))
        self.strict.assert_not_called()
        self.transcripts.assert_called_once()
        self.lectures.assert_called_once()

    def test_psp_keeps_its_existing_generic_download_target(self):
        self.context.return_value = {'family': 'PSP', 'status': 'scheduled', 'completed': False}
        self.run_command()
        self.assert_playable_reference()
        self.download.assert_called_once_with('synthetic-target', 'recording-1')
        self.target.assert_called_once_with(self.record)
        self.strict.assert_not_called()
