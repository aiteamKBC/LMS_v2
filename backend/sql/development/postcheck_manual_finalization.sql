-- READ ONLY, run while writers are still drained. Compare preflight fingerprints.
BEGIN READ ONLY;
DO $checks$
DECLARE definition text; signature text;
BEGIN
 IF current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-raspy-sky-abvs8lq9' THEN
   RAISE EXCEPTION 'Wrong branch: Development only';
 END IF;
 IF EXISTS (
   SELECT 1 FROM (VALUES
     ('"Learner".learner_journal_rows'::regclass,'trg_guard_finalized_manual_rows'),
     ('"Learner".manual_activity_documents'::regclass,'trg_guard_finalized_manual_docs'),
     ('"Learner".manual_month_finalization_events'::regclass,'trg_lock_manual_finalization_event_scope')
   ) expected(relation,name)
   WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=expected.relation
     AND t.tgname=expected.name AND NOT t.tgisinternal AND t.tgenabled='O')) THEN
   RAISE EXCEPTION 'Expected enabled serialization triggers missing';
 END IF;
 FOREACH signature IN ARRAY ARRAY['"Learner".guard_finalized_journal_month()',
                                 '"Learner".lock_manual_finalization_event_scope()'] LOOP
   definition := regexp_replace(pg_get_functiondef(signature::regprocedure),'\s','','g');
   IF position('manual-journal-finalization:' IN definition)>0
      OR position('pg_advisory_xact_lock(hashtextextended(' IN definition)=0
      OR position('canonical-journal-finalization:' IN definition)=0
      OR position('report_month,0))' IN definition)=0 THEN
     RAISE EXCEPTION 'Canonical lock expression differs: %',signature;
   END IF;
 END LOOP;
END $checks$;
SELECT 'monthly_audit_signoffs' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".monthly_audit_signoffs t
UNION ALL SELECT 'manual_month_finalization_events' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".manual_month_finalization_events t
UNION ALL SELECT 'learner_month_restore_points' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_month_restore_points t
UNION ALL SELECT 'manual_month_restore_points' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".manual_month_restore_points t
UNION ALL SELECT 'learner_monthly_signatures' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_monthly_signatures t
UNION ALL SELECT 'learner_monthly_targets' AS kind,count(*) AS rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "Learner".learner_monthly_targets t;
SELECT p.oid::regprocedure AS function_name,md5(pg_get_functiondef(p.oid)) AS definition_digest
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='Learner'
 AND p.proname IN ('lock_journal_month_scopes','guard_finalized_journal_month',
 'lock_manual_finalization_event_scope','lock_month_signature_scope','lock_archive_signoff_month_scope');
COMMIT;
