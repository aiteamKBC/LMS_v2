"""Re-point selected programme-audit documents at their Azure copies.

The WordPress export stores a material URL containing ``attachment_id``.  The
legacy-file migration stores that attachment exactly once at
``_legacy_files/<attachment_id>/<filename>`` in the curriculum container.  This
command joins those two stable identifiers; it never guesses by title or file
name and never writes a SAS token to PostgreSQL.

Run without ``--apply`` for a read-only preview::

    python manage.py repoint_programme_audit_to_azure
    python manage.py repoint_programme_audit_to_azure --apply
"""
from __future__ import annotations

from collections import Counter
import json
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from curriculum_api import upload_storage
from learner_api import evidence_storage


SCHEMA = 'programme_audit'
MASTER_TABLE = 'assets'
PROGRAMME_TABLES = (
    'july_2025_level_4_marketing_executive',
    'level_4_marketing_executive_may_25',
    'level_6_project_controls_professional_oct_25',
    'level_6_project_controls_professional_pcp_may_25',
    'marketing_executive_level_4_feb_2026',
    'marketing_manager_level_6_feb_2026',
    'new_level_6_marketing_manager_oct_25',
    'new_level_6_project_controls_professional_pcp_july_25',
    'project_controls_professional_level_6_feb_2026',
)
OFFICE_EXTENSIONS = {'.doc', '.docx', '.docm', '.xls', '.xlsx', '.ppt', '.pptx', '.pptm'}


def attachment_id_from_url(value) -> str:
    """Extract the WordPress attachment id from a direct or Office-wrapped URL."""
    text = str(value or '').strip()
    if not text:
        return ''
    parsed = urlparse(text)
    wrapped = unquote(parse_qs(parsed.query).get('src', [''])[0])
    target = urlparse(wrapped or text)
    return str(parse_qs(target.query).get('attachment_id', [''])[0]).strip()


def attachment_id_from_row(source_url, raw_component) -> str:
    """Keep the command idempotent after ``source_url`` has been re-pointed."""
    direct = attachment_id_from_url(source_url)
    if direct:
        return direct
    if isinstance(raw_component, str):
        try:
            raw_component = json.loads(raw_component)
        except ValueError:
            raw_component = {}
    raw = raw_component if isinstance(raw_component, dict) else {}
    for key in ('reading', 'video', 'audio'):
        nested = raw.get(key)
        if isinstance(nested, dict):
            found = attachment_id_from_url(nested.get('iframe_url'))
            if found:
                return found
    return ''


def stable_urls(blob_name: str) -> tuple[str, str]:
    source_url = upload_storage.UPLOAD_URL_PREFIX + blob_name.lstrip('/')
    extension = Path(blob_name).suffix.lower()
    embed_url = f'{source_url}?preview=1' if extension in OFFICE_EXTENSIONS else source_url
    return source_url, embed_url


class Command(BaseCommand):
    help = 'Re-point the nine programme_audit tables and their assets rows to Azure.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write the verified mappings. Without this flag the command is read-only.',
        )

    def handle(self, *args, **options):
        if not upload_storage.azure_enabled():
            raise CommandError(
                'Azure curriculum storage is not configured '
                '(AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY / AZURE_CURRICULUM_CONTAINER).'
            )

        blobs = self.azure_legacy_blobs()
        if not blobs:
            raise CommandError('Azure contains no _legacy_files to map.')

        table_updates = {}
        canonical_updates = {}
        unmatched = []
        conflicts = []
        extension_counts = Counter()

        with connection.cursor() as cursor:
            for table in PROGRAMME_TABLES:
                cursor.execute(
                    f'SELECT id, title, source_url, raw_component, embed_url, render_mode, '
                    f'file_name, content_type, file_size FROM "{SCHEMA}"."{table}"'
                )
                updates = []
                for row in cursor.fetchall():
                    (row_id, title, old_source, raw_component, old_embed, old_mode,
                     old_name, old_type, old_size) = row
                    attachment_id = attachment_id_from_row(old_source, raw_component)
                    if not attachment_id:
                        continue
                    blob = blobs.get(attachment_id)
                    if not blob:
                        unmatched.append((table, row_id, attachment_id, title))
                        continue
                    blob_name, size, content_type = blob
                    source_url, embed_url = stable_urls(blob_name)
                    file_name = Path(blob_name).name
                    desired = (
                        source_url, embed_url, 'iframe', file_name,
                        content_type, size, row_id,
                    )
                    current = (old_source, old_embed, old_mode, old_name, old_type, old_size)
                    if current != desired[:-1]:
                        updates.append(desired)
                    previous = canonical_updates.get(row_id)
                    if previous and previous != desired:
                        conflicts.append((row_id, previous, desired))
                    canonical_updates[row_id] = desired
                    extension_counts[Path(blob_name).suffix.lower()] += 1
                table_updates[table] = updates

        if unmatched:
            sample = ', '.join(f'{table}:{attachment}' for table, _id, attachment, _title in unmatched[:5])
            raise CommandError(
                f'{len(unmatched)} audit rows have no matching Azure blob; no writes made. {sample}'
            )
        if conflicts:
            raise CommandError(f'{len(conflicts)} component ids map to conflicting Azure files; no writes made.')

        table_change_count = sum(map(len, table_updates.values()))
        master_updates = self.changed_master_updates(canonical_updates)
        master_change_count = len(master_updates)
        verb = 'Applying' if options['apply'] else 'Would apply'
        self.stdout.write(
            f'{verb} {table_change_count} programme-table updates and '
            f'{master_change_count} assets updates; '
            f'{len(canonical_updates)} unique activities, {len(set(v[0] for v in canonical_updates.values()))} files.'
        )
        self.stdout.write('File types: ' + ', '.join(
            f'{extension or "(none)"}={count}' for extension, count in sorted(extension_counts.items())
        ))
        for table, updates in table_updates.items():
            self.stdout.write(f'  {table}: {len(updates)}')

        if not options['apply']:
            self.stdout.write(self.style.WARNING('Dry run only; pass --apply to write these changes.'))
            return

        changed_at = timezone.now().replace(tzinfo=None)
        with transaction.atomic():
            with connection.cursor() as cursor:
                for table, updates in table_updates.items():
                    if not updates:
                        continue
                    cursor.executemany(
                        f'''UPDATE "{SCHEMA}"."{table}"
                            SET source_url = %s, embed_url = %s, render_mode = %s,
                                file_name = %s, content_type = %s, file_size = %s,
                                updated_at = %s
                            WHERE id = %s''',
                        [values[:-1] + (changed_at, values[-1]) for values in updates],
                    )
                if master_updates:
                    cursor.executemany(
                        f'''UPDATE "{SCHEMA}"."{MASTER_TABLE}"
                            SET source_url = %s, embed_url = %s, render_mode = %s,
                                file_name = %s, content_type = %s, file_size = %s,
                                updated_at = %s
                            WHERE id = %s''',
                        [values[:-1] + (changed_at, values[-1]) for values in master_updates],
                    )

        remaining = self.remaining_old_links()
        if remaining:
            raise CommandError(
                f'Updates committed, but verification found {remaining} mapped rows still using old links.'
            )
        self.stdout.write(self.style.SUCCESS(
            f'Azure links applied and verified: {table_change_count} programme rows, '
            f'{master_change_count} assets rows.'
        ))

    @staticmethod
    def azure_legacy_blobs():
        client = evidence_storage._service_client().get_container_client(
            settings.AZURE_CURRICULUM_CONTAINER,
        )
        blobs = {}
        for blob in client.list_blobs(name_starts_with='_legacy_files/'):
            parts = str(blob.name).split('/', 2)
            if len(parts) != 3:
                continue
            attachment_id = parts[1]
            value = (
                str(blob.name), int(blob.size or 0),
                blob.content_settings.content_type or '',
            )
            if attachment_id in blobs and blobs[attachment_id] != value:
                raise CommandError(f'Azure attachment folder {attachment_id} contains multiple files.')
            blobs[attachment_id] = value
        return blobs

    @staticmethod
    def changed_master_updates(canonical_updates):
        if not canonical_updates:
            return []
        with connection.cursor() as cursor:
            cursor.execute(
                f'''SELECT id, source_url, embed_url, render_mode, file_name, content_type, file_size
                    FROM "{SCHEMA}"."{MASTER_TABLE}" WHERE id = ANY(%s)''',
                [list(canonical_updates)],
            )
            rows = {row[0]: row[1:] for row in cursor.fetchall()}
        missing = set(canonical_updates) - set(rows)
        if missing:
            raise CommandError(f'{len(missing)} mapped component ids are missing from programme_audit.assets.')
        return [
            desired for row_id, desired in canonical_updates.items()
            if rows[row_id] != desired[:-1]
        ]

    @staticmethod
    def remaining_old_links():
        remaining = 0
        with connection.cursor() as cursor:
            for table in PROGRAMME_TABLES:
                cursor.execute(
                    f'''SELECT count(*) FROM "{SCHEMA}"."{table}"
                        WHERE source_url LIKE '%%view.officeapps.live.com%%'
                          AND source_url LIKE '%%attachment_id%%' '''
                )
                remaining += cursor.fetchone()[0]
        return remaining
