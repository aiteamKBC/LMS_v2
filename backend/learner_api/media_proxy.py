"""Small media proxy for learner playback and inline material previews.

Google Drive public files can return a valid MP4 to the backend while a browser
`<video>` pointed directly at Drive stays black or refuses to stream reliably.
This endpoint keeps playback same-origin and preserves Range requests, which
native video/audio controls need for loading and seeking.
"""
import html
import http.cookiejar
import re
import urllib.parse
import urllib.error
import urllib.request

from django.db import DatabaseError, connections
from django.http import HttpResponse, JsonResponse, StreamingHttpResponse
from django.views.decorators.http import require_GET


GOOGLE_DRIVE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{10,}$")
LEGACY_ATTACHMENT_ID_RE = re.compile(r"^[0-9]{1,20}$")
CHUNK_SIZE = 1024 * 256


def _stream_response(upstream):
    while True:
        chunk = upstream.read(CHUNK_SIZE)
        if not chunk:
            break
        yield chunk


def _google_drive_warning_download_url(page_html):
    """Extract Drive's "Download anyway" URL from the virus-scan warning page."""
    form = re.search(
        r'<form[^>]+id=["\']download-form["\'][^>]*action=["\']([^"\']+)["\'][^>]*>(.*?)</form>',
        page_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not form:
        return ""
    action = html.unescape(form.group(1))
    inputs = re.findall(
        r'<input[^>]+name=["\']([^"\']+)["\'][^>]+value=["\']([^"\']*)["\']',
        form.group(2),
        flags=re.IGNORECASE,
    )
    if not inputs:
        return ""
    query = urllib.parse.urlencode({
        html.unescape(name): html.unescape(value)
        for name, value in inputs
    })
    return f"{action}?{query}"


def _open_google_drive_file(file_id, range_header=None):
    """Open a Google Drive file stream, following the large-file warning page."""
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    headers = {"User-Agent": "Mozilla/5.0"}
    if range_header:
        headers["Range"] = range_header

    url = f"https://drive.google.com/uc?export=download&id={file_id}"
    upstream = opener.open(urllib.request.Request(url, headers=headers), timeout=30)
    content_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    if "text/html" not in content_type.lower():
        return upstream

    page = upstream.read().decode("utf-8", "replace")
    download_url = _google_drive_warning_download_url(page)
    if not download_url:
        return None
    return opener.open(urllib.request.Request(download_url, headers=headers), timeout=30)


def _office_viewer_source(url):
    parsed = urllib.parse.urlparse(url or "")
    if parsed.netloc.lower() != "view.officeapps.live.com":
        return url
    params = urllib.parse.parse_qs(parsed.query)
    source = (params.get("src") or [""])[0]
    return source or url


def _legacy_attachment_source(attachment_id):
    """Find the original imported source for a legacy attachment id.

    Some Azure/local legacy blobs are zero-byte placeholders. The audit import
    still stores the original WordPress material endpoint with the same
    attachment_id, so learner previews can recover the real file through this
    same-origin proxy.
    """
    like_attachment = f"%attachment_id={attachment_id}%"
    like_encoded_attachment = f"%attachment_id%3D{attachment_id}%"
    like_legacy = f"%/_legacy_files/{attachment_id}/%"
    for alias in ("enrolment", "default"):
        try:
            with connections[alias].cursor() as cur:
                cur.execute(
                    """
                    SELECT source_url, embed_url
                    FROM programme_audit.assets
                    WHERE source_url LIKE %s OR embed_url LIKE %s
                       OR source_url LIKE %s OR embed_url LIKE %s
                       OR source_url LIKE %s OR embed_url LIKE %s
                    ORDER BY
                      CASE
                        WHEN source_url LIKE '%%kentbusinesscollege.org%%' THEN 0
                        WHEN embed_url LIKE '%%kentbusinesscollege.org%%' THEN 1
                        ELSE 2
                      END,
                      updated_at DESC NULLS LAST,
                      imported_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    [
                        like_attachment,
                        like_attachment,
                        like_encoded_attachment,
                        like_encoded_attachment,
                        like_legacy,
                        like_legacy,
                    ],
                )
                row = cur.fetchone()
                if not row:
                    continue
                for candidate in row:
                    source = _office_viewer_source(candidate or "")
                    if source.startswith("http://") or source.startswith("https://"):
                        return source
        except (DatabaseError, KeyError):
            continue
    return ""


def _load_legacy_attachment_bytes(attachment_id):
    url = _legacy_attachment_source(attachment_id)
    if not url:
        return None, HttpResponse("Legacy attachment source not found.", status=404)

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/pdf,application/octet-stream,*/*",
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        upstream = urllib.request.urlopen(req, timeout=45)
    except urllib.error.HTTPError as exc:
        return None, HttpResponse(exc.reason or "Could not load legacy attachment.", status=exc.code)
    except urllib.error.URLError:
        return None, HttpResponse("Could not load legacy attachment.", status=502)

    content_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    if "text/html" in content_type.lower():
        return None, HttpResponse("Legacy attachment returned an HTML page, not a file.", status=502)
    return upstream.read(), None


@require_GET
def google_drive_media(request, file_id):
    if not GOOGLE_DRIVE_ID_RE.match(file_id or ""):
        return HttpResponse("Invalid file id.", status=400)

    range_header = request.headers.get("Range")

    try:
        upstream = _open_google_drive_file(file_id, range_header)
        if upstream is None:
            return HttpResponse("Google Drive returned a page instead of a media file.", status=502)
    except urllib.error.HTTPError as exc:
        return HttpResponse(exc.reason or "Could not load media.", status=exc.code)
    except urllib.error.URLError:
        return HttpResponse("Could not load media.", status=502)

    response = StreamingHttpResponse(
        _stream_response(upstream),
        status=getattr(upstream, "status", 200),
        content_type=upstream.headers.get("Content-Type") or "application/octet-stream",
    )
    for header in ("Content-Length", "Content-Range", "Accept-Ranges"):
        value = upstream.headers.get(header)
        if value:
            response[header] = value
    response["Cache-Control"] = "private, max-age=300"
    return response


@require_GET
def legacy_attachment_media(request, attachment_id):
    if not LEGACY_ATTACHMENT_ID_RE.match(attachment_id or ""):
        return HttpResponse("Invalid attachment id.", status=400)

    url = _legacy_attachment_source(attachment_id)
    if not url:
        return HttpResponse("Legacy attachment source not found.", status=404)

    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/pdf,application/octet-stream,*/*",
    }
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header

    req = urllib.request.Request(url, headers=headers)
    try:
        upstream = urllib.request.urlopen(req, timeout=45)
    except urllib.error.HTTPError as exc:
        return HttpResponse(exc.reason or "Could not load legacy attachment.", status=exc.code)
    except urllib.error.URLError:
        return HttpResponse("Could not load legacy attachment.", status=502)

    content_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    if "text/html" in content_type.lower():
        return HttpResponse("Legacy attachment returned an HTML page, not a file.", status=502)

    response = StreamingHttpResponse(
        _stream_response(upstream),
        status=getattr(upstream, "status", 200),
        content_type=content_type,
    )
    for header in ("Content-Length", "Content-Range", "Accept-Ranges", "Content-Disposition"):
        value = upstream.headers.get(header)
        if value:
            response[header] = value
    response["Cache-Control"] = "private, max-age=300"
    response["X-Content-Type-Options"] = "nosniff"
    return response


@require_GET
def legacy_attachment_pdf_info(request, attachment_id):
    if not LEGACY_ATTACHMENT_ID_RE.match(attachment_id or ""):
        return HttpResponse("Invalid attachment id.", status=400)

    data, error = _load_legacy_attachment_bytes(attachment_id)
    if error:
        return error

    try:
        import fitz

        document = fitz.open(stream=data, filetype="pdf")
        try:
            return JsonResponse({"pages": document.page_count})
        finally:
            document.close()
    except Exception as exc:
        return HttpResponse(f"Could not inspect PDF: {exc}", status=502)


@require_GET
def legacy_attachment_pdf_page(request, attachment_id, page_number):
    if not LEGACY_ATTACHMENT_ID_RE.match(attachment_id or ""):
        return HttpResponse("Invalid attachment id.", status=400)

    try:
        page_index = max(0, int(page_number) - 1)
    except (TypeError, ValueError):
        return HttpResponse("Invalid page number.", status=400)

    data, error = _load_legacy_attachment_bytes(attachment_id)
    if error:
        return error

    try:
        import fitz

        document = fitz.open(stream=data, filetype="pdf")
        try:
            if page_index >= document.page_count:
                return HttpResponse("Page not found.", status=404)
            page = document.load_page(page_index)
            zoom = 1.7
            pixmap = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            response = HttpResponse(pixmap.tobytes("png"), content_type="image/png")
            response["Cache-Control"] = "private, max-age=300"
            response["X-Page-Count"] = str(document.page_count)
            response["X-Content-Type-Options"] = "nosniff"
            return response
        finally:
            document.close()
    except Exception as exc:
        return HttpResponse(f"Could not render PDF page: {exc}", status=502)
