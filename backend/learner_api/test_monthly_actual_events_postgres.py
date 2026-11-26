"""Real transition triggers and races on a verified disposable local cluster."""
import importlib
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

import psycopg
from psycopg import sql

from . import test_monthly_actual_storage_postgres as guarded

migration = importlib.import_module('learner_api.migrations.0030_monthly_actual_summary_events')


@unittest.skipUnless(os.environ.get('RUN_MONTHLY_ACTUAL_STORAGE_TESTS') == '1',
                     'requires the verified private PostgreSQL runner')
class MonthlyActualEventPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        guarded.MonthlyActualStoragePostgresTests.setUpClass.__func__(cls)
        cls.config = json.loads(Path(os.environ['MONTHLY_ACTUAL_TEST_CONNECTION_FILE']).read_text())
        # The verified local connection is the only PostgreSQL alias registered
        # for refresh integration tests; no project settings/.env/ready hooks.
        from django.conf import settings
        from django.apps import apps, AppConfig
        settings.configure(INSTALLED_APPS=[], USE_TZ=True, TIME_ZONE='Europe/London',
            SECRET_KEY='isolated-monthly-events', DATABASES={
                'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'},
                'enrolment': {'ENGINE': 'django.db.backends.postgresql',
                    **{key.upper() if key != 'dbname' else 'NAME': cls.config[key]
                       for key in ('host', 'port', 'dbname', 'user', 'password')}}})
        apps.populate([AppConfig(name, importlib.import_module(name))
                       for name in ('learner_api', 'coach_api', 'login')])

    @classmethod
    def tearDownClass(cls):
        guarded.MonthlyActualStoragePostgresTests.tearDownClass.__func__(cls)

    def connection(self, **kwargs):
        connection = psycopg.connect(**{key: self.config[key] for key in
            ('host', 'port', 'dbname', 'user', 'password')}, **kwargs)
        self.addCleanup(connection.close)
        return connection

    def setUp(self):
        self.db.execute('CREATE SCHEMA "Learner"')
        self.db.execute('CREATE SCHEMA curriculum')
        for schema, name, _owner_sql, selected in migration.SPECS:
            fields = set(selected or ('id', 'course_id', 'free_module_id', 'content_ref', 'settings_json'))
            if name == 'learner_monthly_targets':
                fields.update(('actual_seconds_total', 'actual_updated_at'))
            if name == 'learner_progress_entries':
                fields.add('monthly_target_id')
            definitions = []
            for field in sorted(fields):
                kind = 'text'
                if field in {'learner_id', 'learner_profile_id', 'enrolment_id', 'aptem_id', 'progress_id',
                             'canonical_progress_id', 'source_catalog_activity_id', 'source_course_id',
                             'source_id', 'monthly_target_id', 'course_id', 'free_module_id'}:
                    kind = 'bigint'
                if field == 'id' and (schema == 'Learner' or name in (
                        'source_courses', 'source_activities', 'free_courses', 'free_course_weeks', 'free_programme_components')):
                    kind = 'bigint'
                if field.endswith('_at') or field in ('scheduled_start', 'scheduled_end'):
                    kind = 'timestamptz'
                if field in {'actual_seconds', 'actual_seconds_total', 'claimed_seconds', 'verified_seconds'}:
                    kind = 'bigint'
                if field in {'accepted', 'passed', 'completed', 'review_confirmed', 'historical_only'}:
                    kind = 'boolean'
                if field in {'target_hours', 'planned_hours', 'expected_otjh'}:
                    kind = 'numeric'
                if field in {'source_payload', 'full_submission', 'signature_data', 'definition', 'snapshot', 'records', 'settings_json'}:
                    kind = 'jsonb'
                definitions.append(sql.SQL('{} {}').format(sql.Identifier(field), sql.SQL(kind)))
            self.db.execute(sql.SQL('CREATE TABLE {}.{} ({})').format(
                sql.Identifier(schema), sql.Identifier(name), sql.SQL(',').join(definitions)))
        self.db.execute('''CREATE VIEW "Learner".monthly_audit_signoffs AS
            SELECT id,source_learner_id AS learner_id,report_month,review_confirmed
            FROM "Learner".learner_monthly_signatures''')
        self.db.execute('''INSERT INTO "Learner".learners(id,enrolment_id,aptem_id,programme_id,learner_type)
            VALUES (1,11,101,'P','apprenticeship'),(2,22,202,'P','commercial')''')
        self.db.execute('''INSERT INTO "Learner".learner_monthly_targets
            (id,learner_id,report_month,target_hours,programme_id,programme_profile_id,actual_seconds_total,actual_updated_at)
            VALUES (10,1,'2026-10',20,'P','',3600,now()),(11,1,'2026-11',20,'P','',7200,now()),
                   (20,2,'2026-10',30,'P','',1800,now())''')
        self.db.execute('''INSERT INTO "Learner".learner_progress_entries
            (id,learner_id,actual_seconds,accepted,reporting_month,source_payload)
            VALUES (101,1,3600,true,'2026-10','{}'),(201,2,1800,true,'2026-10','{}')''')
        migration.install(None, self.editor)
        self.db.commit()

    def tearDown(self):
        from django.db import connections
        connections['enrolment'].close()
        self.db.rollback()
        self.db.execute('DROP SCHEMA "Learner" CASCADE')
        self.db.execute('DROP SCHEMA curriculum CASCADE')
        self.db.commit()

    def totals(self):
        return self.db.execute('SELECT id,actual_seconds_total FROM "Learner".learner_monthly_targets ORDER BY id').fetchall()

    def test_bulk_write_invalidates_only_affected_owners(self):
        self.db.execute('''INSERT INTO "Learner".learner_progress_entries(id,learner_id,actual_seconds,accepted)
            SELECT n,1,60,true FROM generate_series(301,350) n''')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, 1800)])
        self.assertEqual(self.db.execute('SELECT actual_seconds FROM "Learner".learner_progress_entries WHERE id=101').fetchone()[0], 3600)

    def test_acceptance_month_and_owner_changes_invalidate_both_owners(self):
        self.db.execute('''UPDATE "Learner".learner_progress_entries
            SET learner_id=2,accepted=false,reporting_month='2026-11' WHERE id=101''')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, None)])

    def test_deletion_invalidates_the_original_owner(self):
        self.db.execute('DELETE FROM "Learner".learner_progress_entries WHERE id=101')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, 1800)])

    def test_snapshot_and_fk_writes_do_not_invalidate_themselves(self):
        self.db.execute('''UPDATE "Learner".learner_monthly_targets SET actual_seconds_total=4000,
            actual_updated_at=now(),actual_summary='{"version":1}' WHERE id=10''')
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE id=101')
        self.assertEqual(self.totals(), [(10, 4000), (11, 7200), (20, 1800)])

    def test_rollback_preserves_previous_totals_and_emits_no_committed_event(self):
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')
        self.db.execute('UPDATE "Learner".learner_progress_entries SET actual_seconds=5000 WHERE id=101')
        self.db.rollback()
        self.assertEqual(self.totals(), [(10, 3600), (11, 7200), (20, 1800)])
        self.assertEqual(list(listener.notifies(timeout=0.1)), [])

    def test_committed_bulk_event_contains_only_distinct_changed_ids(self):
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')
        self.db.execute('UPDATE "Learner".learner_progress_entries SET actual_seconds=actual_seconds+1')
        self.db.commit()
        events = list(listener.notifies(timeout=1, stop_after=1))
        self.assertEqual(len(events), 1)
        self.assertEqual(json.loads(events[0].payload), [1, 2])

    def test_second_source_write_while_already_invalidated_still_blocks_stale_refresh(self):
        self.db.execute('UPDATE "Learner".learner_progress_entries SET actual_seconds=4000 WHERE id=101')
        self.db.commit()
        stale = self.connection()
        stale.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        self.assertIsNone(stale.execute('SELECT actual_seconds_total FROM "Learner".learner_monthly_targets WHERE id=10').fetchone()[0])
        self.db.execute('UPDATE "Learner".learner_progress_entries SET actual_seconds=5000 WHERE id=101')
        self.db.commit()
        with self.assertRaises(psycopg.errors.SerializationFailure):
            stale.execute('UPDATE "Learner".learner_monthly_targets SET actual_seconds_total=4000,actual_updated_at=now() WHERE id=10')
        stale.rollback()
        self.assertIsNone(self.totals()[0][1])

    def test_reflections_and_timed_attempts_invalidate_the_correct_identity(self):
        self.db.execute('''INSERT INTO "Learner".learning_reflection_submissions
            (id,learner_id,learner_kind,status,actual_time_hours) VALUES (1,1,'apprenticeship','accepted','1.5')''')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, 1800)])
        self.db.execute('''INSERT INTO "Learner".subject_activity_attempts
            (id,enrolment_id,aptem_id,completed,definition) VALUES (1,22,202,true,'{"studyTime":{}}')''')
        self.assertIsNone(self.totals()[-1][1])

    def test_attendance_occurrence_changes_invalidate_only_its_registered_learners(self):
        self.db.execute('''INSERT INTO curriculum.live_session_learner_attendance
            (id,learner_profile_id,occurrence_id,live_session_id,module_catalogue_id,attendance_status)
            VALUES ('R1',1,'O1','S1','M1','present')''')
        self.db.execute('UPDATE "Learner".learner_monthly_targets SET actual_seconds_total=9000,actual_updated_at=now() WHERE learner_id=1')
        self.db.execute('''INSERT INTO curriculum.live_session_occurrences(id,live_session_id,status,scheduled_end)
            VALUES ('O1','S1','active','2026-11-21T12:00:00Z')''')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, 1800)])

    def test_same_value_update_does_not_invalidate(self):
        self.db.execute('UPDATE "Learner".learner_progress_entries SET actual_seconds=actual_seconds WHERE id=101')
        self.assertEqual(self.totals(), [(10, 3600), (11, 7200), (20, 1800)])

    def test_audit_signoff_view_writes_invalidate_canonical_and_source_identities(self):
        self.db.execute('''INSERT INTO "Learner".learner_monthly_signatures
            (id,learner_id,source_learner_id,report_month,review_confirmed)
            VALUES (1,1,'101','2026-10',true)''')
        self.db.execute('''UPDATE "Learner".learner_monthly_targets
            SET actual_seconds_total=3600,actual_updated_at=now() WHERE learner_id=1''')
        self.db.execute('''UPDATE "Learner".monthly_audit_signoffs SET learner_id='202' WHERE id=1''')
        self.assertEqual(self.totals(), [(10, None), (11, None), (20, None)])

    def test_installed_contract_has_only_statement_events_and_no_scheduler(self):
        events = self.db.execute('''SELECT tgtype,pg_get_triggerdef(oid) FROM pg_trigger
            WHERE NOT tgisinternal AND tgname LIKE 'monthly_actual_event_%%' ''').fetchall()
        self.assertEqual(len(events), 87)
        self.assertTrue(all(kind & 1 == 0 for kind, _definition in events))
        self.assertTrue(all('FOR EACH STATEMENT' in definition for _kind, definition in events))
        migration.install(None, self.editor)
        self.assertEqual(self.totals(), [(10, 3600), (11, 7200), (20, 1800)])

    def test_every_source_trigger_compiles_on_insert_update_and_delete(self):
        for schema, table, _owner_sql, fields in migration.SPECS:
            relation = sql.Identifier(schema, table)
            field = sql.Identifier((fields or ['id'])[0])
            with self.subTest(table=table):
                self.db.execute(sql.SQL('INSERT INTO {} SELECT * FROM {} WHERE false').format(relation, relation))
                self.db.execute(sql.SQL('UPDATE {} SET {}={} WHERE false').format(relation, field, field))
                self.db.execute(sql.SQL('DELETE FROM {} WHERE false').format(relation))

    def test_refresh_replaces_totals_links_rows_and_reader_uses_the_saved_generation(self):
        from learner_api import monthly_actuals as actuals
        from learner_api import journal_sources
        from django.db import connections

        with connections['enrolment'].cursor() as cursor:
            cursor.execute("SELECT host(inet_server_addr()),inet_server_port(),current_database(),current_setting('data_directory')")
            host, port, name, directory = cursor.fetchone()
        self.assertEqual((host, port, name), (self.config['host'], self.config['port'], self.config['dbname']))
        self.assertEqual(Path(directory).resolve(), Path(self.config['data_directory']).resolve())
        states = {month: dict(actual_hours=seconds / 3600, row_count=1 if seconds else 0,
            planned_hours=20, estimated_hours=0, not_accepted_hours=0, total_actual_hours=seconds / 3600,
            snapshot_digest='synthetic', submitted_hours=0, verification_hours=0)
            for month, seconds in (('2026-10', 3600), ('2026-11', 0))}
        projected = (states, {'accepted_hours': 1, 'planned_hours': 40}, True,
            [{'id': 101, 'reporting_month': '2026-10', 'actual_seconds': 3600, 'accepted': True}], [])
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')
        with patch.object(actuals, 'project', return_value=projected):
            self.assertEqual(actuals.refresh(1), 2)
            self.assertEqual(actuals.refresh(1), 2)  # retry replaces; never adds
        with journal_sources.learner_journal_reads():
            saved = actuals.snapshot({'id': 1, 'programme_id': 'P'})
        self.assertEqual(saved['months']['2026-10']['actual_hours'], 1)
        self.assertEqual(saved['months']['2026-11']['actual_hours'], 0)
        self.assertEqual(saved['training_plan_totals']['accepted_hours'], 1)
        self.assertEqual(self.db.execute('''SELECT actual_seconds,monthly_target_id
            FROM "Learner".learner_progress_entries WHERE id=101''').fetchone(), (3600, 10))
        self.assertEqual(self.totals()[-1], (20, 1800))
        self.assertEqual(list(listener.notifies(timeout=0.1)), [])

    def install_attempt_links(self):
        attempt_migration = importlib.import_module('learner_api.migrations.0032_subject_attempt_monthly_target_link')
        self.db.execute('''ALTER TABLE "Learner".learner_monthly_targets
            ALTER COLUMN id SET NOT NULL, ALTER COLUMN learner_id SET NOT NULL,
            ADD CONSTRAINT learner_monthly_targets_id_learner_uniq UNIQUE(id,learner_id)''')
        self.db.execute('''ALTER TABLE "Learner".subject_activity_attempts
            ADD COLUMN learner_id bigint NOT NULL,
            ALTER COLUMN id TYPE uuid USING id::text::uuid''')
        before = self.totals()
        attempt_migration.install(None, self.editor)
        attempt_migration.install(None, self.editor)
        self.assertEqual(self.totals(), before)
        return attempt_migration

    def test_attempt_fk_owner_uk_month_missing_dates_and_no_recursive_events(self):
        from learner_api import monthly_actuals as actuals
        from django.db.migrations.exceptions import IrreversibleError
        attempt_migration = self.install_attempt_links()
        ids = [f'00000000-0000-0000-0000-{index:012d}' for index in range(1, 8)]
        for index, (owner, submitted, timing) in enumerate([
            (1, '2026-10-05T12:00:00Z', {'declaredCompletedAt': '2026-09-30T23:30:00Z'}),
            (1, '2026-10-05T12:00:00Z', {'declaredCompletedAt': '2026-11-01T00:30:00Z'}),
            (1, None, {}),
            (1, '2027-01-02T12:00:00Z', {}),
            (1, '2026-10-05T12:00:00Z', {'declaredCompletedAt': 'invalid'}),
            (2, '2026-10-05T12:00:00Z', {}),
            (1, '2026-10-05T12:00:00Z', {'declaredCompletedAt': 123}),
        ]):
            self.db.execute('''INSERT INTO "Learner".subject_activity_attempts
                (id,learner_id,submitted_at,definition) VALUES (%s,%s,%s,%s::jsonb)''',
                [ids[index], owner, submitted, json.dumps({'studyTime': timing})])
        # Canonical learner_id invalidates even without old enrolment/Aptem keys.
        self.assertEqual(self.totals(), [(10,None),(11,None),(20,None)])
        self.db.execute('''UPDATE "Learner".learner_monthly_targets
            SET actual_seconds_total=1800,actual_updated_at=now() WHERE id=20''')
        self.db.commit()
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')

        def project(owner, targets, *, journal):
            states = {month: dict(actual_hours=0,row_count=0,planned_hours=20,estimated_hours=0,
                not_accepted_hours=0,total_actual_hours=0,snapshot_digest='synthetic',
                submitted_hours=0,verification_hours=0) for month in targets}
            return states, {'accepted_hours':0,'planned_hours':sum(targets.values())}, True, [], []

        with patch.object(actuals, 'project', side_effect=project):
            actuals.refresh(1)
            actuals.refresh(1)
        links = self.db.execute('''SELECT id::text,monthly_target_id
            FROM "Learner".subject_activity_attempts ORDER BY id''').fetchall()
        self.assertEqual(links, list(zip(ids, [10,11,None,None,None,None,None])))
        self.assertEqual(self.totals(), [(10,0),(11,0),(20,1800)])
        self.assertEqual(list(listener.notifies(timeout=.1)), [])
        for target in (999,20):
            with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.db.transaction():
                self.db.execute('UPDATE "Learner".subject_activity_attempts SET monthly_target_id=%s WHERE id=%s', [target,ids[0]])
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.db.transaction():
            self.db.execute('UPDATE "Learner".subject_activity_attempts SET learner_id=2 WHERE id=%s', [ids[0]])
        with self.assertRaises((psycopg.errors.ForeignKeyViolation, psycopg.errors.RestrictViolation)), self.db.transaction():
            self.db.execute('DELETE FROM "Learner".learner_monthly_targets WHERE id=10')
        with self.assertRaises(IrreversibleError), self.db.transaction():
            attempt_migration.uninstall(None, self.editor)
        self.db.execute('''UPDATE "Learner".subject_activity_attempts
            SET monthly_target_id=NULL,learner_id=2 WHERE id=%s''', [ids[0]])
        self.db.commit()
        event = list(listener.notifies(timeout=2, stop_after=1))[0]
        self.assertEqual(json.loads(event.payload), [1,2])

    def test_attempt_events_refresh_selected_time_without_counting_retakes_twice(self):
        from learner_api import monthly_actuals as actuals, current_learning
        from learner_api.management.commands.listen_monthly_actuals import consume
        self.install_attempt_links()
        self.db.commit()
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')
        ids = ['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002']
        for index, seconds in enumerate((1800,600)):
            timing = {'version':1,'verifiedSeconds':seconds,'selectedSeconds':seconds,
                      'timeEntrySource':'input','submittedAt':f'2026-10-{10+index}T12:00:00Z'}
            if index:
                timing['retakeTimeChoice'] = 'keep'
            self.db.execute('''INSERT INTO "Learner".subject_activity_attempts
                (id,learner_id,enrolment_id,aptem_id,group_id,activity_id,completed,submitted_at,definition)
                VALUES (%s,1,11,101,'G','A',true,%s,%s::jsonb)''',
                [ids[index],timing['submittedAt'],json.dumps({'studyTime':timing})])
        self.db.commit()

        def project(owner, targets, *, journal):
            # Use the actual persisted-attempt selection and timing functions.
            records = [current_learning.measured_attempt_record(attempt,{})
                       for attempt in current_learning.subject_attempt_rows(owner)]
            records = [record for record in records if record is not None]
            states = {}
            for month in targets:
                selected = [r for r in records if r['reporting_month']==month]
                hours = sum(r['actual_seconds'] for r in selected)/3600
                states[month] = dict(actual_hours=hours,row_count=len(selected),planned_hours=20,
                    estimated_hours=0,not_accepted_hours=0,total_actual_hours=hours,
                    snapshot_digest='synthetic',submitted_hours=0,verification_hours=0)
            return states, {'accepted_hours':sum(r['actual_seconds'] for r in records)/3600,
                            'planned_hours':sum(targets.values())}, True, records, []

        with patch.object(actuals, 'project', side_effect=project):
            for step, expected in enumerate(((1800,0),(2400,0),(0,2400),(600,0))):
                if step == 1:
                    self.db.execute('''UPDATE "Learner".subject_activity_attempts
                        SET definition=jsonb_set(definition,'{studyTime,selectedSeconds}','2400') WHERE id=%s''', [ids[0]])
                elif step == 2:
                    self.db.execute('''UPDATE "Learner".subject_activity_attempts SET definition=
                        jsonb_set(definition,'{studyTime,declaredCompletedAt}','"2026-11-02T12:00:00Z"') WHERE id=%s''', [ids[0]])
                elif step == 3:
                    self.db.execute('DELETE FROM "Learner".subject_activity_attempts WHERE id=%s', [ids[0]])
                self.db.commit()
                event = list(listener.notifies(timeout=2, stop_after=1))[0]
                self.assertEqual(consume(event, using='enrolment', refresh_one=actuals.refresh), (1,0))
                self.assertEqual(self.totals(), [(10,expected[0]),(11,expected[1]),(20,1800)])
                self.db.commit()
                self.assertEqual(consume(event, using='enrolment', refresh_one=actuals.refresh), (1,0))
                self.assertEqual(self.totals(), [(10,expected[0]),(11,expected[1]),(20,1800)])
                self.db.commit()
                self.assertEqual(list(listener.notifies(timeout=.1)), [])
                if step == 2:
                    links = self.db.execute('SELECT id::text,monthly_target_id FROM "Learner".subject_activity_attempts ORDER BY id').fetchall()
                    self.assertEqual(links, [(ids[0],11),(ids[1],10)])

    def test_attendance_fk_refresh_owner_month_retries_and_missing_target(self):
        from learner_api import monthly_actuals as actuals
        from django.db.migrations.exceptions import IrreversibleError
        attendance_migration = importlib.import_module('learner_api.migrations.0031_attendance_monthly_target_link')
        # The general event fixture has intentionally loose synthetic tables;
        # match the actual owner keys for this FK integration test.
        self.db.execute('''ALTER TABLE "Learner".learner_monthly_targets
            ALTER COLUMN id SET NOT NULL, ALTER COLUMN learner_id SET NOT NULL,
            ADD CONSTRAINT learner_monthly_targets_id_learner_uniq UNIQUE(id,learner_id)''')
        self.db.execute('''ALTER TABLE curriculum.live_session_learner_attendance
            ALTER COLUMN learner_profile_id SET NOT NULL''')
        before = self.totals()
        attendance_migration.install(None, self.editor)
        attendance_migration.install(None, self.editor)
        self.assertEqual(self.totals(), before)
        self.db.execute('''INSERT INTO curriculum.live_session_occurrences
            (id,live_session_id,scheduled_start,scheduled_end,status)
            VALUES ('O1','S1','2026-09-30T23:30:00Z','2026-10-01T01:30:00Z','active')''')
        self.db.execute('''INSERT INTO curriculum.live_session_learner_attendance
            (id,learner_profile_id,occurrence_id,live_session_id,module_catalogue_id,attendance_status)
            VALUES ('R1',1,'O1','S1','M1','present'),('R2',1,'O1','S1','M2','absent'),
                   ('R3',2,'O1','S1','M1','present')''')
        for target in (999, 20):
            with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.db.transaction():
                self.db.execute('UPDATE curriculum.live_session_learner_attendance SET monthly_target_id=%s WHERE id=%s', [target,'R1'])
        self.db.commit()
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')

        def project(owner, targets, *, journal):
            states = {month: dict(actual_hours=0, row_count=0, planned_hours=20, estimated_hours=0,
                not_accepted_hours=0, total_actual_hours=0, snapshot_digest='synthetic',
                submitted_hours=0, verification_hours=0) for month in targets}
            return states, {'accepted_hours':0,'planned_hours':sum(targets.values())}, True, [], []

        def links():
            return self.db.execute('SELECT id,monthly_target_id FROM curriculum.live_session_learner_attendance ORDER BY id').fetchall()

        with patch.object(actuals, 'project', side_effect=project):
            actuals.refresh(1)
            self.assertEqual(links(), [('R1',10),('R2',10),('R3',None)])
            self.db.commit()
            actuals.refresh(1)
            self.assertEqual(links(), [('R1',10),('R2',10),('R3',None)])
            self.db.commit()
            self.assertEqual(list(listener.notifies(timeout=.1)), [])
            for statement in (
                "UPDATE curriculum.live_session_learner_attendance SET learner_profile_id=2 WHERE id='R1'",
                'DELETE FROM "Learner".learner_monthly_targets WHERE id=10',
            ):
                with self.assertRaises(psycopg.IntegrityError), self.db.transaction():
                    self.db.execute(statement)
            with self.assertRaises(IrreversibleError), self.db.transaction():
                attendance_migration.uninstall(None, self.editor)
            self.db.execute("UPDATE curriculum.live_session_occurrences SET scheduled_start='2026-11-01T01:00:00Z' WHERE id='O1'")
            self.db.commit()
            event = list(listener.notifies(timeout=2, stop_after=1))[0]
            self.assertEqual(set(json.loads(event.payload)), {1,2})
            actuals.refresh(1)
            self.assertEqual(links(), [('R1',11),('R2',11),('R3',None)])
            self.db.commit()
            # Target-less months stay unlinked, without inventing a target row.
            self.db.execute("UPDATE curriculum.live_session_occurrences SET scheduled_start='2027-01-01T01:00:00Z' WHERE id='O1'")
            self.db.commit()
            actuals.refresh(1)
            self.assertEqual(links(), [('R1',None),('R2',None),('R3',None)])
            self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".learner_monthly_targets').fetchone()[0], 3)

    def test_committed_activity_events_refresh_acceptance_changes_once(self):
        from learner_api import monthly_actuals as actuals
        from learner_api.management.commands.listen_monthly_actuals import consume

        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')

        def project(owner, targets, *, journal):
            # The disposable fixture supplies an intentionally small projector;
            # the real trigger, notification, consumer and atomic refresh run.
            records = [{'id': ident, 'reporting_month': month, 'actual_seconds': seconds, 'accepted': accepted}
                       for ident, month, seconds, accepted in self.db.execute('''
                           SELECT id,reporting_month,actual_seconds,accepted
                           FROM "Learner".learner_progress_entries WHERE learner_id=%s''', [owner['id']]).fetchall()]
            states = {}
            for month in targets:
                allocated = [r for r in records if r['reporting_month'] == month]
                seconds = sum(r['actual_seconds'] or 0 for r in allocated if r['accepted'] is True)
                states[month] = dict(actual_hours=seconds/3600, row_count=len(allocated), planned_hours=20,
                    estimated_hours=0, not_accepted_hours=0, total_actual_hours=seconds/3600,
                    snapshot_digest='synthetic', submitted_hours=0, verification_hours=0)
            return states, {'accepted_hours':sum(v['actual_hours'] for v in states.values()),
                            'planned_hours':sum(targets.values())}, True, records, []

        statements = [
            ('''INSERT INTO "Learner".learner_progress_entries
                (id,learner_id,actual_seconds,accepted,reporting_month) VALUES (501,1,1800,false,'2026-10')''',3600),
            ('UPDATE "Learner".learner_progress_entries SET accepted=true WHERE id=501',5400),
            ('DELETE FROM "Learner".learner_progress_entries WHERE id=501',3600),
        ]
        with patch.object(actuals, 'project', side_effect=project):
            for statement, expected in statements:
                self.db.execute(statement)
                self.db.commit()
                events = list(listener.notifies(timeout=2, stop_after=1))
                self.assertEqual(len(events), 1)
                self.assertEqual(consume(events[0], using='enrolment', refresh_one=actuals.refresh), (1, 0))
                self.assertEqual(self.totals(), [(10,expected),(11,0),(20,1800)])
                self.db.commit()
                # A redelivered event replaces the total; it never adds again.
                self.assertEqual(consume(events[0], using='enrolment', refresh_one=actuals.refresh), (1, 0))
                self.assertEqual(self.totals(), [(10,expected),(11,0),(20,1800)])
                self.db.commit()

    def install_assignment_links(self):
        assignment = importlib.import_module('learner_api.migrations.0034_assignment_monthly_target_link')
        self.db.execute('''ALTER TABLE "Learner".learner_monthly_targets
            ALTER COLUMN id SET NOT NULL, ALTER COLUMN learner_id SET NOT NULL,
            ADD CONSTRAINT learner_monthly_targets_id_learner_uniq UNIQUE(id,learner_id)''')
        self.db.execute('''ALTER TABLE "Learner".learning_reflection_submissions
            ALTER COLUMN learner_id SET NOT NULL, ALTER COLUMN id SET NOT NULL,
            ALTER COLUMN id TYPE uuid USING id::text::uuid''')
        before = self.totals()
        assignment.install(None, self.editor)
        assignment.install(None, self.editor)
        self.assertEqual(self.totals(), before)
        return assignment

    def test_assignment_fk_protects_owner_and_retained_links(self):
        from django.db.migrations.exceptions import IrreversibleError
        assignment = self.install_assignment_links()
        ident = '20000000-0000-0000-0000-000000000001'
        self.db.execute('''INSERT INTO "Learner".learning_reflection_submissions
            (id,learner_id,learner_kind,activity_type,status,monthly_target_id)
            VALUES (%s,1,'apprenticeship','assignment','accepted',10)''', [ident])
        for target in (999, 20):
            with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.db.transaction():
                self.db.execute('UPDATE "Learner".learning_reflection_submissions SET monthly_target_id=%s WHERE id=%s',
                                [target, ident])
        with self.assertRaises(psycopg.errors.ForeignKeyViolation), self.db.transaction():
            self.db.execute('UPDATE "Learner".learning_reflection_submissions SET learner_id=2 WHERE id=%s', [ident])
        with self.assertRaises((psycopg.errors.ForeignKeyViolation, psycopg.errors.RestrictViolation)), self.db.transaction():
            self.db.execute('DELETE FROM "Learner".learner_monthly_targets WHERE id=10')
        with self.assertRaises(IrreversibleError), self.db.transaction():
            assignment.uninstall(None, self.editor)
        self.db.execute('UPDATE "Learner".learning_reflection_submissions SET monthly_target_id=NULL WHERE id=%s', [ident])
        assignment.uninstall(None, self.editor)
        assignment.install(None, self.editor)

    def test_assignment_committed_events_relink_and_refresh_without_changing_hour_rules(self):
        from learner_api import monthly_actuals as actuals, current_learning, monthly_log_attendance
        from learner_api.management.commands.listen_monthly_actuals import consume
        self.install_assignment_links()
        self.db.execute('DELETE FROM "Learner".learner_progress_entries WHERE learner_id=1')
        self.db.commit()
        listener = self.connection(autocommit=True)
        listener.execute('LISTEN lms_monthly_actuals_changed')
        ident = '20000000-0000-0000-0000-000000000002'

        def records(owner, **kwargs):
            # Exercise actual reflection projection, allocation, Monthly Logs
            # totals, database events and consumer. Only unrelated ledger and
            # attendance loading is replaced by this disposable fixture.
            progress = actuals.repository.query('''SELECT id,learner_id,component_ref,accepted,
                actual_seconds,reporting_month,source_system,kind FROM "Learner".learner_progress_entries
                WHERE learner_id=%s AND deleted_at IS NULL''', [owner['id']])
            for row in progress:
                row.update(ksbs=[], sources=[], segments=[])
            result = current_learning.current_records(owner, progress)
            for row in result:
                row['_monthly_documents_loaded'] = True
            return result

        self.db.execute('''INSERT INTO "Learner".learning_reflection_submissions
            (id,learner_id,learner_kind,activity_type,status,submitted_at,actual_time_hours,component_ref,full_submission)
            VALUES (%s,1,'apprenticeship','assignment','draft','2026-09-30T23:30:00Z','1.5','A',
                '{"monthlyAssignment":{"month":"2026-11"}}')''', [ident])
        steps = [
            (None, (), (0, 0), None),
            ("UPDATE \"Learner\".learning_reflection_submissions SET status='submitted_for_tutor_review' WHERE id=%s", (ident,), (0, 0), 10),
            ("UPDATE \"Learner\".learning_reflection_submissions SET status='accepted' WHERE id=%s", (ident,), (5400, 0), 10),
            ("UPDATE \"Learner\".learning_reflection_submissions SET status='partial',actual_time_hours='2' WHERE id=%s", (ident,), (7200, 0), 10),
            ("UPDATE \"Learner\".learning_reflection_submissions SET submitted_at='2026-11-02T12:00:00Z' WHERE id=%s", (ident,), (0, 7200), 11),
            ('''INSERT INTO "Learner".learner_progress_entries
                (id,learner_id,component_ref,accepted,actual_seconds,reporting_month,source_system,kind)
                VALUES (102,1,'A',true,7200,'2026-11','synthetic','assignment')''', (), (0, 7200), 11),
            ("DELETE FROM \"Learner\".learner_progress_entries WHERE id=102", (), (0, 7200), 11),
            ("UPDATE \"Learner\".learning_reflection_submissions SET status='rejected' WHERE id=%s", (ident,), (0, 0), 11),
            ("DELETE FROM \"Learner\".learning_reflection_submissions WHERE id=%s", (ident,), (0, 0), None),
        ]
        with patch.object(actuals.canonical, 'entries_for', side_effect=records), \
                patch.object(monthly_log_attendance, 'read_rows', return_value=[]):
            for step, (statement, params, expected, target) in enumerate(steps):
                if statement:
                    self.db.execute(statement, params or None)
                self.db.commit()
                events = list(listener.notifies(timeout=2, stop_after=1))
                self.assertEqual(len(events), 1)
                self.assertEqual(consume(events[0], using='enrolment', refresh_one=actuals.refresh), (1, 0))
                self.assertEqual(self.totals(), [(10, expected[0]), (11, expected[1]), (20, 1800)])
                linked = self.db.execute('''SELECT monthly_target_id FROM "Learner".learning_reflection_submissions
                    WHERE id=%s''', [ident]).fetchone()
                self.assertEqual(linked, None if step == len(steps) - 1 else (target,))
                self.db.commit()
                self.assertEqual(consume(events[0], using='enrolment', refresh_one=actuals.refresh), (1, 0))
                self.assertEqual(self.totals(), [(10, expected[0]), (11, expected[1]), (20, 1800)])
                self.db.commit()
                self.assertEqual(list(listener.notifies(timeout=.1)), [])

        # Owner changes must clear the old FK; the committed event refreshes
        # both owners and links only to the new owner's current monthly row.
        self.db.execute('''INSERT INTO "Learner".learning_reflection_submissions
            (id,learner_id,learner_kind,activity_type,status,submitted_at,actual_time_hours)
            VALUES (%s,1,'apprenticeship','assignment','accepted','2026-10-15T12:00:00Z','1.5')''', [ident])
        self.db.commit()
        with patch.object(actuals.canonical, 'entries_for', side_effect=records), \
                patch.object(monthly_log_attendance, 'read_rows', return_value=[]):
            event = list(listener.notifies(timeout=2, stop_after=1))[0]
            self.assertEqual(consume(event, using='enrolment', refresh_one=actuals.refresh), (1, 0))
            self.db.execute('''UPDATE "Learner".learning_reflection_submissions
                SET monthly_target_id=NULL,learner_id=2,learner_kind='commercial' WHERE id=%s''', [ident])
            self.db.commit()
            event = list(listener.notifies(timeout=2, stop_after=1))[0]
            self.assertEqual(json.loads(event.payload), [1, 2])
            self.assertEqual(consume(event, using='enrolment', refresh_one=actuals.refresh), (2, 0))
            self.assertEqual(self.totals(), [(10, 0), (11, 0), (20, 7200)])
            self.assertEqual(self.db.execute('''SELECT learner_id,monthly_target_id
                FROM "Learner".learning_reflection_submissions WHERE id=%s''', [ident]).fetchone(), (2, 20))
