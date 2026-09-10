-- Programme Review Templates ("Reviews ID" tab).
--
-- Two tables, mirroring the week_templates / week_template_components split:
--   curriculum.review_templates  -- one row per configured Review (Aptem-style
--                                    review template), scoped to a Programme.
--   curriculum.review_fields     -- the Form Builder questions belonging to a
--                                    Review template, ordered by display_order.
--
-- These are Review *templates* only. A future curriculum.learner_review_instances
-- / curriculum.learner_review_answers pair can reference review_templates.id /
-- review_fields.id without touching this file, keeping template configuration
-- and a learner's completed review answers in separate tables.
--
-- Re-runnable: guarded with IF NOT EXISTS throughout, safe to apply more than once.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curriculum;

CREATE TABLE IF NOT EXISTS curriculum.review_templates (
    id                          varchar(128)  PRIMARY KEY,
    programme_id                varchar(255)  NOT NULL,
    name                        varchar(500)  NOT NULL DEFAULT '',
    enabled                     boolean       NOT NULL DEFAULT true,
    recurrence_interval         integer       NOT NULL DEFAULT 1,
    recurrence_unit             varchar(16)   NOT NULL DEFAULT 'weeks',
    applicable_statuses         jsonb         NOT NULL DEFAULT '[]'::jsonb,
    signature_advisor           boolean       NOT NULL DEFAULT false,
    signature_employer          boolean       NOT NULL DEFAULT false,
    signature_participant       boolean       NOT NULL DEFAULT false,
    signature_referrer          boolean       NOT NULL DEFAULT false,
    visible_advisor              boolean       NOT NULL DEFAULT true,
    visible_employer             boolean       NOT NULL DEFAULT true,
    visible_participant          boolean       NOT NULL DEFAULT true,
    visible_referrer             boolean       NOT NULL DEFAULT true,
    record_time_spent           boolean       NOT NULL DEFAULT false,
    allow_editing_prior_days    integer       NOT NULL DEFAULT 0,
    notify_employer              boolean       NOT NULL DEFAULT false,
    notify_participant           boolean       NOT NULL DEFAULT false,
    incomplete_marker           varchar(255)  NOT NULL DEFAULT '',
    field_count                 integer       NOT NULL DEFAULT 0,
    deleted_at                  timestamptz,
    deleted_by                  varchar(255),
    deleted_via_parent          varchar(255),
    created_by                  varchar(255)  NOT NULL DEFAULT '',
    updated_by                  varchar(255)  NOT NULL DEFAULT '',
    created_at                  timestamptz   NOT NULL DEFAULT now(),
    updated_at                  timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT review_templates_recurrence_interval_positive CHECK (recurrence_interval > 0),
    CONSTRAINT review_templates_recurrence_unit_valid CHECK (recurrence_unit IN ('days', 'weeks', 'months')),
    CONSTRAINT review_templates_allow_editing_prior_days_non_negative CHECK (allow_editing_prior_days >= 0)
);

CREATE INDEX IF NOT EXISTS review_templates_programme_id_idx ON curriculum.review_templates (programme_id);
CREATE INDEX IF NOT EXISTS review_templates_enabled_idx ON curriculum.review_templates (enabled);
-- Live (non-archived) rows scoped to a programme is the shape of every list read.
CREATE INDEX IF NOT EXISTS review_templates_programme_live_idx ON curriculum.review_templates (programme_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS curriculum.review_fields (
    id             varchar(128)  PRIMARY KEY,
    review_id      varchar(128)  NOT NULL,
    title          varchar(500)  NOT NULL DEFAULT '',
    field_type     varchar(32)   NOT NULL DEFAULT 'text',
    required       boolean       NOT NULL DEFAULT false,
    display_order  integer       NOT NULL DEFAULT 0,
    configuration  jsonb         NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz   NOT NULL DEFAULT now(),
    updated_at     timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT review_fields_field_type_valid CHECK (field_type IN (
        'text', 'boolean', 'numeric', 'date', 'list_item', 'boolean_case_block',
        'email', 'phone', 'postcode_address', 'title_description', 'text_multiline'
    ))
);

CREATE INDEX IF NOT EXISTS review_fields_review_id_idx ON curriculum.review_fields (review_id);
CREATE INDEX IF NOT EXISTS review_fields_review_id_order_idx ON curriculum.review_fields (review_id, display_order);

COMMIT;
