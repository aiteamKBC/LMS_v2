-- Curriculum version history. Owner-run SQL only; no Django migration.
--
-- Two tables, because "every version" and "every change" are different
-- questions and conflating them is what makes version history unusable:
--
--   record_revisions  every save that actually changed something, with the full
--                     row as it was saved and a field-level diff against the
--                     previous revision. Append-only. This is the history.
--
--   record_versions   the revisions an author named -- a component whose
--                     settings.version went 0.1 -> 0.2, a module that reached
--                     published. A pointer, never a second copy, so a named
--                     version and its content can never drift apart.
--
-- Nothing here is on a write path's critical route: curriculum_api.versioning
-- probes for these tables and silently records nothing when they are absent, so
-- running this SQL turns history on and dropping it turns history off, without
-- either one being able to fail a save.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curriculum;

CREATE TABLE IF NOT EXISTS curriculum.record_revisions (
    id                  bigserial     PRIMARY KEY,
    -- module | week | component. Widened deliberately: programmes, cohorts and
    -- groups join the same table rather than getting tables of their own.
    entity_type         varchar(32)   NOT NULL,
    entity_id           varchar(128)  NOT NULL,
    -- 1, 2, 3 ... per entity. Gapless per entity by construction, so "revision
    -- 4" means the same thing to a person as it does to a query.
    revision_no         integer       NOT NULL,
    action              varchar(16)   NOT NULL,   -- created | updated | archived | restored
    -- Denormalised ancestry so the history of a whole module is one indexed
    -- read rather than a join back to rows that may since have been archived.
    module_catalogue_id varchar(128)  NOT NULL DEFAULT '',
    parent_id           varchar(128)  NOT NULL DEFAULT '',
    title               varchar(500)  NOT NULL DEFAULT '',
    version_label       varchar(32)   NOT NULL DEFAULT '',
    content_status      varchar(64)   NOT NULL DEFAULT '',
    -- The row exactly as it was written, volatile columns stripped.
    snapshot            jsonb         NOT NULL,
    -- [{field, from, to, truncated}] against the previous revision. Empty only
    -- on the first revision of an entity.
    changed_fields      jsonb         NOT NULL DEFAULT '[]'::jsonb,
    actor_email         varchar(255)  NOT NULL DEFAULT '',
    actor_name          varchar(255)  NOT NULL DEFAULT '',
    -- The write handler's reason code on an archive, as deleted_by records it.
    reason              varchar(255)  NOT NULL DEFAULT '',
    created_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT record_revisions_entity_revision_key UNIQUE (entity_type, entity_id, revision_no)
);

-- The three reads this table serves: one entity's timeline, one module's whole
-- history, and the newest changes across everything.
CREATE INDEX IF NOT EXISTS record_revisions_entity_idx
    ON curriculum.record_revisions (entity_type, entity_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS record_revisions_module_idx
    ON curriculum.record_revisions (module_catalogue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS record_revisions_created_idx
    ON curriculum.record_revisions (created_at DESC);

CREATE TABLE IF NOT EXISTS curriculum.record_versions (
    id             bigserial     PRIMARY KEY,
    entity_type    varchar(32)   NOT NULL,
    entity_id      varchar(128)  NOT NULL,
    -- '0.2' for a component; 'v3' for a module, which carries no label of its
    -- own and is numbered by how many times it has been published.
    version_label  varchar(32)   NOT NULL,
    -- The revision this version IS. Cascades: a version cannot outlive the
    -- content it names.
    revision_id    bigint        NOT NULL
                                 REFERENCES curriculum.record_revisions (id) ON DELETE CASCADE,
    content_status varchar(64)   NOT NULL DEFAULT '',
    note           text          NOT NULL DEFAULT '',
    actor_email    varchar(255)  NOT NULL DEFAULT '',
    actor_name     varchar(255)  NOT NULL DEFAULT '',
    created_at     timestamptz   NOT NULL DEFAULT now(),
    -- A label is cut once per entity. Re-saving a component still sitting on
    -- 0.2 must not mint a second 0.2.
    CONSTRAINT record_versions_entity_label_key UNIQUE (entity_type, entity_id, version_label)
);

CREATE INDEX IF NOT EXISTS record_versions_entity_idx
    ON curriculum.record_versions (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS record_versions_revision_idx
    ON curriculum.record_versions (revision_id);

COMMIT;

-- Confirms both tables landed and reports what history already exists.
SELECT 'record_revisions' AS table_name, count(*) AS rows FROM curriculum.record_revisions
UNION ALL
SELECT 'record_versions', count(*) FROM curriculum.record_versions;
