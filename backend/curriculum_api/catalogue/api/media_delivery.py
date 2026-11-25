"""Upload delivery, byte ranges, signed previews and presentation HTTP responses."""



def uploads_relative_path(src, *, COMPONENT_UPLOAD_ROOT, clean_str, pptx_slides, urllib_parse, urlparse):
    """Storage-relative path for a `/curriculum_api/curriculum/uploads/...` reference.

    Accepts what the authoring settings actually store — a site-relative path —
    as well as an absolute URL pointing at the same route, and returns None for
    anything that is not an upload of ours. Rendered slide assets are excluded:
    they are output, never a render input.
    """
    text = clean_str(src)
    if not text:
        return None
    path = urlparse(text).path
    marker = '/curriculum_api/curriculum/uploads/'
    if marker not in path:
        return None
    tail = urllib_parse.unquote(path.split(marker, 1)[1]).strip('/')
    if not tail or tail.startswith(f'{pptx_slides.RENDER_DIR_NAME}/'):
        return None
    if '..' in tail.split('/'):
        return None
    return f'{COMPONENT_UPLOAD_ROOT}/{tail}'


def parse_byte_range(header, total_size):
    """``(offset, length)`` for a single-range request, None, or 'unsatisfiable'.

    Only the one form clients actually send for media is honoured — a single
    ``bytes=`` range. Anything multipart or malformed is ignored, which is
    allowed: the whole file is then served as a plain 200.
    """
    text = str(header or '').strip().lower()
    if not text.startswith('bytes=') or ',' in text:
        return None
    spec = text[len('bytes='):].strip()
    if '-' not in spec:
        return None
    start_text, end_text = spec.split('-', 1)
    try:
        if not start_text:  # "bytes=-500": the last 500 bytes
            suffix = int(end_text)
            if suffix <= 0:
                return 'unsatisfiable'
            start = max(total_size - suffix, 0)
            end = total_size - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else total_size - 1
    except ValueError:
        return None
    if start >= total_size or start < 0 or end < start:
        return 'unsatisfiable'
    end = min(end, total_size - 1)
    return start, end - start + 1


def curriculum_presentation_slides(
    request, *, JsonResponse, Path, clean_str, json_error, pptx_slides, re, tempfile, uploads_relative_path,
    urlparse, load_legacy_attachment_bytes, read_uploaded_presentation
):
    """The slide model for an uploaded PowerPoint deck, for inline display.

    Microsoft's Office Online viewer can only preview a file it can download
    from the public internet, so uploads on a private or local deployment had no
    preview at all. This renders the deck in-house instead — see
    curriculum_api.pptx_slides for what the model does and does not carry.
    """
    source = clean_str(request.GET.get('src'))
    relative_path = uploads_relative_path(source)
    legacy_match = re.search(r'/learner_api/media/legacy-attachment/([0-9]{1,20})/', urlparse(source).path)
    if not relative_path and legacy_match:
        attachment_id = legacy_match.group(1)
        cache_key = f'legacy-attachment/{attachment_id}.pptx'
        stamp = f'legacy-attachment:{attachment_id}'
        cached = pptx_slides.deck_model_for_stamp(cache_key, stamp)
        if cached is not None:
            return JsonResponse(cached)

        # Imported LMS decks are served by the authenticated same-origin media
        # proxy, not by the normal component-upload store. Pull one temporary
        # copy for python-pptx, then keep only the rendered slide-model cache.

        data, error = load_legacy_attachment_bytes(attachment_id)
        if error:
            return json_error('The legacy slide deck could not be loaded.', status=error.status_code)
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix='.pptx', delete=False) as temporary:
                temporary.write(data)
                temporary_path = temporary.name
            deck = pptx_slides.render_uploaded_deck(cache_key, temporary_path, stamp=stamp)
        except pptx_slides.UnsupportedDeck as render_error:
            return json_error(str(render_error), status=415)
        finally:
            if temporary_path:
                Path(temporary_path).unlink(missing_ok=True)
        return JsonResponse(deck)

    if not relative_path:
        return json_error('A slide deck upload path is required.', status=400)
    # The deck may live in blob storage, and python-pptx needs a real file, so a
    # copy is pulled down for the render and removed afterwards. The cache is
    # keyed on the blob's own stamp, not the copy's mtime, or every request would
    # re-parse the deck.
    deck, error = read_uploaded_presentation(relative_path)
    if error is not None:
        return json_error(error, status=415)
    if deck is None:
        return json_error(
            'The slide deck file is not on the server any more. Re-upload it in the '
            'module builder, or open the original link below.', status=404,
        )
    return JsonResponse(deck)



def office_preview_link(relative_path, *, OFFICE_PREVIEW_SALT, Path, signing, urllib_parse):
    """A session-free link to one upload, for Office Online to fetch.

    Microsoft's servers download the file themselves and carry no LMS session,
    so the normal upload URL is refused at the API gate. The token names exactly
    one file and expires, which is the same promise an Azure SAS URL makes for a
    file that has a blob copy. The file name rides along because Office decides
    how to open a document from the URL's extension.
    """
    token = signing.dumps(relative_path, salt=OFFICE_PREVIEW_SALT, compress=True)
    return f'/curriculum_api/office-preview/{token}/{urllib_parse.quote(Path(relative_path).name)}'


def curriculum_upload_storage_error(error, *, json_error, logger, upload_storage):
    """A controlled upload-read response with no provider details."""
    logger.warning(
        'Curriculum upload storage read failed (%s)',
        type(error).__name__,
    )
    if isinstance(error, upload_storage.UploadStorageAccessDenied):
        return json_error(
            'The file store refused access to this file. Please contact support.',
            status=403,
        )
    return json_error(
        'The file store is temporarily unavailable. Please try again later.',
        status=503,
    )


def curriculum_office_preview_file(
    request, token, filename, *, COMPONENT_UPLOAD_ROOT, FileResponse, Http404, OFFICE_PREVIEW_MAX_AGE_SECONDS,
    OFFICE_PREVIEW_SALT, Path, curriculum_upload_storage_error, mimetypes, signing, upload_storage
):
    """Serve the upload an ``office_preview_link`` token names, without a session."""
    try:
        relative_path = signing.loads(token, salt=OFFICE_PREVIEW_SALT, max_age=OFFICE_PREVIEW_MAX_AGE_SECONDS)
    except signing.BadSignature:
        raise Http404('File not found.')
    if (not isinstance(relative_path, str)
            or not relative_path.startswith(f'{COMPONENT_UPLOAD_ROOT}/')
            or '..' in relative_path.split('/')):
        raise Http404('File not found.')
    try:
        opened = upload_storage.open_stream(relative_path)
    except upload_storage.UploadStorageReadError as error:
        return curriculum_upload_storage_error(error)
    if opened is None:
        raise Http404('File not found.')
    stream, total_size, content_type = opened
    response = FileResponse(stream, as_attachment=False, filename=Path(relative_path).name)
    response['Content-Length'] = str(total_size)
    response['Content-Type'] = content_type or mimetypes.guess_type(relative_path)[0] or 'application/octet-stream'
    response['Cache-Control'] = 'private, no-store'
    response['X-Robots-Tag'] = 'noindex, nofollow'
    return response


def curriculum_uploaded_file(
    request, path, *, COMPONENT_UPLOAD_ROOT, FileResponse, Http404, HttpResponse, HttpResponseRedirect,
    MODULE_COVER_FILE_PATH, OFFICE_PREVIEW_EXTENSIONS, Path, clean_str, curriculum_upload_storage_error,
    escape, mimetypes, office_preview_link, parse_byte_range, re, upload_storage, urllib_parse
):
    """Serve a component upload from wherever its bytes are.

    Framed same-origin on purpose: the site-wide X-Frame-Options is DENY, which
    stops a browser rendering a PDF or a slide deck in the learner page's own
    iframe — the viewer comes out blank. SAMEORIGIN lets our own pages embed the
    file while still refusing to be framed by anyone else.

    The URL shape is unchanged, so every settings_json reference already stored
    keeps working: upload_storage checks local disk first (files uploaded before
    the move to Azure, and the slide render cache) and falls back to the
    container. Streaming it through here rather than redirecting to a signed URL
    keeps the file same-origin, which is what the PDF and slide viewers embed.
    """
    if '..' in str(path).split('/'):
        raise Http404('File not found.')
    relative_path = f'{COMPONENT_UPLOAD_ROOT}/{path}'

    # Browsers cannot render Office documents directly.  The normal URL still
    # streams/downloads the original file, while ``?preview=1`` returns a tiny
    # same-origin page containing the Office Online viewer.  Azure stays
    # private: Microsoft receives only a short-lived, read-only SAS URL and the
    # database continues to store the stable LMS path without any token.
    preview_requested = clean_str(request.GET.get('preview')).lower() in {'1', 'true', 'yes'}
    extension = Path(relative_path).suffix.lower()
    if preview_requested and extension in OFFICE_PREVIEW_EXTENSIONS:
        try:
            probe = upload_storage.open_stream(relative_path, offset=0, length=1)
        except upload_storage.UploadStorageReadError as error:
            return curriculum_upload_storage_error(error)
        if probe is None:
            raise Http404('File not found.')
        if not probe[1]:
            raise Http404('This file is empty on the server. Ask the curriculum team to upload it again.')
        try:
            source_url = upload_storage.signed_read_url(relative_path)
        except upload_storage.UploadStorageReadError as error:
            return curriculum_upload_storage_error(error)
        if not source_url:
            # No Azure copy to sign: the file is still on this server's disk.
            # Microsoft fetches without the learner's session, so it gets a
            # short-lived signed link to this one file. Handing it the normal
            # upload URL made Office show "File not found" for every such file.
            source_url = request.build_absolute_uri(office_preview_link(relative_path))
        viewer_url = (
            'https://view.officeapps.live.com/op/embed.aspx?src='
            f'{urllib_parse.quote(source_url, safe="")}'
        )
        filename = Path(relative_path).name
        response = HttpResponse(
            f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(filename)}</title>
  <style>html, body, iframe {{ width: 100%; height: 100%; margin: 0; border: 0; }}</style>
</head>
<body><iframe src="{escape(viewer_url, quote=True)}" title="{escape(filename, quote=True)}"></iframe></body>
</html>''',
            content_type='text/html; charset=utf-8',
        )
        response['Content-Security-Policy'] = (
            "default-src 'none'; frame-src https://view.officeapps.live.com; "
            "style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
        )
        response['Cache-Control'] = 'private, no-store'
        return response

    try:
        probe = upload_storage.open_stream(relative_path, offset=0, length=1)
    except upload_storage.UploadStorageReadError as error:
        return curriculum_upload_storage_error(error)
    if probe is None:
        raise Http404('File not found.')
    _discard, total_size, content_type = probe
    if not total_size:
        # Some imported legacy files are zero-byte placeholders. The importer
        # kept the original source, which the legacy attachment proxy can still
        # fetch; anything else is genuinely missing and must say so rather than
        # hand the viewer an empty "document".
        legacy = re.match(r'_legacy_files/([0-9]{1,20})/', path)
        if legacy:
            return HttpResponseRedirect(f'/learner_api/media/legacy-attachment/{legacy.group(1)}/')
        raise Http404('This file is empty on the server. Ask the curriculum team to upload it again.')

    # An <audio> element seeking a podcast, and a PDF viewer jumping to a page,
    # both do it with a byte range; without this they can only play or render
    # from the start.
    requested = parse_byte_range(request.META.get('HTTP_RANGE'), total_size)
    if requested == 'unsatisfiable':
        response = HttpResponse(status=416)
        response['Content-Range'] = f'bytes */{total_size}'
        return response

    offset, length = requested if requested else (0, total_size)
    try:
        opened = upload_storage.open_stream(relative_path, offset=offset, length=length)
    except upload_storage.UploadStorageReadError as error:
        return curriculum_upload_storage_error(error)
    if opened is None:
        raise Http404('File not found.')
    stream, _total, _content_type = opened
    response = FileResponse(
        stream, as_attachment=False, filename=Path(relative_path).name,
        status=206 if requested else 200,
    )
    response['Accept-Ranges'] = 'bytes'
    response['Content-Length'] = str(length)
    # Always state the type. FileResponse cannot infer one from a generator (it
    # has no file name to look at) and falls back to text/html, which — with the
    # nosniff header this site sends — is enough for a browser to refuse to
    # render a rendered page image or play an audio file.
    response['Content-Type'] = (
        content_type
        or mimetypes.guess_type(relative_path)[0]
        or 'application/octet-stream'
    )
    if response['Content-Type'].lower().startswith('video/'):
        from config.video_streaming import video_chunks
        response.streaming_content = video_chunks(request, stream)
    if requested:
        response['Content-Range'] = f'bytes {offset}-{offset + length - 1}/{total_size}'
    if MODULE_COVER_FILE_PATH.search(path):
        # A cover's file name carries the moment it was uploaded and a new
        # upload gets a new name (stored_module_cover_image), so these bytes
        # never change. Without this every catalogue visit fetched every cover
        # again through Django and Azure, and the cards sat empty meanwhile.
        response['Cache-Control'] = 'private, max-age=31536000, immutable'
    return response
