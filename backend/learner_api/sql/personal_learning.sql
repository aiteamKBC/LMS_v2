-- Explicit installation script. No migrations or runtime DDL.
-- Adds isolated personal study records; does not alter official learner records.
BEGIN;
CREATE TABLE IF NOT EXISTS "Learner".personal_course_enrolments (
    account_id bigint NOT NULL REFERENCES login."Login_accounts"(id),
    module_id text NOT NULL,
    progress jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(progress) = 'array'),
    submissions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(submissions) = 'object'),
    evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, module_id)
);
CREATE TABLE IF NOT EXISTS "Learner".personal_course_certificates (
    id bigserial PRIMARY KEY,
    account_id bigint NOT NULL,
    module_id text NOT NULL,
    template_id bigint NOT NULL,
    template_version integer NOT NULL,
    token uuid NOT NULL UNIQUE,
    certificate jsonb NOT NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id, module_id) REFERENCES "Learner".personal_course_enrolments(account_id,module_id),
    UNIQUE (account_id,module_id,template_id,template_version)
);
COMMIT;

-- Read-only verification (does not expose account or learner data):
SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'Learner'
  AND table_name IN ('personal_course_enrolments', 'personal_course_certificates')
ORDER BY table_name, ordinal_position;
