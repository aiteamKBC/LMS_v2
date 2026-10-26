-- Additive quality form versions and durable completed PDF attachments.
CREATE TABLE IF NOT EXISTS lms_quality.form_template (
  id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS lms_quality.form_revision (
  template_id text NOT NULL REFERENCES lms_quality.form_template(id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  request_hash varchar(64) NOT NULL,
  actor text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (template_id, revision)
);
CREATE TABLE IF NOT EXISTS lms_quality.document (
  review_id uuid NOT NULL,
  version integer NOT NULL,
  filename text NOT NULL,
  digest varchar(64) NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) <= 20971520),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id,version),
  FOREIGN KEY (review_id,version) REFERENCES lms_quality.revision(review_id,version) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS lms_quality_review_event ON lms_quality.review
  (coach_email, (payload->'meeting'->>'eventId'), starts_at);
CREATE INDEX IF NOT EXISTS lms_quality_review_locator ON lms_quality.review
  ((payload->'meeting'->>'id'));
