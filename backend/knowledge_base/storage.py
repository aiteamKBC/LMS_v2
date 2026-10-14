"""Content-addressed file storage for books and their assets.

Files are keyed by their SHA-256, so the same image appearing in two books or
two editions is stored once. Development uses the local disk under
``MEDIA_ROOT/knowledge_base`` (gitignored). Azure requires explicit selection
and a dedicated, existing private container.

References are stored in Neon as ``local:<key>`` or ``blob:<container>/<key>``.
"""
from __future__ import annotations

import hashlib
import io
import os
import re
from pathlib import Path

from django.conf import settings

from . import config


class StorageError(RuntimeError):
    pass


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_of_file(fileobj) -> str:
    digest = hashlib.sha256()
    fileobj.seek(0)
    for block in iter(lambda: fileobj.read(1024 * 1024), b""):
        digest.update(block)
    fileobj.seek(0)
    return digest.hexdigest()


def source_key(file_sha: str) -> str:
    return f"sources/{file_sha}.pdf"


def asset_key(asset_sha: str, extension: str) -> str:
    return f"assets/{asset_sha[:2]}/{asset_sha}.{extension}"


def preview_key(book_version_id: str, pdf_page: int, kind: str) -> str:
    return f"previews/{book_version_id}/{kind}-{pdf_page:05d}.webp"


class LocalStorage:
    prefix = "local:"

    def __init__(self, root: Path | None = None):
        self.root = Path(root or getattr(settings, "KNOWLEDGE_BASE_LOCAL_DIR", None)
                         or Path(settings.MEDIA_ROOT) / "knowledge_base")

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise StorageError("Refusing a key outside the storage root.")
        return path

    def put(self, key: str, data: bytes) -> str:
        path = self._path(key)
        if not path.exists():  # content-addressed: an existing file is identical
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(path)
        return self.prefix + key

    def put_stream(self, key: str, fileobj) -> str:
        """Copy a file object in blocks -- a large book is never held in memory."""
        import shutil

        path = self._path(key)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".part")
            fileobj.seek(0)
            with tmp.open("wb") as out:
                shutil.copyfileobj(fileobj, out, length=1024 * 1024)
            tmp.replace(path)
        return self.prefix + key

    def get(self, ref: str) -> bytes:
        if ref.startswith("blob:"):
            return AzureStorage().get(ref)
        if not ref.startswith(self.prefix):
            raise StorageError(f"Not a local reference: {ref!r}")
        return self._path(ref[len(self.prefix):]).read_bytes()

    def exists(self, ref: str) -> bool:
        return ref.startswith(self.prefix) and self._path(ref[len(self.prefix):]).exists()


class AzureStorage:
    """Private blobs; references, not expiring SAS URLs, are persisted."""

    def __init__(self, container=None):
        from azure.storage.blob import BlobServiceClient

        self.container = container or getattr(settings, "KNOWLEDGE_BASE_AZURE_CONTAINER", None) or os.environ.get("KNOWLEDGE_BASE_AZURE_CONTAINER", "")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])", self.container) or "--" in self.container:
            raise StorageError("Set KNOWLEDGE_BASE_AZURE_CONTAINER to a dedicated private container.")
        account = getattr(settings, "AZURE_STORAGE_ACCOUNT", "")
        key = getattr(settings, "AZURE_STORAGE_KEY", "")
        if not account or not key:
            raise StorageError("Azure storage account and key are required.")
        # Bounded blocks avoid a single large PDF request timing out on slower uplinks.
        self.client = BlobServiceClient(
            account_url=f"https://{account}.blob.core.windows.net", credential=key,
            max_single_put_size=256 * 1024, max_block_size=256 * 1024,
            connection_timeout=30, read_timeout=120, retry_total=2,
        )
        self.prefix = f"blob:{self.container}/"
        self._checked = False

    def _check_private(self):
        if not self._checked:
            props = self.client.get_container_client(self.container).get_container_properties()
            if props.get("public_access"):
                raise StorageError("The Knowledge Base container must be private.")
            self._checked = True

    def _blob(self, key):
        if not key or key.startswith("/") or "\\" in key or any(p in ("", ".", "..") for p in key.split("/")):
            raise StorageError("Invalid Knowledge Base blob key.")
        self._check_private()
        return self.client.get_blob_client(container=self.container, blob=key)

    def put(self, key, data):
        return self.put_stream(key, io.BytesIO(data))

    def put_stream(self, key, fileobj):
        from azure.core.exceptions import ResourceExistsError
        from azure.storage.blob import ContentSettings

        blob = self._blob(key)
        digest = sha256_of_file(fileobj)
        media_type = "application/pdf" if key.endswith(".pdf") else "image/webp"
        try:
            blob.upload_blob(fileobj, overwrite=False, max_concurrency=4, metadata={"sha256": digest},
                             content_settings=ContentSettings(content_type=media_type))
        except ResourceExistsError:
            # A retry may reuse an identical object, never replace different bytes.
            if sha256_of(blob.download_blob().readall()) != digest:
                raise StorageError("An existing Azure blob has different content.")
        return self.prefix + key

    def get(self, ref):
        if ref.startswith("local:"):
            return LocalStorage().get(ref)
        if not ref.startswith(self.prefix):
            raise StorageError("Blob reference is outside the configured Knowledge Base container.")
        return self._blob(ref[len(self.prefix):]).download_blob().readall()

    def exists(self, ref):
        return ref.startswith(self.prefix) and self._blob(ref[len(self.prefix):]).exists()


def read(ref):
    """Read by reference during a partial migration, regardless of write mode."""
    if ref.startswith("local:"):
        return LocalStorage().get(ref)
    if ref.startswith("blob:"):
        return AzureStorage().get(ref)
    raise StorageError("Unknown Knowledge Base storage reference.")


def get_storage():
    mode = config.storage_mode()
    if mode == "local":
        return LocalStorage()
    if mode == "azure":
        return AzureStorage()
    raise StorageError(f"Unknown Knowledge Base storage mode: {mode!r}.")
