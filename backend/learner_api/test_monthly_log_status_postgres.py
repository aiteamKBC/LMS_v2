"""Development Monthly Log status contract in disposable local PostgreSQL only."""
import os
import threading
import unittest

import psycopg

# Deployed Development table/constraint/index/trigger contract from the read-only audit.
DDL = r'''
CREATE SCHEMA "Learner";
CREATE TABLE "Learner".learners (id bigint PRIMARY KEY);
INSERT INTO "Learner".learners VALUES (70),(71);
CREATE TABLE "Learner".learner_monthly_targets (
    learner_id bigint NOT NULL,
    report_month varchar NOT NULL,
    target_hours numeric,
    source_system text NOT NULL,
    source_ref text NOT NULL DEFAULT '',
    basis text NOT NULL DEFAULT '',
    programme_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    programme_profile_id text NOT NULL DEFAULT '',
    updated_by text NOT NULL DEFAULT '',
    actual_seconds_total bigint,
    actual_updated_at timestamptz,
    actual_summary jsonb,
    month_status text NOT NULL DEFAULT 'open',
    CONSTRAINT learner_monthly_targets_learner_id_fkey
      FOREIGN KEY (learner_id) REFERENCES "Learner".learners(id) ON DELETE CASCADE,
    CONSTRAINT learner_monthly_targets_id_learner_uniq UNIQUE (id,learner_id),
    CONSTRAINT learner_monthly_targets_month_status_check
      CHECK (month_status = ANY (ARRAY['open','partially_signed','locked'])),
    CONSTRAINT learner_monthly_actual_seconds_nonnegative
      CHECK (actual_seconds_total IS NULL OR actual_seconds_total >= 0),
    CONSTRAINT learner_monthly_actual_state_complete
      CHECK ((actual_seconds_total IS NULL) = (actual_updated_at IS NULL)),
    CONSTRAINT learner_monthly_targets_id_owner_month_uniq
      UNIQUE (id,learner_id,report_month),
    CONSTRAINT learner_monthly_targets_scope_uniq
      UNIQUE NULLS NOT DISTINCT (learner_id,programme_id,programme_profile_id,report_month)
);
CREATE INDEX learner_monthly_targets_learner_month_idx
ON "Learner".learner_monthly_targets (learner_id,report_month);

CREATE TABLE "Learner".learner_monthly_signatures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    learner_id bigint NOT NULL,
    report_month varchar NOT NULL,
    signer_role text NOT NULL CHECK (signer_role IN ('learner','coach')),
    signer_name text NOT NULL DEFAULT '',
    signature_data text,
    signature_url text NOT NULL DEFAULT '',
    capture_method text NOT NULL DEFAULT '',
    review_confirmed boolean NOT NULL DEFAULT false,
    snapshot_digest text NOT NULL DEFAULT '',
    signed_at timestamptz,
    source_system text NOT NULL DEFAULT 'learner',
    source_ref text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    source_learner_id text NOT NULL DEFAULT '',
    programme_key text NOT NULL DEFAULT '',
    signature_source_type text,
    signature_source_document_id text,
    signature_source_document_name text,
    signature_source_review_date text,
    signature_extraction_method text,
    audit_version text,
    monthly_target_id bigint,
    CONSTRAINT learner_monthly_signatures_learner_id_fkey
      FOREIGN KEY (learner_id) REFERENCES "Learner".learners(id) ON DELETE RESTRICT,
    CONSTRAINT learner_monthly_signatures_monthly_target_fk
      FOREIGN KEY (monthly_target_id,learner_id,report_month)
      REFERENCES "Learner".learner_monthly_targets(id,learner_id,report_month)
      ON DELETE RESTRICT,
    CONSTRAINT learner_monthly_signatures_scope_uniq
      UNIQUE (source_learner_id,programme_key,report_month,signer_role)
);
CREATE INDEX learner_monthly_signatures_monthly_target_idx
ON "Learner".learner_monthly_signatures (monthly_target_id)
WHERE monthly_target_id IS NOT NULL;
CREATE INDEX learner_monthly_signatures_confirmed_learner_month_idx
ON "Learner".learner_monthly_signatures (learner_id,report_month)
WHERE review_confirmed IS TRUE;
CREATE INDEX idx_lrn_fk_5ec4fffa9cf0e888cf3f4649a2624dec
ON "Learner".learner_monthly_signatures (learner_id);

CREATE FUNCTION "Learner".link_monthly_log_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_ids BIGINT[];
BEGIN
    IF NEW.source_system = 'lms' AND NEW.source_ref LIKE 'lms-monthly:%' THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended(NEW.learner_id::text || ':' || NEW.report_month,0));
        SELECT ARRAY_AGG(id ORDER BY id) INTO target_ids
        FROM "Learner".learner_monthly_targets
        WHERE learner_id = NEW.learner_id AND report_month = NEW.report_month;
        IF COALESCE(CARDINALITY(target_ids), 0) > 1 THEN
            RAISE EXCEPTION 'Multiple monthly targets found';
        END IF;
        NEW.monthly_target_id := target_ids[1];
    ELSE
        NEW.monthly_target_id := NULL;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION "Learner".refresh_monthly_log_status(p_target_id bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE has_learner BOOLEAN; has_coach BOOLEAN; new_status TEXT;
BEGIN
    IF p_target_id IS NULL THEN RETURN; END IF;
    PERFORM 1 FROM "Learner".learner_monthly_targets
      WHERE id = p_target_id FOR NO KEY UPDATE;
    SELECT COALESCE(BOOL_OR(signer_role = 'learner'), FALSE),
           COALESCE(BOOL_OR(signer_role = 'coach'), FALSE)
    INTO has_learner,has_coach
    FROM "Learner".learner_monthly_signatures
    WHERE monthly_target_id = p_target_id AND review_confirmed IS TRUE
      AND source_system = 'lms' AND source_ref LIKE 'lms-monthly:%';
    new_status := CASE WHEN has_learner AND has_coach THEN 'locked'
      WHEN has_learner OR has_coach THEN 'partially_signed' ELSE 'open' END;
    UPDATE "Learner".learner_monthly_targets SET month_status = new_status
    WHERE id = p_target_id AND month_status IS DISTINCT FROM new_status;
END $$;

CREATE FUNCTION "Learner".sync_monthly_log_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_target_id BIGINT; new_target_id BIGINT; target_id BIGINT;
BEGIN
    IF TG_OP <> 'INSERT' THEN old_target_id := OLD.monthly_target_id; END IF;
    IF TG_OP <> 'DELETE' THEN new_target_id := NEW.monthly_target_id; END IF;
    FOR target_id IN SELECT DISTINCT x FROM UNNEST(ARRAY[old_target_id,new_target_id]) AS a(x)
      WHERE x IS NOT NULL ORDER BY x
    LOOP
        PERFORM "Learner".refresh_monthly_log_status(target_id);
    END LOOP;
    RETURN NULL;
END $$;

CREATE FUNCTION "Learner".link_existing_monthly_signatures() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_ids BIGINT[];
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.learner_id::text || ':' || NEW.report_month,0));
    SELECT ARRAY_AGG(id ORDER BY id) INTO target_ids
    FROM "Learner".learner_monthly_targets
    WHERE learner_id = NEW.learner_id AND report_month = NEW.report_month;
    IF COALESCE(CARDINALITY(target_ids), 0) > 1 THEN
        RAISE EXCEPTION 'Multiple monthly targets found';
    END IF;
    UPDATE "Learner".learner_monthly_signatures SET monthly_target_id = NEW.id
    WHERE learner_id = NEW.learner_id AND report_month = NEW.report_month
      AND monthly_target_id IS NULL AND source_system = 'lms'
      AND source_ref LIKE 'lms-monthly:%';
    RETURN NEW;
END $$;

CREATE FUNCTION "Learner".guard_monthly_log_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_status TEXT;
BEGIN
    IF OLD.month_status = NEW.month_status THEN RETURN NEW; END IF;
    IF OLD.month_status = 'locked' THEN RAISE EXCEPTION 'A locked monthly log cannot be reopened'; END IF;
    SELECT CASE WHEN BOOL_OR(signer_role = 'learner') AND BOOL_OR(signer_role = 'coach') THEN 'locked'
      WHEN COUNT(*) > 0 THEN 'partially_signed' ELSE 'open' END INTO expected_status
    FROM "Learner".learner_monthly_signatures
    WHERE monthly_target_id = NEW.id AND review_confirmed IS TRUE
      AND source_system = 'lms' AND source_ref LIKE 'lms-monthly:%';
    IF NEW.month_status IS DISTINCT FROM expected_status THEN
        RAISE EXCEPTION 'Invalid month status: expected %, received %', expected_status,NEW.month_status;
    END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION "Learner".guard_locked_monthly_signatures() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status TEXT;
BEGIN
    IF OLD.source_system = 'lms' AND OLD.source_ref LIKE 'lms-monthly:%'
       AND OLD.review_confirmed IS TRUE AND OLD.monthly_target_id IS NOT NULL THEN
        SELECT month_status INTO current_status FROM "Learner".learner_monthly_targets
        WHERE id = OLD.monthly_target_id FOR NO KEY UPDATE;
        IF current_status = 'locked' THEN
            IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cannot delete a locked monthly signature'; END IF;
            IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Cannot modify a locked monthly signature'; END IF;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE FUNCTION "Learner".guard_new_month_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.month_status IS DISTINCT FROM 'open' THEN
        RAISE EXCEPTION 'New monthly targets must start with open status';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_link_monthly_log_signature BEFORE INSERT OR UPDATE OF learner_id,report_month,source_system,source_ref,monthly_target_id
ON "Learner".learner_monthly_signatures FOR EACH ROW EXECUTE FUNCTION "Learner".link_monthly_log_signature();
CREATE TRIGGER trg_sync_monthly_log_status AFTER INSERT OR DELETE OR UPDATE
ON "Learner".learner_monthly_signatures FOR EACH ROW EXECUTE FUNCTION "Learner".sync_monthly_log_status();
CREATE TRIGGER trg_link_existing_monthly_signatures AFTER INSERT
ON "Learner".learner_monthly_targets FOR EACH ROW EXECUTE FUNCTION "Learner".link_existing_monthly_signatures();
CREATE TRIGGER trg_guard_monthly_log_status BEFORE UPDATE OF month_status
ON "Learner".learner_monthly_targets FOR EACH ROW EXECUTE FUNCTION "Learner".guard_monthly_log_status();
CREATE TRIGGER trg_guard_locked_monthly_signatures BEFORE DELETE OR UPDATE
ON "Learner".learner_monthly_signatures FOR EACH ROW EXECUTE FUNCTION "Learner".guard_locked_monthly_signatures();
CREATE TRIGGER trg_guard_new_month_status BEFORE INSERT
ON "Learner".learner_monthly_targets FOR EACH ROW EXECUTE FUNCTION "Learner".guard_new_month_status();
'''


class PostgreSQLContractCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dsn = os.environ['LMS_ISOLATED_PG_DSN']
        cls.db = psycopg.connect(cls.dsn, autocommit=True)
        host,branch = cls.db.execute(
            "SELECT host(inet_server_addr()),current_setting('neon.branch_id',true)"
        ).fetchone()
        if host != '127.0.0.1' or branch:
            raise RuntimeError('Monthly Log PostgreSQL tests require a local non-Neon cluster.')

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        self.db.execute('DROP SCHEMA IF EXISTS "Learner" CASCADE')
        self.db.execute(DDL)

    def target(self,learner=70,month='2026-10',programme=10,status='open'):
        return self.db.execute('''INSERT INTO "Learner".learner_monthly_targets
          (learner_id,programme_id,report_month,month_status,target_hours,source_system,
           actual_seconds_total,actual_updated_at)
          VALUES (%s,%s,%s,%s,20,'test',3600,now()) RETURNING id''',
          [learner,str(programme),month,status]).fetchone()[0]

    def sign(self,role,learner=70,month='2026-10',source_ref=None,
             source_system='lms',programme='programme-10',confirmed=True):
        source_ref = source_ref or f'lms-monthly:{learner}:{month}:{role}'
        return self.db.execute('''INSERT INTO "Learner".learner_monthly_signatures
          (learner_id,report_month,signer_role,review_confirmed,source_system,source_ref,
           source_learner_id,programme_key) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
          RETURNING id,monthly_target_id''',[learner,month,role,confirmed,source_system,source_ref,
          str(learner),programme]).fetchone()

    def status(self,learner=70,month='2026-10'):
        return self.db.execute('''SELECT month_status FROM "Learner".learner_monthly_targets
          WHERE learner_id=%s AND report_month=%s''',[learner,month]).fetchone()[0]


class MonthlyLogStatusPostgresTests(PostgreSQLContractCase):
    def test_open_partial_locked_and_coach_first(self):
        target=self.target(); self.assertEqual(self.status(),'open')
        self.assertEqual(self.sign('coach')[1],target); self.assertEqual(self.status(),'partially_signed')
        self.assertEqual(self.sign('learner')[1],target); self.assertEqual(self.status(),'locked')

    def test_late_target_links_existing_monthly_signatures(self):
        learner=self.sign('learner'); coach=self.sign('coach')
        self.assertIsNone(learner[1]); self.assertIsNone(coach[1]); target=self.target()
        links=self.db.execute('SELECT monthly_target_id FROM "Learner".learner_monthly_signatures ORDER BY id').fetchall()
        self.assertEqual(links,[(target,),(target,)]); self.assertEqual(self.status(),'locked')

    def test_direct_invalid_status_and_invalid_initial_status_are_rejected(self):
        self.target()
        with self.assertRaises(psycopg.errors.RaiseException):
            self.db.execute('UPDATE "Learner".learner_monthly_targets SET month_status=\'locked\' WHERE learner_id=70')
        with self.assertRaises(psycopg.errors.RaiseException): self.target(71,status='partially_signed')

    def test_locked_month_and_confirmed_signatures_are_permanent(self):
        self.target(); learner,_=self.sign('learner'); coach,_=self.sign('coach')
        with self.assertRaises(psycopg.errors.RaiseException):
            self.db.execute('UPDATE "Learner".learner_monthly_targets SET month_status=\'open\' WHERE learner_id=70')
        with self.assertRaises(psycopg.errors.RaiseException):
            self.db.execute('DELETE FROM "Learner".learner_monthly_signatures WHERE id=%s',[learner])
        with self.assertRaises(psycopg.errors.RaiseException):
            self.db.execute('UPDATE "Learner".learner_monthly_signatures SET review_confirmed=false WHERE id=%s',[coach])
        self.assertEqual(self.status(),'locked')

    def test_simultaneous_signing_serializes_to_locked(self):
        self.target(); barrier=threading.Barrier(2); errors=[]
        def worker(role):
            try:
                with psycopg.connect(self.dsn,autocommit=True) as db:
                    barrier.wait(); db.execute('''INSERT INTO "Learner".learner_monthly_signatures
                      (learner_id,report_month,signer_role,review_confirmed,source_system,source_ref,
                       source_learner_id,programme_key)
                      VALUES (70,'2026-10',%s,true,'lms',%s,'70','programme-10')''',
                      [role,f'lms-monthly:race:{role}'])
            except (psycopg.Error,threading.BrokenBarrierError) as error: errors.append(error)
        threads=[threading.Thread(target=worker,args=(role,)) for role in ('learner','coach')]
        for thread in threads: thread.start()
        for thread in threads: thread.join(10)
        self.assertFalse(errors); self.assertEqual(self.status(),'locked')

    def test_duplicate_signing_and_cross_owner_month_are_isolated(self):
        self.target(); self.target(71); self.target(70,'2026-11'); self.sign('learner')
        with self.assertRaises(psycopg.errors.UniqueViolation): self.sign('learner',source_ref='lms-monthly:duplicate')
        self.assertEqual(self.status(),'partially_signed'); self.assertEqual(self.status(71),'open')
        self.assertEqual(self.status(70,'2026-11'),'open')

    def test_fk_prevents_target_identity_change_and_deletion(self):
        target=self.target(); signature,linked=self.sign('learner'); self.assertEqual(linked,target)
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.db.execute('UPDATE "Learner".learner_monthly_targets SET learner_id=71 WHERE id=%s',[target])
        with self.assertRaises(psycopg.errors.ForeignKeyViolation):
            self.db.execute('DELETE FROM "Learner".learner_monthly_targets WHERE id=%s',[target])
        self.assertEqual(self.db.execute('SELECT learner_id,monthly_target_id FROM "Learner".learner_monthly_signatures WHERE id=%s',[signature]).fetchone(),(70,target))

    def test_mcm_and_audit_signatures_remain_unlinked_and_do_not_set_status(self):
        self.target()
        _,mcm=self.sign('learner',source_ref='lms-mcm:70:2026-10:x',programme='mcm')
        _,audit=self.sign('coach',source_system='audit',source_ref='historical',programme='audit')
        self.assertIsNone(mcm); self.assertIsNone(audit); self.assertEqual(self.status(),'open')

    def test_target_and_actual_values_do_not_change_during_status_transitions(self):
        target=self.target(); before=self.db.execute('SELECT target_hours,actual_seconds_total FROM "Learner".learner_monthly_targets WHERE id=%s',[target]).fetchone()
        self.sign('learner'); self.sign('coach')
        after=self.db.execute('SELECT target_hours,actual_seconds_total FROM "Learner".learner_monthly_targets WHERE id=%s',[target]).fetchone()
        self.assertEqual(after,before)

    def test_concurrent_target_creation_and_signing_always_links(self):
        target_db=psycopg.connect(self.dsn); errors=[]
        try:
            target_db.execute('''INSERT INTO "Learner".learner_monthly_targets
              (learner_id,programme_id,report_month,target_hours,source_system,
               actual_seconds_total,actual_updated_at)
              VALUES (70,'10','2026-10',20,'test',3600,now())''')
            def sign_waiting():
                try:
                    with psycopg.connect(self.dsn,autocommit=True) as db:
                        db.execute('''INSERT INTO "Learner".learner_monthly_signatures
                          (learner_id,report_month,signer_role,review_confirmed,source_system,source_ref,
                           source_learner_id,programme_key)
                          VALUES (70,'2026-10','learner',true,'lms','lms-monthly:race','70','programme-10')''')
                except psycopg.Error as error: errors.append(error)
            thread=threading.Thread(target=sign_waiting); thread.start(); target_db.commit(); thread.join(10)
            self.assertFalse(errors); self.assertFalse(thread.is_alive())
            linked,status=self.db.execute('''SELECT s.monthly_target_id,t.month_status
              FROM "Learner".learner_monthly_signatures s
              JOIN "Learner".learner_monthly_targets t ON t.id=s.monthly_target_id''').fetchone()
            self.assertIsNotNone(linked); self.assertEqual(status,'partially_signed')
        finally: target_db.close()

    def test_second_programme_target_is_rejected_before_ambiguity(self):
        first=self.target(programme=10); _,linked=self.sign('learner'); self.assertEqual(linked,first)
        with self.assertRaises(psycopg.errors.RaiseException): self.target(programme=11)
        self.assertEqual(self.db.execute("SELECT count(*) FROM \"Learner\".learner_monthly_targets WHERE learner_id=70 AND report_month='2026-10'").fetchone()[0],1)


if __name__ == '__main__':
    unittest.main()
