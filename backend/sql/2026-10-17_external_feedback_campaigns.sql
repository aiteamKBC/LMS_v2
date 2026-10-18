-- Independent public feedback campaigns for non-LMS recipients.
-- Additive and safe to re-run. Apply through the reviewed deployment process.
CREATE SCHEMA IF NOT EXISTS "Feedback";

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'Feedback' AND t.relname = 'feedback_forms'
       AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  ALTER TABLE "Feedback".feedback_forms
    ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN (
      'general','post_lecture','post_event','event_rsvp',
      'information_session','commitment_meeting'
    ));
END $$;

CREATE TABLE IF NOT EXISTS "Feedback".feedback_external_campaigns (
    id bigserial PRIMARY KEY,
    campaign_type varchar(40) NOT NULL CHECK (campaign_type IN ('information_session','commitment_meeting')),
    name varchar(255) NOT NULL,
    session_date date NOT NULL,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
    created_by varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Feedback".feedback_external_recipients (
    id bigserial PRIMARY KEY,
    campaign_id bigint NOT NULL REFERENCES "Feedback".feedback_external_campaigns(id) ON DELETE CASCADE,
    response_id bigint NULL,
    recipient_name varchar(255) NOT NULL,
    recipient_email varchar(320) NOT NULL,
    token_hash varchar(64) NULL,
    token_expires_at timestamptz NULL,
    delivery_status varchar(20) NOT NULL DEFAULT 'pending'
      CHECK (delivery_status IN ('pending','sent','opened','submitted','failed')),
    invitation_sent_at timestamptz NULL,
    opened_at timestamptz NULL,
    submitted_at timestamptz NULL,
    invitation_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "Feedback".feedback_external_recipients
  ADD COLUMN IF NOT EXISTS response_id bigint NULL;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_external_recipient_email_unique
  ON "Feedback".feedback_external_recipients (campaign_id, lower(recipient_email));
CREATE UNIQUE INDEX IF NOT EXISTS feedback_external_recipient_token_unique
  ON "Feedback".feedback_external_recipients (token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_external_recipient_response_unique
  ON "Feedback".feedback_external_recipients (response_id) WHERE response_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feedback_external_campaign_type_date
  ON "Feedback".feedback_external_campaigns (campaign_type, session_date DESC);
CREATE INDEX IF NOT EXISTS feedback_external_recipient_status
  ON "Feedback".feedback_external_recipients (campaign_id, delivery_status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feedback_external_recipient_response_fk'
      AND conrelid = '"Feedback".feedback_external_recipients'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_external_recipients
      ADD CONSTRAINT feedback_external_recipient_response_fk
      FOREIGN KEY (response_id)
      REFERENCES "Feedback".feedback_responses(id) ON DELETE RESTRICT;
  END IF;
END $$;
