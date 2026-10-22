"""Explicit opt-in synthetic cluster; never loads Django, .env or a shared DSN.

Run with -I -B and --bundle pointing to the reviewed Database bundle. Reuses its
local-only runner unchanged. The cluster is freshly initialized, loopback-only,
and stopped in finally. Guard tests retain rejected legacy-write examples;
test_auth_writers_local_postgres.py exercises the corrected Django writers.
"""
import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from login import selectors as reads


class IdentityError(Exception):
    def __init__(self, message, code, status):
        self.code, self.status = code, status
        super().__init__(message)


def literal(value):
    # Test-only EXECUTE arguments; production selectors still bind via %s.
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        value = value.isoformat()
    return "'" + str(value).replace("'", "''") + "'"


def query(sql, params):
    parts = sql.split("%s")
    if len(parts) != len(params) + 1:
        raise AssertionError("Parameter mismatch")
    prepared = parts[0] + ''.join(f'${i}' + part for i, part in enumerate(parts[1:], 1))
    result = pg.sql("PREPARE selector_read AS SELECT COALESCE(json_agg(q), '[]'::json) "
                    f"FROM ({prepared}) q; EXECUTE selector_read("
                    + ','.join(literal(p) for p in params) + ");")
    # json_agg may insert newlines between records; discard only PREPARE status.
    rows = json.loads(result.stdout[result.stdout.index('['):])
    for row in rows:
        for key in ("expires_at", "revoked_at", "used_at", "created_at", "last_seen_at",
                    "last_login_at", "password_set_at", "locked_until"):
            if row.get(key) is not None:
                row[key] = datetime.fromisoformat(row[key])
    return rows


class SelectorPostgresTests(unittest.TestCase):
    def test_01_all_read_projections_execute_against_bundle(self):
        now = datetime.now(timezone.utc)
        self.assertEqual(reads.account_for_email('LEARNER@EXAMPLE.TEST', query=query)['account_id'], 17)
        self.assertIsNotNone(reads.password_account_for_email('learner@example.test', query=query))
        self.assertEqual(reads.account_for_subject('learner', 272, query=query)['account_id'], 18)
        self.assertEqual(reads.session_with_account('a' * 64, now=now, query=query)['session_id'], 23)
        self.assertEqual(reads.subject_identity_for_account(17, query=query)['subject_id'], 83)
        self.assertEqual(reads.subject_for_account(18, query=query)['learner_type'], 'apprenticeship')
        self.assertEqual(reads.subject_for_account(19, query=query)['organisation_ids'], (1,))
        self.assertEqual(reads.staff_grants_for_actor(17, query=query)['primary_access'], 'coach')
        self.assertEqual(reads.learner_link_for_actor(17, query=query)['canonical_profile_id'], 510)
        self.assertIsNone(reads.learner_link_for_actor(18, query=query)['canonical_profile_id'])
        for actor, kind in ((17, 'coach'), (19, 'employer')):
            self.assertEqual(reads.relationship_for_target(actor, 271, kind, query=query)['legacy_enrolment_id'], 271)
        self.assertEqual(reads.profile_for_enrolment(271, query=query, error_type=IdentityError)['programme_planned_hours'], '0')
        self.assertEqual(reads.learner_access_facts(272, query=query)['source_record_id'], 272)
        self.assertEqual(reads.cohort_access_facts('C', query=query)['cohort_id'], 'C')
        for kind, digest in (('invitation', 'c'), ('reset', 'd')):
            self.assertIsNotNone(reads.pending_token(kind, digest * 64, now=now, query=query))
        self.assertEqual(reads.recent_auth_event_count(since=now-timedelta(days=1),
            only_failures=False, event='reset_requested', query=query), 1)
        self.assertIsNone(reads.account_for_email("x' OR 1=1 --", query=query))

    def test_02_committed_grants_and_ownership_removal(self):
        pg.sql('UPDATE enrolment."Staff_users" SET "Access"=NULL,"Access_extra"=NULL WHERE id=83;')
        self.assertIsNone(reads.staff_grants_for_actor(17, query=query)['primary_access'])
        # Relationship remains a fact, not a coach capability.
        self.assertIsNotNone(reads.relationship_for_target(17, 271, 'coach', query=query))
        pg.sql('UPDATE "Learner".learners SET coach_email=\'other@example.test\' WHERE id=510;')
        self.assertIsNone(reads.relationship_for_target(17, 271, 'coach', query=query))
        pg.sql('UPDATE enrolment."Created_users" SET "Employer_id"=NULL WHERE id=271;')
        self.assertIsNone(reads.relationship_for_target(19, 271, 'employer', query=query))

    def test_03_duplicate_profile_and_independent_evidence(self):
        pg.sql('INSERT INTO "Learner".learners(id,enrolment_id,email) VALUES(511,271,\'learner@example.test\');')
        try:
            with self.assertRaises(reads.IdentityReviewRequired):
                reads.learner_link_for_actor(17, query=query)
            with self.assertRaises(IdentityError):
                reads.profile_for_enrolment(271, query=query, error_type=IdentityError)
        finally:
            pg.sql('DELETE FROM "Learner".learners WHERE id=511;')
        pg.sql('UPDATE enrolment."Created_users" SET "Email"=\'changed@example.test\' WHERE id=271;')
        try:
            with self.assertRaises(IdentityError) as caught:
                reads.profile_for_enrolment(271, query=query, error_type=IdentityError)
            self.assertEqual(caught.exception.status, 409)
        finally:
            pg.sql('UPDATE enrolment."Created_users" SET "Email"=\'learner@example.test\' WHERE id=271;')

    def test_04_email_collision_and_source_ambiguity(self):
        pg.sql('''INSERT INTO login."Login_accounts"(id,"Subject_type","Subject_id","Email","Role")
            OVERRIDING SYSTEM VALUE VALUES(100,'learner',271,'learner@example.test','learner');''')
        try:
            self.assertIsNone(reads.account_for_email('learner@example.test', query=query))
        finally:
            pg.sql('DELETE FROM login."Login_accounts" WHERE id=100;')
        pg.sql('INSERT INTO enrolment."Created_users"(id,"Email") VALUES(273,\'LEARNER@example.test\');')
        try:
            self.assertIsNone(reads.learner_link_for_actor(17, query=query))
        finally:
            pg.sql('DELETE FROM enrolment."Created_users" WHERE id=273;')

    def test_05_revocation_and_renewal_remain_closed(self):
        from concurrent.futures import ThreadPoolExecutor
        statements = [
            '''BEGIN; UPDATE login."Login_sessions" SET "Revoked_at"=clock_timestamp()
               WHERE id=23; SELECT pg_sleep(0.1); COMMIT;''',
            '''UPDATE login."Login_sessions" SET "Expires_at"=now()+interval '2 days'
               WHERE id=23 AND "Revoked_at" IS NULL AND "Expires_at">now()
               AND "Expires_at"<now()+interval '2 days';''']
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda s: pg.sql(s, check=False), statements))
        self.assertTrue(all(r.returncode == 0 for r in results))
        self.assertIsNone(reads.session_with_account('a'*64, now=datetime.now(timezone.utc), query=query))

    def test_06_concurrent_token_winner_and_loser_effects(self):
        from concurrent.futures import ThreadPoolExecutor
        for table, token_id, account_id in (('Invitations', 31, 18), ('Password_resets', 41, 17)):
            def consume(marker):
                # Legacy read-then-save order, without the new token row lock.
                return pg.sql(f'''BEGIN;
                    UPDATE login."Login_accounts" SET "Display_name"='{marker}' WHERE id={account_id};
                    UPDATE login."{table}" SET "Used_at"=clock_timestamp() WHERE id={token_id};
                    UPDATE login."Login_sessions" SET "Revoked_at"=clock_timestamp()
                    WHERE "Account_id"={account_id} AND "Revoked_at" IS NULL;
                    SELECT pg_sleep(0.1); COMMIT;''', check=False)
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(consume, ['synthetic-one', 'synthetic-two']))
            winners = [i for i, result in enumerate(results) if result.returncode == 0]
            self.assertEqual(len(winners), 1)
            name = pg.sql(f'SELECT "Display_name" FROM login."Login_accounts" WHERE id={account_id}').stdout.strip()
            self.assertEqual(name, ['synthetic-one', 'synthetic-two'][winners[0]])

    def test_07_characterize_full_row_save_and_stale_logout_blockers(self):
        # Keep the guards rejecting unsafe legacy writes after writer fixes.
        for table, token_id in (('Invitations', 31), ('Password_resets', 41)):
            result = pg.sql(f'''UPDATE login."{table}" SET "Used_at"="Used_at",
                "Send_error"=NULL WHERE id={token_id};''', check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Token already consumed', result.stdout)
            pg.sql(f'UPDATE login."{table}" SET "Send_error"=NULL WHERE id={token_id};')
        result = pg.sql('''UPDATE login."Login_sessions" SET "Revoked_at"=clock_timestamp()
            WHERE id=23;''', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Session revocation cannot be changed', result.stdout)

    def test_08_database_error_is_not_missing_identity(self):
        # A real schema error must escape the adapter; no []/legacy fallback.
        pg.sql('ALTER TABLE "Learner".auth_subjects RENAME TO synthetic_unavailable;')
        try:
            with self.assertRaises(AssertionError):
                reads.subject_identity_for_account(17, query=query)
        finally:
            pg.sql('ALTER TABLE "Learner".synthetic_unavailable RENAME TO auth_subjects;')

    def test_09_characterize_nonatomic_password_change_mirror_failure(self):
        # Historical password-change pattern without the enclosing transaction.
        # The corrected Django path is covered in the writer test runner.
        pg.sql('''INSERT INTO login."Login_sessions"(id,"Account_id","Token_hash","Expires_at")
            OVERRIDING SYSTEM VALUE VALUES(25,19,repeat('e',64),now()+interval '1 day');''')
        pg.sql('''ALTER TABLE "Learner"."Login_sessions" ADD CONSTRAINT synthetic_revoke_failure
            CHECK("Account_id"<>19 OR "Revoked_at" IS NULL);''')
        try:
            pg.sql('''UPDATE login."Login_accounts" SET "Password_hash"='synthetic-changed',
                "Password_set_at"='2030-01-01T00:00:00Z' WHERE id=19;''')
            result = pg.sql('''UPDATE login."Login_sessions" SET "Revoked_at"=now()
                WHERE "Account_id"=19 AND "Revoked_at" IS NULL;''', check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(pg.sql('''SELECT "Password_set_at" IS NOT NULL
                FROM login."Login_accounts" WHERE id=19;''').stdout.strip(), 't')
            self.assertEqual(pg.sql('''SELECT "Revoked_at" IS NULL
                FROM login."Login_sessions" WHERE id=25;''').stdout.strip(), 't')
        finally:
            pg.sql('''ALTER TABLE "Learner"."Login_sessions" DROP CONSTRAINT synthetic_revoke_failure;
                DELETE FROM login."Login_sessions" WHERE id=25;''')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', required=True, type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('synthetic_pg', args.bundle / 'tests/run_local.py')
    pg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pg)
    started = False
    try:
        pg.command('initdb', '-D', pg.CLUSTER / 'data', '-U', 'phase1_test_owner',
                   '-A', 'trust', '--no-locale', '--encoding=UTF8')
        pg.command('pg_ctl', '-D', pg.CLUSTER / 'data', '-l', pg.CLUSTER / 'server.log',
                   '-o', f'-h 127.0.0.1 -p {pg.PORT}', '-w', 'start')
        started = True
        pg.sql(file=pg.HERE / 'fixture.sql')
        # The DB fixture deliberately has a minimal canonical table. Supply
        # only existing production projection columns in this synthetic cluster.
        pg.sql('''ALTER TABLE "Learner".learners ADD COLUMN programme_id bigint,
            ADD COLUMN full_name text, ADD COLUMN programme text, ADD COLUMN coach_name text,
            ADD COLUMN start_date date, ADD COLUMN end_date date, ADD COLUMN learner_type text;''')
        pg.sql(file=pg.BUNDLE / '10-install.sql')
        result = unittest.TextTestRunner(verbosity=2).run(
            unittest.defaultTestLoader.loadTestsFromTestCase(SelectorPostgresTests))
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        if started:
            pg.command('pg_ctl', '-D', pg.CLUSTER / 'data', '-m', 'fast', '-w', 'stop')
