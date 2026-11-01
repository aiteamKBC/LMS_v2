-- Manual Neon SQL Editor equivalent of engagement_api migration 0010.
-- Apply before deploying code that reads recipient question overrides.
-- This creates schema only; no questions, assignments or responses change.
-- Manual execution does not record the Django migration as applied.
CREATE TABLE IF NOT EXISTS "Feedback".feedback_delivery_question_overrides (
    id bigserial PRIMARY KEY,
    recipient_id bigint NOT NULL REFERENCES "Feedback".feedback_delivery_recipients(id) ON DELETE RESTRICT,
    original_question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
    replacement_question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
    effective_at timestamptz NOT NULL,
    CONSTRAINT feedback_delivery_question_override_distinct CHECK (original_question_id <> replacement_question_id),
    CONSTRAINT feedback_delivery_question_override_unique UNIQUE (recipient_id, original_question_id)
);

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='Feedback' AND table_name='feedback_delivery_question_overrides'
ORDER BY ordinal_position;
