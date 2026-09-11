"""Stream an authorised legacy PDF without sending it to Office Online."""
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from django.conf import settings
from django.http import HttpResponse, StreamingHttpResponse

from .media_proxy import _async_stream_response
from .subject_content import _SameHostRedirect, ContentUnavailable


def stream_pdf(request, url):
    target = urlsplit(url)
    origin = urlsplit(getattr(settings, 'KBC_LMS_SCHEMA_URL', ''))
    if target.scheme != 'https' or (target.scheme, target.netloc) != (origin.scheme, origin.netloc):
        return HttpResponse('File source is unavailable.', status=404)
    headers = {'User-Agent': 'KBC-LearningOS/1.0', 'Accept': 'application/pdf'}
    if request.headers.get('Range'):
        headers['Range'] = request.headers['Range']
    try:
        upstream = urllib.request.build_opener(_SameHostRedirect()).open(
            urllib.request.Request(url, headers=headers), timeout=20)
    except urllib.error.HTTPError as error:
        error.close()
        return HttpResponse('Could not load this file.', status=404 if error.code == 404 else 502)
    except (OSError, ContentUnavailable):
        return HttpResponse('Could not load this file. Please try again.', status=502)
    if upstream.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/pdf':
        upstream.close()
        return HttpResponse('The file source did not return a PDF.', status=502)
    response = StreamingHttpResponse(_async_stream_response(upstream),
        status=getattr(upstream, 'status', 200), content_type='application/pdf')
    for header in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if upstream.headers.get(header):
            response[header] = upstream.headers[header]
    response['Content-Disposition'] = 'inline; filename="document.pdf"'
    response['Cache-Control'] = 'private, max-age=300'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
