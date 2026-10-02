"""Move free-course artwork out of ``cover_image_url``, for both free-course tables.

The same problem ``backfill_module_cover_images`` solved for
``curriculum.modules``, in the two tables it did not cover. The Free Courses
picker reads the chosen file in the browser and sends it as a
``data:image/...;base64,...`` URL, and that string went straight into the
column -- on ``curriculum.free_courses`` and, mirrored, on
``curriculum.free_course_weeks``.

``free_course_weeks`` is the expensive one. Every cold Curriculum overview build
used to read that table whole, and six of its fifty-six rows carried 1.9 MB of
base64 between them. (That particular read has since been removed -- it was
keying on a ``programme_id`` column the table does not have -- but the payload
is still selected by ``get_free_programme_modules_payload`` and by anything else
that reads the row.)

What this does differently from the module command
--------------------------------------------------
The two tables hold the *same* pictures: a course's cover is copied onto each of
its weeks, and two different courses here were given the same file. Ten rows
carry four distinct images. So the upload is keyed on the SHA-256 of the decoded
bytes, not on the row: each distinct image is stored once and every row that
held it is pointed at the one object. Re-running is idempotent for the same
reason -- the blob name is derived from the content, so a second run overwrites
the same bytes rather than littering the container.

Safety
------
* Dry-run by default. ``--apply`` writes.
* Refuses to run when uploads would land on local disk, unless
  ``--allow-local-storage`` says that is really wanted: the whole point of
  upload_storage is that a path on one host is a 404 on every other, and
  pointing a production row at this machine's disk would be worse than the
  base64 it replaced.
* Each uploaded object is read back and checked -- byte length *and* digest --
  before any row is updated. Nothing is written if the readback disagrees.
* Rows are updated with ``where id = %s and cover_image_url = %s``, so a cover
  somebody replaced while this was running is left alone.
* ``--manifest`` writes the rollback mapping: table, id, old length, old digest,
  the new URL, and whether the original ``data:`` URI can be reproduced exactly
  from the stored bytes. Where it cannot, the original value is saved beside the
  manifest so a rollback is still byte-for-byte.

``curriculum.modules`` is deliberately not touched: it has no inline rows left.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.core.files.base import ContentFile
from django.db import connection

from ... import upload_storage, views

#: (table, primary-key column). Both tables carry the same column name for the
#: artwork, and both were written by the same picker.
TABLES = (
    ('curriculum.free_courses', 'id'),
    ('curriculum.free_course_weeks', 'id'),
)

#: Where the deduplicated objects live inside the curriculum upload container.
#: Content-addressed, so the same image from either table resolves to one blob.
COVER_SLOT = 'free_course_covers'

DATA_URI = re.compile(r'^data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$')


class Command(BaseCommand):
    help = (
        'Store inline (data:) free-course cover images through upload_storage, '
        'deduplicated by content, and replace cover_image_url on '
        'curriculum.free_courses and curriculum.free_course_weeks with the '
        'served URL. Dry-run unless --apply.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Write the replacement URLs. Without it the command only reports.',
        )
        parser.add_argument(
            '--manifest', default='',
            help='Path to write the rollback mapping (JSON). Strongly recommended with --apply.',
        )
        parser.add_argument(
            '--allow-local-storage', action='store_true',
            help='Permit a run when uploads would go to this machine\'s disk rather than Azure.',
        )

    # -- reading -----------------------------------------------------------
    def inline_rows(self):
        """Every row in either table whose cover is still an inline image."""
        found = []
        for table, key in TABLES:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    select {key}, cover_image_url, octet_length(cover_image_url)
                      from {table}
                     where cover_image_url like 'data:image/%'
                     order by octet_length(cover_image_url) desc, {key}
                    """
                )
                for identifier, value, byte_count in cursor.fetchall():
                    found.append({
                        'table': table, 'key': key, 'id': identifier,
                        'value': value, 'column_bytes': byte_count or 0,
                    })
        return found

    @staticmethod
    def decode(value):
        """``(content_type, raw_bytes, canonical_base64)`` or ``None``."""
        match = DATA_URI.match(value or '')
        if not match:
            return None
        payload = re.sub(r'\s+', '', match.group(2))
        try:
            raw = base64.b64decode(payload, validate=True)
        except Exception:
            return None
        if not raw:
            return None
        return match.group(1).lower(), raw, payload

    # -- writing -----------------------------------------------------------
    def upload(self, content_type, raw, digest):
        """Store the bytes once, read them back, and return the served URL.

        Returns ``None`` when the object could not be stored or does not read
        back as what was sent -- the caller then leaves every row holding it
        exactly as it is.
        """
        extension = views.MODULE_COVER_EXTENSIONS.get(content_type, '.img')
        relative_path = (
            f'{views.COMPONENT_UPLOAD_ROOT}/{COVER_SLOT}/{digest[:32]}{extension}'
        )
        try:
            saved_path = upload_storage.store(ContentFile(raw), relative_path, content_type)
        except Exception as error:  # noqa: BLE001 - reported, row left alone
            self.stdout.write(self.style.WARNING(f'    upload failed: {error}'))
            return None

        opened = upload_storage.open_stream(saved_path)
        if not opened:
            self.stdout.write(self.style.WARNING('    stored object could not be read back.'))
            return None
        stream, total_size, _ = opened
        read_back = b''.join(stream)
        if total_size != len(raw) or len(read_back) != len(raw):
            self.stdout.write(self.style.WARNING(
                f'    readback length {len(read_back)} / reported {total_size} '
                f'!= source {len(raw)}; row left alone.'
            ))
            return None
        if hashlib.sha256(read_back).hexdigest() != digest:
            self.stdout.write(self.style.WARNING('    readback digest differs; row left alone.'))
            return None
        return saved_path, upload_storage.upload_url(saved_path)

    def handle(self, *args, **options):
        apply_changes = options['apply']
        if not upload_storage.azure_enabled() and not options['allow_local_storage']:
            raise CommandError(
                'Uploads would be written to this machine\'s disk, where no other host '
                'can read them -- a production row pointing there would be a broken '
                'image everywhere but here. Configure Azure, or pass '
                '--allow-local-storage if that really is what you want.'
            )

        rows = self.inline_rows()
        if not rows:
            self.stdout.write('No free course or free course week stores its cover inline. Nothing to do.')
            return

        total_bytes = sum(row['column_bytes'] for row in rows)
        self.stdout.write(
            f'{len(rows)} row(s) across {len({row["table"] for row in rows})} table(s) '
            f'store a cover inline, {total_bytes:,} bytes of column in total.'
        )

        # Group by the picture itself, so one image is uploaded once however
        # many rows and tables point at it.
        by_digest = {}
        undecodable = []
        for row in rows:
            decoded = self.decode(row['value'])
            if not decoded:
                undecodable.append(row)
                continue
            content_type, raw, payload = decoded
            digest = hashlib.sha256(raw).hexdigest()
            row.update({
                'content_type': content_type, 'raw_bytes': len(raw),
                'digest': digest,
                # True when base64(decoded) is byte-identical to what the column
                # holds, which makes a rollback a pure function of the object.
                'reproducible': base64.b64encode(raw).decode() == payload,
            })
            by_digest.setdefault(digest, {'content_type': content_type, 'raw': raw, 'rows': []})
            by_digest[digest]['rows'].append(row)

        self.stdout.write(
            f'{len(by_digest)} distinct image(s) behind those {len(rows) - len(undecodable)} row(s).'
        )
        for digest, group in by_digest.items():
            where = ', '.join(f'{row["table"].split(".")[-1]}:{row["id"]}' for row in group['rows'])
            self.stdout.write(
                f'  {digest[:12]} {group["content_type"]} {len(group["raw"]):,} bytes '
                f'-> {len(group["rows"])} row(s): {where}'
            )

        if not apply_changes:
            # Nothing is uploaded on a dry run: storing the blob is already half
            # the change, and a run nobody applies would orphan objects.
            self.stdout.write(self.style.WARNING(
                f'Dry run. {len(rows) - len(undecodable)} row(s) would move, '
                f'{len(by_digest)} object(s) would be uploaded. Re-run with --apply to write.'
            ))
            if undecodable:
                self.report_undecodable(undecodable)
            return

        manifest = []
        uploaded = 0
        updated = 0
        for digest, group in by_digest.items():
            self.stdout.write(f'  {digest[:12]}: uploading {len(group["raw"]):,} bytes...')
            result = self.upload(group['content_type'], group['raw'], digest)
            if not result:
                continue
            saved_path, url = result
            uploaded += 1
            self.stdout.write(f'    verified -> {url}')
            for row in group['rows']:
                with connection.cursor() as cursor:
                    # Matched on the old value as well as the id, so a cover
                    # replaced while this was running is not overwritten.
                    cursor.execute(
                        f"""
                        update {row['table']}
                           set cover_image_url = %s, updated_at = CURRENT_TIMESTAMP
                         where {row['key']} = %s
                           and cover_image_url = %s
                        """,
                        [url, row['id'], row['value']],
                    )
                    changed = cursor.rowcount
                if changed:
                    updated += 1
                    self.stdout.write(f'    {row["table"]} {row["id"]}: updated')
                else:
                    self.stdout.write(self.style.WARNING(
                        f'    {row["table"]} {row["id"]}: changed under us, left alone'
                    ))
                manifest.append({
                    'table': row['table'], 'id': row['id'],
                    'old_column_bytes': row['column_bytes'],
                    'old_decoded_bytes': row['raw_bytes'],
                    'old_sha256': digest,
                    'old_content_type': row['content_type'],
                    'new_url': url,
                    'storage_relative_path': saved_path,
                    'rollback_is_exact_from_object': row['reproducible'],
                    'updated': bool(changed),
                })

        if manifest and options['manifest']:
            self.write_manifest(Path(options['manifest']), manifest, by_digest)

        # Every list that selects this column, and the payload build, cached the
        # old value.
        views.invalidate_curriculum_cache()
        self.stdout.write(self.style.SUCCESS(
            f'Uploaded {uploaded} object(s); updated {updated} row(s). '
            f'{total_bytes:,} bytes of base64 no longer travel with these tables.'
        ))
        if undecodable:
            self.report_undecodable(undecodable)

    def report_undecodable(self, rows):
        self.stdout.write(self.style.WARNING(
            f'{len(rows)} row(s) hold something that is not decodable base64 and were '
            'left exactly as they are:'
        ))
        for row in rows:
            self.stdout.write(f'  {row["table"]} {row["id"]} ({row["column_bytes"]:,} bytes)')

    def write_manifest(self, path, manifest, by_digest):
        """The rollback mapping, plus the originals that cannot be rebuilt.

        A row marked ``rollback_is_exact_from_object`` can be restored from the
        stored object alone: download it, base64-encode it, prefix it with
        ``data:<content_type>;base64,``. Anything else gets its original column
        value written beside the manifest, so a rollback is never a guess.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({
            'description': (
                'Rollback mapping for backfill_free_course_cover_images. Restore a row by '
                'setting cover_image_url back to data:<old_content_type>;base64,<base64 of '
                'the object at new_url>. Rows with rollback_is_exact_from_object false have '
                'their original value in the companion file named below.'
            ),
            'rows': manifest,
        }, indent=2), encoding='utf-8')
        self.stdout.write(f'Rollback mapping written to {path}')

        inexact = {
            row['old_sha256'] for row in manifest if not row['rollback_is_exact_from_object']
        }
        if not inexact:
            return
        originals = path.with_name(path.stem + '.originals.json')
        originals.write_text(json.dumps({
            digest: {
                'content_type': by_digest[digest]['content_type'],
                'data_uri': 'data:%s;base64,%s' % (
                    by_digest[digest]['content_type'],
                    base64.b64encode(by_digest[digest]['raw']).decode(),
                ),
            }
            for digest in inexact
        }, indent=2), encoding='utf-8')
        self.stdout.write(self.style.WARNING(
            f'{len(inexact)} image(s) do not re-encode identically; originals written to {originals}'
        ))
