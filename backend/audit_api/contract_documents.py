"""Auditor-managed contract uploads and reversible archive state."""

import json
import mimetypes
import os
import re
import uuid

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .views import _azure_service_client, _has_audit_permission


CONN = "enrolment"
MAX_CONTRACT_SIZE = 25 * 1024 * 1024
ALLOWED_CONTRACT_EXTENSIONS = {
    ".csv", ".doc", ".docx", ".jpeg", ".jpg", ".pdf", ".png",
    ".ppt", ".pptx", ".txt", ".xls", ".xlsx",
}


def ensure_contract_archive_table(cursor):
    cursor.execute(
        '''
        create table if not exists "Audit".contract_document_archive (
            contract_id bigint primary key,
            learner_id bigint not null,
            archived_at timestamptz,
            deleted_at timestamptz,
            archived_by text,
            updated_at timestamptz not null default now()
        )
        '''
    )
    cursor.execute(
        '''
        alter table "Audit".contract_document_archive
        add column if not exists deleted_at timestamptz
        '''
    )
    cursor.execute(
        '''
        create index if not exists contract_document_archive_learner_idx
        on "Audit".contract_document_archive (learner_id, archived_at)
        '''
    )


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _safe_upload_filename(value):
    filename = os.path.basename(str(value or "").replace("\\", "/")).strip()
    filename = re.sub(r'[^A-Za-z0-9._() -]+', "_", filename)
    filename = re.sub(r"\s+", " ", filename).strip(" .")
    return filename[:180] or "contract"


def _learner_upload_metadata(cursor, learner_id):
    cursor.execute(
        '''
        select learner_name, learner_email, programme_name
        from "Last_audit".learners
        where aptem_id = %s
        limit 1
        ''',
        [learner_id],
    )
    learner = cursor.fetchone()
    if not learner:
        return None

    cursor.execute(
        '''
        select program_status, "Break in learning", "Programme understanding"
        from fetching_evidence.aptem_cv_contracts_probe
        where learner_id = %s and source <> 'audit_upload'
        order by fetched_at desc nulls last, id desc
        limit 1
        ''',
        [learner_id],
    )
    source = cursor.fetchone() or (None, {}, {})
    return {
        "name": learner[0] or f"Learner {learner_id}",
        "email": learner[1],
        "programme": learner[2] or "",
        "programme_status": source[0],
        "break_in_learning": source[1] or {},
        "programme_understanding": source[2] or {},
    }


@csrf_exempt
def upload_contract(request):
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request, write=True):
        return _error("Authentication or audit permission is required.", 403)

    try:
        learner_id = int((request.POST.get("learner_id") or "").strip())
    except (TypeError, ValueError):
        return _error("learner_id must be an integer.", 400)

    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return _error("A document file is required.", 400)
    if uploaded_file.size <= 0:
        return _error("The selected document is empty.", 400)
    if uploaded_file.size > MAX_CONTRACT_SIZE:
        return _error("The document must be 25 MB or smaller.", 400)

    filename = _safe_upload_filename(uploaded_file.name)
    extension = os.path.splitext(filename)[1].lower()
    if extension not in ALLOWED_CONTRACT_EXTENSIONS:
        return _error("This document type is not supported.", 400)
    document_name = (request.POST.get("document_name") or filename).strip()[:180] or filename

    try:
        with connections[CONN].cursor() as cursor:
            learner = _learner_upload_metadata(cursor, learner_id)
    except (KeyError, DatabaseError):
        return _error("Could not validate the learner.", 503)
    if not learner:
        return _error("Learner not found.", 404)

    upload_id = uuid.uuid4()
    blob_name = f"aptem_cv_contracts_probe/{learner_id}/uploads/{upload_id}/{filename}"
    try:
        service = _azure_service_client()
        container = os.environ.get("AZURE_CONTRACTS_CONTAINER", "contracts").strip() or "contracts"
        client = service.get_blob_client(container=container, blob=blob_name)
        client.upload_blob(uploaded_file.chunks(), overwrite=False)
        account_name = getattr(service, "account_name", "")
        if not account_name:
            raise RuntimeError("The Azure storage account name is unavailable.")
        azure_path = f"az://{account_name}/{container}/{blob_name}"
    except RuntimeError as error:
        return _error(str(error), 503)
    except Exception:
        return _error("The document could not be uploaded to Azure.", 502)

    raw = {
        "audit_upload": True,
        "original_filename": uploaded_file.name,
        "content_type": uploaded_file.content_type or mimetypes.guess_type(filename)[0],
        "size": uploaded_file.size,
    }
    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cursor:
                cursor.execute(
                    '''
                    insert into fetching_evidence.aptem_cv_contracts_probe (
                        document_category, source, learner_id, full_name, program_name,
                        document_name, status, date, answer_text, file, raw, fetched_at,
                        natural_key, email, current_programme, program_status,
                        "Programme understanding", "Break in learning", azure_path,
                        azure_upload_attempted_at
                    ) values (
                        'Uploaded', 'audit_upload', %s, %s, %s,
                        %s, 'Uploaded', now(), '', '', %s::jsonb, now(),
                        %s, %s, %s, %s,
                        %s::jsonb, %s::jsonb, %s, now()
                    )
                    returning id, date
                    ''',
                    [
                        learner_id, learner["name"], learner["programme"], document_name,
                        json.dumps(raw), f"audit-upload:{upload_id}", learner["email"],
                        learner["programme"], learner["programme_status"],
                        json.dumps(learner["programme_understanding"]),
                        json.dumps(learner["break_in_learning"]), azure_path,
                    ],
                )
                contract_id, uploaded_at = cursor.fetchone()
    except (KeyError, DatabaseError):
        try:
            client.delete_blob(delete_snapshots="include")
        except Exception:
            pass
        return _error("The uploaded document could not be saved.", 503)

    return JsonResponse({
        "ok": True,
        "contract_id": str(contract_id),
        "document_name": document_name,
        "uploaded_at": uploaded_at.isoformat() if uploaded_at else None,
    }, status=201)


@csrf_exempt
def archive_contract(request, contract_id):
    if request.method not in {"PATCH", "DELETE"}:
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request, write=True):
        return _error("Authentication or audit permission is required.", 403)
    try:
        body = json.loads(request.body or b"{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        return _error("Invalid JSON body.", 400)
    archived_by = str(body.get("archived_by") or "").strip()[:200] or None
    if request.method == "PATCH":
        archived = body.get("archived")
        if not isinstance(archived, bool):
            return _error("archived must be true or false.", 400)

    try:
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                '''select learner_id from fetching_evidence.aptem_cv_contracts_probe where id = %s limit 1''',
                [contract_id],
            )
            row = cursor.fetchone()
            if not row:
                return _error("Contract not found.", 404)
            ensure_contract_archive_table(cursor)
            if request.method == "DELETE":
                cursor.execute(
                    '''
                    update "Audit".contract_document_archive
                    set deleted_at = now(), archived_by = coalesce(%s, archived_by), updated_at = now()
                    where contract_id = %s and archived_at is not null and deleted_at is null
                    returning deleted_at
                    ''',
                    [archived_by, contract_id],
                )
                deleted_row = cursor.fetchone()
                if not deleted_row:
                    return _error("Only an archived contract can be deleted.", 409)
                return JsonResponse({
                    "ok": True,
                    "contract_id": str(contract_id),
                    "deleted": True,
                    "deleted_at": deleted_row[0].isoformat(),
                })
            cursor.execute(
                '''
                insert into "Audit".contract_document_archive (
                    contract_id, learner_id, archived_at, deleted_at, archived_by, updated_at
                ) values (%s, %s, case when %s then now() else null end, null, %s, now())
                on conflict (contract_id) do update set
                    learner_id = excluded.learner_id,
                    archived_at = excluded.archived_at,
                    deleted_at = null,
                    archived_by = excluded.archived_by,
                    updated_at = now()
                returning archived_at
                ''',
                [contract_id, row[0], archived, archived_by],
            )
            archived_at = cursor.fetchone()[0]
    except (KeyError, DatabaseError):
        return _error("Could not update the contract archive state.", 503)

    return JsonResponse({
        "ok": True,
        "contract_id": str(contract_id),
        "archived": archived,
        "archived_at": archived_at.isoformat() if archived_at else None,
    })
