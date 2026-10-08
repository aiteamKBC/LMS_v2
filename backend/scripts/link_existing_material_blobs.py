"""Register existing Azure curriculum files against their exact source materials.

No Django startup, uploads, source downloads, learner writes or schema changes.
Dry-run by default. Run with backend/.venv/Scripts/python.exe -I -B and this path.
--apply requires the target fingerprint printed by the dry run. Source URLs,
payloads, completion records and existing available backups remain untouched.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import parse_qs, unquote, urlsplit


TABLES = (
    'ai_in_marketing', 'commercial_intelligence', 'customer_journey',
    'earned_value_management_portfolio_management', 'impact_planning',
    'managing_successful_programmes_scheduling_professional', 'marketing_technology',
    'project_management_professional', 'project_planning_control_project_management_office',
    'risk_management', 'social_media', 'strategy_planning',
)
UPLOAD_PREFIX = '/curriculum_api/curriculum/uploads/'
DOCUMENT_MIMES = {
    'application/pdf', 'application/msword', 'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint', 'application/rtf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


def archive_blob(value, account, container):
    """Accept only the configured storage origin or our existing upload route."""
    parsed = urlsplit(str(value or ''))
    if parsed.username or parsed.password or parsed.fragment:
        return None
    if not parsed.scheme and not parsed.netloc and parsed.path.startswith(UPLOAD_PREFIX):
        name = unquote(parsed.path[len(UPLOAD_PREFIX):])
    elif (parsed.scheme == 'https' and parsed.netloc == f'{account}.blob.core.windows.net'
          and parsed.path.startswith(f'/{container}/')):
        name = unquote(parsed.path[len(container) + 2:])
    else:
        return None
    parts = name.split('/')
    if (len(parts) != 3 or parts[0] != '_legacy_files' or not parts[1].isdigit()
            or parts[2] in ('', '.', '..') or '\\' in name
            or any(ord(char) < 32 for char in name)):
        return None
    return name


def attachment_id(value, source_host):
    """Unwrap Office URLs, but trust attachment IDs only on the source origin."""
    value = str(value or '')
    for _ in range(3):
        parsed = urlsplit(value)
        if parsed.username or parsed.password:
            return None
        query = parse_qs(parsed.query)
        if parsed.hostname == 'view.officeapps.live.com':
            value = (query.get('src') or [''])[0]
            continue
        if parsed.scheme == 'https' and parsed.hostname == source_host:
            reference = (query.get('attachment_id') or [''])[0]
            return reference if re.fullmatch(r'[0-9]{1,20}', reference) else None
        return None
    return None


def compatible(kind, mime):
    kind = str(kind or '').lower()
    if kind in {'video', 'recording', 'live'}:
        return mime.startswith('video/')
    if kind in {'audio', 'podcast'}:
        return mime.startswith('audio/')
    if kind in {'pdf', 'ppt', 'slides', 'word', 'excel', 'reading', 'reading+quiz', 'document', 'file'}:
        return mime in DOCUMENT_MIMES
    return False


def plan_links(materials, assets, blobs, account, container, source_host):
    by_component = defaultdict(set)
    by_attachment = defaultdict(set)
    for blob in blobs:
        if archive_blob(UPLOAD_PREFIX + blob, account, container) == blob:
            by_attachment[blob.split('/')[1]].add(blob)
    for asset in assets:
        for field in ('source_url', 'embed_url'):
            name = archive_blob(asset.get(field), account, container)
            if name:
                by_component[asset['component_id']].add(name)
    plans, skipped = [], Counter()
    for row in materials:
        if row.get('backup_status') == 'available':
            skipped['already_available'] += 1
            continue
        candidates = set()
        for component in row.get('component_refs') or []:
            candidates.update(by_component[component])
        payload = row.get('payload') or {}
        primary = ('video_iframe_url' if row['content_type'] in {'video', 'recording', 'live'}
                   else 'audio_iframe_url' if row['content_type'] in {'audio', 'podcast'}
                   else 'reading_iframe_url')
        references = {attachment_id(value, source_host) for value in (
            row.get(primary), row.get('source_url'), payload.get(primary), payload.get('iframe_url'))}
        references.discard(None)
        if len(references) > 1:
            skipped['conflicting_attachment_ids'] += 1
            continue
        if references:
            # An exact attachment ID is stronger than a component's old snapshot.
            reference = next(iter(references))
            if any(name.split('/')[1] != reference for name in candidates):
                skipped['component_attachment_conflict'] += 1
                continue
            candidates.update(by_attachment[reference])
        if len(candidates) != 1:
            skipped['ambiguous' if candidates else 'no_exact_mapping'] += 1
            continue
        name = next(iter(candidates))
        blob = blobs.get(name)
        if not blob or blob['size'] <= 0:
            skipped['missing_or_empty_blob'] += 1
            continue
        if not compatible(row['content_type'], blob['content_type']):
            skipped['type_mismatch'] += 1
            continue
        source = payload.get('source') or {}
        attachments = (source.get('attachments') or []) if isinstance(source, dict) else []
        first_attachment = attachments[0] if attachments and isinstance(attachments[0], dict) else {}
        declared_primary = str(first_attachment.get('attachment_id') or '')
        # The explicit playable URL identifies what was displayed. Attachment
        # arrays can instead start with a companion or a later file revision.
        # Without an explicit URL ID, require the component and manifest to agree.
        if declared_primary and declared_primary != name.split('/')[1] and not references:
            skipped['primary_attachment_conflict'] += 1
            continue
        plans.append({'id': row['id'], 'material_id': row['material_id'],
                      'updated_at': row['updated_at'], 'blob_name': name,
                      'size': blob['size'], 'content_type': blob['content_type'], 'url_field': primary,
                      'previous_url': row.get(primary), 'previous_backup_status': row.get('backup_status')})
    return plans, dict(skipped)


def read_inputs(cursor, sql, material_ids):
    cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='programme_audit' AND table_name=ANY(%s)", [list(TABLES)])
    assets = []
    for entry in cursor.fetchall():
        cursor.execute(sql.SQL('SELECT component_id,source_url,embed_url FROM programme_audit.{}').format(sql.Identifier(entry['table_name'])))
        assets.extend(cursor.fetchall())
    cursor.execute('''SELECT m.id,m.material_id,m.content_type,m.source_url,m.video_iframe_url,
        m.audio_iframe_url,m.reading_iframe_url,
        jsonb_build_object('video_iframe_url',m.payload->'video_iframe_url',
            'audio_iframe_url',m.payload->'audio_iframe_url',
            'reading_iframe_url',m.payload->'reading_iframe_url',
            'iframe_url',m.payload->'iframe_url',
            'source',jsonb_build_object('attachments',m.payload#>'{source,attachments}')) AS payload,
        m.backup_status,m.updated_at,
        refs.component_refs
        FROM curriculum.source_materials m LEFT JOIN (
            SELECT source_material_id,array_agg(DISTINCT curriculum_component_ref) AS component_refs
            FROM curriculum.source_activities WHERE source_system='old_lms'
              AND deleted_at IS NULL AND curriculum_component_ref IS NOT NULL
            GROUP BY source_material_id
        ) refs ON refs.source_material_id=m.material_id
        WHERE m.source_system='old_lms' AND m.deleted_at IS NULL
          AND m.backup_status IS DISTINCT FROM 'available'
          AND (%s::bigint[] IS NULL OR m.material_id=ANY(%s)) ORDER BY m.id''',
        [material_ids or None, material_ids or None])
    return cursor.fetchall(), assets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--database-alias', default='audit', choices=['audit', 'enrolment'])
    parser.add_argument('--expected-target')
    parser.add_argument('--material-id', type=int, action='append', default=[])
    args = parser.parse_args()
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
    from azure.storage.blob import BlobServiceClient
    from config import settings

    config = settings.DATABASES[args.database_alias]
    target = hashlib.sha256(f"{config['HOST']}:{config['NAME']}".encode()).hexdigest()[:16]
    if args.apply and args.expected_target != target:
        parser.error('An apply requires --expected-target from the dry run.')
    account, container = settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_CURRICULUM_CONTAINER
    if not account or not container or not settings.AZURE_STORAGE_KEY:
        parser.error('The existing Azure curriculum store is not configured.')
    print(json.dumps({'mode': 'apply' if args.apply else 'dry-run', 'alias': args.database_alias,
        'database': config['NAME'], 'target': target, 'azure_account': account, 'container': container}), flush=True)

    def connect():
        return psycopg.connect(host=config['HOST'], port=config.get('PORT') or 5432,
            dbname=config['NAME'], user=config['USER'], password=config['PASSWORD'],
            sslmode=config.get('OPTIONS', {}).get('sslmode', 'require'), connect_timeout=15,
            row_factory=dict_row)

    with connect() as conn:
        conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='60s'")
            materials, assets = read_inputs(cursor, sql, args.material_id)
    print(json.dumps({'stage': 'catalogue_read', 'materials': len(materials), 'assets': len(assets)}), flush=True)
    # Listing includes authoritative Azure size/MIME. No bytes are downloaded,
    # copied, created or deleted. This inventory is limited to migrated files.
    with BlobServiceClient(account_url=f'https://{account}.blob.core.windows.net',
            credential=settings.AZURE_STORAGE_KEY, retry_total=1,
            connection_timeout=15, read_timeout=30) as service:
        blobs = {b.name: {'size': b.size, 'content_type': b.content_settings.content_type or ''}
                 for b in service.get_container_client(container).list_blobs(name_starts_with='_legacy_files/')}
    plans, skipped = plan_links(materials, assets, blobs, account, container,
                               urlsplit(settings.KBC_LMS_SCHEMA_URL).hostname)
    print(json.dumps({'selected': len(materials), 'verified_files': len(blobs),
        'planned': len(plans), 'skipped': skipped, 'types': dict(Counter(p['content_type'] for p in plans))}), flush=True)
    if not args.apply:
        return
    with connect() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='60s'")
            groups = defaultdict(list)
            for plan in plans:
                groups[plan['url_field']].append(plan)
            for field, group in groups.items():
                values = []
                for plan in group:
                    metadata = {'azure_storage_account': account,
                        'azure_blob_url': f'https://{account}.blob.core.windows.net/{container}/{plan["blob_name"]}',
                        'azure_legacy_link': {'attachment_id': plan['blob_name'].split('/')[1],
                                              'matched_by': 'exact_source_identity',
                                              'previous_url': plan['previous_url'],
                                              'previous_backup_status': plan['previous_backup_status']}}
                    values.append([container, plan['blob_name'], plan['content_type'], plan['size'], Jsonb(metadata),
                                   UPLOAD_PREFIX + plan['blob_name'], plan['id'], plan['updated_at']])
                cursor.executemany(sql.SQL('''UPDATE curriculum.source_materials SET blob_container=%s,
                    blob_name=%s,blob_content_type=%s,blob_size_bytes=%s,blob_sha256=NULL,
                    backup_status='available',last_checked_at=now(),last_success_at=now(),
                    last_backup_at=now(),last_error=NULL,updated_at=now(),
                    source_metadata=coalesce(source_metadata,'{{}}'::jsonb)||%s,{}=%s
                    WHERE id=%s AND source_system='old_lms' AND deleted_at IS NULL
                      AND backup_status IS DISTINCT FROM 'available'
                      AND updated_at IS NOT DISTINCT FROM %s RETURNING id''').format(sql.Identifier(field)),
                    values, returning=True)
                for plan in group:
                    row = cursor.fetchone()
                    if not row or row['id'] != plan['id']:
                        raise RuntimeError('Material changed during verification; transaction rolled back.')
                    cursor.nextset()
            ids = [p['id'] for p in plans]
            cursor.execute("SELECT count(*) AS verified FROM curriculum.source_materials WHERE id=ANY(%s) AND backup_status='available' AND blob_size_bytes>0 AND blob_container=%s", [ids, container])
            if cursor.fetchone()['verified'] != len(plans):
                raise RuntimeError('Post-write verification failed; transaction rolled back.')
    # A fresh read proves the committed state, independently of the write transaction.
    with connect() as conn:
        conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SELECT id,blob_name,blob_content_type,blob_size_bytes,backup_status FROM curriculum.source_materials WHERE id=ANY(%s)", [[p['id'] for p in plans]])
            actual = {row['id']: row for row in cursor.fetchall()}
            verified = sum(actual[p['id']]['backup_status'] == 'available'
                and actual[p['id']]['blob_name'] == p['blob_name']
                and actual[p['id']]['blob_content_type'] == p['content_type']
                and actual[p['id']]['blob_size_bytes'] == p['size'] for p in plans)
            if verified != len(plans):
                raise RuntimeError('Committed material mapping needs review.')
    print(json.dumps({'updated': len(plans), 'committed_verified': verified}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Provider/DB exceptions may contain credentials or signed URLs.
        print(json.dumps({'error_type': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1) from None
