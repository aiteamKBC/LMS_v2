-- PROPOSAL ONLY. NOT EXECUTED, INCLUDING IN THE DISPOSABLE CLUSTER.
-- Development remains read-only. No deployment or migration authorization.
-- The installed function detects changes to ownership keys only, so changes
-- to hours, month placement, attendance value/status never invalidate actuals.
-- Reproduced by four isolated PostgreSQL failures using its actual definition.
-- Keep INSERT/DELETE, canonical owners, and both sides of reassignment intact.
-- Add the four demonstrated calculation/eligibility dependencies to the
-- symmetric difference. synced_at-only and unchanged updates remain no-ops.
CREATE OR REPLACE FUNCTION "Learner".monthly_actual_event_17()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    owner_ids bigint[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT array_agg(DISTINCT learner_id ORDER BY learner_id)
        INTO owner_ids FROM new_rows;
    ELSIF TG_OP = 'DELETE' THEN
        SELECT array_agg(DISTINCT learner_id ORDER BY learner_id)
        INTO owner_ids FROM old_rows;
    ELSIF TG_OP = 'UPDATE' THEN
        WITH changed AS (
            (SELECT source_key,learner_id,aptem_id,activity_hours,
                    attendance_date,attendance_value,attendance_status FROM new_rows
             EXCEPT
             SELECT source_key,learner_id,aptem_id,activity_hours,
                    attendance_date,attendance_value,attendance_status FROM old_rows)
            UNION
            (SELECT source_key,learner_id,aptem_id,activity_hours,
                    attendance_date,attendance_value,attendance_status FROM old_rows
             EXCEPT
             SELECT source_key,learner_id,aptem_id,activity_hours,
                    attendance_date,attendance_value,attendance_status FROM new_rows)
        )
        SELECT array_agg(DISTINCT learner_id ORDER BY learner_id)
        INTO owner_ids FROM changed;
    END IF;
    IF coalesce(cardinality(owner_ids),0)>0 THEN
        PERFORM "Learner".invalidate_monthly_actuals(owner_ids);
    END IF;
    RETURN NULL;
END;
$function$;
