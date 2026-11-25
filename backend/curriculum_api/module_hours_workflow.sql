CREATE TABLE IF NOT EXISTS curriculum.module_hours_defaults (
    id uuid PRIMARY KEY,
    module_id text UNIQUE REFERENCES curriculum.modules(module_catalogue_id) ON DELETE SET NULL,
    module_key text NOT NULL,
    target_minutes integer CHECK (target_minutes > 0),
    revision integer NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS curriculum.module_hours_operations (
    id uuid PRIMARY KEY,
    actor_id bigint REFERENCES login."Login_accounts"(id) ON DELETE SET NULL,
    actor_key bigint NOT NULL,
    idempotency_key uuid NOT NULL,
    preview_nonce uuid NOT NULL,
    intent_hash text NOT NULL,
    outcome text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (actor_key, idempotency_key),
    UNIQUE (actor_key, preview_nonce)
);
CREATE INDEX IF NOT EXISTS module_hours_operations_actor_time
    ON curriculum.module_hours_operations(actor_key, created_at DESC, id);
CREATE TABLE IF NOT EXISTS curriculum.module_hours_operation_items (
    operation_id uuid NOT NULL REFERENCES curriculum.module_hours_operations(id) ON DELETE RESTRICT,
    module_key text NOT NULL,
    outcome text NOT NULL,
    PRIMARY KEY (operation_id, module_key)
);
CREATE INDEX IF NOT EXISTS module_hours_items_module
    ON curriculum.module_hours_operation_items(module_key, operation_id);
CREATE TABLE IF NOT EXISTS curriculum.module_hours_default_revisions (
    default_id uuid NOT NULL REFERENCES curriculum.module_hours_defaults(id) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision > 0),
    operation_id uuid NOT NULL REFERENCES curriculum.module_hours_operations(id) ON DELETE RESTRICT,
    before_value text NOT NULL,
    after_value text NOT NULL,
    PRIMARY KEY (default_id, revision)
);
