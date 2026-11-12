CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS integrations;

CREATE TABLE IF NOT EXISTS integrations.integration_tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_key text NOT NULL UNIQUE,
    display_name text NOT NULL,
    tenant_kind text NOT NULL DEFAULT 'employer',
    employer_id bigint,
    retention_anchor date,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations.integration_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    provider text NOT NULL DEFAULT 'breathe',
    external_account_id text NOT NULL,
    secret_ref text NOT NULL,
    base_url text NOT NULL DEFAULT 'https://api.sandbox.breathehr.info',
    status text NOT NULL DEFAULT 'pending',
    enabled_features jsonb NOT NULL DEFAULT '[]'::jsonb,
    last_verified_at timestamptz,
    last_sync_at timestamptz,
    last_error text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS integrations.external_person_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    external_employee_id text NOT NULL,
    external_email text NOT NULL DEFAULT '',
    display_name text NOT NULL DEFAULT '',
    job_title text NOT NULL DEFAULT '',
    department_external_id text NOT NULL DEFAULT '',
    department_name text NOT NULL DEFAULT '',
    manager_external_id text NOT NULL DEFAULT '',
    employment_status text NOT NULL DEFAULT '',
    employment_start_date date,
    contracted_hours numeric(7,2),
    working_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
    lms_account_id bigint,
    mapping_status text NOT NULL DEFAULT 'pending',
    last_seen_at timestamptz,
    source_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_employee_id)
);

CREATE TABLE IF NOT EXISTS integrations.department_mappings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    external_department_id text NOT NULL,
    external_name text NOT NULL DEFAULT '',
    lms_department_id bigint,
    status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_department_id)
);

CREATE TABLE IF NOT EXISTS integrations.manager_relationships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    employee_link_id uuid NOT NULL REFERENCES integrations.external_person_links(id),
    manager_external_id text NOT NULL,
    effective_from date,
    effective_to date,
    verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations.manager_signatory_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    login_account_id bigint NOT NULL,
    external_manager_id text NOT NULL DEFAULT '',
    granted_by bigint,
    can_sign boolean NOT NULL DEFAULT false,
    starts_at timestamptz,
    ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integrations.availability_blocks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    external_person_id text NOT NULL,
    block_type text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    timezone text NOT NULL DEFAULT 'Europe/London',
    reason_category text NOT NULL DEFAULT '',
    source_ref text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, source_ref)
);

CREATE TABLE IF NOT EXISTS integrations.scheduling_conflicts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    external_person_id text NOT NULL,
    session_ref text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    block_id uuid,
    status text NOT NULL DEFAULT 'pending',
    proposed_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, session_ref)
);

CREATE TABLE IF NOT EXISTS integrations.external_training_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    external_training_id text NOT NULL,
    external_employee_id text NOT NULL,
    title text NOT NULL DEFAULT '',
    category text NOT NULL DEFAULT '',
    completion_date date,
    status text NOT NULL DEFAULT '',
    certificate_ref text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, external_training_id)
);

CREATE TABLE IF NOT EXISTS integrations.integration_sync_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
    resources jsonb NOT NULL DEFAULT '[]'::jsonb,
    dry_run boolean NOT NULL DEFAULT false,
    idempotency_key text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    counts jsonb NOT NULL DEFAULT '{}'::jsonb,
    cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text NOT NULL DEFAULT '',
    error_message text NOT NULL DEFAULT '',
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(connection_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS integrations.integration_audit_logs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES integrations.integration_tenants(id),
    actor_type text NOT NULL,
    actor_id bigint,
    action text NOT NULL,
    resource_ref text NOT NULL DEFAULT '',
    outcome text NOT NULL DEFAULT 'success',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integrations_person_links_tenant_idx ON integrations.external_person_links (tenant_id, mapping_status);
CREATE INDEX IF NOT EXISTS integrations_availability_tenant_time_idx ON integrations.availability_blocks (tenant_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS integrations_conflicts_tenant_status_idx ON integrations.scheduling_conflicts (tenant_id, status);
CREATE INDEX IF NOT EXISTS integrations_sync_runs_tenant_created_idx ON integrations.integration_sync_runs (tenant_id, created_at DESC);
