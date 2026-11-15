"""Queue isolation using in-memory import tables; remote processing is mocked."""
import io
from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone

from .bunny_stream import VideoImportError
from .management.commands import process_curriculum_videos as worker
from .models import CurriculumVideoImport


class FreeCourseVideoWorkerTests(TestCase):
    def asset(self, kind='free_course', course='COURSE-1', **fields):
        return CurriculumVideoImport.objects.create(
            target_kind=kind, target_id=course, component_id='COMPONENT-1',
            fingerprint=f'{kind}-{course}-{CurriculumVideoImport.objects.count()}',
            title='Synthetic video', source_url='https://example.test/video.mp4', **fields,
        )

    def test_processes_only_the_selected_free_course(self):
        wanted = self.asset()
        self.asset(course='COURSE-2')
        for kind in ('module', 'template', 'live_session'):
            self.asset(kind=kind)
        with patch.object(worker, 'process') as process:
            self.assertEqual(worker.run_free_course_pending('COURSE-1', 20), 1)
        process.assert_called_once_with(wanted.pk)

    def test_respects_active_leases_and_recovers_expired_jobs(self):
        self.asset(status='uploading', lease_until=timezone.now() + timedelta(minutes=5))
        expired = self.asset(status='uploading', lease_until=timezone.now() - timedelta(seconds=1))
        encoding = self.asset(status='processing')
        with patch.object(worker, 'process') as process:
            self.assertEqual(worker.run_free_course_pending('COURSE-1', 20), 2)
        self.assertEqual([call.args[0] for call in process.call_args_list], [expired.pk, encoding.pk])

    def test_does_not_restart_failed_or_finished_imports(self):
        for status in ('failed', 'ready', 'superseded'):
            self.asset(status=status)
        with patch.object(worker, 'process') as process:
            self.assertEqual(worker.run_free_course_pending('COURSE-1', 20), 0)
        process.assert_not_called()

    def test_obeys_batch_limit(self):
        oldest = self.asset()
        self.asset()
        with patch.object(worker, 'process') as process:
            self.assertEqual(worker.run_free_course_pending('COURSE-1', 1), 1)
        process.assert_called_once_with(oldest.pk)

    def test_scoped_command_never_calls_global_queue(self):
        with patch.object(worker, 'enabled', return_value=True), \
             patch.object(worker, 'target') as target, \
             patch.object(worker, 'run_free_course_pending', return_value=0) as scoped, \
             patch.object(worker, 'run_pending') as global_queue:
            call_command('process_curriculum_videos', '--free-course-id', 'COURSE-1', '--limit', '2', stdout=io.StringIO())
        target.assert_called_once_with('free_course', 'COURSE-1')
        scoped.assert_called_once_with('COURSE-1', 2)
        global_queue.assert_not_called()

    def test_default_command_retains_existing_queue(self):
        with patch.object(worker, 'enabled', return_value=True), \
             patch.object(worker, 'run_free_course_pending') as scoped, \
             patch.object(worker, 'run_pending', return_value=0) as global_queue:
            call_command('process_curriculum_videos', stdout=io.StringIO())
        global_queue.assert_called_once_with(20)
        scoped.assert_not_called()

    def test_disabled_or_missing_course_does_not_process(self):
        with patch.object(worker, 'run_free_course_pending') as scoped:
            with patch.object(worker, 'enabled', return_value=False), self.assertRaises(CommandError):
                call_command('process_curriculum_videos', free_course_id='COURSE-1', stdout=io.StringIO())
            with patch.object(worker, 'enabled', return_value=True), \
                 patch.object(worker, 'target', side_effect=VideoImportError('Free Course unavailable.')), \
                 self.assertRaisesMessage(CommandError, 'Free Course unavailable.'):
                call_command('process_curriculum_videos', free_course_id='COURSE-1', stdout=io.StringIO())
        scoped.assert_not_called()

    def test_watch_polls_same_scope_until_stopped(self):
        with patch.object(worker, 'enabled', return_value=True), \
             patch.object(worker, 'target'), \
             patch.object(worker, 'run_free_course_pending', return_value=0) as scoped, \
             patch.object(worker, 'run_pending') as global_queue, \
             patch.object(worker.time, 'sleep', side_effect=[None, KeyboardInterrupt]), \
             self.assertRaises(KeyboardInterrupt):
            call_command('process_curriculum_videos', free_course_id='COURSE-1', watch=True, stdout=io.StringIO())
        self.assertEqual(scoped.call_count, 2)
        self.assertTrue(all(call.args == ('COURSE-1', 20) for call in scoped.call_args_list))
        global_queue.assert_not_called()
