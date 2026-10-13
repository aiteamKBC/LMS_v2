"""Read-only quiz/key audit. Exports curriculum identifiers, never learner data.

Run from backend: .venv/Scripts/python.exe scripts/audit_quiz_answer_keys.py OUTPUT.csv
No Django startup, schema helpers, updates, or historical regrading.
"""
import csv
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.conf import settings
import psycopg
from quiz_api.answer_keys import choice_key_error


def audit(output):
    config = settings.DATABASES["default"]
    issues = []
    totals = Counter()
    with psycopg.connect(host=config["HOST"], dbname=config["NAME"], user=config["USER"],
                         password=config["PASSWORD"], port=config.get("PORT") or 5432,
                         sslmode="require", connect_timeout=10) as conn:
        conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = 60000")
            cursor.execute("""
                SELECT z.id, z.title, z.status, q.id, q.sort_order, q.question_type,
                       coalesce(jsonb_agg(jsonb_build_object('text', a.answer_text, 'isCorrect', a.is_correct)
                           ORDER BY a.sort_order, a.id) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb)
                FROM curriculum.quizzes z JOIN curriculum.quiz_questions q ON q.quiz_id=z.id
                LEFT JOIN curriculum.quiz_answers a ON a.question_id=q.id
                WHERE NOT q.is_archived AND z.status <> 'trash'
                  AND q.question_type IN ('single_choice', 'multiple_choice', 'true_false')
                GROUP BY z.id, z.title, z.status, q.id, q.sort_order, q.question_type
                ORDER BY z.id, q.sort_order, q.id
            """)
            for quiz_id, title, status, question_id, position, kind, answers in cursor:
                totals[f"{status}_choice_questions_checked"] += 1
                error = choice_key_error(kind, answers, strict_duplicates=True)
                if error:
                    issues.append([quiz_id, title, status, question_id, position + 1, kind, error])
                    totals[f"{status}_questions_needing_review"] += 1
            # Aggregate diagnostics only: do not fetch learner identities or attempt bodies.
            cursor.execute('''
                SELECT count(*),
                    count(*) FILTER (WHERE q.id IS NULL),
                    count(*) FILTER (WHERE r.chosen_answer_ref IS NOT NULL AND a.id IS NULL),
                    count(*) FILTER (WHERE r.is_correct=false AND a.id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM "Learner".learner_quiz_correct_answers k
                        JOIN curriculum.quiz_answers c ON c.id=k.answer_ref
                        WHERE k.quiz_answer_id=r.id AND c.question_id=r.question_ref
                          AND lower(regexp_replace(trim(c.answer_text), '\\s+', ' ', 'g'))=
                              lower(regexp_replace(trim(a.answer_text), '\\s+', ' ', 'g'))
                    ))
                FROM "Learner".learner_quiz_answers r
                LEFT JOIN curriculum.quiz_questions q ON q.id=r.question_ref
                LEFT JOIN curriculum.quiz_answers a ON a.id=r.chosen_answer_ref AND a.question_id=r.question_ref
            ''')
            names = ["historical_answers_checked", "historical_question_missing", "historical_single_choice_id_missing", "historical_incorrect_with_identical_chosen_and_correct_text"]
            totals.update(dict(zip(names, cursor.fetchone())))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(["quiz_id", "quiz_title", "status", "question_id", "question_number", "question_type", "issue"])
        # Prevent spreadsheet formula execution when a title comes from authored content.
        writer.writerows([["'" + value if isinstance(value, str) and value.startswith(("=", "+", "-", "@")) else value for value in row] for row in issues])
    summary = dict(totals)
    summary["quizzes_needing_review"] = len({row[0] for row in issues})
    summary["published_quizzes_needing_review"] = len({row[0] for row in issues if row[2] == "published"})
    summary["scope"] = "Structural key validation only; no semantic assessment of course content. Historical totals are diagnostics, not corrected grades. No database writes."
    output.with_suffix(".json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    audit(sys.argv[1])
