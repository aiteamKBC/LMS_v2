"""Read-only verification of extracted assignment cards; prints counts, not file text."""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
from config.settings import DATABASES
from learner_api.assignment_content import load_assignment_content
import psycopg
from psycopg.rows import dict_row


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', required=True)
    args = parser.parse_args()
    db = DATABASES['enrolment']
    with psycopg.connect(dbname=db['NAME'], user=db['USER'], password=db['PASSWORD'],
                        host=db['HOST'], port=db.get('PORT') or 5432, sslmode='require',
                        connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute('''SELECT evidence_id, evidence_name, evidence_status, file_blob,
                       feedbacks, source_hash, updated_at AS source_updated_at
                FROM fetching_evidence.evidence_items
                WHERE evidence_name ILIKE %s AND file_blob IS NOT NULL
                ORDER BY evidence_id LIMIT 3''', [args.name])
            rows = cur.fetchall()
    for row in rows:
        feedbacks = row['feedbacks'] or []
        if isinstance(feedbacks, str):
            feedbacks = json.loads(feedbacks)
        result = load_assignment_content(row, feedbacks)
        print(json.dumps({'evidenceId': row['evidence_id'], 'name': row['evidence_name'],
            'cards': [{'title': c['title'], 'sections': len(c['sections']),
                       'characters': sum(len(s['text']) for s in c['sections'])} for c in result['cards']],
            'notices': result['notices']}, ensure_ascii=True))
    if not rows:
        print('No matching source file found.')


if __name__ == '__main__':
    main()
