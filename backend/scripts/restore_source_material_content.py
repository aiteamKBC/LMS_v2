"""Restore missing material definitions for explicitly selected owned courses.

Preview by default. Apply requires the database and plan fingerprints. Only
source material content and exact catalogue material links change; learner
records, course membership, activity dates and accepted hours are preserved.
No Django startup, storage uploads, emails, meetings or new learner attempts.
"""
import argparse
from collections import Counter
from copy import deepcopy
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
from urllib.parse import unquote, urlsplit
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from learner_api import subject_content
from learner_api.source_material_content import hydrate_material, object_value
from reconcile_aptem_evidence import digest, insert
from reconcile_old_lms_missing_ssot import database_url, env_values
from recover_live_legacy_completions import read_state as learner_state, views, insert_catalogue
from repair_live_legacy_progress import card
from restore_legacy_material_progress import SameOrigin

RUN_KIND = 'verified-material-content-recovery-v1'
MEDIA_FIELDS = ('video_iframe_url', 'reading_iframe_url', 'audio_iframe_url')
AUTHOR_FIELDS = ('material_id', 'material_title', 'component_type', 'content_type',
                 'material_format', 'source', 'content_duration', 'text_body',
                 'reading_text_body', 'html_body', 'quiz')


def linked_assignment_schema(definition, course, component, week):
    """Reuse an explicit current-module assignment, with traceable provenance.

    This is a current curriculum snapshot, not a claimed byte-for-byte copy of
    an inaccessible legacy page. The caller must verify every returned file
    and lock/recheck the native records before applying the material plan.
    """
    ref = definition['source_activity_id']
    if (not re.fullmatch(r'material:[1-9][0-9]*', ref)
            or definition.get('source_activity_type') != 'assignment'
            or definition.get('source_course_id') != course['id']
            or component.get('type') != 'assignment'
            or component.get('deleted_at') is not None or week.get('deleted_at') is not None
            or component.get('module_catalogue_id') != course.get('curriculum_module_ref')
            or week.get('module_catalogue_id') != course.get('curriculum_module_ref')
            or component.get('week_id') != week.get('id')):
        raise ValueError('Assignment identity or module scope differs.')
    normal = lambda value: ' '.join(str(value or '').split()).casefold()
    if not normal(component.get('title')) or normal(component['title']) != normal(definition['source_activity_title']):
        raise ValueError('Assignment titles differ.')
    source_week = normal(definition.get('source_section_title'))
    native_week = normal(week.get('title'))
    # Teaching labels survive holiday insertions; the stored ordinal can shift.
    source_number = re.match(r'week\s*0*([1-9][0-9]*)\b', source_week)
    native_number = re.match(r'week\s*0*([1-9][0-9]*)\b', native_week)
    if (not source_number or not native_number or source_number[1] != native_number[1]
            or not (source_week == native_week or source_week.startswith(native_week + ' '))):
        raise ValueError('Assignment teaching weeks differ.')
    settings = object_value(component.get('settings_json'))
    brief = settings.get('assignmentBrief')
    primary = settings.get('assignmentFileUrl') or ''
    if not isinstance(brief, str) or not subject_content.clean_text(brief).strip():
        raise ValueError('The stored assignment brief is empty.')

    class Links(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.links = set()

        def handle_starttag(self, tag, attrs):
            self.links.update(value for name, value in attrs if name in ('href', 'src') and value)

    parser = Links()
    parser.feed(brief)
    files = parser.links | ({primary} if primary else set())
    prefix = '/curriculum_api/curriculum/uploads/'
    if not primary or not files:
        raise ValueError('The stored assignment has no primary file.')
    for url in files:
        parsed = urlsplit(url)
        parts = unquote(parsed.path).split('/')
        if (not url.startswith(prefix) or parsed.scheme or parsed.netloc or parsed.query
                or parsed.fragment or '\\' in unquote(parsed.path)
                or any(part in ('.', '..') for part in parts)):
            raise ValueError('Assignment file is not a verified local archive path.')
    schema = {'material_id': int(ref.split(':')[1]), 'material_title': component['title'],
              'component_type': 'assignment', 'content_type': 'assignment',
              'text_body': brief, 'iframe_url': primary,
              'source': {'provider': 'linked_curriculum_snapshot', 'requires_lms_login': False,
                  'recovery_evidence': {'source_course_ref': course['source_course_ref'],
                      'component_id': component['id'], 'week_id': week['id'],
                      'component_fingerprint': digest(component), 'week_fingerprint': digest(week),
                      'match': 'linked-module-exact-title-and-teaching-week'}}}
    return schema, sorted(files)


def stored_definition(material):
    row = hydrate_material({
        'material_title': material.get('title'), 'material_content_type': material.get('content_type'),
        'material_payload': material.get('payload'), 'material_source_url': material.get('source_url'),
        'material_video_url': material.get('video_iframe_url'),
        'material_reading_url': material.get('reading_iframe_url'),
        'material_audio_url': material.get('audio_iframe_url'),
        'material_backup_status': material.get('backup_status'),
        'material_blob_container': material.get('blob_container'), 'material_blob_name': material.get('blob_name'),
    })
    stored = {'title': row['title'], 'video_url': row['video_iframe_url'],
              'reading_url': row['reading_iframe_url'], 'audio_url': row['audio_url'],
              'reading_html': row['reading_text_body'], '_source': row}
    definition = subject_content.build_material(stored, row['_material_schema'])
    definition['available'] = definition['available'] or row['_material_blob_ready']
    return definition


def needs_content(material):
    if material is None:
        return True
    if material.get('deleted_at') is not None or material.get('source_system') != 'old_lms':
        raise ValueError('An existing material requires identity/deletion review.')
    # Only recover empty historical placeholders, never overwrite authored or
    # migrated content, nor mistake an unresolved attachment for an empty item.
    payload = object_value(material.get('payload'))
    source = payload.get('source')
    source = source if isinstance(source, dict) else {}
    return (payload.get('historical_only') is True
            and not source.get('attachments')
            and not stored_definition(material)['available'])


def material_values(definition, material, schema):
    ref = definition['source_activity_id']
    if not re.fullmatch(r'material:[1-9][0-9]*', ref):
        raise ValueError('Expected an exact material identity, not a quiz or title.')
    ident = int(ref.split(':')[1])
    if int(schema.get('material_id') or 0) != ident:
        raise ValueError('Source returned a different material.')
    if material and (material['material_id'] != ident or not needs_content(material)):
        raise ValueError('Existing material is not an empty historical placeholder.')
    if definition.get('source_material_id') not in (None, ident):
        raise ValueError('Catalogue material link conflicts with its typed identity.')
    schema = deepcopy(schema)
    body = next((schema.get(k) for k in ('reading_text_body', 'text_body', 'html_body') if schema.get(k)), '')
    kind = str(schema.get('content_type') or '').lower()
    url = subject_content.safe_url(schema.get('iframe_url'))
    if schema.get('iframe_url') and not url:
        raise ValueError('Source material URL is unsafe.')
    inline = bool(body and kind in {'text', 'reading', 'html'})
    primary = ('video_iframe_url' if kind in {'video', 'recording', 'live'}
               else 'audio_iframe_url' if kind in {'audio', 'podcast'} else 'reading_iframe_url')
    payload = deepcopy(object_value((material or {}).get('payload')))
    payload.update({key: schema[key] for key in AUTHOR_FIELDS if key in schema})
    payload['historical_only'] = False
    # Inline text must not also depend on the source's temporary text-body URL.
    payload.pop('iframe_url', None)
    cleared = set(payload.get('lms_cleared_media_fields') or [])
    cleared.update(MEDIA_FIELDS if inline else set(MEDIA_FIELDS) - {primary})
    if not inline:
        cleared.discard(primary)
    payload['lms_cleared_media_fields'] = sorted(cleared)
    fields = {key: None for key in MEDIA_FIELDS}
    if not inline:
        fields[primary] = url or None
    fields.update(title=schema.get('material_title') or definition['source_activity_title'],
                  content_type=kind, source_url=None if inline else url or None, payload=payload)
    candidate = {**(material or {}), **fields}
    if not stored_definition(candidate)['available']:
        raise ValueError('Source material has no recoverable content.')
    return fields


def fetch_schema(ident):
    schema = subject_content.material_schema(ident)
    source = schema.get('source') or {}
    if source.get('provider') == 'kbc_text_body' and not schema.get('text_body'):
        url = schema.get('iframe_url') or ''
        target = urlsplit(url)
        origin = urlsplit(subject_content.settings.KBC_LMS_SCHEMA_URL)
        if (target.scheme, target.netloc, target.path) != (
                'https', origin.netloc, f'/wp-json/kbc-lms/v1/material/{ident}/text-body'):
            raise ValueError('Unexpected inline content endpoint.')
        with urllib.request.build_opener(SameOrigin()).open(url, timeout=25) as response:
            raw = response.read(4 * 1024 * 1024 + 1)
            if response.headers.get_content_type() != 'text/html' or len(raw) > 4 * 1024 * 1024:
                raise ValueError('Unexpected inline content response.')
        body = raw.decode('utf-8')
        match = re.search(r'<body\b[^>]*>(.*?)</body\s*>', body, re.I | re.S)
        schema['text_body'] = match[1] if match else body
    return schema


def fetch_result(ident):
    for attempt in range(3):
        try:
            schema = fetch_schema(ident)
            source = schema.get('source') or {}
            if (source.get('requires_lms_login')
                    and not source.get('attachments')
                    and not any(schema.get(k) for k in ('text_body', 'reading_text_body', 'html_body', 'quiz'))):
                return ident, None, {'material_id': ident,
                    'error_type': 'OriginalLoginRequired', 'http_status': None}
            return ident, schema, None
        except (OSError, subject_content.ContentUnavailable) as error:
            cause = error.__cause__ or error
            status = getattr(cause, 'code', None)
            if attempt < 2 and status in (None, 500, 502, 503, 504):
                time.sleep(attempt + 1)
                continue
            return ident, None, {'material_id': ident, 'error_type': type(error).__name__,
                                'http_status': status}


def fetch_results(identifiers, delay=2):
    """Pace source reads and stop requesting after an access/rate-limit refusal."""
    results = []
    blocked_status = None
    for ident in identifiers:
        if blocked_status is not None:
            results.append((ident, None, {'material_id': ident,
                'error_type': 'SourceRequestsStopped', 'http_status': None,
                'blocked_by_http_status': blocked_status}))
            continue
        if results and delay:
            time.sleep(delay)
        result = fetch_result(ident)
        results.append(result)
        error = result[2]
        if error and error.get('http_status') in (401, 403, 429):
            blocked_status = error['http_status']
    return results


def read_scope(cur, args):
    state = learner_state(cur, args.aptem_id)
    courses = [c for c in state['courses'] if int(c['source_course_ref']) in args.course_ids]
    if len(courses) != len(set(args.course_ids)):
        raise ValueError('A selected course is not actively assigned to this learner.')
    definitions = cur.execute('''SELECT a.*,c.source_course_ref FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id
        WHERE a.source_course_id=ANY(%s) AND a.deleted_at IS NULL
          AND a.source_system='old_lms' AND a.source_activity_kind='material'
        ORDER BY a.id''', [[c['id'] for c in courses]]).fetchall()
    identifiers = [int(d['source_activity_id'].split(':')[1]) for d in definitions]
    materials = cur.execute('SELECT * FROM curriculum.source_materials WHERE material_id=ANY(%s) ORDER BY id',
                            [identifiers]).fetchall()
    by_id = {m['material_id']: m for m in materials}
    selected = [(d, by_id.get(int(d['source_activity_id'].split(':')[1]))) for d in definitions]
    selected = [(d, m) for d, m in selected if needs_content(m)]
    if getattr(args, 'material_ids', None):
        selected = [(d, m) for d, m in selected
                    if int(d['source_activity_id'].split(':')[1]) in args.material_ids]
    return state, definitions, materials, selected


def preserved(cur, course_ids, material_ids):
    affected = cur.execute('''SELECT DISTINCT m.learner_id FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_activities a ON a.source_course_id=m.source_course_id
        WHERE m.deleted_at IS NULL AND (a.source_course_id=ANY(%s) OR a.source_material_id=ANY(%s))
        ORDER BY m.learner_id''', [course_ids, material_ids]).fetchall()
    learners = [r['learner_id'] for r in affected]
    hashes = {}
    for table, field in (
        ('learner_progress_entries', 'learner_id'), ('learner_activity_sources', 'learner_id'),
        ('learner_activity_reporting_segments', 'learner_id'), ('learner_journal_rows', 'canonical_learner_id'),
        ('learner_source_course_memberships', 'learner_id'), ('learner_training_plan_modules', 'learner_id'),
    ):
        hashes[table] = cur.execute(f'''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(r)::text),'' ORDER BY id)) AS fingerprint
            FROM "Learner".{table} r WHERE {field}=ANY(%s)''', [learners]).fetchone()
    hashes['plans'] = cur.execute('''SELECT count(*) AS count,
        md5(string_agg(md5(jsonb_build_array(c.id,c."Training_plan",c."Learning_plan")::text),'' ORDER BY c.id)) AS fingerprint
        FROM enrolment."Created_users" c JOIN "Learner".learners l ON l.enrolment_id=c.id
        WHERE l.id=ANY(%s)''', [learners]).fetchone()
    return {'learners': len(learners), 'hashes': hashes}


def run(args):
    env = env_values()
    subject_content.settings = SimpleNamespace(KBC_LMS_API_KEY=env['KBC_LMS_API_KEY'],
        KBC_LMS_SCHEMA_URL=env.get('KBC_LMS_SCHEMA_URL',
            'https://kentbusinesscollege.org/wp-json/kbc-lms/v1/all-students-schema'))
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        cur = conn.cursor(); cur.execute("SET LOCAL statement_timeout='40s'")
        target = digest({'database': conn.info.dbname, 'host': conn.info.host})
        state, definitions, materials, selected = read_scope(cur, args)
        database = conn.info.dbname
    if args.expected_target and args.expected_target != target:
        raise ValueError('Database differs from the requested target.')
    # This restores explicitly selected existing catalogue entries, not new
    # enrolments or completion facts. Ownership comes from the stored learner
    # identity; content identity comes from each exact source material schema.
    unique_ids = sorted({int(d['source_activity_id'].split(':')[1]) for d, _ in selected})
    results = fetch_results(unique_ids)
    schemas = {ident: schema for ident, schema, error in results if not error}
    unavailable = [error for _, _, error in results if error]
    plans = []
    for definition, material in selected:
        ident = int(definition['source_activity_id'].split(':')[1])
        if ident not in schemas:
            continue
        fields = material_values(definition, material, schemas[ident])
        plans.append({'definition': definition, 'material': material, 'material_id': ident, 'fields': fields})
    # Source viewers may issue short-lived tokens. Gate writes on the exact
    # reviewed target records; still verify each newly fetched material ID.
    fingerprint = digest([(p['definition'], p['material']) for p in plans])
    output = {'database': database, 'target': target, 'fingerprint': fingerprint,
        'inspected_activities': len(selected), 'source_unavailable': unavailable,
        'activities': len(plans), 'new_materials': sum(p['material'] is None for p in plans),
        'empty_materials': sum(p['material'] is not None for p in plans),
        'by_course': dict(Counter(p['definition']['source_course_ref'] for p in plans)),
        'original_login_required': sum(bool((schema.get('source') or {}).get('requires_lms_login')) for schema in schemas.values()),
        'progress': {cid: card(p) for cid, p in views(state).items()}}
    if not args.apply or not plans:
        return output
    if fingerprint != args.expected_fingerprint or len(plans) != args.expected_count:
        return {**output, 'applied': False, 'needs_new_preview': True}
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.isolation_level = psycopg.IsolationLevel.SERIALIZABLE
        cur = conn.cursor(); cur.execute("SET LOCAL statement_timeout='60s'"); cur.execute("SET LOCAL lock_timeout='5s'")
        if digest({'database': conn.info.dbname, 'host': conn.info.host}) != target:
            raise ValueError('Write database differs from preview.')
        cur.execute('SELECT id FROM curriculum.source_activities WHERE id=ANY(%s) ORDER BY id FOR UPDATE',
                    [[p['definition']['id'] for p in plans]])
        cur.execute('SELECT id FROM curriculum.source_materials WHERE material_id=ANY(%s) ORDER BY id FOR UPDATE', [unique_ids])
        current_state, current_definitions, current_materials, _ = read_scope(cur, args)
        if current_definitions != definitions or current_materials != materials:
            raise ValueError('Catalogue or material content changed during source retrieval.')
        course_ids = [c['id'] for c in state['courses'] if int(c['source_course_ref']) in args.course_ids]
        invariant = preserved(cur, course_ids, unique_ids)
        before_progress = views(current_state)
        audit = insert(cur, 'activity_sync_runs', {'run_key': RUN_KIND + ':' + fingerprint,
            'run_kind': RUN_KIND, 'status': 'running', 'dry_run': False,
            'source_counts': Jsonb({'material_ids': unique_ids, 'course_ids': args.course_ids}),
            'result_counts': Jsonb(output)})
        expected_definitions = deepcopy(definitions)
        expected_materials = {m['material_id']: deepcopy(m) for m in materials}
        written = set()
        for plan in plans:
            ident, old, fields = plan['material_id'], plan['material'], plan['fields']
            metadata = {**object_value((old or {}).get('source_metadata')),
                'verified_content_recovery': {'run_id': audit, 'previous_digest': digest(old), 'material_id': ident}}
            if ident not in written:
                if old is None:
                    values = {**fields, 'source_system': 'old_lms', 'material_id': ident,
                              'source_metadata': Jsonb(metadata)}
                    values['payload'] = Jsonb(values['payload'])
                    insert_catalogue(cur, 'source_materials', values)
                else:
                    cur.execute('''UPDATE curriculum.source_materials SET title=%s,content_type=%s,source_url=%s,
                        video_iframe_url=%s,reading_iframe_url=%s,audio_iframe_url=%s,payload=%s,source_metadata=%s,
                        last_checked_at=now(),last_success_at=now(),updated_at=now()
                        WHERE id=%s AND deleted_at IS NULL''',
                        [fields[k] for k in ('title','content_type','source_url',*MEDIA_FIELDS)]
                        + [Jsonb(fields['payload']),Jsonb(metadata),old['id']])
                actual = cur.execute('SELECT * FROM curriculum.source_materials WHERE material_id=%s', [ident]).fetchone()
                expected = {**(old or actual), **fields, 'source_metadata': metadata,
                    **{k: actual[k] for k in ('last_checked_at','last_success_at','updated_at')}}
                if actual != expected or not stored_definition(actual)['available']:
                    raise ValueError('Restored material verification failed.')
                expected_materials[ident] = actual
                written.add(ident)
            definition = plan['definition']
            if definition['source_material_id'] is None:
                cur.execute('UPDATE curriculum.source_activities SET source_material_id=%s WHERE id=%s AND source_material_id IS NULL',
                            [ident, definition['id']])
                if cur.rowcount != 1:
                    raise ValueError('Catalogue material link changed.')
                next(d for d in expected_definitions if d['id'] == definition['id'])['source_material_id'] = ident
        after_state, after_definitions, after_materials, remaining = read_scope(cur, args)
        if (after_definitions != expected_definitions
                or {m['material_id']: m for m in after_materials} != expected_materials
                or preserved(cur, course_ids, unique_ids) != invariant
                or views(after_state) != before_progress
                or any(int(d['source_activity_id'].split(':')[1]) in written for d, _ in remaining)):
            raise ValueError('Content, progress, membership or idempotence verification failed.')
        output.update(applied=True, audit_run=audit, members_checked=invariant['learners'],
                      learner_records_preserved=True, progress_preserved=True, idempotent=True)
        cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),
            updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(output),audit])
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aptem-id', type=int, required=True)
    parser.add_argument('--course-ids', type=lambda s: list(map(int, s.split(','))), required=True)
    parser.add_argument('--material-ids', type=lambda s: list(map(int, s.split(','))))
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-count', type=int)
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and not (args.expected_count and args.expected_target and args.expected_fingerprint):
        parser.error('Apply requires the preview target, fingerprint and count.')
    try:
        print(json.dumps(run(args), default=str))
    except Exception as exc:
        print(json.dumps({'error_type': type(exc).__name__, 'sqlstate': getattr(exc,'sqlstate',None),
                          'detail': str(exc) if type(exc) is ValueError else None}))
        raise SystemExit(1)
