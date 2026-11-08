"""Copy every blob from the configured Azure storage accounts into S3.

Each blob ``<account>/<container>/<name>`` is written to the S3 key of the same
name in AWS_S3_STORAGE_BUCKET (see config/blob_storage.py), with its content
type, disposition, cache control, encoding, language and metadata.

The copy is incremental: an object already in S3 with the same size and an S3
timestamp no older than the Azure blob's last modification is skipped. Run it
once ahead of time, then again just before switching STORAGE_BACKEND to s3.

Azure is only read, never changed. Objects that exist only in S3 are reported
but never deleted. Secrets and signed URLs are never printed.

    python manage.py copy_azure_blobs_to_s3 --dry-run
    python manage.py copy_azure_blobs_to_s3 --workers 8
    python manage.py copy_azure_blobs_to_s3 --account <name> --container <name>
"""
import io
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from config import blob_storage

PART_BYTES = 16 * 1024 * 1024


def azure_sources():
    """``[(account, service_factory_or_None)]`` for every configured Azure account.

    The real Azure SDK is used regardless of STORAGE_BACKEND: this command
    always reads from Azure, including during the final pre-switch run.
    """
    from azure.storage.blob import BlobServiceClient as AzureBlobServiceClient

    sources = {}

    def account_url(account):
        return f'https://{account}{blob_storage.AZURE_HOST_SUFFIX}'

    for account, key in (
        (settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_STORAGE_KEY),
        (getattr(settings, 'AZURE_MATERIALS_STORAGE_ACCOUNT', ''), getattr(settings, 'AZURE_MATERIALS_STORAGE_KEY', '')),
    ):
        account = (account or '').strip().lower()
        if account and account not in sources:
            sources[account] = (
                (lambda url=account_url(account), key=key: AzureBlobServiceClient(url, credential=key, retry_total=3))
                if key else None
            )
    connection_string = os.environ.get('AZURE_STORAGE_CONNECTION_STRING', '').strip()
    account = blob_storage.connection_string_parts(connection_string).get('AccountName', '').strip().lower()
    if account and sources.get(account) is None:
        sources[account] = lambda cs=connection_string: AzureBlobServiceClient.from_connection_string(cs, retry_total=3)
    return sources


def s3_inventory(s3, bucket, prefix):
    """``{name: (size, last_modified)}`` for every S3 object under ``prefix``."""
    inventory = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get('Contents', ()):
            inventory[item['Key'][len(prefix):]] = (int(item['Size']), item['LastModified'])
    return inventory


def up_to_date(blob, existing):
    if existing is None:
        return False
    size, s3_modified = existing
    azure_modified = getattr(blob, 'last_modified', None)
    return size == int(blob.size or 0) and (azure_modified is None or s3_modified >= azure_modified)


def copy_blob(service, s3, bucket, account, container, blob):
    """Stream one blob from Azure to S3 and verify the stored size."""
    from boto3.s3.transfer import TransferConfig

    key = blob_storage.object_key(account, container, blob.name)
    extra = blob_storage._put_args(blob.content_settings, blob.metadata)
    downloader = service.get_blob_client(container, blob.name).download_blob(max_concurrency=1)
    # s3transfer reads a non-seekable stream with single read(n) calls and
    # treats a short read as the end of the first part: a raw reader that
    # returns one 4 MB Azure chunk makes it pick a single PutObject and then
    # read the whole blob into memory, which exhausts memory on recordings.
    # BufferedReader.read(n) returns n bytes unless the stream has ended.
    reader = io.BufferedReader(blob_storage._IterReader(downloader.chunks()))
    config = TransferConfig(
        multipart_threshold=PART_BYTES, multipart_chunksize=PART_BYTES, max_concurrency=2, use_threads=True,
    )
    # Parts held in memory per transfer (default 10); bounds memory per worker.
    config.max_in_memory_upload_chunks = 4
    s3.upload_fileobj(reader, bucket, key, ExtraArgs=extra, Config=config)
    stored = int(s3.head_object(Bucket=bucket, Key=key)['ContentLength'])
    if stored != int(blob.size or 0):
        raise ValueError(f'size mismatch after copy (azure {blob.size}, s3 {stored})')
    return stored


def describe_error(exc):
    """Error class and code only; SDK messages may echo request details."""
    code = getattr(exc, 'error_code', None) or (getattr(exc, 'response', None) or {}).get('Error', {}).get('Code')
    return f'{type(exc).__name__}{f" ({code})" if code else ""}'


class Command(BaseCommand):
    help = 'Copy all blobs from the configured Azure storage accounts to the S3 bucket (incremental).'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true', help='Count what would be copied; write nothing.')
        parser.add_argument('--account', action='append', default=[], help='Limit to this Azure account (repeatable).')
        parser.add_argument('--container', action='append', default=[], help='Limit to this container (repeatable).')
        parser.add_argument('--prefix', default='', help='Limit to blob names starting with this prefix.')
        parser.add_argument('--workers', type=int, default=4, help='Parallel copies (default 4).')
        parser.add_argument('--bucket', default='', help='Override AWS_S3_STORAGE_BUCKET.')

    def handle(self, *args, **options):
        # The SDKs log every request at INFO; that buries the summary lines.
        for name in ('azure', 'botocore', 'boto3', 's3transfer', 'urllib3'):
            logging.getLogger(name).setLevel(logging.WARNING)
        bucket = options['bucket'] or blob_storage.s3_bucket()
        if not bucket:
            raise CommandError('Set AWS_S3_STORAGE_BUCKET (or pass --bucket).')
        dry_run = options['dry_run']
        workers = max(1, min(32, options['workers']))
        wanted_accounts = {a.strip().lower() for a in options['account'] if a.strip()}
        wanted_containers = {c.strip() for c in options['container'] if c.strip()}
        sources = azure_sources()
        if wanted_accounts:
            unknown = wanted_accounts - set(sources)
            if unknown:
                raise CommandError(f'Not a configured Azure account: {", ".join(sorted(unknown))}')
            sources = {a: f for a, f in sources.items() if a in wanted_accounts}
        if not sources:
            raise CommandError('No Azure storage account is configured.')

        s3 = blob_storage.s3_client(retry_total=4)
        totals = dict(listed=0, current=0, pending=0, pending_bytes=0, copied=0, copied_bytes=0,
                      failed=0, s3_only=0)
        lock = threading.Lock()
        failed_accounts = []
        mode = 'DRY RUN - nothing will be written' if dry_run else 'copying'
        self.stdout.write(f'Azure -> s3://{bucket} ({mode})')

        for account, factory in sorted(sources.items()):
            if factory is None:
                self.stderr.write(f'{account}: skipped - no Azure key or connection string for this account')
                failed_accounts.append(account)
                continue
            service = factory()
            try:
                containers = [c.name for c in service.list_containers()]
            except Exception as exc:
                self.stderr.write(f'{account}: cannot list containers - {describe_error(exc)}')
                failed_accounts.append(account)
                continue
            for container in sorted(containers):
                if wanted_containers and container not in wanted_containers:
                    continue
                stats = self._container(service, s3, bucket, account, container, options['prefix'],
                                        dry_run, workers, lock)
                for name, value in stats.items():
                    totals[name] += value

        self.stdout.write(
            f"TOTAL: listed {totals['listed']}, already in S3 {totals['current']}, "
            + (f"would copy {totals['pending']} ({totals['pending_bytes']} bytes)" if dry_run else
               f"copied {totals['copied']} ({totals['copied_bytes']} bytes), failed {totals['failed']}")
            + f", only in S3 {totals['s3_only']}"
        )
        if totals['failed'] or failed_accounts:
            raise CommandError(
                f"{totals['failed']} blob(s) failed"
                + (f"; accounts not read: {', '.join(failed_accounts)}" if failed_accounts else '')
                + '. Re-run to retry; completed copies are skipped.'
            )

    def _container(self, service, s3, bucket, account, container, name_prefix, dry_run, workers, lock):
        stats = dict(listed=0, current=0, pending=0, pending_bytes=0, copied=0, copied_bytes=0,
                     failed=0, s3_only=0)
        prefix = blob_storage.object_key(account, container, 'x')[:-1]
        inventory = s3_inventory(s3, bucket, prefix + name_prefix)
        seen, todo = set(), []
        client = service.get_container_client(container)
        for blob in client.list_blobs(name_starts_with=name_prefix or None, include=['metadata']):
            stats['listed'] += 1
            seen.add(blob.name)
            if up_to_date(blob, inventory.get(blob.name)):
                stats['current'] += 1
            else:
                todo.append(blob)
                stats['pending'] += 1
                stats['pending_bytes'] += int(blob.size or 0)
        stats['s3_only'] = len(set(inventory) - seen)

        if not dry_run and todo:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(copy_blob, service, s3, bucket, account, container, blob): blob
                           for blob in todo}
                for future in as_completed(futures):
                    blob = futures[future]
                    try:
                        size = future.result()
                    except Exception as exc:
                        with lock:
                            stats['failed'] += 1
                            self.stderr.write(f'  FAILED {account}/{container}/{blob.name}: {describe_error(exc)}')
                    else:
                        stats['copied'] += 1
                        stats['copied_bytes'] += size

        self.stdout.write(
            f"{account}/{container}: listed {stats['listed']}, already in S3 {stats['current']}, "
            + (f"would copy {stats['pending']} ({stats['pending_bytes']} bytes)" if dry_run else
               f"copied {stats['copied']}, failed {stats['failed']}")
            + f", only in S3 {stats['s3_only']}"
        )
        return stats
