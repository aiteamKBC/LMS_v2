CREATE TABLE IF NOT EXISTS integrations.company_training_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
 department_id text NOT NULL,
 module_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
 confirmed_by bigint NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT company_training_department_uniq UNIQUE(connection_id, department_id)
);
CREATE TABLE IF NOT EXISTS integrations.company_training_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL REFERENCES integrations.integration_connections(id),
 person_link_id uuid NOT NULL REFERENCES integrations.external_person_links(id),
 module_id text NOT NULL,
 demo_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT company_training_person_module_uniq UNIQUE(person_link_id, module_id)
);
