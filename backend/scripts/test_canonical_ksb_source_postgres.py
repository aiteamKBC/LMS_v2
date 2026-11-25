"""Canonical source mapping regression tests in a fresh isolated PostgreSQL cluster.

Reuse only the verified cluster lifecycle from the older integration runner.
Neither Django startup nor any application database is involved.
"""
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg
import test_source_activity_ksbs_postgres as isolated
from curriculum_api.source_activity_ksbs import add_mapping, relation, KsbVersionConflict
from curriculum_api.canonical_read_sql import component_ksb_codes_sql, component_ksb_mappings_sql
from learner_api.ksb_domain import official_progress_relation, point_counts_sql


def run(config):
    class CanonicalSourceTests(unittest.TestCase):
        def setUp(self):
            self.db = psycopg.connect(**config, autocommit=True)
            self.addCleanup(self.db.close)
            self.db.execute('DROP SCHEMA IF EXISTS curriculum CASCADE')
            self.db.execute('DROP SCHEMA IF EXISTS "Learner" CASCADE')
            self.db.execute('''CREATE SCHEMA curriculum;
                CREATE TABLE curriculum.programmes(programme_id text PRIMARY KEY,
                    standard_ref text,standard_version text);
                CREATE TABLE curriculum.source_courses(id bigint PRIMARY KEY,curriculum_programme_ref text);
                CREATE TABLE curriculum.source_activities(id bigint PRIMARY KEY,source_course_id bigint,
                    source_material_id bigint);
                CREATE TABLE curriculum.ksb_standard_definitions(id bigint PRIMARY KEY,ksb_code text NOT NULL,
                    ksb_description text NOT NULL,ksb_type text NOT NULL,standard_ref text NOT NULL,
                    standard_version text NOT NULL,UNIQUE(standard_ref,standard_version,ksb_code));
                CREATE TABLE curriculum.ksb_source_activity_mappings(
                    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                    source_activity_id bigint REFERENCES curriculum.source_activities(id) ON DELETE RESTRICT,
                    standard_ksb_id bigint REFERENCES curriculum.ksb_standard_definitions(id) ON DELETE RESTRICT,
                    legacy_activity_id bigint NOT NULL,legacy_ksb_code text NOT NULL,
                    legacy_ksb_snapshot jsonb,version bigint NOT NULL DEFAULT 1 CHECK(version>=1),
                    created_by text NOT NULL,updated_by text NOT NULL,
                    created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
                    mapping_status text GENERATED ALWAYS AS (CASE WHEN source_activity_id IS NOT NULL
                        AND standard_ksb_id IS NOT NULL THEN 'verified' ELSE 'unresolved' END) STORED,
                    CHECK ((source_activity_id IS NULL AND standard_ksb_id IS NULL)
                        OR (source_activity_id IS NOT NULL AND standard_ksb_id IS NOT NULL)));
                CREATE UNIQUE INDEX verified ON curriculum.ksb_source_activity_mappings
                    (source_activity_id,standard_ksb_id) WHERE source_activity_id IS NOT NULL AND standard_ksb_id IS NOT NULL;
                CREATE UNIQUE INDEX unresolved ON curriculum.ksb_source_activity_mappings
                    (legacy_activity_id,upper(btrim(legacy_ksb_code))) WHERE source_activity_id IS NULL AND standard_ksb_id IS NULL;
                INSERT INTO curriculum.programmes VALUES ('P1','ST0612','1.0'),('P2','ST0612','2.0'),('P3',NULL,NULL);
                INSERT INTO curriculum.source_courses VALUES (1,'P1'),(2,'P2'),(3,'P3');
                INSERT INTO curriculum.source_activities VALUES (100,1,10),(101,1,10),(102,2,20),(103,2,10),(104,3,30);
                INSERT INTO curriculum.ksb_standard_definitions VALUES
                    (1,'B8','Canonical behaviour','behaviour','ST0612','1.0'),
                    (2,'K1','Canonical knowledge','knowledge','ST0612','1.0'),
                    (3,'S1','Canonical skill','skill','ST0612','1.0'),
                    (4,'K1','New version knowledge','knowledge','ST0612','2.0'),
                    (5,'S2','Second skill','skill','ST0612','1.0');
                INSERT INTO curriculum.ksb_source_activity_mappings
                    (source_activity_id,standard_ksb_id,legacy_activity_id,legacy_ksb_code,legacy_ksb_snapshot,created_by,updated_by)
                    VALUES (100,1,10,'B7','{"code":"B7","description":"Historical behaviour"}','original','original'),
                           (101,1,10,'B7','{"code":"B7","description":"Historical behaviour"}','original','original'),
                           (NULL,NULL,10,'K1','{"code":"K1","description":"Historical knowledge"}','original','original'),
                           (NULL,NULL,10,'Z9','{"code":"Z9","description":"Unresolved evidence"}','original','original');''')

        def write(self, definition=2, source=100, version=1, **kwargs):
            return add_mapping(self.db, source_activity_id=source, standard_ksb_id=definition,
                               expected_version=version, actor='synthetic', **kwargs)

        def read(self):
            return self.db.execute(f'SELECT ksbs FROM {relation()} k WHERE activity_id=10').fetchone()[0]

        def test_verified_copies_count_once_and_historical_snapshots_survive(self):
            items = self.read()
            self.assertEqual([i['code'] for i in items], ['B8', 'K1', 'Z9'])
            self.assertEqual(items[0]['description'], 'Canonical behaviour')
            self.assertEqual([i['resolutionStatus'] for i in items], ['verified','unresolved','unresolved'])
            self.assertEqual(self.db.execute("SELECT legacy_ksb_snapshot->>'code' FROM curriculum.ksb_source_activity_mappings WHERE id=1").fetchone()[0], 'B7')

        def test_explicit_addition_does_not_convert_unresolved_history(self):
            before = self.db.execute("SELECT id,legacy_ksb_snapshot,source_activity_id,standard_ksb_id FROM curriculum.ksb_source_activity_mappings WHERE mapping_status='unresolved' ORDER BY id").fetchall()
            self.assertEqual(self.write(), {'version':2,'changed':True})
            self.assertEqual(before, self.db.execute("SELECT id,legacy_ksb_snapshot,source_activity_id,standard_ksb_id FROM curriculum.ksb_source_activity_mappings WHERE mapping_status='unresolved' ORDER BY id").fetchall())
            self.assertEqual(len([i for i in self.read() if i['resolutionStatus']=='verified']),2)

        def test_exact_scope_separates_shared_activity_versions(self):
            self.write()
            self.write(definition=4,source=103,version=2)
            items = self.db.execute(f'''SELECT k.ksbs FROM curriculum.source_activities a
                LEFT JOIN LATERAL {relation('a.id')} k ON k.activity_id=a.source_material_id WHERE a.id=103''').fetchone()[0]
            verified = [i for i in items if i['resolutionStatus']=='verified']
            self.assertEqual([i['standardKsbId'] for i in verified],[4])
            self.assertTrue(any(i['resolutionStatus']=='ambiguous_or_incompatible' for i in self.read()))

        def test_missing_or_incompatible_standard_rejected(self):
            for args in ({'source':104},{'definition':4},{'definition':999},{'source':999}):
                with self.assertRaises(ValueError):
                    self.write(**args)

        def test_programme_remap_makes_old_relationship_ineligible(self):
            self.db.execute("UPDATE curriculum.programmes SET standard_version='2.0' WHERE programme_id='P1'")
            self.assertEqual(self.read()[0]['resolutionStatus'],'ambiguous_or_incompatible')
            self.assertNotIn('standardKsbId',self.read()[0])

        def test_numeric_activity_identity_is_not_sufficient(self):
            self.db.execute('UPDATE curriculum.source_activities SET source_material_id=100 WHERE id=100')
            self.assertEqual(self.read()[0]['resolutionStatus'],'ambiguous_or_incompatible')

        def test_idempotency_and_version_conflict(self):
            self.write()
            self.assertEqual(self.write(), {'version':2,'changed':False})
            with self.assertRaises(KsbVersionConflict):
                self.write(definition=3)

        def test_new_alias_remapping_rejected(self):
            with self.assertRaises(ValueError):
                self.write(legacy_code='Z9')
            self.assertEqual(self.write(definition=1,legacy_code='B7')['changed'],False)

        def test_transaction_rollback_restores_mappings_and_metadata(self):
            before = self.db.execute('SELECT * FROM curriculum.ksb_source_activity_mappings ORDER BY id').fetchall()
            with self.assertRaises(RuntimeError):
                with self.db.transaction():
                    self.write()
                    raise RuntimeError('synthetic rollback')
            self.assertEqual(before,self.db.execute('SELECT * FROM curriculum.ksb_source_activity_mappings ORDER BY id').fetchall())

        def concurrent(self, definitions):
            barrier = Barrier(2)
            def worker(definition):
                with psycopg.connect(**config,autocommit=True) as db:
                    barrier.wait(timeout=10)
                    try:
                        return add_mapping(db, source_activity_id=100,standard_ksb_id=definition,
                            expected_version=1,actor='synthetic')['changed']
                    except KsbVersionConflict:
                        return 'conflict'
            with ThreadPoolExecutor(max_workers=2) as pool:
                return list(pool.map(worker,definitions))

        def test_concurrent_retry_inserts_once(self):
            self.assertEqual(sorted(self.concurrent([2,2])),[False,True])

        def test_concurrent_changes_detect_stale_version(self):
            result = self.concurrent([3,5])
            self.assertEqual(result.count(True),1)
            self.assertEqual(result.count('conflict'),1)

        def test_component_projection_uses_official_identity_and_only_active_rows(self):
            self.db.execute('''CREATE TABLE curriculum.components(id text PRIMARY KEY);
                CREATE TABLE curriculum.ksb_component_mappings(
                    id text PRIMARY KEY,component_id text REFERENCES curriculum.components,
                    standard_ksb_id bigint REFERENCES curriculum.ksb_standard_definitions,
                    classification text,weight numeric,weight_class text,source_type text,source_id text,status text);
                INSERT INTO curriculum.components VALUES ('C1'),('C2');
                INSERT INTO curriculum.ksb_component_mappings VALUES
                    ('M1','C1',2,'main',25,'hard','standard','st0612-v1-0','active'),
                    ('M2','C1',3,'secondary',75,'soft','standard','st0612-v1-0','inactive'),
                    ('M3','C2',4,'main',10,'hard','standard','st0612-v2-0','active');''')
            rows = self.db.execute(f'''SELECT c.id,{component_ksb_mappings_sql()},
                {component_ksb_codes_sql()} FROM curriculum.components c ORDER BY c.id''').fetchall()
            self.assertEqual([r[1][0]['ksbId'] for r in rows],['st0612-v1-0-2','st0612-v2-0-4'])
            self.assertEqual([len(r[1]) for r in rows],[1,1])
            self.assertEqual(rows[0][1][0]['weight'],25)
            self.assertEqual(rows[0][1][0]['description'],'Canonical knowledge')
            self.assertEqual(rows[1][1][0]['description'],'New version knowledge')
            self.assertEqual([r[2] for r in rows],[[{'code':'K1'}],[{'code':'K1'}]])
            self.assertEqual(self.db.execute("SELECT count(*) FROM curriculum.ksb_component_mappings WHERE status='inactive'").fetchone()[0],1)

        def progress_fixture(self):
            self.db.execute('''CREATE SCHEMA "Learner";
                CREATE TABLE curriculum.ksb_standard_versions(standard_ref text,standard_version text,
                    PRIMARY KEY(standard_ref,standard_version));
                INSERT INTO curriculum.ksb_standard_versions VALUES ('ST0612','1.0'),('ST0612','2.0');
                CREATE TABLE "Learner".learners(id bigint PRIMARY KEY,programme_id text,standard_ref text,standard_version text);
                INSERT INTO "Learner".learners VALUES (1,'P1','ST0612','1.0'),(2,'P2','ST0612','2.0'),(3,'P3',NULL,NULL);
                CREATE TABLE "Learner".learner_progress_entries(id bigint PRIMARY KEY,learner_id bigint,
                    accepted boolean,activity_status text,deleted_at timestamptz);
                INSERT INTO "Learner".learner_progress_entries VALUES
                    (1,1,true,'started',NULL),(2,1,true,'completed',NULL),
                    (3,1,false,'completed',NULL),(4,1,true,'completed',now()),(5,2,true,'completed',NULL),
                    (6,3,true,'completed',NULL);
                CREATE TABLE "Learner".ksb_learner_progress(progress_id bigint,position integer,
                    standard_ksb_id bigint,ksb_code text,ksb_description text,classification text,weight numeric,
                    weight_class text,source_type text,source_id text,
                    mapping_status text GENERATED ALWAYS AS (CASE WHEN standard_ksb_id IS NOT NULL
                        THEN 'verified' ELSE 'unresolved' END) STORED,
                    is_excluded boolean NOT NULL DEFAULT false,legacy_definition_snapshot jsonb,
                    exclusion_reason text,exclusion_metadata jsonb,PRIMARY KEY(progress_id,position));
                INSERT INTO "Learner".ksb_learner_progress(progress_id,position,standard_ksb_id,ksb_code,ksb_description,is_excluded)
                    VALUES (1,1,2,'WRONG','Old label',false),(1,2,2,'WRONG','Duplicate',false),
                        (1,3,NULL,'K1','Unresolved same code',false),(1,4,3,'S1','Excluded',true),
                        (1,5,4,'K1','Wrong version',false),(2,1,2,'K1','Old label',false),
                        (3,1,2,'K1','Old label',false),(4,1,2,'K1','Deleted progress',false),
                        (5,1,4,'K1','Other learner',false),(6,1,2,'K1','No standard',false);''')

        def test_progress_filters_unresolved_excluded_wrong_versions_and_deleted(self):
            self.progress_fixture()
            rows = self.db.execute(f'SELECT progress_id,position,ksb_code FROM {official_progress_relation()} k ORDER BY 1,2').fetchall()
            self.assertEqual(rows,[(1,1,'K1'),(1,2,'K1'),(2,1,'K1'),(3,1,'K1'),(5,1,'K1')])

        def test_points_preserve_acceptance_completion_distinction_without_duplicates(self):
            self.progress_fixture()
            # 3 distinct evidence activities; 2 accepted; only 1 also completed.
            self.assertEqual(self.db.execute(point_counts_sql(),[1]).fetchall(),
                             [('K1','Canonical knowledge',3,1,2)])
            self.assertEqual(self.db.execute(point_counts_sql(),[2]).fetchall(),
                             [('K1','New version knowledge',1,1,1)])
            self.assertEqual(self.db.execute(point_counts_sql(),[3]).fetchall(),[])

        def test_pin_creation_is_exact_immutable_and_does_not_create_definitions(self):
            from learner_api.ksb_domain import pin_learner_standard
            self.progress_fixture()
            self.db.execute('UPDATE "Learner".learners SET standard_ref=NULL,standard_version=NULL WHERE id=1')
            with self.db.transaction(),self.db.cursor() as cursor:
                self.assertEqual(pin_learner_standard(cursor,1),('ST0612','1.0'))
                self.assertIsNone(pin_learner_standard(cursor,3))
            self.db.execute("UPDATE curriculum.programmes SET standard_version='2.0' WHERE programme_id='P1'")
            with self.db.transaction(),self.db.cursor() as cursor:
                self.assertEqual(pin_learner_standard(cursor,1),('ST0612','1.0'))
            self.db.execute("UPDATE curriculum.programmes SET standard_ref='ST9999' WHERE programme_id='P1'")
            with self.assertRaisesRegex(ValueError,'conflicts'):
                with self.db.transaction(),self.db.cursor() as cursor:
                    pin_learner_standard(cursor,1)
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.ksb_standard_definitions').fetchone()[0],5)

        def test_learner_pin_survives_programme_version_change(self):
            self.progress_fixture()
            self.db.execute("UPDATE curriculum.programmes SET standard_version='2.0' WHERE programme_id='P1'")
            self.assertEqual(self.db.execute(point_counts_sql(),[1]).fetchone(),('K1','Canonical knowledge',3,1,2))

        def test_conflicting_programme_reference_does_not_leak_same_codes(self):
            self.progress_fixture()
            self.db.execute("UPDATE curriculum.programmes SET standard_ref='ST9999' WHERE programme_id='P1'")
            self.assertEqual(self.db.execute(point_counts_sql(),[1]).fetchall(),[])

        def test_unpinned_learner_uses_only_exact_programme_pair(self):
            self.progress_fixture()
            self.db.execute('UPDATE "Learner".learners SET standard_ref=NULL,standard_version=NULL WHERE id=1')
            self.assertEqual(self.db.execute(point_counts_sql(),[1]).fetchone(),('K1','Canonical knowledge',3,1,2))
            self.db.execute("UPDATE curriculum.programmes SET standard_version='9.0' WHERE programme_id='P1'")
            self.assertEqual(self.db.execute(point_counts_sql(),[1]).fetchall(),[])

        def journal_fixture(self):
            self.progress_fixture()
            self.db.execute('''ALTER TABLE "Learner".learners ADD COLUMN aptem_id bigint;
                UPDATE "Learner".learners SET aptem_id=id+100;
                ALTER TABLE "Learner".learner_progress_entries ADD COLUMN reporting_month text;
                UPDATE "Learner".learner_progress_entries SET reporting_month='2026-11';
                CREATE TABLE "Learner".learner_journal_rows(id bigint PRIMARY KEY,learner_id bigint,
                    aptem_id bigint,progress_id bigint,month text,activity_id bigint,deleted_at timestamptz,
                    ksb_snapshot jsonb,ksb_metadata jsonb);
                INSERT INTO "Learner".learner_journal_rows VALUES(10,1,101,1,'2026-11',77,NULL,NULL,'{"version":4,"sync_token":"synthetic"}');
                CREATE TABLE "Learner".ksb_learner_activity_mappings(learner_id bigint,source_kind text,
                    activity_id bigint,source_preference text CHECK(source_preference IN ('material','learner')),ksbs jsonb,
                    CHECK(source_kind IN ('learner_activity','aptem_component')));
                CREATE TABLE "Learner".manual_month_finalization_events(id bigint,aptem_id bigint,
                    report_month text,event_type text);''')

        def test_journal_fill_preserves_history_metadata_and_learner_override_namespace(self):
            from learner_api.journal_ksbs import fill_missing_snapshot
            self.journal_fixture()
            self.db.execute('''INSERT INTO "Learner".ksb_learner_activity_mappings VALUES
                (1,'aptem_component',77,'learner','[{"code":"B8"}]'),
                (1,'learner_activity',77,'learner','[{"code":"S1"},{"code":"S2"}]')''')
            before = self.db.execute('SELECT * FROM "Learner".ksb_learner_progress WHERE progress_id=1 ORDER BY position').fetchall()
            with self.db.transaction(), self.db.cursor() as cursor:
                result = fill_missing_snapshot(cursor,10,101,[{'code':'B8'}],actor='test')
                self.assertTrue(result['learner_override'])
                self.assertEqual(result['learner_id'],1)
            after = self.db.execute('SELECT * FROM "Learner".ksb_learner_progress WHERE progress_id=1 ORDER BY position').fetchall()
            self.assertEqual(after[:len(before)],before)
            self.assertEqual(len(after),len(before)+1)
            self.assertEqual(self.db.execute('SELECT standard_ksb_id FROM "Learner".ksb_learner_progress WHERE progress_id=1 AND ksb_code=\'S2\'').fetchone(),(5,))
            metadata = self.db.execute('SELECT ksb_metadata FROM "Learner".learner_journal_rows WHERE id=10').fetchone()[0]
            self.assertEqual(metadata['version'],5)
            self.assertEqual(metadata['sync_token'],'synthetic')
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertIsNone(fill_missing_snapshot(cursor,10,101,[{'code':'K1'}],actor='retry'))

        def test_activity_projection_preserves_metadata_and_separates_source_kinds_and_owners(self):
            from learner_api.journal_sources import table
            self.journal_fixture()
            self.db.execute('''ALTER TABLE "Learner".ksb_learner_activity_mappings
                ADD COLUMN source_metadata jsonb, ADD COLUMN version bigint DEFAULT 1,
                ADD COLUMN created_by text, ADD COLUMN updated_by text,
                ADD COLUMN created_at timestamptz, ADD COLUMN updated_at timestamptz;
                INSERT INTO "Learner".ksb_learner_activity_mappings
                    (learner_id,source_kind,activity_id,source_preference,ksbs,source_metadata)
                VALUES (1,'learner_activity',77,'learner','[{"code":"K1"}]','{"sync":"retained"}'),
                    (1,'aptem_component',77,'material','[{"code":"B8"}]','{"sync":"aptem"}'),
                    (2,'learner_activity',77,'material','[{"code":"S1"}]','{"sync":"other"}')''')
            projection = table('learner_activity_ksbs')
            rows = self.db.execute(f'SELECT learner_id,aptem_id,ksbs,source_metadata,source_preference FROM {projection} m ORDER BY learner_id').fetchall()
            self.assertEqual(rows, [(1,101,[{'code':'K1'}],{'sync':'retained'},'learner'),
                                    (2,102,[{'code':'S1'}],{'sync':'other'},'material')])
            self.db.execute('UPDATE "Learner".learners SET aptem_id=101 WHERE id=3')
            self.assertEqual(self.db.execute(f'SELECT learner_id FROM {projection} m').fetchall(),[(2,)])
            self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".ksb_learner_activity_mappings').fetchone()[0],3)

        def test_journal_fill_rejects_finalized_month_and_wrong_owner_and_rolls_back(self):
            from learner_api.journal_ksbs import fill_missing_snapshot
            self.journal_fixture()
            self.db.execute("INSERT INTO \"Learner\".manual_month_finalization_events VALUES(1,101,'2026-11','finalized')")
            with self.assertRaisesRegex(ValueError,'finalized'):
                with self.db.transaction(), self.db.cursor() as cursor:
                    fill_missing_snapshot(cursor,10,101,[{'code':'S2'}],actor='test')
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertIsNone(fill_missing_snapshot(cursor,10,102,[{'code':'S2'}],actor='test'))
            self.db.execute("INSERT INTO \"Learner\".manual_month_finalization_events VALUES(2,101,'2026-11','reopened')")
            with self.assertRaisesRegex(RuntimeError,'rollback'):
                with self.db.transaction(), self.db.cursor() as cursor:
                    fill_missing_snapshot(cursor,10,101,[{'code':'S2'}],actor='test')
                    raise RuntimeError('rollback')
            self.assertIsNone(self.db.execute('SELECT ksb_snapshot FROM "Learner".learner_journal_rows WHERE id=10').fetchone()[0])
            self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".ksb_learner_progress WHERE progress_id=1').fetchone()[0],5)

        def test_installed_development_finalization_guard_protects_embedded_snapshots(self):
            from pathlib import Path
            self.journal_fixture()
            evidence = json.loads((Path(__file__).resolve().parents[2] /
                'specs/ksb-canonical-architecture/database-evidence.json').read_text(encoding='utf-8'))
            guard = next(row for row in evidence['journal_ksb_guards'] if row[0]=='trg_guard_finalized_manual_rows')
            # Captured read-only from Development; installed only in this disposable DB.
            self.db.execute(guard[2])
            self.db.execute(guard[1])
            self.db.execute("INSERT INTO \"Learner\".manual_month_finalization_events VALUES(1,101,'2026-11','finalized')")
            with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
                with self.db.transaction():
                    self.db.execute('UPDATE "Learner".learner_journal_rows SET ksb_snapshot=\'[]\' WHERE id=10')
            self.assertIsNone(self.db.execute('SELECT ksb_snapshot FROM "Learner".learner_journal_rows WHERE id=10').fetchone()[0])
            self.db.execute("INSERT INTO \"Learner\".manual_month_finalization_events VALUES(2,101,'2026-11','reopened')")
            self.db.execute('UPDATE "Learner".learner_journal_rows SET ksb_snapshot=\'[]\' WHERE id=10')
            self.assertEqual(self.db.execute('SELECT ksb_snapshot FROM "Learner".learner_journal_rows WHERE id=10').fetchone()[0],[])

        def test_progress_rewrite_preserves_exclusions_records_history_and_is_idempotent(self):
            from unittest.mock import patch
            from types import SimpleNamespace
            from curriculum_api import learner_ksb_sync
            self.journal_fixture()
            self.db.execute('''ALTER TABLE "Learner".learner_progress_entries
                    ADD COLUMN curriculum_component_ref text,ADD COLUMN component_ref text;
                UPDATE "Learner".learner_progress_entries SET component_ref='C1' WHERE id=1;
                CREATE TABLE "Learner".learner_activity_revisions(learner_id bigint,progress_id bigint,
                    report_month text,source_system text,source_ref text,change_kind text,
                    before_snapshot jsonb,after_snapshot jsonb,actor text);
                UPDATE "Learner".ksb_learner_progress SET exclusion_reason='Keep excluded',
                    exclusion_metadata='{"reason":"synthetic"}',legacy_definition_snapshot='{"saved":"historical"}'
                    WHERE progress_id=1 AND standard_ksb_id=3;''')
            mappings={'C1':[{'code':'S1','standardKsbId':3,'sourceType':'standard','sourceId':'st0612-v1-0','weight':2,'weightClass':'hard'}]}
            local = SimpleNamespace(vendor='postgresql',cursor=self.db.cursor)
            with patch.object(learner_ksb_sync,'connection',local), patch('learner_api.progress_cache.bump_learners'):
                with self.db.transaction():
                    self.assertEqual(learner_ksb_sync.sync_progress_ksbs(mappings)['progress_rows'],1)
                with self.db.transaction():
                    self.assertEqual(learner_ksb_sync.sync_progress_ksbs(mappings)['progress_rows'],0)
            record=self.db.execute('''SELECT is_excluded,exclusion_reason,legacy_definition_snapshot
                FROM "Learner".ksb_learner_progress WHERE progress_id=1''').fetchone()
            self.assertEqual(record,(True,'Keep excluded',{'saved':'historical'}))
            before=self.db.execute('SELECT before_snapshot FROM "Learner".learner_activity_revisions').fetchall()
            self.assertEqual(len(before),1)
            self.assertEqual(len(before[0][0]['ksbs']),5)
            self.assertEqual(self.db.execute(f'SELECT count(*) FROM {official_progress_relation()} k WHERE progress_id=1').fetchone()[0],0)

        def test_extra_activity_ksb_write_preserves_exclusion_and_is_idempotent_and_atomic(self):
            from learner_api.extra_activity_progress import _sync_ksbs
            self.progress_fixture()
            self.db.execute('''UPDATE "Learner".ksb_learner_progress SET is_excluded=true,
                exclusion_reason='Keep',legacy_definition_snapshot='{"source":"historic"}',
                exclusion_metadata='{"audit":"retained"}' WHERE progress_id=2''')
            document = {'ksbCodes':['K1','K1','S2'],'ksbWeights':{'K1':2,'S2':1}}
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertTrue(_sync_ksbs(cursor,2,77,1,document))
                self.assertFalse(_sync_ksbs(cursor,2,77,1,document))
            saved = self.db.execute('SELECT standard_ksb_id,is_excluded,legacy_definition_snapshot,exclusion_metadata FROM "Learner".ksb_learner_progress WHERE progress_id=2 ORDER BY position').fetchall()
            self.assertEqual(saved,[(2,True,{'source':'historic'},{'audit':'retained'}),(5,False,None,None)])
            with self.assertRaisesRegex(RuntimeError,'rollback'):
                with self.db.transaction(), self.db.cursor() as cursor:
                    _sync_ksbs(cursor,2,77,1,{'ksbCodes':[]})
                    raise RuntimeError('rollback')
            self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".ksb_learner_progress WHERE progress_id=2').fetchone()[0],2)

        def test_curriculum_propagation_preserves_finalized_months_and_learner_overrides(self):
            from learner_api.ksb_write_scope import mutable_progress_ids
            self.progress_fixture()
            self.db.execute('''ALTER TABLE "Learner".learners ADD COLUMN aptem_id bigint;
                UPDATE "Learner".learners SET aptem_id=id+100;
                ALTER TABLE "Learner".learner_progress_entries ADD COLUMN reporting_month text,
                    ADD COLUMN curriculum_component_ref text,ADD COLUMN component_ref text;
                UPDATE "Learner".learner_progress_entries SET reporting_month='2026-11',component_ref='C1';
                CREATE TABLE "Learner".learner_journal_rows(id bigint,progress_id bigint,learner_id bigint,
                    month text,activity_id bigint,deleted_at timestamptz);
                CREATE TABLE "Learner".ksb_learner_activity_mappings(learner_id bigint,source_kind text,
                    activity_id bigint,source_preference text);
                CREATE TABLE "Learner".manual_month_finalization_events(id bigint,aptem_id bigint,
                    report_month text,event_type text);
                INSERT INTO "Learner".learner_journal_rows VALUES(1,1,1,'2026-10',77,NULL);
                INSERT INTO "Learner".manual_month_finalization_events VALUES(1,101,'2026-10','finalized');
                INSERT INTO "Learner".ksb_learner_activity_mappings VALUES(1,'aptem_component',77,'learner');''')
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertEqual(mutable_progress_ids(cursor,['C1']),[2,3,5,6])
            self.db.execute('''INSERT INTO "Learner".manual_month_finalization_events VALUES(2,101,'2026-10','reopened')''')
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertEqual(mutable_progress_ids(cursor,['C1']),[1,2,3,5,6])
            self.db.execute('''INSERT INTO "Learner".ksb_learner_activity_mappings VALUES(1,'learner_activity',77,'learner')''')
            with self.db.transaction(), self.db.cursor() as cursor:
                self.assertEqual(mutable_progress_ids(cursor,['C1']),[2,3,5,6])

        def template_fixture(self):
            self.db.execute('''CREATE TABLE curriculum.components(id text PRIMARY KEY);
                CREATE TABLE curriculum.week_template_components(id text PRIMARY KEY);
                INSERT INTO curriculum.components VALUES ('C1');
                INSERT INTO curriculum.week_template_components VALUES ('T1'),('T2');
                CREATE TABLE curriculum.ksb_component_mappings(
                    id text PRIMARY KEY,component_id text CONSTRAINT ksb_mappings_component_id_fkey REFERENCES curriculum.components ON DELETE RESTRICT,
                    template_component_id text CONSTRAINT fk_ksb_template_component REFERENCES curriculum.week_template_components ON DELETE RESTRICT,
                    standard_ksb_id bigint NOT NULL REFERENCES curriculum.ksb_standard_definitions ON DELETE RESTRICT,
                    classification text NOT NULL,weight numeric(5,2) NOT NULL CHECK(weight>0),
                    weight_class text NOT NULL CHECK(weight_class IN ('hard','soft','possible')),
                    source_type text,source_id text,status text NOT NULL CHECK(status IN ('active','inactive')),
                    created_at timestamp NOT NULL,updated_at timestamp NOT NULL,
                    CONSTRAINT chk_ksb_mapping_owner CHECK((component_id IS NULL)<>(template_component_id IS NULL)),
                    CONSTRAINT ksb_mappings_component_standard_unique UNIQUE(component_id,standard_ksb_id),
                    CONSTRAINT uq_template_component_standard_ksb UNIQUE(template_component_id,standard_ksb_id));''')

        def test_template_mapping_lifecycle_reuses_identity_and_preserves_weights(self):
            from curriculum_api.template_ksbs import replace, items
            self.template_fixture()
            mapping={'standardKsbId':2,'weight':2.5,'classification':'main','weightClass':'hard'}
            with self.db.transaction(), self.db.cursor() as cursor:
                replace(cursor,'T1',[mapping,mapping])
                first=items(cursor,['T1'])['T1'][0]
                replace(cursor,'T1',[])
                self.assertEqual(items(cursor,['T1']),{})
                replace(cursor,'T1',[{**mapping,'weight':3}])
                last=items(cursor,['T1'])['T1'][0]
                self.assertEqual(first['id'],last['id'])
                self.assertEqual((last['weight'],last['classification'],last['weightClass']),(3,'main','hard'))
                self.assertEqual(items(cursor,['T2']),{})
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.ksb_component_mappings').fetchone()[0],1)

        def test_template_copy_owns_independent_mapping_and_is_not_placed_coverage(self):
            from curriculum_api.template_ksbs import replace, items
            self.template_fixture()
            with self.db.transaction(), self.db.cursor() as cursor:
                replace(cursor,'T1',[{'standardKsbId':2,'weight':1}])
                source=items(cursor,['T1'])['T1']
                replace(cursor,'T2',source)
                copy=items(cursor,['T2'])['T2']
                self.assertNotEqual(source[0]['id'],copy[0]['id'])
                replace(cursor,'T1',[])
                self.assertEqual(len(items(cursor,['T2'])['T2']),1)
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.ksb_component_mappings m JOIN curriculum.components c ON c.id=m.component_id').fetchone()[0],0)

        def test_template_rejects_wrong_standard_unknown_identity_and_conflicting_duplicates(self):
            from curriculum_api.template_ksbs import replace
            self.template_fixture()
            cases=[([{'standardKsbId':4,'weight':1}],('ST0612','1.0')),
                   ([{'standardKsbId':999,'weight':1}],None),
                   ([{'standardKsbId':2,'weight':1},{'standardKsbId':2,'weight':2}],None),
                   ([{'standardKsbId':2,'weight':0}],None)]
            for mappings,standard in cases:
                with self.assertRaises(ValueError), self.db.transaction(), self.db.cursor() as cursor:
                    replace(cursor,'T1',mappings,standard=standard)
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.ksb_component_mappings').fetchone()[0],0)

        def test_template_foreign_key_restricts_delete_until_mapping_removed(self):
            from curriculum_api.template_ksbs import replace
            self.template_fixture()
            with self.db.transaction(), self.db.cursor() as cursor:
                replace(cursor,'T1',[{'standardKsbId':2,'weight':1}])
            with self.assertRaises(psycopg.errors.RestrictViolation), self.db.transaction():
                self.db.execute("DELETE FROM curriculum.week_template_components WHERE id='T1'")
            self.db.execute("DELETE FROM curriculum.ksb_component_mappings WHERE template_component_id='T1'")
            self.db.execute("DELETE FROM curriculum.week_template_components WHERE id='T1'")
            self.assertEqual(self.db.execute('SELECT count(*) FROM curriculum.week_template_components').fetchone()[0],1)

        def test_reconciliation_preconditions_are_read_only_and_reject_missing_owner_constraint(self):
            from types import SimpleNamespace
            from learner_api.canonical_ksb_migration import verify_schema, verify_template_ownership
            self.progress_fixture()
            self.template_fixture()
            self.db.execute('''CREATE TABLE "Learner".ksb_learner_activity_mappings(
                learner_id bigint,source_kind text,activity_id bigint,source_metadata jsonb)''')
            editor=SimpleNamespace(connection=self.db)
            before=self.db.execute('SELECT count(*) FROM curriculum.ksb_source_activity_mappings').fetchone()
            with self.db.transaction():
                self.db.execute('SET TRANSACTION READ ONLY')
                verify_schema(None,editor)
                verify_template_ownership(None,editor)
            self.assertEqual(before,self.db.execute('SELECT count(*) FROM curriculum.ksb_source_activity_mappings').fetchone())
            self.db.execute('ALTER TABLE curriculum.ksb_component_mappings DROP CONSTRAINT chk_ksb_mapping_owner')
            with self.assertRaisesRegex(RuntimeError,'constraints'):
                verify_template_ownership(None,editor)

    return unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CanonicalSourceTests)).wasSuccessful()


if __name__ == '__main__':
    isolated.run = run
    raise SystemExit(isolated.main())
