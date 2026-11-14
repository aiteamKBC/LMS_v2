"""Replay only the 30 approved cover assignments after frontend assets deploy.

Dry run by default; existing covers are preserved unless --replace-existing is
explicit. Use the frontend origin/path as --asset-base-url, and identify the
configured database with --expected-host and --expected-database. For writes,
add --apply --backup-file /secure/backups/module-covers.json (outside checkout).

No django.setup(), application-ready hooks, schema helpers, storage uploads or
Teams calls. This standalone operation never runs automatically on deployment.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

BACKEND_ROOT = Path(__file__).resolve().parents[1]
ROOT = BACKEND_ROOT.parent if (BACKEND_ROOT.parent / 'frontend').is_dir() else BACKEND_ROOT
MANIFEST = Path(__file__).parent / 'data/module-cover-assets-20261113.json'


def load_manifest(path=MANIFEST):
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    covers = data['covers']
    if data.get('version') != 1 or len(covers) != 30:
        raise ValueError('Expected the approved 30-cover manifest.')
    ids = set()
    for cover in covers:
        mid, asset = cover['moduleId'], cover['asset']
        if not mid or mid in ids:
            raise ValueError('Module identifiers must be nonempty and unique.')
        ids.add(mid)
        if not re.fullmatch(r'assets/module-covers/2026-11-13/[a-z0-9-]+\.webp', asset):
            raise ValueError('Unexpected cover asset path.')
        if not re.fullmatch(r'[0-9a-f]{64}', cover['sha256']):
            raise ValueError('Invalid cover asset checksum.')
    return covers


def plan_updates(covers, current, base_url, *, replace_existing=False, allow_missing=False):
    parsed = urlsplit(base_url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use a public frontend base URL without credentials or query parameters.')
    missing, updates, unchanged, preserved = [], [], 0, 0
    for cover in covers:
        mid = cover['moduleId']
        if mid not in current:
            missing.append(mid)
            continue
        url = base_url.rstrip('/') + '/' + cover['asset']
        previous = current[mid]
        if previous == url:
            unchanged += 1
        elif str(previous or '').strip() and not replace_existing:
            preserved += 1
        else:
            updates.append({'moduleId': mid, 'url': url, 'previous': previous})
    if missing and not allow_missing:
        raise ValueError(f'{len(missing)} mapped modules are absent or archived; no changes applied. Use --allow-missing only for an intentionally partial environment.')
    return {'updates': updates, 'missing': missing, 'unchanged': unchanged, 'preserved': preserved}


def write_backup(path, rows):
    destination = Path(path).expanduser().resolve()
    if not Path(path).is_absolute() or destination.is_relative_to(ROOT):
        raise ValueError('The private backup must use an absolute path outside the checkout.')
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
        json.dump({'manifest': MANIFEST.name, 'modules': rows}, output, default=str, indent=2)
        output.flush()
        os.fsync(output.fileno())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset-base-url', required=True)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--database', default='default')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--replace-existing', action='store_true')
    parser.add_argument('--allow-missing', action='store_true')
    parser.add_argument('--backup-file')
    args = parser.parse_args(argv)
    if args.apply and not args.backup_file:
        parser.error('--apply requires a private --backup-file outside the checkout.')
    covers = load_manifest()
    # Validate the public URL before opening a connection, even in dry runs.
    plan_updates(covers, {}, args.asset_base_url, allow_missing=True)
    sys.path.insert(0, str(BACKEND_ROOT))
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    from django.db import connections
    configured = connections[args.database]
    if configured.vendor != 'postgresql' or str(configured.settings_dict['HOST']).rstrip('.').lower() != args.expected_host.rstrip('.').lower():
        raise ValueError('Configured database host/vendor does not match the identified target.')
    ids = [cover['moduleId'] for cover in covers]
    query = """select module_catalogue_id,cover_image_url,updated_at,
        md5((to_jsonb(m)-'cover_image_url'-'updated_at')::text)
        from curriculum.modules m where module_catalogue_id=any(%s)
        and deleted_at is null and is_programme_deleted is not true
        and lower(coalesce(to_jsonb(m)->>'status',''))<>'archived'
        and lower(trim(coalesce(to_jsonb(m)->>'is_archived',''))) not in ('1','true','yes','y','on')"""
    # Use Django's configured driver/parameters directly. A standalone data
    # operation needs neither application setup nor a web-worker connection pool.
    connection = configured.Database.connect(**configured.get_connection_params())
    connection.autocommit = False
    try:
        with connection:
            with connection.cursor() as cursor:
                if not args.apply:
                    cursor.execute('set transaction read only')
                cursor.execute('set local statement_timeout=30000')
                cursor.execute("select current_database(),current_setting('transaction_read_only')")
                database_name, read_only = cursor.fetchone()
                if database_name != args.expected_database:
                    raise ValueError('Connected database does not match the identified target.')
                if not args.apply and read_only != 'on':
                    raise ValueError('Dry run requires a verified read-only transaction.')
                cursor.execute(query + (' for update' if args.apply else ''), [ids])
                rows = {row[0]: {'coverImageUrl': row[1], 'updatedAt': row[2], 'fingerprint': row[3]} for row in cursor.fetchall()}
                plan = plan_updates(covers, {mid: row['coverImageUrl'] for mid, row in rows.items()}, args.asset_base_url,
                    replace_existing=args.replace_existing, allow_missing=args.allow_missing)
                if args.apply and plan['updates']:
                    write_backup(args.backup_file, rows)
                    for update in plan['updates']:
                        cursor.execute('''update curriculum.modules set cover_image_url=%s,updated_at=current_timestamp
                            where module_catalogue_id=%s and cover_image_url is not distinct from %s''',
                            [update['url'], update['moduleId'], update['previous']])
                        if cursor.rowcount != 1:
                            raise RuntimeError('A scoped cover update did not match exactly one module.')
                    cursor.execute('update curriculum.cache_epoch set epoch=epoch+1 where id=1 returning epoch')
                    if not cursor.fetchone():
                        raise RuntimeError('Existing curriculum cache epoch is missing; rolling back.')
                    cursor.execute(query, [ids])
                    after = {row[0]: row for row in cursor.fetchall()}
                    desired = {update['moduleId']: update['url'] for update in plan['updates']}
                    if set(after) != set(rows) or any(after[mid][3] != row['fingerprint'] or after[mid][1] != desired.get(mid, row['coverImageUrl']) for mid, row in rows.items()):
                        raise RuntimeError('Post-write cover/field verification failed; rolling back.')
    finally:
        connection.close()
    print(json.dumps({'dryRun': not args.apply, 'mapped': len(covers), 'matched': len(rows),
        'missing': len(plan['missing']), 'preservedExisting': plan['preserved'], 'alreadyAssigned': plan['unchanged'],
        'wouldUpdate': len(plan['updates']), 'updated': len(plan['updates']) if args.apply else 0,
        'partialEnvironment': bool(plan['missing'])}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError) as error:
        raise SystemExit(str(error))
    except Exception as error:
        # Driver exceptions can contain connection details or private old URLs.
        raise SystemExit(f'Cover operation failed ({type(error).__name__}); no successful import reported.')
