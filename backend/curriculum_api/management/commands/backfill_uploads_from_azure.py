"""Download curriculum blobs to the LMS media directory for local-first reads.

The curriculum serving path already checks local disk before Azure.  This command
warms that local copy without changing any database URLs.  Downloads use a
``.part`` file followed by an atomic replace, so interrupted runs are safe to
resume and can never expose a truncated media file.
"""
from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

from django.core.management.base import BaseCommand, CommandError

from curriculum_api import upload_storage
from curriculum_api.views import COMPONENT_UPLOAD_ROOT


def human(byte_count):
    value = float(byte_count)
    for unit in ('B', 'KiB', 'MiB', 'GiB', 'TiB'):
        if value < 1024 or unit == 'TiB':
            return f'{value:.1f} {unit}'
        value /= 1024


class Command(BaseCommand):
    help = 'Backfill Azure curriculum uploads onto local disk for local-first serving.'

    def add_arguments(self, parser):
        parser.add_argument('--prefix', default='', help='Only download blobs under this prefix.')
        parser.add_argument('--workers', type=int, default=8,
                            help='Parallel downloads (default: 8).')
        parser.add_argument('--limit', type=int, default=None,
                            help='Process at most this many missing or incomplete blobs.')
        parser.add_argument('--dry-run', action='store_true',
                            help='List totals without downloading anything.')

    def handle(self, *args, **options):
        if not upload_storage.azure_enabled():
            raise CommandError(
                'Azure curriculum storage is not configured. Check the storage account, '
                'key and AZURE_CURRICULUM_CONTAINER settings.'
            )
        workers = options['workers']
        if workers < 1 or workers > 32:
            raise CommandError('--workers must be between 1 and 32.')

        root = upload_storage.local_path(COMPONENT_UPLOAD_ROOT)
        if root is None:
            raise CommandError('The curriculum upload root is outside MEDIA_ROOT.')
        root.mkdir(parents=True, exist_ok=True)
        root = root.resolve()

        # Azure's HTTP policy logs one entry per request at INFO in this project;
        # thousands of those hide the useful progress output.
        logging.getLogger('azure.core.pipeline.policies.http_logging_policy').setLevel(logging.WARNING)

        container = upload_storage.container_name()
        service = upload_storage.evidence_storage._service_client(retry_total=3)
        client = service.get_container_client(container)
        blobs = list(client.list_blobs(name_starts_with=options['prefix'] or None))
        remote_bytes = sum(blob.size or 0 for blob in blobs)

        pending = []
        present = present_bytes = 0
        for blob in blobs:
            destination = self.destination_for(root, blob.name)
            if destination is None:
                self.stderr.write(f'Unsafe blob name skipped: {blob.name!r}')
                continue
            if destination.is_file() and destination.stat().st_size == (blob.size or 0):
                present += 1
                present_bytes += blob.size or 0
            else:
                pending.append((blob.name, blob.size or 0, destination))

        if options['limit'] is not None:
            pending = pending[:max(options['limit'], 0)]
        pending_bytes = sum(item[1] for item in pending)
        self.stdout.write(
            f'Container: {container}\nLocal root: {root}\n'
            f'Remote: {len(blobs)} files ({human(remote_bytes)})\n'
            f'Already local: {present} files ({human(present_bytes)})\n'
            f'To download this run: {len(pending)} files ({human(pending_bytes)})'
        )
        if options['dry_run'] or not pending:
            return

        completed = failed = completed_bytes = 0
        output_lock = Lock()

        def download(item):
            blob_name, expected_size, destination = item
            destination.parent.mkdir(parents=True, exist_ok=True)
            part = destination.with_name(f'{destination.name}.part')
            try:
                with part.open('wb') as handle:
                    service.get_blob_client(container, blob_name).download_blob(
                        max_concurrency=1,
                    ).readinto(handle)
                actual_size = part.stat().st_size
                if actual_size != expected_size:
                    raise OSError(
                        f'size mismatch: expected {expected_size}, downloaded {actual_size}'
                    )
                os.replace(part, destination)
                return blob_name, expected_size, None
            except Exception as error:  # noqa: BLE001 - report and continue the sweep
                part.unlink(missing_ok=True)
                return blob_name, 0, error

        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(download, item) for item in pending]
            for future in as_completed(futures):
                blob_name, byte_count, error = future.result()
                with output_lock:
                    if error is not None:
                        failed += 1
                        self.stderr.write(f'  failed: {blob_name} ({error})')
                    else:
                        completed += 1
                        completed_bytes += byte_count
                        if completed % 100 == 0 or completed == len(pending):
                            self.stdout.write(
                                f'  {completed}/{len(pending)} downloaded '
                                f'({human(completed_bytes)})'
                            )

        self.stdout.write(self.style.SUCCESS(
            f'{completed} files downloaded ({human(completed_bytes)}); {failed} failed.'
        ))
        if failed:
            self.stdout.write('Re-run the same command to retry only missing files.')

    @staticmethod
    def destination_for(root: Path, blob_name: str) -> Path | None:
        """Resolve a blob below root; reject traversal and directory-like names."""
        if not blob_name or blob_name.endswith('/'):
            return None
        candidate = (root / Path(blob_name.replace('\\', '/'))).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        return candidate
