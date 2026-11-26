"""Plan historical recording adoption; queue approved jobs for the AWS worker."""
from collections import Counter
import json
from pathlib import Path
import uuid

from django.core.management.base import BaseCommand, CommandError

from curriculum_api.bunny_stream import BunnyStream, VideoImportError, live_library_id, library_secret
from curriculum_api.live_recording_migration import plan_migrations, plan_fingerprint, apply_migration_plan
from curriculum_api.models import CurriculumVideoImport


class Command(BaseCommand):
    help = 'Read-only by default. Queue verified historical live recording migrations for the existing AWS worker.'

    def add_arguments(self, parser):
        parser.add_argument('--series-id')
        parser.add_argument('--import-id', action='append', default=[])
        parser.add_argument('--mapping-manifest', help='Private JSON mapping exact Microsoft recording IDs to existing peer video IDs.')
        parser.add_argument('--plan-output', help='Private path for the reviewed plan; contains operational recording IDs.')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-plan')

    def handle(self, *args, **options):
        if not options['series_id'] and not options['import_id']:
            raise CommandError('Choose an explicit --series-id or --import-id; an unscoped migration is not allowed.')
        if options['apply'] and not options['expected_plan']:
            raise CommandError('--apply requires the reviewed --expected-plan fingerprint.')
        assets = CurriculumVideoImport.objects.filter(target_kind='live_session').exclude(library_id=live_library_id())
        if options['series_id']:
            assets = assets.filter(target_id=options['series_id'])
        if options['import_id']:
            try:
                selected_ids = {str(uuid.UUID(value)) for value in options['import_id']}
            except (ValueError, TypeError, AttributeError):
                raise CommandError('A selected import identity is invalid.') from None
            assets = assets.filter(pk__in=selected_ids)
        assets = list(assets.order_by('id'))
        if options['import_id'] and {str(asset.pk) for asset in assets} != selected_ids:
            raise CommandError('Some selected imports are outside the requested historical live recording scope.')
        if not assets:
            raise CommandError('No ready historical live recordings matched the explicit selection.')
        mappings = {}
        if options['mapping_manifest']:
            try:
                data = json.loads(Path(options['mapping_manifest']).read_text(encoding='utf-8'))
                if not isinstance(data, dict) or data.get('version') != 1 or not isinstance(data.get('imports'), list):
                    raise ValueError()
                for row in data['imports']:
                    key = row['import_id']
                    if key in mappings or not isinstance(key, str):
                        raise ValueError()
                    mappings[key] = {name: row[name] for name in ('graph_artifact_id', 'peer_recording_identity', 'video_id')}
                    if not all(isinstance(value, str) and value for value in mappings[key].values()):
                        raise ValueError()
                    if row.get('source_content_sha256'):
                        mappings[key]['source_content_sha256'] = row['source_content_sha256']
            except (OSError, ValueError, KeyError, TypeError):
                raise CommandError('The private source mapping manifest is invalid; no jobs were queued.') from None
        try:
            client = BunnyStream(live_library_id())
            plan = plan_migrations(assets, client, mappings)
            fingerprint = plan_fingerprint(plan)
            if options['plan_output']:
                destination = Path(options['plan_output'])
                if options['mapping_manifest'] and destination.resolve() == Path(options['mapping_manifest']).resolve():
                    raise CommandError('The plan output must not overwrite the source manifest.')
                with destination.open('x', encoding='utf-8') as stream:
                    json.dump(plan, stream, indent=2)
                destination.chmod(0o600)
            queued = apply_migration_plan(plan, assets, options['expected_plan']) if options['apply'] else []
        except VideoImportError as error:
            raise CommandError(str(error)) from None
        self.stdout.write(json.dumps({'read_only': not options['apply'], 'selected': len(assets),
            'actions': dict(Counter(row['action'] for row in plan['imports'])),
            'playback_key_configured': bool(library_secret(live_library_id(), 'TOKEN_KEY')),
            'plan_sha256': fingerprint, 'queued': len(queued),
            'transfers_executed_by_this_command': 0}))
