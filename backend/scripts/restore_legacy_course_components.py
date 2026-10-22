"""Restore missing curriculum components from a verified course-only snapshot.

No Django startup, HTTP, schema changes, meeting operations or learner writes.
Preview first; apply requires the exact target and plan fingerprints. Existing
components, quizzes, historical catalogue entries and materials are preserved.
Only exact typed source IDs establish links; titles never establish identity.
Snapshots and reports must stay outside version control (they contain content).
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api import subject_content
from reconcile_old_lms_missing_ssot import database_url, env_values
from restore_source_material_content import AUTHOR_FIELDS, MEDIA_FIELDS, stored_definition

RUN_KIND = 'verified-course-components-recovery-v1'


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def read_state(cur, course_id, module_id):
    course = cur.execute('''SELECT * FROM curriculum.source_courses WHERE source_system='old_lms'
        AND source_course_ref=%s AND deleted_at IS NULL''', [str(course_id)]).fetchall()
    if len(course) != 1 or course[0]['curriculum_module_ref'] != module_id:
        raise ValueError('The source course does not uniquely identify the selected module.')
    module = cur.execute('SELECT * FROM curriculum.modules WHERE module_catalogue_id=%s', [module_id]).fetchone()
    if not module or module['deleted_at'] is not None or module['source_id'] != str(course_id):
        raise ValueError('The native module source identity is not verified.')
    exported = cur.execute('SELECT curriculum FROM "MBA".course_curriculum WHERE course_id=%s', [course_id]).fetchone()
    if not exported:
        raise ValueError('The retained original ID mapping is required.')
    export = exported['curriculum']
    export = json.loads(export) if isinstance(export, str) else export
    definitions = cur.execute('SELECT * FROM curriculum.source_activities WHERE source_course_id=%s ORDER BY id',
                              [course[0]['id']]).fetchall()
    material_ids = [int(d['source_activity_id'].split(':')[1]) for d in definitions
                    if d['source_activity_kind'] in ('material', 'quiz')]
    return dict(course=course[0], module=module, export=export, definitions=definitions,
        weeks=cur.execute('SELECT * FROM curriculum.weeks WHERE module_catalogue_id=%s ORDER BY id', [module_id]).fetchall(),
        components=cur.execute('SELECT * FROM curriculum.components WHERE module_catalogue_id=%s ORDER BY id', [module_id]).fetchall(),
        materials=cur.execute('SELECT * FROM curriculum.source_materials WHERE material_id=ANY(%s) ORDER BY id', [material_ids]).fetchall())


def preserved(cur, module_id, source_id):
    """Database-side digests only: no learner rows or identities leave the DB."""
    result = {}
    scope = '''SELECT learner_id FROM "Learner".learner_source_course_memberships WHERE source_course_id=%s
        UNION SELECT learner_id FROM "Learner".learner_training_plan_modules
        WHERE curriculum_module_id=%s OR module_ref=%s'''
    for table, field in (('learner_progress_entries', 'learner_id'), ('learner_activity_sources', 'learner_id'),
                         ('learner_activity_reporting_segments', 'learner_id'), ('learner_journal_rows', 'canonical_learner_id'),
                         ('learner_source_course_memberships', 'learner_id'), ('learner_training_plan_modules', 'learner_id')):
        result[table] = cur.execute(sql.SQL('''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY id)) AS fingerprint
            FROM "Learner".{} t WHERE {} IN (''').format(sql.Identifier(table), sql.Identifier(field))
            + sql.SQL(scope + ')'), [source_id, module_id, module_id]).fetchone()
    for table, condition, params in (
        ('components', 'module_catalogue_id<>%s', [module_id]),
        ('weeks', 'module_catalogue_id<>%s', [module_id]),
        ('source_activities', 'source_course_id<>%s', [source_id]),
    ):
        result['other_' + table] = cur.execute(sql.SQL('''SELECT count(*) AS count,
            md5(string_agg(md5(row_to_json(t)::text),'' ORDER BY id)) AS fingerprint
            FROM curriculum.{} t WHERE ''').format(sql.Identifier(table)) + sql.SQL(condition), params).fetchone()
    return result


def native_settings(fact, schema):
    ident = int(fact['component_id'])
    if schema.get('material_id') != ident:
        raise ValueError('The content snapshot has a different source ID.')
    kind = fact['component_kind']
    native_type = 'quiz' if kind == 'quiz' else {'video': 'video', 'audio': 'podcast'}.get(fact['material_type'], 'reading')
    settings = dict(version='0.1', contentStatus='Approved', legacySourceType='mba-legacy',
                    completionRule='Mark complete', evidenceRequired='-')
    seconds = fact.get('configured_duration_seconds')
    if seconds is not None and (not isinstance(seconds, (int, float)) or seconds < 0):
        raise ValueError('Invalid original configured duration.')
    media_seconds = (schema.get('content_duration') or {}).get('seconds')
    display_seconds = seconds if seconds is not None else media_seconds
    minutes = round(display_seconds / 60) if display_seconds else 0
    url = subject_content.safe_url(schema.get('iframe_url'))
    body = next((schema.get(k) for k in ('reading_text_body', 'text_body', 'html_body') if schema.get(k)), '')
    quiz = None
    if native_type == 'quiz':
        quiz = subject_content.quiz_definition(schema.get('quiz'))
        if not quiz or not quiz['ready']:
            raise ValueError('Original quiz questions or answer keys are incomplete.')
        settings.update(buildMode='Imported from legacy LMS', attemptsAllowed=0,
                        numberOfQuestions=len(quiz['questions']), passMarkPercentage=quiz['passing_percent'])
    else:
        if not (url or body) or (schema.get('source', {}).get('requires_lms_login') and not body):
            raise ValueError('The original content is unavailable without a source login.')
        if native_type == 'video':
            settings.update(videoUrl=url, sourceType='External link', provider=schema.get('source', {}).get('provider', ''),
                            lessonContent=body, durationMinutes=minutes, requiredProgressPercentage=0)
        elif native_type == 'podcast':
            settings.update(podcastUrl=url, podcastSource='External URL', transcript=body,
                            durationMinutes=minutes, requiredProgressPercentage=0)
        else:
            settings.update(resourceUrl=url, readingContent=body,
                            readingSource='LMS resource' if url else 'Written in LMS',
                            estimatedReadingTime=str(minutes or ''), requirement='Required')
    return native_type, settings, quiz, Decimal(str(seconds or 0)) / Decimal(3600)


def material_values(schema):
    payload = {k: schema[k] for k in AUTHOR_FIELDS if k in schema}
    payload['historical_only'] = False
    kind = str(schema.get('content_type') or '').lower()
    body = next((schema.get(k) for k in ('reading_text_body', 'text_body', 'html_body') if schema.get(k)), '')
    inline = bool(body and kind in ('text', 'reading', 'html'))
    field = 'video_iframe_url' if kind in ('video', 'recording', 'live') else 'audio_iframe_url' if kind in ('audio', 'podcast') else 'reading_iframe_url'
    url = subject_content.safe_url(schema.get('iframe_url'))
    payload['lms_cleared_media_fields'] = sorted(MEDIA_FIELDS if inline else set(MEDIA_FIELDS) - {field})
    fields = dict.fromkeys(MEDIA_FIELDS)
    if not inline:
        fields[field] = url or None
    fields.update(source_system='old_lms', material_id=schema['material_id'], title=schema['material_title'],
                  content_type=kind, source_url=None if inline else url or None, payload=payload)
    if not stored_definition(fields)['available']:
        raise ValueError('Recovered material does not satisfy the existing learner content contract.')
    return fields


def make_plan(state, inventory, schemas):
    course_id = inventory['course_id']
    module_id = state['module']['module_catalogue_id']
    if str(course_id) != state['course']['source_course_ref'] or inventory['title'] != state['course']['source_course_title']:
        raise ValueError('The live inventory belongs to another course.')
    old_ids, week_ids = {}, {}
    for section in state['export']['sections']:
        sid = str(section.get('source_section_id') or section['section_id'])
        week_ids[sid] = section['week_id']
        for material in section['materials']:
            prefix = 'quiz' if material['component_kind'] == 'quiz' else 'material'
            ref = f"{prefix}:{material['source_component_id']}"
            if ref in old_ids:
                raise ValueError('The retained export has duplicate typed IDs.')
            old_ids[ref] = material['component_id']
    components = {c['id']: c for c in state['components']}
    weeks = {w['id']: w for w in state['weeks']}
    active = [d for d in state['definitions'] if d['deleted_at'] is None]
    definitions = {d['source_activity_id']: d for d in active}
    if len(definitions) != len(active):
        raise ValueError('Active source definitions have duplicate identities.')
    materials = {m['material_id']: m for m in state['materials']}
    plan = dict(weeks=[], components=[], materials=[], links=[], expected={})
    sections = {}
    for ref, fact in inventory['facts'].items():
        prefix, raw_id = ref.split(':')
        ident, section_id = int(raw_id), str(fact.get('section_id') or '')
        if (not section_id or ident != fact['component_id']
                or (prefix, fact['component_kind'], fact['post_type']) not in
                (('material', 'lesson', 'stm-lessons'), ('quiz', 'quiz', 'stm-quizzes'))):
            raise ValueError('Unverified section or typed component identity.')
        if ref not in definitions:
            raise ValueError('Missing catalogue definition needs separate verified import.')
        definition = definitions[ref]
        week_id = week_ids.get(section_id, f'WEEK-OLDLMS-{course_id}-{section_id}')
        component_id = old_ids.get(ref, f'COMP-OLDLMS-{course_id}-{prefix.upper()}-{ident}')
        section = dict(id=week_id, module_catalogue_id=module_id,
                       week_number=int(fact['section_order']), display_order=int(fact['section_order']) - 1,
                       title=fact['section_title'], is_programme_deleted=False)
        if section_id in sections and sections[section_id] != section:
            raise ValueError('Inconsistent section metadata in live inventory.')
        sections[section_id] = section
        if week_id in weeks and weeks[week_id]['deleted_at'] is not None:
            raise ValueError('Never resurrect an explicitly deleted week automatically.')
        if component_id in components:
            if components[component_id]['deleted_at'] is not None:
                raise ValueError('Never resurrect an explicitly deleted component automatically.')
        else:
            native_type, settings, quiz, hours = native_settings(fact, schemas[ident])
            plan['components'].append(dict(id=component_id, week_id=week_id, module_catalogue_id=module_id,
                type=native_type, title=fact['title'], description='', expected_otjh=hours.quantize(Decimal('.01')),
                points=0, reflection_required=False, workplace_evidence_required=False, tutor_validation_required=False,
                display_order=int(fact['component_order']) - 1, settings_json=settings, ksb_mappings=[],
                is_programme_deleted=False, _quiz=quiz, _duration_seconds=(fact.get('configured_duration_seconds')
                    if fact.get('configured_duration_seconds') is not None else (schemas[ident].get('content_duration') or {}).get('seconds'))))
        if definition['source_material_id'] not in (None, ident):
            raise ValueError('A material link points to a different source identity.')
        if ident in materials and materials[ident]['deleted_at'] is not None:
            raise ValueError('Never resurrect an explicitly deleted source material automatically.')
        if ident not in materials:
            plan['materials'].append(material_values(schemas[ident]))
        changes = {}
        if definition['curriculum_component_ref'] != component_id:
            changes['curriculum_component_ref'] = component_id
        if definition['source_material_id'] is None:
            changes['source_material_id'] = ident
        if changes:
            plan['links'].append(dict(id=definition['id'], fields=changes,
                previous={key: definition[key] for key in changes}))
        plan['expected'][ref] = component_id
    plan['weeks'] = [row for row in sections.values() if row['id'] not in weeks]
    return plan


def insert(cur, table, row):
    values = {k: Jsonb(v) if isinstance(v, (dict, list)) else v for k, v in row.items()}
    query = sql.SQL('INSERT INTO {} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier('curriculum', table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values))
    return cur.execute(query, list(values.values())).fetchone()['id']


def apply_plan(cur, state, plan, fingerprint):
    for table in ('weeks', 'materials'):
        for row in plan[table]:
            insert(cur, 'source_materials' if table == 'materials' else table, row)
    for index, row in enumerate(plan['components'], 1):
        fields = {k: v for k, v in row.items() if not k.startswith('_')}
        quiz = row['_quiz']
        if quiz:
            qid = insert(cur, 'quizzes', dict(title=row['title'][:255], module=state['module']['title'][:255],
                programme=state['module']['programme_name'], programme_id=state['module']['programme_id'],
                week_id=row['week_id'], questions=len(quiz['questions']), status='published', author='MBA legacy import',
                passing_grade=quiz['passing_percent'], duration=round(row['_duration_seconds'] / 60) if row['_duration_seconds'] else 60,
                time_unit='minutes', default_question_type='single_choice', assessment_type='quiz',
                mapped_components=1, linked_courses=1, schema_valid=True))
            for order, question in enumerate(quiz['questions'], 1):
                kind = 'multiple_choice' if len(question['solution_ids']) > 1 else 'single_choice'
                question_id = insert(cur, 'quiz_questions', dict(quiz_id=qid, question_text=question['text'],
                    question_type=kind, points=1, sort_order=order))
                for option_order, option in enumerate(question['options'], 1):
                    insert(cur, 'quiz_answers', dict(question_id=question_id, answer_text=option['text'],
                        is_correct=option['id'] in question['solution_ids'], sort_order=option_order))
            fields['settings_json'] = {**fields['settings_json'], 'linkedQuizId': str(qid)}
        insert(cur, 'components', fields)
        if quiz:
            insert(cur, 'quiz_component_links', dict(quiz_id=qid, component_id=row['id']))
            insert(cur, 'quiz_course_links', dict(quiz_id=qid, module_catalogue_id=row['module_catalogue_id'], week_id=row['week_id']))
        if index % 25 == 0:
            print(json.dumps({'stage': 'in_transaction', 'components_prepared': index}), flush=True)
    print(json.dumps({'stage': 'rows_inserted', 'components': len(plan['components']),
                      'materials': len(plan['materials'])}), flush=True)
    for link in plan['links']:
        assignments = sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(k)) for k in link['fields'])
        cur.execute(sql.SQL('UPDATE curriculum.source_activities SET {} WHERE id=%s AND source_course_id=%s').format(assignments),
                    [*link['fields'].values(), link['id'], state['course']['id']])
        if cur.rowcount != 1:
            raise ValueError('The source link is no longer in this course.')
    # Preserve meeting/session counts, calendar dates and manually authored totals.
    if plan['weeks']:
        cur.execute('''UPDATE curriculum.modules SET weeks_number=(SELECT count(*) FROM curriculum.weeks
            WHERE module_catalogue_id=%s AND deleted_at IS NULL) WHERE module_catalogue_id=%s''',
            [state['module']['module_catalogue_id']] * 2)


def verify(before, after, plan):
    for key in ('components', 'weeks', 'materials'):
        previous = {row['id']: row for row in before[key]}
        actual = {row['id']: row for row in after[key]}
        if any(actual.get(ident) != row for ident, row in previous.items()):
            raise ValueError('An existing ' + key + ' row changed.')
        if len(actual) != len(previous) + len(plan[key]):
            raise ValueError('Unexpected ' + key + ' row count.')
    links = {link['id']: link['fields'] for link in plan['links']}
    expected = [{**row, **links.get(row['id'], {})} for row in before['definitions']]
    if expected != after['definitions'] or before['course'] != after['course']:
        raise ValueError('Source metadata changed outside the planned links.')
    expected_module = dict(before['module'])
    if plan['weeks']:
        expected_module['weeks_number'] = sum(w['deleted_at'] is None for w in after['weeks'])
    if expected_module != after['module']:
        raise ValueError('Module schedule or authored metadata changed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot-dir', type=Path, required=True)
    parser.add_argument('--module-id', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and not (args.expected_target and args.expected_fingerprint):
        parser.error('Apply requires the target and fingerprint from a preview.')
    inventory = json.loads((args.snapshot_dir / 'live-inventory.json').read_text(encoding='utf-8'))
    age = datetime.now(timezone.utc) - datetime.fromisoformat(inventory['fetched_at'])
    if not 0 <= age.total_seconds() <= 86400 or inventory.get('verified_source_accounts', 0) < 1:
        raise ValueError('A recent verified live course inventory is required.')
    schemas = {int(p.stem.split('-')[1]): json.loads(p.read_text(encoding='utf-8'))
               for p in args.snapshot_dir.glob('material-*.json')}
    subject_content.settings = SimpleNamespace(KBC_LMS_API_KEY=env_values().get('KBC_LMS_API_KEY', ''),
        KBC_LMS_SCHEMA_URL='https://kentbusinesscollege.org/wp-json/kbc-lms/v1/all-students-schema')
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        cur = conn.cursor()
        cur.execute("SET LOCAL statement_timeout='90s'")
        cur.execute("SET LOCAL lock_timeout='5s'")
        target = digest({'host': conn.info.host, 'database': conn.info.dbname})[:16]
        if args.apply and target != args.expected_target:
            raise ValueError('The actual database differs from the preview.')
        if args.apply:
            cur.execute('SELECT module_catalogue_id FROM curriculum.modules WHERE module_catalogue_id=%s FOR UPDATE', [args.module_id])
            cur.execute('SELECT id FROM curriculum.source_courses WHERE curriculum_module_ref=%s ORDER BY id FOR UPDATE', [args.module_id])
        state = read_state(cur, inventory['course_id'], args.module_id)
        plan = make_plan(state, inventory, schemas)
        fingerprint = digest({'state': state, 'inventory': inventory, 'schemas': schemas, 'plan': plan})
        result = dict(target=target, fingerprint=fingerprint, source_components=len(plan['expected']),
            new_weeks=len(plan['weeks']), new_components=len(plan['components']), new_materials=len(plan['materials']),
            source_links=len(plan['links']), new_quizzes=sum(bool(r['_quiz']) for r in plan['components']),
            types=dict(Counter(r['type'] for r in plan['components'])), applied=False)
        if args.apply:
            if fingerprint != args.expected_fingerprint:
                raise ValueError('Content changed after preview; generate a fresh preview.')
            invariant = preserved(cur, args.module_id, state['course']['id'])
            apply_plan(cur, state, plan, fingerprint)
            after = read_state(cur, inventory['course_id'], args.module_id)
            verify(state, after, plan)
            pending = make_plan(after, inventory, schemas)
            if any(pending[key] for key in ('weeks', 'components', 'materials', 'links')):
                raise ValueError('The recovery is not idempotent.')
            if preserved(cur, args.module_id, state['course']['id']) != invariant:
                raise ValueError('Learner records or other course content changed.')
            result.update(applied=True, verified=True, idempotent=True, learner_records_preserved=True,
                          native_components_after=len(after['components']), other_courses_preserved=True)
            audit = cur.execute('''INSERT INTO "Learner".activity_sync_runs
                (run_key,run_kind,status,dry_run,finished_at,source_counts,result_counts)
                VALUES(%s,%s,'completed',false,now(),%s,%s) RETURNING id''',
                [RUN_KIND + ':' + fingerprint, RUN_KIND,
                 Jsonb({'course_id': inventory['course_id'], 'module_id': args.module_id,
                        'added_components': [row['id'] for row in plan['components']],
                        'added_weeks': [row['id'] for row in plan['weeks']], 'previous_links': plan['links']}),
                 Jsonb(result)]).fetchone()['id']
            result['audit_run'] = audit
    print(json.dumps(result, default=str))
    (args.snapshot_dir / ('applied.json' if args.apply else 'preview.json')).write_text(
        json.dumps(result, default=str, indent=2), encoding='utf-8')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, psycopg.Error) as error:
        print(json.dumps({'error': str(error) if isinstance(error, ValueError) else type(error).__name__}))
        raise SystemExit(1)
