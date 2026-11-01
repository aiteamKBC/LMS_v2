-- Manual Neon SQL Editor equivalent of engagement_api migration 0009.
-- Apply before deploying code that reads FeedbackDelivery.tutor_name.
-- Existing deliveries keep an empty name: the historical tutor is unknown.
-- Manual execution does not record the Django migration as applied.
ALTER TABLE "Feedback".feedback_deliveries
  ADD COLUMN IF NOT EXISTS tutor_name varchar(255) NOT NULL DEFAULT '';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='Feedback' AND table_name='feedback_deliveries'
  AND column_name='tutor_name';
