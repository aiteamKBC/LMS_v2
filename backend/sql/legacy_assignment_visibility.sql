-- Additive registry for explicitly reviewed historical assignment uploads.
-- Apply on the verified enrolment database after recording a restore point.
-- No source evidence, grades, hours, completion or native submissions change.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS "Learner".legacy_assignment_visibility (
    enrolment_id bigint NOT NULL REFERENCES enrolment."Created_users"(id),
    aptem_id bigint NOT NULL,
    evidence_id bigint NOT NULL,
    component_id bigint NOT NULL,
    restored_by text NOT NULL,
    restored_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reason text NOT NULL,
    source_fingerprint text NOT NULL,
    revoked_at timestamptz,
    PRIMARY KEY (enrolment_id, aptem_id, evidence_id)
);
COMMIT;
-- Roll back a restore by setting revoked_at on that exact reviewed selection.
-- Keep the registry and its provenance; the original uploads remain intact.
