"""Private material files use their recorded account, independently of evidence."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from azure.storage.blob import generate_blob_sas, BlobSasPermissions


def read_url(row, settings):
    account = row.get('material_blob_account')
    if not account:
        # Existing backups predate the dedicated material account.
        account, key = settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_STORAGE_KEY
    elif account == settings.AZURE_MATERIALS_STORAGE_ACCOUNT:
        key = settings.AZURE_MATERIALS_STORAGE_KEY
    elif account == settings.AZURE_STORAGE_ACCOUNT:
        key = settings.AZURE_STORAGE_KEY
    else:
        raise ValueError('Unknown material storage account')
    if not account or not key:
        raise ValueError('Material storage is not configured')
    container, blob = row['material_blob_container'], row['material_blob_name']
    minutes = min(60, max(1, settings.AZURE_MATERIALS_SAS_TTL_MINUTES))
    token = generate_blob_sas(account_name=account, account_key=key,
        container_name=container, blob_name=blob, permission=BlobSasPermissions(read=True),
        expiry=datetime.now(timezone.utc) + timedelta(minutes=minutes))
    return f'https://{account}.blob.core.windows.net/{quote(container, safe="")}/{quote(blob, safe="/")}?{token}'
