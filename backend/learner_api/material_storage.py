"""Private material files use their recorded account, independently of evidence."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote
import urllib.error
import urllib.request

from azure.storage.blob import generate_blob_sas, BlobSasPermissions


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, target):
        return None


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


def pdf_response(row, settings, request):
    """Serve an already-authorized PDF on the LMS origin, without browser CORS."""
    from django.http import FileResponse, HttpResponse

    headers = {'Accept': 'application/pdf'}
    if request.headers.get('Range'):
        headers['Range'] = request.headers['Range']
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    try:
        upstream = opener.open(urllib.request.Request(read_url(row, settings), headers=headers), timeout=30)
    except urllib.error.HTTPError as error:
        if error.code == 416:
            response = HttpResponse(status=416)
            if error.headers.get('Content-Range'):
                response['Content-Range'] = error.headers['Content-Range']
            error.close()
            return response
        error.close()
        raise ValueError('The stored PDF is temporarily unavailable.') from None
    except OSError:
        raise ValueError('The stored PDF is temporarily unavailable.') from None
    if upstream.status not in (200, 206) or upstream.headers.get_content_type() != 'application/pdf':
        upstream.close()
        raise ValueError('The stored file is not an available PDF.')
    response = FileResponse(upstream, status=upstream.status, content_type='application/pdf',
        as_attachment=False, filename='material.pdf')
    for header in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if upstream.headers.get(header):
            response[header] = upstream.headers[header]
    response['X-Content-Type-Options'] = 'nosniff'
    response['X-Frame-Options'] = 'SAMEORIGIN'
    return response
