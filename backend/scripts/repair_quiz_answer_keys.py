"""Apply an explicitly reviewed quiz-key manifest without rewriting learner history.

Dry-run by default. Requires the expected database fingerprint for --apply.
No Django startup, schema helpers, external services, deletes or historical regrading.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from quiz_api.answer_keys import quiz_submission_error

STATE_FIELDS = ('id', 'quizId', 'text', 'type', 'points', 'sortOrder',
                'explanation', 'imageUrl', 'archived', 'answers')
ALLOWED_TYPES = {'single_choice', 'multiple_choice', 'true_false', 'matching',
                 'image_matching', 'ordering', 'keywords', 'fill_gap'}


def fingerprint(state):
    value = {key: state[key] for key in STATE_FIELDS}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def proposed_question(state, repair):
    if state['id'] != repair['questionId'] or state['quizId'] != repair['quizId']:
        raise ValueError('Question ownership changed.')
    if state['archived'] or fingerprint(state) != repair['beforeSha256']:
        raise ValueError(f"Question {state['id']} changed; review a fresh plan.")
    if not repair.get('evidence') or not repair.get('rationale'):
        raise ValueError('Each correction needs evidence and a rationale.')
    result = deepcopy(state)
    replacement = repair.get('replacement')
    if replacement:
        # Keep the original question and every original answer for old attempts.
        result['text'] = replacement['text']
        result['type'] = replacement['type']
        result['answers'] = []
    else:
        result['type'] = repair.get('type', state['type'])
        flags = repair.get('flags', {})
        if set(flags) != {str(a['id']) for a in state['answers']}:
            raise ValueError('The plan must account for every existing answer ID.')
        if any(type(value) is not bool for value in flags.values()):
            raise ValueError('Answer flags must be booleans.')
        for answer in result['answers']:
            answer['isCorrect'] = flags[str(answer['id'])]
    additions = replacement['answers'] if replacement else repair.get('additions', [])
    for index, answer in enumerate(additions):
        if not isinstance(answer.get('text'), str) or not answer['text'].strip():
            raise ValueError('Added answers must have nonblank text.')
        if type(answer.get('isCorrect')) is not bool:
            raise ValueError('Added answer flags must be booleans.')
        result['answers'].append({**answer, 'id': -(index + 1),
                                  'sortOrder': len(state['answers']) + index})
    if result['type'] not in ALLOWED_TYPES:
        raise ValueError('Unsupported question type.')
    error = quiz_submission_error({'questions': [result]}, {})
    if error:
        raise ValueError(error)
    return result


def fetch_questions(cursor, quiz_ids):
    cursor.execute('''
        SELECT q.id, q.quiz_id, q.question_text, q.question_type, q.points,
               q.sort_order, q.explanation, q.image_url, q.is_archived,
               coalesce(jsonb_agg(jsonb_build_object(
                   'id',a.id,'text',a.answer_text,'isCorrect',a.is_correct,
                   'sortOrder',a.sort_order) ORDER BY a.sort_order,a.id)
                   FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb)
        FROM curriculum.quiz_questions q
        LEFT JOIN curriculum.quiz_answers a ON a.question_id=q.id
        WHERE q.quiz_id=ANY(%s) AND NOT q.is_archived
        GROUP BY q.id ORDER BY q.quiz_id,q.sort_order,q.id
    ''', [quiz_ids])
    return [dict(zip(STATE_FIELDS, row)) for row in cursor.fetchall()]


def validate_plan(states, manifest):
    by_id = {state['id']: state for state in states}
    repaired = {}
    for repair in manifest['repairs']:
        qid = repair['questionId']
        if qid in repaired:
            raise ValueError('A question appears twice in the manifest.')
        repaired[qid] = proposed_question(by_id[qid], repair)
    by_quiz = {}
    for state in states:
        by_quiz.setdefault(state['quizId'], []).append(repaired.get(state['id'], state))
    if set(by_quiz) != set(manifest['quizIds']):
        raise ValueError('A targeted quiz is missing.')
    for questions in by_quiz.values():
        if error := quiz_submission_error({'questions': questions}, {}):
            raise ValueError(error)
    return repaired


def apply_manifest(conn, manifest, backup_path):
    quiz_ids = sorted(manifest['quizIds'])
    with conn.transaction():
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout='5s'")
            cursor.execute("SET LOCAL statement_timeout='60s'")
            # Prevent concurrent question/answer inserts while checking identities.
            # Locks last only for this transaction and fail rather than wait forever.
            cursor.execute('LOCK TABLE curriculum.quiz_questions, curriculum.quiz_answers '
                           'IN SHARE ROW EXCLUSIVE MODE')
            cursor.execute('SELECT id FROM curriculum.quizzes WHERE id=ANY(%s) '
                           'ORDER BY id FOR UPDATE', [quiz_ids])
            if [row[0] for row in cursor.fetchall()] != quiz_ids:
                raise ValueError('Quiz identity changed.')
            cursor.execute("SELECT tgname FROM pg_trigger WHERE tgrelid IN "
                           "('curriculum.quiz_questions'::regclass, "
                           "'curriculum.quiz_answers'::regclass) AND NOT tgisinternal")
            if cursor.fetchall():
                raise ValueError('Review database trigger side effects before applying.')
            before = fetch_questions(cursor, quiz_ids)
            validate_plan(before, manifest)
            # Exclusive creation: an existing backup may belong to an earlier run.
            with Path(backup_path).open('x', encoding='utf-8') as stream:
                json.dump(before, stream, ensure_ascii=False, indent=2)
            by_id = {q['id']: q for q in before}
            counts = {'flag_updates': 0, 'added_answers': 0, 'replaced_questions': 0,
                      'type_updates': 0}
            for repair in manifest['repairs']:
                state = by_id[repair['questionId']]
                replacement = repair.get('replacement')
                if replacement:
                    cursor.execute('UPDATE curriculum.quiz_questions SET is_archived=true, '
                                   'updated_at=now() WHERE id=%s', [state['id']])
                    cursor.execute('INSERT INTO curriculum.quiz_questions '
                                   '(quiz_id,question_text,question_type,points,sort_order,explanation,'
                                   'image_url,is_archived) VALUES (%s,%s,%s,%s,%s,%s,%s,false) RETURNING id',
                                   [state['quizId'], replacement['text'], replacement['type'], state['points'],
                                    state['sortOrder'], replacement.get('explanation', ''), ''])
                    question_id = cursor.fetchone()[0]
                    additions = replacement['answers']
                    counts['replaced_questions'] += 1
                    next_order = 0
                else:
                    question_id = state['id']
                    if repair.get('type', state['type']) != state['type']:
                        cursor.execute('UPDATE curriculum.quiz_questions SET question_type=%s, '
                                       'updated_at=now() WHERE id=%s', [repair['type'], question_id])
                        counts['type_updates'] += 1
                    for answer in state['answers']:
                        desired = repair['flags'][str(answer['id'])]
                        if desired != answer['isCorrect']:
                            cursor.execute('UPDATE curriculum.quiz_answers SET is_correct=%s, '
                                           'updated_at=now() WHERE id=%s AND question_id=%s',
                                           [desired, answer['id'], question_id])
                            if cursor.rowcount != 1:
                                raise ValueError('Answer ownership changed.')
                            counts['flag_updates'] += 1
                    additions = repair.get('additions', [])
                    next_order = max((a['sortOrder'] for a in state['answers']), default=-1) + 1
                for offset, answer in enumerate(additions):
                    cursor.execute('INSERT INTO curriculum.quiz_answers '
                                   '(question_id,answer_text,is_correct,sort_order) VALUES (%s,%s,%s,%s)',
                                   [question_id, answer['text'], answer['isCorrect'], next_order + offset])
                    counts['added_answers'] += 1
            after = fetch_questions(cursor, quiz_ids)
            by_quiz = {}
            for q in after:
                by_quiz.setdefault(q['quizId'], []).append(q)
            for quiz_id in quiz_ids:
                old = [q for q in before if q['quizId'] == quiz_id]
                new = by_quiz[quiz_id]
                if len(old) != len(new) or sum(q['points'] for q in old) != sum(q['points'] for q in new):
                    raise ValueError('Quiz question count or total points changed.')
                if error := quiz_submission_error({'questions': new}, {}):
                    raise ValueError(error)
    return {'quizzes': len(quiz_ids), 'questions_repaired': len(manifest['repairs']), **counts,
            'learner_history_writes': False, 'regrading': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--settings-root', type=Path, default=BACKEND)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expect-database')
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    # Load the selected existing environment without copying/changing .env files.
    sys.path.insert(0, str(args.settings_root.resolve()))
    import os
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    from django.conf import settings
    import psycopg
    config = settings.DATABASES['enrolment']
    target = hashlib.sha256(f"{config['HOST']}:{config['NAME']}".encode()).hexdigest()[:16]
    print(json.dumps({'database_fingerprint': target, 'apply': args.apply}), flush=True)
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    if args.apply and (args.expect_database != target or not args.backup or not args.receipt):
        raise ValueError('--apply needs the matching fingerprint, backup and receipt paths.')
    if args.apply and args.receipt.exists():
        raise ValueError('Receipt already exists; review the previous run before retrying.')
    with psycopg.connect(host=config['HOST'], port=config.get('PORT') or 5432,
                        dbname=config['NAME'], user=config['USER'], password=config['PASSWORD'],
                        sslmode='require', connect_timeout=10, autocommit=True) as conn:
        if args.apply:
            result = apply_manifest(conn, manifest, args.backup)
            args.receipt.write_text(json.dumps(result, indent=2), encoding='utf-8')
        else:
            conn.read_only = True
            with conn.cursor() as cursor:
                cursor.execute("SET statement_timeout='60s'")
                states = fetch_questions(cursor, manifest['quizIds'])
                validate_plan(states, manifest)
            result = {'quizzes': len(manifest['quizIds']), 'questions_repaired': len(manifest['repairs']),
                      'validation': 'PASS', 'database_writes': False}
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
