"""Synthetic KSB integration tests in a new, verified disposable local cluster.

No application database is connected. Uses installed PostgreSQL binaries; no
packages, environment files, migrations or external integrations are changed.
"""
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import unittest

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from curriculum_api.source_activity_ksbs import add_mapping, relation, KsbVersionConflict


def run(config):
    class Integration(unittest.TestCase):
        def setUp(self):
            self.db = psycopg.connect(**config, autocommit=True)
            self.addCleanup(self.db.close)
            # This schema belongs exclusively to this freshly initialized cluster.
            self.db.execute('DROP SCHEMA IF EXISTS curriculum CASCADE')
            self.db.execute('''CREATE SCHEMA curriculum;
                CREATE TABLE curriculum.programmes(programme_id text PRIMARY KEY,ksb_profile_source_id text);
                CREATE TABLE curriculum.source_courses(id bigint PRIMARY KEY,curriculum_programme_ref text);
                CREATE TABLE curriculum.source_activities(id bigint PRIMARY KEY,source_course_id bigint,
                    source_material_id bigint);
                CREATE TABLE curriculum.standard_ksbs(id bigint PRIMARY KEY,ksb_code text NOT NULL,
                    ksb_description text NOT NULL,ksb_type text NOT NULL,standard_ref text NOT NULL,
                    standard_version text NOT NULL,UNIQUE(standard_ref,standard_version,ksb_code));
                CREATE TABLE curriculum.source_activity_ksbs(activity_id bigint PRIMARY KEY,ksbs jsonb NOT NULL,
                    version bigint NOT NULL CHECK(version>=1),created_by text NOT NULL,updated_by text NOT NULL,
                    created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
                    CHECK(jsonb_typeof(ksbs)='array'));
                CREATE TABLE curriculum.source_activity_ksbs_normalized(
                    source_activity_id bigint REFERENCES curriculum.source_activities(id) ON DELETE RESTRICT,
                    standard_ksb_id bigint REFERENCES curriculum.standard_ksbs(id) ON DELETE RESTRICT,
                    legacy_activity_id bigint NOT NULL,legacy_ksb_code text NOT NULL,version bigint NOT NULL CHECK(version>=1),
                    created_by text NOT NULL,updated_by text NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
                    PRIMARY KEY(source_activity_id,standard_ksb_id));
                INSERT INTO curriculum.programmes VALUES ('P1','standard:st0612-v1-0'),('P2','standard:st0612-v2-0');
                INSERT INTO curriculum.source_courses VALUES (1,'P1'),(2,'P2');
                INSERT INTO curriculum.source_activities VALUES (100,1,10),(101,1,10),(102,2,20),(103,2,10);
                INSERT INTO curriculum.standard_ksbs VALUES
                    (1,'B8','Canonical behaviour','behaviour','ST0612','1.0'),
                    (2,'K1','Canonical knowledge','knowledge','ST0612','1.0'),
                    (3,'S1','Canonical skill','skill','ST0612','1.0'),
                    (4,'K1','New version knowledge','knowledge','ST0612','2.0'),
                    (5,'S2','Second skill','skill','ST0612','1.0');
                INSERT INTO curriculum.source_activity_ksbs VALUES
                    (10,'[{"code":"B7","description":"Historical behaviour","type":"B"},
                          {"code":"K1","description":"Historical knowledge","type":"K"},
                          {"code":"Z9","description":"Unresolved evidence","type":"K"}]',
                        1,'original','original','2020-01-01','2020-01-01'),
                    (20,'[]',1,'original','original','2020-01-01','2020-01-01');
                INSERT INTO curriculum.source_activity_ksbs_normalized
                    SELECT a.id,1,10,'B7',l.version,l.created_by,l.updated_by,l.created_at,l.updated_at
                    FROM curriculum.source_activity_ksbs l CROSS JOIN curriculum.source_activities a
                    WHERE l.activity_id=10 AND a.id IN (100,101);''')

        def read(self, activity=10):
            return self.db.execute(f'SELECT ksbs FROM {relation()} k WHERE activity_id=%s', [activity]).fetchone()[0]

        def write(self, definition=2, version=1, source=100, **kwargs):
            return add_mapping(self.db, source_activity_id=source, standard_ksb_id=definition,
                               expected_version=version, actor='synthetic', **kwargs)

        def test_mixed_read_preserves_unresolved_uses_definition_and_no_copy_double_count(self):
            items = self.read()
            self.assertEqual([i['code'] for i in items], ['B8','K1','Z9'])
            self.assertEqual(items[0]['description'], 'Canonical behaviour')
            self.assertEqual(items[0]['resolutionStatus'], 'verified')
            self.assertEqual([i['resolutionStatus'] for i in items[1:]], ['unresolved','unresolved'])
            self.assertEqual(self.db.execute('SELECT ksbs->0->>\'code\' FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone()[0], 'B7')

        def test_empty_override_compatible_shape(self):
            self.assertEqual(self.read(20), [])
            count, hours = self.db.execute(f'''SELECT count(*),sum(j.hours) FROM
                (VALUES(10,2),(20,3)) j(activity_id,hours)
                LEFT JOIN {relation()} k USING(activity_id)''').fetchone()
            self.assertEqual((count,hours),(2,5))

        def test_wrong_programme_version_is_not_verified(self):
            self.db.execute("UPDATE curriculum.programmes SET ksb_profile_source_id='standard:st0612-v2-0' WHERE programme_id='P1'")
            self.assertEqual(self.read()[0]['code'], 'B7')
            self.assertEqual(self.read()[0]['resolutionStatus'], 'ambiguous_or_incompatible')

        def test_ambiguous_copies_require_exact_source_scope(self):
            self.write()
            self.write(definition=4,version=2,source=103)
            self.assertEqual(self.read()[1]['resolutionStatus'], 'ambiguous_or_incompatible')
            items = self.db.execute(f'''SELECT k.ksbs FROM curriculum.source_activities a
                LEFT JOIN LATERAL {relation('a.id')} k ON k.activity_id=a.source_material_id
                WHERE a.id=103''').fetchone()[0]
            self.assertEqual(items[1]['standardVersion'], '2.0')
            self.assertEqual(items[0]['resolutionStatus'], 'unresolved')

        def test_add_existing_code_preserves_legacy_metadata_and_other_elements(self):
            original = self.db.execute('SELECT ksbs,created_by,created_at FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone()
            self.assertEqual(self.write(), {'version':2,'changed':True})
            self.assertEqual(self.db.execute('SELECT ksbs,created_by,created_at FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone(), original)
            self.assertEqual(self.read()[1]['description'], 'Canonical knowledge')
            self.assertEqual(self.read()[2]['code'], 'Z9')
            self.assertEqual(self.db.execute('SELECT DISTINCT version FROM curriculum.source_activity_ksbs_normalized').fetchall(), [(2,)])

        def test_add_new_code_appends_without_replacing_legacy(self):
            self.write(definition=3)
            self.assertEqual([i['code'] for i in self.read()], ['B8','K1','Z9','S1'])

        def test_stale_version_rejected_without_partial_write(self):
            self.write()
            with self.assertRaises(KsbVersionConflict):
                self.write(definition=3)
            self.assertEqual(len(self.read()),3)

        def test_another_copy_cannot_duplicate_an_existing_alias_definition(self):
            self.db.execute('INSERT INTO curriculum.source_activities VALUES (104,1,10)')
            with self.assertRaisesRegex(ValueError, 'different legacy provenance'):
                self.write(definition=1,source=104)
            self.assertEqual([i['code'] for i in self.read()],['B8','K1','Z9'])

        def test_outer_transaction_rollback_restores_both_tables(self):
            with self.assertRaisesRegex(RuntimeError, 'outer failure'):
                with self.db.transaction():
                    self.write(definition=3)
                    raise RuntimeError('outer failure')
            self.assertEqual(len(self.read()),3)
            self.assertEqual(self.db.execute('SELECT version FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone()[0],1)

        def test_retry_is_idempotent_even_with_old_expected_version(self):
            self.write()
            self.assertEqual(self.write(), {'version':2,'changed':False})
            self.assertEqual(self.write(definition=1,legacy_code='B7'), {'version':2,'changed':False})

        def test_invalid_definition_version_and_remap_are_rejected(self):
            for kwargs in ({'definition':999},{'definition':4},{'definition':2,'legacy_code':'Z9'}, {'source':999}):
                with self.assertRaises(ValueError):
                    self.write(**kwargs)
            self.assertEqual(self.db.execute('SELECT version FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone()[0],1)

        def test_failure_rolls_back_legacy_and_normalized_metadata(self):
            self.db.execute('''CREATE FUNCTION curriculum.reject_insert() RETURNS trigger LANGUAGE plpgsql
                AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$;
                CREATE TRIGGER reject BEFORE INSERT ON curriculum.source_activity_ksbs_normalized
                FOR EACH ROW EXECUTE FUNCTION curriculum.reject_insert();''')
            with self.assertRaises(psycopg.Error):
                self.write(definition=3)
            self.assertEqual(len(self.read()),3)
            self.assertEqual(self.db.execute('SELECT DISTINCT version FROM curriculum.source_activity_ksbs_normalized').fetchall(),[(1,)])
            self.assertEqual(self.db.execute('SELECT version FROM curriculum.source_activity_ksbs WHERE activity_id=10').fetchone()[0],1)

        def concurrent(self, definitions):
            barrier = Barrier(2)
            def worker(definition):
                with psycopg.connect(**config,autocommit=True) as connection:
                    barrier.wait(timeout=10)
                    try:
                        return add_mapping(connection,source_activity_id=100,standard_ksb_id=definition,
                                           expected_version=1,actor='synthetic')['changed']
                    except KsbVersionConflict:
                        return 'conflict'
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(worker,definitions))

        def test_concurrent_distinct_updates_have_one_version_conflict(self):
            results = self.concurrent([3,5])
            self.assertEqual(results.count(True),1)
            self.assertEqual(results.count('conflict'),1)
            self.assertEqual(len(self.read()),4)

        def test_concurrent_retry_inserts_once(self):
            results = self.concurrent([2,2])
            self.assertEqual(sorted(results),[False,True])
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.source_activity_ksbs_normalized WHERE standard_ksb_id=2').fetchone()[0],1)

    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Integration)).wasSuccessful()


def main():
    binaries = Path('C:/Program Files/PostgreSQL/18/bin')
    root = Path(tempfile.mkdtemp(prefix='lms_ksb_closure_')).resolve()
    directory = root / 'data'
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        port = listener.getsockname()[1]
    def control(*args):
        with (root/'control.log').open('a') as log:
            return subprocess.run([str(binaries/'pg_ctl.exe'),'-D',str(directory),*args],
                stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=30).returncode
    started = False
    try:
        subprocess.run([str(binaries/'initdb.exe'),'-D',str(directory),'-U','postgres','--auth=trust',
                        '--encoding=UTF8','--no-locale'],check=True,capture_output=True,timeout=45)
        started = True
        if control('-l',str(root/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port}','-w','-t','20','start'):
            raise RuntimeError('Isolated PostgreSQL startup failed.')
        config = dict(host='127.0.0.1',port=port,user='postgres',dbname='postgres',connect_timeout=5)
        with psycopg.connect(**config) as db:
            host,actual_port,data,branch = db.execute("SELECT host(inet_server_addr()),inet_server_port(),current_setting('data_directory'),current_setting('neon.branch_id',true)").fetchone()
            assert host=='127.0.0.1' and actual_port==port and not branch and Path(data).resolve()==directory
            assert db.execute("SELECT count(*) FROM pg_namespace WHERE nspname='curriculum'").fetchone()[0]==0
        return int(not run(config))
    finally:
        if started and control('-m','fast','-w','-t','20','stop'):
            raise RuntimeError(f'Could not stop disposable cluster: {root}')
        # Retain the stopped synthetic cluster/logs for reproducibility; no deletion.
        print('Stopped isolated test artifacts:',root)


if __name__ == '__main__':
    raise SystemExit(main())
