"""Explicitly scoped Microsoft-to-Bunny recovery; the normal worker is automatic."""
from django.core.management.base import BaseCommand, CommandError

from curriculum_api.session_bunny import enqueue_recording
from curriculum_api.session_bunny_policy import recording_uses_bunny
from curriculum_api.session_results import read
from curriculum_api.video_imports import process


class Command(BaseCommand):
    help = 'Inspect or import explicit live-session artifact IDs directly from Microsoft into Bunny.'
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--artifact-id', action='append', required=True, dest='artifact_ids')
        parser.add_argument('--apply', action='store_true', help='Import selected Microsoft recordings into Bunny.')

    def handle(self, *args, **options):
        ids = list(dict.fromkeys(options['artifact_ids']))
        if len(ids) > 25:
            raise CommandError('Use a scoped batch of at most 25 recording IDs.')
        found = read("SELECT id,occurrence_id FROM curriculum.live_session_artifacts WHERE id=ANY(%s) AND artifact_type='recording'", [ids])
        if {row['id'] for row in found} != set(ids):
            raise CommandError('One or more requested recording IDs do not exist; nothing was imported.')
        plans = []
        for row in found:
            occurrence = read('SELECT * FROM curriculum.live_session_occurrences WHERE id=%s', [row['occurrence_id']])[0]
            series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [occurrence['live_session_id']])[0]
            artifact = read('SELECT * FROM curriculum.live_session_artifacts WHERE id=%s', [row['id']])[0]
            modules = read('SELECT * FROM curriculum.modules WHERE module_catalogue_id=%s AND deleted_at IS NULL AND NOT coalesce(is_programme_deleted,false)', [series['module_catalogue_id']])
            if not modules or not recording_uses_bunny(occurrence, artifact):
                raise CommandError('A requested recording is outside the active module or 5 November 2026 cutover; nothing was imported.')
            plans.append((series, occurrence, artifact, modules[0]))
        if not options['apply']:
            self.stdout.write(f'Inspection only: {len(plans)} eligible Microsoft recordings; no data or files changed.')
            return
        for series, occurrence, artifact, module in plans:
            self.stdout.write(f"Importing {artifact['id']} directly from Microsoft to Bunny...", ending='\n')
            asset = process(enqueue_recording(series, occurrence, artifact, module).pk)
            self.stdout.write(f'{asset.pk}: {asset.status}')
            if asset.status == 'failed':
                raise CommandError(asset.error)
