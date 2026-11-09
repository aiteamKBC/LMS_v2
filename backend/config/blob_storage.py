"""Object storage backend switch: Azure Blob Storage (default) or Amazon S3.

``STORAGE_BACKEND`` selects where object bytes live:

* ``azure`` (default) - every call goes to the real Azure SDK, unchanged.
* ``s3`` - the same Azure-shaped client API is served from one S3 bucket.

The application keeps speaking the Azure vocabulary in S3 mode. Stored database
values such as ``https://<account>.blob.core.windows.net/<container>/<blob>``
stay valid because each (account, container, blob) triple maps to the S3 key
``<account>/<container>/<blob>`` in ``AWS_S3_STORAGE_BUCKET``. The account names
(``AZURE_STORAGE_ACCOUNT`` / ``AZURE_MATERIALS_STORAGE_ACCOUNT``) therefore remain
required in S3 mode as key namespaces, but no Azure key is needed.

S3 credentials come only from the default AWS credential chain (the ECS task
role in production). Nothing here accepts or stores AWS access keys.

Failures in S3 mode are raised as the ``azure.core.exceptions`` types callers
already catch (``ResourceNotFoundError``, ``ResourceExistsError``,
``HttpResponseError``, ``ServiceRequestError``, ``ServiceResponseError``).

Behaviour notes for S3 mode:

* Containers are key prefixes. ``create_container`` is a no-op and a container
  "exists" when the bucket is reachable.
* A missing object reports ``ContainerNotFound`` (instead of ``BlobNotFound``)
  when no object at all exists under its container prefix, matching the Azure
  distinction some audit fallbacks rely on.
* Copies are synchronous, so ``properties.copy.status`` is always ``success``.
* ``overwrite=False`` is enforced by S3 conditional writes (``If-None-Match``).
"""
from __future__ import annotations

import io
import os
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from urllib.parse import quote, unquote, urlparse

from azure.core.exceptions import (
    ClientAuthenticationError,
    HttpResponseError,
    ResourceExistsError,
    ResourceNotFoundError,
    ServiceRequestError,
    ServiceResponseError,
)
from azure.storage.blob import ContentSettings
from django.conf import settings

__all__ = [
    'BlobServiceClient', 'ContentSettings', 'S3BlobServiceClient',
    'account_name_from_url', 'connection_string_parts',
    'object_key', 'presigned_read_url', 's3_bucket', 's3_client', 's3_enabled',
    'storage_backend', 'storage_configured',
]

AZURE_HOST_SUFFIX = '.blob.core.windows.net'
#: Below this size an upload is one PUT; above it, a multipart upload.
SINGLE_PUT_MAX_BYTES = 16 * 1024 * 1024
#: Part size for multipart uploads (S3 allows at most 10,000 parts: ~160 GiB).
MULTIPART_PART_BYTES = 16 * 1024 * 1024
#: S3 CopyObject handles sources up to 5 GiB; larger ones use a managed copy.
COPY_OBJECT_MAX_BYTES = 5 * 1024 * 1024 * 1024
DEFAULT_DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024
#: SigV4 presigned URLs may not outlive seven days.
PRESIGN_MAX_SECONDS = 7 * 24 * 60 * 60


# --------------------------------------------------------------- configuration

def storage_backend() -> str:
    return (getattr(settings, 'STORAGE_BACKEND', '') or 'azure').strip().lower()


def s3_enabled() -> bool:
    return storage_backend() == 's3'


def s3_bucket() -> str:
    return (getattr(settings, 'AWS_S3_STORAGE_BUCKET', '') or '').strip()


def storage_configured(account_name, account_key='') -> bool:
    """Whether objects for ``account_name`` can be read and written.

    Azure needs the account key; S3 needs only the bucket (credentials come
    from the task role) plus the account name, which namespaces the keys.
    """
    if s3_enabled():
        return bool(account_name and s3_bucket())
    return bool(account_name and account_key)


def connection_string_parts(connection_string) -> dict:
    parts = {}
    for chunk in str(connection_string or '').split(';'):
        if '=' in chunk:
            key, value = chunk.split('=', 1)
            parts[key.strip()] = value.strip()
    return parts


def account_name_from_url(account_url) -> str:
    host = (urlparse(str(account_url or '')).hostname or '').lower()
    if not host.endswith(AZURE_HOST_SUFFIX) or host.count('.') != 4:
        raise ValueError('Expected an https://<account>.blob.core.windows.net account URL.')
    return host.split('.', 1)[0]


def object_key(account_name, container, blob_name) -> str:
    """The S3 key that holds Azure blob ``account/container/blob``."""
    account = str(account_name or '').strip().lower()
    container = str(container or '').strip()
    if not account or not container or not blob_name:
        raise ValueError('Account, container and blob name are all required.')
    return f'{account}/{container}/{blob_name}'


def _known_accounts() -> set:
    accounts = {
        getattr(settings, 'AZURE_STORAGE_ACCOUNT', ''),
        getattr(settings, 'AZURE_MATERIALS_STORAGE_ACCOUNT', ''),
    }
    accounts.add(connection_string_parts(os.environ.get('AZURE_STORAGE_CONNECTION_STRING', '')).get('AccountName', ''))
    return {str(a).strip().lower() for a in accounts if a}


def _parse_azure_blob_url(url):
    """``(account, container, blob)`` for an Azure blob URL of a known account."""
    parsed = urlparse(str(url or ''))
    host = (parsed.hostname or '').lower()
    if parsed.scheme != 'https' or not host.endswith(AZURE_HOST_SUFFIX) or host.count('.') != 4:
        return None
    account = host.split('.', 1)[0]
    if account not in _known_accounts():
        return None
    path = parsed.path.lstrip('/')
    if '/' not in path:
        return None
    container, encoded = path.split('/', 1)
    blob_name = unquote(encoded)
    return (account, container, blob_name) if container and blob_name else None


# ------------------------------------------------------------------ S3 client

_clients = {}
_clients_lock = threading.Lock()


def s3_client(*, connect_timeout=None, read_timeout=None, retry_total=None):
    """A cached, thread-safe boto3 S3 client using the default credential chain."""
    key = (
        getattr(settings, 'AWS_S3_STORAGE_REGION', '') or 'eu-west-2',
        getattr(settings, 'AWS_S3_STORAGE_ENDPOINT_URL', '') or None,
        connect_timeout, read_timeout, retry_total,
    )
    client = _clients.get(key)
    if client is not None:
        return client
    with _clients_lock:
        client = _clients.get(key)
        if client is None:
            import boto3
            from botocore.config import Config

            options = {
                'signature_version': 's3v4',
                's3': {'addressing_style': 'virtual'},
                'max_pool_connections': 32,
            }
            if connect_timeout is not None:
                options['connect_timeout'] = connect_timeout
            if read_timeout is not None:
                options['read_timeout'] = read_timeout
            if retry_total is not None:
                options['retries'] = {'mode': 'standard', 'total_max_attempts': int(retry_total) + 1}
            else:
                options['retries'] = {'mode': 'standard'}
            client = boto3.client('s3', region_name=key[0], endpoint_url=key[1], config=Config(**options))
            _clients[key] = client
    return client


def _require_bucket() -> str:
    bucket = s3_bucket()
    if not bucket:
        raise ServiceRequestError(message='AWS_S3_STORAGE_BUCKET is not configured.')
    return bucket


def _azure_error(exc):
    """Translate a botocore failure into the azure.core type callers catch."""
    from botocore.exceptions import (
        ClientError, ConnectTimeoutError, EndpointConnectionError, NoCredentialsError,
        ReadTimeoutError, ResponseStreamingError,
    )

    if isinstance(exc, ClientError):
        error = exc.response.get('Error') or {}
        code = str(error.get('Code') or '')
        status = (exc.response.get('ResponseMetadata') or {}).get('HTTPStatusCode')
        if status == 404 or code in ('NoSuchKey', 'NotFound', '404', 'NoSuchBucket'):
            azure_code = 'ContainerNotFound' if code == 'NoSuchBucket' else 'BlobNotFound'
            result = ResourceNotFoundError(message=f'The specified object does not exist.\nErrorCode:{azure_code}')
        elif status == 412 or code in ('PreconditionFailed', 'ConditionalRequestConflict'):
            azure_code = 'BlobAlreadyExists'
            result = ResourceExistsError(message=f'The specified blob already exists.\nErrorCode:{azure_code}')
        elif status == 403 or code in ('AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch', 'ExpiredToken'):
            azure_code = 'AuthorizationFailure'
            result = ClientAuthenticationError(message=f'S3 refused the request ({code or status}).\nErrorCode:{azure_code}')
        else:
            azure_code = code or 'S3Error'
            result = HttpResponseError(message=f'S3 request failed ({code or status}).\nErrorCode:{azure_code}')
        result.status_code = status
        result.error_code = azure_code
        return result
    if isinstance(exc, NoCredentialsError):
        return ClientAuthenticationError(message='No AWS credentials are available for S3.')
    if isinstance(exc, (ReadTimeoutError, ResponseStreamingError)):
        return ServiceResponseError(message=f'S3 response failed ({type(exc).__name__}).')
    if isinstance(exc, (ConnectTimeoutError, EndpointConnectionError)):
        return ServiceRequestError(message=f'S3 is unreachable ({type(exc).__name__}).')
    return ServiceRequestError(message=f'S3 request failed ({type(exc).__name__}).')


@contextmanager
def _translated():
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        yield
    except (ClientError, BotoCoreError) as exc:
        raise _azure_error(exc) from exc


# ------------------------------------------------------------ small value types

class _Props:
    """Attribute object that also supports dict-style reads, like the SDK models.

    Not a dict subclass: fields such as ``copy`` must not resolve to dict methods.
    """

    def __init__(self, **fields):
        self.__dict__.update(fields)

    def __getitem__(self, name):
        try:
            return getattr(self, name)
        except AttributeError:
            raise KeyError(name) from None

    def __setitem__(self, name, value):
        setattr(self, name, value)

    def __contains__(self, name):
        return name in self.__dict__

    def get(self, name, default=None):
        return getattr(self, name, default)

    def keys(self):
        return self.__dict__.keys()

    def __repr__(self):
        return f'{type(self).__name__}({self.__dict__!r})'


def _content_settings_from(response) -> ContentSettings:
    return ContentSettings(
        content_type=response.get('ContentType'),
        content_encoding=response.get('ContentEncoding'),
        content_language=response.get('ContentLanguage'),
        content_disposition=response.get('ContentDisposition'),
        cache_control=response.get('CacheControl'),
    )


def _blob_properties(container, blob_name, response, *, size=None) -> _Props:
    last_modified = response.get('LastModified')
    return _Props(
        name=blob_name,
        container=container,
        size=int(response.get('ContentLength') or 0) if size is None else size,
        etag=response.get('ETag'),
        last_modified=last_modified,
        creation_time=last_modified,
        content_settings=_content_settings_from(response),
        metadata=dict(response.get('Metadata') or {}),
        blob_type='BlockBlob',
        copy=_Props(status='success', id=None, progress=None, source=None),
    )


def _put_args(content_settings=None, metadata=None) -> dict:
    args = {'ContentType': 'application/octet-stream'}
    if content_settings is not None:
        for attribute, name in (('content_type', 'ContentType'), ('content_encoding', 'ContentEncoding'),
                                ('content_language', 'ContentLanguage'),
                                ('content_disposition', 'ContentDisposition'),
                                ('cache_control', 'CacheControl')):
            value = getattr(content_settings, attribute, None)
            if value:
                args[name] = value
    if metadata:
        args['Metadata'] = {str(k): str(v) for k, v in metadata.items()}
    return args


class _IterReader(io.RawIOBase):
    """File-like reader over an iterable of bytes (e.g. Django's ``.chunks()``)."""

    def __init__(self, iterable):
        self._iterator = iter(iterable)
        self._buffer = b''

    def readable(self):
        return True

    def readinto(self, target):
        while not self._buffer:
            try:
                chunk = next(self._iterator)
            except StopIteration:
                return 0
            self._buffer = chunk.encode('utf-8') if isinstance(chunk, str) else bytes(chunk)
        size = min(len(target), len(self._buffer))
        target[:size] = self._buffer[:size]
        self._buffer = self._buffer[size:]
        return size


class _LimitedReader(io.RawIOBase):
    def __init__(self, stream, limit):
        self._stream = stream
        self._remaining = int(limit)

    def readable(self):
        return True

    def readinto(self, target):
        if self._remaining <= 0:
            return 0
        data = self._stream.read(min(len(target), self._remaining))
        if not data:
            return 0
        target[:len(data)] = data
        self._remaining -= len(data)
        return len(data)


def _as_reader(data, length=None, encoding='UTF-8'):
    if isinstance(data, str):
        data = data.encode(encoding)
    if isinstance(data, (bytes, bytearray, memoryview)):
        reader = io.BytesIO(bytes(data))
    elif hasattr(data, 'read'):
        reader = data
    elif hasattr(data, '__iter__'):
        reader = _IterReader(data)
    else:
        raise TypeError(f'Unsupported upload data type: {type(data).__name__}')
    return _LimitedReader(reader, length) if length is not None else reader


def _read_exactly(reader, size) -> bytes:
    parts, remaining = [], size
    while remaining > 0:
        chunk = reader.read(remaining)
        if not chunk:
            break
        if isinstance(chunk, str):
            chunk = chunk.encode('utf-8')
        parts.append(chunk)
        remaining -= len(chunk)
    return b''.join(parts)


# --------------------------------------------------------------- S3 clients

class S3BlobServiceClient:
    """Azure ``BlobServiceClient`` surface backed by one S3 bucket."""

    def __init__(self, account_name, *, connection_timeout=None, read_timeout=None,
                 retry_total=None, max_single_get_size=None, max_chunk_get_size=None, **_ignored):
        self.account_name = str(account_name or '').strip().lower()
        if not self.account_name:
            raise ValueError('An Azure storage account name is required to address objects in S3.')
        self.url = f'https://{self.account_name}{AZURE_HOST_SUFFIX}/'
        self._timeouts = (connection_timeout, read_timeout)
        self._retry_total = retry_total
        self._chunk_bytes = max_chunk_get_size or DEFAULT_DOWNLOAD_CHUNK_BYTES

    def _client(self, kwargs=None):
        kwargs = kwargs or {}
        return s3_client(
            connect_timeout=kwargs.get('connection_timeout', self._timeouts[0]),
            read_timeout=kwargs.get('read_timeout', self._timeouts[1]),
            retry_total=kwargs.get('retry_total', self._retry_total),
        )

    def get_blob_client(self, container, blob, snapshot=None, **_ignored):
        return S3BlobClient(self, _name(container), blob)

    def get_container_client(self, container):
        return S3ContainerClient(self, _name(container))

    def create_container(self, name, **kwargs):
        client = self.get_container_client(name)
        client.create_container(**kwargs)
        return client

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()


def _name(value):
    return getattr(value, 'name', value)


class S3ContainerClient:
    def __init__(self, service, container):
        self._service = service
        self.account_name = service.account_name
        self.container_name = container
        self.url = f'{service.url}{quote(container, safe="")}'

    def _prefix(self):
        return object_key(self.account_name, self.container_name, 'x')[:-1]

    def get_blob_client(self, blob, **_ignored):
        return S3BlobClient(self._service, self.container_name, _name(blob))

    def exists(self, **kwargs) -> bool:
        with _translated():
            self._service._client(kwargs).head_bucket(Bucket=_require_bucket())
        return True

    def create_container(self, **_kwargs):
        """Containers are key prefixes in S3; nothing to create."""
        return {}

    def get_container_properties(self, **kwargs):
        self.exists(**kwargs)
        return _Props(name=self.container_name, public_access=None, metadata={},
                      last_modified=None, etag=None)

    def list_blobs(self, name_starts_with=None, include=None, **kwargs):
        include = {include} if isinstance(include, str) else set(include or ())
        prefix = self._prefix()
        client = self._service._client(kwargs)
        paginator = client.get_paginator('list_objects_v2')
        with _translated():
            for page in paginator.paginate(Bucket=_require_bucket(), Prefix=prefix + (name_starts_with or '')):
                for item in page.get('Contents', ()):
                    blob = _ListedBlob(self.get_blob_client(item['Key'][len(prefix):]), item)
                    if 'metadata' in include:
                        blob.metadata  # noqa: B018 - eager load requested by caller
                    yield blob

    def upload_blob(self, name, data, **kwargs):
        client = self.get_blob_client(name)
        client.upload_blob(data, **kwargs)
        return client

    def download_blob(self, blob, offset=None, length=None, **kwargs):
        return self.get_blob_client(blob).download_blob(offset=offset, length=length, **kwargs)

    def delete_blob(self, blob, delete_snapshots=None, **kwargs):
        return self.get_blob_client(blob).delete_blob(delete_snapshots=delete_snapshots, **kwargs)

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()


class _ListedBlob(_Props):
    """Listing entry; content settings and metadata load on first access."""

    def __init__(self, blob_client, item):
        super().__init__(
            name=blob_client.blob_name, container=blob_client.container_name,
            size=int(item.get('Size') or 0), etag=item.get('ETag'),
            last_modified=item.get('LastModified'), creation_time=item.get('LastModified'),
            blob_type='BlockBlob', _client=blob_client,
        )

    def __getattr__(self, name):
        # Only called for attributes not yet set.
        if name in ('content_settings', 'metadata'):
            properties = self._client.get_blob_properties()
            self.content_settings = properties.content_settings
            self.metadata = properties.metadata
            return getattr(self, name)
        raise AttributeError(name)


class S3BlobClient:
    def __init__(self, service, container, blob_name):
        self._service = service
        self.account_name = service.account_name
        self.container_name = container
        self.blob_name = blob_name
        self.key = object_key(self.account_name, container, blob_name)
        self.url = f'{service.url}{quote(container, safe="")}/{quote(blob_name, safe="/~")}'

    def _client(self, kwargs=None):
        return self._service._client(kwargs)

    # -- reads ---------------------------------------------------------
    def exists(self, **kwargs) -> bool:
        try:
            self._head(kwargs)
        except ResourceNotFoundError:
            return False
        return True

    def _head(self, kwargs=None):
        with _translated():
            return self._client(kwargs).head_object(Bucket=_require_bucket(), Key=self.key)

    def _not_found(self, error):
        """Report ContainerNotFound when nothing at all lives under the prefix."""
        prefix = object_key(self.account_name, self.container_name, 'x')[:-1]
        try:
            with _translated():
                listing = self._client().list_objects_v2(Bucket=_require_bucket(), Prefix=prefix, MaxKeys=1)
        except Exception:  # The original not-found error is the meaningful one.
            return error
        if not listing.get('KeyCount'):
            result = ResourceNotFoundError(message='The specified container does not exist.\nErrorCode:ContainerNotFound')
            result.status_code = 404
            result.error_code = 'ContainerNotFound'
            return result
        return error

    def get_blob_properties(self, **kwargs):
        try:
            response = self._head(kwargs)
        except ResourceNotFoundError as error:
            raise self._not_found(error) from error
        return _blob_properties(self.container_name, self.blob_name, response)

    def download_blob(self, offset=None, length=None, *, encoding=None, **kwargs):
        try:
            return S3BlobDownloader(self, offset, length, encoding, kwargs)
        except ResourceNotFoundError as error:
            raise self._not_found(error) from error

    # -- writes --------------------------------------------------------
    def upload_blob(self, data, blob_type=None, length=None, metadata=None, *, overwrite=False,
                    content_settings=None, progress_hook=None, encoding='UTF-8', **kwargs):
        reader = _as_reader(data, length=length, encoding=encoding)
        args = _put_args(content_settings, metadata)
        if not overwrite:
            args['IfNoneMatch'] = '*'
        client = self._client(kwargs)
        bucket = _require_bucket()
        first = _read_exactly(reader, SINGLE_PUT_MAX_BYTES + 1)
        if len(first) <= SINGLE_PUT_MAX_BYTES:
            with _translated():
                response = client.put_object(Bucket=bucket, Key=self.key, Body=first, **args)
            if progress_hook:
                progress_hook(len(first), len(first))
            return {'etag': response.get('ETag'), 'last_modified': None}
        return self._multipart(client, bucket, reader, first, args, progress_hook, length)

    def _multipart(self, client, bucket, reader, first, args, progress_hook, total):
        conditional = {k: args.pop(k) for k in ('IfNoneMatch',) if k in args}
        with _translated():
            upload_id = client.create_multipart_upload(Bucket=bucket, Key=self.key, **args)['UploadId']
        try:
            parts, number, sent = [], 1, 0
            pending = first
            while pending:
                body, pending = pending[:MULTIPART_PART_BYTES], pending[MULTIPART_PART_BYTES:]
                if len(pending) < MULTIPART_PART_BYTES:
                    pending += _read_exactly(reader, MULTIPART_PART_BYTES * 2 - len(pending))
                with _translated():
                    etag = client.upload_part(Bucket=bucket, Key=self.key, UploadId=upload_id,
                                              PartNumber=number, Body=body)['ETag']
                parts.append({'ETag': etag, 'PartNumber': number})
                sent += len(body)
                number += 1
                if progress_hook:
                    progress_hook(sent, total)
            with _translated():
                response = client.complete_multipart_upload(
                    Bucket=bucket, Key=self.key, UploadId=upload_id,
                    MultipartUpload={'Parts': parts}, **conditional,
                )
        except BaseException:
            try:
                client.abort_multipart_upload(Bucket=bucket, Key=self.key, UploadId=upload_id)
            except Exception:  # Abort is best effort; the bucket lifecycle rule cleans up.
                pass
            raise
        return {'etag': response.get('ETag'), 'last_modified': None}

    def delete_blob(self, delete_snapshots=None, **kwargs):
        # S3 deletes are idempotent; Azure reports a missing blob, so check first.
        self.get_blob_properties(**kwargs)
        with _translated():
            self._client(kwargs).delete_object(Bucket=_require_bucket(), Key=self.key)

    def start_copy_from_url(self, source_url, metadata=None, **kwargs):
        source = _parse_azure_blob_url(source_url)
        if source is None:
            self.upload_blob_from_url(source_url, overwrite=True, **kwargs)
        else:
            self._copy_object(object_key(*source), overwrite=True, kwargs=kwargs)
        return {'copy_status': 'success', 'copy_id': None}

    def upload_blob_from_url(self, source_url, *, overwrite=False, content_settings=None, **kwargs):
        source = _parse_azure_blob_url(source_url)
        if source is not None:
            return self._copy_object(object_key(*source), overwrite=overwrite,
                                     content_settings=content_settings, kwargs=kwargs)
        parsed = urlparse(str(source_url or ''))
        if parsed.scheme != 'https' or not parsed.hostname:
            raise ValueError('Copy sources must be HTTPS URLs.')
        if not overwrite and self.exists():
            raise ResourceExistsError(message='The specified blob already exists.\nErrorCode:BlobAlreadyExists')
        timeout = kwargs.get('read_timeout') or kwargs.get('timeout') or 600
        try:
            # The URL may be pre-authenticated: never log it or put it in errors.
            response = urllib.request.urlopen(urllib.request.Request(str(source_url)), timeout=timeout)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise HttpResponseError(message=f'The copy source returned HTTP {status}.') from None
        except OSError as error:
            raise ServiceRequestError(message=f'The copy source could not be read ({type(error).__name__}).') from None
        with response:
            if content_settings is None:
                content_settings = ContentSettings(content_type=response.headers.get_content_type())
            try:
                return self.upload_blob(response, overwrite=overwrite, content_settings=content_settings,
                                        **{k: v for k, v in kwargs.items() if k in ('connection_timeout', 'read_timeout')})
            except OSError as error:
                raise ServiceResponseError(
                    message=f'The copy source stream failed ({type(error).__name__}).') from None

    def _copy_object(self, source_key, *, overwrite, content_settings=None, kwargs=None):
        bucket = _require_bucket()
        client = self._client(kwargs)
        with _translated():
            head = client.head_object(Bucket=bucket, Key=source_key)
        conditional = {} if overwrite else {'IfNoneMatch': '*'}
        if int(head.get('ContentLength') or 0) <= COPY_OBJECT_MAX_BYTES:
            args = {}
            if content_settings is not None:
                args = _put_args(content_settings, head.get('Metadata'))
                args['MetadataDirective'] = 'REPLACE'
            with _translated():
                response = client.copy_object(Bucket=bucket, Key=self.key,
                                              CopySource={'Bucket': bucket, 'Key': source_key},
                                              **args, **conditional)
            return {'etag': (response.get('CopyObjectResult') or {}).get('ETag'), 'copy_status': 'success'}
        if not overwrite and self.exists():
            raise ResourceExistsError(message='The specified blob already exists.\nErrorCode:BlobAlreadyExists')
        extra = _put_args(content_settings or _content_settings_from(head), head.get('Metadata'))
        with _translated():
            client.copy({'Bucket': bucket, 'Key': source_key}, bucket, self.key, ExtraArgs=extra)
        return {'etag': None, 'copy_status': 'success'}

    def close(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()


class S3BlobDownloader:
    """Azure ``StorageStreamDownloader`` surface over ``get_object``."""

    def __init__(self, blob_client, offset, length, encoding, kwargs):
        self.name = blob_client.blob_name
        self.container = blob_client.container_name
        self._encoding = encoding
        self._chunk_bytes = blob_client._service._chunk_bytes
        request = {'Bucket': _require_bucket(), 'Key': blob_client.key}
        if offset is not None or length is not None:
            start = int(offset or 0)
            request['Range'] = f'bytes={start}-' if length is None else f'bytes={start}-{start + int(length) - 1}'
        client = blob_client._client(kwargs)
        try:
            with _translated():
                response = client.get_object(**request)
        except HttpResponseError as error:
            if getattr(error, 'status_code', None) != 416:
                raise
            # Azure returns an empty body for a ranged read of an empty blob.
            head = blob_client._head(kwargs)
            if int(head.get('ContentLength') or 0) != 0:
                raise
            response = dict(head, Body=None, ContentLength=0)
        self._body = response.get('Body')
        self.size = int(response.get('ContentLength') or 0)
        total = self.size
        content_range = response.get('ContentRange') or ''
        if '/' in content_range and content_range.rsplit('/', 1)[1].isdigit():
            total = int(content_range.rsplit('/', 1)[1])
        self.properties = _blob_properties(self.container, self.name, response, size=total)

    def chunks(self):
        if self._body is None:
            return
        try:
            with _translated():
                for chunk in self._body.iter_chunks(chunk_size=self._chunk_bytes):
                    if chunk:
                        yield chunk
        finally:
            self.close()

    def __iter__(self):
        return self.chunks()

    def readall(self):
        content = b''.join(self.chunks())
        return content.decode(self._encoding) if self._encoding else content

    def content_as_bytes(self, max_concurrency=1):
        return b''.join(self.chunks())

    def content_as_text(self, max_concurrency=1, encoding='UTF-8'):
        return self.content_as_bytes().decode(encoding)

    def readinto(self, stream):
        count = 0
        for chunk in self.chunks():
            stream.write(chunk)
            count += len(chunk)
        return count

    def close(self):
        if self._body is not None:
            self._body.close()


# ----------------------------------------------------------- public factory

class BlobServiceClient:
    """Drop-in for ``azure.storage.blob.BlobServiceClient`` honouring STORAGE_BACKEND."""

    def __new__(cls, account_url, credential=None, **kwargs):
        if s3_enabled():
            return S3BlobServiceClient(account_name_from_url(account_url), **kwargs)
        # Looked up per call so tests patching the SDK class keep working.
        from azure.storage.blob import BlobServiceClient as AzureBlobServiceClient
        return AzureBlobServiceClient(account_url, credential=credential, **kwargs)

    @staticmethod
    def from_connection_string(conn_str, credential=None, **kwargs):
        if s3_enabled():
            return S3BlobServiceClient(connection_string_parts(conn_str).get('AccountName'), **kwargs)
        from azure.storage.blob import BlobServiceClient as AzureBlobServiceClient
        return AzureBlobServiceClient.from_connection_string(conn_str, credential=credential, **kwargs)


# ---------------------------------------------------------------- read URLs

def presigned_read_url(account_name, container, blob_name, *, ttl_minutes, content_disposition=None,
                       content_type=None) -> str:
    """Short-lived S3 GET URL with optional signed response headers."""
    params = {'Bucket': _require_bucket(), 'Key': object_key(account_name, container, blob_name)}
    if content_disposition:
        params['ResponseContentDisposition'] = content_disposition
    if content_type:
        params['ResponseContentType'] = content_type
    seconds = max(60, min(PRESIGN_MAX_SECONDS, int(round(float(ttl_minutes) * 60))))
    with _translated():
        return s3_client().generate_presigned_url('get_object', Params=params, ExpiresIn=seconds)

