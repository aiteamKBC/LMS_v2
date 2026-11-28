"""Azure and migration regression tests; all external calls are mocked."""
import io
import tempfile
import uuid
from unittest.mock import Mock, patch

from azure.core.exceptions import ResourceExistsError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from . import storage


@override_settings(KNOWLEDGE_BASE_AZURE_CONTAINER="knowledge-base-test", AZURE_STORAGE_ACCOUNT="testaccount", AZURE_STORAGE_KEY="fake")
class AzureStorageTests(SimpleTestCase):
    def setUp(self):
        self.patch = patch("azure.storage.blob.BlobServiceClient")
        self.client = self.patch.start().return_value
        self.addCleanup(self.patch.stop)
        self.client.get_container_client.return_value.get_container_properties.return_value = {"public_access": None}
        self.blob = self.client.get_blob_client.return_value

    def test_upload_is_private_content_addressed_and_has_content_type(self):
        remote = storage.AzureStorage()
        self.assertEqual(remote.put("assets/aa/test.webp", b"image"), "blob:knowledge-base-test/assets/aa/test.webp")
        kwargs = self.blob.upload_blob.call_args.kwargs
        self.assertFalse(kwargs["overwrite"])
        self.assertEqual(kwargs["metadata"]["sha256"], storage.sha256_of(b"image"))
        self.assertEqual(kwargs["content_settings"].content_type, "image/webp")

    def test_retry_checks_existing_bytes_and_never_overwrites(self):
        self.blob.upload_blob.side_effect = ResourceExistsError("exists")
        self.blob.download_blob.return_value.readall.return_value = b"same"
        remote = storage.AzureStorage()
        remote.put("sources/a.pdf", b"same")
        with self.assertRaises(storage.StorageError):
            remote.put("sources/a.pdf", b"different")

    def test_public_container_and_cross_container_read_are_refused(self):
        remote = storage.AzureStorage()
        with self.assertRaises(storage.StorageError):
            remote.get("blob:other/assets/a.webp")
        self.client.get_container_client.return_value.get_container_properties.return_value = {"public_access": "blob"}
        with self.assertRaises(storage.StorageError):
            remote.put("assets/a.webp", b"a")
        self.blob.upload_blob.assert_not_called()

    def test_mixed_references_survive_partial_migration(self):
        self.blob.download_blob.return_value.readall.return_value = b"remote"
        with tempfile.TemporaryDirectory() as tmp, override_settings(KNOWLEDGE_BASE_LOCAL_DIR=tmp):
            local = storage.LocalStorage()
            ref = local.put("assets/a.webp", b"local")
            self.assertEqual(storage.AzureStorage().get(ref), b"local")
            self.assertEqual(local.get("blob:knowledge-base-test/assets/b.webp"), b"remote")


class MigrationTests(SimpleTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.settings_override = override_settings(KNOWLEDGE_BASE_LOCAL_DIR=self.temp.name)
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.store = storage.LocalStorage()
        self.version_id = uuid.uuid4()
        data = b"synthetic pdf"
        self.ref = self.store.put(storage.source_key(storage.sha256_of(data)), data)
        self.version = {"id": self.version_id, "storage_ref": self.ref, "file_sha256": storage.sha256_of(data), "page_count": 1}
        self.store.put(storage.preview_key(str(self.version_id), 1, "thumb"), b"preview")
        self.repo_patch = patch("knowledge_base.management.commands.migrate_knowledge_to_azure.Repository")
        self.repo = self.repo_patch.start().return_value
        self.addCleanup(self.repo_patch.stop)
        self.repo.book_storage_records.return_value = ([self.version], [])

    def run_command(self, apply=False):
        out = io.StringIO()
        call_command("migrate_knowledge_to_azure", book_id=uuid.uuid4(), apply=apply, stdout=out)
        return out.getvalue()

    def test_default_dry_run_does_not_connect_to_azure_or_write_database(self):
        with patch.object(storage, "AzureStorage") as azure:
            output = self.run_command()
        azure.assert_not_called()
        self.repo.replace_storage_refs.assert_not_called()
        self.assertIn("2 local files", output)

    def test_verified_copy_switches_references_and_retains_local_files(self):
        remote_files = {}
        remote = Mock(prefix="blob:knowledge-base-test/")
        def put(key, stream):
            ref = remote.prefix + key
            remote_files[ref] = stream.read()
            return ref
        remote.put_stream.side_effect = put
        remote.get.side_effect = remote_files.__getitem__
        migrated = {**self.version, "storage_ref": remote.prefix + self.ref[6:]}
        self.repo.book_storage_records.side_effect = [([self.version], []), ([migrated], [])]
        with patch.object(storage, "AzureStorage", return_value=remote):
            self.run_command(apply=True)
        self.repo.replace_storage_refs.assert_called_once()
        self.assertEqual(len(remote_files), 2)
        self.assertTrue(self.store.exists(self.ref))

    def test_failed_verification_never_switches_database_references(self):
        remote = Mock(prefix="blob:knowledge-base-test/")
        remote.get.return_value = b"wrong bytes"
        with patch.object(storage, "AzureStorage", return_value=remote), self.assertRaises(CommandError):
            self.run_command(apply=True)
        self.repo.replace_storage_refs.assert_not_called()
        self.assertTrue(self.store.exists(self.ref))
