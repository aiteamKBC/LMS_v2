from __future__ import annotations

import hashlib
import json
import logging
import re
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlencode, urlparse

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from . import views as curriculum_views

logger = logging.getLogger(__name__)

PROGRAMME_AUDIT_SCHEMA = 'programme_audit'
PROGRAMME_AUDIT_TABLE = 'assets'
UPLOAD_URL_PREFIX = '/curriculum_api/curriculum/uploads/'

JSON_COLUMNS = {'ksb_mappings', 'settings', 'raw_component', 'raw_payload'}

UI_MATERIAL_TABLES = {
    'impact-planning': {'table': 'impact_planning', 'name': 'Impact Planning', 'programme': 'ME'},
    'social-media': {'table': 'social_media', 'name': 'Social Media', 'programme': 'ME'},
    'marketing-technology': {'table': 'marketing_technology', 'name': 'Marketing Technology', 'programme': 'ME'},
    'strategy-planning': {'table': 'strategy_planning', 'name': 'Strategy Planning', 'programme': 'MM'},
    'customer-journey': {'table': 'customer_journey', 'name': 'Customer Journey', 'programme': 'MM'},
    'commercial-intelligence': {'table': 'commercial_intelligence', 'name': 'Commercial Intelligence', 'programme': 'MM'},
    'ai-in-marketing': {'table': 'ai_in_marketing', 'name': 'AI in Marketing', 'programme': 'MM'},
    'project-management-professional': {'table': 'project_management_professional', 'name': 'Project Management Professional', 'programme': 'PCP'},
    'msp-scheduling-professional': {'table': 'managing_successful_programmes_scheduling_professional', 'name': 'Managing Successful Programmes / Scheduling Professional', 'programme': 'PCP'},
    'risk-management': {'table': 'risk_management', 'name': 'Risk Management', 'programme': 'PCP'},
    'evm-portfolio-management': {'table': 'earned_value_management_portfolio_management', 'name': 'Earned Value Management / Portfolio Management', 'programme': 'PCP'},
    'ppc-pmo': {'table': 'project_planning_control_project_management_office', 'name': 'Project Planning Control / Project Management Office', 'programme': 'PCP'},
}

DEMO_PROGRAMME_BY_EMAIL = {
    'learner-me@learner.local': 'ME',
    'learner-mm@learner.local': 'MM',
    'learner-pcp@learner.local': 'PCP',
}


class ProgrammeAuditNotFound(ValueError):
    pass

ASSET_COLUMNS = (
    'id',
    'programme_id',
    'programme_source_id',
    'programme_name',
    'module_catalogue_id',
    'module_title',
    'week_id',
    'week_number',
    'week_title',
    'component_id',
    'component_type',
    'content_kind',
    'title',
    'description',
    'source_url',
    'embed_url',
    'embed_code',
    'render_mode',
    'file_name',
    'content_type',
    'file_size',
    'duration_minutes',
    'expected_otjh',
    'points',
    'status',
    'ksb_mappings',
    'settings',
    'raw_component',
    'raw_payload',
    'imported_from',
    'source_key',
    'imported_at',
    'updated_at',
)


def clean(value, fallback=''):
    text = str(value if value is not None else '').strip()
    return text or fallback


def normalise(value):
    return clean(value).lower().replace('_', '-').strip()


def scope_assets_to_ui_material(material, source_assets):
    """Label authored-module assets with their learner-facing material name."""
    assets = []
    for source_asset in source_assets:
        asset = dict(source_asset)
        settings = dict(read_json_value(asset.get('settings'), {}))
        settings.setdefault('sourceModuleTitle', clean(asset.get('module_title')))
        asset['programme_source_id'] = clean(
            source_asset.get('programme_source_id'),
            clean(source_asset.get('programme_id')),
        )
        asset['programme_id'] = clean(material.get('programme_id'))
        asset['programme_name'] = clean(material.get('programme_name'))
        asset['module_title'] = clean(material.get('name'))
        asset['settings'] = settings
        asset['raw_payload'] = {
            'uiMaterialKey': clean(material.get('key')),
            'uiMaterialName': clean(material.get('name')),
            'sourceModuleId': clean(asset.get('module_catalogue_id')),
            'sourceModuleTitle': settings.get('sourceModuleTitle', ''),
        }
        assets.append(asset)
    return assets


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def asset_table_name():
    if connection.vendor == 'postgresql':
        return f'{quote_ident(PROGRAMME_AUDIT_SCHEMA)}.{quote_ident(PROGRAMME_AUDIT_TABLE)}'
    return quote_ident('programme_audit_assets')


def json_db_value(value):
    return json.dumps(value, cls=DjangoJSONEncoder, ensure_ascii=False)


def read_json_value(value, fallback):
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


def rows_as_dicts(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def ui_material_table_exists(table):
    if connection.vendor != 'postgresql':
        return False
    with connection.cursor() as cursor:
        cursor.execute(
            'SELECT 1 FROM information_schema.tables '
            'WHERE table_schema = %s AND table_name = %s LIMIT 1',
            [PROGRAMME_AUDIT_SCHEMA, table],
        )
        return cursor.fetchone() is not None


def fetch_ui_material(key, include_results=False):
    definition = UI_MATERIAL_TABLES.get(clean(key))
    if not definition:
        raise ProgrammeAuditNotFound('Material not found.')
    table_ident = definition['table']
    if not ui_material_table_exists(table_ident):
        return {**definition, 'key': key, 'ready': False, 'count': 0, 'expectedMinutes': 0, 'firstWeekTitle': '', 'results': []}

    table = f'{quote_ident(PROGRAMME_AUDIT_SCHEMA)}.{quote_ident(table_ident)}'
    with connection.cursor() as cursor:
        cursor.execute(
            f'''SELECT count(*),
                       coalesce(sum(
                           CASE WHEN expected_otjh IS NOT NULL AND expected_otjh > 0
                                THEN expected_otjh * 60
                                ELSE coalesce(duration_minutes, 0) END
                       ), 0)
                FROM {table}'''
        )
        count, expected_minutes = cursor.fetchone()
        cursor.execute(
            f'''SELECT week_title FROM {table}
                WHERE coalesce(week_title, '') <> ''
                ORDER BY week_number NULLS LAST, week_title, title LIMIT 1'''
        )
        first_week = cursor.fetchone()
        results = []
        if include_results:
            columns = (
                'id', 'module_catalogue_id', 'module_title', 'week_id', 'week_number',
                'week_title', 'component_id', 'component_type', 'content_kind',
                'title', 'description', 'source_url', 'embed_url', 'render_mode',
                'duration_minutes', 'expected_otjh', 'points', 'status',
            )
            cursor.execute(
                f'''SELECT {", ".join(quote_ident(column) for column in columns)}
                    FROM {table}
                    ORDER BY week_number NULLS LAST, week_title, title, id'''
            )
            results = rows_as_dicts(cursor)
            for row in results:
                if row.get('expected_otjh') is not None:
                    row['expected_otjh'] = float(row['expected_otjh'])
    return {
        **definition,
        'key': key,
        'ready': True,
        'count': int(count),
        'expectedMinutes': int(round(float(expected_minutes or 0))),
        'firstWeekTitle': first_week[0] if first_week else '',
        'results': results,
    }


def table_exists():
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select 1 from information_schema.tables where table_schema = %s and table_name = %s limit 1',
                    [PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE],
                )
            else:
                cursor.execute(
                    "select 1 from sqlite_master where type='table' and name = %s limit 1",
                    ['programme_audit_assets'],
                )
            return cursor.fetchone() is not None
    except Exception:
        logger.debug('Could not verify programme audit table.', exc_info=True)
        return False


def provision_programme_audit_table():
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    default_json_object = "'{}'::jsonb" if connection.vendor == 'postgresql' else "'{}'"
    default_json_array = "'[]'::jsonb" if connection.vendor == 'postgresql' else "'[]'"
    table = asset_table_name()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(PROGRAMME_AUDIT_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {table} (
                id varchar(64) primary key,
                programme_id varchar(255) not null,
                programme_source_id varchar(255) not null default '',
                programme_name varchar(500) not null default '',
                module_catalogue_id varchar(128) not null default '',
                module_title varchar(500) not null default '',
                week_id varchar(128) not null default '',
                week_number integer,
                week_title varchar(500) not null default '',
                component_id varchar(128) not null default '',
                component_type varchar(64) not null default '',
                content_kind varchar(64) not null default '',
                title varchar(500) not null default '',
                description text not null default '',
                source_url text not null default '',
                embed_url text not null default '',
                embed_code text not null default '',
                render_mode varchar(64) not null default '',
                file_name varchar(500) not null default '',
                content_type varchar(255) not null default '',
                file_size bigint,
                duration_minutes integer,
                expected_otjh numeric(8, 2),
                points integer,
                status varchar(64) not null default '',
                ksb_mappings {json_type} not null default {default_json_array},
                settings {json_type} not null default {default_json_object},
                raw_component {json_type} not null default {default_json_object},
                raw_payload {json_type} not null default {default_json_object},
                imported_from varchar(255) not null default '',
                source_key varchar(512) not null default '',
                imported_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'create index if not exists programme_audit_assets_programme_idx on {table} (programme_id)')
        cursor.execute(f'create index if not exists programme_audit_assets_component_idx on {table} (component_id)')
        cursor.execute(f'create index if not exists programme_audit_assets_kind_idx on {table} (content_kind)')
        cursor.execute(f'create index if not exists programme_audit_assets_module_idx on {table} (module_catalogue_id)')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                create unique index if not exists programme_audit_assets_source_key_idx
                on {table} (source_key)
                where source_key <> ''
            ''')


def require_programme_audit_table():
    if not table_exists():
        raise RuntimeError(
            'Programme audit table is not provisioned. Run: python manage.py migrate curriculum_api, '
            'or python manage.py sync_programme_audit --provision --commit --programme <id>'
        )


def parse_int(value, default=None):
    if value in (None, ''):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def parse_float(value, default=None):
    if value in (None, ''):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def first_value(mapping, *keys, fallback=''):
    if not isinstance(mapping, dict):
        return fallback
    for key in keys:
        value = mapping.get(key)
        if value not in (None, ''):
            return value
    return fallback


def first_clean(mapping, *keys, fallback=''):
    return clean(first_value(mapping, *keys, fallback=fallback), fallback)


def iframe_src(value):
    text = clean(value)
    if '<' not in text:
        return ''
    match = re.search(r'\bsrc\s*=\s*["\']([^"\']+)["\']', text, re.I)
    if not match:
        return ''
    return match.group(1).replace('&amp;', '&').strip()


def is_http_url(value):
    parsed = urlparse(clean(value))
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def youtube_embed_url(url):
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


def vimeo_embed_url(url):
    parsed = urlparse(clean(url))
    host = (parsed.hostname or '').lower()
    if not host.endswith('vimeo.com'):
        return ''
    if parsed.path.startswith('/video/'):
        return clean(url)
    match = re.search(r'/(\d+)', parsed.path)
    return f'https://player.vimeo.com/video/{match.group(1)}' if match else ''


def google_embed_url(url):
    text = clean(url)
    slides = re.search(r'docs\.google\.com/presentation/d/([^/?#]+)', text)
    if slides:
        return f'https://docs.google.com/presentation/d/{slides.group(1)}/embed'
    docs = re.search(r'docs\.google\.com/document/d/([^/?#]+)', text)
    if docs:
        return f'https://docs.google.com/document/d/{docs.group(1)}/preview'
    return ''


def file_extension(url):
    path = urlparse(clean(url)).path
    if '.' not in path:
        return ''
    return path.rsplit('.', 1)[1].lower()


def render_target(source_url='', embed_code='', content_kind=''):
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


def content_kind_for_component(component_type):
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


def component_settings(component):
    settings = first_value(component, 'settings', 'settings_json', fallback={})
    settings = read_json_value(settings, {})
    return settings if isinstance(settings, dict) else {}


def normalised_component_type(component):
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


def base_asset(component, context, raw_payload, imported_from):
    settings = component_settings(component)
    programme = context.get('programme') if isinstance(context.get('programme'), dict) else {}
    module = context.get('module') if isinstance(context.get('module'), dict) else {}
    week = context.get('week') if isinstance(context.get('week'), dict) else {}
    component_type = normalised_component_type(component)
    programme_id = clean(
        first_value(programme, 'id', 'sourceId', 'source_id', 'programmeId', 'programme_id')
        or context.get('programme_id')
        or first_value(component, 'programmeId', 'programme_id')
        or first_value(module, 'programmeId', 'programme_id')
        or first_value(component, 'programme', 'programmeName', 'programme_name')
        or first_value(module, 'programme', 'programmeName', 'programme_name'),
        'unassigned-programme',
    )
    programme_name = clean(
        first_value(programme, 'name', 'programme', 'programmeName', 'programme_name')
        or context.get('programme_name')
        or first_value(component, 'programme', 'programmeName', 'programme_name')
        or first_value(module, 'programme', 'programmeName', 'programme_name'),
        programme_id,
    )
    return {
        'programme_id': programme_id,
        'programme_source_id': clean(first_value(programme, 'sourceId', 'source_id'), programme_id),
        'programme_name': programme_name,
        'module_catalogue_id': clean(
            first_value(component, 'moduleCatalogueId', 'module_catalogue_id', 'moduleId', 'module_id')
            or first_value(module, 'moduleCatalogueId', 'module_catalogue_id', 'catalogueId', 'id')
            or context.get('module_catalogue_id')
        ),
        'module_title': clean(
            first_value(component, 'module', 'moduleTitle', 'module_title')
            or first_value(module, 'name', 'title', 'moduleTitle', 'module_title')
            or context.get('module_title')
        ),
        'week_id': clean(first_value(component, 'weekId', 'week_id') or first_value(week, 'id', 'weekId', 'week_id') or context.get('week_id')),
        'week_number': parse_int(first_value(component, 'weekNumber', 'week_number') or first_value(week, 'weekNumber', 'week_number')),
        'week_title': clean(
            first_value(component, 'weekTitle', 'week_title', 'week')
            or first_value(week, 'title', 'weekTitle', 'week_title', 'week')
            or context.get('week_title')
        ),
        'component_id': clean(first_value(component, 'id', 'componentId', 'component_id')),
        'component_type': component_type,
        'title': first_clean(component, 'title', 'name', 'componentTitle', fallback=content_kind_for_component(component_type).replace('_', ' ').title()),
        'description': first_clean(component, 'description', 'summary', 'shortDescription'),
        'file_name': first_clean(settings, 'uploadedFileName', 'fileName', 'assignmentFileName'),
        'content_type': first_clean(settings, 'uploadedFileContentType', 'contentType', 'mimeType'),
        'file_size': parse_int(first_value(settings, 'uploadedFileSize', 'fileSize', 'size')),
        'duration_minutes': parse_int(first_value(settings, 'durationMinutes', 'estimatedReadingTime')),
        'expected_otjh': parse_float(first_value(component, 'expectedOtjh', 'expected_otjh')),
        'points': parse_int(first_value(component, 'points')),
        'status': first_clean(settings, 'contentStatus', 'componentBuilderStatus') or first_clean(component, 'status'),
        'ksb_mappings': read_json_value(first_value(component, 'ksbMappings', 'ksb_mappings', fallback=[]), []),
        'settings': settings,
        'raw_component': component,
        'raw_payload': raw_payload if isinstance(raw_payload, dict) else {'payload': raw_payload},
        'imported_from': imported_from,
    }


def primary_source_for_component(component, settings, component_type):
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


def component_assets(component, context, raw_payload, imported_from='curriculum'):
    settings = component_settings(component)
    component_type = normalised_component_type(component)
    kind = content_kind_for_component(component_type)
    source_url, embed_code = primary_source_for_component(component, settings, component_type)
    base = base_asset(component, context, raw_payload, imported_from)
    embed_url, render_mode = render_target(source_url, embed_code, kind)
    assets = [{
        **base,
        'content_kind': kind,
        'source_url': source_url,
        'embed_url': embed_url,
        'embed_code': embed_code,
        'render_mode': render_mode,
    }]
    audio_url = first_clean(settings, 'audioUrl')
    if component_type == 'reading' and audio_url:
        audio_embed_url, audio_render_mode = render_target(audio_url, '', 'audio')
        assets.append({
            **base,
            'content_kind': 'audio',
            'title': f'{base["title"]} audio',
            'source_url': audio_url,
            'embed_url': audio_embed_url,
            'embed_code': '',
            'render_mode': audio_render_mode,
        })
    return [stamp_asset(asset) for asset in assets]


def stable_asset_id(asset):
    source = '|'.join([
        clean(asset.get('programme_id')),
        clean(asset.get('component_id')),
        clean(asset.get('content_kind')),
        clean(asset.get('source_url') or asset.get('embed_url') or asset.get('title')),
    ])
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def stamp_asset(asset):
    source_key = stable_asset_id(asset)
    now = timezone.now()
    return {
        **asset,
        'id': source_key,
        'source_key': source_key,
        'imported_at': now,
        'updated_at': now,
    }


def is_component_like(value):
    if not isinstance(value, dict):
        return False
    has_title = any(clean(value.get(key)) for key in ('title', 'name', 'componentTitle'))
    has_type = any(clean(value.get(key)) for key in ('type', 'componentType', 'component_type', 'activityType'))
    has_component_id = any(clean(value.get(key)) for key in ('componentId', 'component_id'))
    return has_type and (has_title or has_component_id)


def context_with(context, key, value):
    updated = dict(context)
    if isinstance(value, dict):
        updated[key] = value
    return updated


def iter_components(payload, context=None):
    context = context or {}
    if isinstance(payload, list):
        for item in payload:
            yield from iter_components(item, context)
        return
    if not isinstance(payload, dict):
        return

    if isinstance(payload.get('programme'), dict):
        context = context_with(context, 'programme', payload['programme'])
    elif any(payload.get(key) for key in ('programmeId', 'programme_id', 'programmeName', 'programme_name')):
        context = {
            **context,
            'programme_id': first_clean(payload, 'programmeId', 'programme_id'),
            'programme_name': first_clean(payload, 'programmeName', 'programme_name', 'programme'),
        }

    if isinstance(payload.get('module'), dict):
        context = context_with(context, 'module', payload['module'])
    if isinstance(payload.get('week'), dict):
        context = context_with(context, 'week', payload['week'])

    flat = payload.get('flat')
    if isinstance(flat, dict) and isinstance(flat.get('components'), list):
        modules_by_id = {}
        for module in flat.get('modules') or []:
            module_id = clean(first_value(module, 'moduleCatalogueId', 'catalogueId', 'moduleId', 'id'))
            if module_id:
                modules_by_id[module_id] = module
        for component in flat['components']:
            module_id = clean(first_value(component, 'moduleCatalogueId', 'moduleId', 'module_catalogue_id'))
            item_context = context_with(context, 'module', modules_by_id.get(module_id, {}))
            yield component, item_context
        return

    if is_component_like(payload):
        yield payload, context

    child_context = context
    if any(clean(payload.get(key)) for key in ('moduleCatalogueId', 'catalogueId', 'moduleId', 'module_catalogue_id')):
        child_context = context_with(child_context, 'module', payload)
    if any(clean(payload.get(key)) for key in ('weekId', 'week_id', 'weekNumber', 'week_number')) and not is_component_like(payload):
        child_context = context_with(child_context, 'week', payload)

    for key in ('components', 'items', 'activities', 'lessons', 'resources'):
        if isinstance(payload.get(key), list):
            for child in payload[key]:
                yield from iter_components(child, child_context)
    for key in ('modules', 'courses', 'weeks', 'weekStructure', 'data', 'results', 'programmeStructure'):
        if isinstance(payload.get(key), (list, dict)):
            yield from iter_components(payload[key], child_context)


def assets_from_payload(payload, imported_from='payload'):
    assets = []
    seen = set()
    for component, context in iter_components(payload):
        for asset in component_assets(component, context, payload, imported_from):
            if asset['id'] in seen:
                continue
            seen.add(asset['id'])
            assets.append(asset)
    return assets


def assets_from_curriculum_programme(programme_identifier):
    payload = curriculum_views.build_curriculum_programme_tree_detail_payload(programme_identifier, 'all')
    if not payload:
        raise ProgrammeAuditNotFound('Programme not found.')
    return assets_from_payload(payload, imported_from='curriculum'), payload


def fetch_external_payload(url, query=None):
    api_key = getattr(settings, 'KBC_LMS_API_KEY', '')
    target = clean(url)
    if query:
        separator = '&' if '?' in target else '?'
        target = f'{target}{separator}{urlencode(query)}'
    headers = {
        'Accept': 'application/json',
        'User-Agent': 'KBC-LearningOS/1.0',
    }
    if api_key:
        headers['X-KBC-API-Key'] = api_key
    request = urllib.request.Request(target, headers=headers)
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode('utf-8-sig'))


KBC_WORDPRESS_SCHEMA_URL = 'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/all-students-schema'


def kbc_wordpress_activity_asset(group, activity):
    """Map one WordPress KBC-LMS ``groups[].activities[]`` entry to an asset row.

    The source endpoint is paginated by student (not by programme/material), so
    every activity payload it returns is plain course-material data with no
    student identifiers in it - see ``sync_kbc_wordpress_all_programmes``.
    """
    activity_type = normalise(clean(activity.get('activity_type')))
    video = activity.get('video') if isinstance(activity.get('video'), dict) else None
    audio = activity.get('audio') if isinstance(activity.get('audio'), dict) else None
    reading = activity.get('reading') if isinstance(activity.get('reading'), dict) else None
    quiz = activity.get('quiz') if isinstance(activity.get('quiz'), dict) else None

    if video is not None:
        kind = 'video'
        source_url = clean(video.get('iframe_url'))
        duration = parse_float(video.get('configured_duration_min'))
    elif audio is not None:
        kind = 'audio'
        source_url = clean(audio.get('iframe_url'))
        duration = parse_float(audio.get('configured_duration_min'))
    elif reading is not None:
        kind = 'reading'
        source_url = clean(reading.get('iframe_url'))
        duration = None
    elif quiz is not None:
        kind = 'quiz'
        source_url = ''
        duration = None
    else:
        kind = activity_type or 'activity'
        source_url = ''
        duration = None

    embed_url, render_mode = render_target(source_url, '', kind)
    programme_id = clean(group.get('group_id'))
    programme_name = clean(group.get('group_name'), programme_id)
    component_id = clean(activity.get('activity_id'))

    asset = {
        'programme_id': programme_id,
        'programme_source_id': programme_id,
        'programme_name': programme_name,
        'module_catalogue_id': '',
        'module_title': '',
        'week_id': '',
        'week_number': None,
        'week_title': '',
        'component_id': component_id,
        'component_type': clean(activity.get('activity_type')),
        'content_kind': kind,
        'title': first_clean(activity, 'title', fallback=kind.title()),
        'description': '',
        'source_url': source_url,
        'embed_url': embed_url,
        'embed_code': '',
        'render_mode': render_mode,
        'file_name': '',
        'content_type': '',
        'file_size': None,
        'duration_minutes': parse_int(duration),
        'expected_otjh': None,
        'points': parse_int((quiz or {}).get('maximum_score')),
        'status': '',
        'ksb_mappings': [],
        'settings': {'activity_date': clean(activity.get('activity_date'))},
        'raw_component': activity,
        'raw_payload': {'group_id': group.get('group_id'), 'group_name': group.get('group_name')},
        'imported_from': 'kbc-wordpress',
    }
    return stamp_asset(asset)


def fetch_kbc_wordpress_page(page, per_page=25):
    return fetch_external_payload(KBC_WORDPRESS_SCHEMA_URL, query={'page': page, 'per_page': per_page})


def sync_kbc_wordpress_all_programmes(*, max_pages=None, per_page=25, on_page=None):
    """Walk every page of the KBC WordPress all-students-schema endpoint and
    collect the unique programme materials it references.

    The endpoint paginates by student, so the same programme/activity is
    repeated across many pages; ``seen`` de-duplicates by activity id so each
    material is stored exactly once, and no student data is read or kept.
    """
    seen_ids = set()
    assets_by_id = {}
    page = 1
    total_pages = None
    while True:
        payload = fetch_kbc_wordpress_page(page, per_page=per_page)
        pagination = payload.get('pagination') if isinstance(payload, dict) else None
        if isinstance(pagination, dict):
            total_pages = parse_int(pagination.get('total_pages'), total_pages)
        for group in payload.get('groups') or []:
            if not isinstance(group, dict):
                continue
            for activity in group.get('activities') or []:
                if not isinstance(activity, dict):
                    continue
                activity_id = clean(activity.get('activity_id'))
                group_id = clean(group.get('group_id'))
                dedup_key = (group_id, activity_id)
                if not activity_id or dedup_key in seen_ids:
                    continue
                seen_ids.add(dedup_key)
                asset = kbc_wordpress_activity_asset(group, activity)
                assets_by_id[asset['id']] = asset
        if on_page:
            on_page(page, total_pages, len(assets_by_id))
        has_next = bool(isinstance(pagination, dict) and pagination.get('has_next_page'))
        if not has_next:
            break
        page += 1
        if max_pages and page > max_pages:
            break
    return list(assets_by_id.values())


def db_params(asset):
    params = []
    for column in ASSET_COLUMNS:
        value = asset.get(column)
        if column in JSON_COLUMNS:
            value = json_db_value(value if value is not None else ([] if column == 'ksb_mappings' else {}))
        params.append(value)
    return params


def upsert_assets(assets, replace_programme_id=''):
    require_programme_audit_table()
    if not assets:
        return {'stored': 0, 'replaced': False}
    table = asset_table_name()
    placeholders = []
    for column in ASSET_COLUMNS:
        if connection.vendor == 'postgresql' and column in JSON_COLUMNS:
            placeholders.append('%s::jsonb')
        else:
            placeholders.append('%s')
    assignments = ', '.join(
        f'{quote_ident(column)} = excluded.{quote_ident(column)}'
        for column in ASSET_COLUMNS
        if column != 'id'
    )
    sql = (
        f'insert into {table} ({", ".join(quote_ident(column) for column in ASSET_COLUMNS)}) '
        f'values ({", ".join(placeholders)}) '
        f'on conflict ({quote_ident("id")}) do update set {assignments}'
    )
    with transaction.atomic():
        if replace_programme_id:
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {table} where programme_id = %s', [replace_programme_id])
        with connection.cursor() as cursor:
            for asset in assets:
                cursor.execute(sql, db_params(asset))
    return {'stored': len(assets), 'replaced': bool(replace_programme_id)}


def per_programme_table_ident(programme_name, programme_id=''):
    """Turn a programme name into a safe, readable table name (e.g.
    ``dr_amgad_project_management_professional_apprenticeship_may25``).
    Falls back to the programme id if the name has no usable characters.
    """
    text = clean(programme_name).replace('�', '-').replace('&amp;', 'and')
    slug = re.sub(r'[^0-9a-zA-Z]+', '_', text).strip('_').lower()
    if not slug:
        slug = re.sub(r'[^0-9a-zA-Z]+', '_', clean(programme_id)).strip('_').lower()
    if not slug:
        raise ValueError('programme_name or programme_id is required to derive a table name.')
    if slug[0].isdigit():
        slug = f'p_{slug}'
    return slug[:63]


def per_programme_table_name(programme_name, programme_id=''):
    ident = per_programme_table_ident(programme_name, programme_id)
    if connection.vendor == 'postgresql':
        return f'{quote_ident(PROGRAMME_AUDIT_SCHEMA)}.{quote_ident(ident)}'
    return quote_ident(f'programme_audit_{ident}')


def provision_per_programme_table(programme_name, programme_id=''):
    """Create (if missing) a standalone table for one programme's assets,
    mirroring the column layout of programme_audit.assets."""
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    default_json_object = "'{}'::jsonb" if connection.vendor == 'postgresql' else "'{}'"
    default_json_array = "'[]'::jsonb" if connection.vendor == 'postgresql' else "'[]'"
    table = per_programme_table_name(programme_name, programme_id)
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(PROGRAMME_AUDIT_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {table} (
                id varchar(64) primary key,
                programme_id varchar(255) not null,
                programme_source_id varchar(255) not null default '',
                programme_name varchar(500) not null default '',
                module_catalogue_id varchar(128) not null default '',
                module_title varchar(500) not null default '',
                week_id varchar(128) not null default '',
                week_number integer,
                week_title varchar(500) not null default '',
                component_id varchar(128) not null default '',
                component_type varchar(64) not null default '',
                content_kind varchar(64) not null default '',
                title varchar(500) not null default '',
                description text not null default '',
                source_url text not null default '',
                embed_url text not null default '',
                embed_code text not null default '',
                render_mode varchar(64) not null default '',
                file_name varchar(500) not null default '',
                content_type varchar(255) not null default '',
                file_size bigint,
                duration_minutes integer,
                expected_otjh numeric(8, 2),
                points integer,
                status varchar(64) not null default '',
                ksb_mappings {json_type} not null default {default_json_array},
                settings {json_type} not null default {default_json_object},
                raw_component {json_type} not null default {default_json_object},
                raw_payload {json_type} not null default {default_json_object},
                imported_from varchar(255) not null default '',
                source_key varchar(512) not null default '',
                imported_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'create index if not exists {per_programme_table_ident(programme_name, programme_id)}_kind_idx on {table} (content_kind)')


def upsert_assets_per_programme_tables(assets, on_programme=None):
    """Store each asset in a standalone table named after its programme,
    instead of the shared programme_audit.assets table.

    Each programme is provisioned and inserted in its own short transaction
    (rather than one transaction spanning all programmes) so this does not
    hold a single long-running lock against a busy shared database, and a
    later programme's failure does not roll back earlier ones already
    committed.
    """
    by_programme = {}
    for asset in assets:
        by_programme.setdefault(asset['programme_id'], {'name': asset.get('programme_name', ''), 'assets': []})
        by_programme[asset['programme_id']]['assets'].append(asset)

    placeholders = []
    for column in ASSET_COLUMNS:
        if connection.vendor == 'postgresql' and column in JSON_COLUMNS:
            placeholders.append('%s::jsonb')
        else:
            placeholders.append('%s')
    assignments = ', '.join(
        f'{quote_ident(column)} = excluded.{quote_ident(column)}'
        for column in ASSET_COLUMNS
        if column != 'id'
    )

    stored = 0
    tables = []
    for programme_id, group in by_programme.items():
        programme_name = group['name']
        programme_assets = group['assets']
        table = per_programme_table_name(programme_name, programme_id)
        sql = (
            f'insert into {table} ({", ".join(quote_ident(column) for column in ASSET_COLUMNS)}) '
            f'values ({", ".join(placeholders)}) '
            f'on conflict ({quote_ident("id")}) do update set {assignments}'
        )
        with transaction.atomic():
            provision_per_programme_table(programme_name, programme_id)
            with connection.cursor() as cursor:
                for asset in programme_assets:
                    cursor.execute(sql, db_params(asset))
        stored += len(programme_assets)
        tables.append(per_programme_table_ident(programme_name, programme_id))
        if on_programme:
            on_programme(programme_id, len(programme_assets), len(tables), len(by_programme))
    return {'stored': stored, 'programmes': len(by_programme), 'tables': tables}


def serialise_asset_row(row):
    for column in JSON_COLUMNS:
        row[column] = read_json_value(row.get(column), [] if column == 'ksb_mappings' else {})
    for column in ('imported_at', 'updated_at'):
        if row.get(column) is not None and hasattr(row[column], 'isoformat'):
            row[column] = row[column].isoformat()
    if row.get('expected_otjh') is not None:
        row['expected_otjh'] = float(row['expected_otjh'])
    return row


def fetch_assets(programme_id, kind=''):
    require_programme_audit_table()
    where = ['programme_id = %s']
    params = [programme_id]
    if kind:
        where.append('content_kind = %s')
        params.append(kind)
    kind_order = """
        case content_kind
            when 'live_session' then 1
            when 'recording' then 2
            when 'video' then 3
            when 'presentation' then 4
            when 'reading' then 5
            when 'audio' then 6
            when 'quiz' then 7
            when 'reflection' then 8
            else 99
        end
    """
    if connection.vendor == 'postgresql':
        sql = (
            f'select {", ".join(quote_ident(column) for column in ASSET_COLUMNS)} '
            f'from {asset_table_name()} where {" and ".join(where)} '
            f'order by module_title, week_number nulls last, week_title, {kind_order}, title'
        )
    else:
        sql = (
            f'select {", ".join(quote_ident(column) for column in ASSET_COLUMNS)} '
            f'from {asset_table_name()} where {" and ".join(where)} '
            f'order by module_title, week_number, week_title, {kind_order}, title'
        )
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return [serialise_asset_row(row) for row in rows_as_dicts(cursor)]


def sync_from_options(*, programme_identifier='', payload=None, source_url='', replace=False):
    imported_from = 'curriculum'
    source_payload = payload
    if source_url:
        imported_from = source_url
        query = {'programme': programme_identifier} if programme_identifier else None
        source_payload = fetch_external_payload(source_url, query=query)
        assets = assets_from_payload(source_payload, imported_from=imported_from)
    elif payload is not None:
        imported_from = 'request-payload'
        assets = assets_from_payload(source_payload, imported_from=imported_from)
    else:
        if not programme_identifier:
            raise ProgrammeAuditNotFound('programmeId or programmeName is required.')
        assets, source_payload = assets_from_curriculum_programme(programme_identifier)

    if programme_identifier:
        for asset in assets:
            if asset['programme_id'] == 'unassigned-programme':
                asset['programme_id'] = programme_identifier
                asset['programme_name'] = programme_identifier
    replace_programme_id = ''
    if replace and assets:
        replace_programme_id = assets[0]['programme_id']
    result = upsert_assets(assets, replace_programme_id=replace_programme_id)
    return {
        **result,
        'programmeId': assets[0]['programme_id'] if assets else programme_identifier,
        'programmeName': assets[0]['programme_name'] if assets else '',
        'assets': assets,
        'sourcePayload': source_payload,
    }


@csrf_exempt
def programme_audit_assets(request, programme_id):
    programme_id = clean(programme_id)
    if request.method == 'GET':
        try:
            assets = fetch_assets(programme_id, clean(request.GET.get('kind')))
        except RuntimeError as exc:
            return JsonResponse({'error': str(exc)}, status=503)
        return JsonResponse({'programmeId': programme_id, 'count': len(assets), 'results': assets})

    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)

    try:
        body = json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid JSON body.'}, status=400)

    identifier = clean(
        body.get('programmeId') or body.get('programmeName') or body.get('programme') or programme_id,
        programme_id,
    )
    try:
        result = sync_from_options(
            programme_identifier=identifier,
            payload=body.get('payload'),
            source_url=body.get('sourceUrl') or '',
            replace=bool(body.get('replace')),
        )
    except ProgrammeAuditNotFound as exc:
        return JsonResponse({'error': str(exc)}, status=404)
    except RuntimeError as exc:
        return JsonResponse({'error': str(exc)}, status=503)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        logger.warning('Could not import programme audit assets: %s', exc)
        return JsonResponse({'error': 'Could not import programme audit assets.'}, status=502)
    return JsonResponse({
        'stored': result['stored'],
        'replaced': result['replaced'],
        'programmeId': result['programmeId'],
        'programmeName': result['programmeName'],
        'count': len(result['assets']),
        'results': result['assets'],
    })


@require_GET
def programme_audit_status(request):
    exists = table_exists()
    return JsonResponse({
        'schema': PROGRAMME_AUDIT_SCHEMA,
        'table': PROGRAMME_AUDIT_TABLE,
        'ready': exists,
    })


@require_GET
@never_cache
def programme_audit_materials(request):
    programme = clean(request.GET.get('programme')).upper()
    account = getattr(request, 'login_account', None)
    if account is not None and clean(getattr(account, 'role', '')).lower() == 'learner':
        programme = DEMO_PROGRAMME_BY_EMAIL.get(clean(getattr(account, 'email', '')).lower(), '')
        if not programme:
            return JsonResponse({'error': 'Material access is not configured for this learner.'}, status=403)
    keys = [
        key for key, definition in UI_MATERIAL_TABLES.items()
        if not programme or definition['programme'] == programme
    ]
    results = [fetch_ui_material(key, include_results=False) for key in keys]
    return JsonResponse({'programme': programme, 'count': len(results), 'results': results})


@require_GET
@never_cache
def programme_audit_material(request, material_key):
    account = getattr(request, 'login_account', None)
    if account is not None and clean(getattr(account, 'role', '')).lower() == 'learner':
        programme = DEMO_PROGRAMME_BY_EMAIL.get(clean(getattr(account, 'email', '')).lower(), '')
        definition = UI_MATERIAL_TABLES.get(clean(material_key))
        if not programme or not definition or definition['programme'] != programme:
            return JsonResponse({'error': 'You do not have access to this material.'}, status=403)
    try:
        material = fetch_ui_material(material_key, include_results=True)
    except ProgrammeAuditNotFound as exc:
        return JsonResponse({'error': str(exc)}, status=404)
    if not material['ready']:
        return JsonResponse({'error': 'Material table is not available.'}, status=404)
    return JsonResponse(material)
