import datetime
import decimal
import json
import os
import uuid
from urllib.parse import unquote

from django.db import DatabaseError, connections
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.csrf import csrf_exempt

try:
    from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas
except ImportError:  # pragma: no cover - handled at runtime when Azure is not installed.
    BlobServiceClient = None
    BlobSasPermissions = None
    generate_blob_sas = None


AUDIT_SCHEMA = "fetching_evidence"
MAIN_TABLE = "learner_evidence"
RELATED_TABLES = ("learner_ksbs", "evidence_items", "aptem_cv_contracts_probe")
LEARNER_ID_COLUMNS = ("learner_id", "LearnerId", "LearnerID", "learnerId", "learner")
NAME_COLUMNS = ("full_name", "FullName", "LearnerName", "learner_name", "name")
EVIDENCE_ID_COLUMNS = ("id", "Id", "evidence_id", "EvidenceId", "EvidenceID")
SIGNOFF_TABLE = "audit_signoffs"


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _json_safe(value):
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped[:1] in ("{", "["):
            try:
                return json.loads(stripped)
            except ValueError:
                return value
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return value


def _rows_from_cursor(cur):
    columns = [col[0] for col in cur.description]
    return [
        {column: _json_safe(value) for column, value in zip(columns, row)}
        for row in cur.fetchall()
    ]


def _table_columns(cur, table):
    cur.execute(
        """
        select column_name
        from information_schema.columns
        where table_schema = %s and table_name = %s
        order by ordinal_position
        """,
        [AUDIT_SCHEMA, table],
    )
    return [row[0] for row in cur.fetchall()]


def _first_column(columns, candidates):
    lowered = {column.lower(): column for column in columns}
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered[candidate.lower()]
    return None


def _select_all_for_learner(cur, table, learner_id, learner_name=None):
    columns = _table_columns(cur, table)
    if not columns:
        return [], {"table": table, "available": False, "matchedBy": None}

    id_column = _first_column(columns, LEARNER_ID_COLUMNS)
    name_column = _first_column(columns, NAME_COLUMNS)
    quoted_table = f'"{AUDIT_SCHEMA}"."{table}"'

    if id_column:
        cur.execute(
            f'select * from {quoted_table} where "{id_column}"::text = %s order by 1',
            [str(learner_id)],
        )
        rows = _rows_from_cursor(cur)
        if rows or not learner_name or not name_column:
            return rows, {"table": table, "available": True, "matchedBy": id_column}

    if learner_name and name_column:
        cur.execute(
            f'select * from {quoted_table} where lower("{name_column}"::text) = lower(%s) order by 1',
            [learner_name],
        )
        return _rows_from_cursor(cur), {"table": table, "available": True, "matchedBy": name_column}

    return [], {"table": table, "available": True, "matchedBy": id_column}


def _normalize_evidence(rows):
    if not rows:
        return []

    value = rows[0].get("evidence")
    if value is None:
        value = rows[0].get("Evidence")
    value = _json_safe(value)

    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _normalize_azure_manifest(rows):
    if not rows:
        return None

    value = rows[0].get("azure_manifest")
    if value is None:
        value = rows[0].get("AzureManifest")
    value = _json_safe(value)

    return value if isinstance(value, dict) else None


def _manifest_evidence_items(manifest):
    if not isinstance(manifest, dict):
        return []

    container = manifest.get("container") or ""
    items = manifest.get("items")
    if not isinstance(items, list):
        return []

    normalized = []
    for item in items:
        if not isinstance(item, dict):
            continue
        normalized.append({**item, "_azure_container": item.get("container") or container})
    return normalized


def _evidence_ids(evidence):
    ids = []
    for item in evidence:
        if not isinstance(item, dict):
            continue
        raw = item.get("raw") if isinstance(item.get("raw"), dict) else {}
        value = item.get("id") or item.get("evidence_id") or raw.get("Id") or raw.get("id")
        if value is not None:
            ids.append(str(value))
    return sorted(set(ids))


def _select_evidence_items_by_ids(cur, evidence_ids):
    if not evidence_ids:
        return []
    columns = _table_columns(cur, "evidence_items")
    id_column = _first_column(columns, EVIDENCE_ID_COLUMNS)
    if not id_column:
        return []
    cur.execute(
        f'select * from "{AUDIT_SCHEMA}"."evidence_items" where "{id_column}"::text = any(%s) order by 1',
        [evidence_ids],
    )
    return _rows_from_cursor(cur)


def learner_audit(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    learner_name = (request.GET.get("name") or "").strip() or None

    try:
        with connections["enrolment"].cursor() as cur:
            learner_rows, learner_meta = _select_all_for_learner(cur, MAIN_TABLE, learner_id, learner_name)
            azure_manifest = _normalize_azure_manifest(learner_rows)
            evidence = _manifest_evidence_items(azure_manifest) or _normalize_evidence(learner_rows)
            related = {}
            meta = {MAIN_TABLE: learner_meta}
            for table in RELATED_TABLES:
                rows, table_meta = _select_all_for_learner(cur, table, learner_id, learner_name)
                if table == "evidence_items" and not rows:
                    rows = _select_evidence_items_by_ids(cur, _evidence_ids(evidence))
                    if rows:
                        table_meta = {**table_meta, "matchedBy": "evidence.id"}
                related[table] = rows
                meta[table] = table_meta
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    primary = learner_rows[0] if learner_rows else None
    return JsonResponse(
        {
            "learnerId": str(learner_id),
            "learner": primary,
            "learnerRows": learner_rows,
            "azureManifest": azure_manifest,
            "evidence": evidence,
            "related": related,
            "meta": meta,
        }
    )


def _evidence_date(value):
    if not isinstance(value, dict):
        return ""
    raw = value.get("raw") if isinstance(value.get("raw"), dict) else {}
    for key in ("submission_date", "completed_date", "SubmissionDate", "SubmittedDate", "CompletedDate", "UpdatedDate", "created_date", "date"):
        candidate = value.get(key) or raw.get(key)
        if candidate:
            return str(candidate)
    return ""


def _learner_summary(row):
    azure_manifest = _normalize_azure_manifest([row])
    evidence = _manifest_evidence_items(azure_manifest) or _normalize_evidence([row])
    dates = sorted([date for date in (_evidence_date(item) for item in evidence) if date], reverse=True)
    counts = azure_manifest.get("counts") if isinstance(azure_manifest, dict) and isinstance(azure_manifest.get("counts"), dict) else {}
    return {
        "learnerId": str(row.get("learner_id") or row.get("LearnerId") or row.get("LearnerID") or ""),
        "fullName": row.get("full_name") or row.get("LearnerName") or row.get("name") or "",
        "programName": row.get("program_name") or row.get("Programme") or "",
        "evidenceCount": counts.get("present") or (row.get("evidence_count") if row.get("evidence_count") is not None else len(evidence)),
        "fetchedAt": row.get("fetched_at") or "",
        "latestEvidenceDate": dates[0] if dates else "",
    }


def learner_audit_list(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    search = (request.GET.get("search") or "").strip()
    limit_raw = request.GET.get("limit") or "100"
    try:
        limit = max(1, min(int(limit_raw), 500))
    except ValueError:
        limit = 100

    try:
        with connections["enrolment"].cursor() as cur:
            if search:
                pattern = f"%{search}%"
                cur.execute(
                    f"""
                    select *
                    from "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                    where learner_id::text ilike %s
                       or full_name ilike %s
                       or program_name ilike %s
                    order by id
                    limit %s
                    """,
                    [pattern, pattern, pattern, limit],
                )
            else:
                cur.execute(
                    f"""
                    select *
                    from "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                    order by id
                    limit %s
                    """,
                    [limit],
                )
            rows = _rows_from_cursor(cur)
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"count": len(rows), "results": [_learner_summary(row) for row in rows]})


def _azure_service_client():
    if BlobServiceClient is None:
        raise RuntimeError("The azure-storage-blob package is not installed.")
    connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured.")
    return BlobServiceClient.from_connection_string(connection_string)


def _azure_connection_parts():
    connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
    parts = {}
    for chunk in connection_string.split(";"):
        if "=" in chunk:
            key, value = chunk.split("=", 1)
            parts[key] = value
    return parts


def _blob_client_with_fallback(service, container, blob_name):
    client = service.get_blob_client(container=container, blob=blob_name)
    try:
        client.get_blob_properties()
        return client
    except Exception as exc:
        fallback_container = f"{container}s" if not container.endswith("s") else ""
        if not fallback_container or "ContainerNotFound" not in str(exc):
            raise
        fallback_client = service.get_blob_client(container=fallback_container, blob=blob_name)
        fallback_client.get_blob_properties()
        return fallback_client


def _signed_blob_url(client):
    parts = _azure_connection_parts()
    connection_sas = (parts.get("SharedAccessSignature") or "").lstrip("?")
    if connection_sas:
        separator = "&" if "?" in client.url else "?"
        return f"{client.url}{separator}{connection_sas}"

    account_name = parts.get("AccountName") or getattr(client, "account_name", "")
    account_key = parts.get("AccountKey")
    if not account_name or not account_key or generate_blob_sas is None or BlobSasPermissions is None:
        return client.url

    token = generate_blob_sas(
        account_name=account_name,
        container_name=client.container_name,
        blob_name=client.blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30),
    )
    return f"{client.url}?{token}"


def audit_blob(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

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


def _ensure_signoff_table(cur):
    cur.execute(
        f"""
        create table if not exists "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}" (
            learner_id text primary key,
            learner_name text,
            program_name text,
            evidence_count integer,
            learner_signer_name text,
            learner_signature text,
            learner_confirmed boolean default false,
            learner_signed_at timestamp with time zone,
            coach_signer_name text,
            coach_signature text,
            coach_confirmed boolean default false,
            coach_signed_at timestamp with time zone,
            pdf_file_name text,
            payload jsonb default '{{}}'::jsonb,
            created_at timestamp with time zone default now(),
            updated_at timestamp with time zone default now()
        )
        """
    )


def _select_signoff(cur, learner_id):
    _ensure_signoff_table(cur)
    cur.execute(
        f'select * from "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}" where learner_id = %s',
        [str(learner_id)],
    )
    rows = _rows_from_cursor(cur)
    return rows[0] if rows else None


@csrf_exempt
def learner_signoff(request, learner_id):
    if request.method == "GET":
        try:
            with connections["enrolment"].cursor() as cur:
                row = _select_signoff(cur, learner_id)
        except KeyError:
            return _error("The enrolment database connection is not configured.", 500)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)
        return JsonResponse({"learnerId": str(learner_id), "signoff": row})

    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return _error("Invalid JSON body.", 400)

    try:
        with connections["enrolment"].cursor() as cur:
            _ensure_signoff_table(cur)
            cur.execute(
                f"""
                insert into "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}" (
                    learner_id,
                    learner_name,
                    program_name,
                    evidence_count,
                    learner_signer_name,
                    learner_signature,
                    learner_confirmed,
                    learner_signed_at,
                    coach_signer_name,
                    coach_signature,
                    coach_confirmed,
                    coach_signed_at,
                    pdf_file_name,
                    payload,
                    updated_at
                )
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now())
                on conflict (learner_id) do update set
                    learner_name = excluded.learner_name,
                    program_name = excluded.program_name,
                    evidence_count = excluded.evidence_count,
                    learner_signer_name = excluded.learner_signer_name,
                    learner_signature = excluded.learner_signature,
                    learner_confirmed = excluded.learner_confirmed,
                    learner_signed_at = excluded.learner_signed_at,
                    coach_signer_name = excluded.coach_signer_name,
                    coach_signature = excluded.coach_signature,
                    coach_confirmed = excluded.coach_confirmed,
                    coach_signed_at = excluded.coach_signed_at,
                    pdf_file_name = excluded.pdf_file_name,
                    payload = excluded.payload,
                    updated_at = now()
                """,
                [
                    str(learner_id),
                    payload.get("learnerName") or "",
                    payload.get("programName") or "",
                    payload.get("evidenceCount") or 0,
                    payload.get("learnerSignerName") or "",
                    payload.get("learnerSignature") or "",
                    bool(payload.get("learnerConfirmed")),
                    payload.get("learnerSignedAt") or None,
                    payload.get("coachSignerName") or "",
                    payload.get("coachSignature") or "",
                    bool(payload.get("coachConfirmed")),
                    payload.get("coachSignedAt") or None,
                    payload.get("pdfFileName") or "",
                    json.dumps(payload),
                ],
            )
            row = _select_signoff(cur, learner_id)
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"learnerId": str(learner_id), "signoff": row})
