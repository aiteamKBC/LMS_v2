"""Content-addressed file storage for books and their assets.

Files are keyed by their SHA-256, so the same image appearing in two books or
two editions is stored once. Development uses the local disk under
``MEDIA_ROOT/knowledge_base`` (gitignored); Azure is added for the approved
Azure test and is never selected by default.

References are stored in Neon as ``local:<key>`` or ``blob:<container>/<key>``.
"""
from __future__ import annotations

import hashlib
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
        if not ref.startswith(self.prefix):
            raise StorageError(f"Not a local reference: {ref!r}")
        return self._path(ref[len(self.prefix):]).read_bytes()

    def exists(self, ref: str) -> bool:
        return ref.startswith(self.prefix) and self._path(ref[len(self.prefix):]).exists()


def get_storage():
    mode = config.storage_mode()
    if mode == "local":
        return LocalStorage()
    raise StorageError(f"Storage mode {mode!r} is not enabled yet; use 'local'.")
