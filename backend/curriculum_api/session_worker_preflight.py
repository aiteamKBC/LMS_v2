"""Refuse storage-less workers before claiming or modifying the shared queue."""
import hashlib
import logging
import os
import socket

from django.conf import settings
from django.core.management.base import CommandError

log = logging.getLogger(__name__)


def archive_runtime_preflight():
    from config import blob_storage
    backend = blob_storage.storage_backend()
    runtime = 'ecs' if os.environ.get('ECS_CONTAINER_METADATA_URI_V4') or os.environ.get('ECS_CONTAINER_METADATA_URI') else 'standalone'
    instance = hashlib.sha256(socket.gethostname().encode()).hexdigest()[:12]
    origin = f'{runtime}:{instance}:{os.getpid()}:{backend if backend in {"s3", "azure"} else "unknown"}'
    try:
        if not blob_storage.storage_configured(settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_STORAGE_KEY):
            raise ValueError('Missing archive configuration')
        if backend == 's3':
            import boto3
            from botocore.exceptions import NoCredentialsError
            credentials = boto3.Session().get_credentials()
            if credentials is None:
                raise NoCredentialsError()
            # Resolve refreshable role credentials now, before queue mutations.
            credentials.get_frozen_credentials()
        elif backend != 'azure':
            raise ValueError('Unsupported archive backend')
    except Exception as error:
        # No provider text, settings, paths or credentials in command output.
        log.warning('Session worker preflight refused runtime=%s error_type=%s; no session jobs claimed.', origin, type(error).__name__)
        raise CommandError(f'Session worker storage preflight failed ({type(error).__name__}). No session jobs were claimed.') from None
    return origin
