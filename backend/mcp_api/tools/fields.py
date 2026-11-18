"""The component fields and settings the assistant may set, shared by creating and updating.

The settings come from the LMS's own schema (``COMPONENT_SETTINGS_SCHEMA``), so a type
gains a field here when the Module Builder does. Excluded are the settings another tool
owns, the ones the Teams calendar and session schedule own, and raw HTML embeds (A8).
"""
from __future__ import annotations

import re
from urllib.parse import urlsplit

from . import ToolError
from .read import _s

#: HTML tags, inline event handlers or javascript: URLs: refused in any text the assistant writes (A8).
UNSAFE = re.compile(r"<\s*/?\s*[a-zA-Z!]|\bon[a-z]+\s*=|javascript\s*:", re.IGNORECASE)

#: Component fields beyond the settings, as (argument, LMS field, input schema).
DETAIL_FIELDS = (
    ("title", "title", {"type": "string", "minLength": 1, "maxLength": 200}),
    ("description", "description", {"type": "string", "maxLength": 10000}),
    ("expected_otjh", "expectedOtjh", {"type": "number", "minimum": 0, "maximum": 1000}),
    ("points", "points", {"type": "integer", "minimum": 0, "maximum": 10000}),
    ("reflection_required", "reflectionRequired", {"type": "boolean"}),
    ("reflection_question", "reflectionQuestion", {"type": "string", "maxLength": 5000}),
    ("tutor_validation_required", "tutorValidationRequired", {"type": "boolean"}),
    ("coach_validation_required", "coachValidationRequired", {"type": "boolean"}),
)
DURATION = {"type": "integer", "minimum": 0, "maximum": 10000}
MEDIA_URL = {"type": "string", "minLength": 1, "maxLength": 2048}
SETTINGS = {"type": "object", "additionalProperties": {"type": ["string", "number", "boolean"]}}

#: Settings never written here: another tool owns them (duration_minutes, add_lesson_content,
#: save_component_file, the quiz tools), the Teams calendar and session schedule own them, or
#: they hold raw HTML embeds.
LOCKED_SETTINGS = frozenset({
    "durationMinutes", "readingContent", "embedCode", "shortcode",
    "componentFiles", "uploadSource", "uploadedFileName", "uploadedFileUrl", "uploadedFileSize",
    "uploadedFileContentType", "assignmentFileName", "assignmentFileUrl",
    "buildMode", "linkedQuizId", "linkedLiveSessionComponentId", "linkedLiveSessionModuleId",
    "sessionDate", "sessionDay", "sessionTime", "sessionDateTimeUtc", "selectedGroupKeys", "selectedGroupNames",
    "liveSessionUrl", "liveSessionLinkOverride",
})
LOCKED_PREFIX = "teams"
MAX_SETTING_TEXT = 50_000
#: Hosts the LMS accepts as a YouTube video source (its validator matches youtube.com and youtu.be).
YOUTUBE_LINK_HOSTS = frozenset(("youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com"))


def editable_settings(component_type):
    """``{key: LMS default}`` of the settings the assistant may write for a component type."""
    from curriculum_api.views import component_settings_defaults

    return {key: default for key, default in component_settings_defaults(component_type).items()
            if key not in LOCKED_SETTINGS and not key.startswith(LOCKED_PREFIX)}


def setting_kind(default):
    if isinstance(default, bool):
        return "true or false"
    return "a number" if isinstance(default, (int, float)) else "text"


def _setting_value(key, value, default):
    kind = setting_kind(default)
    if kind == "true or false":
        valid = isinstance(value, bool)
    elif kind == "a number":
        valid = isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0
    else:
        valid = isinstance(value, str)
    if not valid:
        raise ToolError(f"settings.{key} must be {kind}.")
    if isinstance(value, str):
        value = value.strip()
        if len(value) > MAX_SETTING_TEXT:
            raise ToolError(f"settings.{key} is too long ({MAX_SETTING_TEXT} characters at most).")
        if UNSAFE.search(value):
            raise ToolError(f"Write settings.{key} as plain text or Markdown; HTML is not allowed.")
    if key == "contentStatus" and value == "Approved":
        raise ToolError("Approval is a reviewer's sign-off: approve the component in the LMS.")
    return value


def _media_settings(component_type, url):
    """The settings that make ``url`` the playable source of a Podcast or Video component."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        valid = parts.scheme == "https" and bool(host) and not (parts.username or parts.password)
    except ValueError:
        valid = False
    if not valid:
        raise ToolError("Give the link as a full https address, without a username or password in it.")
    if component_type == "podcast":
        # Stored as 'External URL'; the Module Builder shows it as 'External Link'.
        return {"podcastSource": "External URL", "podcastUrl": url}
    if component_type == "video":
        if host not in YOUTUBE_LINK_HOSTS:
            raise ToolError("A video link must be a YouTube link. For an MP4 file, or a Google Drive / SharePoint "
                            "file link, use save_curriculum_video.")
        return {"sourceType": "YouTube", "provider": "YouTube", "videoUrl": url}
    raise ToolError("media_url is only for Podcast and Video components.")


def requested_settings(component_type, arguments):
    """The checked settings from ``settings`` and ``media_url`` in ``arguments``."""
    allowed = editable_settings(component_type)
    wanted = {}
    for key, value in (arguments.get("settings") or {}).items():
        if key not in allowed:
            raise ToolError(f"settings.{key} cannot be set by the assistant on a {component_type} component. "
                            "Use get_component to see which settings can.")
        wanted[key] = _setting_value(key, value, allowed[key])
    if "media_url" in arguments:
        media = _media_settings(component_type, _s(arguments["media_url"]))
        if wanted.keys() & media.keys():
            raise ToolError("Give the link either as media_url or in settings, not both.")
        wanted.update(media)
    return wanted


def requested_details(arguments):
    """``{LMS field: value}`` for the detail fields given in ``arguments``, checked and tidied."""
    details = {}
    for arg, field, _ in DETAIL_FIELDS:
        if arg not in arguments:
            continue
        value = arguments[arg]
        if isinstance(value, str):
            value = " ".join(value.split()) if arg == "title" else value.strip()
            if UNSAFE.search(value):
                raise ToolError(f"Write the {arg} as plain text or Markdown; HTML is not allowed.")
        if arg == "title" and not value:
            raise ToolError("Give the component a title.")
        details[field] = value
    return details
