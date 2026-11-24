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

from curriculum_api.catalogue.api.programme_detail_composition import build_curriculum_programme_tree_detail_payload

logger = logging.getLogger(__name__)

from .catalogue.domain.asset_contracts import PROGRAMME_AUDIT_SCHEMA
from .catalogue.domain.asset_contracts import PROGRAMME_AUDIT_TABLE
from .catalogue.domain.asset_contracts import UPLOAD_URL_PREFIX

from .catalogue.domain.asset_contracts import JSON_COLUMNS

from .catalogue.domain.asset_contracts import UI_MATERIAL_TABLES

class ProgrammeAuditNotFound(ValueError):
    pass

from .catalogue.domain.asset_contracts import ASSET_COLUMNS


def clean(value, fallback=''):
    from .catalogue.domain.asset_values import clean as implementation
    return implementation(
        value, fallback,
    )


def normalise(value):
    from .catalogue.domain.asset_values import normalise as implementation
    return implementation(
        value, clean=clean,
    )


def scope_assets_to_ui_material(material, source_assets):
    from .catalogue.application.audit_assets import scope_assets_to_ui_material as implementation
    return implementation(
        material, source_assets, clean=clean, read_json_value=read_json_value,
    )


def quote_ident(value):
    from .catalogue.infrastructure.audit_asset_reads import quote_ident as implementation
    return implementation(
        value,
    )


def asset_table_name():
    from .catalogue.infrastructure.audit_asset_reads import asset_table_name as implementation
    return implementation(
        PROGRAMME_AUDIT_SCHEMA=PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE=PROGRAMME_AUDIT_TABLE,
        connection=connection, quote_ident=quote_ident,
    )


def json_db_value(value):
    return json.dumps(value, cls=DjangoJSONEncoder, ensure_ascii=False)


def read_json_value(value, fallback):
    from .catalogue.domain.asset_values import read_json_value as implementation
    return implementation(
        value, fallback, json=json,
    )


def rows_as_dicts(cursor):
    from .catalogue.infrastructure.audit_asset_reads import rows_as_dicts as implementation
    return implementation(
        cursor,
    )


def ui_material_table_exists(table):
    from .catalogue.infrastructure.audit_asset_reads import ui_material_table_exists as implementation
    return implementation(
        table, PROGRAMME_AUDIT_SCHEMA=PROGRAMME_AUDIT_SCHEMA, connection=connection,
    )


def fetch_ui_material(key, include_results=False):
    from .catalogue.infrastructure.audit_asset_reads import fetch_ui_material as implementation
    return implementation(
        key, include_results, PROGRAMME_AUDIT_SCHEMA=PROGRAMME_AUDIT_SCHEMA,
        ProgrammeAuditNotFound=ProgrammeAuditNotFound, UI_MATERIAL_TABLES=UI_MATERIAL_TABLES,
        clean=clean, connection=connection, quote_ident=quote_ident, rows_as_dicts=rows_as_dicts,
        ui_material_table_exists=ui_material_table_exists,
    )


def table_exists():
    from .catalogue.infrastructure.audit_asset_reads import table_exists as implementation
    return implementation(
        PROGRAMME_AUDIT_SCHEMA=PROGRAMME_AUDIT_SCHEMA, PROGRAMME_AUDIT_TABLE=PROGRAMME_AUDIT_TABLE,
        connection=connection, logger=logger,
    )


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
                programme_name text not null default '',
                module_catalogue_id varchar(128) not null default '',
                module_title text not null default '',
                week_id varchar(128) not null default '',
                week_number integer,
                week_title text not null default '',
                component_id varchar(128) not null default '',
                component_type varchar(64) not null default '',
                content_kind varchar(64) not null default '',
                title text not null default '',
                description text not null default '',
                source_url text not null default '',
                embed_url text not null default '',
                embed_code text not null default '',
                render_mode varchar(64) not null default '',
                file_name text not null default '',
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
    from .catalogue.domain.asset_values import parse_int as implementation
    return implementation(
        value, default,
    )


def parse_float(value, default=None):
    from .catalogue.domain.asset_values import parse_float as implementation
    return implementation(
        value, default,
    )


def first_value(mapping, *keys, fallback=''):
    from .catalogue.domain.asset_values import first_value as implementation
    return implementation(
        mapping, *keys, fallback=fallback,
    )


def first_clean(mapping, *keys, fallback=''):
    from .catalogue.domain.asset_values import first_clean as implementation
    return implementation(
        mapping, *keys, fallback=fallback, clean=clean, first_value=first_value,
    )


def iframe_src(value):
    from .catalogue.domain.asset_values import iframe_src as implementation
    return implementation(
        value, clean=clean, re=re,
    )


def is_http_url(value):
    from .catalogue.domain.asset_values import is_http_url as implementation
    return implementation(
        value, clean=clean, urlparse=urlparse,
    )


def youtube_embed_url(url):
    from .catalogue.domain.asset_values import youtube_embed_url as implementation
    return implementation(
        url, clean=clean, parse_qs=parse_qs, urlparse=urlparse,
    )


def vimeo_embed_url(url):
    from .catalogue.domain.asset_values import vimeo_embed_url as implementation
    return implementation(
        url, clean=clean, re=re, urlparse=urlparse,
    )


def google_embed_url(url):
    from .catalogue.domain.asset_values import google_embed_url as implementation
    return implementation(
        url, clean=clean, re=re,
    )


def file_extension(url):
    from .catalogue.domain.asset_values import file_extension as implementation
    return implementation(
        url, clean=clean, urlparse=urlparse,
    )


def render_target(source_url='', embed_code='', content_kind=''):
    from .catalogue.domain.asset_values import render_target as implementation
    return implementation(
        source_url, embed_code, content_kind, UPLOAD_URL_PREFIX=UPLOAD_URL_PREFIX, clean=clean,
        file_extension=file_extension, google_embed_url=google_embed_url, iframe_src=iframe_src,
        is_http_url=is_http_url, urlencode=urlencode, vimeo_embed_url=vimeo_embed_url,
        youtube_embed_url=youtube_embed_url,
    )


def content_kind_for_component(component_type):
    from .catalogue.domain.asset_values import content_kind_for_component as implementation
    return implementation(
        component_type, normalise=normalise,
    )


def component_settings(component):
    from .catalogue.domain.asset_values import component_settings as implementation
    return implementation(
        component, first_value=first_value, read_json_value=read_json_value,
    )


def normalised_component_type(component):
    from .catalogue.domain.asset_values import normalised_component_type as implementation
    return implementation(
        component, clean=clean, component_settings=component_settings, first_clean=first_clean,
        normalise=normalise,
    )


def base_asset(component, context, raw_payload, imported_from):
    from .catalogue.application.audit_assets import base_asset as implementation
    return implementation(
        component, context, raw_payload, imported_from, clean=clean,
        component_settings=component_settings, content_kind_for_component=content_kind_for_component,
        first_clean=first_clean, first_value=first_value,
        normalised_component_type=normalised_component_type, parse_float=parse_float,
        parse_int=parse_int, read_json_value=read_json_value,
    )


def primary_source_for_component(component, settings, component_type):
    from .catalogue.domain.asset_values import primary_source_for_component as implementation
    return implementation(
        component, settings, component_type, first_clean=first_clean,
    )


def component_assets(component, context, raw_payload, imported_from='curriculum'):
    from .catalogue.application.audit_assets import component_assets as implementation
    return implementation(
        component, context, raw_payload, imported_from, base_asset=base_asset,
        component_settings=component_settings, content_kind_for_component=content_kind_for_component,
        first_clean=first_clean, normalised_component_type=normalised_component_type,
        primary_source_for_component=primary_source_for_component, render_target=render_target,
        stamp_asset=stamp_asset,
    )


def stable_asset_id(asset):
    from .catalogue.domain.asset_values import stable_asset_id as implementation
    return implementation(
        asset, clean=clean, hashlib=hashlib,
    )


def stamp_asset(asset):
    from .catalogue.application.audit_assets import stamp_asset as implementation
    return implementation(
        asset, stable_asset_id=stable_asset_id, timezone=timezone,
    )


def is_component_like(value):
    from .catalogue.domain.asset_values import is_component_like as implementation
    return implementation(
        value, clean=clean,
    )


def context_with(context, key, value):
    from .catalogue.domain.asset_values import context_with as implementation
    return implementation(
        context, key, value,
    )


def iter_components(payload, context=None):
    from .catalogue.application.audit_assets import iter_components as implementation
    yield from implementation(
        payload, context, clean=clean, context_with=context_with, first_clean=first_clean,
        first_value=first_value, is_component_like=is_component_like, iter_components=iter_components,
    )


def assets_from_payload(payload, imported_from='payload'):
    from .catalogue.application.audit_assets import assets_from_payload as implementation
    return implementation(
        payload, imported_from, component_assets=component_assets, iter_components=iter_components,
    )


def assets_from_curriculum_programme(programme_identifier):
    from .catalogue.application.audit_assets import assets_from_curriculum_programme as implementation
    return implementation(
        programme_identifier, ProgrammeAuditNotFound=ProgrammeAuditNotFound,
        assets_from_payload=assets_from_payload,
        curriculum_views_build_curriculum_programme_tree_detail_payload=build_curriculum_programme_tree_detail_payload,
    )


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


from .catalogue.domain.asset_contracts import KBC_WORDPRESS_SCHEMA_URL


def kbc_wordpress_activity_asset(group, activity):
    from .catalogue.application.audit_assets import kbc_wordpress_activity_asset as implementation
    return implementation(
        group, activity, clean=clean, first_clean=first_clean, normalise=normalise,
        parse_float=parse_float, parse_int=parse_int, render_target=render_target,
        stamp_asset=stamp_asset,
    )


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
                programme_name text not null default '',
                module_catalogue_id varchar(128) not null default '',
                module_title text not null default '',
                week_id varchar(128) not null default '',
                week_number integer,
                week_title text not null default '',
                component_id varchar(128) not null default '',
                component_type varchar(64) not null default '',
                content_kind varchar(64) not null default '',
                title text not null default '',
                description text not null default '',
                source_url text not null default '',
                embed_url text not null default '',
                embed_code text not null default '',
                render_mode varchar(64) not null default '',
                file_name text not null default '',
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
    from .catalogue.application.audit_assets import serialise_asset_row as implementation
    return implementation(
        row, JSON_COLUMNS=JSON_COLUMNS, read_json_value=read_json_value,
    )


def fetch_assets(programme_id, kind=''):
    from .catalogue.infrastructure.audit_asset_reads import fetch_assets as implementation
    return implementation(
        programme_id, kind, ASSET_COLUMNS=ASSET_COLUMNS, asset_table_name=asset_table_name,
        connection=connection, quote_ident=quote_ident,
        require_programme_audit_table=require_programme_audit_table, rows_as_dicts=rows_as_dicts,
        serialise_asset_row=serialise_asset_row,
    )


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
    from .catalogue.api.audit_assets import programme_audit_status as implementation
    return implementation(
        request, JsonResponse=JsonResponse, PROGRAMME_AUDIT_SCHEMA=PROGRAMME_AUDIT_SCHEMA,
        PROGRAMME_AUDIT_TABLE=PROGRAMME_AUDIT_TABLE, table_exists=table_exists,
    )


@require_GET
@never_cache
def programme_audit_materials(request):
    from .catalogue.api.audit_assets import programme_audit_materials as implementation
    return implementation(
        request, JsonResponse=JsonResponse, UI_MATERIAL_TABLES=UI_MATERIAL_TABLES, clean=clean,
        fetch_ui_material=fetch_ui_material,
    )


@require_GET
@never_cache
def programme_audit_material(request, material_key):
    from .catalogue.api.audit_assets import programme_audit_material as implementation
    return implementation(
        request, material_key, JsonResponse=JsonResponse, ProgrammeAuditNotFound=ProgrammeAuditNotFound,
        clean=clean, fetch_ui_material=fetch_ui_material,
    )
