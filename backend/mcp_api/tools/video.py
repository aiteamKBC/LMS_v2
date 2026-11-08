"""Account-owned MP4 previews, existing LMS upload service, and read-only status.

File-capable ChatGPT clients supply a temporary download reference. Bytes are
staged privately; the URL is never stored in a preview or used as LMS playback.
The existing pending-change row owns the stage, so no new database table is needed.
"""
from __future__ import annotations

import hashlib
import logging
import re
import tempfile
import time
import uuid
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

from django.core.files import File
from django.core.exceptions import SuspiciousFileOperation
from django.utils import timezone
from django.utils.text import get_valid_filename

from curriculum_api import upload_storage
from curriculum_api.bunny_stream import VideoImportError
from curriculum_api.video_sources import MAX_VIDEO_BYTES, public_response, source_url, validate_video
from curriculum_api.video_uploads import UPLOAD_ROOT, stored_video_path

from ..changes import Validation, WriteTool, payload_hash, register_write_tool
from ..dispatch import call_api
from ..models import McpPendingChange
from ..settings import public_base_url, video_uploads_enabled
from . import ToolError, ToolResult, tool
from .read import CURRICULUM, _archived, _programme_by_id

logger = logging.getLogger("mcp_api")
NAME = "save_curriculum_video"
STAGE_ROOT = "mcp_video_staging"
STAGE_TOOL = "__video_upload_stage"
ID = {"type": "string", "minLength": 1, "maxLength": 200}
DESTINATION = {"programme_id": ID, "module_id": ID, "component_id": ID}


def _enabled():
    from curriculum_api.video_imports import enabled

    if not video_uploads_enabled() or not enabled():
        raise ToolError("MCP video uploads are not enabled. Ask an administrator to configure the video pilot.")


def _id(value):
    value = str(value or "").strip()
    if not re.fullmatch(r"[\w-]+", value, re.ASCII) or value.startswith("training-module-"):
        raise ToolError("Use find_modules and get_module_structure to choose saved module and component ids.")
    return value


def _destination(request, arguments, *, for_write=True):
    _enabled()
    module_id, component_id = _id(arguments.get("module_id")), _id(arguments.get("component_id"))
    programme = _programme_by_id(request, arguments.get("programme_id"))
    if _archived(programme):
        raise ToolError("The programme is archived. Choose an active programme.")
    _, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/")
    if (not isinstance(module, dict) or module.get("isProgrammeDeleted") or _archived(module)
            or (for_write and module.get("status") != "draft")):
        raise ToolError("Videos can only be saved into an existing draft module in an active programme.")
    if str(module.get("programmeId") or "") not in {
        str(programme.get("id") or ""), str(programme.get("sourceId") or ""),
    } - {""}:
        raise ToolError("That module does not belong to the selected programme. Look up the destination again.")
    found = next(((w, c) for w in module.get("weekStructure") or [] for c in w.get("components") or []
                  if c.get("id") == component_id), None)
    week, component = found if found else ({}, None)
    if component is None or component.get("type") != "video":
        raise ToolError("Choose an existing video component in that module. No component was created.")
    settings = component.get("settings") or {}
    scope = {key: str(module.get(field) or "") for key, field in (
        ("programme_id", "programmeId"), ("cohort_id", "cohortId"), ("group_id", "groupId"),
    )}
    snapshot = {"scope": scope, "source_hash": hashlib.sha256(source_url(settings).encode()).hexdigest(),
                "module_title": module.get("title") or "", "component_title": component.get("title") or "",
                "week_id": week.get("id") or "", "week_title": week.get("title") or ""}
    return programme, module, component, snapshot


def _stage_path(stage, account_id):
    path = stage.get("path", "") if isinstance(stage, dict) else ""
    if not re.fullmatch(rf"{STAGE_ROOT}/{int(account_id)}/[0-9a-f]{{32}}\.mp4", path):
        raise ToolError("The video upload does not belong to this account. Prepare the upload again.")
    return path


def _discard(stage, account_id):
    path = _stage_path(stage, account_id)
    try:
        upload_storage.delete(path)
    except Exception:
        logger.warning("MCP staged-video cleanup failed; retained for the scheduled cleanup.")


def _inspect(stream):
    size = validate_video(stream)
    if stream.read(12)[4:8] not in (b"ftyp", b"moov", b"mdat"):
        raise VideoImportError("Choose an MP4 video file.")
    stream.seek(0)
    digest = hashlib.sha256()
    while chunk := stream.read(256 * 1024):
        digest.update(chunk)
    stream.seek(0)
    return size, digest.hexdigest()


def _stage(file_ref, request):
    account_id = request.login_account.pk
    url = file_ref["download_url"]
    try:
        parts = urlsplit(url)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            raise ValueError
        filename = get_valid_filename(file_ref.get("file_name") or "video.mp4")
        if not filename.lower().endswith(".mp4"):
            raise ValueError
    except (ValueError, TypeError, SuspiciousFileOperation):
        raise ToolError("Provide an MP4 file using the client's file-transfer capability, not a local path or chat link.") from None
    path = f"{STAGE_ROOT}/{int(account_id)}/{uuid.uuid4().hex}.mp4"
    storage_started = False
    try:
        with tempfile.TemporaryFile() as stream:
            deadline = time.monotonic() + 1200
            with public_response(url) as response:
                size = 0
                while chunk := response.read(256 * 1024):
                    size += len(chunk)
                    if size > MAX_VIDEO_BYTES or time.monotonic() > deadline:
                        raise VideoImportError("The MP4 exceeds 300 MB or the transfer timed out.")
                    stream.write(chunk)
            size, digest = _inspect(stream)
            stage = {"path": path, "file_name": filename, "size": size, "sha256": digest}
            # Record ownership before writing durable bytes. A process crash
            # between storage and preview creation must not orphan the file.
            # This internal ledger is closed immediately and cannot be applied
            # or appear in list_my_pending_changes. It expires after one day.
            now = timezone.now()
            McpPendingChange.objects.create(
                id=uuid.uuid4(), account_id=account_id, client_id=request.mcp_client.client_id,
                tool=STAGE_TOOL, payload={"stage": stage}, payload_hash=payload_hash({"stage": stage}),
                preview={}, expires_at=now + timedelta(days=1), cancelled_at=now,
            )
            storage_started = True
            stored = upload_storage.store(File(stream, name=filename), path, "video/mp4")
            if stored != path:
                upload_storage.delete(stored)
                raise VideoImportError("The video could not be staged safely. Retry the upload.")
    except VideoImportError as exc:
        if storage_started:
            _discard({"path": path}, account_id)
        raise ToolError(str(exc)) from None
    except Exception:
        if storage_started:
            _discard({"path": path}, account_id)
        raise ToolError("The video could not be received or stored. Transfer the MP4 again.") from None
    return {"path": path, "file_name": filename, "size": size, "sha256": digest}


class SaveVideo(WriteTool):
    name = NAME
    description = ("Prepare an MP4 save into an existing video component of a draft module. Look up its programme, "
                   "module and component first. Supply the video through the client's file-transfer capability. "
                   "Show the preview and apply only after confirmation. Does not publish content.")
    input_schema = {"type": "object", "properties": {
        **DESTINATION, "title": {"type": "string", "minLength": 1, "maxLength": 500},
        "file": {"type": "object", "properties": {
            "download_url": {"type": "string", "minLength": 1, "maxLength": 8192},
            "file_id": {"type": "string", "minLength": 1, "maxLength": 500},
            "file_name": {"type": "string", "maxLength": 255},
            "mime_type": {"type": "string", "maxLength": 100},
        }, "required": ["download_url", "file_id"], "additionalProperties": False},
    }, "required": [*DESTINATION, "file"], "additionalProperties": False}
    file_params = ("file",)
    rate_bucket = "video_uploads"

    def propose(self, request, arguments):
        _destination(request, arguments)  # Refuse bad destinations before any transfer/storage.
        stage = _stage(arguments["file"], request)
        try:
            return super().propose(request, {**{k: v for k, v in arguments.items() if k != "file"}, "stage": stage})
        except Exception:
            _discard(stage, request.login_account.pk)
            raise

    def validate(self, request, arguments):
        programme, module, component, snapshot = _destination(request, arguments)
        stage = arguments.get("stage") or {}
        _stage_path(stage, request.login_account.pk)
        if not isinstance(stage.get("size"), int) or not 0 < stage["size"] <= MAX_VIDEO_BYTES:
            raise ToolError("The staged video is invalid. Transfer the MP4 again.")
        return Validation({"programme_id": str(programme["id"]),
                           "module_id": _id(module.get("moduleCatalogueId") or arguments["module_id"]),
                           "component_id": str(component["id"]),
                           "title": arguments.get("title") or component.get("title") or "Curriculum video",
                           "stage": stage, "snapshot": snapshot})

    def preview(self, request, payload):
        return {"summary": f"Save '{payload['stage']['file_name']}' to {payload['snapshot']['module_title']} "
                           f"/ {payload['snapshot']['week_title']} / {payload['snapshot']['component_title']}; "
                           "queue a Bunny copy. No publishing.",
                "details": {"programme_id": payload["programme_id"], "module_id": payload["module_id"],
                            "component_id": payload["component_id"], "file_name": payload["stage"]["file_name"],
                            "size_bytes": payload["stage"]["size"], "title": payload["title"]}}

    def apply(self, request, payload, progress):
        stage = payload["stage"]
        relative = _stage_path(stage, request.login_account.pk)
        path, cleanup = upload_storage.local_copy(relative)
        try:
            if path is None:
                raise ToolError("The staged MP4 is unavailable. Prepare the upload again.")
            with path.open("rb") as stream:
                try:
                    size, digest = _inspect(stream)
                except VideoImportError:
                    raise ToolError("The staged MP4 is no longer valid. Transfer it again.") from None
                if size != stage["size"] or digest != stage["sha256"]:
                    raise ToolError("The staged MP4 changed after the preview. Transfer it again.")
                try:
                    _, data = call_api(request, "POST",
                                       f"{CURRICULUM}/videos/module/{payload['module_id']}/{payload['component_id']}/",
                                       json_body={"title": payload["title"], **payload["snapshot"]["scope"]},
                                       uploaded_file=File(stream, name=stage["file_name"]))
                except Exception as exc:
                    if getattr(exc, "status", None) not in (400, 401, 403, 404, 405, 409, 413):
                        progress.uncertain("The LMS video save was attempted, but its result could not be confirmed")
                    raise
            saved = data.get("savedSettings") if isinstance(data, dict) else None
            expected_path = f"{UPLOAD_ROOT}/videos/module/{payload['module_id']}/{payload['component_id']}/{digest}.mp4"
            if (not isinstance(saved, dict) or stored_video_path(source_url(saved)) != expected_path
                    or saved.get("sourceType") != "HTML (MP4)" or saved.get("provider") != "Upload file"):
                progress.uncertain("The LMS accepted the upload, but did not confirm its saved video source")
                raise ToolError("The upload response did not confirm a playable LMS source. Check the component before retrying.")
            progress.done("Saved the MP4 for LMS playback")
            job = data.get("import") or {}
            result = {"lms_saved": True, "bunny_status": job.get("status", "unknown"), "import_id": job.get("id")}
            _discard(stage, request.login_account.pk)
            return {"summary": "The MP4 was saved in the LMS. Bunny copying/encoding may still be pending.",
                    "result": result,
                    "links": [f"{public_base_url()}/curriculum/module-builder?{urlencode({'module': payload['module_id']})}"]}
        finally:
            cleanup()


register_write_tool(SaveVideo())


def _latest_import(module_id, component_id):
    from curriculum_api.models import CurriculumVideoImport

    return CurriculumVideoImport.objects.filter(target_kind="module", target_id=module_id,
                                                component_id=component_id).order_by("-requested_at").first()


@tool("get_video_import_status", "Read the latest Bunny import state for an existing video component. "
      "A saved LMS video and a completed Bunny copy are different states. Does not start or retry transfers.",
      {"type": "object", "properties": DESTINATION, "required": list(DESTINATION), "additionalProperties": False})
def get_video_import_status(request, arguments):
    _, module, component, _snapshot = _destination(request, arguments, for_write=False)
    module_id = _id(module.get("moduleCatalogueId") or arguments["module_id"])
    asset = _latest_import(module_id, component["id"])
    current_source = source_url(component.get("settings") or {})
    saved = bool(stored_video_path(current_source))
    if asset and asset.source_at_start != current_source:
        return ToolResult("The latest Bunny import belongs to a previous video source; check the current video in the LMS.",
                          {"lms_source_recorded": saved, "bunny_status": "source_changed", "import_id": None,
                           "error": "The current video source differs from the latest import."})
    state = asset.status if asset else "not_queued"
    return ToolResult(f"LMS MP4 source recorded: {'yes' if saved else 'no'}. Bunny import: {state}.",
                      {"lms_source_recorded": saved, "bunny_status": state,
                       "import_id": str(asset.pk) if asset else None, "error": asset.error if asset else ""})


def cleanup_expired_video_previews(now, *, dry_run=False):
    """Delete only private stages belonging to expired, account-owned previews."""
    count = 0
    rows = McpPendingChange.objects.filter(tool__in=[NAME, STAGE_TOOL], expires_at__lt=now).values("account_id", "payload")
    for row in rows.iterator():
        stage = (row["payload"] or {}).get("stage") or {}
        try:
            _stage_path(stage, row["account_id"])
        except ToolError:
            logger.warning("MCP video cleanup refused a stage with an invalid owner/path.")
            continue
        count += 1
        if not dry_run:
            _discard(stage, row["account_id"])
    return count
