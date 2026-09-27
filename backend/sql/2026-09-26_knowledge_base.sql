-- Knowledge Base (RAG) schema, V1. Everything lives in schema "knowledge";
-- no existing table is touched. Idempotent: safe to run more than once.
-- Design: LMS_v2 Knowledge Base, version 3.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS knowledge;

-- Programme scopes and books ------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.scopes (
    code          text PRIMARY KEY,                 -- ME, MM, PCP, APM
    name          text NOT NULL,
    standard_refs text[] NOT NULL DEFAULT '{}',     -- e.g. {st0596}
    sort_order    integer NOT NULL DEFAULT 0
);
INSERT INTO knowledge.scopes (code, name, standard_refs, sort_order) VALUES
    ('ME',  'Marketing Executive',           '{st0596}', 1),
    ('MM',  'Marketing Manager',             '{st0612}', 2),
    ('PCP', 'Project Controls Professional', '{st0845}', 3),
    ('APM', 'Associate Project Manager',     '{}',       4)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge.books (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title              text NOT NULL,
    authors            text NOT NULL DEFAULT '',
    status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    current_version_id uuid,
    created_by         text NOT NULL DEFAULT '',
    created_at         timestamptz NOT NULL DEFAULT now(),
    archived_at        timestamptz
);

CREATE TABLE IF NOT EXISTS knowledge.book_scopes (
    book_id    uuid NOT NULL REFERENCES knowledge.books(id) ON DELETE CASCADE,
    scope_code text NOT NULL REFERENCES knowledge.scopes(code),
    PRIMARY KEY (book_id, scope_code)
);

CREATE TABLE IF NOT EXISTS knowledge.book_versions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id         uuid NOT NULL REFERENCES knowledge.books(id) ON DELETE CASCADE,
    edition_label   text NOT NULL DEFAULT '',
    file_sha256     char(64) NOT NULL UNIQUE,
    file_name       text NOT NULL,
    size_bytes      bigint NOT NULL,
    storage_ref     text NOT NULL,                  -- local path or blob:container/name
    page_count      integer,
    active_build_id uuid,
    created_by      text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Processing: builds, jobs, issues ------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.embedding_spaces (
    id         serial PRIMARY KEY,
    provider   text NOT NULL,
    model      text NOT NULL,
    dims       integer NOT NULL CHECK (dims > 0),
    status     text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive', 'active', 'retired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, model, dims)
);
CREATE UNIQUE INDEX IF NOT EXISTS embedding_spaces_one_active
    ON knowledge.embedding_spaces ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS knowledge.builds (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_version_id    uuid NOT NULL REFERENCES knowledge.book_versions(id) ON DELETE CASCADE,
    embedding_space_id integer REFERENCES knowledge.embedding_spaces(id),
    versions           jsonb NOT NULL DEFAULT '{}',  -- extractor, asset_extractor, structure, chunker, ocr, pipeline
    status             text NOT NULL DEFAULT 'building'
                       CHECK (status IN ('building', 'verifying', 'needs_review', 'ready', 'active', 'failed', 'superseded')),
    completeness       jsonb NOT NULL DEFAULT '{}',
    accepted_by        text,
    accepted_at        timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    activated_at       timestamptz
);

CREATE TABLE IF NOT EXISTS knowledge.ingestion_jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    build_id        uuid NOT NULL UNIQUE REFERENCES knowledge.builds(id) ON DELETE CASCADE,
    stage           text NOT NULL DEFAULT 'queued',
    state           text NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued', 'running', 'paused', 'failed', 'complete')),
    attempts        integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 5,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_id        text,
    heartbeat_at    timestamptz,
    progress        jsonb NOT NULL DEFAULT '{}',
    last_error      text NOT NULL DEFAULT '',
    requested_at    timestamptz NOT NULL DEFAULT now(),
    started_at      timestamptz,
    finished_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ingestion_jobs_due ON knowledge.ingestion_jobs (state, next_attempt_at);

CREATE TABLE IF NOT EXISTS knowledge.ingestion_issues (
    id          bigserial PRIMARY KEY,
    build_id    uuid NOT NULL REFERENCES knowledge.builds(id) ON DELETE CASCADE,
    pdf_page    integer,
    stage       text NOT NULL,
    reason      text NOT NULL,
    retriable   boolean NOT NULL DEFAULT true,
    resolved_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.worker_heartbeats (
    worker_id    text PRIMARY KEY,
    host         text NOT NULL DEFAULT '',
    pid          integer,
    version      text NOT NULL DEFAULT '',
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- Content: pages, sections, chunks, vectors ---------------------------------
CREATE TABLE IF NOT EXISTS knowledge.pages (
    book_version_id   uuid NOT NULL REFERENCES knowledge.book_versions(id) ON DELETE CASCADE,
    pdf_page          integer NOT NULL,
    extractor_version text NOT NULL,
    printed_label     text,
    label_verified    boolean NOT NULL DEFAULT false,
    status            text NOT NULL CHECK (status IN ('text', 'ocr', 'blank', 'image_only', 'failed')),
    text              text NOT NULL DEFAULT '',
    blocks            jsonb NOT NULL DEFAULT '[]',
    render_sha256     char(64),
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (book_version_id, pdf_page, extractor_version)
);

CREATE TABLE IF NOT EXISTS knowledge.sections (
    id             bigserial PRIMARY KEY,
    build_id       uuid NOT NULL REFERENCES knowledge.builds(id) ON DELETE CASCADE,
    parent_id      bigint REFERENCES knowledge.sections(id) ON DELETE CASCADE,
    level          smallint NOT NULL,               -- 1 chapter, 2 section, 3 subsection
    ordinal        integer NOT NULL,
    number         text NOT NULL DEFAULT '',
    title          text NOT NULL,
    pdf_page_start integer,
    pdf_page_end   integer,
    UNIQUE (build_id, ordinal)
);

CREATE TABLE IF NOT EXISTS knowledge.chunks (
    id             bigserial PRIMARY KEY,
    build_id       uuid NOT NULL REFERENCES knowledge.builds(id) ON DELETE CASCADE,
    section_id     bigint REFERENCES knowledge.sections(id) ON DELETE CASCADE,
    ordinal        integer NOT NULL,
    kind           text NOT NULL CHECK (kind IN ('text', 'table', 'asset')),
    content        text NOT NULL,
    embed_text     text NOT NULL,
    content_sha256 char(64) NOT NULL,
    token_count    integer NOT NULL,
    pdf_page_start integer,
    pdf_page_end   integer,
    tsv            tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    UNIQUE (build_id, ordinal)
);
CREATE INDEX IF NOT EXISTS chunks_tsv ON knowledge.chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_section ON knowledge.chunks (section_id);

-- Paid work is cached by (content hash, embedding space): never computed twice.
CREATE TABLE IF NOT EXISTS knowledge.embeddings (
    content_sha256     char(64) NOT NULL,
    embedding_space_id integer NOT NULL REFERENCES knowledge.embedding_spaces(id),
    embedding          vector NOT NULL,
    token_count        integer NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (content_sha256, embedding_space_id)
);

-- One vector per chunk per space; an HNSW partial index is created per space
-- when that space is registered (dims are fixed per index).
CREATE TABLE IF NOT EXISTS knowledge.chunk_vectors (
    chunk_id           bigint NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
    embedding_space_id integer NOT NULL REFERENCES knowledge.embedding_spaces(id),
    embedding          vector NOT NULL,
    PRIMARY KEY (chunk_id, embedding_space_id)
);

-- Assets: unique file, its placements, links to chunks ----------------------
CREATE TABLE IF NOT EXISTS knowledge.assets (
    id                 bigserial PRIMARY KEY,
    sha256             char(64) NOT NULL UNIQUE,
    media_type         text NOT NULL,
    width              integer,
    height             integer,
    size_bytes         bigint,
    storage_ref        text NOT NULL,
    manual_description text,
    vision_description text,
    description_status text NOT NULL DEFAULT 'none'
                       CHECK (description_status IN ('none', 'manual', 'vision')),
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.asset_occurrences (
    id           bigserial PRIMARY KEY,
    asset_id     bigint NOT NULL REFERENCES knowledge.assets(id),
    build_id     uuid NOT NULL REFERENCES knowledge.builds(id) ON DELETE CASCADE,
    section_id   bigint REFERENCES knowledge.sections(id) ON DELETE SET NULL,
    pdf_page     integer NOT NULL,
    bbox         real[4],
    kind         text NOT NULL CHECK (kind IN ('raster', 'vector_region', 'table_snapshot', 'page_preview')),
    book_caption text,
    label_text   text,
    decorative   boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS asset_occurrences_build_page ON knowledge.asset_occurrences (build_id, pdf_page);

CREATE TABLE IF NOT EXISTS knowledge.chunk_assets (
    chunk_id      bigint NOT NULL REFERENCES knowledge.chunks(id) ON DELETE CASCADE,
    occurrence_id bigint NOT NULL REFERENCES knowledge.asset_occurrences(id) ON DELETE CASCADE,
    relation      text NOT NULL CHECK (relation IN ('same_page', 'referenced', 'asset_chunk')),
    PRIMARY KEY (chunk_id, occurrence_id)
);

-- Curriculum mapping ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.curriculum_links (
    id                  bigserial PRIMARY KEY,
    section_id          bigint NOT NULL REFERENCES knowledge.sections(id) ON DELETE CASCADE,
    module_catalogue_id text NOT NULL,
    week_id             text,
    status              text NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected')),
    score               real,
    confirmed_by        text,
    confirmed_at        timestamptz
);

-- Cost: hard budget, reservations, actual usage -----------------------------
CREATE TABLE IF NOT EXISTS knowledge.ai_budget_periods (
    period_type  text NOT NULL CHECK (period_type IN ('day', 'month')),
    period_start date NOT NULL,
    limit_usd    numeric(12, 4) NOT NULL DEFAULT 0,
    reserved_usd numeric(12, 4) NOT NULL DEFAULT 0,
    spent_usd    numeric(12, 4) NOT NULL DEFAULT 0,
    PRIMARY KEY (period_type, period_start)
);

CREATE TABLE IF NOT EXISTS knowledge.ai_reservations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    day_start    date NOT NULL,
    month_start  date NOT NULL,
    estimate_usd numeric(12, 6) NOT NULL,
    status       text NOT NULL DEFAULT 'reserved'
                 CHECK (status IN ('reserved', 'settled', 'released', 'expired')),
    operation    text NOT NULL,
    ref          text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge.ai_usage (
    id                  bigserial PRIMARY KEY,
    reservation_id      uuid REFERENCES knowledge.ai_reservations(id),
    feature             text NOT NULL,
    operation           text NOT NULL,
    model               text NOT NULL,
    input_tokens        integer NOT NULL DEFAULT 0,
    cached_input_tokens integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cost_usd            numeric(12, 6) NOT NULL DEFAULT 0,
    price_version       text NOT NULL DEFAULT '',
    ref                 text NOT NULL DEFAULT '',
    created_by          text NOT NULL DEFAULT '',
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Generation provenance -------------------------------------------------------
CREATE TABLE IF NOT EXISTS knowledge.generation_log (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by            text NOT NULL DEFAULT '',
    created_at            timestamptz NOT NULL DEFAULT now(),
    mode                  text NOT NULL,
    question_count        integer NOT NULL,
    request               jsonb NOT NULL DEFAULT '{}',
    coverage_plan         jsonb NOT NULL DEFAULT '{}',
    kb_tokens             integer NOT NULL DEFAULT 0,
    ceiling_tokens        integer NOT NULL DEFAULT 0,
    counterfactual_tokens integer,
    usage_id              bigint REFERENCES knowledge.ai_usage(id)
);

CREATE TABLE IF NOT EXISTS knowledge.generation_sources (
    generation_id uuid NOT NULL REFERENCES knowledge.generation_log(id) ON DELETE CASCADE,
    block_index   integer NOT NULL,
    position      integer NOT NULL,
    chunk_id      bigint NOT NULL REFERENCES knowledge.chunks(id),
    build_id      uuid NOT NULL REFERENCES knowledge.builds(id),
    token_count   integer NOT NULL,
    PRIMARY KEY (generation_id, block_index, position)
);

CREATE TABLE IF NOT EXISTS knowledge.generation_question_sources (
    generation_id   uuid NOT NULL REFERENCES knowledge.generation_log(id) ON DELETE CASCADE,
    question_index  integer NOT NULL,
    question_sha256 char(64) NOT NULL,
    chunk_id        bigint REFERENCES knowledge.chunks(id),
    confidence      real,
    method          text NOT NULL,
    PRIMARY KEY (generation_id, question_index)
);
