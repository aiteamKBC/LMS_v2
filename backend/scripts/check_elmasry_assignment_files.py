"""Read-only HEAD checks for the pilot's original Azure files and reports."""
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
from config.settings import DATABASES
from learner_api.evidence_storage import _service_client
import psycopg


def main():
    db = DATABASES['enrolment']
    with psycopg.connect(dbname=db['NAME'], user=db['USER'], password=db['PASSWORD'],
                        host=db['HOST'], port=db.get('PORT') or 5432,
                        sslmode='require', connect_timeout=10) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute('''SELECT DISTINCT e.evidence_id, e.file_blob, e.report_blob
                FROM fetching_evidence.assignment_classification_evaluations v
                JOIN fetching_evidence.evidence_items e
                  ON e.learner_id = v.learner_id AND e.component_id = v.component_id
                  AND (e.evidence_id = v.evidence_id OR v.source_evidence_ids @> to_jsonb(e.evidence_id))
                WHERE v.run_id = 4 AND v.learner_id = 92''')
            rows = cur.fetchall()
    items = [(row[0], part, row[i]) for row in rows for i, part in [(1, 'file'), (2, 'report')]]
    def check(item):
        evidence_id, part, blob = item
        if not blob:
            return (evidence_id, part, 'missing reference')
        try:
            with _service_client(retry_total=0) as service:
                properties = service.get_blob_client('fetch-aptem-evidences', blob).get_blob_properties(
                    connection_timeout=10, read_timeout=15)
            return (evidence_id, part, 'ok' if properties.size > 0 else 'empty')
        except Exception as exc:
            return (evidence_id, part, type(exc).__name__)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(check, items))
    failed = [item for item in results if item[2] != 'ok']
    print({'checked': len(results), 'available': len(results) - len(failed), 'failures': failed})
    if failed:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
