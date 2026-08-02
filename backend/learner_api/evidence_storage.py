"""Azure Blob Storage helper for learner evidence.

Every Azure SDK call is isolated here so the rest of the app never talks to the
SDK directly. Config comes from settings (which read backend/.env):
    AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY
    AZURE_QUARANTINE_CONTAINER / AZURE_APPROVED_CONTAINER / AZURE_REJECTED_CONTAINER
    AZURE_SAS_TTL_MINUTES

Lifecycle: uploads land in the QUARANTINE container, are scanned, then promoted
to APPROVED or moved to REJECTED. Callers explicitly choose which containers
may receive a short-lived read-only SAS URL.
"""
from datetime import datetime, timedelta, timezone
from time import sleep
from urllib.parse import quote, unquote, urlparse

from django.conf import settings
from azure.storage.blob import (
    BlobServiceClient, ContentSettings,
    generate_blob_sas, BlobSasPermissions,
)


def azure_configured() -> bool:
    """True when both the account and key are present, so views can 503 cleanly
    instead of throwing an opaque SDK error when storage isn't set up."""
    return bool(settings.AZURE_STORAGE_ACCOUNT and settings.AZURE_STORAGE_KEY)


def _service_client() -> BlobServiceClient:
    return BlobServiceClient(
        account_url=f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net",
        credential=settings.AZURE_STORAGE_KEY,
    )


def upload_to_quarantine(file_obj, blob_name, content_type):
    """Every upload lands here first. Never uploaded straight to approved."""
    if hasattr(file_obj, "seek"):
        file_obj.seek(0)
    client = _service_client().get_blob_client(
        container=settings.AZURE_QUARANTINE_CONTAINER, blob=blob_name,
    )
    client.upload_blob(
        file_obj,
        overwrite=False,
        content_settings=ContentSettings(content_type=content_type or "application/octet-stream"),
    )
    return blob_name


def upload_blob(file_obj, container, blob_name, content_type, overwrite=True):
    """Write directly to `container`, bypassing the quarantine lifecycle.

    Only for content the platform generates itself (see enrolment_api/documents.py)
    — learner-supplied uploads must still go through upload_to_quarantine so they
    get scanned before anyone can download them.
    """
    client = _service_client().get_blob_client(container=container, blob=blob_name)
    client.upload_blob(
        file_obj,
        overwrite=overwrite,
        content_settings=ContentSettings(content_type=content_type or "application/octet-stream"),
    )
    return blob_name


def move_blob(src_container, dst_container, blob_name):
    """Azure has no atomic move; copy server-side then delete the source.
    Small files complete near-instantly; poll copy status for large ones."""
    if src_container == dst_container:
        return
    svc = _service_client()
    src = svc.get_blob_client(src_container, blob_name)
    dst = svc.get_blob_client(dst_container, blob_name)
    if not src.exists() and dst.exists():
        return
    dst.start_copy_from_url(src.url)
    # For small files start_copy is effectively synchronous. For large files,
    # poll dst.get_blob_properties().copy.status until 'success' before deleting.
    for _ in range(30):
        status = dst.get_blob_properties().copy.status
        if status == "success":
            break
        if status in ("failed", "aborted"):
            raise RuntimeError(f"Azure copy {status} for {blob_name}")
        sleep(0.2)
    else:
        raise TimeoutError(f"Azure copy timed out for {blob_name}")
    src.delete_blob()


def download_blob_bytes(container, blob_name) -> bytes:
    """Used by the scanner to pull a file out of quarantine for inspection."""
    client = _service_client().get_blob_client(container, blob_name)
    return client.download_blob().readall()


def blob_exists(container, blob_name) -> bool:
    return _service_client().get_blob_client(container, blob_name).exists()


def blob_url(container, blob_name) -> str:
    """The (unsigned) canonical blob URL — stored as the Evidence_path so the
    approved location is recorded even though downloads always go via SAS."""
    encoded_blob_name = quote(blob_name, safe="/")
    return (f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/"
            f"{container}/{encoded_blob_name}")


def parse_blob_url(value):
    """Return (container, blob_name) for a canonical URL owned by this account."""
    if not value or not settings.AZURE_STORAGE_ACCOUNT:
        return None
    parsed = urlparse(str(value))
    expected_host = f"{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net".lower()
    if parsed.scheme != "https" or parsed.hostname != expected_host:
        return None
    path = parsed.path.lstrip("/")
    if "/" not in path:
        return None
    container, encoded_blob_name = path.split("/", 1)
    blob_name = unquote(encoded_blob_name)
    return (container, blob_name) if container and blob_name else None


def delete_blob(container, blob_name):
    """Best-effort cleanup helper used when database persistence fails."""
    _service_client().get_blob_client(container, blob_name).delete_blob(
        delete_snapshots="include",
    )


def get_read_sas(container, blob_name) -> str:
    """Build a short-lived read-only URL for an explicitly authorised blob."""
    token = generate_blob_sas(
        account_name=settings.AZURE_STORAGE_ACCOUNT,
        container_name=container,
        blob_name=blob_name,
        account_key=settings.AZURE_STORAGE_KEY,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(minutes=settings.AZURE_SAS_TTL_MINUTES),
    )
    return f"{blob_url(container, blob_name)}?{token}"


def resolve_read_url(stored_url, allowed_containers) -> str:
    """Resolve an Azure reference to SAS, while preserving legacy local URLs."""
    location = parse_blob_url(stored_url)
    if location is None:
        return str(stored_url or "")
    container, blob_name = location
    if not azure_configured() or container not in set(allowed_containers):
        return ""
    return get_read_sas(container, blob_name)


def get_download_sas(container, blob_name) -> str:
    """Backward-compatible approved-evidence download helper."""
    return get_read_sas(container, blob_name)
