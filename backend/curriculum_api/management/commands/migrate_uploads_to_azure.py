"""Move curriculum component uploads from local disk into blob storage.

Uploads used to be written to MEDIA_ROOT, so the bytes only existed on whichever
machine served the upload while the database row was shared by all of them. This
sweeps what is already on disk into AZURE_CURRICULUM_CONTAINER and removes the
local copy, leaving the database untouched: a component's stored path is
``/curriculum_api/curriculum/uploads/<relative>`` either way, and the serving
view resolves it from whichever place holds the bytes.

    python manage.py migrate_uploads_to_azure --dry-run
    python manage.py migrate_uploads_to_azure
    python manage.py migrate_uploads_to_azure --prefix MOD-2026… --keep-local

A local file is deleted only after Azure reports a blob of exactly the same
size, so an interrupted or truncated upload can never lose the only copy. Re-runs
are safe: a file already in the container is verified and then removed locally.

The slide render cache (``_slide_renders``) is skipped — it is derived data, it
is regenerated on demand, and it belongs to the host that made it.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from curriculum_api import upload_storage
from curriculum_api.views import COMPONENT_UPLOAD_ROOT

#: Derived, host-local, and regenerated on demand — not worth moving.
SKIP_DIRS = {'_slide_renders'}


def human(byte_count):
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if byte_count < 1024 or unit == 'TiB':
            return f'{byte_count:.1f} {unit}'
        byte_count /= 1024


class Command(BaseCommand):
    help = 'Move curriculum uploads from MEDIA_ROOT into Azure blob storage.'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default='',
                            help='Only files under this path inside the upload root.')
        parser.add_argument('--keep-local', action='store_true',
                            help='Upload and verify, but leave the local copy in place.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would move and write nothing.')
        parser.add_argument('--limit', type=int, default=None,
                            help='Stop after this many files (for a first pass).')

    def handle(self, *args, **options):
        if not upload_storage.azure_enabled():
            raise CommandError(
                'Azure is not configured (AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY / '
                'AZURE_CURRICULUM_CONTAINER), so there is nowhere to move these files.'
            )
        dry_run = options['dry_run']
        root = upload_storage.local_path(COMPONENT_UPLOAD_ROOT)
        if root is None or not root.is_dir():
            self.stdout.write('No local upload directory — nothing to move.')
            return

        base = root / options['prefix'] if options['prefix'] else root
        if not base.exists():
            raise CommandError(f'{base} does not exist.')

        self.stdout.write(
            f'Container: {upload_storage.container_name()}\n'
            f'Local root: {base}'
        )
        if not dry_run:
            upload_storage.ensure_container()

        moved = verified = failed = skipped = 0
        moved_bytes = 0
        for path in sorted(p for p in base.rglob('*') if p.is_file()):
            relative = path.relative_to(root).as_posix()
            if set(relative.split('/')) & SKIP_DIRS:
                skipped += 1
                continue
            if path.name.endswith('.part'):
                # A download still in flight, or one that died mid-write.
                skipped += 1
                continue
            storage_relative = f'{COMPONENT_UPLOAD_ROOT}/{relative}'
            local_size = path.stat().st_size
            if dry_run:
                moved += 1
                moved_bytes += local_size
                if moved <= 10:
                    self.stdout.write(f'  would move {relative} ({human(local_size)})')
                if options['limit'] and moved >= options['limit']:
                    break
                continue

            content_type = mimetypes.guess_type(path.name)[0] or ''
            try:
                remote_size = upload_storage.copy_local_to_azure(storage_relative, content_type)
            except Exception as error:
                failed += 1
                self.stderr.write(f'  upload failed: {relative} ({error})')
                continue
            if remote_size != local_size:
                # Never delete the local copy on a size mismatch — that is the
                # one case where the file in Azure cannot be trusted.
                failed += 1
                self.stderr.write(
                    f'  size mismatch: {relative} local {local_size} vs azure {remote_size}'
                )
                continue
            verified += 1
            moved_bytes += local_size
            if not options['keep_local']:
                path.unlink(missing_ok=True)
                moved += 1
            if verified % 100 == 0:
                self.stdout.write(f'  {verified} verified ({human(moved_bytes)})')
            if options['limit'] and verified >= options['limit']:
                break

        if not dry_run and not options['keep_local']:
            self.prune_empty_dirs(base)

        verb = 'would move' if dry_run else 'verified in Azure'
        self.stdout.write(self.style.SUCCESS(
            f'{verified if not dry_run else moved} files {verb} ({human(moved_bytes)}); '
            f'{moved if not dry_run else 0} local copies removed; '
            f'{failed} failed; {skipped} skipped'
        ))
        if failed:
            self.stdout.write('Failed files keep their local copy — re-run to retry them.')

    def prune_empty_dirs(self, base):
        """Directories left behind once their files moved carry no information."""
        for path in sorted((p for p in base.rglob('*') if p.is_dir()), reverse=True):
            try:
                next(path.iterdir())
            except StopIteration:
                path.rmdir()
            except OSError:
                pass
