"""Drain/recover Bunny imports, including Microsoft live-session recordings.

This worker reads recording content from Microsoft; it never creates meetings
or sends mail.
"""
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.db.models import Q
from django.utils import timezone

from curriculum_api.bunny_stream import VideoImportError
from curriculum_api.models import CurriculumVideoImport
from curriculum_api.video_imports import enabled, process, run_pending, target


def run_free_course_pending(course_id, limit):
    """Drain this course's saved imports without touching the shared backlog.

    Authoring saves already enqueue these jobs. Do not call the global source
    change scanner here: it also captures module and live-session work.
    The shared processor's row lease prevents duplicate uploads across workers.
    Failed jobs still require an explicit Save/retry from the author.
    """
    pending = CurriculumVideoImport.objects.filter(
        target_kind='free_course', target_id=course_id,
        status__in=('queued', 'processing', 'uploading'),
    ).filter(Q(lease_until__isnull=True) | Q(lease_until__lte=timezone.now())).order_by('updated_at', 'id')
    ids = list(pending.values_list('id', flat=True)[:limit])
    for import_id in ids:
        process(import_id)
    return len(ids)


class Command(BaseCommand):
    help = 'Detect saved video changes and process Bunny imports. Use --watch for a durable worker.'

    def add_arguments(self, parser):
        parser.add_argument('--watch', action='store_true')
        parser.add_argument('--limit', type=int, default=20)
        parser.add_argument('--free-course-id', help='Process saved imports only for this independent Free Course.')

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError('BUNNY_STREAM_ENABLED must be enabled after migrations 0077 and 0078.')
        course_id = options.get('free_course_id')
        if course_id:
            try:
                target('free_course', course_id)
            except VideoImportError as exc:
                raise CommandError(str(exc)) from None
            self.stdout.write(f'Watching saved video imports for Free Course {course_id}.')
        while True:
            if course_id:
                close_old_connections()
            limit = max(1, min(options['limit'], 100))
            count = run_free_course_pending(course_id, limit) if course_id else run_pending(limit)
            self.stdout.write(f'Checked {count} pending video imports.')
            if not options['watch']:
                break
            time.sleep(15)
