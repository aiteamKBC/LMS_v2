"""Asset identity, source selection and embed URL classification; no network requests."""


def clean(
    value, fallback='',
):
    text = str(value if value is not None else '').strip()
    return text or fallback


def normalise(
    value, *, clean,
):
    return clean(value).lower().replace('_', '-').strip()


def read_json_value(
    value, fallback, *, json,
):
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            loaded = json.loads(value)
        except ValueError:
            return fallback
        return loaded
    return fallback


def parse_int(
    value, default=None,
):
    if value in (None, ''):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def parse_float(
    value, default=None,
):
    if value in (None, ''):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def first_value(
    mapping, *keys, fallback='',
):
    if not isinstance(mapping, dict):
        return fallback
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ''):
            return value
    return fallback


def first_clean(
    mapping, *keys, fallback='', clean, first_value,
):
    return clean(first_value(mapping, *keys, fallback=fallback), fallback)


def iframe_src(
    value, *, clean, re,
):
    text = clean(value)
    if '<' not in text:
        return ''
    match = re.search(r'\bsrc\s*=\s*["\']([^"\']+)["\']', text, re.I)
    if not match:
        return ''
    return match.group(1).replace('&amp;', '&').strip()


def is_http_url(
    value, *, clean, urlparse,
):
    parsed = urlparse(clean(value))
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def youtube_embed_url(
    url, *, clean, parse_qs, urlparse,
):
    parsed = urlparse(clean(url))
    host = (parsed.hostname or '').lower()
    video_id = ''
    if host.endswith('youtu.be'):
        video_id = parsed.path.strip('/').split('/')[0]
    elif host.endswith('youtube.com') or host.endswith('youtube-nocookie.com'):
        if parsed.path.startswith('/embed/'):
            return clean(url)
        video_id = parse_qs(parsed.query).get('v', [''])[0]
        if not video_id and parsed.path.startswith('/shorts/'):
            video_id = parsed.path.split('/shorts/', 1)[1].split('/')[0]
    return f'https://www.youtube.com/embed/{video_id}' if video_id else ''


def vimeo_embed_url(
    url, *, clean, re, urlparse,
):
    parsed = urlparse(clean(url))
    host = (parsed.hostname or '').lower()
    if not host.endswith('vimeo.com'):
        return ''
    if parsed.path.startswith('/video/'):
        return clean(url)
    match = re.search(r'/(\d+)', parsed.path)
    return f'https://player.vimeo.com/video/{match.group(1)}' if match else ''


def google_embed_url(
    url, *, clean, re,
):
    text = clean(url)
    slides = re.search(r'docs\.google\.com/presentation/d/([^/?#]+)', text)
    if slides:
        return f'https://docs.google.com/presentation/d/{slides.group(1)}/embed'
    docs = re.search(r'docs\.google\.com/document/d/([^/?#]+)', text)
    if docs:
        return f'https://docs.google.com/document/d/{docs.group(1)}/preview'
    return ''


def file_extension(
    url, *, clean, urlparse,
):
    path = urlparse(clean(url)).path
    if '.' not in path:
        return ''
    return path.rsplit('.', 1)[1].lower()


def render_target(
    source_url='', embed_code='', content_kind='', *, UPLOAD_URL_PREFIX, clean, file_extension,
    google_embed_url, iframe_src, is_http_url, urlencode, vimeo_embed_url, youtube_embed_url,
):
    embedded = iframe_src(embed_code)
    if embedded:
        return embedded, 'iframe'

    source_url = clean(source_url)
    if not source_url:
        return '', 'lms_native'

    google = google_embed_url(source_url)
    if google:
        return google, 'iframe'
    youtube = youtube_embed_url(source_url)
    if youtube:
        return youtube, 'iframe'
    vimeo = vimeo_embed_url(source_url)
    if vimeo:
        return vimeo, 'iframe'

    extension = file_extension(source_url)
    if source_url.startswith(UPLOAD_URL_PREFIX):
        return source_url, 'same_origin'
    if extension == 'pdf':
        return source_url, 'iframe'
    if extension in {'doc', 'docx', 'ppt', 'pptx', 'pps', 'ppsx', 'xls', 'xlsx'} and is_http_url(source_url):
        return f'https://view.officeapps.live.com/op/embed.aspx?src={urlencode({"": source_url})[1:]}', 'office'
    if content_kind in {'audio', 'video'}:
        return source_url, 'media'
    if is_http_url(source_url):
        return source_url, 'link'
    return source_url, 'link'


def content_kind_for_component(
    component_type, *, normalise,
):
    component_type = normalise(component_type)
    if component_type == 'podcast':
        return 'audio'
    if component_type == 'powerpoint':
        return 'presentation'
    if component_type == 'recording-placeholder':
        return 'recording'
    if component_type == 'live-session':
        return 'live_session'
    return component_type or 'activity'


def component_settings(
    component, *, first_value, read_json_value,
):
    settings = first_value(component, 'settings', 'settings_json', fallback={})
    settings = read_json_value(settings, {})
    return settings if isinstance(settings, dict) else {}


def normalised_component_type(
    component, *, clean, component_settings, first_clean, normalise,
):
    raw_type = first_clean(component, 'componentType', 'component_type', 'type', 'activityType', fallback='activity')
    component_type = normalise(raw_type)
    if component_type not in {'self-study', 'self study', 'activity'}:
        return component_type
    settings = component_settings(component)
    if any(clean(settings.get(key)) for key in ('videoUrl', 'videoURL')) or clean(settings.get('sourceType')):
        return 'video'
    if any(clean(settings.get(key)) for key in ('podcastUrl', 'podcastEmbedCode')) or clean(settings.get('podcastSource')):
        return 'podcast'
    if any(clean(settings.get(key)) for key in ('presentationUrl', 'fileName', 'slideRange')):
        return 'powerpoint'
    if any(clean(settings.get(key)) for key in ('readingContent', 'resourceUrl', 'readingSource', 'estimatedReadingTime')):
        return 'reading'
    if any(clean(settings.get(key)) for key in ('minimumWordCount', 'learnerGuidance', 'tutorReviewGuidance')):
        return 'reflection'
    return component_type


def primary_source_for_component(
    component, settings, component_type, *, first_clean,
):
    if component_type == 'video':
        return first_clean(settings, 'videoUrl', 'uploadedFileUrl', 'resourceUrl'), first_clean(settings, 'embedCode')
    if component_type == 'podcast':
        return first_clean(settings, 'podcastUrl', 'uploadedFileUrl'), first_clean(settings, 'embedCode', 'podcastEmbedCode')
    if component_type == 'reading':
        return first_clean(settings, 'resourceUrl', 'uploadedFileUrl'), ''
    if component_type == 'powerpoint':
        return first_clean(settings, 'presentationUrl', 'uploadedFileUrl'), ''
    if component_type == 'assignment':
        return first_clean(settings, 'assignmentFileUrl', 'uploadedFileUrl'), ''
    if component_type == 'live-session':
        return first_clean(settings, 'liveSessionUrl', 'teamsMeetingUrl'), ''
    if component_type == 'recording-placeholder':
        return first_clean(settings, 'recordingUrl'), ''
    return first_clean(settings, 'resourceUrl', 'uploadedFileUrl', 'url', 'link'), first_clean(settings, 'embedCode')


def stable_asset_id(
    asset, *, clean, hashlib,
):
    source = '|'.join([
        clean(asset.get('programme_id')),
        clean(asset.get('component_id')),
        clean(asset.get('content_kind')),
        clean(asset.get('source_url') or asset.get('embed_url') or asset.get('title')),
    ])
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def is_component_like(
    value, *, clean,
):
    if not isinstance(value, dict):
        return False
    has_title = any(clean(value.get(key)) for key in ('title', 'name', 'componentTitle'))
    has_type = any(clean(value.get(key)) for key in ('type', 'componentType', 'component_type', 'activityType'))
    has_component_id = any(clean(value.get(key)) for key in ('componentId', 'component_id'))
    return has_type and (has_title or has_component_id)


def context_with(
    context, key, value,
):
    updated = dict(context)
    if isinstance(value, dict):
        updated[key] = value
    return updated
