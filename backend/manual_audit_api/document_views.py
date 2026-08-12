"""Open contract/evidence files and Azure blobs for the Manual audit workspace."""

import mimetypes
import os
import re
from html import escape
from urllib.parse import quote, unquote, urlsplit

from django.db import DatabaseError, connections
from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.utils.http import content_disposition_header

from .common import (
    CONN,
    _azure_service_client,
    _blob_client_with_fallback,
    _error,
    _has_audit_permission,
    _signed_blob_url,
)
from .contract_documents import ensure_contract_archive_table, ensure_contract_uploads_table, parse_manual_contract_id
from .evidence_documents import uploaded_evidence_location


def _parse_contract_azure_path(value, allowed_prefixes=("aptem_cv_contracts_probe/", "manual_audit_contracts/")):
    """Return the fixed contract container/blob stored in an ``az://`` URI."""
    parsed = urlsplit(str(value or "").strip())
    if parsed.scheme.lower() != "az" or not parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError("Invalid contract Azure path.")

    path = unquote(parsed.path).lstrip("/")
    try:
        container, blob_name = path.split("/", 1)
    except ValueError as exc:
        raise ValueError("Invalid contract Azure path.") from exc

    blob_parts = blob_name.replace("\\", "/").split("/")
    if (
        container != "contracts"
        or not blob_name.startswith(allowed_prefixes)
        or any(part in {"", ".", ".."} for part in blob_parts)
    ):
        raise ValueError("Invalid contract Azure path.")
    return container, blob_name


def _office_viewer_response(signed_url, document_name):
    viewer_url = f"https://view.officeapps.live.com/op/embed.aspx?src={quote(signed_url, safe='')}"
    response = HttpResponse(
        f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(document_name)}</title>
  <style>
    html, body, iframe {{ width: 100%; height: 100%; margin: 0; border: 0; background: #f5f3ec; }}
  </style>
</head>
<body><iframe src="{escape(viewer_url, quote=True)}" title="{escape(document_name, quote=True)}"></iframe></body>
</html>''',
        content_type="text/html; charset=utf-8",
    )
    response["Content-Security-Policy"] = (
        "default-src 'none'; frame-src https://view.officeapps.live.com; "
        "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
    )
    response["Cache-Control"] = "private, no-store"
    return response


def contract_file(request, contract_id):
    """Render a contract without exposing its storage path (source or manual)."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    try:
        kind, numeric_id = parse_manual_contract_id(contract_id)
    except (TypeError, ValueError):
        return _error("Contract ID is invalid.", 400)

    try:
        with connections[CONN].cursor() as cursor:
            if kind == "manual":
                ensure_contract_uploads_table(cursor)
                cursor.execute(
                    '''
                    select azure_path, coalesce(nullif(display_name, ''), document_name)
                    from "Manual_audit".contract_uploads
                    where id = %s and deleted_at is null
                    limit 1
                    ''',
                    [numeric_id],
                )
            else:
                ensure_contract_archive_table(cursor)
                cursor.execute(
                    '''
                    select contracts.azure_path,
                           coalesce(nullif(archive.display_name, ''), contracts.document_name)
                    from fetching_evidence.aptem_cv_contracts_probe contracts
                    left join "Manual_audit".contract_document_archive archive
                      on archive.contract_id = contracts.id
                    where contracts.id = %s
                    limit 1
                    ''',
                    [numeric_id],
                )
            row = cursor.fetchone()
    except (DatabaseError, KeyError):
        return _error("Could not load contract metadata.", 502)

    if not row:
        return _error("Contract not found.", 404)
    if not row[0]:
        return _error("This contract is not available in Azure.", 404)

    try:
        container, blob_name = _parse_contract_azure_path(row[0])
        service = _azure_service_client()
        client = _blob_client_with_fallback(service, container, blob_name)
        signed_url = _signed_blob_url(client)
    except ValueError:
        return _error("This contract has an invalid Azure path.", 409)
    except RuntimeError as exc:
        return _error(str(exc), 503)
    except Exception:
        return _error("The contract could not be opened from Azure.", 502)

    download_requested = (request.GET.get("download") or "").strip().lower() in {"1", "true", "yes"}
    extension = os.path.splitext(blob_name)[1].lower()
    document_name = str(row[1] or "Contract").strip()[:180] or "Contract"
    if not os.path.splitext(document_name)[1] and extension:
        document_name = f"{document_name}{extension}"

    if not download_requested and extension in {".doc", ".docx", ".docm", ".xls", ".xlsx", ".ppt", ".pptx"}:
        return _office_viewer_response(signed_url, document_name)

    try:
        downloader = client.download_blob()
        properties = downloader.properties
        guessed_content_type = mimetypes.guess_type(blob_name)[0]
        stored_content_type = getattr(getattr(properties, "content_settings", None), "content_type", None)
        content_type = (
            guessed_content_type
            or stored_content_type
            or "application/octet-stream"
        )
        response = StreamingHttpResponse(downloader.chunks(), content_type=content_type)
        content_length = getattr(properties, "size", None)
        if content_length is not None:
            response["Content-Length"] = str(content_length)
    except Exception:
        return _error("The contract could not be streamed from Azure.", 502)

    response["Content-Disposition"] = content_disposition_header(download_requested, document_name)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def evidence_file(request, evidence_id):
    """Open an evidence submission (source manifest or manual upload)."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    raw_learner_id = (request.GET.get("learner_id") or "").strip()
    try:
        learner_id = int(raw_learner_id) if raw_learner_id else None
    except ValueError:
        return _error("learner_id must be an integer.", 400)

    try:
        if str(evidence_id).startswith("audit-"):
            row = uploaded_evidence_location(str(evidence_id), learner_id)
        else:
            if not str(evidence_id).isdigit():
                return _error("Evidence ID is invalid.", 400)
            conditions = ["item ->> 'evidence_id' = %s"]
            params = [str(evidence_id)]
            if learner_id is not None:
                conditions.append("evidence.learner_id = %s")
                params.append(learner_id)
            with connections[CONN].cursor() as cursor:
                cursor.execute(
                    f'''
                    select evidence.azure_manifest ->> 'container',
                           item -> 'submission' ->> 'blob',
                           item -> 'submission' ->> 'filename',
                           item -> 'submission' ->> 'status'
                    from fetching_evidence.learner_evidence evidence
                    cross join lateral json_array_elements(
                        case
                            when json_typeof(evidence.azure_manifest -> 'items') = 'array'
                                then evidence.azure_manifest -> 'items'
                            else '[]'::json
                        end
                    ) item
                    where {' and '.join(conditions)}
                    order by evidence.fetched_at desc nulls last, evidence.id desc
                    limit 1
                    ''',
                    params,
                )
                row = cursor.fetchone()
    except (DatabaseError, KeyError):
        return _error("Could not load the evidence Azure manifest.", 502)

    if not row:
        return _error("Evidence file was not found in the Azure manifest.", 404)
    container, blob_name, filename, manifest_status = row
    if manifest_status != "present" or not container or not blob_name:
        return _error("Evidence file is not available in Azure.", 404)
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?", container):
        return _error("Evidence manifest contains an invalid container.", 409)
    blob_parts = str(blob_name).replace("\\", "/").split("/")
    if any(part in {"", ".", ".."} for part in blob_parts):
        return _error("Evidence manifest contains an invalid blob path.", 409)

    try:
        service = _azure_service_client()
        client = _blob_client_with_fallback(service, container, blob_name)
        signed_url = _signed_blob_url(client)
    except RuntimeError as exc:
        return _error(str(exc), 503)
    except Exception:
        return _error("The evidence file could not be opened from Azure.", 502)

    document_name = str(filename or blob_parts[-1] or f"Evidence {evidence_id}").strip()[:180]
    extension = os.path.splitext(document_name)[1].lower() or os.path.splitext(blob_name)[1].lower()
    if extension in {".doc", ".docx", ".docm", ".xls", ".xlsx", ".ppt", ".pptx"}:
        return _office_viewer_response(signed_url, document_name)

    download_requested = (request.GET.get("download") or "").strip().lower() in {"1", "true", "yes"}
    try:
        downloader = client.download_blob()
        properties = downloader.properties
        guessed_content_type = mimetypes.guess_type(document_name)[0] or mimetypes.guess_type(blob_name)[0]
        stored_content_type = getattr(getattr(properties, "content_settings", None), "content_type", None)
        response = StreamingHttpResponse(
            downloader.chunks(),
            content_type=guessed_content_type or stored_content_type or "application/octet-stream",
        )
        content_length = getattr(properties, "size", None)
        if content_length is not None:
            response["Content-Length"] = str(content_length)
    except Exception:
        return _error("The evidence file could not be streamed from Azure.", 502)

    response["Content-Disposition"] = content_disposition_header(download_requested, document_name)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


def audit_blob(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    container = (request.GET.get("container") or "").strip()
    blob_name = unquote((request.GET.get("blob") or "").strip())
    if not container or not blob_name:
        return _error("Missing Azure container or blob.", 400)

    try:
        service = _azure_service_client()
        client = _blob_client_with_fallback(service, container, blob_name)
        return HttpResponseRedirect(_signed_blob_url(client))
    except RuntimeError as exc:
        return _error(str(exc), 503)
    except Exception as exc:
        return _error(f"Azure blob error: {exc}", 502)
