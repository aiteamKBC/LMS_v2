"""Read current progress KSB counts for learner_id=315 without historical targets.

No Django app startup, schema repair, writes or external integration calls.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import psycopg
from config import settings
from learner_api.aptem_ksb_breakdown import read_breakdown


def main():
    cfg = settings.DATABASES['enrolment']
    print('Target: configured enrolment database; name:', cfg['NAME'])
    with psycopg.connect(dbname=cfg['NAME'], host=cfg['HOST'], port=cfg['PORT'],
                         user=cfg['USER'], password=cfg['PASSWORD'], connect_timeout=10,
                         sslmode=cfg.get('OPTIONS', {}).get('sslmode', 'require')) as connection:
        connection.read_only = True
        with connection.cursor() as cursor:
            cursor.execute('SET LOCAL statement_timeout = 15000')
            cursor.execute("SELECT current_database(),current_setting('transaction_read_only')")
            database, read_only = cursor.fetchone()
            if database != cfg['NAME'] or read_only != 'on':
                raise RuntimeError('Read-only target verification failed.')
            cursor.execute('SELECT id,aptem_id FROM "Learner".learners WHERE id=%s', [315])
            if cursor.fetchall() != [(315, 4110)]:
                raise RuntimeError('Requested learner identity verification failed.')
            cursor.execute('''SELECT COUNT(DISTINCT k.ksb_code),
                COUNT(DISTINCT k.ksb_code) FILTER (WHERE p.activity_status='completed' AND p.accepted IS TRUE)
                FROM "Learner".learner_progress_entries p
                JOIN "Learner".learner_progress_ksbs k ON k.progress_id=p.id
                WHERE p.learner_id=%s AND p.deleted_at IS NULL''', [315])
            total, achieved = cursor.fetchone()
        result = read_breakdown(connection, 315)
        actual = [result[key] for key in ('totalKsbs', 'achievedKsbs', 'remainingKsbs')]
        if actual != [total, achieved, total-achieved]:
            raise AssertionError('Breakdown differs from direct progress COUNT(DISTINCT) query.')
        print('learner_id=315 / aptem_id=4110; Total/Achieved/Remaining:', actual)
        print('Read-only: verified; aggregate query matches breakdown; no historical target asserted.')


if __name__ == '__main__':
    main()
