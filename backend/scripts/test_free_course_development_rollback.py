"""Explicit Development-only rehearsal. All DDL and synthetic data roll back.

Does not apply/record migrations. Authentication is synthetic; endpoint SQL,
grading, attempt persistence and completion use the real Development database.
"""
import importlib
import json
import logging.config
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'
os.environ['LEARNER_API_REQUIRE_AUTH'] = '1'
from django.db.backends.base.base import BaseDatabaseWrapper
with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Startup DB forbidden')), patch.object(logging.config, 'dictConfig'):
    import django
    django.setup()

from django.db import connections, transaction
from django.db.backends.postgresql.base import DatabaseWrapper
from django.test import RequestFactory
from learner_api import free_courses_view as view
from login import permissions
from verify_inclusion_canonical_targets import connect_development


def main():
    raw = connect_development()  # Endpoint, database, branch and read-only verified first.
    baseline = raw.execute('SELECT count(*) FROM "Learner".subject_activity_attempts').fetchone()[0]
    raw.rollback()
    raw.read_only = False
    raw.autocommit = True
    config = dict(connections['default'].settings_dict, ENGINE='django.db.backends.postgresql',
                  NAME=raw.info.dbname, HOST=raw.info.host, USER=raw.info.user, PORT=raw.info.port,
                  OPTIONS={}, TIME_ZONE=None)
    db = DatabaseWrapper(config, alias='default')
    from django.db.backends.postgresql.psycopg_any import register_tzloader
    from psycopg import ClientCursor
    from psycopg.types.string import TextLoader
    register_tzloader(db.timezone, raw)
    raw.adapters.register_loader('jsonb', TextLoader)
    raw.cursor_factory = ClientCursor
    db.connection = raw
    db.autocommit = True
    old = {key: connections[key] for key in ('default', 'enrolment')}
    for key in old:
        connections[key] = db
    owner = -2026112301
    checks = []
    try:
        with transaction.atomic(using='default'):
            try:
                with db.cursor() as cursor:
                    cursor.execute("SET LOCAL lock_timeout='5s'")
                    cursor.execute("SET LOCAL statement_timeout='30s'")
                    cursor.execute("SELECT current_setting('neon.branch_id',true)")
                    assert cursor.fetchone()[0] == 'br-raspy-sky-abvs8lq9'
                # Only the two requested operations; no executor/prerequisite replay,
                # no fake history, and no commit at the end of this rehearsal.
                with db.schema_editor(atomic=False) as editor:
                    for name in ('0029_free_course_historical_bridges', '0030_canonical_free_course_attempts'):
                        importlib.import_module('learner_api.migrations.' + name).install(None, editor)
                checks.append('0029/0030 operations compatible in rollback transaction')
                with db.cursor() as cursor:
                    cursor.execute('''SELECT a.id,w.course_id,(a.settings_json->>'linkedQuizId')::bigint
                        FROM curriculum.free_programme_components a
                        JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
                        JOIN curriculum.quizzes q ON q.id=CASE WHEN a.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
                          THEN (a.settings_json->>'linkedQuizId')::bigint END
                        WHERE a.type ILIKE '%quiz%' AND a.deleted_at IS NULL
                          AND w.deleted_at IS NULL AND w.status='active' AND q.status='published'
                        ORDER BY a.id''')
                    candidates = cursor.fetchall()
                chosen = None
                for component, course, quiz_id in candidates:
                    quiz = view._fetch_quiz(quiz_id)
                    if quiz and quiz['questions'] and all(q['type'] == 'single_choice' and
                            sum(bool(a['isCorrect']) for a in q['answers']) == 1 for q in quiz['questions']):
                        chosen = component, course, quiz
                        break
                assert chosen, 'No supported published fixture quiz found'
                component, course, quiz = chosen
                with db.cursor() as cursor:
                    cursor.execute('''INSERT INTO "Learner".learners
                        (id,full_name,email,lifecycle_status,learner_type,programme_status)
                        VALUES (%s,'Rollback Free Course Test','free-course-rollback@example.invalid',
                        'active','commercial','Active')''', [owner])
                    cursor.execute('''INSERT INTO "Learner".learner_free_courses
                        (id,learner_id,free_course_ref,position) VALUES (%s,%s,%s,1)''', [owner,owner,course])
                    cursor.execute('''INSERT INTO "Learner".learner_free_course_progress
                        (id,learner_id,free_course_ref,component_ref) VALUES (%s,%s,%s,%s)''',
                        [owner,owner,course,component])
                learner = SimpleNamespace(pk=owner,enrolment_id=19,learner_type='commercial',
                                          lifecycle_status='active',programme_status='Active')
                account = SimpleNamespace(role='learner',subject_id=19,subject_type='learner')
                factory = RequestFactory()
                answers = {str(q['id']): next(a['id'] for a in q['answers'] if a['isCorrect']) for q in quiz['questions']}
                def submit(answers, attempt_id):
                    request = factory.post('/', data=json.dumps({'answers':answers,'submissionId':attempt_id}), content_type='application/json')
                    response = view.submit_free_course_quiz(request,kind='commercial',pk=19,component_id=component)
                    return response.status_code,json.loads(response.content)
                with patch.object(permissions,'authenticate_request',return_value=account), patch.object(view,'_resolve_source',return_value=(learner,None)):
                    failed_id, passed_id = str(uuid4()),str(uuid4())
                    status, failed = submit({}, failed_id)
                    assert status == 200 and not failed['passed'], (status, failed)
                    status, passed = submit(answers, passed_id)
                    assert status == 200 and passed['passed'], (status, passed)
                    assert submit(answers, passed_id) == (status, passed)
                    assert submit({}, passed_id)[0] == 409
                    checks.extend(['failed attempt saved','passing attempt completes','retry idempotent','conflicting retry rejected'])
                    with db.cursor() as cursor:
                        cursor.execute('SELECT count(*) FROM "Learner".subject_activity_attempts WHERE learner_id=%s',[owner])
                        assert cursor.fetchone()[0] == 2
                        cursor.execute('SELECT is_completed FROM "Learner".learner_free_course_progress WHERE learner_id=%s',[owner])
                        assert cursor.fetchone()[0] is True
                        cursor.execute('SELECT count(*) FROM "Learner".learner_progress_entries WHERE learner_id=%s',[owner])
                        assert cursor.fetchone()[0] == 0
                        cursor.execute('UPDATE "Learner".learners SET lifecycle_status=%s,programme_status=%s WHERE id=%s', ['withdrawn','Withdrawn',owner])
                    # Simulate a request whose status was read before withdrawal:
                    # the locked writer must independently reject it.
                    assert submit(answers,str(uuid4()))[0] == 409
                    with db.cursor() as cursor:
                        cursor.execute('''SELECT a.id FROM curriculum.free_programme_components a
                          JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id
                          WHERE w.course_id=%s AND a.type='reading' AND a.deleted_at IS NULL
                            AND w.deleted_at IS NULL AND w.status='active' LIMIT 1''', [course])
                        material = cursor.fetchone()
                    assert material, 'Selected test course needs a reading activity'
                    response = view.complete_free_course_activity(factory.post('/',
                        data=json.dumps({'componentId':material[0]}), content_type='application/json'),
                        kind='commercial',pk=19)
                    assert response.status_code == 403
                    checks.append('material withdrawal race rejected')
                    learner.lifecycle_status = 'withdrawn'
                    assert submit(answers,str(uuid4()))[0] == 403
                    assert view.free_courses(factory.get('/'),kind='commercial',pk=19).status_code == 403
                    account.role = 'staff'
                    assert view.free_courses(factory.get('/'),kind='commercial',pk=19).status_code == 200
                    assert view.free_course_detail(factory.get('/'),kind='commercial',pk=19,course_id=course).status_code == 200
                    response = view.free_course_quiz(factory.get('/'),kind='commercial',pk=19,component_id=component)
                    history = json.loads(response.content)
                    assert response.status_code == 200 and history['historyOnly'] and len(history['attempts']) == 2
                    assert submit(answers,str(uuid4()))[0] == 403
                    checks.extend(['no hours ledger writes','withdrawal race rejected','withdrawn learner denied',
                                   'staff reads history','staff submit denied'])
            finally:
                transaction.set_rollback(True, using='default')
        with db.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM "Learner".learners WHERE id=%s',[owner])
            assert cursor.fetchone()[0] == 0
            cursor.execute('SELECT count(*) FROM "Learner".subject_activity_attempts')
            assert cursor.fetchone()[0] == baseline
            cursor.execute("SELECT is_nullable FROM information_schema.columns WHERE table_schema='Learner' AND table_name='subject_activity_attempts' AND column_name='group_id'")
            assert cursor.fetchone()[0] == 'NO', 'Rehearsal schema was not rolled back'
        print(json.dumps({'checks':checks,'rolled_back':True,'migration_history_changed':False}))
    finally:
        raw.rollback()
        raw.close()
        for key,value in old.items():
            connections[key] = value


if __name__ == '__main__':
    main()
