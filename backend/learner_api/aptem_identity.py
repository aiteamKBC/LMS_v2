"""Authoritative read-only Aptem identity projections.

Current learner facts come from the normalized learner and Curriculum tables.
Historical facts are emitted only for Aptem IDs that have no current learner,
and only from the dedicated preserved identity/non-active/reporting sources.

The SQL fragments deliberately contain no compatibility view or fallback for
the retired denormalized identity tables.
"""


CURRENT_APTEM_IDENTITY_CTE = r'''
current_aptem_identity AS (
    SELECT l.aptem_id,
           l.id AS learner_id,
           l.enrolment_id,
           l.full_name,
           l.email,
           l.programme_status,
           l.lifecycle_status,
           l.programme_id,
           programme.name AS programme_name,
           l.cohort_id,
           cohort.cohort_name,
           l.group_id,
           learner_group.group_name,
           l.coach_id,
           coach.name AS coach_name,
           coach.email AS coach_email,
           l.start_date,
           l.end_date,
           l.planned_hours,
           l.target_hours,
           l.completed_hours,
           organisation."Levy_payer" AS levy_status,
           NULL::json AS components_json,
           'current'::text AS source_kind
    FROM "Learner".learners l
    LEFT JOIN curriculum.programmes programme
      ON programme.programme_id = l.programme_id
    LEFT JOIN curriculum.cohorts cohort
      ON cohort.cohort_id = l.cohort_id
    LEFT JOIN curriculum.groups learner_group
      ON learner_group.group_id = l.group_id
    LEFT JOIN curriculum.coaches coach
      ON coach.id = l.coach_id
    LEFT JOIN enrolment."Created_users" enrolment
      ON enrolment.id = l.enrolment_id
    LEFT JOIN enrolment."Organisations" organisation
      ON organisation.id = enrolment."Employer_id"
    WHERE l.aptem_id IS NOT NULL
)
'''


HISTORICAL_APTEM_IDENTITY_CTE = r'''
historical_aptem_identity AS (
    SELECT history.aptem_id,
           NULL::bigint AS learner_id,
           NULL::bigint AS enrolment_id,
           history.full_name,
           history.email,
           COALESCE(NULLIF(btrim(non_active."Program-Status"), ''),
                    NULLIF(btrim(reporting.programme_status), '')) AS programme_status,
           NULL::text AS lifecycle_status,
           NULL::text AS programme_id,
           COALESCE(NULLIF(btrim(non_active."Program Name"), ''),
                    NULLIF(btrim(reporting.programme_name), '')) AS programme_name,
           NULL::text AS cohort_id,
           NULL::text AS cohort_name,
           NULL::text AS group_id,
           NULLIF(btrim(non_active."Group"), '') AS group_name,
           NULL::text AS coach_id,
           COALESCE(NULLIF(btrim(non_active."OwnerName"), ''),
                    NULLIF(btrim(reporting.owner_name), '')) AS coach_name,
           COALESCE(NULLIF(btrim(non_active."OwnerEmail"), ''),
                    NULLIF(btrim(reporting.owner_email), '')) AS coach_email,
           COALESCE(non_active."Start-Date", reporting.start_date) AS start_date,
           COALESCE(non_active."End-Date", reporting.end_date) AS end_date,
           non_active."Planned" AS planned_hours,
           CASE
             WHEN btrim(COALESCE(non_active."Target", '')) ~ '^[0-9]+(?:\.[0-9]+)?$'
             THEN btrim(non_active."Target")::numeric
             ELSE NULL::numeric
           END AS target_hours,
           non_active."Completed" AS completed_hours,
           NULLIF(btrim(non_active."Levy or Not"), '') AS levy_status,
           non_active.components_json,
           'historical'::text AS source_kind
    FROM "Learner".aptem_historical_identities history
    LEFT JOIN "LMS".non_active_users non_active
      ON non_active."ID" = history.aptem_id
    LEFT JOIN kbc_quality_reporting.aptem_reporting_legacy_attributes reporting
      ON reporting.aptem_id = history.aptem_id
    WHERE NOT EXISTS (
        SELECT 1 FROM current_aptem_identity current
        WHERE current.aptem_id = history.aptem_id
    )
)
'''


APTEM_IDENTITY_CTES = (
    CURRENT_APTEM_IDENTITY_CTE
    + ',\n'
    + HISTORICAL_APTEM_IDENTITY_CTE
    + r''',
aptem_identity AS (
    SELECT * FROM current_aptem_identity
    UNION ALL
    SELECT * FROM historical_aptem_identity
)
'''
)


ADMIN_EVIDENCE_IDENTITY_CTES = APTEM_IDENTITY_CTES + r''',
admin_evidence_identity AS (
    SELECT *
    FROM aptem_identity
    WHERE (source_kind = 'current'
           AND lower(btrim(COALESCE(programme_status, ''))) IN ('active', 'delivery'))
       OR (source_kind = 'historical'
           AND lower(btrim(COALESCE(programme_status, ''))) = 'completed')
)
'''

