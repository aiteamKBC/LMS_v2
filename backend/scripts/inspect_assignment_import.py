"""Run SELECT-only import diagnostics in a database-enforced read-only session.

Usage: python scripts/inspect_assignment_import.py audit path/to/query.sql
No Django app startup, model hooks, or database writes are performed.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.settings import DATABASES
import psycopg
from psycopg.rows import dict_row


def main():
    db = DATABASES[sys.argv[1]]
    sql = Path(sys.argv[2]).read_text(encoding="utf-8-sig")
    statement = '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--'))
    if not statement.lstrip().lower().startswith(('select ', 'with ')):
        raise SystemExit('Only SELECT diagnostics are supported.')
    try:
        with psycopg.connect(
            dbname=db['NAME'], user=db['USER'], password=db['PASSWORD'],
            host=db['HOST'], port=db.get('PORT') or 5432,
            sslmode='require', connect_timeout=10,
            row_factory=dict_row,
        ) as conn:
            conn.read_only = True
            with conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = '20s'")
                cur.execute(sql)
                print(json.dumps(cur.fetchall(), default=str, ensure_ascii=True, indent=2))
    except psycopg.Error as exc:
        # Connection errors can contain infrastructure details; do not print DSNs.
        message = exc.diag.message_primary or str(exc)
        for key in ('PASSWORD', 'HOST', 'USER', 'NAME'):
            if db.get(key):
                message = message.replace(str(db[key]), '[redacted]')
        print(json.dumps({'error': type(exc).__name__, 'sqlstate': exc.sqlstate,
                          'message': message}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
