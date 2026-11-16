"""Copy legacy single-file component settings into the canonical file list.

Dry-run by default.  Pass ``--apply`` to persist the generated
``settings_json.componentFiles`` values.  Existing non-empty component file
lists are never overwritten.
"""

import json

from django.core.management.base import BaseCommand
from django.db import connection


LEGACY_URL_KEYS = ('uploadedFileUrl', 'resourceUrl', 'podcastUrl', 'presentationUrl')
TABLES = ('curriculum.components', 'curriculum.free_programme_components')


def _file_from_settings(settings):
    if not isinstance(settings, dict):
        return None
    existing = settings.get('componentFiles')
    if isinstance(existing, str):
        try:
            existing = json.loads(existing)
        except (TypeError, ValueError):
            existing = None
    if isinstance(existing, list) and existing:
        return None
    url = next((str(settings.get(key) or '').strip() for key in LEGACY_URL_KEYS
                if str(settings.get(key) or '').strip()), '')
    if not url:
        return None
    return {
        'fileName': str(settings.get('uploadedFileName') or settings.get('fileName') or '').strip(),
        'url': url,
        'size': int(float(settings.get('uploadedFileSize') or 0)),
        'contentType': str(settings.get('uploadedFileContentType') or '').strip(),
    }


class Command(BaseCommand):
    help = 'Backfill canonical componentFiles from legacy single-file settings (dry-run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Persist the backfill.')

    def handle(self, *args, **options):
        apply_changes = options['apply']
        total = 0
        changed = 0
        with connection.cursor() as cursor:
            # This is an explicitly operator-run maintenance command.  Neon’s
            # normal request timeout is too short for the initial JSON scan;
            # the query is narrowed below so it still reads only candidates.
            cursor.execute('set statement_timeout = 0')
            for table in TABLES:
                cursor.execute(
                    f"select id, settings_json from {table} "
                    "where settings_json is not null "
                    "and settings_json ?| %s "
                    "and not (settings_json ? 'componentFiles')",
                    [list(LEGACY_URL_KEYS)],
                )
                rows = cursor.fetchall()
                for component_id, raw in rows:
                    total += 1
                    settings = raw if isinstance(raw, dict) else json.loads(raw or '{}')
                    file = _file_from_settings(settings)
                    if not file:
                        continue
                    changed += 1
                    if apply_changes:
                        settings['componentFiles'] = [file]
                        cursor.execute(
                            f'update {table} set settings_json = %s::jsonb, updated_at = CURRENT_TIMESTAMP where id = %s',
                            [json.dumps(settings), component_id],
                        )
        mode = 'updated' if apply_changes else 'would update'
        self.stdout.write(f'Inspected {total:,} component(s); {mode} {changed:,}.')
