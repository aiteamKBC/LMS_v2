-- READ ONLY. Run on verified lms-ideal-architecture Development only.
-- psql --set ON_ERROR_STOP=1 --file backend/sql/development/preflight_manual_finalization.sql
-- Use an operator-selected Development connection; never copy credentials into logs.
BEGIN READ ONLY;
DO $checks$
BEGIN
 IF current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-raspy-sky-abvs8lq9' THEN
   RAISE EXCEPTION 'Wrong branch: Development only';
 END IF;
 IF EXISTS (SELECT 1 FROM "Learner".manual_month_finalization_events e
            LEFT JOIN "Learner".learners l ON l.id=e.learner_id
            WHERE l.id IS NULL OR e.report_month IS NULL
               OR e.report_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
   RAISE EXCEPTION 'Invalid finalization ownership/scope';
 END IF;
 IF EXISTS (SELECT 1 FROM "Learner".learner_journal_rows j
            LEFT JOIN "Learner".learners l ON l.id=j.learner_id
            WHERE l.id IS NULL OR j.month IS NULL
               OR j.month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN
   RAISE EXCEPTION 'Invalid journal ownership/scope';
 END IF;
 IF EXISTS (SELECT 1 FROM "Learner".manual_activity_documents d
            LEFT JOIN "Learner".learner_journal_rows j
              ON j.id=d.manual_activity_id AND j.learner_id=d.learner_id
            WHERE j.id IS NULL) THEN RAISE EXCEPTION 'Invalid document parent ownership'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
     WHERE conrelid='"Learner".manual_month_finalization_events'::regclass
       AND confrelid='"Learner".learners'::regclass AND contype='f' AND convalidated) THEN
   RAISE EXCEPTION 'Validated event owner FK missing';
 END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN
     ('"Learner".manual_month_finalization_events'::regclass,
      '"Learner".manual_activity_documents'::regclass) AND NOT convalidated) THEN
   RAISE EXCEPTION 'Unvalidated event/document constraint';
 END IF;
END $checks$;
SELECT current_database() AS database_name,current_setting('neon.branch_id') AS branch,
       current_setting('transaction_isolation') AS isolation;
SELECT t.tgrelid::regclass AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
 ('"Learner".learner_journal_rows'::regclass,'"Learner".manual_activity_documents'::regclass,
  '"Learner".manual_month_finalization_events'::regclass) ORDER BY 1,2;
SELECT conrelid::regclass AS table_name,conname,convalidated,pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('"Learner".manual_activity_documents'::regclass,
 '"Learner".manual_month_finalization_events'::regclass) ORDER BY 1,2;
-- Retain these aggregate fingerprints for comparison after deployment/rollback.
SELECT 'monthly_audit_signoffs' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".monthly_audit_signoffs t
UNION ALL SELECT 'manual_month_finalization_events' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".manual_month_finalization_events t
UNION ALL SELECT 'learner_month_restore_points' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_month_restore_points t
UNION ALL SELECT 'manual_month_restore_points' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".manual_month_restore_points t
UNION ALL SELECT 'learner_monthly_signatures' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_monthly_signatures t
UNION ALL SELECT 'learner_monthly_targets' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_monthly_targets t;
-- Export the current function definitions privately for exact environment rollback review.
SELECT pg_get_functiondef('"Learner".guard_finalized_journal_month()'::regprocedure);
COMMIT;
