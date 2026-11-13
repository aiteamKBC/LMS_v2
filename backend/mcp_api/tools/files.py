"""Upload a reading (PDF/Word), PowerPoint or podcast file into an existing component.

The file arrives as a ChatGPT file reference (``file``) or a pasted public link (``file_url``),
is checked (allowed extension for the component type, matching file signature, 300 MB) and
staged privately for the account at preview time, exactly like the video tool. Nothing in the
LMS changes until ``apply_change``, which:

1. stores the file through the LMS upload endpoint ``POST curriculum/components/<id>/upload/``
   (the Module Builder's own route, same storage and serving path);
2. points the component at it with a revision-checked component PATCH.

Step 2 is needed because the upload endpoint's own settings write does not land: it writes a
``settings`` key, the table column is ``settings_json``, and ``authoring_upsert`` drops unknown
keys (reported, not fixed here). The settings set are the ones that endpoint intends
(``_update_component_upload_settings``), then read back. A failure rolls the database back;
a blob already stored in step 1 then stays unreferenced in upload storage.
"""
from __future__ import annotations

import hashlib
import logging
import mimetypes
import re
import tempfile
import time
import uuid
from datetime import timedelta
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from django.core.files import File
from django.utils import timezone
from django.utils.text import get_valid_filename

from curriculum_api import upload_storage
from curriculum_api.bunny_stream import VideoImportError
from curriculum_api.video_sources import YOUTUBE_HOSTS, download_url, public_response

from ..changes import Validation, WriteTool, payload_hash, register_write_tool
from ..dispatch import call_api
from ..models import McpPendingChange
from ..settings import file_uploads_enabled
from . import ToolError
from .components import ID, LiveModuleWarning, draft_module, stored_duration
from .content import _component_after, _run
from .quizzes import structure_revision
from .read import CURRICULUM, _s

logger = logging.getLogger("mcp_api")
NAME = "save_component_file"
STAGE_ROOT = "mcp_file_staging"
STAGE_TOOL = "__file_upload_stage"
MAX_BYTES = 300 * 1024 * 1024

_ZIP, _OLE = (b"PK\x03\x04",), (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)
#: extension -> accepted leading bytes (None: plain text, checked separately).
SIGNATURES = {
    ".pdf": (b"%PDF-",), ".docx": _ZIP, ".pptx": _ZIP, ".ppsx": _ZIP, ".odt": _ZIP,
    ".doc": _OLE, ".ppt": _OLE, ".pps": _OLE, ".rtf": (b"{\\rtf",), ".txt": None,
    ".mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"), ".wav": (b"RIFF",), ".ogg": (b"OggS",),
    ".oga": (b"OggS",), ".webm": (b"\x1aE\xdf\xa3",), ".aac": (b"\xff\xf1", b"\xff\xf9"),
}
ISO_MEDIA = {".m4a", ".mp4"}  # "ftyp" at byte 4
#: What each component type points at once a file is attached (the upload endpoint's intended settings).
TYPE_SETTINGS = {
    "reading": lambda m: {"readingSource": "LMS resource", "resourceUrl": m["url"]},
    "powerpoint": lambda m: {"fileName": m["fileName"], "presentationUrl": m["url"]},
    "podcast": lambda m: {"podcastSource": "Device upload", "podcastUrl": m["url"]},
}
EXISTING_KEYS = ("uploadedFileUrl", "resourceUrl", "presentationUrl", "podcastUrl", "readingContent")


def _allowed_extensions(component_type):
    from curriculum_api.views import COMPONENT_UPLOAD_EXTENSIONS

    return COMPONENT_UPLOAD_EXTENSIONS.get(component_type, set())


def _check_bytes(stream, suffix):
    """Size and signature check; returns ``(size, sha256)``. Raises ToolError for anything else."""
    stream.seek(0, 2)
    size = stream.tell()
    stream.seek(0)
    if not 0 < size <= MAX_BYTES:
        raise ToolError("The file must be non-empty and no larger than 300 MB.")
    head = stream.read(16)
    stream.seek(0)
    if suffix in ISO_MEDIA:
        ok = head[4:8] == b"ftyp"
    elif suffix == ".txt":
        sample = stream.read(64 * 1024)
        stream.seek(0)
        ok = b"\x00" not in sample and not sample.lstrip().lower().startswith((b"<!doctype", b"<html"))
    else:
        ok = head.startswith(SIGNATURES.get(suffix) or (b"\x00\x00",))
    if not ok:
        raise ToolError(f"The file's contents do not match a {suffix} file. Send the original file, not a "
                        "viewing or sign-in page.")
    digest = hashlib.sha256()
    while chunk := stream.read(256 * 1024):
        digest.update(chunk)
    stream.seek(0)
    return size, digest.hexdigest()


def _stage_path(stage, account_id):
    path = stage.get("path", "") if isinstance(stage, dict) else ""
    if not re.fullmatch(rf"{STAGE_ROOT}/{int(account_id)}/[0-9a-f]{{32}}\.[a-z0-9]{{2,5}}", path):
        raise ToolError("The file upload does not belong to this account. Prepare the upload again.")
    return path


def _discard(stage, account_id):
    try:
        upload_storage.delete(_stage_path(stage, account_id))
    except ToolError:
        raise
    except Exception:
        logger.warning("MCP staged-file cleanup failed; retained for the scheduled cleanup.")


def _download(url, stream):
    deadline, size = time.monotonic() + 1200, 0
    with public_response(url) as response:
        if "text/html" in (response.headers.get("Content-Type") or "").lower():
            raise ToolError("This link opens a web page, not the file. Share the file itself (for Google Drive: "
                            "'Anyone with the link'), or attach it.")
        while chunk := response.read(256 * 1024):
            size += len(chunk)
            if size > MAX_BYTES or time.monotonic() > deadline:
                raise ToolError("The file exceeds 300 MB or the transfer timed out.")
            stream.write(chunk)


def _stage(request, source_url, file_name, component_type):
    """Download, check and privately stage one file for this account; returns the stage record."""
    name = get_valid_filename(file_name or "") if file_name else ""
    suffix = PurePosixPath(name).suffix.lower()
    allowed = _allowed_extensions(component_type)
    if suffix not in allowed:
        raise ToolError(f"A {component_type} component accepts: {', '.join(sorted(allowed))}. "
                        "Give the file's name with its extension.")
    account_id = request.login_account.pk
    path = f"{STAGE_ROOT}/{int(account_id)}/{uuid.uuid4().hex}{suffix}"
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    stored = False
    try:
        with tempfile.TemporaryFile() as stream:
            _download(source_url, stream)
            size, digest = _check_bytes(stream, suffix)
            stage = {"path": path, "file_name": name, "size": size, "sha256": digest, "content_type": content_type}
            # Ownership is recorded before the bytes are stored, so a crash cannot orphan them.
            now = timezone.now()
            McpPendingChange.objects.create(
                id=uuid.uuid4(), account_id=account_id, client_id=request.mcp_client.client_id,
                tool=STAGE_TOOL, payload={"stage": stage}, payload_hash=payload_hash({"stage": stage}),
                preview={}, expires_at=now + timedelta(days=1), cancelled_at=now,
            )
            stored = True
            if upload_storage.store(File(stream, name=name), path, content_type) != path:
                raise ToolError("The file could not be staged safely. Retry the upload.")
        return stage
    except VideoImportError as exc:  # public_response's address/redirect refusals
        if stored:
            _discard({"path": path}, account_id)
        raise ToolError(str(exc).replace("video", "file")) from None
    except ToolError:
        if stored:
            _discard({"path": path}, account_id)
        raise
    except Exception:
        logger.exception("MCP file staging failed")
        if stored:
            _discard({"path": path}, account_id)
        raise ToolError("The file could not be received or stored. Send it again.") from None


def _source(arguments):
    """``(url, file_name)`` from exactly one of ``file`` / ``file_url``."""
    if ("file" in arguments) == ("file_url" in arguments):
        raise ToolError("Give the file either as an attachment or as a pasted link, not both or neither.")
    if "file" in arguments:
        ref = arguments["file"]
        url = ref["download_url"]
        if urlsplit(url).scheme != "https":
            raise ToolError("Attach the file using the client's file-transfer capability, not a local path.")
        return url, ref.get("file_name") or ""
    url = arguments["file_url"].strip()
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or not host or parts.username or parts.password:
        raise ToolError("Paste an https link to the file, without a username or password in it.")
    if host in YOUTUBE_HOSTS or host.endswith("notebooklm.google.com"):
        raise ToolError("That link is a viewing page, not a file. Download the file and attach it instead.")
    name = arguments.get("file_name") or unquote(PurePosixPath(parts.path).name)
    return download_url(url), name


class SaveComponentFile(LiveModuleWarning, WriteTool):
    name = NAME
    description = (
        "Preview uploading a file into an existing Reading (PDF, Word, RTF, ODT, TXT), PowerPoint (PPT/PPTX/PPS/"
        "PPSX or PDF) or Podcast (MP3, M4A, WAV, AAC, OGG, WebM) component. Give the file EITHER attached (file) "
        "OR as a pasted public link to the file itself (file_url, with file_name if the link has no extension). "
        "If the component already has a file or written text it is replaced only with replace_existing true, "
        "after the user agrees. Max 300 MB. Apply only after confirmation. Nothing is published."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        "file": {"type": "object", "properties": {
            "download_url": {"type": "string", "minLength": 1, "maxLength": 8192},
            "file_id": {"type": "string", "minLength": 1, "maxLength": 500},
            "file_name": {"type": "string", "maxLength": 255},
            "mime_type": {"type": "string", "maxLength": 100},
        }, "required": ["download_url", "file_id"], "additionalProperties": False},
        "file_url": {"type": "string", "minLength": 1, "maxLength": 2048},
        "file_name": {"type": "string", "maxLength": 255},
        "replace_existing": {"type": "boolean"},
    }, "required": ["module_id", "component_id"], "additionalProperties": False}
    file_params = ("file",)
    rate_bucket = "file_uploads"

    def _target(self, request, arguments):
        _, module = draft_module(request, arguments, enabled=file_uploads_enabled, feature="file upload")
        component_id = _s(arguments.get("component_id"))
        for week in module.get("weekStructure") or []:
            for component in week.get("components") or []:
                if _s(component.get("id")) != component_id:
                    continue
                if _s(component.get("type")) not in TYPE_SETTINGS:
                    raise ToolError("Files can be uploaded to Reading, PowerPoint or Podcast components only "
                                    "(use save_curriculum_video for videos).")
                return module, week, component
        raise ToolError("Choose an existing component in that module (use list_module_weeks).")

    def propose(self, request, arguments):
        module, _, component = self._target(request, arguments)  # refuse bad destinations before any transfer
        url, name = _source(arguments)
        stage = _stage(request, url, name, _s(component.get("type")))
        try:
            rest = {k: v for k, v in arguments.items() if k not in ("file", "file_url", "file_name")}
            return super().propose(request, {**rest, "stage": stage})
        except Exception:
            _discard(stage, request.login_account.pk)
            raise

    def validate(self, request, arguments):
        module, week, component = self._target(request, arguments)
        stage = arguments.get("stage") or {}
        _stage_path(stage, request.login_account.pk)
        settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
        existing = [key for key in EXISTING_KEYS if _s(settings.get(key))]
        if existing and not arguments.get("replace_existing"):
            raise ToolError(f"'{component.get('title')}' already has a file or written content. Ask the user "
                            "whether to replace it; if they agree, call again with replace_existing true.")
        return Validation({
            **{k: arguments[k] for k in ("programme_id", "replace_existing") if k in arguments},
            "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
            "component_id": _s(component.get("id")), "component_type": _s(component.get("type")),
            "names": {"module": _s(module.get("title")), "week": _s(week.get("title")),
                      "component": _s(component.get("title"))},
            "replaces": existing, "stage": stage, "component_duration": stored_duration(component),
        })

    def preview(self, request, payload):
        stage, names = payload["stage"], payload["names"]
        action = "REPLACE the existing content of" if payload["replaces"] else "Upload into"
        return {"summary": f"{action} '{names['component']}' ({names['module']} › {names['week']}): "
                           f"'{stage['file_name']}' ({stage['size'] / 1_048_576:.1f} MB).",
                "details": {"names": names, "file_name": stage["file_name"], "size_bytes": stage["size"],
                            "replaces": payload["replaces"], "note": "Saved to the module; nothing is published."}}

    def apply(self, request, payload, progress):
        stage, account_id = payload["stage"], request.login_account.pk
        relative = _stage_path(stage, account_id)

        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The component changed since the preview. Prepare a new preview.")
            local, cleanup = upload_storage.local_copy(relative)
            try:
                if local is None:
                    raise ToolError("The staged file is unavailable. Prepare the upload again.")
                with local.open("rb") as stream:
                    if _check_bytes(stream, PurePosixPath(relative).suffix) != (stage["size"], stage["sha256"]):
                        raise ToolError("The staged file changed after the preview. Send it again.")
                    _, data = call_api(
                        request, "POST", f"{CURRICULUM}/components/{payload['component_id']}/upload/",
                        json_body={"componentType": payload["component_type"], "moduleCatalogueId": payload["module_id"]},
                        uploaded_file=File(stream, name=stage["file_name"]))
            finally:
                cleanup()
            meta = (data or {}).get("file") if isinstance(data, dict) else None
            if not isinstance(meta, dict) or not _s(meta.get("url")).startswith("/curriculum_api/curriculum/uploads/"):
                raise ToolError("The LMS did not confirm the stored file, so the component was not changed.")
            settings = {"uploadedFileName": meta["fileName"], "uploadedFileUrl": meta["url"],
                        "uploadedFileSize": meta["size"], "uploadedFileContentType": meta.get("contentType") or "",
                        "uploadSource": "Device upload", **TYPE_SETTINGS[payload["component_type"]](meta)}
            body = {"expectedRevision": structure_revision(request, payload["module_id"]), "settings": settings,
                    "duration": payload["component_duration"]}
            call_api(request, "PATCH", f"{CURRICULUM}/components/{payload['component_id']}/", json_body=body)
            saved = _component_after(request, payload["module_id"], payload["component_id"]).get("settings") or {}
            if any(saved.get(k) != v for k, v in settings.items()):
                raise ToolError("The component did not read back with the new file, so it was not changed.")
            return meta

        meta = _run(progress, "Saving the file", work)
        _discard(stage, account_id)
        progress.done("Uploaded the file and attached it", component_id=payload["component_id"])
        return {"summary": f"Uploaded '{meta['fileName']}' to '{payload['names']['component']}'.",
                "result": {"component_id": payload["component_id"], "file_name": meta["fileName"],
                           "url": meta["url"], "size": meta["size"]}}


register_write_tool(SaveComponentFile())


def cleanup_expired_file_previews(now, *, dry_run=False):
    """Delete only private file stages belonging to expired, account-owned previews."""
    count = 0
    rows = McpPendingChange.objects.filter(tool__in=[NAME, STAGE_TOOL], expires_at__lt=now).values("account_id", "payload")
    for row in rows.iterator():
        stage = (row["payload"] or {}).get("stage") or {}
        try:
            _stage_path(stage, row["account_id"])
        except ToolError:
            logger.warning("MCP file cleanup refused a stage with an invalid owner/path.")
            continue
        count += 1
        if not dry_run:
            _discard(stage, row["account_id"])
    return count
