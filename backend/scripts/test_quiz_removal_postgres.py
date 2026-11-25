"""Provision a verified disposable cluster and run quiz regressions, no shared IO."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import psycopg
import test_source_activity_ksbs_postgres as isolated


def run(config):
    with psycopg.connect(**config, autocommit=True) as db:
        directory = db.execute("SHOW data_directory").fetchone()[0]
        db.execute('CREATE DATABASE quiz_safety_test_defaults_removal')
    cfg = {**config, 'dbname': 'quiz_safety_test_defaults_removal', 'password': '', 'data_directory': directory}
    cfg.pop('connect_timeout')
    path = Path(tempfile.mkdtemp(prefix='quiz_removal_')) / 'connection.json'
    path.write_text(json.dumps(cfg), encoding='utf-8')
    return subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'quiz_api/run_history_postgres_tests.py'),
                           '--connection-file', str(path)]).returncode == 0


if __name__ == '__main__':
    isolated.run = run
    raise SystemExit(isolated.main())
