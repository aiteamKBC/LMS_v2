"""Project the AI in Marketing audit table into the normal learner journey."""

from __future__ import annotations

import json
import re
import urllib.parse
from decimal import Decimal

from django.db import connection, transaction

from curriculum_api import programme_audit
from curriculum_api import views


MODULE_ID = "MOD-AI-IN-MARKETING-MM"
WEEK_ID = "WEEK-AI-IN-MARKETING-MM"
MODULE_TITLE = "AI in Marketing"
PROGRAMME_NAME = "Marketing Manager"
AUDIT_TABLE = "ai_in_marketing"
COMPONENT_PREFIX = "COMP-AI-MKT-"


def _json_object(value):
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _text(value):
    return str(value or "").strip()


def _first(*values):
    return next((_text(value) for value in values if _text(value)), "")


def _legacy_attachment_id(*values):
    """Read an attachment id from direct or Office-Viewer-wrapped LMS URLs."""
    for value in values:
        decoded = _text(value)
        for _attempt in range(3):
            decoded = urllib.parse.unquote(decoded)
        match = re.search(r"(?:[?&]|%3[fF]|%26)attachment_id(?:=|%3[dD])([0-9]{1,20})", decoded)
        if not match:
            match = re.search(r"/_legacy_files/([0-9]{1,20})/", decoded)
        if match:
            return match.group(1)
    return ""


def _learner_source_url(*values):
    source = _first(*values)
    attachment_id = _legacy_attachment_id(*values)
    return f"/learner_api/media/legacy-attachment/{attachment_id}/" if attachment_id else source


def _audit_rows():
    if not programme_audit.ui_material_table_exists(AUDIT_TABLE):
        return []
    table = (
        f'{programme_audit.quote_ident(programme_audit.PROGRAMME_AUDIT_SCHEMA)}.'
        f'{programme_audit.quote_ident(AUDIT_TABLE)}'
    )
    columns = (
        "id", "component_id", "component_type", "content_kind", "title",
        "description", "source_url", "embed_url", "file_name", "content_type",
        "duration_minutes", "expected_otjh", "points", "settings", "raw_component",
    )
    with connection.cursor() as cursor:
        cursor.execute(
            f'SELECT {", ".join(programme_audit.quote_ident(column) for column in columns)} '
            f'FROM {table} ORDER BY title, component_id, id'
        )
        return programme_audit.rows_as_dicts(cursor)


def _programme_identity():
    """Return the real curriculum programme key (``MM`` is only a UI label)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT programme_id, programme_name FROM curriculum.modules "
            "WHERE module_catalogue_id = %s LIMIT 1",
            ["MOD-202608223E23693425BC"],
        )
        row = cursor.fetchone()
        if row:
            return row[0], row[1] or PROGRAMME_NAME
        cursor.execute(
            "SELECT programme_id, name FROM curriculum.programmes "
            "WHERE lower(name) = lower(%s) ORDER BY programme_id LIMIT 1",
            [PROGRAMME_NAME],
        )
        row = cursor.fetchone()
    if not row:
        raise RuntimeError(f'Curriculum programme "{PROGRAMME_NAME}" was not found.')
    return row[0], row[1] or PROGRAMME_NAME


def _component_type(row):
    kind = _text(row.get("content_kind")).casefold()
    source_type = _text(row.get("component_type")).casefold()
    if kind == "video" or source_type == "video":
        return "video"
    if kind in {"audio", "podcast"} or source_type in {"audio", "podcast"}:
        return "podcast"
    # Legacy quiz shells have no question payload. Treating their body as a
    # reading keeps it visible in the standard runner instead of opening a dead quiz.
    return "reading"


def _settings(row, raw, component_type):
    settings = _json_object(row.get("settings"))
    source = _learner_source_url(row.get("source_url"), row.get("embed_url"))
    duration = row.get("duration_minutes")
    quiz = _json_object(raw.get("quiz"))
    reading = _json_object(raw.get("reading"))
    body = _first(
        settings.get("readingContent"), reading.get("content"),
        raw.get("content_html"), quiz.get("quiz_body"), row.get("description"),
    )
    settings.update({
        "version": settings.get("version") or "0.1",
        "contentStatus": "Approved",
        "legacySourceType": "programme-audit-ai-marketing",
    })
    if duration not in (None, ""):
        settings["durationMinutes"] = int(duration)

    if component_type == "video":
        settings["videoUrl"] = _learner_source_url(
            settings.get("videoUrl"), raw.get("video_url"), source,
        )
        settings.setdefault("sourceType", "External link")
    elif component_type == "podcast":
        settings["podcastUrl"] = _learner_source_url(
            settings.get("podcastUrl"), settings.get("audioUrl"), raw.get("audio_url"), source,
        )
        settings.setdefault("podcastSource", "External URL")
    else:
        resource = _learner_source_url(
            settings.get("resourceUrl"), settings.get("uploadedFileUrl"),
            reading.get("iframe_url"), source,
        )
        if resource:
            settings["resourceUrl"] = resource
        if body:
            settings["readingContent"] = body

    file_name = _text(row.get("file_name"))
    content_type = _text(row.get("content_type"))
    reading_type = _text(reading.get("reading_type")).casefold()
    inferred_files = {
        "pdf": ("pdf", "application/pdf"),
        "ppt": ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "pptx": ("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "doc": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "docx": ("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xls": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        "xlsx": ("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    }
    inferred = inferred_files.get(reading_type)
    if not file_name and inferred:
        extension, inferred_content_type = inferred
        file_name = f'{_first(row.get("title"), raw.get("title"), "document")}.{extension}'
        content_type = content_type or inferred_content_type
    if file_name:
        settings.setdefault("uploadedFileName", file_name)
        settings.setdefault("fileName", file_name)
    if content_type:
        settings.setdefault("uploadedFileContentType", content_type)
    return settings


def build_projection():
    rows = _audit_rows()
    components = []
    total_otjh = Decimal("0")
    seen_ids = set()
    for order, row in enumerate(rows, start=1):
        source_id = _first(row.get("component_id"), row.get("id"), order)
        component_id = f"{COMPONENT_PREFIX}{source_id}"[:128]
        if component_id in seen_ids:
            component_id = f"{COMPONENT_PREFIX}{source_id}-{order}"[:128]
        seen_ids.add(component_id)

        raw = _json_object(row.get("raw_component"))
        component_type = _component_type(row)
        expected_otjh = row.get("expected_otjh")
        if expected_otjh in (None, ""):
            expected_otjh = Decimal(str(row.get("duration_minutes") or 0)) / Decimal("60")
        expected_otjh = Decimal(str(expected_otjh or 0)).quantize(Decimal("0.01"))
        total_otjh += expected_otjh
        components.append({
            "id": component_id,
            "week_id": WEEK_ID,
            "module_catalogue_id": MODULE_ID,
            "type": component_type,
            "title": _first(row.get("title"), raw.get("title"), "Untitled activity"),
            "description": _text(row.get("description")),
            "expected_otjh": expected_otjh,
            "points": int(row.get("points") or 0),
            "ksb_mappings": views.json_db_value([]),
            "reflection_required": False,
            "workplace_evidence_required": False,
            "tutor_validation_required": False,
            "display_order": order,
            "settings_json": views.json_db_value(_settings(row, raw, component_type)),
            "live_sessions_link": "",
            "is_programme_deleted": False,
            "deleted_at": None,
            "deleted_by": None,
            "deleted_via_parent": None,
        })
    return rows, components, total_otjh.quantize(Decimal("0.01"))


def sync_projection():
    rows, components, total_otjh = build_projection()
    if not rows:
        raise RuntimeError("programme_audit.ai_in_marketing is missing or empty.")
    programme_id, programme_name = _programme_identity()
    module = {
        "module_catalogue_id": MODULE_ID, "programme_id": programme_id,
        "programme_name": programme_name, "title": MODULE_TITLE,
        "description": "AI in Marketing activities synced from the LMS audit table.",
        "total_otjh": total_otjh, "quality_score": 100,
        "is_programme_deleted": False, "deleted_at": None,
        "deleted_by": None, "deleted_via_parent": None,
    }
    week = {
        "id": WEEK_ID, "module_catalogue_id": MODULE_ID, "week_number": 1,
        "title": "Learning content", "summary": MODULE_TITLE,
        "learning_outcomes": views.json_db_value([]), "display_order": 1,
        "is_programme_deleted": False, "deleted_at": None,
        "deleted_by": None, "deleted_via_parent": None,
    }
    with transaction.atomic():
        views.authoring_upsert(views.AUTHORING_MODULES_TABLE, ["module_catalogue_id"], module)
        views.authoring_upsert(views.AUTHORING_WEEKS_TABLE, ["id"], week)
        # This audit table is authoritative, so stale rows from an earlier sync
        # must not remain visible to the learner.
        views.authoring_delete(views.AUTHORING_COMPONENTS_TABLE, "module_catalogue_id = %s", [MODULE_ID])
        views.authoring_bulk_upsert(views.AUTHORING_COMPONENTS_TABLE, ["id"], components)
    return {"components": len(components), "total_otjh": float(total_otjh)}
