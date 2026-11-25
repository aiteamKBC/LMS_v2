"""Execute the exact manual SQL in a verified disposable cluster, never in Neon."""
from pathlib import Path
import psycopg
import test_source_activity_ksbs_postgres as isolated

ROOT = Path(__file__).resolve().parents[2]


def run(config):
    with psycopg.connect(**config, autocommit=True) as admin:
        admin.execute('CREATE DATABASE neondb')
    with psycopg.connect(**{**config, 'dbname': 'neondb'}, autocommit=True) as c:
        c.execute('''CREATE SCHEMA curriculum; CREATE SCHEMA login; CREATE SCHEMA "Learner";
            CREATE TABLE curriculum.modules(module_catalogue_id text PRIMARY KEY);
            CREATE TABLE login."Login_accounts"(id bigint PRIMARY KEY);
            CREATE TABLE curriculum.free_courses(id varchar(128) PRIMARY KEY);
            CREATE TABLE curriculum.free_course_weeks(id varchar(128) PRIMARY KEY,course_id varchar(128));
            CREATE TABLE curriculum.free_programme_components(id varchar(128) PRIMARY KEY,free_module_id varchar(128));
            CREATE TABLE "Learner".learner_progress_entries(id bigint PRIMARY KEY,learner_id bigint,actual_seconds bigint,accepted boolean);
            INSERT INTO "Learner".learner_progress_entries VALUES(1,1,120,true)''')
        files = ['Development-module-hours.sql', 'Development-canonical-free-course-identity.sql',
                 'Development-source-sync-baselines.sql']
        for name in files:
            statement = (ROOT / 'specs/lms-master-completion' / name).read_text()
            c.execute("SET neon.branch_id='synthetic-wrong-target'")
            try:
                c.execute(statement)
            except psycopg.errors.RaiseException:
                c.execute('ROLLBACK')
            else:
                raise AssertionError('Wrong target was not refused: ' + name)
            # Simulate the branch identity only after the wrapper has proved
            # this server's host, port, empty schema and local data directory.
            c.execute("SET neon.branch_id='br-raspy-sky-abvs8lq9'")
            c.execute(statement)
            c.execute(statement)
            print('PASS exact SQL + retry + wrong-target rejection:', name)
        assert c.execute('SELECT id,learner_id,actual_seconds,accepted FROM "Learner".learner_progress_entries').fetchall() == [(1, 1, 120, True)]
        assert c.execute('SELECT free_course_ref,free_component_ref FROM "Learner".learner_progress_entries').fetchall() == [(None, None)]
        assert c.execute("SELECT count(*) FROM pg_constraint WHERE connamespace='curriculum'::regnamespace AND NOT convalidated").fetchone()[0] == 0
        print('PASS synthetic ledger values preserved; constraints validated')
    return True


if __name__ == '__main__':
    isolated.run = run
    raise SystemExit(isolated.main())
