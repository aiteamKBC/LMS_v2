"""Synthetic compatibility checks in an explicitly selected disposable cluster.

Usage: --port PORT --data-directory PATH --schema-json PATH
Schema JSON is read-only catalog output (columns, constraints, indexes, triggers).
Development supplies only the view/trigger definitions; no learner data is copied.
"""
import argparse
import hashlib
from contextlib import ExitStack, nullcontext
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from verify_inclusion_canonical_targets import connect_development


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--data-directory', type=Path, required=True)
    parser.add_argument('--schema-json', type=Path, required=True)
    args = parser.parse_args()
    db = psycopg.connect(host='127.0.0.1', port=args.port, user='postgres', dbname='postgres', connect_timeout=5)
    host, port, directory, branch = db.execute("""SELECT host(inet_server_addr()),
        inet_server_port(),current_setting('data_directory'),current_setting('neon.branch_id',true)""").fetchone()
    assert host == '127.0.0.1' and port == args.port and not branch
    assert Path(directory).resolve() == args.data_directory.resolve()
    assert args.data_directory.parent.name.startswith('lms_three_closure_')
    assert db.execute("SELECT count(*) FROM pg_namespace WHERE nspname='Learner'").fetchone()[0] == 0
    schema = json.loads(args.schema_json.read_text())
    with connect_development() as dev:
        view = dev.execute("SELECT pg_get_viewdef('\"Learner\".verified_teams_attendance'::regclass)").fetchone()[0]
        functions = [dev.execute('SELECT pg_get_functiondef(%s::regprocedure)', [name]).fetchone()[0]
                     for name in ('"Learner".monthly_actual_event_17()', '"Learner".link_progress_kbc_attendance()')]
        link_trigger = dev.execute('''SELECT pg_get_triggerdef(oid) FROM pg_trigger
            WHERE tgrelid='"Learner".learner_progress_entries'::regclass
            AND tgname='trg_link_progress_kbc_attendance' AND tgenabled='O' ''').fetchone()[0]
        dev.rollback()
    print('Development function SHA256:', [hashlib.sha256(value.encode()).hexdigest() for value in functions], flush=True)
    db.execute('CREATE SCHEMA "Learner"')
    db.execute('''CREATE TABLE "Learner".learners(id bigint PRIMARY KEY, aptem_id bigint,
        enrolment_id bigint,full_name text,email text)''')
    db.execute('''INSERT INTO "Learner".learners VALUES (70,7001,7,'Synthetic A','a@example.invalid'),
        (80,8001,8,'Synthetic B','b@example.invalid')''')
    for table, meta in schema.items():
        definitions = []
        for name, datatype, required, default in meta['columns']:
            if default and 'nextval' in default:
                db.execute(f'CREATE SEQUENCE "Learner".{table}_id_seq')
            definitions.append(f'"{name}" {datatype}' + (' NOT NULL' if required else '') +
                               (f' DEFAULT {default}' if default else ''))
        db.execute(f'CREATE TABLE "Learner".{table} ({",".join(definitions)})')
        for name, kind, definition, validated in meta['constraints']:
            assert validated
            db.execute(f'ALTER TABLE "Learner".{table} ADD CONSTRAINT "{name}" {definition}')
        constraints = {row[0] for row in meta['constraints']}
        for name, definition in meta['indexes']:
            if name not in constraints:
                db.execute(definition)
    db.execute('CREATE VIEW "Learner".verified_teams_attendance AS ' + view)
    db.execute('CREATE TABLE invalidations (owners bigint[])')
    db.execute('''CREATE FUNCTION "Learner".invalidate_monthly_actuals(bigint[]) RETURNS void
        LANGUAGE sql AS $$ INSERT INTO invalidations VALUES ($1) $$''')
    for definition in functions:
        db.execute(definition)
    for definition, _, _ in schema['source_lms_attendance']['triggers']:
        db.execute(definition)
    db.execute('''CREATE TABLE "Learner".learner_progress_entries(learner_id bigint,
        kbc_attendance_key text,source_payload jsonb)''')
    db.execute(link_trigger)
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    import django
    from django.db.backends.base.base import BaseDatabaseWrapper
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Unexpected database')):
        django.setup()
    from learner_api import teams_attendance as teams

    class Compatibility(unittest.TestCase):
        def setUp(self):
            db.execute('SAVEPOINT test_case')

        def tearDown(self):
            db.execute('ROLLBACK TO SAVEPOINT test_case')
            db.execute('RELEASE SAVEPOINT test_case')

        def source(self):
            db.execute('''INSERT INTO "Learner".source_lms_attendance
                (source_key,aptem_id,learner_id,activity_hours,attendance_value,attendance_date,attendance_status,module)
                VALUES ('change',7001,70,1,1,'2026-10-01','present','Synthetic')''')

        def test_source_insert_and_delete_invalidate_only_canonical_owner(self):
            self.source()
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [([70],)])
            db.execute('DELETE FROM invalidations')
            db.execute('DELETE FROM "Learner".source_lms_attendance')
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [([70],)])

        def test_source_unchanged_and_sync_timestamp_updates_do_not_invalidate(self):
            self.source()
            db.execute('DELETE FROM invalidations')
            db.execute('UPDATE "Learner".source_lms_attendance SET activity_hours=activity_hours')
            db.execute('UPDATE "Learner".source_lms_attendance SET synced_at=now()')
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [])

        def test_source_auto_link_requires_both_owner_identifiers(self):
            self.source()
            db.execute('''INSERT INTO "Learner".learner_progress_entries VALUES
                (70,NULL,'{"original_source_ref":"att:change"}'),
                (80,NULL,'{"original_source_ref":"att:change"}')''')
            self.assertEqual(db.execute('SELECT learner_id,kbc_attendance_key FROM "Learner".learner_progress_entries ORDER BY learner_id').fetchall(),
                             [(70,'change'),(80,None)])
            db.execute('UPDATE "Learner".source_lms_attendance SET learner_id=80')
            db.execute('DELETE FROM "Learner".learner_progress_entries')
            db.execute('''INSERT INTO "Learner".learner_progress_entries VALUES
                (70,NULL,'{"original_source_ref":"att:change"}'),
                (80,NULL,'{"original_source_ref":"att:change"}')''')
            self.assertEqual(db.execute('SELECT kbc_attendance_key FROM "Learner".learner_progress_entries').fetchall(), [(None,), (None,)])

        def test_source_explicit_link_rejects_wrong_aptem_for_canonical_owner(self):
            self.source()
            db.execute('UPDATE "Learner".source_lms_attendance SET aptem_id=8001')
            with self.assertRaises(psycopg.IntegrityError):
                with db.transaction():
                    db.execute('''INSERT INTO "Learner".learner_progress_entries VALUES(70,'change','{}')''')

        def test_source_bulk_owner_swap_invalidates_both_owners(self):
            self.source()
            db.execute('''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id,learner_id)
                VALUES ('second',8001,80)''')
            db.execute('DELETE FROM invalidations')
            db.execute('''UPDATE "Learner".source_lms_attendance SET learner_id=CASE learner_id WHEN 70 THEN 80 ELSE 70 END''')
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [([70,80],)])

        def test_reporting_upsert_retry_identity_and_view(self):
            now = datetime.now(timezone.utc)
            row = {name: None for name, *_ in schema['learner_attendance_details']['columns']}
            row.update(learner_id=70, enrolment_id=7, learner_profile_id=70,
                learner_name='Old display name', learner_email='old@example.invalid',
                session_id='O1', occurrence_id='O1', session_title='Synthetic', session_type='live_session',
                session_date=date(2026,11,24), attendance_status='present', minutes_late=0,
                catchup_completed=False, attended_seconds=3600, is_expected=True,
                calculated_at=now, updated_at=now, module_catalogue_id='M1')
            with ExitStack() as stack:
                stack.enter_context(patch.object(teams.router, 'db_for_write', return_value='isolated'))
                stack.enter_context(patch.object(teams, 'connections', {'isolated': db}))
                stack.enter_context(patch.object(teams.transaction, 'atomic', side_effect=lambda **_: nullcontext()))
                stack.enter_context(patch.object(teams, 'fetch_verified_teams_attendance_rows', return_value=[row]))
                stack.enter_context(patch.object(teams, '_verified_occurrence_ids', return_value=['O1']))
                stack.enter_context(patch.object(teams, '_ATTENDANCE_SCHEMA_READY_DATABASES', set()))
                for target in ('learner_api.teams_attendance.upsert_live_session_register',
                    'learner_api.teams_attendance._award_attendance_points',
                    'curriculum_api.parallel_attendance_register.reconcile_parallel_attendance',
                    'engagement_api.feedback_delivery.reconcile_feedback_after_attendance_commit'):
                    stack.enter_context(patch(target))
                stack.enter_context(patch('curriculum_api.shared_session_register.shared_register_rows', return_value=[]))
                teams.ensure_teams_attendance_reporting_columns('isolated')
                for _ in range(2):
                    self.assertEqual(teams.sync_verified_teams_attendance_reporting(module_refs=['M1']), 1)
            self.assertEqual(db.execute('''SELECT learner_id,learner_profile_id,enrolment_id,learner_name,
                learner_email,attended_seconds FROM "Learner".verified_teams_attendance''').fetchall(),
                [(70,70,7,'Synthetic A','a@example.invalid',3600)])

        def test_monthly_and_otjh_queries_keep_credit_and_canonical_deduplication(self):
            from learner_api import monthly_log_attendance as monthly, attendance_otjh as otjh
            db.execute('CREATE SCHEMA curriculum')
            for statement in (
                '''CREATE TABLE curriculum.live_session_learner_attendance
                    (occurrence_id text,live_session_id text,module_catalogue_id text,
                     learner_profile_id bigint,attendance_status text,attended_seconds integer)''',
                'CREATE TABLE curriculum.live_sessions(id text,status text)',
                'CREATE TABLE curriculum.modules(module_catalogue_id text,title text)',
                '''CREATE TABLE curriculum.live_session_occurrences(id text,live_session_id text,session_number integer,
                    scheduled_start timestamptz,scheduled_end timestamptz,status text)''',
                'CREATE TABLE curriculum.components(id text,settings_json jsonb,module_catalogue_id text,type text)',
                '''CREATE TABLE "Learner".learner_monthly_signatures(id integer,learner_id bigint,
                    report_month text,signature_data text,review_confirmed boolean,signed_at timestamptz)''',
                '''CREATE TABLE "Learner".learner_monthly_locks(learner_id bigint,report_month text,
                    locked_at timestamptz,unlocked_at timestamptz)''',
                '''CREATE TABLE "Learner".manual_month_finalization_events(id integer,aptem_id bigint,
                    report_month text,event_type text)''',
                '''CREATE TABLE "Learner".monthly_audit_signoffs(learner_id text,report_month text,review_confirmed boolean)''',
            ):
                db.execute(statement)
            for field, datatype in {
                'id': 'integer', 'time_tracking_session_ref': 'text', 'module_ref': 'text',
                'component_ref': 'text', 'curriculum_component_ref': 'text', 'deleted_at': 'timestamptz',
                'actual_seconds': 'integer', 'accepted': 'boolean', 'actual_basis': 'text',
                'source_system': 'text', 'component_link_source': 'text', 'kind': 'text',
                'submitted_at': 'timestamptz', 'declared_completed_at': 'timestamptz',
                'reporting_month': 'text', 'component_type': 'text',
            }.items():
                db.execute(f'ALTER TABLE "Learner".learner_progress_entries ADD COLUMN {field} {datatype}')
            db.execute("INSERT INTO curriculum.live_sessions VALUES ('S','active')")
            db.execute("INSERT INTO curriculum.modules VALUES ('M1','Synthetic')")
            db.execute("""INSERT INTO curriculum.live_session_occurrences VALUES
                ('O1','S',1,'2026-10-01T09:00:00Z','2026-10-01T11:00:00Z','completed')""")
            db.execute("INSERT INTO curriculum.live_session_learner_attendance VALUES ('O1','S','M1',70,'present',240)")
            self.source()
            def read(sql, params):
                cursor = db.execute(sql, params)
                return [dict(zip([c.name for c in cursor.description], row)) for row in cursor.fetchall()]
            owner = {'id': 70, 'enrolment_id': 7, 'learner_type': 'apprenticeship'}
            now = datetime(2026,11,7,tzinfo=timezone.utc)
            with patch.object(monthly, 'query', side_effect=read):
                self.assertEqual(monthly.read_rows(owner, now=now)[0]['actual_hours'], 2.5)
                self.assertEqual(otjh.aggregate_delta(otjh.read_bulk([owner],read,now=now)[70], []), 9000)
                self.assertEqual(monthly.read_rows({**owner,'id':80}, now=now), [])
                db.execute('''INSERT INTO "Learner".learner_progress_entries
                    (id,learner_id,source_payload,accepted,actual_seconds,kind)
                    VALUES(1,70,'{"original_source_ref":"att:change","kbc_attendance":{"date":"2026-10-01","module":"Synthetic"}}',true,3600,'attendance')''')
                self.assertEqual(monthly.read_rows(owner, now=now), [])
                db.execute('UPDATE "Learner".source_lms_attendance SET learner_id=80')
                before = db.execute('SELECT to_jsonb(p)::text FROM "Learner".learner_progress_entries p').fetchall()
                self.assertEqual(monthly.read_rows(owner, now=now)[0]['actual_hours'], 2.5)
                self.assertEqual(db.execute('SELECT to_jsonb(p)::text FROM "Learner".learner_progress_entries p').fetchall(), before)

        def test_source_fk_and_existing_owner_link(self):
            db.execute('''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id,learner_id)
                VALUES ('synthetic',7001,70)''')
            db.execute('''INSERT INTO "Learner".learner_progress_entries VALUES(70,'synthetic','{}')''')
            self.assertEqual(db.execute('SELECT owners FROM invalidations ORDER BY ctid DESC LIMIT 1').fetchone(), ([70],))
            for statement in (
                '''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id) VALUES('missing',7001)''',
                '''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id,learner_id) VALUES('orphan',7001,999)''',
                '''INSERT INTO "Learner".learner_progress_entries VALUES(80,'synthetic','{}')''',
                '''DELETE FROM "Learner".learners WHERE id=70'''):
                with self.assertRaises(psycopg.IntegrityError):
                    with db.transaction():
                        db.execute(statement)

        def test_source_trigger_canonical_owner_change(self):
            db.execute('''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id,learner_id)
                VALUES ('owner-change',7001,70)''')
            db.execute('DELETE FROM invalidations')
            db.execute('''UPDATE "Learner".source_lms_attendance SET learner_id=80 WHERE source_key='owner-change' ''')
            # Contract: invalidate both canonical owners after reassignment.
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [([70,80],)])

        def test_source_link_trigger_requires_canonical_ownership(self):
            # The schema permits this legacy/canonical disagreement. Ownership
            # must follow learner_id, not accept the stale Aptem identifier.
            db.execute('''INSERT INTO "Learner".source_lms_attendance(source_key,aptem_id,learner_id)
                VALUES ('stale-aptem',7001,80)''')
            with self.assertRaises(psycopg.IntegrityError):
                with db.transaction():
                    db.execute('''INSERT INTO "Learner".learner_progress_entries
                        VALUES(70,'stale-aptem','{}')''')

        def test_restore_historical_months_and_scoped_filter(self):
            for month in ('','all','unknown','2026-11'):
                db.execute('''INSERT INTO "Learner".learner_month_restore_points(learner_id,report_month,
                    point_kind,snapshot_hash,snapshot,source_system,source_ref,created_at)
                    VALUES(70,%s,'synthetic','hash','{"progress":[]}', 'isolated',%s,now())''', [month,month])
            self.assertEqual(db.execute('''SELECT count(*) FROM "Learner".learner_month_restore_points
                WHERE learner_id=70 AND report_month='2026-11' ''').fetchone()[0], 1)
            self.assertEqual(db.execute('''SELECT count(*) FROM "Learner".learner_month_restore_points
                WHERE learner_id=80''').fetchone()[0], 0)

    # Separate tests give an exact count for each invalidation dependency.
    for field, expression in {
        'activity_hours': '2', 'attendance_value': '0',
        'attendance_date': "'2026-11-01'", 'attendance_status': "'absent'",
    }.items():
        def check(self, field=field, expression=expression):
            self.source()
            db.execute('DELETE FROM invalidations')
            db.execute(f'UPDATE "Learner".source_lms_attendance SET {field}={expression}')
            self.assertEqual(db.execute('SELECT owners FROM invalidations').fetchall(), [([70],)])
        setattr(Compatibility, f'test_source_{field}_change_invalidates', check)

    try:
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Compatibility))
    finally:
        db.rollback()
        db.close()
    return not result.wasSuccessful()


if __name__ == '__main__':
    raise SystemExit(main())
