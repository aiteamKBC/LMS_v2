-- Run manually in the Neon SQL Editor. This project does not use migrations
-- for externally managed schemas. Additive and safe to re-run.

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
    CHECK (form_type IN ('general','post_lecture','post_event','event_rsvp'));
END $$;

CREATE TABLE IF NOT EXISTS "Feedback".event_email_templates (
    id bigserial PRIMARY KEY,
    name varchar(255) NOT NULL,
    purpose varchar(30) NOT NULL CHECK (purpose IN ('event_rsvp','post_event')),
    subject varchar(255) NOT NULL,
    body text NOT NULL,
    button_text varchar(120) NOT NULL,
    created_by varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_email_template_name_unique
  ON "Feedback".event_email_templates (purpose, lower(name));

CREATE TABLE IF NOT EXISTS "Feedback".event_email_settings (
    id bigserial PRIMARY KEY,
    event_id bigint NOT NULL REFERENCES "Engagement".events(id) ON DELETE RESTRICT,
    purpose varchar(30) NOT NULL CHECK (purpose IN ('event_rsvp','post_event')),
    template_id bigint NULL REFERENCES "Feedback".event_email_templates(id) ON DELETE SET NULL,
    subject varchar(255) NOT NULL,
    body text NOT NULL,
    button_text varchar(120) NOT NULL,
    updated_by varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, purpose)
);

CREATE TABLE IF NOT EXISTS "Feedback".event_rsvp_campaigns (
    id bigserial PRIMARY KEY,
    event_id bigint NOT NULL UNIQUE REFERENCES "Engagement".events(id) ON DELETE RESTRICT,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
    created_by varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Feedback".event_rsvp_recipients (
    id bigserial PRIMARY KEY,
    campaign_id bigint NOT NULL REFERENCES "Feedback".event_rsvp_campaigns(id) ON DELETE CASCADE,
    recipient_name varchar(255) NOT NULL,
    recipient_email varchar(320) NOT NULL,
    learner_id varchar(100) NOT NULL DEFAULT '',
    token_hash varchar(64) NULL,
    token_expires_at timestamptz NULL,
    invite_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (invite_status IN ('pending','sent','failed')),
    rsvp_status varchar(20) NOT NULL DEFAULT 'no_response' CHECK (rsvp_status IN ('no_response','yes','no','maybe')),
    invitation_sent_at timestamptz NULL,
    invitation_error text NOT NULL DEFAULT '',
    responded_at timestamptz NULL,
    revoked_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_rsvp_recipient_email_unique
  ON "Feedback".event_rsvp_recipients (campaign_id, lower(recipient_email));
CREATE UNIQUE INDEX IF NOT EXISTS event_rsvp_recipient_token_unique
  ON "Feedback".event_rsvp_recipients (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_rsvp_recipient_status
  ON "Feedback".event_rsvp_recipients (campaign_id, rsvp_status, revoked_at);

ALTER TABLE "Feedback".feedback_responses
  ADD COLUMN IF NOT EXISTS rsvp_recipient_id bigint NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'feedback_response_rsvp_recipient_fk'
       AND conrelid = '"Feedback".feedback_responses'::regclass
  ) THEN
    ALTER TABLE "Feedback".feedback_responses
      ADD CONSTRAINT feedback_response_rsvp_recipient_fk
      FOREIGN KEY (rsvp_recipient_id) REFERENCES "Feedback".event_rsvp_recipients(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_rsvp_recipient
  ON "Feedback".feedback_responses (rsvp_recipient_id, form_id)
  WHERE rsvp_recipient_id IS NOT NULL;

DROP INDEX IF EXISTS "Feedback".feedback_response_unique_general;
CREATE UNIQUE INDEX feedback_response_unique_general
  ON "Feedback".feedback_responses (form_id, learner_id)
  WHERE delivery_id IS NULL AND event_recipient_id IS NULL AND rsvp_recipient_id IS NULL;
