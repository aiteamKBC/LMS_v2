-- Durable user reviews; never part of a rebuildable session-cache table.
CREATE SCHEMA IF NOT EXISTS lms_quality;
CREATE TABLE IF NOT EXISTS lms_quality.review (
  id uuid PRIMARY KEY,
  identity varchar(64) NOT NULL UNIQUE,
  coach_email text NOT NULL,
  learner_id text NOT NULL,
  learner_name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  status text NOT NULL CHECK (status IN ('draft','completed')),
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS lms_quality_review_calendar ON lms_quality.review (starts_at DESC, id);
CREATE INDEX IF NOT EXISTS lms_quality_review_coach ON lms_quality.review (coach_email, starts_at DESC);
CREATE TABLE IF NOT EXISTS lms_quality.revision (
  review_id uuid NOT NULL REFERENCES lms_quality.review(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  request_hash varchar(64) NOT NULL,
  actor text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id,version)
);
CREATE TABLE IF NOT EXISTS lms_quality.image (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES lms_quality.review(id) ON DELETE RESTRICT,
  section text NOT NULL,
  digest varchar(64) NOT NULL,
  filename text NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_id,section,digest)
);
COMMENT ON SCHEMA lms_quality IS 'LMS-owned quality reviews, shared read source for Coaching Session. Preserve review and revision history.';
