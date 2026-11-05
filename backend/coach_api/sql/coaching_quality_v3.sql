-- Original evidence files are immutable; revisions only reference their IDs.
CREATE TABLE IF NOT EXISTS lms_quality.evidence_file (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES lms_quality.review(id) ON DELETE RESTRICT,
  section text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 26214400),
  digest varchar(64) NOT NULL,
  content bytea NOT NULL CHECK (octet_length(content) = size),
  preview bytea CHECK (preview IS NULL OR octet_length(preview) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (review_id, section, digest)
);
CREATE INDEX IF NOT EXISTS lms_quality_evidence_review ON lms_quality.evidence_file(review_id);
