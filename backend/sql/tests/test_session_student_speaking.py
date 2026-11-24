"""Real PostgreSQL regression tests, using synthetic data only.

Never reads .env or application settings. Requires a dedicated local initdb
cluster owned by lms_speaking_test with the purpose marker described below.
Creates a fresh disposable database, never reuses an application database.

Example (after starting that cluster on 127.0.0.1:55483):
  python -B backend/sql/tests/test_session_student_speaking.py --cluster-root <path>
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sys
import subprocess
import threading
import unittest
from uuid import uuid4

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


INSTALL = Path(__file__).resolve().parents[1] / '2026-11-24_session_student_speaking.sql'
PERCENTAGE = Path(__file__).resolve().parents[1] / '2026-11-24_session_student_speaking_percentage.sql'
JOBS = Path(__file__).resolve().parents[1] / '2026-11-24_session_student_speaking_jobs.sql'
PURPOSE = ('Isolated synthetic PostgreSQL database for LMS speaking-time SQL tests. '
           'No remote application configuration loaded.')
BASE_TIME = datetime(2026, 1, 5, 10, tzinfo=timezone.utc)
CONNECTION = None

FIXTURES = '''
CREATE SCHEMA curriculum;
CREATE SCHEMA "Learner";
CREATE TABLE curriculum.modules (
    module_catalogue_id text PRIMARY KEY, tutor_email text, tutor_name text,
    teams_shared_source_module_id text
);
CREATE TABLE curriculum.live_sessions (
    id text PRIMARY KEY, module_catalogue_id text, organizer_email text
);
CREATE TABLE curriculum.live_session_occurrences (
    id text PRIMARY KEY, live_session_id text, attendance_report_id text DEFAULT 'synthetic-report'
);
CREATE TABLE curriculum.live_session_artifacts (
    id text PRIMARY KEY, occurrence_id text, artifact_type text,
    created_datetime timestamptz, metadata jsonb
);
CREATE TABLE curriculum.live_session_attendance (
    id text PRIMARY KEY, occurrence_id text, display_name text, email text,
    role text DEFAULT 'attendee', raw_data jsonb DEFAULT '{}'
);
CREATE TABLE curriculum.live_session_learner_attendance (
    occurrence_id text, module_catalogue_id text, learner_profile_id bigint,
    learner_name text, learner_email text, attendance_source_occurrence_id text
);
CREATE TABLE curriculum.live_session_attendance_identity_rules (
    module_catalogue_id text, identity_kind text, identity_value text,
    learner_profile_id bigint, canonical_email text, active boolean
);
CREATE TABLE curriculum.live_session_attendance_identity_links (
    id bigint GENERATED ALWAYS AS IDENTITY, occurrence_id text, attendance_row_id text,
    learner_profile_id bigint, canonical_email text
);
CREATE TABLE curriculum.live_session_attendance_aliases (
    id bigint GENERATED ALWAYS AS IDENTITY, module_catalogue_id text, alias_email text,
    learner_profile_id bigint, canonical_email text
);
CREATE TABLE "Learner".learners (id bigint PRIMARY KEY, email text);
CREATE TABLE curriculum.session_result_archive (
    artifact_id text PRIMARY KEY, occurrence_id text, status text, transcript_text text
);
'''


def cue(speaker, start, end):
    return {'speaker': speaker, 'start': start, 'end': end, 'text': 'Synthetic words'}


class SpeakingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = psycopg.connect(**CONNECTION, autocommit=True, row_factory=dict_row)
        cls.db.execute(FIXTURES)
        cls.db.execute("SELECT set_config('lms.speaking_expected_database', current_database(), false)")
        cls.db.execute(INSTALL.read_text(encoding='utf-8'))
        cls.db.execute(PERCENTAGE.read_text(encoding='utf-8'))
        cls.db.execute(JOBS.read_text(encoding='utf-8'))

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        self.db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M1','tutor@example.test','Taylor Tutor',NULL)")
        self.db.execute("INSERT INTO curriculum.live_sessions VALUES ('S1','M1','admin@example.test')")
        self.db.execute("INSERT INTO curriculum.live_session_occurrences (id,live_session_id) VALUES ('O1','S1')")
        self.learner(1, 'Alex Student', 'alex@example.test')
        self.attendee('R1', 'Alex Student', 'alex@example.test')

    def tearDown(self):
        self.db.execute('ROLLBACK')

    def learner(self, ident, name, email, module='M1', occurrence='O1', source=None):
        self.db.execute('INSERT INTO "Learner".learners VALUES (%s,%s) ON CONFLICT DO NOTHING', (ident, email))
        self.db.execute('INSERT INTO curriculum.live_session_learner_attendance VALUES (%s,%s,%s,%s,%s,%s)',
                        (occurrence, module, ident, name, email, source))

    def attendee(self, ident, name, email='', account=None, role='attendee'):
        raw = {'identity': {'id': account, 'tenantId': 'synthetic-tenant'}} if account else {}
        self.db.execute('INSERT INTO curriculum.live_session_attendance (id,occurrence_id,display_name,email,raw_data,role) VALUES (%s,%s,%s,%s,%s,%s)',
                        (ident, 'O1', name, email, Jsonb(raw), role))

    def artifact(self, cues, ident='A1', offset=0, metadata=None, starts=True):
        value = metadata if metadata is not None else {'lmsTranscriptTimeline': {'version': 1, 'cues': cues}}
        self.db.execute('INSERT INTO curriculum.live_session_artifacts VALUES (%s,%s,%s,%s,%s)',
                        (ident, 'O1', 'transcript', BASE_TIME + timedelta(seconds=offset) if starts else None, Jsonb(value)))
        self.db.execute('INSERT INTO curriculum.session_result_archive VALUES (%s,%s,%s,%s) ON CONFLICT(artifact_id) DO UPDATE SET status=EXCLUDED.status,transcript_text=EXCLUDED.transcript_text',
                        (ident, 'O1', 'ready', 'Synthetic saved transcript'))

    def preview(self):
        return self.db.execute("SELECT * FROM curriculum.preview_session_student_speaking('O1') ORDER BY match_status,learner_profile_id").fetchall()

    def save(self):
        return self.db.execute("SELECT * FROM curriculum.save_session_student_speaking('O1')").fetchone()

    def result(self):
        return self.db.execute('SELECT * FROM curriculum.live_session_student_speaking').fetchone()

    def test_name_normalization(self):
        got = self.db.execute("SELECT curriculum.speaking_name_key(%s) AS value", ('  ＡＬＥＸ   Student (Guest) ',)).fetchone()
        self.assertEqual(got['value'], 'alex student')

    def test_tutor_excluded_and_sources_unchanged(self):
        self.attendee('RT', 'Taylor Tutor', 'tutor@example.test')
        self.artifact([cue('Taylor Tutor', 0, 20), cue('Alex Student', 20, 25.25)])
        before = self.db.execute('SELECT md5(jsonb_agg(to_jsonb(a) ORDER BY id)::text) AS hash FROM curriculum.live_session_artifacts a').fetchone()
        self.assertEqual(self.save()['learner_rows'], 1)
        self.assertEqual(self.result()['speaking_seconds'], Decimal('5.25'))
        run = self.db.execute('SELECT * FROM curriculum.live_session_speaking_runs').fetchone()
        self.assertEqual(run['excluded_speakers'][0]['match_status'], 'excluded_tutor')
        self.assertEqual(run['unresolved_speakers'], [])
        after = self.db.execute('SELECT md5(jsonb_agg(to_jsonb(a) ORDER BY id)::text) AS hash FROM curriculum.live_session_artifacts a').fetchone()
        self.assertEqual(before, after)

    def test_nested_and_touching_overlaps(self):
        self.artifact([cue('Alex Student', 0, 10), cue('Alex Student', 1, 2),
                       cue('Alex Student', 5, 15), cue('Alex Student', 15, 20)])
        self.assertEqual(self.preview()[0]['speaking_seconds'], 20)

    def test_parts_use_absolute_offsets_and_deduplicate_intervals(self):
        self.artifact([cue('Alex Student', 0, 10)])
        self.artifact([cue('Alex Student', 0, 10)], 'A2', offset=5)
        self.artifact([cue('Alex Student', 0, 10)], 'A3', offset=5)
        self.assertEqual(self.preview()[0]['speaking_seconds'], 15)

    def test_multiple_names_for_same_student_merge_before_duration(self):
        self.attendee('R2', 'Alex Alternative', 'alex@example.test')
        self.artifact([cue('Alex Student', 0, 10), cue('Alex Alternative', 5, 15)])
        self.save()
        self.assertEqual(self.result()['speaking_seconds'], 15)
        self.assertEqual(set(self.result()['speaker_names']), {'Alex Student', 'Alex Alternative'})

    def test_negative_start_and_fractional_precision(self):
        self.artifact([cue('Alex Student', -0.25, 0.875)])
        self.assertEqual(self.preview()[0]['speaking_seconds'], Decimal('1.125'))

    def test_presenter_student_is_not_excluded(self):
        self.db.execute("UPDATE curriculum.live_session_attendance SET role='presenter'")
        self.artifact([cue('Alex Student', 0, 8)])
        self.assertEqual(self.save()['learner_rows'], 1)

    def test_percentages_exclude_tutor_and_unresolved_speech(self):
        self.learner(2, 'Blair Student', 'blair@example.test')
        self.attendee('R2', 'Blair Student', 'blair@example.test')
        self.attendee('RT', 'Taylor Tutor', 'tutor@example.test')
        self.artifact([cue('Alex Student', 0, 10), cue('Blair Student', 10, 40),
                       cue('Taylor Tutor', 40, 1040), cue('Unknown', 1040, 3040)])
        self.save()
        rows = self.db.execute('SELECT speaking_percentage FROM curriculum.live_session_student_speaking ORDER BY learner_profile_id').fetchall()
        self.assertEqual([r['speaking_percentage'] for r in rows], [Decimal('25.00'), Decimal('75.00')])

    def test_single_attributed_student_has_one_hundred_percent(self):
        self.artifact([cue('Alex Student', 0, 5), cue('Unknown', 5, 100)])
        self.save()
        self.assertEqual(self.result()['speaking_percentage'], Decimal('100.00'))

    def test_percentage_rounding_does_not_rewrite_durations(self):
        self.learner(2, 'Blair Student', 'blair@example.test')
        self.learner(3, 'Casey Student', 'casey@example.test')
        self.attendee('R2', 'Blair Student', 'blair@example.test')
        self.attendee('R3', 'Casey Student', 'casey@example.test')
        self.artifact([cue('Alex Student', 0, 1), cue('Blair Student', 1, 2), cue('Casey Student', 2, 3)])
        self.save()
        rows = self.db.execute('SELECT speaking_seconds,speaking_percentage FROM curriculum.live_session_student_speaking').fetchall()
        self.assertEqual([r['speaking_seconds'] for r in rows], [Decimal(1)] * 3)
        self.assertEqual([r['speaking_percentage'] for r in rows], [Decimal('33.33')] * 3)

    def test_percentage_denominator_is_scoped_to_shared_module(self):
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M2','','','M1')")
        self.learner(2, 'Blair Student', 'blair@example.test', module='M2')
        self.attendee('R2', 'Blair Student', 'blair@example.test')
        self.artifact([cue('Alex Student', 0, 10), cue('Blair Student', 10, 40)])
        self.save()
        rows = self.db.execute('SELECT speaking_percentage FROM curriculum.live_session_student_speaking').fetchall()
        self.assertEqual([r['speaking_percentage'] for r in rows], [Decimal('100.00')] * 2)

    def test_percentage_range_and_null_constraints(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.save()
        for value in [Decimal('-0.01'), Decimal('100.01'), None]:
            with self.subTest(value=value):
                with self.assertRaises(psycopg.IntegrityError):
                    with self.db.transaction():
                        self.db.execute('UPDATE curriculum.live_session_student_speaking SET speaking_percentage=%s', (value,))

    def test_percentage_migration_backfills_without_changing_saved_fields(self):
        # A separate, fresh database on the already verified synthetic cluster:
        # existing snapshots must migrate without re-reading their transcripts.
        admin_options = {**CONNECTION, 'dbname': 'postgres'}
        dbname = 'lms_speaking_test_' + uuid4().hex
        with psycopg.connect(**admin_options, autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(dbname)))
        with psycopg.connect(**{**CONNECTION, 'dbname': dbname}, autocommit=True, row_factory=dict_row) as db:
            db.execute(FIXTURES)
            db.execute("SELECT set_config('lms.speaking_expected_database', current_database(), false)")
            db.execute(INSTALL.read_text(encoding='utf-8'))
            db.execute("""INSERT INTO curriculum.live_session_speaking_runs
                (occurrence_id,live_session_id,source_artifacts,source_fingerprint,learner_result_count,unresolved_speakers,excluded_speakers)
                VALUES ('OLD-1','SYN','[]','synthetic',3,'[]','[]'),('OLD-2','SYN','[]','synthetic',1,'[]','[]')""")
            db.execute("""INSERT INTO curriculum.live_session_student_speaking
                (occurrence_id,live_session_id,module_catalogue_id,learner_profile_id,learner_name,
                 speaking_seconds,cue_count,speaker_names,match_status,calculated_at)
                SELECT o,'SYN',m,l,'Synthetic Student',seconds,1,'["Synthetic"]','unique_name','2026-01-01T00:00:00Z'
                FROM (VALUES ('OLD-1','M1',1,1),('OLD-1','M1',2,2),('OLD-1','M2',3,8),('OLD-2','M1',1,99)) v(o,m,l,seconds)""")
            before = db.execute('SELECT jsonb_agg(to_jsonb(p) ORDER BY occurrence_id,module_catalogue_id,learner_profile_id) AS rows FROM curriculum.live_session_student_speaking p').fetchone()
            db.execute(PERCENTAGE.read_text(encoding='utf-8'))
            after = db.execute("SELECT jsonb_agg(to_jsonb(p)-'speaking_percentage' ORDER BY occurrence_id,module_catalogue_id,learner_profile_id) AS rows FROM curriculum.live_session_student_speaking p").fetchone()
            self.assertEqual(before, after)
            actual = db.execute('SELECT speaking_percentage FROM curriculum.live_session_student_speaking ORDER BY occurrence_id,module_catalogue_id,learner_profile_id').fetchall()
            self.assertEqual([r['speaking_percentage'] for r in actual],
                             [Decimal('33.33'), Decimal('66.67'), Decimal('100.00'), Decimal('100.00')])

    def test_unknown_and_missing_speaker_remain_unresolved(self):
        self.artifact([cue('Unknown Guest', 0, 4), cue('', 4, 7)])
        self.assertEqual(self.save()['learner_rows'], 0)
        run = self.db.execute('SELECT * FROM curriculum.live_session_speaking_runs').fetchone()
        self.assertEqual(len(run['unresolved_speakers']), 2)
        self.assertIsNone(self.result())

    def test_same_name_two_accounts_cannot_be_split_even_with_review(self):
        self.db.execute('DELETE FROM curriculum.live_session_attendance')
        self.attendee('R1', 'Alex Student', 'alex@example.test', account='account-one')
        self.attendee('R2', 'Alex Student', 'alex@example.test', account='account-two')
        self.db.execute("INSERT INTO curriculum.live_session_attendance_identity_links (occurrence_id,attendance_row_id,learner_profile_id,canonical_email) VALUES ('O1','R1',1,'alex@example.test')")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.preview()[0]['reason'], 'same_name_multiple_attendance_identities')
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_rejoins_with_same_account_are_not_ambiguous(self):
        self.db.execute('DELETE FROM curriculum.live_session_attendance')
        self.attendee('R1', 'Alex Student', 'alex@example.test', account='account-one')
        self.attendee('R2', 'Alex Student', 'alex@example.test', account='account-one')
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.save()['learner_rows'], 1)

    def test_same_guest_name_two_learners_is_ambiguous(self):
        self.learner(2, 'Alex Student', 'other@example.test')
        self.db.execute("UPDATE curriculum.live_session_attendance SET email=''")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.preview()[0]['reason'], 'same_name_multiple_learners')

    def test_shared_module_names_are_checked_across_entire_session(self):
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M2','','','M1')")
        self.learner(2, 'Alex Student', 'other@example.test', module='M2')
        self.db.execute("UPDATE curriculum.live_session_attendance SET email=''")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertTrue(all(r['reason'] == 'same_name_multiple_learners' for r in self.preview()))

    def test_shared_module_learner_keeps_own_module(self):
        self.db.execute("INSERT INTO curriculum.modules VALUES ('M2','','','M1')")
        self.learner(2, 'Blair Student', 'blair@example.test', module='M2', occurrence='DEST', source='O1')
        self.attendee('R2', 'Blair Student', 'blair@example.test')
        self.artifact([cue('Blair Student', 0, 5)])
        self.save()
        self.assertEqual(self.result()['module_catalogue_id'], 'M2')
        self.assertEqual(self.result()['learner_profile_id'], 2)

    def test_unrelated_module_cannot_supply_candidate(self):
        self.db.execute("INSERT INTO curriculum.modules VALUES ('OTHER','','',NULL)")
        self.learner(2, 'Blair Student', 'blair@example.test', module='OTHER')
        self.attendee('R2', 'Blair Student', 'blair@example.test')
        self.artifact([cue('Blair Student', 0, 5)])
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_tutor_student_name_collision_is_not_discarded(self):
        self.db.execute("UPDATE curriculum.modules SET tutor_name='Alex Student'")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.preview()[0]['reason'], 'tutor_learner_name_conflict')
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_tutor_email_excludes_different_display_name(self):
        self.attendee('RT', 'Teaching Account', 'tutor@example.test')
        self.artifact([cue('Teaching Account', 0, 5)])
        self.assertEqual(self.preview()[0]['match_status'], 'excluded_tutor')

    def test_snapshot_database_guard_refuses_wrong_target(self):
        self.artifact([cue('Alex Student', 0, 5)])
        with self.assertRaises(psycopg.errors.RaiseException):
            with self.db.transaction():
                self.db.execute("SELECT set_config('lms.speaking_expected_database','wrong_database',true)")
                self.save()

    def test_read_committed_transaction_is_rejected(self):
        self.db.execute('ROLLBACK')
        self.db.execute('BEGIN ISOLATION LEVEL READ COMMITTED')
        with self.assertRaises(psycopg.errors.RaiseException):
            with self.db.transaction():
                self.save()

    def test_reviewed_alias_uses_scoped_learner(self):
        self.db.execute("UPDATE curriculum.live_session_attendance SET display_name='Personal Account',email='personal@example.test'")
        self.db.execute("INSERT INTO curriculum.live_session_attendance_aliases (module_catalogue_id,alias_email,learner_profile_id,canonical_email) VALUES ('M1','personal@example.test',1,'alex@example.test')")
        self.artifact([cue('Personal Account', 0, 5)])
        self.save()
        self.assertEqual(self.result()['match_status'], 'reviewed_attendance')

    def test_revoked_rule_blocks_legacy_link_and_name_fallback(self):
        self.db.execute("INSERT INTO curriculum.live_session_attendance_identity_links (occurrence_id,attendance_row_id,learner_profile_id,canonical_email) VALUES ('O1','R1',1,'alex@example.test')")
        self.db.execute("INSERT INTO curriculum.live_session_attendance_identity_rules VALUES ('M1','email','alex@example.test',1,'alex@example.test',false)")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.preview()[0]['reason'], 'revoked_attendance_link')
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_reviewed_link_outside_roster_is_not_trusted(self):
        self.db.execute("INSERT INTO curriculum.live_session_attendance_identity_rules VALUES ('M1','email','alex@example.test',999,'other@example.test',true)")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_different_known_learner_email_blocks_name_guess(self):
        self.db.execute("INSERT INTO \"Learner\".learners VALUES (999,'different@example.test')")
        self.db.execute("UPDATE curriculum.live_session_attendance SET email='different@example.test'")
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.save()['learner_rows'], 0)

    def test_snapshot_is_not_recalculated_after_source_changes(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.save()['outcome'], 'saved')
        before = self.result()
        self.artifact([cue('Alex Student', 0, 50)], ident='LATER')
        self.assertEqual(self.save()['outcome'], 'already_saved')
        self.assertEqual(before, self.result())

    def test_zero_matches_still_gets_once_only_run_marker(self):
        self.artifact([cue('Unknown', 0, 5)])
        self.assertEqual(self.save()['outcome'], 'saved')
        self.assertEqual(self.save()['outcome'], 'already_saved')

    def test_invalid_sources_do_not_create_run_markers(self):
        cases = [None, {}, {'lmsTranscriptTimeline': {'version': 1, 'cues': []}},
                 {'lmsTranscriptTimeline': {'version': 2, 'cues': [cue('Alex Student', 0, 5)]}},
                 {'lmsTranscriptTimeline': {'version': 1, 'cues': 'invalid'}},
                 {'lmsTranscriptTimeline': {'version': 1, 'cues': [cue('Alex Student', 'invalid', 5)]}},
                 {'lmsTranscriptTimeline': {'version': 1, 'cues': [cue('Alex Student', 5, 5)]}}]
        for index, metadata in enumerate(cases):
            with self.subTest(case=index):
                self.db.execute('DELETE FROM curriculum.live_session_artifacts')
                self.artifact([], metadata=metadata if metadata is not None else {})
                self.assertEqual(self.save()['outcome'], 'blocked_invalid_source')
                self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_runs').fetchone()['n'], 0)

    def test_one_bad_part_blocks_partial_result(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.artifact([], 'BAD', metadata={})
        self.assertEqual(self.save()['outcome'], 'blocked_invalid_source')

    def test_missing_absolute_start_blocks_invented_offset(self):
        self.artifact([cue('Alex Student', 0, 5)], starts=False)
        self.assertEqual(self.save()['outcome'], 'blocked_invalid_source')

    def test_other_occurrence_is_untouched(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute("INSERT INTO curriculum.live_session_occurrences (id,live_session_id) VALUES ('O2','S1')")
        self.db.execute("INSERT INTO curriculum.live_session_artifacts SELECT 'A2','O2',artifact_type,created_datetime,metadata FROM curriculum.live_session_artifacts WHERE id='A1'")
        self.save()
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_runs').fetchone()['n'], 1)

    def test_zz_concurrent_runs_have_one_snapshot_and_retry_safely(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute('COMMIT')  # Only this last test needs independently visible fixtures.
        barrier = threading.Barrier(2)

        def worker():
            with psycopg.connect(**CONNECTION, autocommit=True, row_factory=dict_row) as db:
                db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
                db.execute("SELECT set_config('lms.speaking_expected_database',current_database(),true)")
                db.execute('SELECT count(*) FROM curriculum.live_session_speaking_runs')
                barrier.wait(timeout=15)
                try:
                    result = db.execute("SELECT * FROM curriculum.save_session_student_speaking('O1')").fetchone()
                    db.execute('COMMIT')
                    return result['outcome']
                except psycopg.errors.SerializationFailure:
                    db.execute('ROLLBACK')
                    db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
                    db.execute("SELECT set_config('lms.speaking_expected_database',current_database(),true)")
                    result = db.execute("SELECT * FROM curriculum.save_session_student_speaking('O1')").fetchone()
                    db.execute('COMMIT')
                    return result['outcome']

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: worker(), range(2)))
        self.assertEqual(sorted(results), ['already_saved', 'saved'])
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_runs').fetchone()['n'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_student_speaking').fetchone()['n'], 1)


class AutomaticSpeakingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global CONNECTION
        dbname = 'lms_speaking_test_' + uuid4().hex
        with psycopg.connect(**{**CONNECTION, 'dbname': 'postgres'}, autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(dbname)))
        CONNECTION = {**CONNECTION, 'dbname': dbname}
        SpeakingTests.setUpClass.__func__(cls)

    tearDownClass = classmethod(SpeakingTests.tearDownClass.__func__)
    setUp = SpeakingTests.setUp
    tearDown = SpeakingTests.tearDown
    learner = SpeakingTests.learner
    attendee = SpeakingTests.attendee
    artifact = SpeakingTests.artifact
    save = SpeakingTests.save
    result = SpeakingTests.result

    def auto(self, series=None, limit=10):
        return self.db.execute('SELECT * FROM curriculum.process_new_session_student_speaking(%s,%s)',
                               (series, limit)).fetchone()

    def receipt(self):
        return self.db.execute("SELECT * FROM curriculum.live_session_speaking_jobs WHERE occurrence_id='O1'").fetchone()

    def due(self):
        self.db.execute("UPDATE curriculum.live_session_speaking_jobs SET next_attempt_at=now()-interval '1 second'")

    def test_only_unsaved_occurrence_is_calculated_and_then_skipped(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.auto(), {'processed': 1, 'completed': 1, 'retrying': 0})
        self.assertEqual(self.result()['speaking_percentage'], 100)
        original = self.result()
        self.assertEqual(self.receipt()['state'], 'complete')
        self.assertEqual(self.auto(), {'processed': 0, 'completed': 0, 'retrying': 0})
        self.assertEqual(self.result(), original)

    def test_existing_snapshot_is_not_even_queued(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.save()
        original = self.result()
        self.assertEqual(self.auto()['processed'], 0)
        self.assertIsNone(self.receipt())
        self.assertEqual(self.result(), original)

    def test_partial_archive_defers_without_saving_then_recovers(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.artifact([cue('Alex Student', 0, 5)], ident='A2', offset=10)
        self.db.execute("UPDATE curriculum.session_result_archive SET status='pending' WHERE artifact_id='A2'")
        self.assertEqual(self.auto()['retrying'], 1)
        self.assertIsNone(self.result())
        self.assertEqual(self.auto()['processed'], 0)
        self.db.execute("UPDATE curriculum.session_result_archive SET status='ready'")
        self.due()
        self.assertEqual(self.auto()['completed'], 1)
        self.assertEqual(self.result()['speaking_seconds'], 10)

    def test_attendance_and_saved_roster_are_required(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute("UPDATE curriculum.live_session_occurrences SET attendance_report_id=''")
        self.assertEqual(self.auto()['retrying'], 1)
        self.assertIsNone(self.result())
        self.db.execute("UPDATE curriculum.live_session_occurrences SET attendance_report_id='synthetic-report'")
        self.db.execute('DELETE FROM curriculum.live_session_learner_attendance')
        self.due()
        self.assertEqual(self.auto()['retrying'], 1)
        self.assertIsNone(self.result())
        self.learner(1, 'Alex Student', 'alex@example.test')
        self.due()
        self.assertEqual(self.auto()['completed'], 1)

    def test_invalid_timing_is_retried_without_snapshot_marker(self):
        self.artifact([], metadata={})
        self.assertEqual(self.auto()['retrying'], 1)
        self.assertEqual(self.receipt()['last_error'], 'saved_transcript_timing_not_ready')
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_runs').fetchone()['n'], 0)

    def test_series_scope_does_not_pick_another_series(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.assertEqual(self.auto(['UNRELATED'])['processed'], 0)
        self.assertIsNone(self.receipt())
        self.assertEqual(self.auto(['S1'])['completed'], 1)

    def test_processing_limit_bounds_discovery_and_work(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute("INSERT INTO curriculum.live_session_occurrences (id,live_session_id) VALUES ('O2','S1')")
        self.db.execute("INSERT INTO curriculum.live_session_artifacts SELECT 'A2','O2',artifact_type,created_datetime,metadata FROM curriculum.live_session_artifacts WHERE id='A1'")
        self.assertEqual(self.auto(limit=1)['processed'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_jobs').fetchone()['n'], 1)

    def test_error_rolls_back_partial_calculation_and_schedules_retry(self):
        self.artifact([cue('Alex Student', 0, 5)])
        # Synthetic fault inside the calculation: its partial writes must roll back.
        self.db.execute("""CREATE OR REPLACE FUNCTION curriculum.save_session_student_speaking(p_occurrence_id text DEFAULT NULL)
            RETURNS TABLE (saved_occurrence_id text,outcome text,learner_rows integer)
            LANGUAGE plpgsql AS $$ BEGIN
              INSERT INTO curriculum.live_session_speaking_runs
                (occurrence_id,live_session_id,source_artifacts,source_fingerprint,learner_result_count,unresolved_speakers,excluded_speakers)
              VALUES (p_occurrence_id,'S1','[]','synthetic',0,'[]','[]');
              RAISE EXCEPTION 'private learner details and SQL must never be persisted';
            END $$""")
        self.assertEqual(self.auto()['retrying'], 1)
        self.assertEqual(self.receipt()['last_error'], 'calculation_sqlstate_P0001')
        self.assertGreater(self.receipt()['next_attempt_at'], self.receipt()['requested_at'])
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM curriculum.live_session_speaking_runs').fetchone()['n'], 0)
        updated = PERCENTAGE.read_text(encoding='utf-8').split('CREATE OR REPLACE FUNCTION', 1)[1].split('$save$;', 1)[0]
        self.db.execute('CREATE OR REPLACE FUNCTION' + updated + '$save$;')
        self.due()
        self.assertEqual(self.auto()['completed'], 1)

    def test_manual_snapshot_before_retry_is_recognized_without_recalculating(self):
        self.artifact([], metadata={})
        self.auto()
        self.db.execute("UPDATE curriculum.live_session_artifacts SET metadata=%s", (Jsonb({'lmsTranscriptTimeline': {'version': 1, 'cues': [cue('Alex Student', 0, 5)]}}),))
        self.save()
        self.due()
        original = self.result()
        self.assertEqual(self.auto()['completed'], 1)
        self.assertEqual(self.result(), original)

    def test_locked_receipt_is_skipped_by_another_worker(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute("INSERT INTO curriculum.live_session_speaking_jobs (occurrence_id,live_session_id) VALUES ('O1','S1')")
        self.db.execute('COMMIT')
        try:
            with psycopg.connect(**CONNECTION, autocommit=True, row_factory=dict_row) as other:
                self.db.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
                self.db.execute("SELECT * FROM curriculum.live_session_speaking_jobs WHERE occurrence_id='O1' FOR UPDATE")
                other.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
                other.execute("SELECT set_config('lms.speaking_expected_database',current_database(),true)")
                status = other.execute('SELECT * FROM curriculum.process_new_session_student_speaking()').fetchone()
                other.execute('COMMIT')
                self.assertEqual(status, {'processed': 0, 'completed': 0, 'retrying': 0})
                self.assertEqual(self.auto()['completed'], 1)
        finally:
            self.db.execute('ROLLBACK')
            self.db.execute("DELETE FROM curriculum.live_session_speaking_jobs WHERE occurrence_id='O1'")
            self.db.execute("DELETE FROM curriculum.session_result_archive")
            self.db.execute("DELETE FROM curriculum.live_session_artifacts")
            self.db.execute("DELETE FROM curriculum.live_session_attendance")
            self.db.execute("DELETE FROM curriculum.live_session_learner_attendance")
            self.db.execute("DELETE FROM curriculum.live_session_occurrences")
            self.db.execute("DELETE FROM curriculum.live_sessions")
            self.db.execute("DELETE FROM curriculum.modules")
            self.db.execute('DELETE FROM "Learner".learners')

    def test_real_django_helper_uses_verified_local_database(self):
        self.artifact([cue('Alex Student', 0, 5)])
        self.db.execute('COMMIT')
        script = '''
import json,sys
from django.conf import settings
cfg=json.loads(sys.stdin.read())
assert cfg['host']=='127.0.0.1' and cfg['port']==55483 and cfg['dbname'].startswith('lms_speaking_test_')
settings.configure(DATABASES={'default':{'ENGINE':'django.db.backends.postgresql',
    'NAME':cfg['dbname'],'HOST':cfg['host'],'PORT':cfg['port'],'USER':cfg['user'],'PASSWORD':''}},USE_TZ=True)
sys.path.insert(0,'backend')
from curriculum_api.session_speaking import process_pending_speaking
print(json.dumps(process_pending_speaking(series_ids=['S1'],limit=1)))
from django.db import connections
connections.close_all()
'''
        try:
            child = subprocess.run([sys.executable, '-B', '-c', script], input=json.dumps(CONNECTION),
                                   capture_output=True, text=True, timeout=20)
            self.assertEqual(child.returncode, 0, child.stderr)
            self.assertEqual(json.loads(child.stdout), {'processed': 1, 'completed': 1, 'retrying': 0})
            self.assertEqual(self.result()['speaking_percentage'], 100)
        finally:
            # These committed synthetic fixtures live only in this disposable DB.
            self.db.execute('BEGIN')
            for table in ('live_session_student_speaking', 'live_session_speaking_runs', 'live_session_speaking_jobs',
                          'session_result_archive', 'live_session_artifacts', 'live_session_attendance',
                          'live_session_learner_attendance', 'live_session_occurrences', 'live_sessions', 'modules'):
                self.db.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier('curriculum', table)))
            self.db.execute('DELETE FROM "Learner".learners')
            self.db.execute('COMMIT')


def main():
    global CONNECTION
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cluster-root', type=Path, required=True)
    args = parser.parse_args()
    root = args.cluster_root.resolve()
    if (root / 'purpose.txt').read_text(encoding='utf-8-sig').strip() != PURPOSE:
        raise SystemExit('Refusing cluster without the exact synthetic-test purpose marker')
    connect = dict(host='127.0.0.1', port=55483, user='lms_speaking_test', password='', connect_timeout=5)
    with psycopg.connect(**connect, dbname='postgres', autocommit=True) as admin:
        actual = Path(admin.execute('SHOW data_directory').fetchone()[0]).resolve()
        if actual != (root / 'data').resolve():
            raise SystemExit('Refusing server whose data_directory differs from the verified synthetic cluster')
        dbname = 'lms_speaking_test_' + uuid4().hex
        admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(dbname)))
    CONNECTION = dict(connect, dbname=dbname)
    print('Verified isolated local PostgreSQL; fresh database:', dbname, flush=True)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SpeakingTests)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(AutomaticSpeakingTests))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)


if __name__ == '__main__':
    main()
