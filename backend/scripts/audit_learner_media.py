"""Read-only media inventory and HTTP checks for the reconciled learner roster.

No application endpoints that hydrate learners, database writes, or uploads.
Private source URLs and content snapshots stay in the ignored audit cache.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import html
import json
from pathlib import Path
import re
import time
from threading import Lock
import urllib.error
import urllib.request
from urllib.parse import parse_qs, quote, unquote, urlsplit

from audit_legacy_progress import CACHE, ROOT, config, connect, fetch_page, load, save


def database():
    from learner_api.media_proxy import PROGRAMME_AUDIT_MATERIAL_TABLES
    with connect('enrolment') as connection, connection.cursor() as cursor:
        cursor.execute('SELECT id,type,settings_json FROM curriculum.components WHERE deleted_at IS NULL')
        save('media-native', cursor.fetchall())
    with connect('audit') as connection, connection.cursor() as cursor:
        rows = []
        for table in PROGRAMME_AUDIT_MATERIAL_TABLES:
            cursor.execute(f'SELECT source_url,embed_url FROM programme_audit."{table}"')
            rows.extend(cursor.fetchall())
        save('media-archive-mappings', rows)


def fetch_content():
    wanted = {int(c['id']) for learner in load('reconciliation')['learners'] for c in learner['courses']}
    def page(number):
        result = fetch_page(number)
        # Deliberately omit learner identities, answers, and quiz solutions.
        groups = [{ 'group_id': g['group_id'], 'activities': [
            {k: a.get(k) for k in ('activity_id', 'activity_type', 'title', 'video', 'audio', 'reading')}
            for a in g.get('activities', [])]} for g in result['groups'] if int(g['group_id']) in wanted]
        save(f'media-page-{number}', groups)
        return len(groups)
    total = load('fetch-summary')['total_pages']
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(page, n): n for n in range(1, total + 1) if not (CACHE / f'media-page-{n}.json.gz').exists()}
        for job in as_completed(jobs):
            print(json.dumps({'page': jobs[job], 'groups': job.result()}), flush=True)


def source_url(value):
    url = html.unescape(str(value or '').strip())
    for _ in range(3):
        parsed = urlsplit(url)
        if parsed.hostname != 'view.officeapps.live.com':
            break
        url = (parse_qs(parsed.query).get('src') or [url])[0]
    return url


def inventory():
    refs = {}
    def add(value, reference):
        url = source_url(value)
        if not url or not (url.startswith('https://') or url.startswith('http://') or url.startswith('/curriculum_api/curriculum/uploads/')):
            return
        refs.setdefault(url, set()).add(reference)
    for row in load('media-native'):
        settings = row['settings_json'] or {}
        for key in ('audioUrl', 'resourceUrl', 'videoUrl', 'podcastUrl', 'presentationUrl', 'uploadedFileUrl', 'assignmentFileUrl'):
            add(settings.get(key), f"native:{row['id']}")
        for key in ('readingContent', 'embedCode', 'lessonContent', 'transcript'):
            for url in re.findall(r'(?:src|href)=[\"\x27]([^\"\x27]+)', str(settings.get(key) or ''), re.I):
                add(url, f"native:{row['id']}")
    for n in range(1, load('fetch-summary')['total_pages'] + 1):
        for group in load(f'media-page-{n}'):
            for activity in group['activities']:
                reference = f"legacy:{group['group_id']}:{activity['activity_id']}"
                for kind in ('video', 'audio', 'reading'):
                    content = activity.get(kind) or {}
                    add(content.get('iframe_url'), reference)
                    for url in re.findall(r'(?:src|href)=[\"\x27]([^\"\x27]+)', str(content.get('text_body') or ''), re.I):
                        add(url, reference)
    save('media-inventory', [{'url': url, 'references': sorted(values)} for url, values in sorted(refs.items())])
    print(json.dumps({'unique_urls': len(refs), 'hosts': dict(Counter(urlsplit(u).hostname or 'local' for u in refs))}), flush=True)


def storage():
    from learner_api import evidence_storage
    client = evidence_storage._service_client(retry_total=1).get_container_client(config.AZURE_CURRICULUM_CONTAINER)
    blobs = [{'name': b.name, 'size': b.size, 'content_type': b.content_settings.content_type}
             for b in client.list_blobs(connection_timeout=15, read_timeout=30)]
    save('media-blobs', blobs)
    by_name = {b['name']: b for b in blobs}
    archive = {}
    for row in load('media-archive-mappings'):
        for url in row.values():
            if '/curriculum_api/curriculum/uploads/' not in str(url): continue
            path = unquote(urlsplit(url).path.split('/curriculum_api/curriculum/uploads/')[1])
            match = re.search(r'_legacy_files/(\d+)/', path)
            if match and path in by_name and by_name[path]['size']:
                archive[match[1]] = path
    save('media-verified-archive', archive)
    print(json.dumps({'blobs': len(blobs), 'empty': sum(b['size'] == 0 for b in blobs)}), flush=True)


def probe(row):
    url = row['url']
    result = {'url': url, 'checked_at': time.time()}
    try:
        # Match a browser's URL encoding, including Unicode source filenames.
        request_url = quote(url, safe=":/?#[]@!$&'()*+,;=%")
        request = urllib.request.Request(request_url, headers={'User-Agent': 'Mozilla/5.0', 'Range': 'bytes=0-2047'})
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read(2048)
            result.update(status=response.status, content_type=response.headers.get('Content-Type', ''),
                          bytes_sampled=len(body), final_url=response.url,
                          x_frame_options=response.headers.get('X-Frame-Options', ''),
                          csp=response.headers.get('Content-Security-Policy', ''),
                          content_length=response.headers.get('Content-Length'),
                          signature=body[:8].hex())
    except urllib.error.HTTPError as error:
        result.update(status=error.code, error='http_error')
        error.close()
    except (OSError, ValueError) as error:
        result.update(status=None, error=type(error).__name__)
    return result


def resource_key(url):
    parsed = urlsplit(url)
    if parsed.hostname == 'drive.google.com':
        match = re.search(r'/file/d/([^/]+)', parsed.path)
        if match:
            return ('drive', match[1], tuple(parse_qs(parsed.query).get('resourcekey', [])))
    if parsed.hostname in ('www.youtube.com', 'youtube.com', 'youtu.be'):
        ident = (parse_qs(parsed.query).get('v') or [''])[0]
        if parsed.path.startswith('/embed/'):
            ident = parsed.path.split('/')[2]
        if parsed.hostname == 'youtu.be': ident = parsed.path.strip('/')
        if ident: return ('youtube', ident)
    return url


def check_urls():
    rows = [r for r in load('media-inventory') if urlsplit(r['url']).scheme in ('http', 'https')]
    prior = load('media-http') if (CACHE / 'media-http.json.gz').exists() else []
    results = {r['url']: r for r in prior}
    limited_hosts = {urlsplit(r['url']).hostname for r in prior if r.get('status') == 429}
    guard = Lock()
    seen = {resource_key(r['url']) for r in prior}
    remaining = []
    for row in rows:
        key = resource_key(row['url'])
        if key not in seen:
            seen.add(key); remaining.append(row)
    def bounded_probe(row):
        host = urlsplit(row['url']).hostname
        with guard:
            if host in limited_hosts: return None
        item = probe(row)
        if item.get('status') == 429:
            with guard: limited_hosts.add(host)
        return item
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(bounded_probe, r): r['url'] for r in remaining}
        for job in as_completed(jobs):
            item = job.result()
            if item is None: continue
            results[item['url']] = item
            if len(results) % 100 == 0:
                save('media-http', list(results.values()))
                print(json.dumps({'checked': len(results), 'total': len(rows), 'statuses': dict(Counter(str(r.get('status')) for r in results.values()))}), flush=True)
    save('media-http', list(results.values()))
    save('media-http-summary', {'checked': len(results), 'rate_limited_hosts': sorted(limited_hosts),
                              'unique_resources': len(seen), 'unique_urls': len(rows)})


def report():
    roster = load('reconciliation')['learners']
    components = {str(c['id']): c for c in load('native-components')}
    blobs = {b['name']: b for b in load('media-blobs')}
    archive = load('media-verified-archive')
    checks = {r['url']: r for r in load('media-http')}
    equivalent_checks = {}
    for check in checks.values():
        equivalent_checks.setdefault(resource_key(check['url']), check)
    limited_hosts = {urlsplit(r['url']).hostname for r in checks.values() if r.get('status') == 429}
    missing = load('media-confirmed-missing') if (CACHE / 'media-confirmed-missing.json.gz').exists() else []
    by_native, by_legacy, details = {}, {}, []
    for index, row in enumerate(load('media-inventory')):
        url = row['url']; parsed = urlsplit(url)
        check = checks.get(url) or equivalent_checks.get(resource_key(url), {})
        path = unquote(parsed.path).removeprefix('/curriculum_api/curriculum/uploads/')
        attachment = (parse_qs(parsed.query).get('attachment_id') or [''])[0]
        if parsed.path.startswith('/curriculum_api/curriculum/uploads/'):
            blob = blobs.get(path)
            state = 'stored_nonempty' if blob and blob['size'] else 'storage_missing_or_empty'
        elif attachment in archive:
            state = 'stored_nonempty'
        elif check.get('status') in (200, 206):
            state = 'http_reachable' if url in checks else 'same_provider_resource_reachable'
        elif check.get('status') == 429 or (not check and parsed.hostname in limited_hosts):
            state = 'rate_limited_unverified'
        elif check:
            state = 'http_error_requires_review'
        else:
            state = 'not_http_checked'
        item = {'reference': hashlib.sha256(url.encode()).hexdigest()[:16], 'host': parsed.hostname or 'platform-upload',
                'path': parsed.path, 'attachment_id': attachment or None,
                'state': state, 'status': check.get('status'), 'content_type': check.get('content_type'),
                'source_x_frame_options': check.get('x_frame_options'),
                'component_references': row['references']}
        details.append(item)
        for reference in row['references']:
            if reference.startswith('native:'):
                by_native.setdefault(reference.split(':', 1)[1], set()).add(index)
            else:
                _, course_id, activity_id = reference.split(':')
                by_legacy.setdefault((course_id, activity_id), set()).add(index)
    learners = []
    relevant = set()
    for learner in roster:
        modules = set(map(str, learner['assigned_native_module_ids']))
        indexes = set()
        for component_id, component in components.items():
            if str(component['module_id']) in modules:
                indexes.update(by_native.get(component_id, set()))
        for course in learner['courses']:
            for activity_id in [*course['completed_activity_ids'], *course['not_completed_activity_ids']]:
                indexes.update(by_legacy.get((str(course['id']), str(activity_id)), set()))
        relevant.update(indexes)
        counts = Counter(details[i]['state'] for i in indexes)
        learners.append({'enrolment_id': learner['enrolment_id'], 'name': learner['name'],
                         'identity_verification': learner['verification'],
                         'source_courses': len(learner['courses']), 'media_and_reference_links': len(indexes),
                         'confirmed_missing_source_attachments': sum(learner['enrolment_id'] in item['learner_ids'] for item in missing),
                         **{state: counts[state] for state in ('stored_nonempty', 'storage_missing_or_empty', 'http_reachable',
                            'same_provider_resource_reachable', 'http_error_requires_review', 'rate_limited_unverified', 'not_http_checked')}})
    kept = [details[i] for i in sorted(relevant)]
    payload = {'checked_at': datetime.now(timezone.utc).isoformat(),
               'coverage': 'All 369 learner mappings and assigned stored files; source URL checks do not prove provider playback.',
               'counts': dict(Counter(i['state'] for i in kept)), 'rate_limited_hosts': sorted(limited_hosts),
               'confirmed_missing_source_attachments': missing,
               'learners': learners, 'resources': kept}
    folder = ROOT / 'reports'; folder.mkdir(exist_ok=True)
    name = 'learner-media-verification-2026-09-12'
    (folder / (name + '.json')).write_text(json.dumps(payload, indent=2), encoding='utf-8')
    with (folder / (name + '.csv')).open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=list(learners[0])); writer.writeheader(); writer.writerows(learners)
    print(json.dumps({'learners': len(learners), 'relevant_unique_links': len(kept), 'counts': payload['counts']}), flush=True)


def recover_missing():
    """Distinguish an expired source URL from a file that is still missing."""
    from learner_api.subject_content import material_schema, ContentUnavailable
    source_host = urlsplit(config.KBC_LMS_SCHEMA_URL).hostname
    activity_ids = set()
    for item in load('media-http'):
        parsed = urlsplit(item['url'])
        match = re.search(r'/material/(\d+)/', parsed.path)
        if item.get('status') == 404 and parsed.hostname == source_host and match:
            activity_ids.add(int(match[1]))
    roster = load('reconciliation')['learners']
    missing, retried = [], []
    for activity_id in sorted(activity_ids):
        try:
            schema = material_schema(activity_id)
        except ContentUnavailable:
            retried.append({'activity_id': activity_id, 'status': 'schema_unavailable'})
            continue
        result = probe({'url': source_url(schema.get('iframe_url'))})
        retried.append({'activity_id': activity_id, 'status': result.get('status')})
        if result.get('status') != 404: continue
        courses, learner_ids = {}, set()
        for learner in roster:
            for course in learner['courses']:
                if activity_id in course['completed_activity_ids'] or activity_id in course['not_completed_activity_ids']:
                    courses[str(course['id'])] = course['name']; learner_ids.add(learner['enrolment_id'])
        if not learner_ids: continue
        attachment_id = (parse_qs(urlsplit(result['url']).query).get('attachment_id') or [''])[0]
        attachment = next((a for a in (schema.get('source') or {}).get('attachments', [])
                           if str(a.get('attachment_id')) == attachment_id), {})
        missing.append({'activity_id': activity_id, 'attachment_id': attachment_id,
                        'filename': attachment.get('filename'), 'courses': courses, 'learner_ids': sorted(learner_ids)})
    save('media-confirmed-missing', missing)
    save('media-recovery-checks', retried)
    print(json.dumps({'confirmed_missing': len(missing), 'affected_learners': len({i for r in missing for i in r['learner_ids']})}), flush=True)


def browser_fixtures():
    """Prepare real files for an isolated UI check, with no authenticated login."""
    import logging
    from django.conf import settings
    settings.DATABASES = {k: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'} for k in config.DATABASES}
    import django
    django.setup()
    logging.getLogger('azure').setLevel(logging.WARNING)
    from learner_api import evidence_storage
    from curriculum_api.pptx_slides import _pdf_model, _deck_model
    from curriculum_api.views import curriculum_uploaded_file
    from django.test import RequestFactory

    cases = []
    blobs = load('media-blobs')
    for extension in ('.pdf', '.mp3', '.pptx', '.docx', '.xlsx'):
        selected = min((b for b in blobs if b['size'] and Path(b['name']).suffix == extension
                        and '_legacy_files/' in b['name']), key=lambda b: b['size'])
        filename = 'browser-real' + extension
        client = evidence_storage._service_client(retry_total=1).get_blob_client(config.AZURE_CURRICULUM_CONTAINER, selected['name'])
        (CACHE / filename).write_bytes(client.download_blob(connection_timeout=15, read_timeout=30).readall())
        cases.append({'name': extension[1:], 'url': '/__real-assets/' + filename,
                      'kind': 'audio' if extension == '.mp3' else 'document', 'file': filename, 'mime': selected['content_type']})
        if extension in ('.pdf', '.pptx'):
            folder = CACHE / 'browser-render' / extension[1:]; folder.mkdir(parents=True, exist_ok=True)
            model = (_pdf_model if extension == '.pdf' else _deck_model)(CACHE / filename, folder, '/__real-render/' + extension[1:])
            (CACHE / ('browser-model' + extension + '.json')).write_text(json.dumps(model), encoding='utf-8')
    native = load('media-native')
    for name, host, key, kind in [('spotify', 'open.spotify.com', 'podcastUrl', 'embed'),
                                  ('youtube', 'youtube.com', 'videoUrl', 'video'), ('drive', 'drive.google.com', 'videoUrl', 'video')]:
        url = next(r['settings_json'][key] for r in native if host in str((r['settings_json'] or {}).get(key, '')))
        cases.append({'name': name, 'url': url, 'kind': kind})
    doc = next(r['settings_json'][key] for r in native for key in ('resourceUrl', 'uploadedFileUrl')
               if str((r['settings_json'] or {}).get(key, '')).endswith('.doc'))
    path = urlsplit(doc).path
    response = curriculum_uploaded_file(RequestFactory().get(path, {'preview': '1'}), path.split('/curriculum_api/curriculum/uploads/')[1])
    if response.status_code != 200: raise RuntimeError('The Office preview could not be prepared.')
    (CACHE / 'browser-office-preview.html').write_bytes(response.content)
    cases.append({'name': 'doc', 'url': path, 'kind': 'document'})
    (CACHE / 'media-browser-cases.json').write_text(json.dumps(cases), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for option in ('database', 'fetch', 'inventory', 'storage', 'probe', 'recover_missing', 'report', 'browser_fixtures'):
        parser.add_argument('--' + option, action='store_true')
    args = parser.parse_args()
    if args.database: database()
    if args.fetch: fetch_content()
    if args.inventory: inventory()
    if args.storage: storage()
    if args.probe: check_urls()
    if args.recover_missing: recover_missing()
    if args.report: report()
    if args.browser_fixtures: browser_fixtures()
