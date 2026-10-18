"""Read-only inventory of learner-facing quiz keys, regardless of draft status.

Includes published quizzes, active component/module links, week metadata and
week-template links. Reports unused incomplete drafts separately. No startup,
schema helpers, learner records, repairs or automatic answer selection.
"""
import argparse
from collections import defaultdict
import json
import os
from pathlib import Path
import sys

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

from quiz_api.answer_keys import quiz_submission_error
from quiz_api.key_readiness import linked_quiz_ids


def inspect_quizzes(quizzes, questions, linked):
    by_quiz = defaultdict(list)
    for question in questions:
        by_quiz[question['quizId']].append(question)
    blocked = []
    incomplete_drafts = 0
    checked = 0
    for quiz in quizzes:
        if quiz['status'] in {'trash', 'archived'} or quiz['packageType'] == 'scorm':
            continue
        available = quiz['status'] == 'published' or quiz['id'] in linked
        error = quiz_submission_error({'questions': by_quiz[quiz['id']]}, {})
        if available:
            checked += 1
            if error:
                blocked.append({**quiz, 'linked': quiz['id'] in linked, 'reason': error})
        elif error and quiz['status'] == 'draft':
            incomplete_drafts += 1
    return {'quizzesInventoried': len(quizzes), 'availableQuizzesChecked': checked,
            'blockedAvailableQuizzes': len(blocked), 'unusedIncompleteDrafts': incomplete_drafts,
            'blocked': blocked}


def audit(output, settings_root=BACKEND):
    sys.path.insert(0, str(settings_root.resolve()))
    from django.conf import settings
    import psycopg
    config = settings.DATABASES['default']
    with psycopg.connect(host=config['HOST'], port=config.get('PORT') or 5432,
                        dbname=config['NAME'], user=config['USER'], password=config['PASSWORD'],
                        sslmode='require', connect_timeout=10) as conn:
        conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='60s'")
            linked = linked_quiz_ids(cursor)
            cursor.execute('SELECT id,title,status,package_type FROM curriculum.quizzes ORDER BY id')
            quizzes = [dict(zip(('id', 'title', 'status', 'packageType'), row)) for row in cursor.fetchall()]
            cursor.execute('''SELECT q.quiz_id,q.id,q.question_type,
                coalesce(jsonb_agg(jsonb_build_object('text',a.answer_text,'isCorrect',a.is_correct)
                    ORDER BY a.sort_order,a.id) FILTER(WHERE a.id IS NOT NULL),'[]'::jsonb)
                FROM curriculum.quiz_questions q
                LEFT JOIN curriculum.quiz_answers a ON a.question_id=q.id
                WHERE NOT q.is_archived GROUP BY q.id ORDER BY q.quiz_id,q.sort_order,q.id''')
            questions = [dict(zip(('quizId', 'id', 'type', 'answers'), row)) for row in cursor.fetchall()]
    result = inspect_quizzes(quizzes, questions, linked)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    parser.add_argument('--settings-root', type=Path, default=BACKEND)
    args = parser.parse_args()
    result = audit(args.output, args.settings_root)
    print(json.dumps({key: value for key, value in result.items() if key != 'blocked'}))
    sys.exit(1 if result['blocked'] else 0)
