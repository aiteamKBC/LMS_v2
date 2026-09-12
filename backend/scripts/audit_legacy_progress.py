"""Read-only reconciliation of every enrolled learner against the original LMS.

Run from backend: .venv/Scripts/python scripts/audit_legacy_progress.py --fetch
Snapshots contain no API credentials or quiz answers and stay under .cache.
PostgreSQL connections enforce read-only transactions. Only HTTP GET is used.
"""
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import sys
import time
import urllib.request
from urllib.parse import urlsplit

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
os.environ['CURRICULUM_WARM'] = '0'
from config import settings as config

CACHE = ROOT / '.cache' / 'legacy-progress-audit'
MAX_BYTES = 80 * 1024 * 1024


def connect(alias):
    cfg = config.DATABASES[alias]
    connection = psycopg.connect(host=cfg['HOST'], port=cfg.get('PORT') or 5432,
        dbname=cfg['NAME'], user=cfg['USER'], password=cfg['PASSWORD'],
        sslmode=cfg.get('OPTIONS', {}).get('sslmode', 'require'),
        connect_timeout=10, row_factory=dict_row)
    connection.read_only = True
    with connection.cursor() as cur:
        cur.execute("SET LOCAL statement_timeout = '60s'")
    return connection


def save(name, value):
    CACHE.mkdir(parents=True, exist_ok=True)
    with gzip.open(CACHE / (name + '.json.gz'), 'wt', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, default=str)


def load(name):
    with gzip.open(CACHE / (name + '.json.gz'), 'rt', encoding='utf-8') as stream:
        return json.load(stream)


class SameOrigin(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(req.full_url)[:2] != urlsplit(newurl)[:2]:
            raise ValueError('Cross-origin redirect refused')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_page(page):
    request = urllib.request.Request(f'{config.KBC_LMS_SCHEMA_URL}?page={page}&per_page=20', headers={
        'X-KBC-API-Key': config.KBC_LMS_API_KEY, 'Accept': 'application/json',
        'Accept-Encoding': 'gzip', 'User-Agent': 'KBC-Progress-Verification/1.0',
    })
    for attempt in range(3):
        try:
            with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
                stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
                body = stream.read(MAX_BYTES + 1)
            if len(body) > MAX_BYTES:
                raise ValueError('Oversized source page')
            payload = json.loads(body)
            pagination = payload.get('pagination') or {}
            if pagination.get('page') != page or pagination.get('per_page') != 20 or not isinstance(payload.get('groups'), list):
                raise ValueError('Source did not honour pagination')
            return payload
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def compact_page(payload, allowed_ids, allowed_emails):
    """Preserve identity, content inventory and raw result facts, not answers."""
    groups, roster = [], {}
    for group in payload['groups']:
        learners = []
        for learner in group.get('learners', []):
            ident = learner['learner_id']
            roster[str(ident)] = payload['pagination']['page']
            if ident not in allowed_ids and str(learner.get('learner_email') or '').strip().casefold() not in allowed_emails:
                continue
            results = []
            for result in learner.get('activity_results', []):
                item = {key: result.get(key) for key in ('activity_id', 'status')}
                for key, fields in [('video_result', ('started', 'completed')),
                                    ('reading_result', ('viewed',)),
                                    ('quiz_result', ('attempted', 'passed', 'score', 'maximum_score', 'attempt_number'))]:
                    item[key] = {field: (result.get(key) or {}).get(field) for field in fields}
                results.append(item)
            learners.append({key: learner.get(key) for key in ('learner_id', 'learner_name', 'learner_email')} | {'activity_results': results})
        if not learners:
            continue
        activities = []
        for activity in group.get('activities', []):
            item = {key: activity.get(key) for key in ('activity_id', 'activity_type', 'title', 'activity_date')}
            for key in ('video', 'audio', 'reading'):
                value = activity.get(key) or {}
                item[key] = {field: ('present' if value.get(field) else None) for field in ('iframe_url', 'text_body')}
                if key == 'reading':
                    item[key]['reading_type'] = value.get('reading_type')
            quiz = activity.get('quiz') or {}
            item['quiz'] = {key: quiz.get(key) for key in ('quiz_id', 'passing_score', 'maximum_score')}
            item['quiz']['questions'] = [{}] if quiz.get('questions') else []
            item['question_count'] = len(quiz.get('questions') or [])
            activities.append(item)
        groups.append({'group_id': group['group_id'], 'group_name': group.get('group_name'),
                       'activities': activities, 'learners': learners})
    return {'pagination': payload['pagination'], 'generated_at_utc': payload.get('generated_at_utc'),
            'fetched_at': datetime.now(timezone.utc).isoformat(), 'groups': groups, 'roster_pages': roster}


def fetch_snapshot():
    with connect('enrolment') as conn, conn.cursor() as cur:
        cur.execute('''SELECT id,"Username" AS name,"Email" AS email,aptem_id,
            "Programme" AS programme,"Cohort" AS cohort,"Group" AS group_name,
            "Programme_status" AS programme_status,"Learning_plan" AS learning_plan,
            "Training_plan" AS training_plan FROM enrolment."Created_users" ORDER BY id''')
        learners = cur.fetchall()
        save('enrolment', learners)
    aptem_ids = sorted({int(row['aptem_id']) for row in learners if str(row['aptem_id'] or '').strip().isdigit()})
    with connect('audit') as conn, conn.cursor() as cur:
        cur.execute('''SELECT l.aptem_id,l.learner_id AS canonical_id,l.learner_email AS email,
            coalesce(a.lms_learner_id,l.learner_id) AS source_id,
            CASE WHEN a.lms_learner_id IS NULL THEN l.learner_email ELSE a.lms_email END AS source_email
            FROM "Last_audit".learners l LEFT JOIN "Last_audit".learner_lms_aliases a
              ON a.aptem_id=l.aptem_id AND a.canonical_lms_id=l.learner_id
            WHERE l.aptem_id=ANY(%s)''', [aptem_ids])
        identities = cur.fetchall()
        save('identities', identities)
    allowed_ids = {int(row['source_id']) for row in identities if row['source_id'] is not None}
    allowed_emails = {str(row['email'] or '').strip().casefold() for row in learners if row['email']}
    # The initial probe is from this audit, and can seed page 1 without another
    # expensive request. It is removed after compacting into the ignored cache.
    probe = ROOT / 'tmp' / 'legacy-progress-audit' / 'page-1.json'
    first = json.loads(probe.read_bytes()) if probe.exists() else fetch_page(1)
    save('page-1', compact_page(first, allowed_ids, allowed_emails))
    total = first['pagination']['total_pages']
    print(json.dumps({'stage': 'fetch', 'learners': len(learners), 'source_pages': total}), flush=True)
    failures = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(fetch_page, page): page for page in range(2, total + 1)
                if not (CACHE / f'page-{page}.json.gz').exists()}
        for job in as_completed(jobs):
            page = jobs.pop(job)
            try:
                result = compact_page(job.result(), allowed_ids, allowed_emails)
                save(f'page-{page}', result)
                print(json.dumps({'page': page, 'matched_groups': len(result['groups'])}), flush=True)
            except Exception as exc:
                failures.append({'page': page, 'error_type': type(exc).__name__})
                print(json.dumps(failures[-1]), flush=True)
    save('fetch-summary', {'total_pages': total, 'failures': failures,
                          'finished_at': datetime.now(timezone.utc).isoformat()})
    if failures:
        raise SystemExit('Source pages failed; rerun --fetch to retry only missing pages.')


def database_snapshot():
    learners = load('enrolment')
    ids = [row['id'] for row in learners]
    aptem_ids = sorted({int(row['aptem_id']) for row in learners if str(row['aptem_id'] or '').strip().isdigit()})
    with connect('audit') as conn, conn.cursor() as cur:
        cur.execute('''SELECT l.aptem_id,gl.group_id,g.group_name FROM "Last_audit".learners l
            JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
            JOIN "Last_audit".groups g ON g.group_id=gl.group_id WHERE l.aptem_id=ANY(%s)''', [aptem_ids])
        save('audit-memberships', cur.fetchall())
        cur.execute('''SELECT l.aptem_id,l.learner_id,gl.group_id,g.group_name,ga.activity_id,ga.position,
            coalesce(a.activity_type,r.activity_type) AS activity_type,a.title,a.activity_date,a.reading_type,
            CASE WHEN nullif(a.reading_iframe_url,'') IS NOT NULL THEN 'present' END AS reading_iframe_url,
            a.quiz_id,CASE WHEN jsonb_typeof(a.quiz_questions)='array' AND a.quiz_questions<>'[]'::jsonb THEN '[{}]'::jsonb ELSE '[]'::jsonb END AS quiz_questions,
            r.status,r.video_completed,r.reading_viewed,r.quiz_passed,r.quiz_attempted,r.video_started,
            r.quiz_score,coalesce(r.quiz_maximum_score,a.quiz_maximum_score) AS quiz_maximum_score
            FROM "Last_audit".learners l JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
            JOIN "Last_audit".groups g ON g.group_id=gl.group_id
            JOIN "Last_audit".group_activities ga ON ga.group_id=gl.group_id
            JOIN "Last_audit".activities a ON a.activity_id=ga.activity_id
            LEFT JOIN "Last_audit".activity_results r ON r.learner_id=l.learner_id AND r.group_id=gl.group_id AND r.activity_id=ga.activity_id
            WHERE l.aptem_id=ANY(%s)''', [aptem_ids])
        activities = cur.fetchall()
        save('audit-activities', activities)
        print(json.dumps({'stage': 'database', 'historical_placements': len(activities)}), flush=True)
    with connect('enrolment') as conn, conn.cursor() as cur:
        cur.execute('''SELECT enrolment_id,aptem_id,group_id,activity_id,kind,completed,passed,score_percent,submitted_at
            FROM "Learner".subject_activity_attempts WHERE enrolment_id=ANY(%s) AND submitted_at IS NOT NULL''', [ids])
        save('local-attempts', cur.fetchall())
        cur.execute('''SELECT l.enrolment_id,p.kind,p.component_ref,p.quiz_ref,p.module_ref,p.module_title,p.group_ref,
            p.component_link_source,p.passed FROM "Learner".learners l
            JOIN "Learner".learner_progress_entries p ON p.learner_id=l.id WHERE l.enrolment_id=ANY(%s)''', [ids])
        save('native-progress', cur.fetchall())
        cur.execute('''SELECT module_catalogue_id AS id,title,deleted_at,deleted_via_parent FROM curriculum.modules''')
        save('native-modules', cur.fetchall())
        cur.execute('''SELECT c.id,c.module_catalogue_id AS module_id,c.title,c.type,c.week_id,
            c.deleted_at,c.deleted_via_parent,coalesce((SELECT q.quiz_id::text FROM curriculum.quiz_component_links q WHERE q.component_id=c.id ORDER BY q.id LIMIT 1),c.settings_json->>'linkedQuizId') AS quiz_id
            FROM curriculum.components c''')
        save('native-components', cur.fetchall())
        cur.execute('''WITH exports AS (
            SELECT course_id,CASE WHEN jsonb_typeof(curriculum)='string'
                THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
            FROM "MBA".course_curriculum)
            SELECT course_id AS group_id,material->>'source_component_id' AS activity_id,
                   material->>'component_id' AS component_id
            FROM exports CROSS JOIN LATERAL jsonb_array_elements(payload->'sections') section
            CROSS JOIN LATERAL jsonb_array_elements(section->'materials') material''')
        save('source-links', cur.fetchall())
    print(json.dumps({'stage': 'database', 'complete': True}), flush=True)


def analyse_snapshot():
    """Exercise production identity selection and completion logic offline.

    All DB aliases are replaced before Django starts. Neither learner endpoints
    (which can synchronize profiles) nor a Django test database is invoked.
    """
    from collections import Counter
    from unittest.mock import MagicMock, patch
    from django.conf import settings
    settings.DATABASES = {alias: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
                          for alias in config.DATABASES}
    import django
    django.setup()
    from audit_api.last_audit_ledger_views import _is_completed
    from learner_api import subject_source, subject_store
    from learner_api.dashboard_metrics import programme_totals
    from learner_api.progress_rules import progress_counts_as_achieved

    summary = load('fetch-summary')
    if summary['failures']:
        raise ValueError('Finish fetching every page before auditing')
    pages = {n: load(f'page-{n}') for n in range(1, summary['total_pages'] + 1)}
    learners = load('enrolment')
    identities, historical, memberships, attempts = (defaultdict(list) for _ in range(4))
    source_by_id, source_by_email, roster = defaultdict(list), defaultdict(set), defaultdict(set)
    for identity in load('identities'):
        identities[int(identity['aptem_id'])].append(identity)
    for row in load('audit-activities'):
        historical[int(row['aptem_id'])].append(row)
    for row in load('audit-memberships'):
        memberships[int(row['aptem_id'])].append(row)
    for row in load('local-attempts'):
        attempts[row['enrolment_id']].append(row)
    for number, page in pages.items():
        for ident in page['roster_pages']:
            roster[ident].add(number)
        for group in page['groups']:
            for learner in group['learners']:
                source_by_id[learner['learner_id']].append((number, group, learner))
                source_by_email[str(learner['learner_email'] or '').strip().casefold()].add(learner['learner_id'])
    routing = subject_source.hints()
    modules = {m['id']: m for m in load('native-modules') if m['deleted_at'] is None or m['deleted_via_parent'] is not None}
    components = defaultdict(list)
    for c in load('native-components'):
        if c['deleted_at'] is None or c['deleted_via_parent'] is not None:
            components[c['module_id']].append(c)
    native_progress = defaultdict(list)
    for p in load('native-progress'):
        if p['kind'] != 'activity_event':
            native_progress[p['enrolment_id']].append({'componentId': p['component_ref'], 'quizId': p['quiz_ref'],
                                                     'kind': p['kind'], 'passed': p['passed']})
    exports = load('source-links')
    totals, details = Counter(), []
    with patch.object(subject_source, '_page', side_effect=lambda endpoint, secret, page: pages[page]), \
            patch.object(subject_source, 'course_schedule', return_value={}):
        for learner in learners:
            aptem = int(learner['aptem_id']) if str(learner['aptem_id'] or '').strip().isdigit() else None
            email = str(learner['email'] or '').strip().casefold()
            matched = [r for r in identities[aptem] if str(r['email'] or '').strip().casefold() == email]
            cursor = MagicMock()
            cursor.fetchall.return_value = [(r['canonical_id'], r['source_id'], r['source_email']) for r in matched]
            live = subject_source.read_learner(cursor, aptem, email)
            source_ids = sorted({r['source_id'] for r in matched})
            missing_ids = [ident for ident in source_ids if not source_by_id[ident]]
            alias_emails = {r['source_id']: str(r['source_email'] or '').strip().casefold() for r in matched}
            email_mismatch_ids = [ident for ident in source_ids if any(
                str(row[2]['learner_email'] or '').strip().casefold() not in
                ({alias_emails[ident], email} if ident == matched[0]['canonical_id'] else {alias_emails[ident]})
                for row in source_by_id[ident])]
            state = 'verified' if live is not None else 'native_only' if aptem is None else 'no_verified_link' if not matched else 'source_identity_missing' if missing_ids else 'source_email_mismatch' if email_mismatch_ids else 'source_read_failed'
            totals[state] += 1
            raw = {(r['group_id'], r['activity_id']): r for r in historical[aptem]}
            old = {key: _is_completed(row) for key, row in raw.items()}
            local = {(a['group_id'], a['activity_id']) for a in attempts[learner['id']] if a['completed']}
            unscoped = {a['activity_id'] for a in attempts[learner['id']] if a['completed']}
            current = {}
            for group in (live or {}).get('groups', []):
                for row in subject_source.source_rows(group):
                    current[(group['id'], row['activity_id'])] = row
            old_groups = {r['group_id']: r['group_name'] for r in memberships[aptem]}
            live_groups = {g['id']: g['name'] for g in (live or {}).get('groups', [])}
            returned = {key: value for key, value in old.items() if key[0] not in live_groups}
            returned.update({key: _is_completed(row) or old.get(key, False) for key, row in current.items()})
            false_cross_course = [list(key) for key, done in returned.items()
                                  if not done and key not in local and key[1] in unscoped]
            returned = {key: done or key in local for key, done in returned.items()}
            courses = []
            for gid, name in (old_groups | live_groups).items():
                keys = sorted(key for key in returned if key[0] == gid)
                live_keys = sorted(key for key in current if key[0] == gid)
                complete = [key[1] for key in keys if returned[key]]
                incomplete = [key[1] for key in keys if not returned[key]]
                courses.append({'id': gid, 'name': name, 'source': 'live' if gid in live_groups else 'historical',
                    'activities': len(keys), 'completed': len(complete), 'not_completed': len(incomplete),
                    'progress_percent': round(len(complete) / len(keys) * 100, 2) if keys else 0,
                    'source_completed': sum(_is_completed(current[k]) for k in live_keys),
                    'historical_completions_preserved': [k[1] for k in live_keys if old.get(k) and not _is_completed(current[k])],
                    'completed_activity_ids': complete, 'not_completed_activity_ids': incomplete})
            gained = [list(k) for k, row in current.items() if _is_completed(row) and not old.get(k, False)]
            added = [list(k) for k in current if k not in old]
            removed = [list(k) for k in old if k[0] in live_groups and k not in current]
            preserved = [list(k) for k, row in current.items() if old.get(k) and not _is_completed(row)]
            plan = learner['training_plan'] if isinstance(learner['training_plan'], list) else learner['learning_plan']
            assigned = [r.get('moduleId') for r in plan or []] if isinstance(plan, list) else []
            native = [c for mid in set(assigned) & modules.keys() for c in components[mid]]
            progress = native_progress[learner['id']]
            links = defaultdict(set)
            for link in exports:
                if link['component_id'] and link['activity_id'] and link['group_id'] in old_groups.keys() | live_groups.keys():
                    links[link['component_id']].add((str(link['group_id']), str(link['activity_id'])))
            links = {cid: next(iter(keys)) for cid, keys in links.items() if len(keys) == 1}
            metrics_rows = subject_source.overlay_progress_rows(list(raw.values()), live)
            combined = programme_totals(metrics_rows, native, progress,
                                        {(str(g), str(a)) for g, a in local}, links)
            # Exercise the real cards transformer independently of the metrics
            # transformer and compare every course/activity completion flag.
            payload = {'aptem_id': aptem, 'subjects': [{'id': g, 'name': n} for g, n in old_groups.items()],
                'activities': [{'activity_id': f'la:{g}:{a}', 'source_activity_id': a, 'group_id': g,
                    'completed': done, 'status': raw[(g, a)].get('status'),
                    'quiz_score': raw[(g, a)].get('quiz_score'), 'quiz_maximum_score': raw[(g, a)].get('quiz_maximum_score'),
                    'actual': 0, 'planned': 0, 'hours_mapped': False, 'planned_hours_mapped': False}
                    for (g, a), done in old.items()]}
            cards = subject_source.overlay_subjects(payload, live, {})['activities']
            progress_rows = [{'group_id': g, 'activity_id': a, 'completed': True, 'best_percent': None, 'attempt_count': 1} for g, a in local]
            cards = subject_store.overlay_progress(cards, progress_rows)
            card_states = {(r['group_id'], r['source_activity_id']): r['completed'] for r in cards}
            metric_states = {(r['group_id'], r['activity_id']): _is_completed(r) or (r['group_id'], r['activity_id']) in local for r in metrics_rows}
            if card_states != returned or metric_states != returned or len(cards) != len(returned):
                raise AssertionError(f'Card/metrics/source completion mismatch: enrolment {learner["id"]}')
            completed_components = {p['componentId'] for p in progress if progress_counts_as_achieved(p['kind'], p['passed'])}
            completed_quizzes = {str(p['quizId']) for p in progress if p['quizId'] is not None and progress_counts_as_achieved(p['kind'], p['passed'])}
            native_details = []
            for mid in sorted(set(assigned) & modules.keys()):
                done_ids, incomplete_ids = [], []
                for c in components[mid]:
                    key = links.get(c['id'])
                    source_done = returned.get(tuple(map(int, key)), False) if key else False
                    done = source_done or c['id'] in completed_components or c['quiz_id'] is not None and str(c['quiz_id']) in completed_quizzes
                    (done_ids if done else incomplete_ids).append(c['id'])
                native_details.append({'id': mid, 'name': modules[mid]['title'], 'activities': len(done_ids) + len(incomplete_ids),
                    'completed': len(done_ids), 'not_completed': len(incomplete_ids),
                    'completed_component_ids': done_ids, 'not_completed_component_ids': incomplete_ids})
            detail = {'enrolment_id': learner['id'], 'name': learner['name'], 'aptem_id': aptem,
                'programme_status': learner['programme_status'], 'verification': state,
                'verified_source_ids': source_ids, 'missing_source_ids': missing_ids,
                'source_email_mismatch_ids': email_mismatch_ids,
                'email_candidate_ids_requiring_verification': sorted(source_by_email[email] - set(source_ids)),
                'source_pages': sorted({n for ident in source_ids for n in roster[str(ident)]}),
                'assigned_native_module_ids': assigned,
                'missing_or_deleted_native_module_ids': sorted(set(assigned) - modules.keys()),
                'native_modules': native_details, 'programme_progress': combined,
                'cards_and_metrics_verified': True,
                'ambiguous_quiz_placements': [list(k) for k, row in current.items() if row.get('quiz_definition_ambiguous')],
                'historical_courses': len(old_groups), 'live_courses': len(live_groups),
                'new_live_courses': sorted(live_groups.keys() - old_groups.keys()),
                'historical_only_courses': sorted(old_groups.keys() - live_groups.keys()) if live else [],
                'historical_activity_count': len(old), 'live_activity_count': len(current),
                'returned_activity_count': len(returned), 'returned_completed': sum(returned.values()),
                'returned_not_completed': len(returned) - sum(returned.values()),
                'live_additions': added, 'live_removed_placements': removed,
                'new_source_completions': gained, 'historical_completions_preserved': preserved,
                'cross_course_completions_prevented': false_cross_course,
                'courses': courses}
            details.append(detail)
            for label, values in [('added_activities', added), ('removed_activities', removed),
                                  ('new_source_completions', gained), ('preserved_historical_completions', preserved),
                                  ('cross_course_completions_prevented', false_cross_course)]:
                totals[label] += len(values)
                totals[label + '_learners'] += bool(values)
            totals['returned_activities'] += len(returned)
            totals['returned_completed'] += sum(returned.values())
            totals['returned_not_completed'] += len(returned) - sum(returned.values())
            totals['programme_activities'] += combined['total']
            totals['programme_completed'] += combined['completed']
            totals['ambiguous_quiz_learners'] += bool(detail['ambiguous_quiz_placements'])
    totals['learners'] = len(learners)
    totals['source_pages'] = len(pages)
    totals['local_submitted_attempts'] = sum(map(len, attempts.values()))
    changed_hints = {ident: next(iter(numbers)) for ident, numbers in roster.items()
                     if len(numbers) == 1 and routing.get(ident) != next(iter(numbers))}
    report = {'verified_at': datetime.now(timezone.utc).isoformat(), 'summary': dict(totals),
              'routing_hint_changes': changed_hints,
              'source_ids_on_multiple_pages': {k: sorted(v) for k, v in roster.items() if len(v) > 1},
              'learners': details}
    save('reconciliation', report)
    destination = ROOT / 'reports' / 'learner-legacy-progress-2026-09-12.json'
    destination.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    import csv
    columns = ['enrolment_id', 'name', 'aptem_id', 'verification', 'historical_courses', 'live_courses',
               'programme_total', 'completed', 'not_completed', 'progress_percent', 'ambiguous_quizzes']
    with destination.with_suffix('.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        for d in details:
            p = d['programme_progress']
            writer.writerow({k: d[k] for k in columns if k in d} | {
                'programme_total': p['total'], 'completed': p['completed'],
                'not_completed': p['total'] - p['completed'], 'progress_percent': p['percent'],
                'ambiguous_quizzes': len(d['ambiguous_quiz_placements'])})
    print(json.dumps(report['summary']), flush=True)
    print(json.dumps({'exceptions': [{k: d[k] for k in ('enrolment_id', 'name', 'verification', 'missing_source_ids', 'source_email_mismatch_ids')}
                                    for d in details if d['verification'] not in ('verified', 'native_only')],
                      'routing_hint_changes': len(changed_hints),
                      'source_ids_on_multiple_pages': report['source_ids_on_multiple_pages']}), flush=True)


def frontend_snapshot():
    """Generate private offline cases for the actual React cards reducer."""
    report = load('reconciliation')
    catalogue = {c['id']: c for c in load('native-components')}
    exports = load('source-links')
    progress = defaultdict(list)
    for p in load('native-progress'):
        progress[p['enrolment_id']].append({'componentId': p['component_ref'], 'quizId': p['quiz_ref'],
                                          'kind': p['kind'], 'passed': p['passed'], 'grade': 0})
    cases = []
    for d in report['learners']:
        components = [{**catalogue[cid], 'module': m['name']} for m in d['native_modules']
                      for cid in m['completed_component_ids'] + m['not_completed_component_ids']]
        ids = {c['id']: c['module_id'] for c in components}
        groups = {c['id'] for c in d['courses']}
        links = defaultdict(set)
        for link in exports:
            if link['component_id'] in ids and link['activity_id'] and link['group_id'] in groups:
                links[link['component_id']].add((link['group_id'], int(link['activity_id'])))
        activity_sources = {cid: {'module_id': ids[cid], 'group_id': pair[0], 'activity_id': pair[1]}
                            for cid, pairs in links.items() if len(pairs) == 1 for pair in pairs}
        records = progress[d['enrolment_id']]
        cases.append({'id': d['enrolment_id'], 'expected': d['programme_progress'],
            'data': {'subjects': [{'id': c['id'], 'name': c['name']} for c in d['courses']],
                'activity_sources': activity_sources,
                'activities': [{'activity_id': f'la:{c["id"]}:{aid}', 'source_activity_id': aid,
                    'group_id': c['id'], 'group_name': c['name'], 'activity': str(aid), 'completed': done, 'date': None}
                    for c in d['courses'] for done, field in [(True, 'completed_activity_ids'), (False, 'not_completed_activity_ids')]
                    for aid in c[field]]},
            'metadata': {'current_subjects': [{'id': m['id'], 'title': m['name']} for m in d['native_modules']]},
            'real': {'components': [{'componentId': c['id'], 'moduleId': c['module_id'], 'module': c['module'],
                'component': c['title'], 'type': c['type'], 'isQuiz': bool(c['quiz_id']),
                'quizMeta': {'quizId': c['quiz_id']} if c['quiz_id'] else None} for c in components],
                'componentProgress': [p for p in records if p['kind'] == 'component'],
                'videoProgress': [p for p in records if p['kind'] == 'video'],
                'quizAttempts': [p for p in records if p['kind'] == 'quiz']}})
    save('frontend-cases', cases)
    print(json.dumps({'frontend_cases': len(cases)}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--database', action='store_true')
    parser.add_argument('--analyse', action='store_true')
    parser.add_argument('--frontend', action='store_true')
    args = parser.parse_args()
    if args.fetch:
        fetch_snapshot()
    if args.database:
        database_snapshot()
    if args.analyse:
        analyse_snapshot()
    if args.frontend:
        frontend_snapshot()
