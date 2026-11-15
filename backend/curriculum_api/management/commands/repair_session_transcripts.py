"""Explicit storage-role recovery; never resync meetings, attendance or videos."""
from collections import defaultdict
import json

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from curriculum_api.session_archive import archive_series, storage_client
from curriculum_api.session_results import read


class Command(BaseCommand):
    help = 'Inspect missing lecture transcript archives, or repair them with the worker storage role.'
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--live-session-id', action='append', default=[], dest='series_ids')
        parser.add_argument('--artifact-id', action='append', default=[], dest='artifact_ids')
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-database')
        parser.add_argument('--expected-endpoint')

    def handle(self, *args, **options):
        limit = options['limit']
        if not 1 <= limit <= 500:
            raise CommandError('Choose a transcript batch between 1 and 500.')
        series_ids = list(dict.fromkeys(options['series_ids']))
        artifact_ids = list(dict.fromkeys(options['artifact_ids']))
        filters, params = [], []
        for values, column in ((series_ids, 's.id'), (artifact_ids, 'a.id')):
            if values:
                filters.append(f'{column}=ANY(%s)')
                params.append(values)
        selected = read('''SELECT a.id,s.id AS series_id,a.occurrence_id
            FROM curriculum.live_session_artifacts a
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id AND r.occurrence_id=o.id
            WHERE a.artifact_type='transcript' AND coalesce(a.graph_artifact_id,'')<>''
              AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
              AND s.status NOT IN ('cancelled','deleted','superseded','failed')
              AND o.status NOT IN ('cancelled','deleted','superseded')
              AND (coalesce(r.status,'')<>'ready' OR nullif(btrim(r.transcript_text),'') IS NULL)'''
            + ''.join(' AND ' + condition for condition in filters)
            + ' ORDER BY a.created_datetime,a.id LIMIT %s', [*params, limit])
        self.stdout.write(json.dumps({'mode': 'apply' if options['apply'] else 'inspect',
            'selectedTranscriptParts': len(selected), 'series': len({row['series_id'] for row in selected})}))
        if not options['apply'] or not selected:
            return
        # A human/operator names the intended environment, never a connection string.
        connection = connections['default']
        endpoint = str(connection.settings_dict.get('HOST', '')).split('.')[0].removesuffix('-pooler')
        actual = read('SELECT current_database() AS name')[0]['name']
        if (not options['expected_database'] or not options['expected_endpoint']
                or actual != options['expected_database'] or endpoint != options['expected_endpoint']):
            raise CommandError('Database/endpoint does not match the explicit recovery target; no repair attempted.')
        grouped = defaultdict(list)
        for row in selected:
            grouped[row['series_id']].append(row['id'])
        repaired, failed, busy = 0, 0, 0
        for series_id, ids in grouped.items():
            # Hold only this series job row. The regular worker uses SKIP LOCKED,
            # so it cannot claim our series while storage I/O is in progress.
            # An already-running job owns its files and must be allowed to finish.
            with transaction.atomic(), connection.cursor() as cursor:
                cursor.execute('''INSERT INTO curriculum.session_result_jobs(live_session_id)
                    SELECT id FROM curriculum.live_sessions WHERE id=%s
                    ON CONFLICT(live_session_id) DO NOTHING''', [series_id])
                cursor.execute('''SELECT state FROM curriculum.session_result_jobs
                    WHERE live_session_id=%s FOR UPDATE SKIP LOCKED''', [series_id])
                job = cursor.fetchone()
                if not job or job[0] == 'running':
                    busy += len(ids)
                    continue
                archive_series(series_id, artifact_ids=ids)
                saved = read('''SELECT a.id,r.container,r.blob_name,r.status,r.transcript_text
                    FROM curriculum.live_session_artifacts a
                    JOIN curriculum.session_result_archive r ON r.artifact_id=a.id AND r.occurrence_id=a.occurrence_id
                    WHERE a.id=ANY(%s) AND a.artifact_type='transcript' ''', [ids])
                verified = 0
                for row in saved:
                    if row['status'] != 'ready' or not (row['transcript_text'] or '').strip():
                        continue
                    try:
                        properties = storage_client().get_blob_client(row['container'], row['blob_name']).get_blob_properties()
                        if properties.size > 0:
                            verified += 1
                    except Exception:
                        # A provider failure never counts as successful repair.
                        continue
                repaired += verified
                failed += len(ids) - verified
        self.stdout.write(json.dumps({'selected': len(selected), 'verifiedReady': repaired,
            'failedVerification': failed, 'busy': busy}))
        if failed or busy:
            raise CommandError('Recovery is incomplete; inspect the safe archive errors or retry busy series.')
