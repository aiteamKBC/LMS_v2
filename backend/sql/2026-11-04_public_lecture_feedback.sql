-- Manual Neon SQL Editor equivalent of engagement_api migration 0011.
-- Apply before deploying the public lecture QR code. No existing rows change.
-- Manual execution does not record the Django migration as applied.
ALTER TABLE "Feedback".feedback_delivery_recipients
  ADD COLUMN IF NOT EXISTS public_claimed_at timestamptz NULL;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'Feedback' AND table_name = 'feedback_delivery_recipients'
  AND column_name = 'public_claimed_at';
