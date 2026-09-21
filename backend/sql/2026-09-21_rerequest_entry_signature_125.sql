-- OWNER-RUN ONLY in Neon SQL Editor; not executed by the agent.
-- Scope: enrolment learner 125 / Aptem 92 / transition 1.
-- Archive all 23 learner signoffs without deleting signatures or stored images.
-- Deploy the accompanying signature_owner reader before running this script.
-- Coach signatures, source learning records and finalization history are untouched.
-- Idempotent: rerunning this request never archives the replacement signatures.
BEGIN;
DO $request$
DECLARE
    saved_transition "Audit".learner_transitions%ROWTYPE;
    signature_count integer;
    archive_key constant text := 'otjh-transition:125:resign-archive:20260921-01';
BEGIN
    SELECT * INTO STRICT saved_transition
    FROM "Audit".learner_transitions
    WHERE id=1 AND learner_id=125 AND aptem_id=92
    FOR UPDATE;

    IF NOT EXISTS (SELECT 1 FROM enrolment."Created_users"
                   WHERE id=125 AND ltrim(btrim(aptem_id),'0')='92') THEN
        RAISE EXCEPTION 'Learner identity changed; no changes applied';
    END IF;

    IF EXISTS (SELECT 1 FROM "Audit".monthly_audit_signoffs
               WHERE learner_id='92' AND programme_key=archive_key
                 AND signer_role='learner') THEN
        RAISE NOTICE 'This re-sign request was already applied; no changes made';
        RETURN;
    END IF;

    SELECT count(*) INTO signature_count
    FROM "Audit".monthly_audit_signoffs
    WHERE learner_id='92' AND programme_key='otjh-transition:125'
      AND signer_role='learner' AND audit_version='old-otjh-transition-v1'
      AND review_confirmed IS TRUE AND coalesce(signature_data,'')<>''
      AND saved_transition.required_months ? report_month;
    IF signature_count<>23 OR jsonb_array_length(saved_transition.required_months)<>23 THEN
        RAISE EXCEPTION 'Signature/month snapshot changed; recheck before proceeding';
    END IF;

    -- Keep each original row, id, image reference, signer, signing timestamp,
    -- hash and confirmation. Only move it out of the active signing namespace.
    UPDATE "Audit".monthly_audit_signoffs
    SET programme_key=archive_key
    WHERE learner_id='92' AND programme_key='otjh-transition:125'
      AND signer_role='learner' AND audit_version='old-otjh-transition-v1'
      AND review_confirmed IS TRUE AND coalesce(signature_data,'')<>''
      AND saved_transition.required_months ? report_month;
    GET DIAGNOSTICS signature_count=ROW_COUNT;
    IF signature_count<>23 THEN
        RAISE EXCEPTION 'Concurrent signature change; rolling back';
    END IF;

    UPDATE "Audit".learner_transitions
    SET completed_at=NULL, updated_at=now()
    WHERE id=saved_transition.id;
END;
$request$;
COMMIT;

-- Read-only verification (no image/signature content returned).
-- Immediately after reset: archived=23, active=0, completed=false.
-- After the learner signs again: archived remains 23; active becomes 23.
SELECT count(*) FILTER (WHERE programme_key='otjh-transition:125:resign-archive:20260921-01') AS archived,
       count(*) FILTER (WHERE programme_key='otjh-transition:125') AS active
FROM "Audit".monthly_audit_signoffs
WHERE learner_id='92' AND signer_role='learner'
  AND audit_version='old-otjh-transition-v1'
  AND review_confirmed IS TRUE AND coalesce(signature_data,'')<>''
  AND programme_key IN ('otjh-transition:125', 'otjh-transition:125:resign-archive:20260921-01');
SELECT completed_at IS NOT NULL AS completed
FROM "Audit".learner_transitions WHERE id=1 AND learner_id=125 AND aptem_id=92;
