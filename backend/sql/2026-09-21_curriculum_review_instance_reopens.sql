-- Persists ONLY an authorised "completed / awaiting-signature -> in-progress"
-- reopen of a Review Instance (see
-- curriculum_api.review_instances.reopen_review_instance_for_editing).
--
-- Deliberately NOT folded into curriculum.review_instance_manual_overrides:
-- that table's contract is explicit and narrow -- one row per manual
-- scheduled -> in-progress override, and nothing else (see
-- sql/2026-09-15_curriculum_review_instance_manual_overrides.sql). A reopen is
-- a different lifecycle event with a different entry status, a different
-- reason-code vocabulary and an extra payload, so it gets its own table rather
-- than widening -- and falsifying -- that one's documented meaning.
--
-- Append-only: one row per reopen, inserted in the same transaction as the
-- review_instances status UPDATE and the signature clear-down it records, and
-- only when that transition actually succeeds. A rejected attempt (wrong
-- status, bad reason code, lost race) never writes a row.
--
-- Run against Neon directly -- see backend/sql conventions.
BEGIN;

CREATE TABLE IF NOT EXISTS curriculum.review_instance_reopens (
    id varchar(128) PRIMARY KEY,
    review_instance_id varchar(128) NOT NULL,
    calendar_event_id integer,
    previous_status varchar(32) NOT NULL,
    new_status varchar(32) NOT NULL,
    reason_code varchar(64) NOT NULL,
    note text NOT NULL DEFAULT '',
    changed_by varchar(255) NOT NULL,
    changed_at timestamp NOT NULL DEFAULT current_timestamp,
    -- The frozen answers + signatures captured at the moment of the reopen.
    previous_state_snapshot jsonb
);

COMMENT ON COLUMN curriculum.review_instance_reopens.previous_state_snapshot IS
    'Frozen copy of this Review Instance''s answers and signatures as they '
    'stood immediately before the reopen that this row records, plus the '
    'status/started_at/completed_at it was reopened from. Written once, in '
    'the same transaction as the reopen, and never updated afterwards. This '
    'is the ONLY surviving record of the cleared signatures: reopening blanks '
    'signed_by/signed_name/signature/signed_at on '
    'curriculum.review_instance_signatures in place, so the signature images '
    'captured here (full base64 data URIs) cannot be recovered from anywhere '
    'else. Audit/evidence only -- nothing reads this back into the live '
    'review, and no code path may restore from it.';

CREATE INDEX IF NOT EXISTS review_instance_reopens_instance_idx
    ON curriculum.review_instance_reopens (review_instance_id, changed_at DESC);

COMMIT;

-- Read-only verification (expects the ten columns above):
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'curriculum'
--      AND table_name = 'review_instance_reopens'
--    ORDER BY ordinal_position;
