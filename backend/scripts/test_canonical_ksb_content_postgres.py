"""Run content-cache parity inside the verified disposable cluster lifecycle."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import psycopg
import test_source_activity_ksbs_postgres as isolated


def run(config):
    with psycopg.connect(**config,autocommit=True) as db:
        directory = db.execute("SELECT current_setting('data_directory')").fetchone()[0]
        db.execute('CREATE DATABASE kbc_content_cache_test_canonical')
    target = {**config,'dbname':'kbc_content_cache_test_canonical','password':''}
    path = Path(tempfile.mkdtemp(prefix='lms_ksb_content_')) / 'local-test.json'
    path.write_text(json.dumps(target),encoding='utf-8')
    runner = Path(__file__).resolve().parents[1]/'curriculum_api/run_content_cache_postgres_tests.py'
    return subprocess.run([sys.executable,str(runner),'--connection-file',str(path),
                           '--data-directory',directory]).returncode == 0


if __name__ == '__main__':
    isolated.run = run
    raise SystemExit(isolated.main())
