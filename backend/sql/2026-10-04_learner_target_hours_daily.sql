-- Daily, auditable snapshot of the coach-caseload target-hours formula.
-- This table is deliberately separate from Learner.learners.target_hours:
-- that legacy field is consumed by OTJH risk/progress projections and is not
-- a safe place to overwrite a coach-facing as-of-today calculation.

CREATE TABLE IF NOT EXISTS "Learner"."learner_target_hours_daily" (
    learner_id       bigint NOT NULL,
    enrolment_id     bigint,
    aptem_id         bigint,
    coach_email      text,
    as_of_date       date NOT NULL,
    planned_hours    numeric(12, 2),
    start_date       date,
    planned_end_date date,
    elapsed_days     integer,
    programme_days   integer,
    target_hours     numeric(12, 2),
    status           text NOT NULL,
    status_reason    text NOT NULL,
    formula_version  text NOT NULL DEFAULT 'target_hours_v1',
    calculation_method text NOT NULL DEFAULT 'clamp(planned_hours * elapsed_days / programme_days, 0, planned_hours)',
    source_system    text NOT NULL DEFAULT 'coach_caseload_schedule',
    source_reference text NOT NULL,
    calculated_by    text NOT NULL DEFAULT 'system:target-hours-v1',
    calculated_at    timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT learner_target_hours_daily_pk
        PRIMARY KEY (learner_id, as_of_date),
    CONSTRAINT learner_target_hours_daily_status_ck
        CHECK (status IN ('FORMULA_READY', 'STATUS_OVERRIDE', 'NEEDS_REVIEW')),
    CONSTRAINT learner_target_hours_daily_target_ck
        CHECK (target_hours IS NULL OR target_hours >= 0)
);

ALTER TABLE "Learner"."learner_target_hours_daily"
    ADD COLUMN IF NOT EXISTS elapsed_days integer,
    ADD COLUMN IF NOT EXISTS programme_days integer,
    ADD COLUMN IF NOT EXISTS calculation_method text NOT NULL
        DEFAULT 'clamp(planned_hours * elapsed_days / programme_days, 0, planned_hours)';

CREATE INDEX IF NOT EXISTS learner_target_hours_daily_coach_date_idx
    ON "Learner"."learner_target_hours_daily" (coach_email, as_of_date);

CREATE INDEX IF NOT EXISTS learner_target_hours_daily_status_date_idx
    ON "Learner"."learner_target_hours_daily" (status, as_of_date);

COMMENT ON TABLE "Learner"."learner_target_hours_daily" IS
    'As-of-date target-hours snapshots for coach caseloads. Formula version: target_hours_v1.';

COMMENT ON COLUMN "Learner"."learner_target_hours_daily".target_hours IS
    'planned_hours * elapsed_days / programme_days, clamped to 0..planned_hours. NULL for status overrides or unresolved inputs.';

COMMENT ON COLUMN "Learner"."learner_target_hours_daily".status_reason IS
    'Machine-readable reason for the row status. No inferred hours are stored for NEEDS_REVIEW.';

-- Stable database-side implementation of the same coach-facing formula used
-- for the snapshot.  A SQL function is used so every consumer can call one
-- authoritative rule rather than copying arithmetic into application code.
CREATE OR REPLACE FUNCTION "Learner".target_hours_as_of(
    p_planned_hours numeric,
    p_start_date date,
    p_planned_end_date date,
    p_as_of_date date DEFAULT CURRENT_DATE
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
    SELECT CASE
        WHEN p_planned_hours IS NULL OR p_planned_hours <= 0
          OR p_start_date IS NULL OR p_planned_end_date IS NULL
          OR p_planned_end_date <= p_start_date
            THEN NULL::numeric
        WHEN p_as_of_date < p_start_date
            THEN 0.00::numeric
        WHEN p_as_of_date >= p_planned_end_date
            THEN round(p_planned_hours, 2)
        ELSE round(
            least(
                p_planned_hours,
                greatest(
                    0.00::numeric,
                    (p_planned_hours * (p_as_of_date - p_start_date)::numeric)
                    / (p_planned_end_date - p_start_date)::numeric
                )
            ),
            2
        )
    END
$function$;

CREATE OR REPLACE FUNCTION "Learner".target_hours_safe_date(value text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN NULLIF(btrim(value), '') IS NULL THEN NULL::date
        WHEN btrim(value) ~ '^\d{4}-\d{2}-\d{2}'
            THEN substring(btrim(value), 1, 10)::date
        WHEN btrim(value) ~ '^\d{2}/\d{2}/\d{4}$'
            THEN to_date(btrim(value), 'DD/MM/YYYY')
        WHEN btrim(value) ~ '^\d{2}-\d{2}-\d{4}$'
            THEN to_date(btrim(value), 'DD-MM-YYYY')
        ELSE NULL::date
    END
$function$;

CREATE OR REPLACE FUNCTION "Learner".target_hours_safe_numeric(value text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE
        WHEN NULLIF(btrim(value), '') IS NULL THEN NULL::numeric
        WHEN btrim(value) ~ '^[+-]?\d+(\.\d+)?$'
            THEN btrim(value)::numeric
        ELSE NULL::numeric
    END
$function$;

-- Current view: schedule inputs are resolved live from the learner mirror,
-- Created_users and the latest active training-plan contract.  The latest
-- snapshot is only a fallback for values that exist solely in a read-only
-- external extract.  The target itself is recalculated on every SELECT.
CREATE OR REPLACE VIEW "Learner"."learner_target_hours_current" AS
WITH latest AS (
    SELECT DISTINCT ON (learner_id)
        learner_id,
        enrolment_id,
        aptem_id,
        coach_email,
        planned_hours,
        start_date,
        planned_end_date,
        status,
        status_reason,
        formula_version,
        calculation_method,
        source_system,
        source_reference,
        calculated_by,
        calculated_at,
        updated_at,
        as_of_date AS snapshot_date,
        target_hours AS snapshot_target_hours
    FROM "Learner"."learner_target_hours_daily"
    ORDER BY learner_id, as_of_date DESC
), base AS (
    SELECT
        l.id AS learner_id,
        l.enrolment_id,
        l.aptem_id AS profile_aptem_id,
        l.coach_email::text AS coach_email,
        l.programme_status,
        l.lifecycle_status,
        l.planned_hours AS profile_planned_hours,
        l.start_date AS profile_start_date,
        l.end_date AS profile_end_date,
        l."Learner_Start_date" AS profile_learner_start_date,
        l."Learner_end_date" AS profile_learner_end_date,
        cu.aptem_id AS source_aptem_id,
        cu."Planned_hours" AS source_planned_hours,
        cu."Start_date" AS source_start_date,
        cu."End_date" AS source_end_date,
        cu."Learner_start_date" AS source_learner_start_date,
        cu."Learner_end_date" AS source_learner_end_date,
        cu."Apprenticeship_End_date" AS source_apprenticeship_end_date,
        cu."Practical_period_end_date" AS source_practical_end_date,
        d.aptem_id AS snapshot_aptem_id,
        d.planned_hours AS snapshot_planned_hours,
        d.start_date AS snapshot_start_date,
        d.planned_end_date AS snapshot_end_date,
        d.snapshot_date,
        d.snapshot_target_hours,
        d.formula_version,
        d.calculation_method,
        d.calculated_by,
        d.calculated_at,
        d.updated_at,
        ct.training_plan_planned_hours AS contract_training_plan_hours,
        ct.planned AS contract_planned_hours,
        ct.program_start_date::date AS contract_start_date,
        ct.planned_end_date::date AS contract_end_date
    FROM "Learner".learners l
    LEFT JOIN latest d ON d.learner_id = l.id
    LEFT JOIN enrolment."Created_users" cu ON cu.id = l.enrolment_id
    LEFT JOIN LATERAL (
        SELECT
            c.training_plan_planned_hours,
            c.planned,
            c.program_start_date,
            c.planned_end_date
        FROM fetching_evidence.aptem_cv_contracts_probe c
        LEFT JOIN "Audit".contract_document_archive a
          ON a.contract_id = c.id
        WHERE c.learner_id = CASE
            WHEN coalesce(NULLIF(l.aptem_id::text, ''), NULLIF(cu.aptem_id, '')) ~ '^[0-9]+$'
                THEN coalesce(NULLIF(l.aptem_id::text, ''), NULLIF(cu.aptem_id, ''))::bigint
            ELSE NULL::bigint
        END
          AND lower(coalesce(nullif(a.display_name, ''), c.document_name))
              ~ 'training[[:space:]_-]*plan'
          AND a.archived_at IS NULL
          AND a.deleted_at IS NULL
        ORDER BY coalesce(c.fully_signed_date, c.date) DESC NULLS LAST, c.id DESC
        LIMIT 1
    ) ct ON TRUE
), resolved AS (
    SELECT
        b.*,
        coalesce(
            b.contract_training_plan_hours,
            b.contract_planned_hours,
            "Learner".target_hours_safe_numeric(b.source_planned_hours),
            b.profile_planned_hours,
            b.snapshot_planned_hours
        ) AS resolved_planned_hours,
        coalesce(
            b.contract_start_date,
            "Learner".target_hours_safe_date(b.source_start_date),
            "Learner".target_hours_safe_date(b.source_learner_start_date),
            b.profile_start_date,
            "Learner".target_hours_safe_date(b.profile_learner_start_date),
            b.snapshot_start_date
        ) AS resolved_start_date,
        coalesce(
            b.contract_end_date,
            "Learner".target_hours_safe_date(b.source_end_date),
            "Learner".target_hours_safe_date(b.source_learner_end_date),
            "Learner".target_hours_safe_date(b.source_apprenticeship_end_date),
            "Learner".target_hours_safe_date(b.source_practical_end_date),
            b.profile_end_date,
            "Learner".target_hours_safe_date(b.profile_learner_end_date),
            b.snapshot_end_date
        ) AS resolved_end_date,
        lower(replace(replace(replace(
            btrim(coalesce(nullif(b.programme_status, ''), nullif(b.lifecycle_status, ''))),
            ' ', ''), '_', ''), '-', '')) AS status_norm
    FROM base b
), classified AS (
    SELECT
        r.*,
        CASE
            WHEN r.status_norm = 'withdrawn'
              OR r.status_norm LIKE 'onboarding%'
                THEN 'STATUS_OVERRIDE'
            WHEN r.status_norm IN ('delivery', 'active', 'onbreak')
             AND r.resolved_planned_hours > 0
             AND r.resolved_start_date IS NOT NULL
             AND r.resolved_end_date IS NOT NULL
             AND r.resolved_end_date > r.resolved_start_date
                THEN 'FORMULA_READY'
            ELSE 'NEEDS_REVIEW'
        END AS resolved_status
    FROM resolved r
)
SELECT
    learner_id,
    enrolment_id,
    CASE
        WHEN coalesce(NULLIF(profile_aptem_id::text, ''), NULLIF(source_aptem_id, '')) ~ '^[0-9]+$'
            THEN coalesce(NULLIF(profile_aptem_id::text, ''), NULLIF(source_aptem_id, ''))::bigint
        ELSE snapshot_aptem_id
    END AS aptem_id,
    coach_email,
    CURRENT_DATE AS as_of_date,
    snapshot_date,
    resolved_planned_hours::numeric(12, 2) AS planned_hours,
    resolved_start_date AS start_date,
    resolved_end_date AS planned_end_date,
    CASE
        WHEN resolved_start_date IS NOT NULL AND resolved_end_date IS NOT NULL
         AND resolved_end_date > resolved_start_date
            THEN GREATEST(0, LEAST(CURRENT_DATE - resolved_start_date,
                                   resolved_end_date - resolved_start_date))
        ELSE NULL
    END AS elapsed_days,
    CASE
        WHEN resolved_start_date IS NOT NULL AND resolved_end_date IS NOT NULL
         AND resolved_end_date > resolved_start_date
            THEN resolved_end_date - resolved_start_date
        ELSE NULL
    END AS programme_days,
    CASE
        WHEN resolved_status = 'FORMULA_READY'
            THEN "Learner".target_hours_as_of(
                resolved_planned_hours, resolved_start_date, resolved_end_date, CURRENT_DATE
            )
        ELSE NULL::numeric
    END AS target_hours,
    snapshot_target_hours,
    resolved_status AS status,
    CASE
        WHEN resolved_status = 'FORMULA_READY' AND CURRENT_DATE < resolved_start_date
            THEN 'before_start'
        WHEN resolved_status = 'FORMULA_READY' AND CURRENT_DATE >= resolved_end_date
            THEN 'complete_programme'
        WHEN resolved_status = 'FORMULA_READY'
            THEN 'in_progress'
        WHEN status_norm = 'withdrawn'
            THEN 'withdrawn'
        WHEN status_norm LIKE 'onboarding%'
            THEN 'onboarding'
        WHEN status_norm IN ('delivery', 'active', 'onbreak')
         AND (resolved_planned_hours IS NULL OR resolved_planned_hours <= 0)
            THEN 'missing_or_nonpositive_planned_hours'
        WHEN status_norm IN ('delivery', 'active', 'onbreak')
            THEN 'missing_start_or_end_date'
        ELSE 'unsupported_status:' || coalesce(status_norm, '<blank>')
    END AS status_reason,
    coalesce(formula_version, 'target_hours_v1') AS formula_version,
    coalesce(calculation_method, 'clamp(planned_hours * elapsed_days / programme_days, 0, planned_hours)') AS calculation_method,
    'live_schedule_view' AS source_system,
    'profile:' || learner_id::text || ';enrolment:' || coalesce(enrolment_id::text, '')
        || ';aptem:' || coalesce(source_aptem_id, profile_aptem_id::text, snapshot_aptem_id::text, '') AS source_reference,
    coalesce(calculated_by, 'system:target-hours-v1') AS calculated_by,
    calculated_at,
    coalesce(updated_at, now()) AS updated_at
FROM classified;
