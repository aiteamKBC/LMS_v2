# Learner Evidence Upload — Implementation Spec

Feature: learners upload workplace evidence files (PDF/image/video). Files land in a
**private quarantine** container, get scanned/validated, then are **promoted to an
approved container** (downloadable) or **moved to a rejected container**. Metadata and
lifecycle status live in Neon Postgres. Downloads are served only via short-lived Azure
SAS URLs, and only from the approved container.

This spec is stack-specific to KBC: Django + DRF backend, React/TypeScript/Vite frontend,
Neon PostgreSQL, Azure Blob Storage, learners provisioned from Entra ID (each `auth_user`
carries an `azure_oid`).

---

## 0. Prerequisites (already done — do not recreate)

- Azure storage account `kbcdocs` exists (region UK South, GRS, anonymous access disabled,
  TLS 1.2, secure transfer required).
- Three **private** blob containers exist:
  - `evidence-quarantine` — newly uploaded files, nobody can download
  - `evidence-approved` — passed scan + validation, downloadable via SAS
  - `evidence-rejected` — infected or invalid files
- Account key (key1) is available from the Azure portal → Access keys.

Your job is the Django + React code and the Neon migration. Do NOT touch Azure infra.

---

## 1. Environment variables (.env)

Add these to the backend `.env`. Follow the existing `.env` pattern (do not commit secrets;
keep `settings.py` reading from env). **Match the exact UPPERCASE keys** — a case-mismatch
bug (e.g. `Database_url` vs `DATABASE_URL`) has bitten this project before, so be precise.

```
# --- Azure Blob Storage (learner evidence) ---
AZURE_STORAGE_ACCOUNT=kbcdocs
AZURE_STORAGE_KEY=<paste key1 from Azure portal → kbcdocs → Access keys>
AZURE_QUARANTINE_CONTAINER=evidence-quarantine
AZURE_APPROVED_CONTAINER=evidence-approved
AZURE_REJECTED_CONTAINER=evidence-rejected
AZURE_SAS_TTL_MINUTES=15

# Optional — only if using Defender-for-Storage event verification later:
AZURE_TENANT_ID=ddf2d4be-155f-4f5b-bbc4-63e97ba2fa45
```

`settings.py` additions:

```python
import os

AZURE_STORAGE_ACCOUNT      = os.environ["AZURE_STORAGE_ACCOUNT"]
AZURE_STORAGE_KEY          = os.environ["AZURE_STORAGE_KEY"]
AZURE_QUARANTINE_CONTAINER = os.environ.get("AZURE_QUARANTINE_CONTAINER", "evidence-quarantine")
AZURE_APPROVED_CONTAINER   = os.environ.get("AZURE_APPROVED_CONTAINER", "evidence-approved")
AZURE_REJECTED_CONTAINER   = os.environ.get("AZURE_REJECTED_CONTAINER", "evidence-rejected")
AZURE_SAS_TTL_MINUTES      = int(os.environ.get("AZURE_SAS_TTL_MINUTES", "15"))
```

---

## 2. Dependencies

```bash
pip install azure-storage-blob azure-identity
# ClamAV path only (see §6 option B):
pip install clamd
```

Add `azure-storage-blob` and `azure-identity` to `requirements.txt`.

---

## 3. Neon Postgres — table + migration

Create the table via a Django migration (do NOT run raw SQL directly against Neon; use the
model + `makemigrations`/`migrate` so migration history stays consistent — missing migrations
have caused silent breakage here before).

Target schema (final state of the table):

```sql
CREATE TABLE evidence_files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    azure_oid         UUID NOT NULL,
    section_ref       TEXT NOT NULL,          -- the tile/section, e.g. "workplace-evidence-osama"
    container         TEXT NOT NULL,          -- current container the blob lives in
    blob_name         TEXT NOT NULL UNIQUE,   -- Azure blob path/identifier
    original_filename TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    size_bytes        BIGINT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    scan_result       TEXT,                   -- clean | infected | error | NULL(not scanned)
    uploaded_by       INTEGER REFERENCES auth_user(id),
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at       TIMESTAMPTZ,
    reviewed_by       INTEGER REFERENCES auth_user(id)
);
CREATE INDEX idx_evidence_azure_oid ON evidence_files(azure_oid);
CREATE INDEX idx_evidence_section   ON evidence_files(section_ref);
CREATE INDEX idx_evidence_status    ON evidence_files(status);
```

### models.py

```python
import uuid
from django.db import models
from django.contrib.auth.models import User


class EvidenceFile(models.Model):
    class Status(models.TextChoices):
        PENDING  = "pending",  "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="evidence_files")
    azure_oid = models.UUIDField(db_index=True)
    section_ref = models.CharField(max_length=255, db_index=True)
    container = models.CharField(max_length=255)
    blob_name = models.CharField(max_length=1024, unique=True)
    original_filename = models.CharField(max_length=512)
    content_type = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    scan_result = models.CharField(max_length=32, null=True, blank=True)
    uploaded_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="uploaded_evidence")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL, related_name="reviewed_evidence")

    class Meta:
        db_table = "evidence_files"
        ordering = ["-uploaded_at"]
```

Then: `python manage.py makemigrations && python manage.py migrate`.

---

## 4. Azure storage helper — storage.py

Isolate ALL Azure calls here so the rest of the app never talks to the SDK directly.

```python
from datetime import datetime, timedelta, timezone
from django.conf import settings
from azure.storage.blob import (
    BlobServiceClient, ContentSettings,
    generate_blob_sas, BlobSasPermissions,
)


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
        content_settings=ContentSettings(content_type=content_type),
    )
    return blob_name


def move_blob(src_container, dst_container, blob_name):
    """Azure has no atomic move; copy server-side then delete source."""
    svc = _service_client()
    src = svc.get_blob_client(src_container, blob_name)
    dst = svc.get_blob_client(dst_container, blob_name)
    dst.start_copy_from_url(src.url)
    # start_copy is async server-side; for small files it completes near-instantly.
    # For large files, poll dst.get_blob_properties().copy.status until 'success'
    # before deleting. Implement a poll loop with a short timeout.
    src.delete_blob()


def download_blob_bytes(container, blob_name) -> bytes:
    """Used by the scanner to pull the file out of quarantine for inspection."""
    client = _service_client().get_blob_client(container, blob_name)
    return client.download_blob().readall()


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
    return (f"https://{settings.AZURE_STORAGE_ACCOUNT}.blob.core.windows.net/"
            f"{container}/{blob_name}?{token}")
```

---

## 5. DRF views — upload, review, download

```python
import uuid
from django.conf import settings
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import EvidenceFile
from .storage import upload_to_quarantine, move_blob, get_download_sas
from .scanning import scan_and_route   # see §6

ALLOWED_TYPES = {"application/pdf", "image/png", "image/jpeg", "video/mp4"}
MAX_BYTES = 50 * 1024 * 1024  # 50 MB — adjust to policy

STAFF_GROUPS = {"assessor", "quality", "admin"}


def _is_staff(user):
    return user.groups.filter(name__in=STAFF_GROUPS).exists()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def upload_evidence_view(request):
    f = request.FILES.get("file")
    section_ref = request.data.get("section_ref")
    if not f or not section_ref:
        return Response({"error": "file and section_ref are required"}, status=400)
    if f.content_type not in ALLOWED_TYPES:
        return Response({"error": "unsupported file type"}, status=400)
    if f.size > MAX_BYTES:
        return Response({"error": "file exceeds size limit"}, status=400)

    # Learner uploads own evidence; staff may upload on behalf of a learner (pass target_user_id).
    target_user = request.user
    azure_oid = getattr(target_user, "azure_oid", None) or request.data.get("azure_oid")
    if not azure_oid:
        return Response({"error": "no azure_oid resolved for learner"}, status=400)

    ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else "bin"
    blob_name = f"{azure_oid}/{section_ref}/{uuid.uuid4()}.{ext}"

    upload_to_quarantine(f, blob_name, f.content_type)

    rec = EvidenceFile.objects.create(
        user=target_user,
        azure_oid=azure_oid,
        section_ref=section_ref,
        container=settings.AZURE_QUARANTINE_CONTAINER,
        blob_name=blob_name,
        original_filename=f.name,
        content_type=f.content_type,
        size_bytes=f.size,
        status=EvidenceFile.Status.PENDING,
        uploaded_by=request.user,
    )

    # Kick off scan+route. Prefer async (Celery/RQ/thread) so the upload response is fast.
    scan_and_route(str(rec.id))

    return Response(
        {"id": str(rec.id), "status": rec.status, "filename": rec.original_filename},
        status=201,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_evidence_view(request):
    """Learner sees own; staff sees all (optionally filter by ?section_ref= & ?status=)."""
    qs = EvidenceFile.objects.all()
    if not _is_staff(request.user):
        qs = qs.filter(user=request.user)
    if request.query_params.get("section_ref"):
        qs = qs.filter(section_ref=request.query_params["section_ref"])
    if request.query_params.get("status"):
        qs = qs.filter(status=request.query_params["status"])
    data = [{
        "id": str(r.id),
        "filename": r.original_filename,
        "status": r.status,
        "scan_result": r.scan_result,
        "section_ref": r.section_ref,
        "uploaded_at": r.uploaded_at.isoformat(),
    } for r in qs]
    return Response(data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def download_evidence_view(request, file_id):
    try:
        rec = EvidenceFile.objects.get(id=file_id)
    except EvidenceFile.DoesNotExist:
        return Response(status=404)

    # Only approved files are downloadable — never quarantine/rejected.
    if rec.status != EvidenceFile.Status.APPROVED:
        return Response({"error": "file not available for download"}, status=409)

    # Permission: learner can fetch own; staff can fetch any.
    if request.user.id != rec.user_id and not _is_staff(request.user):
        return Response(status=403)

    url = get_download_sas(settings.AZURE_APPROVED_CONTAINER, rec.blob_name)
    return Response({"url": url})
```

urls.py:

```python
from django.urls import path
from . import views

urlpatterns = [
    path("evidence/upload/", views.upload_evidence_view),
    path("evidence/", views.list_evidence_view),
    path("evidence/<uuid:file_id>/download/", views.download_evidence_view),
]
```

---

## 6. Scanning + routing — scanning.py

The file in quarantine must be scanned before it can move to approved. Pick ONE option and
implement `scan_and_route`. **Default to Option B (ClamAV) unless told otherwise**, because it
requires no extra Azure event wiring. Leave a clear TODO if the scanner isn't reachable yet.

Shared routing logic (identical for both options):

```python
from django.conf import settings
from django.utils import timezone
from .models import EvidenceFile
from .storage import move_blob, download_blob_bytes


def _route(rec: EvidenceFile, verdict: str):
    dest = (settings.AZURE_APPROVED_CONTAINER if verdict == "clean"
            else settings.AZURE_REJECTED_CONTAINER)
    move_blob(rec.container, dest, rec.blob_name)
    rec.container = dest
    rec.status = (EvidenceFile.Status.APPROVED if verdict == "clean"
                  else EvidenceFile.Status.REJECTED)
    rec.scan_result = verdict
    rec.reviewed_at = timezone.now()
    rec.save(update_fields=["container", "status", "scan_result", "reviewed_at"])
```

### Option A — Azure Defender for Storage (managed, event-driven)
1. Enable Defender for Storage on the `kbcdocs` account (Azure portal → account → Microsoft
   Defender for Cloud, or the Security tab). It auto-scans blobs on upload.
2. Configure an Event Grid subscription → webhook to a Django endpoint (e.g.
   `/evidence/scan-callback/`) that receives the scan result per blob.
3. In that endpoint, look up the `EvidenceFile` by `blob_name`, map Defender's verdict to
   `clean`/`infected`, and call `_route(rec, verdict)`.
4. `scan_and_route(evidence_id)` becomes a no-op trigger (Defender scans automatically);
   routing happens when the callback fires.

### Option B — ClamAV in the worker (self-hosted, direct)
Requires a reachable clamd (install `clamav-daemon` on the VPS or run it in a container).

```python
import clamd
from .models import EvidenceFile


def scan_and_route(evidence_id: str):
    rec = EvidenceFile.objects.get(id=evidence_id)
    try:
        data = download_blob_bytes(rec.container, rec.blob_name)
        cd = clamd.ClamdUnixSocket()          # or ClamdNetworkSocket(host, port)
        import io
        result = cd.instream(io.BytesIO(data))
        status = result["stream"][0]          # 'OK' or 'FOUND'
        verdict = "clean" if status == "OK" else "infected"
    except Exception:
        verdict = "error"                     # stays out of approved; treat as rejected/needs-review

    _route(rec, verdict if verdict != "error" else "infected")
```

Run this in a background worker (Celery task / RQ job / thread), not inline in the request,
so uploads return quickly. If no worker infra exists yet, call it inline as a first pass and
leave a TODO to move it async.

---

## 7. React upload component (frontend)

TypeScript + Vite. Do NOT use an HTML `<form>` element; use fetch with FormData. Show the
lifecycle status (pending → approved/rejected) after upload.

Requirements:
- File input restricted to allowed types (`accept="application/pdf,image/png,image/jpeg,video/mp4"`).
- Client-side size check (50 MB) before upload for a friendly error.
- POST multipart to `/evidence/upload/` with fields `file` and `section_ref`.
- After upload, poll `/evidence/?section_ref=...` (or the returned id) to reflect status
  moving from `pending` to `approved`/`rejected`, since scanning is async.
- Download button appears only when `status === "approved"`; it calls
  `/evidence/<id>/download/`, receives `{ url }`, and opens/navigates to that SAS URL.
- Match existing KBC component styling/conventions in this repo.

---

## 8. Security invariants (do not violate)

- Upload writes ONLY to the quarantine container. Never write straight to approved.
- `get_download_sas` is ONLY ever called with the approved container. Never quarantine or
  rejected. Enforce with the `status == approved` guard in the download view.
- SAS tokens are read-only and short-lived (`AZURE_SAS_TTL_MINUTES`, default 15).
- The three containers must stay Private (no anonymous access) — do not add public access.
- Never log the account key or full SAS URLs.
- Keep the account key in `.env` only; never commit it. (`settings.py` should already be
  git-ignored / env-driven on this project — verify.)

---

## 9. Acceptance checklist

- [ ] `.env` has all `AZURE_*` keys; `settings.py` reads them.
- [ ] Migration creates `evidence_files` with the `status`, `scan_result`, `reviewed_*` columns.
- [ ] Uploading a clean PDF → row `pending` → becomes `approved`, blob ends up in
      `evidence-approved`, download returns a working SAS URL.
- [ ] Uploading an EICAR test file → verdict `infected` → row `rejected`, blob in
      `evidence-rejected`, download returns 409.
- [ ] A learner cannot download another learner's file (403); staff can.
- [ ] Requesting download of a `pending` file returns 409.
- [ ] No public/anonymous URL can read any container.