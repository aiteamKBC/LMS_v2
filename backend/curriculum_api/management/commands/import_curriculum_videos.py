"""Explicit, module-scoped backfill. A normal run is an inspection only."""
import json
import uuid
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from curriculum_api.bunny_stream import BunnyStream
from curriculum_api.models import CurriculumVideoImport
from curriculum_api.video_imports import _settings, enabled, enqueue, fingerprint, target, wake_worker
from curriculum_api.video_sources import source_url


class Command(BaseCommand):
    help = 'Inspect one module, or explicitly queue its current video sources for Bunny.'

    def add_arguments(self, parser):
        parser.add_argument('--module-id', required=True)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--adopt-manifest', help='Adopt already uploaded pilot videos after validating their Bunny metadata.')

    def handle(self, *args, **options):
        module_id = options['module_id']
        _, rows, scope = target('module', module_id)
        candidates = [r for r in rows if source_url(_settings(r))]
        self.stdout.write(f'{len(candidates)} video sources; programme={scope["programme_name"]}; cohort={scope["cohort_name"]}; group={scope["group_name"]}')
        if not options['apply']:
            self.stdout.write('Inspection only. No imports queued and no files uploaded.')
            return
        if not enabled():
            raise CommandError('Enable Bunny after applying migration 0077 before queueing imports.')
        adopted = {}
        if options['adopt_manifest']:
            manifest = json.loads(Path(options['adopt_manifest']).read_text(encoding='utf-8'))
            client = BunnyStream()
            collection = client.collection(scope['programme_id'], scope['programme_name'])
            by_id = {r['id']: r for r in candidates}
            # Validate the entire manifest before writing any records. No source
            # URLs/credentials need to be copied into the manifest.
            for component_id, record in manifest.items():
                if not record.get('video_id'):
                    continue
                if component_id not in by_id or str(record.get('library')) != client.library_id:
                    raise CommandError('The pilot manifest does not match this module/library.')
                original = source_url(_settings(by_id[component_id]))
                expected_id = str(uuid.uuid5(uuid.NAMESPACE_URL, module_id + '/' + component_id + '/' + original))
                if record.get('import_id') != expected_id:
                    raise CommandError('A pilot source changed after upload. Inspect it before adopting the video.')
                video = client.video(record['video_id'])
                tags = {tag.get('property'): tag.get('value') for tag in video.get('metaTags') or []}
                if (video.get('collectionId') != collection or tags.get('lms.component_id') != component_id
                        or tags.get('lms.module_catalogue_id', tags.get('lms.module_id')) != module_id
                        or any(tags.get('lms.' + key) != scope.get(key) for key in ('programme_id', 'cohort_id', 'group_id'))):
                    raise CommandError('A pilot video does not match the requested component, module or collection.')
                adopted[component_id] = record
        with transaction.atomic():
            for row in candidates:
                source = source_url(_settings(row))
                if row['id'] in adopted:
                    record = adopted[row['id']]
                    CurriculumVideoImport.objects.get_or_create(
                        fingerprint=fingerprint('module', module_id, row['id'], source, scope),
                        defaults={'id': record['import_id'], 'target_kind': 'module', 'target_id': module_id,
                                  'component_id': row['id'], 'title': row['title'], 'source_url': source,
                                  'source_at_start': source, 'scope': scope, 'library_id': record['library'],
                                  'collection_id': record['collection'], 'video_id': record['video_id'], 'status': 'processing'},
                    )
                else:
                    enqueue('module', module_id, row, scope)
            transaction.on_commit(wake_worker)
        self.stdout.write('Imports queued. Existing LMS playback sources remain unchanged.')
