"""Replace full-size external Free Course covers with small WebP copies we serve.

The Free Courses catalogue pointed ``curriculum.free_courses.cover_image_url``
at the college's WordPress uploads: ten PNG originals of ~1.9 MB each, shown in
a card about 250px tall. Each card made the browser download the whole
original, ~17 MB for the library page on a cold cache.

This downloads each distinct external image once, scales it to 800px wide
(enough for a retina card), encodes it as WebP (~45 kB) and stores it through
upload_storage under the same content-addressed slot the cover backfill uses.

Safety
------
* Dry run by default: downloads and resizes, uploads and writes nothing.
* Refuses unless object storage is configured (a path on one host's disk is a
  broken image on every other host).
* Every stored object is read back and checked (length and SHA-256) before any
  row points at it; a failed image leaves its rows untouched.
* ``--apply`` requires ``--manifest``: the id, old URL and new URL of every row,
  written before the first update, is the rollback.
* Rows are updated ``where id = %s and cover_image_url = <old url>``, so a cover
  somebody changed meanwhile is left alone.
* The WordPress originals are never modified.
"""
from __future__ import annotations

import hashlib
import io
import json
import urllib.request

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from ... import upload_storage
from .backfill_free_course_cover_images import Command as CoverBackfill

DEFAULT_PREFIX = 'https://kentbusinesscollege.org/wp-content/'
WIDTH = 800
QUALITY = 82


class Command(BaseCommand):
    help = (
        'Resize external Free Course cover images to 800px WebP, store them in '
        'upload storage and repoint curriculum.free_courses. Dry run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Upload and update rows.')
        parser.add_argument('--manifest', help='Where to write the rollback JSON (required with --apply).')
        parser.add_argument('--prefix', default=DEFAULT_PREFIX, help='Only covers whose URL starts with this.')

    def handle(self, *args, **options):
        from PIL import Image

        apply_changes = options['apply']
        prefix = options['prefix']
        if apply_changes and not options['manifest']:
            raise CommandError('--apply needs --manifest so the change can be rolled back.')
        if not upload_storage.azure_enabled():
            raise CommandError('Object storage is not configured; refusing to store covers on local disk.')

        with connection.cursor() as cursor:
            cursor.execute(
                'select id, cover_image_url from curriculum.free_courses '
                'where cover_image_url like %s order by id', [prefix + '%'])
            rows = cursor.fetchall()
        self.stdout.write(f'{len(rows)} course(s) use a cover under {prefix}')
        if not rows:
            return

        converted = {}
        for url in sorted({url for _ident, url in rows}):
            request = urllib.request.Request(url, headers={'User-Agent': 'KBC-LMS-cover-resize'})
            try:
                original = urllib.request.urlopen(request, timeout=60).read()
                image = Image.open(io.BytesIO(original))
                image.load()
            except Exception as error:  # noqa: BLE001 - reported, rows left alone
                self.stdout.write(self.style.WARNING(f'  could not read {url}: {error}'))
                continue
            if image.width > WIDTH:
                image = image.resize((WIDTH, round(image.height * WIDTH / image.width)), Image.LANCZOS)
            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGBA')
            buffer = io.BytesIO()
            image.save(buffer, 'WEBP', quality=QUALITY, method=6)
            converted[url] = buffer.getvalue()
            self.stdout.write(
                f'  {url.rsplit("/", 1)[-1]}: {len(original):,} -> {len(converted[url]):,} bytes '
                f'({image.width}x{image.height})'
            )

        if not apply_changes:
            self.stdout.write(self.style.WARNING('Dry run: nothing uploaded, nothing updated. Re-run with --apply.'))
            return

        backfill = CoverBackfill(stdout=self.stdout, stderr=self.stderr)
        new_url = {}
        for url, raw in converted.items():
            result = backfill.upload('image/webp', raw, hashlib.sha256(raw).hexdigest())
            if result:
                new_url[url] = result[1]
                self.stdout.write(f'  verified -> {result[1]}')
            else:
                self.stdout.write(self.style.WARNING(f'  left alone: {url}'))

        manifest = [{'id': ident, 'old': url, 'new': new_url.get(url)} for ident, url in rows]
        with open(options['manifest'], 'w', encoding='utf-8') as handle:
            json.dump(manifest, handle, indent=1)
        self.stdout.write(f'Rollback manifest written to {options["manifest"]}')

        updated = 0
        with connection.cursor() as cursor:
            for ident, url in rows:
                if url not in new_url:
                    continue
                cursor.execute(
                    'update curriculum.free_courses set cover_image_url = %s, updated_at = CURRENT_TIMESTAMP '
                    'where id = %s and cover_image_url = %s', [new_url[url], ident, url])
                updated += cursor.rowcount
            cursor.execute(
                'select count(*) from curriculum.free_courses where cover_image_url like %s', [prefix + '%'])
            remaining = cursor.fetchone()[0]
        self.stdout.write(self.style.SUCCESS(f'Updated {updated} course(s); {remaining} still use {prefix}'))
