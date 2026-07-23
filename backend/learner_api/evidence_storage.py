"""Azure Blob Storage helper for learner evidence.

Every Azure SDK call is isolated here so the rest of the app never talks to the
SDK directly. Config comes from settings (which read backend/.env):
    AZURE_STORAGE_ACCOUNT / AZURE_STORAGE_KEY
    AZURE_QUARANTINE_CONTAINER / AZURE_APPROVED_CONTAINER / AZURE_REJECTED_CONTAINER
    AZURE_SAS_TTL_MINUTES

Lifecycle: uploads land in the QUARANTINE container, are scanned, then promoted
to APPROVED (downloadable via short-lived SAS) or moved to REJECTED. Blobs are
only ever downloaded from the APPROVED container.
"""
from datetime import datetime, timedelta, timezone

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
    client = _service_client().get_blob_client(
        container=settings.AZURE_QUARANTINE_CONTAINER, blob=blob_name,
    )
    client.upload_blob(
        file_obj,
        overwrite=False,
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
    dst.start_copy_from_url(src.url)
    # For small files start_copy is effectively synchronous. For large files,
    # poll dst.get_blob_properties().copy.status until 'success' before deleting.
    for _ in range(30):
        status = dst.get_blob_properties().copy.status
        if status == "success":
            break
        if status in ("failed", "aborted"):
            raise RuntimeError(f"Azure copy {status} for {blob_name}")
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
    return (f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/"
            f"{container}/{blob_name}")


def get_download_sas(container, blob_name) -> str:
    """Short-lived read-only URL. Only ever call with the APPROVED container."""
    token = generate_blob_sas(
        account_name=settings.AZURE_STORAGE_ACCOUNT,
        container_name=container,
        blob_name=blob_name,
        account_key=settings.AZURE_STORAGE_KEY,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(minutes=settings.AZURE_SAS_TTL_MINUTES),
    )
    return f"{blob_url(container, blob_name)}?{token}"
