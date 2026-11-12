from __future__ import annotations

import os
import re
import uuid
import base64
import hashlib
from datetime import datetime, timezone

from django.db import transaction
from cryptography.fernet import Fernet, InvalidToken

from .breathe import BreatheApiError, BreatheClient
from .models import (
    AvailabilityBlock,
    DepartmentMapping,
    ExternalPersonLink,
    ExternalTrainingRecord,
    IntegrationConnection,
    IntegrationSyncRun,
    SchedulingConflict,
)
from .normalizers import normalize_department, normalize_employee, normalize_leave, normalize_training

ALLOWED_RESOURCES = ("employees", "departments", "divisions", "working_patterns", "leave_requests", "training_courses")


def secret_env_name(secret_ref):
    return "BREATHE_API_KEY_" + re.sub(r"[^A-Za-z0-9]", "_", str(secret_ref or "")).upper().strip("_")


def api_key_for(connection):
    ciphertext = str(getattr(connection, "secret_ciphertext", "") or "")
    if ciphertext:
        try:
            raw = os.environ.get("CREDENTIAL_ENCRYPTION_KEY", "").encode()
            if not raw:
                raise BreatheApiError("Breathe credential encryption is not configured.")
            key = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
            return Fernet(key).decrypt(ciphertext.encode()).decode()
        except (InvalidToken, ValueError, TypeError, UnicodeDecodeError) as exc:
            raise BreatheApiError("The stored Breathe credential could not be decrypted.") from exc
    if str(connection.secret_ref).startswith("env:"):
        name = str(connection.secret_ref)[4:]
        if not re.fullmatch(r"BREATHE_API_KEY_[A-Z0-9_]+", name):
            raise BreatheApiError("The secret reference must name a Breathe API key.")
        return os.environ.get(name, "")
    return os.environ.get(secret_env_name(connection.secret_ref), "")


def encrypt_api_key(value):
    raw = os.environ.get("CREDENTIAL_ENCRYPTION_KEY", "").encode()
    if not raw:
        raise BreatheApiError("Breathe credential encryption is not configured.")
    key = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
    return Fernet(key).encrypt(str(value).encode()).decode()


def client_for(connection, *, session=None):
    return BreatheClient(connection.base_url, api_key_for(connection), session=session)


def create_sync_run(connection, *, resources, dry_run=False, idempotency_key=None):
    key = idempotency_key or str(uuid.uuid4())
    existing = IntegrationSyncRun.objects.filter(connection_id=connection.id, idempotency_key=key).first()
    if existing:
        return existing, True
    run = IntegrationSyncRun.objects.create(
        tenant_id=connection.tenant_id,
        connection_id=connection.id,
        resources=list(resources),
        dry_run=bool(dry_run),
        idempotency_key=key,
        status="queued",
    )
    return run, False


def _save_employees(connection, rows):
    count = 0
    now = datetime.now(timezone.utc)
    for raw in rows:
        item = normalize_employee(raw)
        if not item["external_employee_id"]:
            continue
        ExternalPersonLink.objects.update_or_create(
            connection_id=connection.id,
            external_employee_id=item["external_employee_id"],
            defaults={"tenant_id": connection.tenant_id, **item, "last_seen_at": now},
        )
        count += 1
    return count


def _save_departments(connection, rows):
    count = 0
    for raw in rows:
        item = normalize_department(raw)
        if not item["external_department_id"]:
            continue
        DepartmentMapping.objects.update_or_create(
            connection_id=connection.id,
            external_department_id=item["external_department_id"],
            defaults={"tenant_id": connection.tenant_id, **item},
        )
        count += 1
    return count


def _save_leaves(connection, rows):
    count = 0
    for raw in rows:
        item = normalize_leave(raw)
        if not item or not item["external_person_id"] or not item["source_ref"]:
            continue
        AvailabilityBlock.objects.update_or_create(
            connection_id=connection.id,
            source_ref=item["source_ref"],
            defaults={"tenant_id": connection.tenant_id, "block_type": "approved_leave", **item},
        )
        count += 1
    return count


def _save_training(connection, rows):
    count = 0
    for raw in rows:
        item = normalize_training(raw)
        if not item["external_training_id"] or not item["external_employee_id"]:
            continue
        ExternalTrainingRecord.objects.update_or_create(
            connection_id=connection.id,
            external_training_id=item["external_training_id"],
            defaults={"tenant_id": connection.tenant_id, **item},
        )
        count += 1
    return count


def process_sync_run(run_id, *, client=None):
    run = IntegrationSyncRun.objects.get(pk=run_id)
    connection = IntegrationConnection.objects.get(pk=run.connection_id)
    run.status = "running"
    run.started_at = datetime.now(timezone.utc)
    run.save(update_fields=("status", "started_at"))
    counts = {}
    try:
        client = client or client_for(connection)
        account = client.account()
        if str(account.get("id")) != str(connection.external_account_id):
            raise BreatheApiError("The API key belongs to a different Breathe account.")
        with transaction.atomic():
            for resource in run.resources:
                if resource == "employees":
                    counts[resource] = _save_employees(connection, list(client.list_resource(resource))) if not run.dry_run else sum(1 for _ in client.list_resource(resource))
                elif resource in {"departments", "divisions"}:
                    counts[resource] = _save_departments(connection, list(client.list_resource(resource))) if not run.dry_run else sum(1 for _ in client.list_resource(resource))
                elif resource == "leave_requests":
                    counts[resource] = _save_leaves(connection, list(client.list_resource(resource))) if not run.dry_run else sum(1 for _ in client.list_resource(resource))
                elif resource == "training_courses":
                    counts[resource] = _save_training(connection, list(client.list_resource(resource))) if not run.dry_run else sum(1 for _ in client.list_resource(resource))
                elif resource == "working_patterns":
                    counts[resource] = sum(1 for _ in client.list_resource(resource))
        if not run.dry_run:
            from .company_training import apply_rules
            apply_rules(connection)
        run.status = "completed"
        run.counts = counts
        run.finished_at = datetime.now(timezone.utc)
        run.save(update_fields=("status", "counts", "finished_at"))
        if not run.dry_run:
            connection.status = "active"
            connection.last_sync_at = run.finished_at
            connection.last_verified_at = run.finished_at
            connection.last_error = ""
            connection.save(update_fields=("status", "last_sync_at", "last_verified_at", "last_error", "updated_at"))
        return run
    except Exception as exc:
        run.status = "failed"
        run.error_code = getattr(exc, "status", None) and f"http_{exc.status}" or exc.__class__.__name__.lower()
        run.error_message = str(exc)[:1000] if isinstance(exc, BreatheApiError) else "The integration sync failed. Check the worker logs."
        run.finished_at = datetime.now(timezone.utc)
        run.save(update_fields=("status", "error_code", "error_message", "finished_at"))
        if not run.dry_run:
            connection.status = "attention"
            connection.last_error = run.error_message
            connection.save(update_fields=("status", "last_error", "updated_at"))
        raise


def detect_availability_conflicts(connection_id, sessions):
    """Record overlaps for review without moving sessions or changing OTJ hours."""
    conflicts = []
    blocks = AvailabilityBlock.objects.filter(connection_id=connection_id, block_type="approved_leave")
    for session in sessions:
        session_ref = str(session.get("session_ref") or "").strip()
        starts_at = session.get("starts_at")
        ends_at = session.get("ends_at")
        person_id = str(session.get("external_person_id") or "").strip()
        if not session_ref or not starts_at or not ends_at or not person_id:
            continue
        block = blocks.filter(external_person_id=person_id, starts_at__lt=ends_at, ends_at__gt=starts_at).first()
        if not block:
            continue
        conflict, _ = SchedulingConflict.objects.update_or_create(
            connection_id=connection_id,
            session_ref=session_ref,
            defaults={
                "tenant_id": block.tenant_id,
                "external_person_id": person_id,
                "starts_at": starts_at,
                "ends_at": ends_at,
                "block_id": block.id,
                "status": "pending",
            },
        )
        conflicts.append(conflict)
    return conflicts
