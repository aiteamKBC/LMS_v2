"""Back up saved coaching VTT only; never fetch or copy a recording."""
from hashlib import sha256
from io import BytesIO
import json

from azure.core.exceptions import ResourceExistsError
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction
from django.utils import timezone

from config import blob_storage
from coach_api.models import CoachCalendarEvent
from learner_api.evidence_storage import download_blob_bytes, upload_blob


RELATION = '"Coach".coach_meeting_artifacts'
MAX_BYTES = 2 * 1024 * 1024
PENDING = "artifact_type='transcript' AND coalesce(transcript_blob_name,'')='' AND coalesce(transcript_vtt,'')<>''"


class InvalidSavedTranscript(ValueError):
    pass


class BackupContentMismatch(ValueError):
    pass


class TranscriptChanged(ValueError):
    pass


def backup_one(database, identity, container):
    """Lock one source snapshot and publish its pointer only after a full readback."""
    event_key, artifact_id, owner, _ = identity
    with transaction.atomic(using=database), connections[database].cursor() as cursor:
        cursor.execute(f'''SELECT CASE WHEN octet_length(transcript_vtt)<=%s THEN transcript_vtt END
            FROM {RELATION} WHERE {PENDING}
            AND event_key=%s AND graph_artifact_id=%s AND owner_email=%s
            FOR UPDATE SKIP LOCKED''', [MAX_BYTES, event_key, artifact_id, owner])
        row = cursor.fetchone()
        if row is None:
            return 'busy'
        if not row[0] or not row[0].lstrip('\ufeff').startswith('WEBVTT'):
            raise InvalidSavedTranscript('The saved source is oversized or is not WebVTT.')
        payload = row[0].encode('utf-8')
        identity_hash = sha256(json.dumps([event_key, artifact_id, owner], ensure_ascii=True).encode()).hexdigest()
        digest = sha256(payload).hexdigest()
        # Immutable names make a retry safe after an upload succeeds but the
        # transaction fails. No existing source object is overwritten/deleted.
        name = f'coaching-transcripts/v1/{identity_hash}/{digest}.vtt'
        try:
            upload_blob(BytesIO(payload), container, name, 'text/vtt', overwrite=False)
        except ResourceExistsError:
            pass
        saved = download_blob_bytes(container, name, max_bytes=MAX_BYTES)
        if sha256(saved).hexdigest() != digest:
            raise BackupContentMismatch('The backup does not match the saved transcript.')
        cursor.execute(f'''UPDATE {RELATION} SET transcript_blob_container=%s,
            transcript_blob_name=%s,transcript_blob_size_bytes=%s,
            transcript_blob_uploaded_at=%s,transcript_blob_error='',updated_at=%s
            WHERE {PENDING} AND event_key=%s AND graph_artifact_id=%s AND owner_email=%s
            AND transcript_vtt=%s''',
            [container, name, len(payload), timezone.now(), timezone.now(), event_key, artifact_id, owner, row[0]])
        if cursor.rowcount != 1:
            raise TranscriptChanged('The selected transcript changed; its pointer was not published.')
    return 'verified'


class Command(BaseCommand):
    help = ('Inspect saved coaching transcript backups (default), or --apply to back up VTT to S3. '
            'Preserves database text, SharePoint videos, meeting identity and existing archive pointers. '
            'Repeat bounded batches until selectedTranscriptParts is zero; no Microsoft or Bunny calls.')
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--event-key', action='append', default=[])
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-database')
        parser.add_argument('--expected-endpoint')
        parser.add_argument('--expected-bucket')

    def handle(self, *args, **options):
        if not 1 <= options['limit'] <= 500:
            raise CommandError('Choose a batch between 1 and 500.')
        database = router.db_for_write(CoachCalendarEvent) or 'default'
        connection = connections[database]
        container = getattr(settings, 'AZURE_TRANSCRIPTS_CONTAINER', '')
        if options['apply']:
            endpoint = str(connection.settings_dict.get('HOST', '')).split('.')[0].removesuffix('-pooler')
            with connection.cursor() as cursor:
                cursor.execute('SELECT current_database()')
                actual = cursor.fetchone()[0]
            if (not options['expected_database'] or not options['expected_endpoint']
                    or actual != options['expected_database'] or endpoint != options['expected_endpoint']):
                raise CommandError('Database/endpoint does not match the explicit backup target; no write attempted.')
            if (not blob_storage.s3_enabled() or not options['expected_bucket']
                    or blob_storage.s3_bucket() != options['expected_bucket'] or not container
                    or not blob_storage.storage_configured(getattr(settings, 'AZURE_STORAGE_ACCOUNT', ''))):
                raise CommandError('Configured S3 storage does not match the explicit backup target; no write attempted.')
        filters, params = '', []
        keys = list(dict.fromkeys(options['event_key']))
        if keys:
            filters = ' AND event_key IN (' + ','.join(['%s'] * len(keys)) + ')'
            params.extend(keys)
        with connection.cursor() as cursor:
            cursor.execute(f'''SELECT event_key,graph_artifact_id,owner_email,octet_length(transcript_vtt)
                FROM {RELATION} WHERE {PENDING}{filters}
                ORDER BY event_key,graph_artifact_id LIMIT %s''', [*params, options['limit']])
            selected = cursor.fetchall()
        report = {'mode': 'apply' if options['apply'] else 'inspect',
                  'selectedTranscriptParts': len(selected), 'sourceBytes': sum(row[3] for row in selected),
                  'oversized': sum(row[3] > MAX_BYTES for row in selected),
                  'storageBackend': blob_storage.storage_backend()}
        if not options['apply']:
            self.stdout.write(json.dumps(report))
            return
        verified = failed = busy = 0
        errors = {}
        for identity in selected:
            try:
                result = backup_one(database, identity, container)
                verified += result == 'verified'
                busy += result == 'busy'
            except Exception as error:
                failed += 1
                # SDK/SQL exception messages can contain private links or text.
                kind = type(error).__name__
                errors[kind] = errors.get(kind, 0) + 1
        report.update(verifiedBackups=verified, failedVerification=failed, busy=busy, errorTypes=errors)
        self.stdout.write(json.dumps(report))
        if failed or busy:
            raise CommandError('Backup is incomplete. Original text and videos were retained; inspect errors or retry busy rows.')
