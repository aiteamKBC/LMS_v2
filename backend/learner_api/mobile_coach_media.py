"""Stream a verified coach-preview component through maintained media handlers.

The coach facade must validate the live caseload, enrolment and component before
calling ``stream``. URLs come only from that component, never request parameters.
There is no generic URL fetcher, learner impersonation or progress writer here.
"""
import copy
import re
from urllib.parse import parse_qs, quote, unquote, urlsplit

from django.http import HttpResponse, QueryDict

LMS_HOST = "lms.kentbusinesscollege.org"
DRIVE_ID = re.compile(r"[A-Za-z0-9_-]{10,200}\Z")
IDENTITY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}\Z")
UPLOAD_PREFIX = "/curriculum_api/curriculum/uploads/"


def _source(value):
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if "\\" in value or any(ord(char) < 32 for char in value):
        return None
    try:
        url = urlsplit(value)
        if url.username or url.password or url.port:
            return None
        if url.scheme and url.scheme != "https":
            return None
        if not url.scheme and (url.netloc or not url.path.startswith("/")):
            return None
        if url.hostname == "drive.google.com":
            match = re.fullmatch(r"/file/d/([A-Za-z0-9_-]{10,200})(?:/(?:view|preview))?/?", url.path)
            ids = parse_qs(url.query).get("id", [])
            file_id = match[1] if match else ids[0] if re.fullmatch(r"/(?:uc|open)/?", url.path) and len(ids) == 1 else None
            if not file_id or not DRIVE_ID.fullmatch(file_id) or len(ids) > 1 or ids and ids[0] != file_id:
                return None
            return "drive", file_id
        if url.hostname not in (None, LMS_HOST):
            return None
        match = re.fullmatch(r"/learner_api/media/google-drive/([A-Za-z0-9_-]{10,200})/?", url.path)
        if match:
            return "drive", match[1]
        match = re.fullmatch(r"/learner_api/media/legacy-attachment/([0-9]{1,20})/?", url.path)
        if match:
            return "legacy", match[1]
        if url.path.startswith(UPLOAD_PREFIX):
            path = unquote(url.path[len(UPLOAD_PREFIX):])
            # Decode once as the canonical path router does, then reject another
            # escape layer, dot segments, Windows separators and control bytes.
            if (not path or "%" in path or "\\" in path
                    or any(ord(char) < 32 for char in path)
                    or any(part in ("", ".", "..") for part in path.split("/"))):
                return None
            return "upload", path
    except (ValueError, TypeError):
        return None
    return None


def rewrite_media_url(profile_id, component_id, stored_url):
    """Bind protected media to this caseload/component; keep public links intact."""
    if _source(stored_url) is None:
        return stored_url
    profile_id, component_id = str(profile_id), str(component_id)
    if not IDENTITY.fullmatch(profile_id) or not IDENTITY.fullmatch(component_id):
        raise ValueError("Invalid coach material identity")
    return ("/learner_api/mobile/coach/learners/" + quote(profile_id, safe="")
            + "/components/" + quote(component_id, safe="") + "/media/")


def _dispatch(request, source):
    kind, identity = source
    if kind == "upload":
        from curriculum_api.views import curriculum_uploaded_file
        return curriculum_uploaded_file(request, path=identity)
    from . import media_proxy
    if kind == "drive":
        return media_proxy.google_drive_media(request, file_id=identity)
    return media_proxy.legacy_attachment_media(request, attachment_id=identity)


def stream(request, verified_component):
    if request.method != "GET":
        return HttpResponse(status=405, headers={"Allow": "GET"})
    mode = verified_component.get("mobileMode")
    if mode not in ("audio", "video"):
        return HttpResponse(status=404)
    source = _source(verified_component.get("audioUrl" if mode == "audio" else "videoUrl"))
    if source is None:
        return HttpResponse(status=404)
    child = copy.copy(request)
    child.GET = QueryDict("")
    response = _dispatch(child, source)
    # A zero-byte migrated upload may point to its maintained legacy source.
    # Resolve only that fixed provider internally, without escaping coach scope.
    if 300 <= response.status_code < 400:
        fallback = _source(response.get("Location", ""))
        response.close()
        if source[0] != "upload" or fallback is None or fallback[0] != "legacy":
            return HttpResponse(status=404)
        response = _dispatch(child, fallback)
        if 300 <= response.status_code < 400:
            response.close()
            return HttpResponse(status=404)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response
