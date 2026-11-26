"""Export the LMS-owned recording contract for downstream checkers. SELECT only."""
import hashlib
import json
from pathlib import Path
import uuid

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.bunny_stream import live_library_id
from curriculum_api.live_recording_migration import PREVIOUS
from curriculum_api.live_recording_routing import uploads_enabled
from curriculum_api.models import CurriculumVideoImport
from curriculum_api.session_results import read


class Command(BaseCommand):
    help = 'Export authoritative LMS source/component identities to a private file; no uploads or mutations.'

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help='New private JSON file, never committed.')
        parser.add_argument('--series-id')
        parser.add_argument('--import-id', action='append', default=[])

    def handle(self, *args, **options):
        assets = CurriculumVideoImport.objects.filter(target_kind='live_session').order_by('id')
        if options['series_id']:
            assets = assets.filter(target_id=options['series_id'])
        if options['import_id']:
            try:
                identities = [str(uuid.UUID(value)) for value in options['import_id']]
            except (ValueError, AttributeError, TypeError):
                raise CommandError('A selected source identity is invalid.') from None
            assets = assets.filter(pk__in=identities)
        records = []
        for asset in assets:
            # Replacements retain the original logical recording identity.
            # They do not create a second canonical source in the contract.
            if asset.scope.get(PREVIOUS):
                continue
            scope = asset.scope
            components = read('''SELECT id,week_id FROM curriculum.components
                WHERE module_catalogue_id=%s AND deleted_at IS NULL AND NOT coalesce(is_programme_deleted,false)
                  AND coalesce(library_state,'')<>'library'
                  AND (settings_json->>'teamsOccurrenceId'=%s OR
                       (settings_json->>'teamsLiveSessionId'=%s AND settings_json->>'teamsSessionNumber'=%s))''',
                [scope.get('module_id'), scope.get('occurrence_id'), asset.target_id, str(scope.get('session_number') or '')])
            saved = read('''SELECT metadata::jsonb->'lmsBunnyRecording' AS playback
                FROM curriculum.live_session_artifacts WHERE id=%s AND occurrence_id=%s AND artifact_type='recording' ''',
                [asset.component_id, scope.get('occurrence_id')])
            playback = saved[0].get('playback') if saved else None
            if isinstance(playback, str):
                try:
                    playback = json.loads(playback)
                except ValueError:
                    playback = None
            playback = playback if isinstance(playback, dict) else {'state': 'not_published'}
            records.append({'recording_identity': scope.get('recording_identity') or asset.fingerprint,
                'lms_import_id': str(asset.pk), 'live_session_id': asset.target_id,
                'occurrence_id': scope.get('occurrence_id'), 'module_id': scope.get('module_id'),
                'microsoft_recording_id': scope.get('graph_artifact_id'),
                'content_correlation_id': scope.get('content_correlation_id') or '', 'call_id': scope.get('call_id') or '',
                'source_content_sha256': scope.get('source_content_sha256') or '',
                'canonical_original_import_id': scope.get('live_source_owner_import_id') or str(asset.pk),
                'component_ids': sorted({row['id'] for row in components}),
                'week_ids': sorted({row['week_id'] for row in components if row.get('week_id')}),
                'journal_status': asset.status,
                'current_playback': {key: playback.get(key, '') for key in ('state', 'libraryId', 'videoId', 'collectionId', 'importId')}})
        payload = {'schema': 'lms.live-recording-sources.v1', 'authority': 'LMS',
            'desired_live_library_id': live_library_id(), 'live_cutover_enabled': uploads_enabled(), 'records': records}
        encoded = json.dumps(payload, sort_keys=True, indent=2)
        try:
            destination = Path(options['output'])
            with destination.open('x', encoding='utf-8') as stream:
                stream.write(encoded + '\n')
            destination.chmod(0o600)
        except OSError:
            raise CommandError('The private source file could not be created; use a new writable path.') from None
        self.stdout.write(json.dumps({'read_only': True, 'records': len(records),
            'schema': payload['schema'], 'sha256': hashlib.sha256(encoded.encode()).hexdigest(),
            'database_writes': 0, 'provider_writes': 0}))
