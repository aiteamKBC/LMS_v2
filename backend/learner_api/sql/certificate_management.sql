-- Run manually in Neon SQL Editor. This project does not use migrations.
CREATE TABLE IF NOT EXISTS "Learner".certificate_templates (
    id bigserial PRIMARY KEY,
    name varchar(160) NOT NULL,
    certificate_type varchar(40) NOT NULL DEFAULT 'progress-achievement',
    version integer NOT NULL DEFAULT 1,
    status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
    title varchar(200) NOT NULL DEFAULT 'Certificate of Progress Achievement',
    body_text text NOT NULL DEFAULT 'This certificate recognises the learner''s progress and achievement.',
    minimum_progress numeric(5,2) NOT NULL DEFAULT 85 CHECK (minimum_progress BETWEEN 0 AND 100),
    require_final_test boolean NOT NULL DEFAULT false,
    programme_names jsonb NOT NULL DEFAULT '[]'::jsonb,
    layout_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by varchar(255) NOT NULL DEFAULT '',
    published_by varchar(255) NOT NULL DEFAULT '',
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (certificate_type, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS certificate_one_published_per_type
ON "Learner".certificate_templates (certificate_type)
WHERE status = 'published';

CREATE TABLE IF NOT EXISTS "Learner".certificate_template_assets (
    id bigserial PRIMARY KEY,
    template_id bigint NOT NULL REFERENCES "Learner".certificate_templates(id) ON DELETE CASCADE,
    asset_type varchar(30) NOT NULL CHECK (asset_type IN ('logo','background','seal','signature')),
    blob_url text NOT NULL,
    file_name varchar(255) NOT NULL DEFAULT '',
    content_type varchar(120) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (template_id, asset_type)
);

CREATE TABLE IF NOT EXISTS "Learner".learner_certificates (
    id bigserial PRIMARY KEY,
    certificate_number varchar(80) NOT NULL UNIQUE,
    learner_kind varchar(30) NOT NULL CHECK (learner_kind IN ('apprenticeship','commercial')),
    learner_id bigint NOT NULL,
    template_id bigint NOT NULL REFERENCES "Learner".certificate_templates(id),
    template_version integer NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','revoked','superseded')),
    progress_percent numeric(5,2) NOT NULL,
    snapshot jsonb NOT NULL,
    pdf_blob_url text NOT NULL DEFAULT '',
    verification_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    issued_by varchar(255) NOT NULL DEFAULT 'system',
    issued_at timestamptz NOT NULL DEFAULT now(),
    revoked_by varchar(255) NOT NULL DEFAULT '',
    revoked_at timestamptz,
    revoke_reason text NOT NULL DEFAULT '',
    UNIQUE (learner_kind, learner_id, template_id, template_version)
);

CREATE INDEX IF NOT EXISTS learner_certificates_learner_idx
ON "Learner".learner_certificates (learner_kind, learner_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS "Learner".certificate_audit_logs (
    id bigserial PRIMARY KEY,
    actor_email varchar(255) NOT NULL,
    action varchar(50) NOT NULL,
    template_id bigint REFERENCES "Learner".certificate_templates(id),
    certificate_id bigint REFERENCES "Learner".learner_certificates(id),
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
