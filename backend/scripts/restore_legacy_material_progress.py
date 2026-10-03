"""Restore explicitly selected completed legacy materials for one linked learner.

Fetches only the selected course, verifies the saved source ID AND email, and
previews by default. Completion timestamps are preserved. Elapsed calendar time
and configured content duration are never booked as actual learner hours.
"""
import argparse
from datetime import datetime, timedelta, timezone
import gzip
from html import unescape
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from reconcile_aptem_evidence import database_url, digest, ids, insert

UK = ZoneInfo('Europe/London')
ENDPOINT = 'https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress'
BASIS = 'old_lms:completion-confirmed-actual-time-unverified'
MATERIAL_FIELDS = (
    'component_id', 'title', 'material_type', 'section_id', 'section_title',
    'visited', 'completed', 'started_at', 'completed_at', 'time_spent_seconds',
    'configured_duration_seconds', 'completion_records',
)


class SameOrigin(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl)[:2] != urlsplit(req.full_url)[:2]:
            raise ValueError('Cross-origin redirect refused.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_course(user_id, course_id, selected):
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = (f'{ENDPOINT}?user_id={user_id}&course_id={course_id}'
           '&include_answers=false&include_other_modules=false')
    request = urllib.request.Request(url, headers={
        'X-KBC-API-Key': values.get('KBC_LMS_API_KEY', ''),
        'Accept': 'application/json', 'Accept-Encoding': 'gzip',
    })
    with urllib.request.build_opener(SameOrigin()).open(request, timeout=45) as response:
        stream = gzip.GzipFile(fileobj=response) if response.headers.get('Content-Encoding') == 'gzip' else response
        raw = stream.read(80 * 1024 * 1024 + 1)
    if len(raw) > 80 * 1024 * 1024:
        raise ValueError('Source response exceeds limit.')
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise ValueError('Invalid source response.')
    matches = [r for r in payload if isinstance(r, dict)
               and r.get('user_id') == user_id and r.get('course_id') == course_id]
    if len(matches) != 1 or not isinstance(matches[0].get('materials'), list):
        raise ValueError('Expected exactly one learner/course response.')
    course = matches[0]
    # Neither unrelated personal details nor quizzes/answers enter the snapshot.
    return {k: course.get(k) for k in ('user_id', 'course_id', 'email', 'timezone')} | {
        'materials': [{k: m.get(k) for k in MATERIAL_FIELDS} for m in course['materials']
                      if isinstance(m, dict) and m.get('component_id') in selected],
    }


def source_instant(value, zone):
    if not isinstance(value, str) or not value:
        raise ValueError('A completed material needs a source timestamp.')
    at = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if at.tzinfo is None:
        if re.fullmatch(r'[+-]\d{2}:\d{2}', str(zone)):
            minutes = int(zone[1:3]) * 60 + int(zone[4:])
            if int(zone[4:]) > 59 or minutes >= 24 * 60:
                raise ValueError('Invalid source timezone offset.')
            tz = timezone(timedelta(minutes=minutes if zone[0] == '+' else -minutes))
        else:
            # Require an explicit fixed offset for naive historical timestamps;
            # a named zone alone cannot disambiguate the DST fall-back hour.
            raise ValueError('Naive source timestamps require an explicit UTC offset.')
        at = at.replace(tzinfo=tz)
    return at


def read_state(cur, aptem_id, course_id, selected):
    owners = cur.execute('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.email,
        e.id AS account_id,e."Email" AS account_email,e.aptem_id AS account_aptem_id
        FROM "Learner".learners l LEFT JOIN enrolment."Created_users" e ON e.id=l.enrolment_id
        WHERE l.aptem_id=%s''', [aptem_id]).fetchall()
    if len(owners) != 1:
        raise ValueError('Expected one canonical learner.')
    owner = owners[0]
    state = {'owner': owner}
    for key, table in [('identities', 'learner_external_identities'),
                       ('progress', 'learner_progress_entries'), ('sources', 'learner_activity_sources'),
                       ('segments', 'learner_activity_reporting_segments')]:
        state[key] = cur.execute(f'SELECT * FROM "Learner".{table} WHERE learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    state['journals'] = cur.execute('SELECT * FROM "Learner".learner_journal_rows WHERE canonical_learner_id=%s ORDER BY id', [owner['id']]).fetchall()
    state['catalogue'] = cur.execute('''SELECT a.id,a.source_activity_id,a.source_activity_type,
        a.curriculum_component_ref,a.source_section_ref,a.source_section_title,a.source_material_id,
        c.id AS course_id,c.source_course_ref,c.source_course_title,c.curriculum_module_ref,
        h.id AS historical_id,h.historical_only,
        coalesce(k.ksbs,'[]'::jsonb) AS ksbs
        FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        JOIN "Learner".learner_source_course_memberships m
          ON m.source_course_id=c.id AND m.learner_id=%s AND m.deleted_at IS NULL
        LEFT JOIN curriculum.historical_components h ON h.source_catalog_activity_id=a.id AND h.deleted_at IS NULL
        LEFT JOIN curriculum.source_activity_ksbs k ON k.activity_id=a.id
        WHERE c.source_system='old_lms' AND c.source_course_ref=%s
          AND a.source_system='old_lms' AND a.source_activity_kind='material' AND a.deleted_at IS NULL
          AND a.source_activity_id=ANY(%s) ORDER BY a.id,h.id''',
        [owner['id'], str(course_id), [f'material:{i}' for i in selected]]).fetchall()
    return state


def plan_restore(state, course, user_id, course_id, selected):
    owner = state['owner']
    if (owner.get('account_id') != owner.get('enrolment_id') or owner.get('account_id') is None
            or str(owner.get('account_aptem_id')) != str(owner['aptem_id'])
            or str(owner.get('email', '')).strip().casefold() != str(owner.get('account_email', '')).strip().casefold()):
        raise ValueError('Canonical learner/enrolment identity needs review.')
    identities = [i for i in state['identities'] if i['source_system'] == 'old_lms'
                  and str(i['source_learner_id']) == str(user_id) and i['deleted_at'] is None]
    if len(identities) != 1:
        raise ValueError('Source account is not uniquely linked to this learner.')
    identity = identities[0]
    email = identity['source_payload'].get('source_email') or identity['source_payload'].get('learner_email')
    if (identity['learner_id'] != owner['id'] or not email
            or str(course.get('email') or '').strip().casefold() != email.strip().casefold()
            or course.get('user_id') != user_id or course.get('course_id') != course_id):
        raise ValueError('Live source ID/email/course ownership mismatch.')
    materials = course['materials']
    if sorted(m['component_id'] for m in materials) != sorted(selected):
        raise ValueError('Selected materials are missing or duplicated in source response.')
    plans = []
    for material in sorted(materials, key=lambda m: m['component_id']):
        aid = material['component_id']
        ref = f'material:{aid}'
        route = f'la:{course_id}:{aid}'
        if material.get('completed') is not True:
            raise ValueError('Selected material is not completed in the source.')
        ended = source_instant(material.get('completed_at'), course.get('timezone'))
        started = source_instant(material.get('started_at'), course.get('timezone'))
        if ended < started:
            raise ValueError('Source completion precedes its start.')
        definitions = [a for a in state['catalogue'] if a['source_activity_id'] == ref]
        if len(definitions) != 1:
            raise ValueError('Expected one owned catalogue/historical placement per material.')
        definition = definitions[0]
        if (str(definition['source_course_ref']) != str(course_id)
                or not definition['historical_id'] or definition['historical_only'] is not True
                or definition['curriculum_component_ref'] is not None):
            raise ValueError('This repair requires an unambiguous historical-only material.')
        if definition['ksbs']:
            raise ValueError('Source KSB mappings require an explicit assessed-evidence review.')
        kind = {'video': 'video', 'audio': 'audio', 'pdf': 'reading', 'text': 'reading'}.get(material.get('material_type'))
        if not kind:
            raise ValueError('Unsupported material type.')
        existing = [s for s in state['sources'] if s['source_system'] == 'old_lms' and s['source_activity_id'] == ref]
        if existing:
            if (len(existing) != 1 or existing[0]['deleted_at'] is not None
                    or existing[0]['source_course_ref'] != str(course_id)
                    or existing[0]['source_catalog_activity_id'] != definition['id']):
                raise ValueError('Existing source is deleted, duplicated, or has conflicting lineage.')
            progress = [p for p in state['progress'] if p['id'] == existing[0]['canonical_progress_id']
                        and p['learner_id'] == owner['id'] and p['deleted_at'] is None and p['accepted']]
            if len(progress) != 1 or not existing[0]['completed']:
                raise ValueError('Existing source needs a separate progress reconciliation.')
            plans.append({'activity_id': aid, 'resolution': 'already_present'})
            continue
        for progress in state['progress']:
            raw = progress.get('source_payload') or {}
            if not isinstance(raw, dict):
                raw = {}
            if (progress.get('source_system') == 'old_lms' and progress.get('source_activity_id') == ref
                    or progress.get('component_ref') in (ref, route, definition['historical_id'])
                    or raw.get('original_source_ref') == route):
                raise ValueError('Existing progress may already cover this material; no duplicate created.')
        if any(j.get('source_ref') == route for j in state['journals']):
            raise ValueError('Existing journal covers this material; audit history must be preserved.')
        plans.append({'activity_id': aid, 'resolution': 'insert', 'kind': kind,
            'title': unescape(material.get('title') or ''), 'definition': definition,
            'started': started, 'ended': ended, 'month': ended.astimezone(UK).strftime('%Y-%m'),
            'payload': {'original_source_ref': route, 'old_lms_completion': {
                'source_identity_id': identity['id'], 'source_user_id': user_id, 'course_id': course_id,
                'source_timezone': course['timezone'], 'material': dict(material),
                'actual_time_review_required': True,
                'timing_note': 'Source elapsed time and content duration do not establish actual study time.',
            }}})
    return plans


def summary(state, plans):
    segments = {}
    for segment in state['segments']:
        segments[segment['progress_id']] = segments.get(segment['progress_id'], 0) + segment['actual_seconds']
    active = [p for p in state['progress'] if p['deleted_at'] is None]
    return {'materials_to_insert': sum(p['resolution'] == 'insert' for p in plans),
        'materials_already_present': sum(p['resolution'] == 'already_present' for p in plans),
        'existing_progress_count': len(active),
        'legacy_progress_count': sum(p['source_system'] == 'old_lms' for p in active),
        'accepted_seconds': sum(segments.get(p['id'], p['actual_seconds'] or 0) for p in active if p['accepted']),
        'added_verified_seconds': 0,
        'new_materials_with_unverified_time': sum(p['resolution'] == 'insert' for p in plans)}


def apply_plan(cur, state, plans, fingerprint):
    pending = [p for p in plans if p['resolution'] == 'insert']
    if not pending:
        return None
    owner = state['owner']
    run = insert(cur, 'activity_sync_runs', {
        'run_key': 'legacy-material-completion:' + fingerprint,
        'run_kind': 'scoped-old-lms-completion-recovery', 'status': 'running', 'dry_run': False,
        'source_counts': Jsonb({'selected_materials': len(plans)}),
        'result_counts': Jsonb(summary(state, plans)),
    })
    next_order = max((p['entry_order'] for p in state['progress']), default=0)
    for plan in pending:
        next_order += 1
        definition = plan['definition']
        ref = f"material:{plan['activity_id']}"
        key = f"old_lms:{owner['id']}:{definition['source_course_ref']}:{ref}"
        common = {'learner_id': owner['id'], 'enrolment_id': owner['enrolment_id'],
            'programme_id': owner['programme_id'], 'aptem_id': owner['aptem_id'],
            'source_system': 'old_lms', 'source_activity_id': ref,
            'canonical_activity_key': key, 'activity_status': 'completed', 'accepted': True,
            'actual_seconds': None, 'actual_basis': BASIS, 'reporting_started_at': plan['ended'],
            'reporting_ended_at': plan['ended'], 'reporting_month': plan['month'],
            'source_payload': Jsonb(plan['payload']), 'sync_run_id': run}
        progress_id = insert(cur, 'learner_progress_entries', {**common,
            'entry_order': next_order, 'kind': plan['kind'], 'component_type': plan['kind'],
            'component_ref': ref, 'component_title': plan['title'],
            'module_ref': definition['curriculum_module_ref'], 'module_title': definition['source_course_title'],
            'week_title': definition['source_section_title'] or '',
            'started_at': plan['started'], 'submitted_at': plan['ended'],
        })
        source_id = insert(cur, 'learner_activity_sources', {**common,
            'activity_type': plan['kind'], 'title': plan['title'], 'completed': True,
            'source_started_at': plan['started'], 'source_ended_at': plan['ended'],
            'canonical_progress_id': progress_id, 'source_course_ref': definition['source_course_ref'],
            'source_catalog_activity_id': definition['id'], 'source_fingerprint': digest(plan['payload'])})
        cur.execute('''INSERT INTO "Learner".learner_progress_historical_components
            (progress_id,historical_component_ref,source_row_id,relationship)
            VALUES (%s,%s,%s,'historical-only')''', [progress_id, definition['historical_id'], source_id])
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed_with_issues',
        finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''',
        [Jsonb({**summary(state, plans), 'materials_inserted': len(pending),
                'issue': 'actual_time_unverified'}), run])
    return run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--source-user-id', type=int, required=True)
    parser.add_argument('--course-id', type=int, required=True)
    parser.add_argument('--material-ids', type=ids, required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if not args.material_ids or min(args.material_ids + [args.aptem_id, args.source_user_id, args.course_id]) <= 0:
        parser.error('Explicit positive learner, course and material IDs are required.')
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error('Apply requires the database and fingerprint from a read-only preview.')
    course = fetch_course(args.source_user_id, args.course_id, args.material_ids)
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute('SET LOCAL statement_timeout=20000')
            cur.execute('SET LOCAL lock_timeout=5000')
            database = cur.execute('SELECT current_database() AS name').fetchone()['name']
            if args.apply:
                if database != args.expected_database:
                    raise ValueError('Database differs from reviewed preview.')
                owners = cur.execute('SELECT id FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [args.aptem_id]).fetchall()
                if len(owners) != 1:
                    raise ValueError('Expected one canonical learner.')
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('learner-journal-progress'),%s::integer)", [owners[0]['id']])
                for table in ('learner_progress_entries', 'learner_activity_sources', 'learner_external_identities'):
                    cur.execute(f'SELECT id FROM "Learner".{table} WHERE learner_id=%s FOR UPDATE', [owners[0]['id']])
                cur.execute('SELECT id FROM "Learner".learner_journal_rows WHERE canonical_learner_id=%s FOR UPDATE', [owners[0]['id']])
            state = read_state(cur, args.aptem_id, args.course_id, args.material_ids)
            plans = plan_restore(state, course, args.source_user_id, args.course_id, args.material_ids)
            fingerprint = digest({'state': state, 'course': course})
            before = summary(state, plans)
            output = {'database': database, 'fingerprint': fingerprint, **before}
            if args.apply:
                if fingerprint != args.expected_fingerprint:
                    raise ValueError('Database or source changed since preview; preview again.')
                run = apply_plan(cur, state, plans, fingerprint)
                after = read_state(cur, args.aptem_id, args.course_id, args.material_ids)
                for name in ('identities', 'progress', 'sources', 'journals', 'segments'):
                    old = {r['id']: r for r in state[name]}
                    retained = {r['id']: r for r in after[name] if r['id'] in old}
                    if digest(old) != digest(retained):
                        raise ValueError('An existing record changed; rolling back.')
                if state['owner'] != after['owner'] or state['catalogue'] != after['catalogue']:
                    raise ValueError('Ownership or course placement changed; rolling back.')
                remaining = plan_restore(after, course, args.source_user_id, args.course_id, args.material_ids)
                final = summary(after, remaining)
                if (final['materials_to_insert'] or final['accepted_seconds'] != before['accepted_seconds']
                        or final['existing_progress_count'] != before['existing_progress_count'] + before['materials_to_insert']):
                    raise ValueError('Completion count/hour verification failed; rolling back.')
                output.update(applied=True, sync_run_id=run, verification='passed', after=final)
    print(json.dumps(output, default=str))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, psycopg.Error, OSError) as exc:
        # Source/DB error details can contain credentials or learner payloads.
        print(json.dumps({'error': str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        sys.exit(1)
