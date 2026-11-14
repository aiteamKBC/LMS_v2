from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from . import video_changes as changes, video_imports as imports
from .bunny_stream import VideoImportError
from .models import CurriculumVideoChange, CurriculumVideoImport


SCOPE = {'programme_id': 'PROG-PCP-L6', 'programme_name': 'Project Controls Professional Level 6',
         'cohort_id': 'C1', 'group_id': 'G1', 'module_title': 'MSP'}
SOURCE = 'https://example.com/lesson.mp4'


class VideoChangeTests(TestCase):
    def setUp(self):
        self.component = {'id': 'COMP1', 'type': 'video', 'title': 'Example',
                          'settings_json': {'videoUrl': SOURCE}}
        for patcher in (
            patch.object(imports, 'enabled', return_value=True),
            patch.object(imports, 'target', return_value=('components', [self.component], SCOPE)),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def event(self, **overrides):
        return CurriculumVideoChange.objects.create(**{
            'target_kind': 'module', 'target_id': 'MOD1', 'component_id': 'COMP1',
            'settings': {'videoUrl': SOURCE}, 'created_at': timezone.now() - timedelta(seconds=5),
            **overrides,
        })

    def test_external_write_enters_same_scoped_durable_queue(self):
        self.event()
        self.assertEqual(changes.capture_pending(), 1)
        asset = CurriculumVideoImport.objects.get()
        self.assertEqual((asset.target_id, asset.component_id, asset.scope), ('MOD1', 'COMP1', SCOPE))
        self.assertEqual((asset.source_url, asset.status), (SOURCE, 'queued'))
        self.assertFalse(CurriculumVideoChange.objects.exists())
        self.assertEqual(self.component['settings_json']['videoUrl'], SOURCE)

    def test_duplicate_events_and_api_save_share_one_import(self):
        self.event()
        self.event()
        asset = imports.enqueue('module', 'MOD1', self.component, SCOPE)
        requested = asset.requested_at
        changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        asset.refresh_from_db()
        self.assertEqual(asset.requested_at, requested)
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_event_survives_while_disabled(self):
        self.event()
        with patch.object(imports, 'enabled', return_value=False):
            self.assertEqual(changes.capture_pending(), 0)
        self.assertTrue(CurriculumVideoChange.objects.exists())
        self.assertFalse(CurriculumVideoImport.objects.exists())
        changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_replaced_source_is_not_uploaded_from_old_event(self):
        self.event()
        self.component['settings_json']['videoUrl'] = 'https://example.com/new.mp4'
        self.event(settings=self.component['settings_json'])
        changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.get().source_url, 'https://example.com/new.mp4')

    def test_deleted_component_is_acknowledged_without_upload(self):
        self.event()
        with patch.object(imports, 'target', return_value=('components', [], SCOPE)):
            changes.capture_pending()
        self.assertFalse(CurriculumVideoImport.objects.exists())
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_equivalent_embed_edit_does_not_backfill_old_source(self):
        self.event(previous_settings={'embedCode': f'<iframe src="{SOURCE}"></iframe>'})
        changes.capture_pending()
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_already_stored_bunny_source_is_ignored(self):
        self.event(settings={'videoUrl': 'https://iframe.mediadelivery.net/embed/798153/12345678-1234-1234-1234-123456789abc'})
        changes.capture_pending()
        self.assertFalse(CurriculumVideoImport.objects.exists())

    def test_newer_mp4_request_is_not_superseded_by_delayed_link_event(self):
        self.event()
        asset = imports.enqueue('module', 'MOD1', self.component, SCOPE, file_hash='file-hash')
        changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.get().pk, asset.pk)

    def test_queue_failure_is_retryable_without_partial_import_or_secret_logging(self):
        change = self.event()
        def failed_enqueue(*args, **kwargs):
            CurriculumVideoImport.objects.create(fingerprint='partial', title='Synthetic')
            raise RuntimeError('private upstream credential')
        with patch.object(imports, 'enqueue', side_effect=failed_enqueue), self.assertLogs(changes.logger, level='WARNING') as logs:
            changes.capture_pending()
        change.refresh_from_db()
        self.assertEqual(change.attempts, 1)
        self.assertGreater(change.available_at, timezone.now())
        self.assertNotIn('credential', change.error + ''.join(logs.output))
        self.assertFalse(CurriculumVideoImport.objects.exists())
        change.available_at = timezone.now()
        change.save()
        changes.capture_pending()
        self.assertTrue(CurriculumVideoImport.objects.exists())

    def test_missing_parent_keeps_event_and_does_not_starve_others(self):
        change = self.event(target_id='NOT-YET-SAVED')
        self.event()
        def target(kind, target_id):
            if target_id == 'NOT-YET-SAVED':
                raise VideoImportError('Save the module first.')
            return 'components', [self.component], SCOPE
        with patch.object(imports, 'target', side_effect=target):
            self.assertEqual(changes.capture_pending(limit=2), 2)
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)
        self.assertEqual(CurriculumVideoChange.objects.get().pk, change.pk)

    def test_existing_worker_detects_events_before_processing_uploads(self):
        self.event()
        with patch.object(imports, 'process') as process:
            self.assertEqual(imports.run_pending(), 1)
        process.assert_called_once_with(CurriculumVideoImport.objects.get().pk)

    def test_programme_assigned_after_content_save_is_retried(self):
        change = self.event()
        with patch.object(imports, 'target', return_value=('components', [self.component], {})):
            changes.capture_pending()
        self.assertFalse(CurriculumVideoImport.objects.exists())
        change.refresh_from_db()
        self.assertIn('programme', change.error)
        change.available_at = timezone.now()
        change.save()
        changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.get().scope['programme_id'], 'PROG-PCP-L6')

    def test_empty_queue_does_not_scan_or_backfill_existing_components(self):
        with patch.object(imports, 'target') as target:
            self.assertEqual(changes.capture_pending(), 0)
        target.assert_not_called()

    def test_free_course_is_queued_without_programme_cohort_or_group(self):
        self.event()
        scope = {'module_id': 'MOD1', 'free_course_module_id': 'MOD1', 'free_course_name': 'Independent study'}
        with patch.object(imports, 'target', return_value=('components', [self.component], scope)):
            changes.capture_pending()
        self.assertEqual(CurriculumVideoImport.objects.get().scope, scope)
        self.assertFalse(CurriculumVideoChange.objects.exists())

    def test_unnamed_free_course_keeps_event_for_retry(self):
        change = self.event()
        scope = {'free_course_module_id': 'MOD1', 'free_course_name': '   '}
        with patch.object(imports, 'target', return_value=('components', [self.component], scope)):
            changes.capture_pending()
        change.refresh_from_db()
        self.assertIn('name for this free course', change.error)
        self.assertFalse(CurriculumVideoImport.objects.exists())
