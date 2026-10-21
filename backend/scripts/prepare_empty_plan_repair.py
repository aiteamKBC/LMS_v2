"""Prepare a private fixed-identity repair; validate ONLY on a disposable branch.

No source-branch apply/rollback mode exists. Credentials arrive via private stdin.
The exact source allowlist and backup are Windows user-DPAPI encrypted off-repo.
"""
import ctypes
from ctypes import wintypes
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import unittest
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs/f01-f02'
PROJECT = 'green-term-97168878'
SOURCE = 'br-raspy-sky-abvs8lq9'
CHILD = 'br-aged-band-abmyv3yi'
PRIVATE = Path.home() / '.codex/private/lms-f01-f02-empty-plan-repair'
BUNDLE = PRIVATE / 'verified-two-record-backup.dpapi'


def seal(data, decrypt=False):
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_byte))]
    buf = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte)))
    outgoing = Blob()
    fn = ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData
    if not fn(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise RuntimeError('Private backup encryption/decryption failed')
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.windll.kernel32.LocalFree(outgoing.data)


def rendered_sql():
    fingerprints = (DOCS / '21-repair-fingerprints.sql').read_text(encoding='utf-8')
    inline = fingerprints.replace('%s', "ARRAY(SELECT (value->>'id')::bigint FROM jsonb_array_elements(p->'rows'))")
    inline = inline.replace(' FROM (', ' INTO checks FROM (', 1)
    return (DOCS / '22-guarded-empty-plan-repair.sql').read_text(encoding='utf-8').replace(
        '/* INTEGRITY_SELECT */', inline)


TRIGGERS = """SELECT md5(coalesce(string_agg(pg_get_triggerdef(t.oid)||pg_get_functiondef(t.tgfoid),'' ORDER BY t.tgname),''))
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='Learner' AND c.relname='learners' AND NOT t.tgisinternal"""
CANDIDATE = """l.learning_plan IS NULL AND CASE
 WHEN jsonb_typeof(u."Training_plan")='array' THEN u."Training_plan"
 WHEN jsonb_typeof(u."Learning_plan")='array' THEN u."Learning_plan"
 ELSE NULL END='[]'::jsonb"""
MAPPINGS = """SELECT l.id,l.enrolment_id,l.uuid,u.uuid,md5(to_jsonb(l)::text),
 md5((to_jsonb(l)-'learning_plan'-'updated_at')::text),md5(to_jsonb(u)::text),
 l.learning_plan,l.updated_at,
 jsonb_build_object('sql_null',u."Training_plan" IS NULL,'value',u."Training_plan"),
 jsonb_build_object('sql_null',u."Learning_plan" IS NULL,'value',u."Learning_plan")
 FROM "Learner".learners l JOIN enrolment."Created_users" u ON u.id=l.enrolment_id WHERE """


def fingerprint(conn, ids):
    return conn.execute((DOCS / '21-repair-fingerprints.sql').read_text(encoding='utf-8'), (ids,)).fetchone()[0]


def capture(conn, branch, ids=None):
    records = conn.execute(MAPPINGS + (CANDIDATE if ids is None else 'l.id=ANY(%s)'),
                           None if ids is None else (ids,)).fetchall()
    if len(records) != 2 or len({r[0] for r in records}) != 2 or len({r[1] for r in records}) != 2 or len({r[2] for r in records}) != 2:
        raise RuntimeError('Exactly two unique linked identities are required')
    rows = []
    keys = ('id', 'source_id', 'uuid', 'source_uuid', 'target_digest', 'business_digest',
            'source_digest', 'original_learning_plan', 'original_updated_at', 'source_training', 'source_learning')
    for record in records:
        if record[2] is None or record[2] != record[3] or record[7] is not None:
            raise RuntimeError('Identity agreement or original NULL state failed')
        rows.append(dict(zip(keys, record)))
    ids = [row['id'] for row in rows]
    # Stable link uniqueness is checked from the complete destination population.
    n = conn.execute('SELECT count(*) FROM "Learner".learners WHERE enrolment_id=ANY(%s)',
                     ([r['source_id'] for r in rows],)).fetchone()[0]
    if n != 2:
        raise RuntimeError('Ambiguous source-to-profile mapping')
    candidate_count = conn.execute('SELECT count(*) FROM "Learner".learners l '
                                  'JOIN enrolment."Created_users" u ON u.id=l.enrolment_id WHERE ' + CANDIDATE).fetchone()[0]
    return {'version': 1, 'project_id': PROJECT, 'database': 'neondb', 'branch_id': branch,
            'operation': 'apply', 'rows': rows, 'candidate_count': candidate_count,
            'trigger_digest': conn.execute(TRIGGERS).fetchone()[0],
            'fingerprints': fingerprint(conn, ids)}


def configure(conn, read_only=False):
    conn.execute("SET LOCAL TIME ZONE 'UTC'")
    conn.execute("SET LOCAL statement_timeout='60s'")
    conn.execute("SET LOCAL lock_timeout='5s'")
    if read_only:
        assert conn.execute("SELECT current_setting('transaction_read_only')").fetchone()[0] == 'on'


def prepare(url):
    import psycopg
    with psycopg.connect(url, options='-c default_transaction_read_only=on') as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        configure(conn, True)
        assert conn.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() == ('neondb', SOURCE)
        data = capture(conn, SOURCE)
        if data['candidate_count'] != 2 or data['fingerprints']['linked_progress']['rows'] != 911:
            raise RuntimeError('Candidate or historical-link population drift')
        data['linked_manifest'] = conn.execute('SELECT id,plan_component_id FROM "Learner".learner_progress_entries '
                                               'WHERE plan_component_id IS NOT NULL ORDER BY id').fetchall()
        # Original data for every column this operation/trigger can change is
        # backed up; other business columns are protected by their server digest.
        data['sql'] = rendered_sql()
        data['sql_sha256'] = hashlib.sha256(data['sql'].encode()).hexdigest()
        data['captured_at'] = conn.execute('SELECT transaction_timestamp()').fetchone()[0]
    plain = json.dumps(data, default=str, sort_keys=True).encode()
    PRIVATE.mkdir(parents=True, exist_ok=True)
    if BUNDLE.exists():
        raise RuntimeError('Existing private backup will not be overwritten')
    encrypted = seal(plain)
    BUNDLE.write_bytes(encrypted)
    assert seal(BUNDLE.read_bytes(), decrypt=True) == plain
    summary = {'prepare': 'PASS', 'allowlisted_records': 2, 'uuid_agreements': 2,
               'linked_progress': 911, 'candidate_count': 2,
               'encrypted_backup_roundtrip': 'PASS', 'backup_file': str(BUNDLE),
               'backup_sha256': hashlib.sha256(encrypted).hexdigest(),
               'sql_sha256': data['sql_sha256'], 'fingerprints': data['fingerprints']}
    (DOCS / '24-repair-preparation-evidence.json').write_text(json.dumps(summary, indent=2)+'\n', encoding='utf-8')
    (DOCS / '23-rendered-empty-plan-repair.sql').write_bytes(data['sql'].encode('utf-8'))
    print(json.dumps(summary), flush=True)


def recheck(url):
    """Read-only, fixed-ID comparison to the frozen backup; never rediscover IDs."""
    import psycopg
    encrypted = BUNDLE.read_bytes()
    saved = json.loads(seal(encrypted, decrypt=True))
    expected_sha = saved['sql_sha256']
    assert hashlib.sha256(rendered_sql().encode()).hexdigest() == expected_sha
    assert hashlib.sha256((DOCS / '23-rendered-empty-plan-repair.sql').read_bytes()).hexdigest() == expected_sha
    with psycopg.connect(url, options='-c default_transaction_read_only=on') as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); configure(conn, True)
        assert conn.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() == ('neondb', SOURCE)
        fresh = capture(conn, SOURCE, [r['id'] for r in saved['rows']])
        normalized = json.loads(json.dumps(fresh, default=str))
        assert sorted(normalized['rows'], key=lambda r: r['id']) == sorted(saved['rows'], key=lambda r: r['id'])
        for field in ('candidate_count', 'fingerprints', 'trigger_digest'):
            assert fresh[field] == saved[field], 'Frozen source baseline changed'
        links = conn.execute('SELECT id,plan_component_id FROM "Learner".learner_progress_entries '
                             'WHERE plan_component_id IS NOT NULL ORDER BY id').fetchall()
        assert json.loads(json.dumps(links)) == saved['linked_manifest']
    out = {'readonly_recheck': 'PASS', 'fixed_rows': 2, 'exact_progress_pairs': 911,
           'all_normalized_rows': 'PASS', 'other_profiles': 'PASS', 'trigger_digest': 'PASS',
           'encrypted_backup_sha256': hashlib.sha256(encrypted).hexdigest(), 'sql_sha256': expected_sha}
    (DOCS / '27-repair-readonly-recheck.json').write_text(json.dumps(out, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(out), flush=True)


def apply_sql(conn, payload):
    conn.execute("SELECT set_config('lms.repair_payload',%s,true)",
                 (json.dumps(payload, default=str, sort_keys=True),))
    conn.execute(rendered_sql())


def receipt(conn, ids):
    return {str(r[0]): {'target_digest': r[1]} for r in conn.execute(
        'SELECT l.id,md5(to_jsonb(l)::text) FROM "Learner".learners l WHERE id=ANY(%s)', (ids,)).fetchall()}


class SyntheticRepairTests(unittest.TestCase):
    def setUp(self):
        self.conn = psycopg.connect(TEST_URL, autocommit=True)
        assert self.conn.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() == ('neondb', CHILD)
        self.conn.execute('BEGIN')
        configure(self.conn)
        self.ids = []
        marker = 'f01-empty-repair-' + uuid4().hex
        for i in range(2):
            public_uuid = uuid4()
            sid = self.conn.execute('INSERT INTO enrolment."Created_users"(uuid,"Training_plan","Learning_plan") '
                                   'VALUES(%s,%s::jsonb,%s::jsonb) RETURNING id',
                                   (public_uuid, '[]', '[{"moduleId":"synthetic-precedence"}]')).fetchone()[0]
            pid = self.conn.execute('INSERT INTO "Learner".learners(full_name,email,lifecycle_status,enrolment_id,uuid) '
                                   'VALUES(%s,%s,%s,%s,%s) RETURNING id',
                                   (marker, marker+str(i)+'@example.invalid', 'active', sid, public_uuid)).fetchone()[0]
            self.ids.append(pid)
        self.payload = capture(self.conn, CHILD, self.ids)

    def tearDown(self):
        self.conn.execute('ROLLBACK')
        self.conn.close()

    def assert_refused(self, value):
        self.conn.execute('SAVEPOINT denied_case')
        try:
            with self.assertRaises(psycopg.errors.RaiseException):
                apply_sql(self.conn, value)
        finally:
            self.conn.execute('ROLLBACK TO SAVEPOINT denied_case')
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "Learner".learners WHERE id=ANY(%s) '
                                           'AND learning_plan IS NULL', (self.ids,)).fetchone()[0], 2)

    def test_01_exact_apply_and_receipt_guarded_rollback(self):
        apply_sql(self.conn, self.payload)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "Learner".learners WHERE id=ANY(%s) '
                                           "AND learning_plan='[]'::jsonb", (self.ids,)).fetchone()[0], 2)
        undo = copy.deepcopy(self.payload)
        undo.update(operation='rollback', receipt=receipt(self.conn, self.ids))
        apply_sql(self.conn, undo)
        self.assertEqual(self.conn.execute('SELECT count(*) FROM "Learner".learners WHERE id=ANY(%s) '
                                           'AND learning_plan IS NULL', (self.ids,)).fetchone()[0], 2)
        self.assertEqual(fingerprint(self.conn, self.ids), self.payload['fingerprints'])

    def test_02_wrong_branch_and_database_are_refused(self):
        for field, value in (('branch_id', SOURCE), ('database', 'other')):
            bad = copy.deepcopy(self.payload); bad[field] = value
            self.assert_refused(bad)

    def test_03_missing_duplicate_and_wrong_identity_are_refused(self):
        for mode in ('missing', 'duplicate', 'uuid', 'source_id'):
            bad = copy.deepcopy(self.payload)
            if mode == 'missing': bad['rows'].pop()
            elif mode == 'duplicate': bad['rows'][1] = bad['rows'][0]
            elif mode == 'uuid': bad['rows'][0]['uuid'] = str(uuid4())
            else: bad['rows'][0]['source_id'] = -1
            self.assert_refused(bad)

    def test_04_source_precedence_and_value_drift_are_refused(self):
        sid = self.payload['rows'][0]['source_id']
        self.conn.execute('UPDATE enrolment."Created_users" SET "Training_plan"=NULL WHERE id=%s', (sid,))
        self.assert_refused(self.payload)

    def test_05_target_timestamp_and_value_drift_are_refused(self):
        bad = copy.deepcopy(self.payload); bad['rows'][0]['target_digest'] = 'wrong'
        self.assert_refused(bad)
        self.conn.execute("UPDATE \"Learner\".learners SET full_name=full_name||'changed' WHERE id=%s", (self.ids[0],))
        self.assert_refused(self.payload)

    def test_06_candidate_and_history_fingerprint_drift_are_refused(self):
        bad = copy.deepcopy(self.payload); bad['candidate_count'] += 1
        self.assert_refused(bad)
        bad = copy.deepcopy(self.payload); bad['fingerprints']['components']['digest'] = 'wrong'
        self.assert_refused(bad)

    def test_07_trigger_drift_and_replay_are_refused(self):
        bad = copy.deepcopy(self.payload); bad['trigger_digest'] = 'wrong'
        self.assert_refused(bad)
        apply_sql(self.conn, self.payload)
        self.conn.execute('SAVEPOINT replay')
        with self.assertRaises(psycopg.errors.RaiseException):
            apply_sql(self.conn, self.payload)
        self.conn.execute('ROLLBACK TO SAVEPOINT replay')

    def test_08_missing_or_stale_rollback_receipt_is_refused(self):
        apply_sql(self.conn, self.payload)
        for proof in ({}, {str(self.ids[0]): {'target_digest': 'wrong'}}):
            undo = copy.deepcopy(self.payload); undo.update(operation='rollback', receipt=proof)
            self.conn.execute('SAVEPOINT rollback_denial')
            with self.assertRaises(psycopg.errors.RaiseException):
                apply_sql(self.conn, undo)
            self.conn.execute('ROLLBACK TO SAVEPOINT rollback_denial')

    def test_09_committed_apply_then_separate_transaction_rollback(self):
        try:
            apply_sql(self.conn, self.payload)
            proof = receipt(self.conn, self.ids)
            self.conn.execute('COMMIT')
            self.conn.execute('BEGIN'); configure(self.conn)
            undo = copy.deepcopy(self.payload); undo.update(operation='rollback', receipt=proof)
            apply_sql(self.conn, undo)
            self.conn.execute('COMMIT')
            self.assertEqual(self.conn.execute('SELECT count(*) FROM "Learner".learners '
                                               'WHERE id=ANY(%s) AND learning_plan IS NULL',
                                               (self.ids,)).fetchone()[0], 2)
        finally:
            self.conn.execute('ROLLBACK')
            self.conn.execute('BEGIN'); configure(self.conn)
            # Exact synthetic IDs generated in this test, never inherited IDs.
            self.conn.execute('DELETE FROM "Learner".learners WHERE id=ANY(%s)', (self.ids,))
            self.conn.execute('DELETE FROM enrolment."Created_users" WHERE id=ANY(%s)',
                              ([r['source_id'] for r in self.payload['rows']],))
            self.conn.execute('COMMIT')
            self.conn.execute('BEGIN'); configure(self.conn)


def validate(url):
    global TEST_URL, psycopg
    import psycopg
    TEST_URL = url
    with psycopg.connect(url, options='-c default_transaction_read_only=on') as conn:
        configure(conn, True)
        assert conn.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() == ('neondb', CHILD)
        before = fingerprint(conn, [])
        links = conn.execute('SELECT id,plan_component_id FROM "Learner".learner_progress_entries '
                             'WHERE plan_component_id IS NOT NULL ORDER BY id').fetchall()
        assert len(links) == 911
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SyntheticRepairTests))
    with psycopg.connect(url, options='-c default_transaction_read_only=on') as conn:
        configure(conn, True)
        assert fingerprint(conn, []) == before
        assert conn.execute('SELECT id,plan_component_id FROM "Learner".learner_progress_entries '
                            'WHERE plan_component_id IS NOT NULL ORDER BY id').fetchall() == links
    out = {'synthetic_sql_validation': 'PASS' if result.wasSuccessful() else 'FAIL', 'tests': result.testsRun,
           'failures': len(result.failures), 'errors': len(result.errors),
           'exact_911_pairs': 'PASS', 'all_normalized_rows_and_profiles': 'PASS', 'branch': CHILD,
           'sql_sha256': hashlib.sha256(rendered_sql().encode()).hexdigest()}
    (DOCS / '25-repair-synthetic-validation.json').write_text(json.dumps(out, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(out), flush=True)
    if not result.wasSuccessful(): sys.exit(1)


if __name__ == '__main__':
    try:
        if os.name != 'nt': raise RuntimeError('Windows DPAPI backup host required')
        if sys.stdin.isatty():
            import msvcrt
            handle = msvcrt.get_osfhandle(sys.stdin.fileno()); mode = wintypes.DWORD()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)) or not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError('Cannot disable private stdin echo')
        print('READY_FOR_PRIVATE_STDIN', flush=True)
        envelope = json.loads(sys.stdin.readline())
        assert envelope['project_id'] == PROJECT
        if envelope['mode'] == 'prepare':
            assert envelope['branch_id'] == SOURCE
            prepare(envelope['connection_url'])
        elif envelope['mode'] == 'recheck':
            assert envelope['branch_id'] == SOURCE
            recheck(envelope['connection_url'])
        elif envelope['mode'] == 'validate':
            assert envelope['branch_id'] == CHILD and envelope['parent_id'] == SOURCE
            validate(envelope['connection_url'])
        else:
            raise RuntimeError('Only read-only source preparation/recheck or synthetic child validation is supported')
    except Exception as exc:
        import traceback
        print(json.dumps({'status': 'BLOCKED_OR_FAIL', 'error_type': type(exc).__name__,
                          'sqlstate': getattr(exc.__cause__ or exc, 'sqlstate', None),
                          'locations': [(Path(f.filename).name, f.name, f.lineno)
                                        for f in traceback.extract_tb(exc.__traceback__)[-4:]]}), flush=True)
        sys.exit(2)
