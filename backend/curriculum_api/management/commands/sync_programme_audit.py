import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from curriculum_api import programme_audit


class Command(BaseCommand):
    help = 'Snapshot programme learning assets into programme_audit.assets.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--programme',
            '--programme-id',
            dest='programme',
            default='',
            help='Programme id/name to import. Used for local curriculum lookup and as a query value for --url.',
        )
        parser.add_argument(
            '--url',
            default='',
            help='External JSON endpoint to import. KBC_LMS_API_KEY is sent as X-KBC-API-Key when configured.',
        )
        parser.add_argument(
            '--input-json',
            default='',
            help='Path to a JSON payload already exported from the LMS.',
        )
        parser.add_argument(
            '--replace',
            action='store_true',
            help='Delete existing audit rows for the imported programme before inserting this snapshot.',
        )
        parser.add_argument(
            '--commit',
            action='store_true',
            help='Write changes. Default is dry-run.',
        )
        parser.add_argument(
            '--provision',
            action='store_true',
            help='Create programme_audit.assets first without running the wider migration graph.',
        )
        parser.add_argument(
            '--kbc-wordpress',
            action='store_true',
            help=(
                'Import every programme from the KBC WordPress LMS '
                '(all-students-schema, paginated by student, de-duplicated by activity). '
                'Ignores --programme/--url/--input-json.'
            ),
        )
        parser.add_argument(
            '--max-pages',
            type=int,
            default=0,
            help='With --kbc-wordpress, stop after this many pages (0 = no limit).',
        )
        parser.add_argument(
            '--per-programme-tables',
            action='store_true',
            help=(
                'With --kbc-wordpress, store each programme in its own table '
                '(programme_audit.<programme_id>) instead of the shared assets table.'
            ),
        )

    def load_payload(self, path):
        try:
            return json.loads(Path(path).read_text(encoding='utf-8-sig'))
        except OSError as exc:
            raise CommandError(f'Could not read {path}: {exc}') from exc
        except ValueError as exc:
            raise CommandError(f'{path} is not valid JSON: {exc}') from exc

    def handle(self, *args, **options):
        if options['kbc_wordpress']:
            self.handle_kbc_wordpress(options)
            return

        programme = (options['programme'] or '').strip()
        payload = self.load_payload(options['input_json']) if options['input_json'] else None
        source_url = (options['url'] or '').strip()

        if payload is None and not source_url and not programme:
            if options['provision']:
                programme_audit.provision_programme_audit_table()
                self.stdout.write(self.style.SUCCESS('COMMITTED: programme_audit.assets is provisioned.'))
                return
            raise CommandError('Pass --programme, --url, or --input-json, or use --provision by itself.')

        try:
            if options['provision']:
                programme_audit.provision_programme_audit_table()
            with transaction.atomic():
                result = programme_audit.sync_from_options(
                    programme_identifier=programme,
                    payload=payload,
                    source_url=source_url,
                    replace=options['replace'],
                )
                if not options['commit']:
                    transaction.set_rollback(True)
        except Exception as exc:  # noqa: BLE001 - management command should surface a clean error
            raise CommandError(str(exc)) from exc

        counts = {}
        for asset in result['assets']:
            kind = asset.get('content_kind') or 'unknown'
            counts[kind] = counts.get(kind, 0) + 1

        mode = 'COMMITTED' if options['commit'] else 'DRY RUN - no changes written'
        self.stdout.write(self.style.SUCCESS(
            f'{mode}: programme="{result["programmeId"]}" assets={len(result["assets"])} stored={result["stored"]}'
        ))
        for kind, count in sorted(counts.items()):
            self.stdout.write(f'  {kind}: {count}')

    def handle_kbc_wordpress(self, options):
        per_programme = options['per_programme_tables']
        if options['provision'] and not per_programme:
            programme_audit.provision_programme_audit_table()

        def on_page(page, total_pages, collected):
            total = total_pages or '?'
            self.stdout.write(f'  page {page}/{total} - {collected} unique materials so far')

        assets = programme_audit.sync_kbc_wordpress_all_programmes(
            max_pages=options['max_pages'] or None,
            on_page=on_page,
        )

        counts = {}
        programmes = set()
        for asset in assets:
            kind = asset.get('content_kind') or 'unknown'
            counts[kind] = counts.get(kind, 0) + 1
            programmes.add(asset['programme_id'])

        def on_programme(programme_id, count, done, total):
            self.stdout.write(f'  [{done}/{total}] programme {programme_id}: {count} assets stored')

        stored = 0
        tables_created = 0
        if options['commit']:
            try:
                if per_programme:
                    result = programme_audit.upsert_assets_per_programme_tables(assets, on_programme=on_programme)
                    tables_created = len(result['tables'])
                else:
                    with transaction.atomic():
                        result = programme_audit.upsert_assets(assets)
            except Exception as exc:  # noqa: BLE001 - management command should surface a clean error
                raise CommandError(str(exc)) from exc
            stored = result['stored']

        mode = 'COMMITTED' if options['commit'] else 'DRY RUN - no changes written'
        target = f'{tables_created} per-programme tables' if per_programme else 'programme_audit.assets'
        self.stdout.write(self.style.SUCCESS(
            f'{mode}: kbc-wordpress -> {target} programmes={len(programmes)} assets={len(assets)} stored={stored}'
        ))
        for kind, count in sorted(counts.items()):
            self.stdout.write(f'  {kind}: {count}')
