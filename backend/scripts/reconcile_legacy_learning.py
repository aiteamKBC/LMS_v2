"""Reconcile verified legacy course enrolments and completion evidence.

No Django startup, meeting calls, mail, or writes to native training plans.
Source snapshots omit names, emails, credentials, answers and content bodies.
All database access is read-only unless an explicit fingerprinted apply runs.

Workflow: fetch -> catalogue preview/apply -> learners preview/apply ->
archive-duplicates preview/apply -> learners preview (idempotence check).
Keep --snapshot-dir outside version control: snapshots contain private source
account IDs and course progress, even though names and emails are excluded.
Use --course-scoped only after deploying canonical_learning.recorded_source_key;
its course-qualified source IDs are intentionally not understood by old readers.
Every apply needs its own preview's --expected-target and --expected-fingerprint.
Per-learner transactions preserve original progress, journals, reporting segments
and native assignments, and add no accepted seconds. They can be resumed with a
fresh preview after a failure. No schema migration or live integration is used.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from reconcile_aptem_evidence import insert
from restore_legacy_material_progress import source_instant

ENDPOINT = 'https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress'
VERSION = 'legacy-learning-reconciliation-v1'
FACT_FIELDS = ('title', 'post_type', 'component_kind', 'material_type',
               'section_id', 'section_title', 'section_order', 'component_order',
               'completed', 'started_at', 'completed_at', 'passed',
               'attempts_count', 'best_score_percent', 'last_status', 'created_at')


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True,
                                    separators=(',', ':')).encode()).hexdigest()


def emit(value):
    print(json.dumps(value, default=str), flush=True)


def configuration(path):
    values = dict(os.environ)
    for raw in Path(path).read_text(encoding='utf-8-sig').splitlines():
        line = raw.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = next((values[k] for k in ('ENROLMENT_DATABASE_URL', 'Database_url',
                                   'DATABASEURL', 'DATABASE_URL') if values.get(k)), None)
    if not url:
        raise ValueError('Missing configured enrolment database.')
    return url, values.get('KBC_LMS_API_KEY', '')


def connect(url, *, write=False):
    conn = psycopg.connect(url, connect_timeout=10, row_factory=dict_row)
    conn.read_only = not write
    conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    conn.execute("SET LOCAL statement_timeout='60s'")
    conn.execute("SET LOCAL lock_timeout='5s'")
    return conn


@contextmanager
def learner_transaction(conn):
    if conn is None:
        yield None
        return
    try:
        with conn.transaction():
            conn.execute("SET LOCAL statement_timeout='60s'")
            conn.execute("SET LOCAL lock_timeout='5s'")
            yield conn
    except BaseException:
        conn.close()
        raise


def target_fingerprint(conn):
    return digest({'host': conn.info.host, 'database': conn.info.dbname})


def read_owners(cur):
    rows = cur.execute('''SELECT l.id,l.enrolment_id,l.programme_id,l.aptem_id,
        lower(trim(l.email)) AS canonical_email,lower(trim(e."Email")) AS account_email,
        e.aptem_id::text AS account_aptem_id,i.id AS identity_id,i.source_learner_id,
        coalesce(nullif(i.source_payload->>'source_email',''),
                 i.source_payload->>'learner_email') AS source_email,
        coalesce((i.source_payload#>>'{legacy_alias,is_primary}')::boolean,
                 i.source_payload ? 'record_id') AS is_primary
        FROM "Learner".learners l JOIN enrolment."Created_users" e ON e.id=l.enrolment_id
        JOIN "Learner".learner_external_identities i ON i.learner_id=l.id
        WHERE i.source_system='old_lms' AND i.deleted_at IS NULL
        ORDER BY l.id,i.id''').fetchall()
    owners, source_owners, enrolment_owners = {}, defaultdict(set), defaultdict(set)
    invalid = set()
    for row in rows:
        owner = owners.setdefault(row['id'], {key: row[key] for key in
            ('id', 'enrolment_id', 'programme_id', 'aptem_id')} | {'accounts': []})
        sid = str(row['source_learner_id'] or '')
        source_email = str(row['source_email'] or '').strip().casefold()
        if (not sid.isdigit() or int(sid) <= 0 or not source_email
                or not row['canonical_email']
                or row['canonical_email'] != row['account_email']
                or str(row['aptem_id'] or '') != str(row['account_aptem_id'] or '').strip()):
            invalid.add(row['id'])
            continue
        allowed = {source_email}
        if row['is_primary']:
            allowed.add(row['canonical_email'])
        account = {'id': int(sid), 'identity_id': row['identity_id'],
                   'allowed_emails': sorted(allowed)}
        account['identity_fingerprint'] = digest({**account, 'owner': row['id'],
                                                 'enrolment': row['enrolment_id']})
        owner['accounts'].append(account)
        source_owners[int(sid)].add(row['id'])
        enrolment_owners[row['enrolment_id']].add(row['id'])
    for matches in [*source_owners.values(), *enrolment_owners.values()]:
        if len(matches) > 1:
            invalid.update(matches)
    for owner in owners.values():
        if len({a['id'] for a in owner['accounts']}) != len(owner['accounts']):
            invalid.add(owner['id'])
    return {key: value for key, value in owners.items() if key not in invalid}, len(invalid)


class SameOrigin(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl)[:2] != urlsplit(req.full_url)[:2]:
            raise ValueError('Cross-origin redirect refused.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def normalize_courses(rows, account):
    if not isinstance(rows, list) or not rows:
        raise ValueError('Empty or invalid source cannot verify account ownership.')
    courses = {}
    for row in rows:
        if (not isinstance(row, dict) or type(row.get('user_id')) is not int or row.get('user_id') != account['id']
                or str(row.get('email') or '').strip().casefold() not in account['allowed_emails']):
            raise ValueError('Source account identity mismatch.')
        cid = row.get('course_id')
        if type(cid) is not int or cid <= 0 or str(cid) in courses:
            raise ValueError('Invalid or duplicate source course.')
        facts = {}
        for field, kind in (('materials', 'material'), ('quizzes', 'quiz')):
            if not isinstance(row.get(field), list):
                raise ValueError('Incomplete course component inventory.')
            for item in row[field]:
                ident = item.get('component_id') if isinstance(item, dict) else None
                if type(ident) is not int or ident <= 0:
                    raise ValueError('Invalid source component identity.')
                ref = f'{kind}:{ident}'
                if ref in facts:
                    raise ValueError('Duplicate typed source component.')
                facts[ref] = {key: item.get(key) for key in FACT_FIELDS}
        courses[str(cid)] = {'title': row.get('course') or '',
            'status': row.get('course_status'), 'source_progress': row.get('progress'),
            'timezone': row.get('timezone'), 'facts': facts}
    return courses


def fetch_account(account, secret, target):
    address = ENDPOINT + f'?user_id={account["id"]}&include_answers=false&include_other_modules=false'
    request = urllib.request.Request(address, headers={
        'X-KBC-API-Key': secret, 'Accept': 'application/json',
        'Accept-Encoding': 'gzip', 'User-Agent': 'KBC-Legacy-Learning-Reconciliation/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
                stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
                body = stream.read(80 * 1024 * 1024 + 1)
            if len(body) > 80 * 1024 * 1024:
                raise ValueError('Source response exceeds bounded size.')
            courses = normalize_courses(json.loads(body), account)
            return {'version': VERSION, 'target': target,
                'identity_fingerprint': account['identity_fingerprint'],
                'source_account_id': account['id'], 'identity_id': account['identity_id'],
                'fetched_at': datetime.now(timezone.utc).isoformat(), 'courses': courses}
        except (OSError, urllib.error.URLError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def cached_account(directory, account, target):
    path = directory / f'account-{account["id"]}.json'
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    age = datetime.now(timezone.utc) - datetime.fromisoformat(data['fetched_at'])
    if (data.get('version') != VERSION or data.get('target') != target
            or data.get('identity_fingerprint') != account['identity_fingerprint']
            or data.get('source_account_id') != account['id']
            or not 0 <= age.total_seconds() <= 24 * 3600):
        return None
    return data


def fetch_all(args):
    url, secret = configuration(args.env_file)
    if not secret:
        raise ValueError('Missing legacy API credential.')
    with connect(url) as conn:
        target = target_fingerprint(conn)
        owners, invalid = read_owners(conn.cursor())
        emit({'stage': 'target', 'database': conn.info.dbname, 'target': target,
              'mode': 'read_only', 'eligible_learners': len(owners), 'identity_review': invalid})
    accounts = {a['id']: a for owner in owners.values() for a in owner['accounts']}
    directory = Path(args.snapshot_dir)
    directory.mkdir(parents=True, exist_ok=True)
    cached = {key for key, account in accounts.items() if cached_account(directory, account, target)}
    failures = Counter()
    success = len(cached)
    emit({'stage': 'fetch', 'accounts': len(accounts), 'cached': success})
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(fetch_account, account, secret, target): key
                for key, account in accounts.items() if key not in cached}
        for job in as_completed(jobs):
            try:
                data = job.result()
                path = directory / f'account-{jobs[job]}.json'
                path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
                success += 1
            except Exception as error:
                reason = str(error) if isinstance(error, ValueError) else type(error).__name__
                failures[reason] += 1
            if (success + sum(failures.values())) % 20 == 0:
                emit({'stage': 'fetch_progress', 'verified': success,
                      'failed': sum(failures.values()), 'accounts': len(accounts)})
    result = {'stage': 'fetch_complete', 'verified_accounts': success,
              'accounts': len(accounts), 'failures': dict(failures), 'target': target}
    (directory / 'fetch-summary.json').write_text(json.dumps(result), encoding='utf-8')
    emit(result)


def completed(ref, fact):
    return fact.get('passed' if ref.startswith('quiz:') else 'completed') is True


def merged_courses(owner, directory, target):
    """Use the union of every verified alias; never interpret a failed fetch as empty."""
    courses = {}
    for account in owner['accounts']:
        snapshot = cached_account(directory, account, target)
        if snapshot is None:
            raise ValueError('Incomplete verified source accounts.')
        snapshot_fingerprint = digest(snapshot)
        for cid, course in snapshot['courses'].items():
            merged = courses.setdefault(cid, {**course, 'facts': {}, 'accounts': [], 'evidence': {}})
            merged['accounts'].append(account['id'])
            for ref, fact in course['facts'].items():
                previous = merged['facts'].get(ref)
                if previous is None or completed(ref, fact):
                    merged['facts'][ref] = fact
                    merged['evidence'][ref] = {'identity_id': account['identity_id'],
                        'source_account_id': account['id'], 'snapshot': snapshot_fingerprint,
                        'fetched_at': snapshot['fetched_at'], 'timezone': course['timezone']}
    return courses


def excluded_course_refs(courses):
    """An explicit owner exclusion survives later source catalogue recovery."""
    return {str(course['source_course_ref']) for course in courses
            if (course.get('source_payload') or {}).get('owner_exclusion', {}).get('exclude_from_learning') is True}


def membership_plan(owner, courses, catalogue, memberships):
    excluded = excluded_course_refs(catalogue)
    courses = {cid: source for cid, source in courses.items() if cid not in excluded}
    active = [m for m in memberships if m['deleted_at'] is None]
    by_id = {c['id']: c for c in catalogue}
    by_ref = {c['source_course_ref']: c for c in catalogue if c['deleted_at'] is None}
    if len(by_ref) != sum(c['deleted_at'] is None for c in catalogue):
        raise ValueError('Ambiguous course catalogue.')
    current = {by_id[m['source_course_id']]['source_course_ref']: m for m in active
               if m['source_course_id'] in by_id}
    if len(current) != sum(m['source_course_id'] in by_id for m in active):
        raise ValueError('Ambiguous active course memberships.')
    plan = {'add': [], 'archive': [], 'repair_identity': [], 'blocked': []}
    for cid, source in courses.items():
        if cid not in by_ref:
            plan['blocked'].append({'course': cid, 'reason': 'Missing active source catalogue.'})
            continue
        member = current.get(cid)
        if member is None:
            plan['add'].append({'course_id': by_ref[cid]['id'], 'course_ref': cid,
                                'source_account_id': min(source['accounts'])})
        elif member['source_relationship'] == 'historical' and (
                member['source_learner_id'] not in {str(a) for a in source['accounts']}
                or member['enrolment_id'] != owner['enrolment_id']):
            plan['repair_identity'].append({'id': member['id'], 'course_ref': cid,
                'source_account_id': min(source['accounts']),
                'previous_source_account_id': member['source_learner_id'],
                'previous_enrolment_id': member['enrolment_id']})
    for cid, member in current.items():
        # Explicit native assignments live elsewhere. Non-historical source
        # relationships also remain intact, even when absent from the old LMS.
        if cid not in courses and member['source_relationship'] == 'historical':
            plan['archive'].append(member['id'])
    return plan


def read_catalogue(cur):
    courses = cur.execute("SELECT * FROM curriculum.source_courses WHERE source_system='old_lms' ORDER BY id").fetchall()
    definitions = cur.execute("SELECT * FROM curriculum.source_activities WHERE source_system='old_lms' ORDER BY id").fetchall()
    return courses, definitions


def read_state(cur, owner):
    state = {'owner': owner}
    queries = []
    with cur.connection.pipeline():
        for key, table, column in [
                ('memberships', 'learner_source_course_memberships', 'learner_id'),
                ('progress', 'learner_progress_entries', 'learner_id'),
                ('sources', 'learner_activity_sources', 'learner_id'),
                ('segments', 'learner_activity_reporting_segments', 'learner_id'),
                ('modules', 'learner_training_plan_modules', 'learner_id'),
                ('journals', 'learner_journal_rows', 'canonical_learner_id')]:
            # Keep a hash of the complete row for preservation/concurrency checks,
            # while avoiding fetching private source bodies, answers and feedback.
            payload = "to_jsonb(t)-'source_payload'-'feedback'-'feed_detail'"
            if key == 'progress':
                payload += """||jsonb_build_object('source_payload',jsonb_build_object(
                    'original_source_ref',source_payload->'original_source_ref',
                    'course_display_placement',source_payload->'course_display_placement'))"""
            if key == 'modules':
                payload = "jsonb_build_object('id',id)"
            query = cur.connection.cursor()
            query.execute(f'''SELECT ({payload}) || jsonb_build_object('_row_hash',
                md5(to_jsonb(t)::text)) AS row FROM "Learner".{table} t
                WHERE {column}=%s ORDER BY id''', [owner['id']])
            queries.append((key, query))
    for key, query in queries:
        state[key] = [row['row'] for row in query.fetchall()]
        query.close()
    return state


def projection_scope():
    # Existing pure adapter compiles the production reader without Django
    # startup, schema helpers, database fixtures or external services.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from learner_api.test_canonical_learning_no_db import adapter
    return adapter(None)


def projected_completions(state, courses, definitions, scope, course_refs=None):
    course_by_id = {c['id']: c for c in courses if c['deleted_at'] is None}
    active_defs = {d['id']: d for d in definitions if d['deleted_at'] is None}
    sources, journals, segments = defaultdict(list), defaultdict(list), defaultdict(list)
    source_by_id = {s['id']: s for s in state['sources'] if s['deleted_at'] is None}
    progress = {p['id']: p for p in state['progress'] if p['deleted_at'] is None}
    for source in source_by_id.values():
        definition = active_defs.get(source['source_catalog_activity_id'], {})
        route = course_by_id.get(definition.get('source_course_id'), {}).get('source_course_ref')
        sources[source['canonical_progress_id']].append({**source, 'source_course_ref': route})
    for j in state['journals']:
        source, record = source_by_id.get(j['source_id']), progress.get(j['progress_id'])
        if (j['deleted_at'] is None and source and record
                and j['canonical_learner_id'] == record['learner_id'] == source['learner_id']
                and source['canonical_progress_id'] == record['id']):
            journals[record['id']].append(j)
    for segment in state['segments']:
        if segment['progress_id'] in progress:
            segments[segment['progress_id']].append(segment)
    records = [{**p, 'sources': sources[p['id']], 'journal_routes': journals[p['id']],
                'segments': segments[p['id']], 'ksbs': [],
                'completed': scope['counts_as_completed']({**p, 'sources': sources[p['id']]})}
               for p in progress.values()]
    selected = {cid: c for cid, c in course_by_id.items()
                if course_refs is None or c['source_course_ref'] in course_refs}
    catalogue = [{**d, 'source_course_ref': course_by_id[d['source_course_id']]['source_course_ref'],
                  'source_course_title': course_by_id[d['source_course_id']]['source_course_title'],
                  'curriculum_module_ref': course_by_id[d['source_course_id']]['curriculum_module_ref'],
                  'position': d['source_position']}
                 for d in active_defs.values() if d['source_course_id'] in selected]
    items, _, _ = scope['recorded_course_items'](list(selected.values()), catalogue, records, include_catalogue=True)
    result = defaultdict(set)
    for item in items:
        if item['completed']:
            _, cid, ref = item['activity_id'].split(':', 2)
            result[cid].add(ref)
    return dict(result)


def inspect_all(args):
    url, _ = configuration(args.env_file)
    directory = Path(args.snapshot_dir)
    summary = Counter()
    reports = []
    scope = projection_scope()
    with connect(url) as conn:
        target = target_fingerprint(conn)
        owners, invalid = read_owners(conn.cursor())
        catalogue, definitions = read_catalogue(conn.cursor())
        by_course = defaultdict(set)
        for d in definitions:
            if d['deleted_at'] is None:
                by_course[d['source_course_id']].add(d['source_activity_id'])
        catalogue_refs = {c['source_course_ref']: c for c in catalogue if c['deleted_at'] is None}
        summary['identity_review'] = invalid
        for owner in owners.values():
            try:
                courses = merged_courses(owner, directory, target)
            except ValueError:
                summary['unverified_learners'] += 1
                continue
            state = read_state(conn.cursor(), owner)
            member_plan = membership_plan(owner, courses, catalogue, state['memberships'])
            done = projected_completions(state, catalogue, definitions, scope, courses)
            missing = {cid: sorted(ref for ref, fact in course['facts'].items()
                        if completed(ref, fact) and ref not in done.get(cid, set()))
                       for cid, course in courses.items()}
            report = {'learner_id': owner['id'], 'memberships': member_plan,
                      'missing_completions': {cid: refs for cid, refs in missing.items() if refs}}
            reports.append(report)
            summary['verified_learners'] += 1
            summary['source_memberships'] += len(courses)
            for key in ('add', 'archive', 'repair_identity', 'blocked'):
                summary['memberships_' + key] += len(member_plan[key])
            summary['missing_completions'] += sum(map(len, missing.values()))
            summary['learners_missing_completions'] += any(missing.values())
            for cid, course in courses.items():
                existing = by_course.get(catalogue_refs.get(cid, {}).get('id'), set())
                summary['missing_catalogue_completions'] += sum(
                    completed(ref, fact) and ref not in existing for ref, fact in course['facts'].items())
            if len(reports) % 25 == 0:
                emit({'stage': 'inspection', **summary})
        output = {'target': target, 'summary': dict(summary), 'learners': reports}
        (directory / 'inspection.json').write_text(json.dumps(output), encoding='utf-8')
        emit({'stage': 'inspection_complete', 'target': target, **summary})


def activity_kind(ref, fact):
    if ref.startswith('quiz:'):
        return 'quiz'
    return {'video': 'video', 'audio': 'audio', 'pdf': 'reading', 'text': 'reading',
            'slides': 'reading', 'assignment': 'assignment', 'live': 'lecture'}.get(fact.get('material_type'))


def catalogue_plan(verified, courses, definitions):
    """Recover authored content; collapse only proven opposite-kind duplicates."""
    inventory = defaultdict(dict)
    all_refs = defaultdict(set)
    titles = {}
    excluded = excluded_course_refs(courses)
    for source in verified.values():
        for cid, course in source.items():
            if cid in excluded:
                continue
            titles[cid] = course['title']
            for ref, fact in course['facts'].items():
                all_refs[cid].add(ref)
                # Unstarted unplaced posts can be stray site content.
                if fact.get('section_id') or completed(ref, fact):
                    inventory[cid][ref] = fact
    active_courses = {c['source_course_ref']: c for c in courses if c['deleted_at'] is None}
    by_id = {c['id']: c['source_course_ref'] for c in courses}
    active_defs = {(by_id[d['source_course_id']], d['source_activity_id']): d
                   for d in definitions if d['deleted_at'] is None}
    if len(active_defs) != sum(d['deleted_at'] is None for d in definitions):
        raise ValueError('Ambiguous duplicate typed catalogue identity.')
    plan = {'courses': [], 'definitions': [], 'archive': [], 'blocked': []}
    for cid in sorted(titles):
        if cid not in active_courses:
            plan['courses'].append({'source_system': 'old_lms', 'source_course_ref': cid,
                'source_course_title': titles[cid], 'mapping_method': 'verified-legacy-account-enrolment'})
    for cid, facts in sorted(inventory.items()):
        for ref, fact in sorted(facts.items()):
            if (cid, ref) not in active_defs:
                kind = activity_kind(ref, fact)
                if not kind:
                    plan['blocked'].append({'course': cid, 'activity': ref, 'reason': 'Unsupported material type.'})
                    continue
                plan['definitions'].append({'course_ref': cid, 'source_system': 'old_lms',
                    'source_activity_id': ref, 'source_activity_kind': ref.partition(':')[0],
                    'source_activity_title': fact.get('title') or '', 'source_activity_type': kind,
                    'source_section_ref': str(fact.get('section_id') or ''),
                    'source_section_title': fact.get('section_title') or '',
                    'source_position': fact.get('component_order'),
                    'mapping_method': 'verified-legacy-course-inventory'})
    for (cid, ref), definition in active_defs.items():
        if cid in excluded:
            continue
        other = ('quiz:' if ref.startswith('material:') else 'material:') + ref.partition(':')[2]
        fact = inventory[cid].get(other)
        if (ref not in all_refs[cid] and fact and not definition['curriculum_component_ref']
                and fact.get('post_type') == ('stm-quizzes' if other.startswith('quiz:') else 'stm-lessons')):
            plan['archive'].append({'id': definition['id'], 'course_ref': cid,
                'wrong_ref': ref, 'verified_ref': other})
    return plan


def verified_sources(owners, directory, target):
    verified, blocked = {}, []
    for owner in owners.values():
        try:
            verified[owner['id']] = merged_courses(owner, directory, target)
        except ValueError:
            blocked.append(owner['id'])
    return verified, blocked


def insert_catalogue(cur, table, values):
    from psycopg import sql
    return cur.execute(sql.SQL('INSERT INTO curriculum.{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values())).fetchone()['id']


def catalogue_run(args):
    url, _ = configuration(args.env_file)
    directory = Path(args.snapshot_dir)
    with connect(url, write=args.apply) as conn:
        cur = conn.cursor()
        target = target_fingerprint(conn)
        if args.apply and target != args.expected_target:
            raise ValueError('Database target differs from preview.')
        owners, invalid = read_owners(cur)
        verified, unavailable = verified_sources(owners, directory, target)
        courses, definitions = read_catalogue(cur)
        plan = catalogue_plan(verified, courses, definitions)
        fingerprint = digest({'courses': courses, 'definitions': definitions, 'plan': plan,
                              'source': {k: digest(v) for k, v in verified.items()}})
        result = {'stage': 'catalogue', 'target': target, 'fingerprint': fingerprint,
            'courses_to_add': len(plan['courses']), 'definitions_to_add': len(plan['definitions']),
            'proven_duplicate_definitions': len(plan['archive']),
            'blocked': len(plan['blocked']), 'unverified_learners': invalid + len(unavailable)}
        if args.apply:
            if args.expected_fingerprint != fingerprint:
                raise ValueError('Catalogue or source changed since preview.')
            if invalid or unavailable:
                raise ValueError('Full source verification is required for shared catalogue changes.')
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [VERSION + ':catalogue'])
            cur.execute('SELECT id FROM curriculum.source_courses WHERE source_system=%s ORDER BY id FOR UPDATE', ['old_lms'])
            run = insert(cur, 'activity_sync_runs', {'run_key': VERSION + ':catalogue:' + fingerprint,
                'run_kind': VERSION, 'status': 'running', 'dry_run': False, 'result_counts': Jsonb(result)})
            by_ref = {c['source_course_ref']: c['id'] for c in courses if c['deleted_at'] is None}
            for course in plan['courses']:
                by_ref[course['source_course_ref']] = insert_catalogue(cur, 'source_courses', {
                    **course, 'source_payload': Jsonb({'verified_reconciliation': {'run_id': run}})})
            materials = {str(r['material_id']) for r in cur.execute('SELECT material_id FROM curriculum.source_materials').fetchall()}
            # A single network flush for many independent definitions.
            with conn.pipeline():
                for definition in plan['definitions']:
                    values = {k: v for k, v in definition.items() if k != 'course_ref'}
                    values['source_course_id'] = by_ref[definition['course_ref']]
                    values['source_payload'] = Jsonb({'verified_reconciliation': {'run_id': run}})
                    ref = definition['source_activity_id']
                    if ref.startswith('material:') and ref.partition(':')[2] in materials:
                        values['source_material_id'] = int(ref.partition(':')[2])
                    from psycopg import sql
                    conn.execute(sql.SQL('INSERT INTO curriculum.source_activities ({}) VALUES ({})').format(
                        sql.SQL(',').join(map(sql.Identifier, values)),
                        sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values()))
            final_courses, final_defs = read_catalogue(cur)
            old = {d['id']: d for d in definitions}
            if any(old[d['id']] != d for d in final_defs if d['id'] in old):
                raise ValueError('Existing catalogue history changed.')
            pending = catalogue_plan(verified, final_courses, final_defs)
            if pending['courses'] or pending['definitions']:
                raise ValueError('Catalogue additions did not reconcile.')
            result.update(applied=True, audit_run=run)
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run])
        (directory / 'catalogue-preview.json').write_text(json.dumps({'result': result, 'plan': plan}), encoding='utf-8')
        emit(result)


def completion_plan(state, verified, courses, definitions, scope, *, course_scoped=False):
    excluded = excluded_course_refs(courses)
    verified = {cid: source for cid, source in verified.items() if cid not in excluded}
    by_ref = {c['source_course_ref']: c for c in courses if c['deleted_at'] is None}
    defs = {(d['source_course_id'], d['source_activity_id']): d for d in definitions if d['deleted_at'] is None}
    def_by_id = {d['id']: d for d in definitions if d['deleted_at'] is None}
    course_by_id = {c['id']: c for c in courses if c['deleted_at'] is None}
    by_source = {s['source_activity_id']: s for s in state['sources']
                 if s['source_system'] == 'old_lms' and s['deleted_at'] is None}
    progress = {p['id']: p for p in state['progress'] if p['deleted_at'] is None}
    done = projected_completions(state, courses, definitions, scope, verified)
    source_courses = defaultdict(set)
    for cid, course in verified.items():
        for ref in course['facts']:
            source_courses[ref].add(cid)
    plan = {'add': [], 'update': [], 'blocked': [], 'before': {k: sorted(v) for k, v in done.items()}}
    order = max((p['entry_order'] for p in state['progress']), default=0)
    for cid, course in sorted(verified.items()):
        for ref, fact in sorted(course['facts'].items()):
            if not completed(ref, fact) or ref in done.get(cid, set()):
                continue
            definition = defs.get((by_ref.get(cid, {}).get('id'), ref))
            reason = None
            if definition is None:
                reason = 'Missing catalogue definition.'
            elif not course_scoped and source_courses[ref] != {cid}:
                reason = 'Shared component needs course-specific source identity.'
            source_ref = f'course:{cid}:{ref}' if course_scoped else ref
            source = by_source.get(source_ref)
            if source:
                current_course = course_by_id.get(def_by_id.get(source['source_catalog_activity_id'], {}).get('source_course_id'), {}).get('source_course_ref')
                if source['canonical_progress_id'] not in progress:
                    reason = 'Existing source points to retired or absent progress.'
                elif current_course in verified and current_course != cid:
                    reason = 'Retained source belongs to another verified course.'
                elif current_course is None:
                    pid = source['canonical_progress_id']
                    retained = projected_completions({**state,
                        'progress': [progress[pid]]}, courses, definitions, scope, verified)
                    if any(refs - ({ref} if other == cid else set()) for other, refs in retained.items()):
                        reason = 'Unrouted source shares retained journal completion placements.'
            if reason:
                plan['blocked'].append({'course': cid, 'activity': ref, 'reason': reason})
                continue
            evidence = {**course['evidence'][ref], 'fact': fact, 'course_ref': cid}
            if source:
                plan['update'].append({'id': source['id'], 'course_ref': cid, 'activity_ref': ref,
                    **({'source_ref': source_ref} if course_scoped else {}),
                    'definition_id': definition['id'], 'evidence': evidence,
                    'previous': {k: source[k] for k in ('source_catalog_activity_id', 'source_course_ref',
                        'completed', 'activity_status', '_row_hash')}})
            else:
                opposite = ('quiz:' if ref.startswith('material:') else 'material:') + ref.partition(':')[2]
                prior_source = by_source.get(opposite)
                prior_definition = def_by_id.get((prior_source or {}).get('source_catalog_activity_id'), {})
                reusable = (prior_source and prior_source['canonical_progress_id'] in progress
                    and prior_definition.get('source_course_id') == definition['source_course_id']
                    and not prior_definition.get('curriculum_component_ref')
                    and opposite not in course['facts']
                    and fact.get('post_type') == ('stm-quizzes' if ref.startswith('quiz:') else 'stm-lessons'))
                prior = progress[prior_source['canonical_progress_id']] if reusable else None
                if prior is None:
                    order += 1
                started = source_instant(fact['started_at'], evidence['timezone']) if fact.get('started_at') else None
                ended = source_instant(fact['completed_at'], evidence['timezone']) if fact.get('completed_at') else None
                if started and ended and ended < started:
                    plan['blocked'].append({'course': cid, 'activity': ref, 'reason': 'Source time order needs review.'})
                    continue
                plan['add'].append({'course_ref': cid, 'activity_ref': ref, 'definition_id': definition['id'],
                    **({'source_ref': source_ref} if course_scoped else {}),
                    'evidence': evidence, 'entry_order': order, 'kind': activity_kind(ref, fact),
                    'existing_progress_id': prior['id'] if prior else None,
                    'existing_activity_key': prior.get('canonical_activity_key') if prior else None,
                    'started_at': started, 'submitted_at': ended,
                    'module_ref': by_ref[cid]['curriculum_module_ref'],
                    'module_title': by_ref[cid]['source_course_title']})
    return plan


def apply_memberships(cur, owner, plan, run):
    for item in plan['add']:
        insert(cur, 'learner_source_course_memberships', {'learner_id': owner['id'],
            'enrolment_id': owner['enrolment_id'], 'source_course_id': item['course_id'],
            'source_learner_id': str(item['source_account_id']), 'source_relationship': 'historical',
            'source_payload': Jsonb({'verified_reconciliation': {'run_id': run, **item}})})
    for item in plan['repair_identity']:
        cur.execute('''UPDATE "Learner".learner_source_course_memberships SET source_learner_id=%s,
            enrolment_id=%s,source_payload=source_payload||%s::jsonb WHERE id=%s AND learner_id=%s
            AND deleted_at IS NULL AND source_relationship='historical' ''',
            [str(item['source_account_id']), owner['enrolment_id'],
             Jsonb({'verified_reconciliation': {'run_id': run, **item}}), item['id'], owner['id']])
        if cur.rowcount != 1:
            raise ValueError('Membership identity changed during reconciliation.')
    for ident in plan['archive']:
        cur.execute('''UPDATE "Learner".learner_source_course_memberships SET deleted_at=now(),
            source_payload=source_payload||%s::jsonb WHERE id=%s AND learner_id=%s
            AND deleted_at IS NULL AND source_relationship='historical' ''',
            [Jsonb({'verified_reconciliation': {'run_id': run,
                'reason': 'Absent from the verified union of all linked legacy account enrolments.'}}), ident, owner['id']])
        if cur.rowcount != 1:
            raise ValueError('Membership changed during reconciliation.')


def apply_completions(cur, owner, plan, run):
    from psycopg import sql
    scope = {k: owner[k] for k in ('enrolment_id', 'programme_id', 'aptem_id')}
    def queued_insert(table, values):
        query = cur.connection.cursor()
        query.execute(sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
            sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
            sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values()))
        return query
    pending = []
    inserted = []
    with cur.connection.pipeline():
        for item in plan['add']:
            status = 'passed' if item['activity_ref'].startswith('quiz:') else 'completed'
            key = f"old_lms:{owner['id']}:{item['course_ref']}:{item['activity_ref']}:verified-recovery"
            evidence = {'run_id': run, **item['evidence'], 'actual_time_verified': False}
            if item.get('existing_progress_id') is not None:
                inserted.append((item, item.get('existing_activity_key') or key, status, evidence, item['existing_progress_id']))
                continue
            values = {**scope, 'learner_id': owner['id'], 'entry_order': item['entry_order'],
                'kind': item['kind'], 'component_type': item['kind'], 'component_ref': item['activity_ref'],
                'component_title': item['evidence']['fact'].get('title') or '',
                'source_system': 'old_lms', 'source_activity_id': item.get('source_ref', item['activity_ref']),
                'canonical_activity_key': key, 'module_ref': item['module_ref'],
                'module_title': item['module_title'], 'activity_status': status,
                'accepted': False, 'actual_seconds': None, 'started_at': item['started_at'],
                'submitted_at': item['submitted_at'], 'actual_basis': 'completion-confirmed-time-unverified',
                'source_payload': Jsonb({'verified_reconciliation': evidence}), 'sync_run_id': run}
            pending.append((item, key, status, evidence, queued_insert('learner_progress_entries', values)))
    inserted.extend((item, key, status, evidence, query.fetchone()['id']) for item, key, status, evidence, query in pending)
    with cur.connection.pipeline():
        for item, key, status, evidence, progress_id in inserted:
            queued_insert('learner_activity_sources', {**scope, 'learner_id': owner['id'],
                'source_system': 'old_lms', 'source_activity_id': item.get('source_ref', item['activity_ref']),
                'source_course_ref': item['course_ref'], 'source_catalog_activity_id': item['definition_id'],
                'canonical_progress_id': progress_id, 'canonical_activity_key': key,
                'activity_type': item['kind'], 'title': item['evidence']['fact'].get('title') or '',
                'completed': True, 'activity_status': status, 'accepted': False, 'actual_seconds': None,
                'actual_basis': 'completion-confirmed-time-unverified', 'sync_run_id': run,
                'source_payload': Jsonb({'verified_reconciliation': evidence}), 'source_fingerprint': digest(evidence)})
        for item in plan['update']:
            cur.connection.execute('''UPDATE "Learner".learner_activity_sources SET
                source_course_ref=%s,source_catalog_activity_id=%s,completed=true,activity_status=%s,
                source_payload=source_payload||%s::jsonb WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                [item['course_ref'], item['definition_id'],
                 'passed' if item['activity_ref'].startswith('quiz:') else 'completed',
                 Jsonb({'verified_reconciliation': {'run_id': run, **item['evidence'], 'previous': item['previous']}}),
                 item['id'], owner['id']])


def verify_owner(before, after, members, completions, courses, definitions, scope, verified):
    for key in ('progress', 'journals', 'segments', 'modules'):
        old = {r['id']: r['_row_hash'] for r in before[key]}
        new = {r['id']: r['_row_hash'] for r in after[key] if r['id'] in old}
        if old != new:
            raise ValueError('Historical records or native assignments changed.')
        if key != 'progress' and len(after[key]) != len(before[key]):
            raise ValueError('Unexpected journal, segment or native assignment count.')
    changed_sources = {r['id'] for r in completions['update']}
    for key, allowed in [('sources', changed_sources), ('memberships', set(members['archive']) |
                         {r['id'] for r in members['repair_identity']})]:
        old = {r['id']: r['_row_hash'] for r in before[key] if r['id'] not in allowed}
        new = {r['id']: r['_row_hash'] for r in after[key] if r['id'] in old}
        if old != new:
            raise ValueError('Unrelated source or membership changed.')
    old_sources = {s['id']: s for s in before['sources']}
    allowed_fields = {'source_course_ref', 'source_catalog_activity_id', 'completed',
                      'activity_status', '_row_hash'}
    for source in after['sources']:
        if source['id'] in changed_sources:
            previous = old_sources[source['id']]
            if {k: v for k, v in source.items() if k not in allowed_fields} != {
                    k: v for k, v in previous.items() if k not in allowed_fields}:
                raise ValueError('Source hours or ownership changed beyond verified completion routing.')
    originals = {p['id'] for p in before['progress']}
    added = [p for p in after['progress'] if p['id'] not in originals]
    if len(added) != sum(p.get('existing_progress_id') is None for p in completions['add']) or any(p['accepted'] or p['actual_seconds'] is not None for p in added):
        raise ValueError('Unexpected new progress or hours.')
    if len(after['sources']) != len(before['sources']) + len(completions['add']):
        raise ValueError('Unexpected source count.')
    pending_members = membership_plan(after['owner'], verified, courses, after['memberships'])
    if any(pending_members[k] for k in ('add', 'archive', 'repair_identity')):
        raise ValueError('Membership verification failed.')
    actual = projected_completions(after, courses, definitions, scope, verified)
    for cid, refs in completions['before'].items():
        if not set(refs) <= actual.get(cid, set()):
            raise ValueError('A retained course lost recorded completion.')
    for item in [*completions['add'], *completions['update']]:
        if item['activity_ref'] not in actual.get(item['course_ref'], set()):
            raise ValueError('Recovered completion does not appear in My Learning.')
    return actual


def learners_run(args):
    url, _ = configuration(args.env_file)
    directory = Path(args.snapshot_dir)
    scope = projection_scope()
    with connect(url) as conn:
        target = target_fingerprint(conn)
        owners, invalid = read_owners(conn.cursor())
        courses, definitions = read_catalogue(conn.cursor())
    if args.apply and target != args.expected_target:
        raise ValueError('Database target differs from preview.')
    verified, unavailable = verified_sources(owners, directory, target)
    manifest_name = 'learners-course-scoped' if args.course_scoped else 'learners'
    manifest_path = directory / f'{manifest_name}-preview.json'
    expected = json.loads(manifest_path.read_text()) if args.apply else None
    if args.apply and (expected['fingerprint'] != args.expected_fingerprint or expected['target'] != target
                       or expected.get('course_scoped', False) != args.course_scoped):
        raise ValueError('Preview manifest differs from requested apply.')
    verified, output_name = learner_partition(verified, manifest_name, args.partition, args.partitions)
    if args.partitions > 1:
        emit({'stage': 'partition_started', 'partition': args.partition,
              'partitions': args.partitions, 'learners': len(verified)})
    reports, summary = {}, Counter(identity_review=invalid, unverified_learners=len(unavailable))
    writer = None
    if args.apply:
        writer = psycopg.connect(url, connect_timeout=10, row_factory=dict_row, autocommit=True)
        writer.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    def prefetch(owner):
        with connect(url) as conn:
            return read_state(conn.cursor(), owner)

    def work_items():
        if args.apply:
            for ident, source in verified.items():
                yield ident, source, None
            return
        # Bounded independent read-only transactions. Writes below stay serial.
        items = iter(verified.items())
        with ThreadPoolExecutor(max_workers=3) as pool:
            queue = []
            def enqueue():
                item = next(items, None)
                if item:
                    ident, source = item
                    queue.append((ident, source, pool.submit(prefetch, owners[ident])))
            for _ in range(3):
                enqueue()
            while queue:
                ident, source, future = queue.pop(0)
                yield ident, source, future.result()
                enqueue()

    for ident, source, prefetched in work_items():
        if args.limit and len(reports) >= args.limit:
            break
        with learner_transaction(writer) as conn:
            cur = conn.cursor() if conn else None
            if args.apply:
                # Cooperate with the application's canonical writer and fail on
                # concurrent row changes instead of overwriting learner activity.
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s)", [ident])
                cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [ident])
                current_owners, _ = read_owners(cur)
                if current_owners.get(ident) != owners[ident]:
                    raise ValueError('Source identity changed after preview.')
            state = read_state(cur, owners[ident]) if args.apply else prefetched
            members = membership_plan(owners[ident], source, courses, state['memberships'])
            completions = completion_plan(state, source, courses, definitions, scope, course_scoped=args.course_scoped)
            fingerprint = digest({'state': state, 'source': source, 'members': members, 'completions': completions})
            report = {'fingerprint': fingerprint, 'memberships_added': len(members['add']),
                'memberships_archived': len(members['archive']), 'identity_links_repaired': len(members['repair_identity']),
                'completions_added': len(completions['add']), 'completions_relinked': len(completions['update']),
                'blocked': members['blocked'] + completions['blocked']}
            actions = sum(report[k] for k in ('memberships_added', 'memberships_archived',
                'identity_links_repaired', 'completions_added', 'completions_relinked'))
            if args.apply and actions:
                if expected['learners'].get(str(ident), {}).get('fingerprint') != fingerprint:
                    raise ValueError('Learner evidence changed since preview; create a fresh preview.')
                # Lock the exact existing rows before altering their routes.
                cur.execute('SELECT id FROM "Learner".learner_activity_sources WHERE learner_id=%s ORDER BY id FOR UPDATE', [ident])
                cur.execute('SELECT id FROM "Learner".learner_source_course_memberships WHERE learner_id=%s ORDER BY id FOR UPDATE', [ident])
                run = insert(cur, 'activity_sync_runs', {'run_key': VERSION + ':learner:' + fingerprint,
                    'run_kind': VERSION, 'status': 'running', 'dry_run': False,
                    'source_counts': Jsonb({'learner_id': ident, 'verified_source_digest': digest(source)}),
                    'result_counts': Jsonb(report)})
                apply_memberships(cur, owners[ident], members, run)
                apply_completions(cur, owners[ident], completions, run)
                after = read_state(cur, owners[ident])
                verify_owner(state, after, members, completions, courses, definitions, scope, source)
                report.update(applied=True, audit_run=run, historical_rows_preserved=True,
                              native_assignments_preserved=True, added_accepted_seconds=0)
                cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                    updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(report), run])
            reports[ident] = report
            summary['learners_checked'] += 1
            summary['learners_changed' if args.apply else 'learners_with_changes'] += bool(actions)
            for key in ('memberships_added', 'memberships_archived', 'identity_links_repaired',
                        'completions_added', 'completions_relinked'):
                summary[key] += report[key]
            summary['blocked_items'] += len(report['blocked'])
        # Persist committed per-learner results; a later failure remains resumable.
        output = {'target': target, 'course_scoped': args.course_scoped, 'summary': dict(summary), 'learners': reports}
        output['fingerprint'] = digest(output)
        path = directory / (output_name + ('-applied.json' if args.apply else '-preview.json'))
        path.write_text(json.dumps(output, default=str), encoding='utf-8')
        if len(reports) % 10 == 0:
            emit({'stage': 'apply' if args.apply else 'preview', **summary})
    if writer is not None:
        writer.close()
    emit({'stage': 'learners_complete', 'target': target, 'fingerprint': output['fingerprint'], **summary})


def learner_partition(verified, manifest_name, index, count):
    """Disjoint learner transactions; all partitions use the same approved manifest.

    Partition by stable learner ID, not query order, and keep output files separate.
    This changes execution selection only; evidence fingerprints, locks, writes,
    post-write invariants and per-learner commits remain identical.
    """
    if not 1 <= count <= 8 or not 0 <= index < count:
        raise ValueError('Invalid learner partition; count must be 1..8 and index 0..count-1.')
    selected = {ident: source for ident, source in verified.items() if ident % count == index}
    name = manifest_name if count == 1 else f'{manifest_name}-partition-{index}-of-{count}'
    return selected, name


def archive_duplicates(args):
    url, _ = configuration(args.env_file)
    directory = Path(args.snapshot_dir)
    with connect(url, write=args.apply) as conn:
        cur = conn.cursor()
        target = target_fingerprint(conn)
        owners, invalid = read_owners(cur)
        verified, unavailable = verified_sources(owners, directory, target)
        if invalid or unavailable:
            raise ValueError('All source identities must be verified before catalogue cleanup.')
        courses, definitions = read_catalogue(cur)
        plan = catalogue_plan(verified, courses, definitions)
        if plan['courses'] or plan['definitions'] or plan['blocked']:
            raise ValueError('Restore the verified catalogue before archiving duplicates.')
        items = plan['archive']
        active = {(c['source_course_ref'], d['source_activity_id']): d for c in courses
                  if c['deleted_at'] is None for d in definitions
                  if d['source_course_id'] == c['id'] and d['deleted_at'] is None}
        course_ids = {active[(i['course_ref'], i['verified_ref'])]['source_course_id'] for i in items}
        unknown = cur.execute('''SELECT count(*) AS n FROM "Learner".learner_source_course_memberships
            WHERE source_course_id=ANY(%s) AND deleted_at IS NULL AND NOT (learner_id=ANY(%s))''',
            [sorted(course_ids), list(verified)]).fetchone()['n']
        if unknown:
            raise ValueError('An affected course has an unverified learner membership.')
        fingerprint = digest({'target': target, 'definitions': definitions, 'items': items,
                              'source': {k: digest(v) for k, v in verified.items()}})
        result = {'stage': 'duplicate_catalogue', 'target': target, 'fingerprint': fingerprint,
                  'definitions_to_archive': len(items), 'affected_courses': len(course_ids)}
        if args.apply:
            if target != args.expected_target or fingerprint != args.expected_fingerprint:
                raise ValueError('Catalogue or source changed since the reviewed preview.')
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [VERSION + ':catalogue'])
            cur.execute('SELECT id FROM curriculum.source_courses WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [sorted(course_ids)])
            run = insert(cur, 'activity_sync_runs', {'run_key': VERSION + ':duplicate-types:' + fingerprint,
                'run_kind': VERSION, 'status': 'running', 'dry_run': False, 'result_counts': Jsonb(result)})
            ids = [i['id'] for i in items]
            cur.execute('''UPDATE curriculum.source_activities SET deleted_at=now(),
                source_payload=source_payload||%s::jsonb WHERE id=ANY(%s) AND deleted_at IS NULL
                AND coalesce(curriculum_component_ref,'')='' ''',
                [Jsonb({'verified_reconciliation': {'run_id': run,
                    'reason': 'Opposite typed duplicate contradicted by verified source post type.'}}), ids])
            if cur.rowcount != len(ids):
                raise ValueError('A duplicate definition changed during cleanup.')
            _, final_defs = read_catalogue(cur)
            if len(final_defs) != len(definitions):
                raise ValueError('Catalogue history count changed during cleanup.')
            retained = {d['id']: d for d in definitions if d['id'] not in ids}
            if any(retained[d['id']] != d for d in final_defs if d['id'] in retained):
                raise ValueError('An unrelated definition changed.')
            if any(d['deleted_at'] is None for d in final_defs if d['id'] in ids):
                raise ValueError('Duplicate catalogue cleanup did not verify.')
            result.update(applied=True, audit_run=run, records_deleted=0)
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
                updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run])
        (directory / 'duplicates-preview.json').write_text(json.dumps({'result': result, 'items': items}), encoding='utf-8')
        emit(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['fetch', 'inspect', 'catalogue', 'learners', 'archive-duplicates'])
    parser.add_argument('--env-file', required=True)
    parser.add_argument('--snapshot-dir', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    parser.add_argument('--limit', type=int)
    parser.add_argument('--partitions', type=int, default=1,
        help='Split learner IDs into up to 8 disjoint groups using one reviewed manifest.')
    parser.add_argument('--partition', type=int, default=0,
        help='Zero-based learner group to execute; each group writes a separate result file.')
    parser.add_argument('--course-scoped', action='store_true',
        help='Requires the reviewed course-qualified canonical reader to be deployed before apply.')
    args = parser.parse_args()
    if args.apply and (not args.expected_target or not args.expected_fingerprint):
        parser.error('Apply requires the preview target and fingerprint.')
    if args.partitions != 1 or args.partition != 0:
        if args.phase != 'learners':
            parser.error('Partitions are supported only for learner reconciliation.')
        learner_partition({}, '', args.partition, args.partitions)
    {'fetch': fetch_all, 'inspect': inspect_all, 'catalogue': catalogue_run,
     'learners': learners_run, 'archive-duplicates': archive_duplicates}[args.phase](args)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'stage': 'failed', 'error_type': type(error).__name__,
              'reason': str(error) if isinstance(error, ValueError) else None,
              'sqlstate': getattr(error, 'sqlstate', None)})
        raise SystemExit(1)
