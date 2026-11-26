"""S3 storage backend: Azure-shaped API over an in-memory S3 double.

No database and no network: the boto3 client is replaced by FakeS3, which
raises real botocore ClientErrors so error translation is exercised too.
Presigned URLs are computed locally by a real boto3 client with dummy keys.
"""
import io
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, unquote, urlparse

from azure.core.exceptions import (
    AzureError, ClientAuthenticationError, HttpResponseError, ResourceExistsError,
    ResourceNotFoundError,
)
from azure.storage.blob import ContentSettings
from botocore.exceptions import ClientError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from config import blob_storage
from learner_api import evidence_storage, material_storage

S3_SETTINGS = dict(
    STORAGE_BACKEND='s3', AWS_S3_STORAGE_BUCKET='lms-files-test', AWS_S3_STORAGE_REGION='eu-west-2',
    AWS_S3_STORAGE_ENDPOINT_URL='', AZURE_STORAGE_ACCOUNT='evidenceacct', AZURE_STORAGE_KEY='',
    AZURE_MATERIALS_STORAGE_ACCOUNT='materialsacct', AZURE_MATERIALS_STORAGE_KEY='',
    AZURE_SAS_TTL_MINUTES=15, AZURE_MATERIALS_SAS_TTL_MINUTES=15,
    AZURE_QUARANTINE_CONTAINER='evidence-quarantine', AZURE_APPROVED_CONTAINER='evidence-approved',
)


def client_error(status, code, operation='Op'):
    return ClientError({'Error': {'Code': code, 'Message': code},
                        'ResponseMetadata': {'HTTPStatusCode': status}}, operation)


class _Body:
    def __init__(self, data):
        self._stream = io.BytesIO(data)
        self.closed = False

    def iter_chunks(self, chunk_size=1024):
        while True:
            chunk = self._stream.read(chunk_size)
            if not chunk:
                return
            yield chunk

    def read(self):
        return self._stream.read()

    def close(self):
        self.closed = True


class _Paginator:
    def __init__(self, fake):
        self.fake = fake

    def paginate(self, Bucket, Prefix=''):
        keys = sorted(k for k in self.fake.objects if k.startswith(Prefix))
        for start in range(0, max(len(keys), 1), 2):  # two per page to exercise paging
            yield {'Contents': [self.fake._listing(k) for k in keys[start:start + 2]]}


class FakeS3:
    """The subset of the S3 client API config/blob_storage.py uses."""

    def __init__(self):
        self.objects = {}
        self.uploads = {}
        self.calls = []
        self.clock = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def _tick(self):
        self.clock += timedelta(seconds=1)
        return self.clock

    def _listing(self, key):
        obj = self.objects[key]
        return {'Key': key, 'Size': len(obj['data']), 'ETag': obj['etag'], 'LastModified': obj['modified']}

    def _store(self, key, data, args):
        headers = {k: v for k, v in args.items() if k in (
            'ContentType', 'ContentDisposition', 'CacheControl', 'ContentEncoding', 'ContentLanguage')}
        self.objects[key] = {'data': bytes(data), 'headers': headers, 'metadata': dict(args.get('Metadata') or {}),
                             'etag': f'"etag-{len(self.objects)}-{len(data)}"', 'modified': self._tick()}

    def _get(self, Bucket, Key):
        if Key not in self.objects:
            raise client_error(404, '404', 'HeadObject')
        return self.objects[Key]

    def _check_absent(self, key, conditions):
        if conditions.get('IfNoneMatch') == '*' and key in self.objects:
            raise client_error(412, 'PreconditionFailed', 'PutObject')

    def head_bucket(self, Bucket):
        self.calls.append(('head_bucket', Bucket))
        return {}

    def head_object(self, Bucket, Key):
        self.calls.append(('head_object', Key))
        obj = self._get(Bucket, Key)
        return {'ContentLength': len(obj['data']), 'ETag': obj['etag'], 'LastModified': obj['modified'],
                'Metadata': obj['metadata'], **obj['headers']}

    def get_object(self, Bucket, Key, Range=None):
        self.calls.append(('get_object', Key, Range))
        if Key not in self.objects:
            raise client_error(404, 'NoSuchKey', 'GetObject')
        obj = self.objects[Key]
        data, total = obj['data'], len(obj['data'])
        response = {'ETag': obj['etag'], 'LastModified': obj['modified'], 'Metadata': obj['metadata'],
                    **obj['headers']}
        if Range:
            start, _, end = Range[len('bytes='):].partition('-')
            start = int(start)
            if start >= total:
                raise client_error(416, 'InvalidRange', 'GetObject')
            end = min(int(end), total - 1) if end else total - 1
            data = data[start:end + 1]
            response['ContentRange'] = f'bytes {start}-{end}/{total}'
        response.update(ContentLength=len(data), Body=_Body(data))
        return response

    def put_object(self, Bucket, Key, Body, IfNoneMatch=None, **args):
        self.calls.append(('put_object', Key, IfNoneMatch))
        self._check_absent(Key, {'IfNoneMatch': IfNoneMatch})
        self._store(Key, Body, args)
        return {'ETag': self.objects[Key]['etag']}

    def create_multipart_upload(self, Bucket, Key, **args):
        self.calls.append(('create_multipart_upload', Key))
        upload_id = f'upload-{len(self.uploads)}'
        self.uploads[upload_id] = {'key': Key, 'args': args, 'parts': {}}
        return {'UploadId': upload_id}

    def upload_part(self, Bucket, Key, UploadId, PartNumber, Body):
        self.uploads[UploadId]['parts'][PartNumber] = bytes(Body)
        return {'ETag': f'"part-{PartNumber}"'}

    def complete_multipart_upload(self, Bucket, Key, UploadId, MultipartUpload, IfNoneMatch=None):
        self.calls.append(('complete_multipart_upload', Key, IfNoneMatch))
        self._check_absent(Key, {'IfNoneMatch': IfNoneMatch})
        upload = self.uploads.pop(UploadId)
        data = b''.join(upload['parts'][p['PartNumber']] for p in MultipartUpload['Parts'])
        self._store(Key, data, upload['args'])
        return {'ETag': self.objects[Key]['etag']}

    def abort_multipart_upload(self, Bucket, Key, UploadId):
        self.calls.append(('abort_multipart_upload', Key))
        self.uploads.pop(UploadId, None)

    def delete_object(self, Bucket, Key):
        self.calls.append(('delete_object', Key))
        self.objects.pop(Key, None)
        return {}

    def copy_object(self, Bucket, Key, CopySource, IfNoneMatch=None, MetadataDirective='COPY', **args):
        self.calls.append(('copy_object', CopySource['Key'], Key))
        self._check_absent(Key, {'IfNoneMatch': IfNoneMatch})
        source = self._get(CopySource['Bucket'], CopySource['Key'])
        if MetadataDirective == 'REPLACE':
            self._store(Key, source['data'], args)
        else:
            self._store(Key, source['data'], {**source['headers'], 'Metadata': source['metadata']})
        return {'CopyObjectResult': {'ETag': self.objects[Key]['etag']}}

    def list_objects_v2(self, Bucket, Prefix='', MaxKeys=1000):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))[:MaxKeys]
        return {'KeyCount': len(keys), 'Contents': [self._listing(k) for k in keys]}

    def get_paginator(self, name):
        assert name == 'list_objects_v2'
        return _Paginator(self)

    def upload_fileobj(self, Fileobj, Bucket, Key, ExtraArgs=None, Config=None):
        self.calls.append(('upload_fileobj', Key))
        self._store(Key, Fileobj.read(), ExtraArgs or {})


class S3TestCase(SimpleTestCase):
    def setUp(self):
        self.fake = FakeS3()
        stub = patch.object(blob_storage, 's3_client', return_value=self.fake)
        stub.start()
        self.addCleanup(stub.stop)
        override = override_settings(**S3_SETTINGS)
        override.enable()
        self.addCleanup(override.disable)

    def put(self, key, data, **headers):
        self.fake._store(key, data, headers)


class BackendSwitchTests(SimpleTestCase):
    @override_settings(STORAGE_BACKEND='azure', AZURE_STORAGE_ACCOUNT='evidenceacct', AZURE_STORAGE_KEY='')
    def test_default_azure_mode_still_requires_the_key(self):
        self.assertFalse(blob_storage.s3_enabled())
        self.assertFalse(evidence_storage.azure_configured())
        with patch('azure.storage.blob.BlobServiceClient') as azure:
            evidence_storage._service_client()
        self.assertEqual(azure.call_args.args[0], 'https://evidenceacct.blob.core.windows.net')

    @override_settings(**S3_SETTINGS)
    def test_s3_mode_counts_as_configured_without_azure_keys(self):
        self.assertTrue(evidence_storage.azure_configured())
        with patch('azure.storage.blob.BlobServiceClient') as azure:
            service = evidence_storage._service_client(retry_total=0)
        azure.assert_not_called()
        self.assertIsInstance(service, blob_storage.S3BlobServiceClient)
        self.assertEqual(service.account_name, 'evidenceacct')

    @override_settings(**{**S3_SETTINGS, 'AWS_S3_STORAGE_BUCKET': ''})
    def test_s3_mode_without_bucket_is_not_configured(self):
        self.assertFalse(evidence_storage.azure_configured())

    @override_settings(**S3_SETTINGS)
    def test_connection_string_resolves_account_without_using_its_key(self):
        service = blob_storage.BlobServiceClient.from_connection_string(
            'DefaultEndpointsProtocol=https;AccountName=otheracct;AccountKey=dummy-not-a-key;EndpointSuffix=core.windows.net')
        self.assertEqual(service.account_name, 'otheracct')

    def test_object_keys_keep_azure_names(self):
        self.assertEqual(blob_storage.object_key('EvidenceAcct', 'evidence-approved', 'a b/ü.pdf'),
                         'evidenceacct/evidence-approved/a b/ü.pdf')


class BlobOperationTests(S3TestCase):
    def test_upload_download_and_properties_round_trip(self):
        name = evidence_storage.upload_blob(b'%PDF-1', 'enrolment-docs', 'x/a b.pdf', 'application/pdf')
        self.assertEqual(name, 'x/a b.pdf')
        key = 'evidenceacct/enrolment-docs/x/a b.pdf'
        self.assertEqual(self.fake.objects[key]['headers']['ContentType'], 'application/pdf')
        self.assertEqual(evidence_storage.download_blob_bytes('enrolment-docs', 'x/a b.pdf'), b'%PDF-1')
        self.assertTrue(evidence_storage.blob_exists('enrolment-docs', 'x/a b.pdf'))
        self.assertFalse(evidence_storage.blob_exists('enrolment-docs', 'missing.pdf'))
        props = evidence_storage._service_client().get_blob_client('enrolment-docs', 'x/a b.pdf').get_blob_properties()
        self.assertEqual((props.size, props.content_settings.content_type), (6, 'application/pdf'))
        self.assertEqual(props['size'], 6)

    def test_canonical_url_round_trips_through_the_stored_value(self):
        url = evidence_storage.blob_url('evidence-approved', 'learner/1/a b.pdf')
        self.assertEqual(url, 'https://evidenceacct.blob.core.windows.net/evidence-approved/learner/1/a%20b.pdf')
        self.assertEqual(evidence_storage.parse_blob_url(url), ('evidence-approved', 'learner/1/a b.pdf'))
        client = evidence_storage._service_client().get_blob_client('evidence-approved', 'learner/1/a b.pdf')
        self.assertEqual(client.url, url)

    def test_upload_accepts_file_objects_and_chunk_iterables(self):
        evidence_storage.upload_to_quarantine(io.BytesIO(b'0123456789'), 'f.txt', 'text/plain')
        client = evidence_storage._service_client().get_blob_client('c', 'chunks.bin')
        client.upload_blob(iter([b'ab', b'cd', 'ef']), overwrite=True)
        self.assertEqual(self.fake.objects['evidenceacct/evidence-quarantine/f.txt']['data'], b'0123456789')
        self.assertEqual(self.fake.objects['evidenceacct/c/chunks.bin']['data'], b'abcdef')

    def test_overwrite_false_is_conditional_and_raises_resource_exists(self):
        evidence_storage.upload_to_quarantine(b'one', 'same.txt', 'text/plain')
        with self.assertRaises(ResourceExistsError):
            evidence_storage.upload_to_quarantine(b'two', 'same.txt', 'text/plain')
        self.assertEqual(self.fake.objects['evidenceacct/evidence-quarantine/same.txt']['data'], b'one')
        evidence_storage.upload_blob(b'two', 'evidence-quarantine', 'same.txt', 'text/plain', overwrite=True)
        self.assertEqual(self.fake.objects['evidenceacct/evidence-quarantine/same.txt']['data'], b'two')

    def test_large_uploads_use_conditional_multipart_and_abort_on_conflict(self):
        with patch.object(blob_storage, 'SINGLE_PUT_MAX_BYTES', 10), patch.object(blob_storage, 'MULTIPART_PART_BYTES', 8):
            hook = MagicMock()
            client = evidence_storage._service_client().get_blob_client('c', 'big.bin')
            data = bytes(range(40))
            client.upload_blob(io.BytesIO(data), overwrite=False, progress_hook=hook,
                               content_settings=ContentSettings(content_type='video/mp4'))
            self.assertEqual(self.fake.objects['evidenceacct/c/big.bin']['data'], data)
            self.assertEqual(self.fake.objects['evidenceacct/c/big.bin']['headers']['ContentType'], 'video/mp4')
            self.assertIn(('complete_multipart_upload', 'evidenceacct/c/big.bin', '*'), self.fake.calls)
            self.assertEqual(hook.call_args.args[0], 40)
            with self.assertRaises(ResourceExistsError):
                client.upload_blob(io.BytesIO(data), overwrite=False)
            self.assertIn(('abort_multipart_upload', 'evidenceacct/c/big.bin'), self.fake.calls)
            self.assertEqual(self.fake.uploads, {})

    def test_ranged_downloads_chunks_and_readinto(self):
        self.put('evidenceacct/c/v.mp4', b'abcdefghij', ContentType='video/mp4')
        client = evidence_storage._service_client(download_chunk_bytes=3).get_blob_client('c', 'v.mp4')
        downloader = client.download_blob(offset=2, length=5)
        self.assertEqual(downloader.size, 5)
        self.assertEqual(downloader.properties.size, 10)
        self.assertEqual(list(downloader.chunks()), [b'cde', b'fg'])
        self.assertEqual(client.download_blob(offset=8).readall(), b'ij')
        target = io.BytesIO()
        self.assertEqual(client.download_blob().readinto(target), 10)
        self.assertEqual(target.getvalue(), b'abcdefghij')
        self.assertEqual(client.download_blob(encoding='utf-8').readall(), 'abcdefghij')

    def test_preview_size_limit_and_empty_blob_ranges(self):
        self.put('evidenceacct/c/big.txt', b'x' * 11)
        with self.assertRaises(ValueError):
            evidence_storage.download_blob_bytes('c', 'big.txt', max_bytes=10)
        self.put('evidenceacct/c/empty.txt', b'')
        self.assertEqual(evidence_storage.download_blob_bytes('c', 'empty.txt', max_bytes=10), b'')
        client = evidence_storage._service_client().get_blob_client('c', 'big.txt')
        with self.assertRaises(HttpResponseError) as raised:
            client.download_blob(offset=50, length=2)
        self.assertEqual(raised.exception.status_code, 416)

    def test_missing_objects_raise_azure_not_found_with_container_distinction(self):
        client = evidence_storage._service_client().get_blob_client('assignment', 'a.pdf')
        with self.assertRaises(ResourceNotFoundError) as raised:
            client.get_blob_properties()
        self.assertIn('ContainerNotFound', str(raised.exception))
        self.put('evidenceacct/assignment/other.pdf', b'1')
        with self.assertRaises(ResourceNotFoundError) as raised:
            client.download_blob()
        self.assertIn('BlobNotFound', str(raised.exception))
        with self.assertRaises(ResourceNotFoundError):
            client.delete_blob()

    def test_access_denied_and_network_errors_are_azure_errors(self):
        from botocore.exceptions import EndpointConnectionError

        client = evidence_storage._service_client().get_blob_client('c', 'a')
        with patch.object(self.fake, 'head_object', side_effect=client_error(403, 'AccessDenied')):
            with self.assertRaises(ClientAuthenticationError):
                client.exists()
        with patch.object(self.fake, 'head_object', side_effect=EndpointConnectionError(endpoint_url='https://s3')):
            with self.assertRaises(AzureError):
                client.get_blob_properties()

    def test_move_blob_copies_then_deletes_the_source(self):
        evidence_storage.upload_to_quarantine(b'evidence', 'e/1.pdf', 'application/pdf')
        evidence_storage.move_blob('evidence-quarantine', 'evidence-approved', 'e/1.pdf')
        self.assertNotIn('evidenceacct/evidence-quarantine/e/1.pdf', self.fake.objects)
        moved = self.fake.objects['evidenceacct/evidence-approved/e/1.pdf']
        self.assertEqual((moved['data'], moved['headers']['ContentType']), (b'evidence', 'application/pdf'))

    def test_delete_and_container_helpers(self):
        self.put('evidenceacct/c/d.txt', b'1')
        evidence_storage.delete_blob('c', 'd.txt')
        self.assertNotIn('evidenceacct/c/d.txt', self.fake.objects)
        with evidence_storage._service_client(retry_total=0) as service:
            container = service.get_container_client('feedback-uploads')
            container.create_container()
            self.assertTrue(container.exists())
            self.assertIsNone(container.get_container_properties().get('public_access'))
            service.create_container('progress-review-decks')

    def test_list_blobs_strips_prefix_and_loads_headers_lazily(self):
        for name in ('_legacy_files/1/a.pdf', '_legacy_files/2/b.pdf', '_legacy_files/3/c.pdf', 'other.pdf'):
            self.put(f'evidenceacct/curriculum-uploads/{name}', b'12', ContentType='application/pdf')
        self.put('evidenceacct/curriculum-uploads-2/_legacy_files/x.pdf', b'1')
        client = evidence_storage._service_client().get_container_client('curriculum-uploads')
        blobs = list(client.list_blobs(name_starts_with='_legacy_files/'))
        self.assertEqual([b.name for b in blobs], ['_legacy_files/1/a.pdf', '_legacy_files/2/b.pdf', '_legacy_files/3/c.pdf'])
        self.assertEqual(blobs[0].size, 2)
        self.assertEqual(blobs[0].content_settings.content_type, 'application/pdf')

    def test_upload_from_external_https_url_streams_without_leaking_the_url(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.side_effect = io.BytesIO(b'video-bytes').read
        response.headers.get_content_type.return_value = 'video/mp4'
        blob = evidence_storage._service_client().get_blob_client('session-recordings', 'r/1.mp4')
        with patch.object(blob_storage.urllib.request, 'urlopen', return_value=response) as opener:
            blob.upload_blob_from_url('https://tenant.sharepoint.com/download?token=secret-value', overwrite=False,
                                      content_settings=ContentSettings(content_type='video/mp4'),
                                      connection_timeout=30, read_timeout=600, timeout=600, retry_total=0,
                                      logging_enable=False)
        self.assertEqual(opener.call_args.kwargs['timeout'], 600)
        self.assertEqual(self.fake.objects['evidenceacct/session-recordings/r/1.mp4']['data'], b'video-bytes')
        with self.assertRaises(ResourceExistsError):
            blob.upload_blob_from_url('https://tenant.sharepoint.com/download?token=secret-value', overwrite=False)
        import urllib.error
        failure = urllib.error.HTTPError('https://tenant.sharepoint.com/download?token=secret-value', 403, 'no',
                                         {}, io.BytesIO())
        other = evidence_storage._service_client().get_blob_client('session-recordings', 'r/2.mp4')
        with patch.object(blob_storage.urllib.request, 'urlopen', side_effect=failure):
            with self.assertRaises(HttpResponseError) as raised:
                other.upload_blob_from_url('https://tenant.sharepoint.com/download?token=secret-value')
        self.assertNotIn('secret-value', str(raised.exception))
        with self.assertRaises(ValueError):
            other.upload_blob_from_url('http://insecure.example/file')

    def test_upload_from_known_azure_url_is_a_server_side_copy(self):
        self.put('materialsacct/media/a.pdf', b'pdf', ContentType='application/pdf')
        blob = evidence_storage._service_client().get_blob_client('copies', 'a.pdf')
        blob.upload_blob_from_url('https://materialsacct.blob.core.windows.net/media/a.pdf?sv=sig')
        self.assertIn(('copy_object', 'materialsacct/media/a.pdf', 'evidenceacct/copies/a.pdf'), self.fake.calls)
        with self.assertRaises(ResourceExistsError):
            blob.upload_blob_from_url('https://materialsacct.blob.core.windows.net/media/a.pdf')


@patch.dict(os.environ, {'AWS_ACCESS_KEY_ID': 'AKIAEXAMPLEEXAMPLE', 'AWS_SECRET_ACCESS_KEY': 'dummy-secret',
                         'AWS_EC2_METADATA_DISABLED': 'true'})
class PresignedUrlTests(SimpleTestCase):
    """Real boto3 signing (local computation only) with dummy credentials."""

    def setUp(self):
        blob_storage._clients.clear()
        self.addCleanup(blob_storage._clients.clear)
        override = override_settings(**S3_SETTINGS)
        override.enable()
        self.addCleanup(override.disable)

    def query(self, url):
        parsed = urlparse(url)
        return parsed, {k: v[0] for k, v in parse_qs(parsed.query).items()}

    def test_read_sas_becomes_presigned_get_with_headers_and_ttl(self):
        url = evidence_storage.get_download_sas('evidence-approved', 'learner/1/a b.pdf', filename='My "CV".pdf')
        parsed, query = self.query(url)
        self.assertEqual(parsed.hostname, 'lms-files-test.s3.eu-west-2.amazonaws.com')
        self.assertEqual(unquote(parsed.path), '/evidenceacct/evidence-approved/learner/1/a b.pdf')
        self.assertEqual(query['X-Amz-Expires'], '900')
        self.assertEqual(query['response-content-disposition'], 'attachment; filename="My CV.pdf"')
        self.assertNotIn('dummy-secret', url)
        url = evidence_storage.get_read_sas('c', 'b.png', content_type='image/png', ttl_minutes=5000)
        _, query = self.query(url)
        self.assertEqual((query['X-Amz-Expires'], query['response-content-type']), ('43200', 'image/png'))

    def test_resolve_read_url_respects_allowed_containers(self):
        stored = evidence_storage.blob_url('evidence-approved', 'x.pdf')
        self.assertIn('amazonaws.com', evidence_storage.resolve_read_url(stored, ['evidence-approved']))
        self.assertEqual(evidence_storage.resolve_read_url(stored, ['other']), '')
        self.assertEqual(evidence_storage.resolve_read_url('/media/legacy.pdf', ['x']), '/media/legacy.pdf')

    def test_material_links_use_the_recorded_account_without_keys(self):
        settings = SimpleNamespace(**S3_SETTINGS)
        row = {'material_blob_container': 'private', 'material_blob_name': 'file one.pdf'}
        self.assertIn('/evidenceacct/private/', unquote(material_storage.read_url(row, settings)))
        row['material_blob_account'] = 'materialsacct'
        url = material_storage.read_url(row, settings)
        self.assertIn('/materialsacct/private/file one.pdf', unquote(url))
        self.assertEqual(self.query(url)[1]['X-Amz-Expires'], '900')
        row['material_blob_account'] = 'unknown'
        with self.assertRaises(ValueError):
            material_storage.read_url(row, settings)

    def test_audit_link_builders_presign(self):
        from audit_api import learner_match_ledger_views, views
        from manual_audit_api import common

        for module in (views, common):
            with patch.dict(os.environ, {'AZURE_STORAGE_CONNECTION_STRING': ''}):
                service = module._azure_service_client()
            self.assertEqual(service.account_name, 'evidenceacct')
            url = module._signed_blob_url(service.get_blob_client(container='contracts', blob='a/b.pdf'))
            parsed, query = self.query(url)
            self.assertEqual(unquote(parsed.path), '/evidenceacct/contracts/a/b.pdf')
            self.assertEqual(query['X-Amz-Expires'], '1800')
        url = learner_match_ledger_views._contract_preview_url(
            'az://evidenceacct/contracts/learner/Contract%201.pdf', 'Contract')
        _, query = self.query(url)
        self.assertEqual(query['response-content-type'], 'application/pdf')
        self.assertEqual(query['response-content-disposition'], 'inline; filename="Contract 1.pdf"')


class _AzureBlob(SimpleNamespace):
    pass


class CopyCommandTests(S3TestCase):
    def azure_service(self, blobs):
        """A stand-in Azure service holding ``{container: {name: (bytes, modified)}}``."""
        service = MagicMock()
        service.list_containers.return_value = [SimpleNamespace(name=c) for c in blobs]

        def container_client(container):
            client = MagicMock()
            client.list_blobs.side_effect = lambda name_starts_with=None, include=None: [
                _AzureBlob(name=name, size=len(data), last_modified=modified,
                           content_settings=ContentSettings(content_type='application/pdf'),
                           metadata={'sha256': 'abc'})
                for name, (data, modified) in blobs[container].items()
                if not name_starts_with or name.startswith(name_starts_with)]
            return client

        def blob_client(container, name):
            client = MagicMock()
            data = blobs[container][name][0]
            client.download_blob.return_value.chunks.return_value = iter([data[:2], data[2:]])
            return client

        service.get_container_client.side_effect = container_client
        service.get_blob_client.side_effect = blob_client
        return service

    def run_command(self, service, *args):
        out, err = io.StringIO(), io.StringIO()
        with patch('learner_api.management.commands.copy_azure_blobs_to_s3.azure_sources',
                   return_value={'evidenceacct': lambda: service}):
            try:
                call_command('copy_azure_blobs_to_s3', *args, stdout=out, stderr=err)
            except CommandError as error:
                return out.getvalue(), err.getvalue(), error
        return out.getvalue(), err.getvalue(), None

    def test_dry_run_counts_without_writing(self):
        old = datetime(2025, 1, 1, tzinfo=timezone.utc)
        service = self.azure_service({'evidence-approved': {'a.pdf': (b'aaaa', old), 'b.pdf': (b'bb', old)}})
        out, _, error = self.run_command(service, '--dry-run')
        self.assertIsNone(error)
        self.assertIn('would copy 2 (6 bytes)', out)
        self.assertEqual(self.fake.objects, {})

    def test_copies_incrementally_with_headers_and_reports_s3_only(self):
        old = datetime(2025, 1, 1, tzinfo=timezone.utc)
        blobs = {'evidence-approved': {'a.pdf': (b'aaaa', old), 'b.pdf': (b'bb', old)}}
        service = self.azure_service(blobs)
        out, _, error = self.run_command(service)
        self.assertIsNone(error)
        self.assertIn('copied 2 (6 bytes), failed 0', out)
        stored = self.fake.objects['evidenceacct/evidence-approved/a.pdf']
        self.assertEqual((stored['data'], stored['headers']['ContentType'], stored['metadata']),
                         (b'aaaa', 'application/pdf', {'sha256': 'abc'}))

        # Second run: nothing changed, so nothing is copied.
        self.put('evidenceacct/evidence-approved/gone.pdf', b'x')
        out, _, _ = self.run_command(self.azure_service(blobs))
        self.assertIn('already in S3 2, copied 0 (0 bytes), failed 0, only in S3 1', out)

        # A blob rewritten in Azure after the copy is copied again.
        blobs['evidence-approved']['b.pdf'] = (b'BB', datetime(2030, 1, 1, tzinfo=timezone.utc))
        out, _, _ = self.run_command(self.azure_service(blobs))
        self.assertIn('copied 1 (2 bytes)', out)
        self.assertEqual(self.fake.objects['evidenceacct/evidence-approved/b.pdf']['data'], b'BB')

    def test_failures_are_reported_and_fail_the_command(self):
        old = datetime(2025, 1, 1, tzinfo=timezone.utc)
        service = self.azure_service({'c': {'a.pdf': (b'aaaa', old)}})
        with patch.object(self.fake, 'upload_fileobj', side_effect=client_error(403, 'AccessDenied')):
            out, err, error = self.run_command(service, '--container', 'c')
        self.assertIn('FAILED evidenceacct/c/a.pdf: ClientError (AccessDenied)', err)
        self.assertIsNotNone(error)

    def test_requires_a_bucket(self):
        with override_settings(AWS_S3_STORAGE_BUCKET=''):
            _, _, error = self.run_command(MagicMock())
        self.assertIn('AWS_S3_STORAGE_BUCKET', str(error))


class CopyBlobTransferTests(SimpleTestCase):
    """copy_blob through the real boto3/s3transfer upload path (S3 stubbed).

    s3transfer decides between one PutObject and a multipart upload from a
    single read(threshold). A reader that returned one Azure chunk at a time
    made it choose PutObject for every blob over a chunk and then read the whole
    blob into memory, so large recordings exhausted memory and the copies
    running next to them failed.
    """

    def copy(self, chunks, part_bytes=None):
        import boto3
        from botocore.stub import ANY, Stubber
        from learner_api.management.commands import copy_azure_blobs_to_s3 as command

        data = b''.join(chunks)
        s3 = boto3.client('s3', region_name='eu-west-2', aws_access_key_id='test', aws_secret_access_key='test')
        sent = []

        def record(params, model, **_):
            if model.name in ('PutObject', 'UploadPart'):
                body = params['Body']
                sent.append((model.name, body.read() if hasattr(body, 'read') else bytes(body)))
        s3.meta.events.register('before-parameter-build.s3', record)
        stubber = Stubber(s3)
        multipart = part_bytes is not None
        if multipart:
            stubber.add_response('create_multipart_upload', {'UploadId': 'u1'}, None)
            stubber.add_response('upload_part', {'ETag': '"p1"'}, None)
            stubber.add_response('complete_multipart_upload', {}, None)
        else:
            stubber.add_response('put_object', {}, None)
        stubber.add_response('head_object', {'ContentLength': len(data)}, {'Bucket': 'b', 'Key': ANY})

        service = MagicMock()
        service.get_blob_client.return_value.download_blob.return_value.chunks.return_value = iter(chunks)
        blob = _AzureBlob(name='series/session-01_OCC-1/attendance.csv', size=len(data),
                          content_settings=ContentSettings(content_type='application/octet-stream'), metadata={})
        with stubber, patch.object(command, 'PART_BYTES', part_bytes or command.PART_BYTES):
            size = command.copy_blob(service, s3, 'b', 'acct', 'session-recordings', blob)
            stubber.assert_no_pending_responses()
        return size, sent, data

    def test_small_blob_is_one_put_with_exact_bytes(self):
        size, sent, data = self.copy([b'learner,minutes\n' * 196 + b'xx'])
        self.assertEqual(size, 3138)
        self.assertEqual(sent, [('PutObject', data)])

    def test_blob_larger_than_threshold_streams_as_multipart(self):
        # 3,000 bytes in 100-byte chunks with a 1,024-byte threshold: before the
        # fix the first read returned 100 bytes and the blob went as one
        # PutObject read whole into memory.
        chunks = [bytes([n]) * 100 for n in range(30)]
        size, sent, data = self.copy(chunks, part_bytes=1024)
        self.assertEqual(size, 3000)
        self.assertEqual([name for name, _ in sent], ['UploadPart'])
        self.assertEqual(b''.join(body for _, body in sent), data)
