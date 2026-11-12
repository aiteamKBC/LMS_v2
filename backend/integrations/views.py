from __future__ import annotations

import json
import uuid

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .breathe import BreatheApiError
from .models import ExternalPersonLink, IntegrationConnection, IntegrationSyncRun, IntegrationTenant, ManagerSignatoryGrant, SchedulingConflict
from .permissions import integration_access
from .services import ALLOWED_RESOURCES, client_for, create_sync_run


def _body(request):
    try:
        value = json.loads(request.body or "{}")
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _connection(value):
    try:
        return IntegrationConnection.objects.get(pk=uuid.UUID(str(value)))
    except (IntegrationConnection.DoesNotExist, ValueError, TypeError):
        return None


def _connection_payload(connection):
    return {
        "id": str(connection.id),
        "tenantId": str(connection.tenant_id),
        "provider": connection.provider,
        "externalAccountId": connection.external_account_id,
        "status": connection.status,
        "enabledFeatures": connection.enabled_features or [],
        "lastVerifiedAt": connection.last_verified_at.isoformat() if connection.last_verified_at else None,
        "lastSyncAt": connection.last_sync_at.isoformat() if connection.last_sync_at else None,
        "lastError": connection.last_error or None,
    }


def _run_payload(run):
    return {
        "id": str(run.id),
        "connectionId": str(run.connection_id),
        "status": run.status,
        "resources": run.resources or [],
        "dryRun": bool(run.dry_run),
        "counts": run.counts or {},
        "errorCode": run.error_code or None,
        "errorMessage": run.error_message or None,
        "createdAt": run.created_at.isoformat() if run.created_at else None,
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": run.finished_at.isoformat() if run.finished_at else None,
    }


def _in_actor_tenant(request, connection):
    actor = getattr(request, "integration_actor", None)
    if actor is None or actor.role != "employer":
        return True
    return IntegrationTenant.objects.filter(
        pk=connection.tenant_id,
        employer_id=actor.subject_id,
        active=True,
    ).exists()


@require_GET
@integration_access(allow_employer=True)
def connections(request):
    actor = getattr(request, "integration_actor", None)
    query = IntegrationConnection.objects.all().order_by("external_account_id")
    if actor is not None and actor.role == "employer":
        tenant_ids = IntegrationTenant.objects.filter(employer_id=actor.subject_id, active=True).values_list("id", flat=True)
        query = query.filter(tenant_id__in=tenant_ids)
    return JsonResponse({"results": [_connection_payload(connection) for connection in query[:100]]})


@require_POST
@integration_access(allow_employer=False)
def create_connection(request):
    body = _body(request)
    tenant_id = None
    if body.get("tenant_id"):
        try:
            tenant_id = uuid.UUID(str(body.get("tenant_id")))
        except (TypeError, ValueError):
            return JsonResponse({"error": "tenant_id must be a UUID."}, status=400)
    if tenant_id is None:
        tenant_key = str(body.get("tenant_key") or "").strip()
        display_name = str(body.get("display_name") or tenant_key).strip()
        if not tenant_key or not display_name:
            return JsonResponse({"error": "tenant_id or tenant_key and display_name are required."}, status=400)
        tenant, _ = IntegrationTenant.objects.get_or_create(
            tenant_key=tenant_key,
            defaults={"display_name": display_name, "tenant_kind": str(body.get("tenant_kind") or "employer"), "employer_id": body.get("employer_id")},
        )
        tenant_id = tenant.id
    external_account_id = str(body.get("external_account_id") or "").strip()
    secret_ref = str(body.get("secret_ref") or "").strip()
    if not external_account_id or not secret_ref:
        return JsonResponse({"error": "external_account_id and secret_ref are required."}, status=400)
    connection = IntegrationConnection.objects.create(
        tenant_id=tenant_id,
        provider="breathe",
        external_account_id=external_account_id,
        secret_ref=secret_ref,
        base_url=str(body.get("base_url") or "https://api.sandbox.breathehr.info").strip(),
        enabled_features=body.get("enabled_features") if isinstance(body.get("enabled_features"), list) else [],
    )
    return JsonResponse(_connection_payload(connection), status=201)


@require_GET
@integration_access(allow_employer=True)
def signatory_grants(request, tenant_id):
    try:
        tenant_uuid = uuid.UUID(str(tenant_id))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Tenant not found."}, status=404)
    tenant = IntegrationTenant.objects.filter(pk=tenant_uuid, active=True).first()
    if not tenant or not _tenant_visible_to_actor(request, tenant):
        return JsonResponse({"error": "Tenant not found."}, status=404)
    grants = ManagerSignatoryGrant.objects.filter(tenant_id=tenant.id).order_by("login_account_id")
    return JsonResponse({"results": [{"id": str(grant.id), "loginAccountId": grant.login_account_id, "externalManagerId": grant.external_manager_id, "canSign": grant.can_sign, "startsAt": grant.starts_at.isoformat() if grant.starts_at else None, "endsAt": grant.ends_at.isoformat() if grant.ends_at else None} for grant in grants]})


def _tenant_visible_to_actor(request, tenant):
    actor = getattr(request, "integration_actor", None)
    if actor is None or actor.role != "employer":
        return True
    return tenant.employer_id == actor.subject_id


@require_POST
@integration_access(allow_employer=True)
def create_signatory_grant(request, tenant_id):
    try:
        tenant_uuid = uuid.UUID(str(tenant_id))
    except (TypeError, ValueError):
        return JsonResponse({"error": "Tenant not found."}, status=404)
    tenant = IntegrationTenant.objects.filter(pk=tenant_uuid, active=True).first()
    if not tenant or not _tenant_visible_to_actor(request, tenant):
        return JsonResponse({"error": "Tenant not found."}, status=404)
    body = _body(request)
    try:
        login_account_id = int(body.get("login_account_id"))
    except (TypeError, ValueError):
        return JsonResponse({"error": "login_account_id must be an integer."}, status=400)
    grant = ManagerSignatoryGrant.objects.create(
        tenant_id=tenant.id,
        login_account_id=login_account_id,
        external_manager_id=str(body.get("external_manager_id") or "").strip(),
        granted_by=getattr(getattr(request, "integration_actor", None), "id", None),
        can_sign=bool(body.get("can_sign", True)),
    )
    return JsonResponse({"id": str(grant.id), "loginAccountId": grant.login_account_id, "externalManagerId": grant.external_manager_id, "canSign": grant.can_sign}, status=201)


@csrf_exempt
@require_POST
@integration_access(allow_employer=True, allow_service=True)
def trigger_sync(request, connection_id):
    # The scheduler authenticates with HMAC because it has no CSRF cookie. A
    # browser session still needs the same custom header used by the rest of
    # the SPA, so a cross-site HTML form cannot use this exemption.
    if getattr(request, "integration_actor", None) is not None and request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return JsonResponse({"error": "XHR header required."}, status=403)
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    body = _body(request)
    resources = body.get("resources") or list(ALLOWED_RESOURCES)
    if not isinstance(resources, list) or not resources or any(value not in ALLOWED_RESOURCES for value in resources):
        return JsonResponse({"error": "resources contains an unsupported Breathe resource."}, status=400)
    run, duplicate = create_sync_run(
        connection,
        resources=resources,
        dry_run=bool(body.get("dry_run", False)),
        idempotency_key=str(body.get("idempotency_key") or uuid.uuid4()),
    )
    return JsonResponse({"sync_run_id": str(run.id), "connection_id": str(connection.id), "status": run.status, "deduplicated": duplicate}, status=202)


@require_GET
@integration_access(allow_employer=True)
def connection_status(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    return JsonResponse(_connection_payload(connection))


@require_GET
@integration_access(allow_employer=True)
def sync_runs(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    runs = IntegrationSyncRun.objects.filter(connection_id=connection.id).order_by("-created_at")[:50]
    return JsonResponse({"results": [_run_payload(run) for run in runs]})


@require_GET
@integration_access(allow_employer=True)
def scheduling_conflicts(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    conflicts = SchedulingConflict.objects.filter(connection_id=connection.id).order_by("-starts_at")[:200]
    return JsonResponse({"results": [{"id": str(row.id), "externalPersonId": row.external_person_id, "sessionRef": row.session_ref, "startsAt": row.starts_at.isoformat(), "endsAt": row.ends_at.isoformat(), "status": row.status, "proposedSlots": row.proposed_slots or []} for row in conflicts]})


@require_GET
@integration_access(allow_employer=True)
def preview(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    rows = ExternalPersonLink.objects.filter(connection_id=connection.id, mapping_status="pending").order_by("display_name")[:200]
    return JsonResponse({"connection": _connection_payload(connection), "pendingMatches": [{"id": str(row.id), "externalEmployeeId": row.external_employee_id, "email": row.external_email, "displayName": row.display_name, "department": row.department_name, "jobTitle": row.job_title, "status": row.mapping_status} for row in rows]})


@require_POST
@integration_access(allow_employer=True)
def validate_connection(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    try:
        account = client_for(connection).account()
    except BreatheApiError as exc:
        return JsonResponse({"error": str(exc), "code": "breathe_validation_failed"}, status=502)
    return JsonResponse({"ok": True, "account": {key: account.get(key) for key in ("id", "name", "subdomain") if isinstance(account, dict) and account.get(key)}})


@require_POST
@integration_access(allow_employer=True)
def approve_match(request, connection_id):
    connection = _connection(connection_id)
    if not connection:
        return JsonResponse({"error": "Connection not found."}, status=404)
    if not _in_actor_tenant(request, connection):
        return JsonResponse({"error": "Connection is outside your tenant."}, status=404)
    body = _body(request)
    external_id = str(body.get("external_employee_id") or "").strip()
    if not external_id:
        return JsonResponse({"error": "external_employee_id is required."}, status=400)
    link = ExternalPersonLink.objects.filter(connection_id=connection.id, external_employee_id=external_id).first()
    if not link:
        return JsonResponse({"error": "Pending person not found."}, status=404)
    account_id = body.get("login_account_id")
    try:
        link.lms_account_id = int(account_id) if account_id is not None else None
    except (TypeError, ValueError):
        return JsonResponse({"error": "login_account_id must be an integer."}, status=400)
    link.mapping_status = "approved"
    link.save(update_fields=("lms_account_id", "mapping_status", "updated_at"))
    return JsonResponse({"ok": True, "externalEmployeeId": link.external_employee_id, "mappingStatus": link.mapping_status})
