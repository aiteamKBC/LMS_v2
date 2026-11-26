-- Run in one transaction after verifying the intended database branch.
-- Rename the two historical outputs without changing their values. Live rule
-- metadata and input provenance are computed at read time. Source priorities,
-- target arithmetic, snapshot rows, column types and view permissions are retained.
DO $live_fields$
DECLARE
    definition text;
    change record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='Learner' AND c.relname='learner_target_hours_current' AND c.relkind='v') THEN
        RAISE EXCEPTION 'Expected Learner.learner_target_hours_current to be an ordinary view';
    END IF;
    SELECT pg_get_viewdef('"Learner".learner_target_hours_current'::regclass, true) INTO definition;
    IF strpos(definition, 'database:Learner.target_hours_as_of') = 0 THEN
        FOR change IN SELECT * FROM (VALUES
        ($old$    COALESCE(formula_version, 'target_hours_v1'::text) AS formula_version,$old$, $new$    'target_hours_v1'::text AS formula_version,$new$),
        ($old$    COALESCE(calculation_method, 'clamp(planned_hours * elapsed_days / programme_days, 0, planned_hours)'::text) AS calculation_method,$old$, $new$    'clamp(planned_hours * elapsed_days / programme_days, 0, planned_hours)'::text AS calculation_method,$new$),
        ($old$    'live_schedule_view'::text AS source_system,$old$, $new$    CASE
        WHEN planned_hours_source LIKE 'historical_snapshot.%'
          OR start_date_source LIKE 'historical_snapshot.%'
          OR planned_end_date_source LIKE 'historical_snapshot.%'
          OR aptem_id_source LIKE 'historical_snapshot.%'
            THEN 'live_schedule_view_with_snapshot_fallback'::text
        ELSE 'live_schedule_view'::text
    END AS source_system,$new$),
        ($old$    (((('profile:'::text || learner_id::text) || ';enrolment:'::text) || COALESCE(enrolment_id::text, ''::text)) || ';aptem:'::text) || COALESCE(source_aptem_id, profile_aptem_id::text, snapshot_aptem_id::text, ''::text) AS source_reference,$old$, $new$    (((('profile:'::text || learner_id::text) || ';enrolment:'::text) || COALESCE(enrolment_id::text, ''::text)) || ';aptem:'::text) || COALESCE(source_aptem_id, profile_aptem_id::text, snapshot_aptem_id::text, ''::text) || ';hours_source:'::text || planned_hours_source || ';start_source:'::text || start_date_source || ';end_source:'::text || planned_end_date_source || ';aptem_source:'::text || aptem_id_source AS source_reference,$new$),
        ($old$    COALESCE(calculated_by, 'system:target-hours-v1'::text) AS calculated_by,$old$, $new$    'database:Learner.target_hours_as_of'::text AS calculated_by,$new$),
        ($old$   FROM classified;$old$, $new$   FROM (
       SELECT c.*,
           CASE
               WHEN c.contract_training_plan_hours IS NOT NULL THEN 'training_plan_contract.training_plan_planned_hours'
               WHEN c.contract_planned_hours IS NOT NULL THEN 'training_plan_contract.planned'
               WHEN "Learner".target_hours_safe_numeric(c.source_planned_hours) IS NOT NULL THEN 'enrolment.Planned_hours'
               WHEN c.profile_planned_hours IS NOT NULL THEN 'learner_profile.planned_hours'
               WHEN c.snapshot_planned_hours IS NOT NULL THEN 'historical_snapshot.planned_hours'
               ELSE 'unavailable'
           END AS planned_hours_source,
           CASE
               WHEN c.contract_start_date IS NOT NULL THEN 'training_plan_contract.program_start_date'
               WHEN "Learner".target_hours_safe_date(c.source_start_date) IS NOT NULL THEN 'enrolment.start_date'
               WHEN "Learner".target_hours_safe_date(c.source_learner_start_date) IS NOT NULL THEN 'enrolment.learner_start_date'
               WHEN c.profile_start_date IS NOT NULL THEN 'learner_profile.start_date'
               WHEN "Learner".target_hours_safe_date(c.profile_learner_start_date) IS NOT NULL THEN 'learner_profile.learner_start_date'
               WHEN c.snapshot_start_date IS NOT NULL THEN 'historical_snapshot.start_date'
               ELSE 'unavailable'
           END AS start_date_source,
           CASE
               WHEN c.contract_end_date IS NOT NULL THEN 'training_plan_contract.planned_end_date'
               WHEN "Learner".target_hours_safe_date(c.source_end_date) IS NOT NULL THEN 'enrolment.end_date'
               WHEN "Learner".target_hours_safe_date(c.source_learner_end_date) IS NOT NULL THEN 'enrolment.learner_end_date'
               WHEN "Learner".target_hours_safe_date(c.source_apprenticeship_end_date) IS NOT NULL THEN 'enrolment.Apprenticeship_End_date'
               WHEN "Learner".target_hours_safe_date(c.source_practical_end_date) IS NOT NULL THEN 'enrolment.Practical_period_end_date'
               WHEN c.profile_end_date IS NOT NULL THEN 'learner_profile.end_date'
               WHEN "Learner".target_hours_safe_date(c.profile_learner_end_date) IS NOT NULL THEN 'learner_profile.learner_end_date'
               WHEN c.snapshot_end_date IS NOT NULL THEN 'historical_snapshot.planned_end_date'
               ELSE 'unavailable'
           END AS planned_end_date_source,
           CASE
               WHEN COALESCE(NULLIF(c.profile_aptem_id::text, ''), NULLIF(c.source_aptem_id, '')) ~ '^[0-9]+$'
                   THEN CASE WHEN NULLIF(c.profile_aptem_id::text, '') IS NOT NULL
                       THEN 'learner_profile.aptem_id' ELSE 'enrolment.aptem_id' END
               WHEN c.snapshot_aptem_id IS NOT NULL THEN 'historical_snapshot.aptem_id'
               ELSE 'unavailable'
           END AS aptem_id_source
       FROM classified c
   ) current_inputs;$new$)
        ) AS changes(old_text,new_text) LOOP
            IF (length(definition)-length(replace(definition,change.old_text,''))) / length(change.old_text) <> 1 THEN
                RAISE EXCEPTION 'Unexpected target-hours definition; inspect before applying live-field changes';
            END IF;
            definition := replace(definition,change.old_text,change.new_text);
        END LOOP;
        EXECUTE format('CREATE OR REPLACE VIEW %I.%I AS %s','Learner','learner_target_hours_current',definition);
    ELSIF strpos(definition, ';hours_source:') = 0 OR strpos(definition, ';start_source:') = 0
       OR strpos(definition, ';end_source:') = 0 OR strpos(definition, ';aptem_source:') = 0
       OR strpos(definition, 'live_schedule_view_with_snapshot_fallback') = 0 THEN
        RAISE EXCEPTION 'Incomplete live-field provenance; inspect the installed view';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='"Learner".learner_target_hours_current'::regclass
               AND attname='snapshot_date' AND NOT attisdropped) THEN
        ALTER VIEW "Learner".learner_target_hours_current RENAME COLUMN snapshot_date TO historical_snapshot_date;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='"Learner".learner_target_hours_current'::regclass
               AND attname='snapshot_target_hours' AND NOT attisdropped) THEN
        ALTER VIEW "Learner".learner_target_hours_current RENAME COLUMN snapshot_target_hours TO historical_snapshot_target_hours;
    END IF;
END
$live_fields$;

COMMENT ON COLUMN "Learner"."learner_target_hours_current".learner_id IS
    'Current LMS learner profile ID.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".enrolment_id IS
    'Current enrolment ID linked to the learner profile.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".aptem_id IS
    'Current resolved Aptem ID; source_reference identifies any historical fallback.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".coach_email IS
    'Current coach email resolved through the learner profile coach assignment.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".as_of_date IS
    'Date used for the live target calculation: CURRENT_DATE in the database session timezone.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".historical_snapshot_date IS
    'Historical as-of date of the latest saved daily snapshot. Not the date of the live calculation.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".planned_hours IS
    'Programme hours resolved on each read: training-plan contract, enrolment, learner profile, then historical fallback. See source_reference.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".start_date IS
    'Start date resolved on each read using the existing source priority. See source_reference.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".planned_end_date IS
    'Planned end date resolved on each read using the existing source priority. See source_reference.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".elapsed_days IS
    'Elapsed calendar days at as_of_date, clamped between zero and programme_days.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".programme_days IS
    'Calendar days between the resolved start_date and planned_end_date; NULL for an invalid window.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".target_hours IS
    'Live target at as_of_date using Learner.target_hours_as_of; NULL when status is not FORMULA_READY.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".historical_snapshot_target_hours IS
    'Target saved in the historical snapshot. Use target_hours for the live target.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".status IS
    'Current classification of learner status and resolved calculation inputs.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".status_reason IS
    'Current explanation of status, including missing inputs and programme date boundaries.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".formula_version IS
    'Version of the live target-hours rule; independent of historical snapshot metadata.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".calculation_method IS
    'Formula used by the live target-hours rule; independent of historical snapshot metadata.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".source_system IS
    'Live view calculation; explicitly marked with_snapshot_fallback when a resolved input comes from a historical snapshot.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".source_reference IS
    'Learner identities followed by hours_source, start_source, end_source and aptem_source for the current resolved inputs.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".calculated_by IS
    'Database function responsible for the live target calculation, not the historical snapshot writer.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".calculated_at IS
    'Time the current view query began. Historical snapshot calculation times remain in learner_target_hours_daily.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".updated_at IS
    'Time the current view query began; not the last write to source data. Historical snapshot update times remain in learner_target_hours_daily.';
