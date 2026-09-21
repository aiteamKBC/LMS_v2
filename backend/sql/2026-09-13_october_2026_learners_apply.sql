-- MANUAL DATA IMPORT: run this whole file in the Neon SQL Editor.
-- Source: october 2026/*.md; 30 unique emails (ME 8, MM 12, PCP 10).
-- Reuses existing programme -> October 2026 -> G1 and the live G1 coach.
-- New rows use commercial, matching the current learner population, and
-- Fresh user, the application's creation default; no enrolment is completed.
-- Creates/updates both enrolment and learner profiles, sharing UUID and
-- enrolment_id while allowing their independent primary-key sequences.
-- Preserves existing status, names, phones, learning plans, and progress.
-- No login accounts, invitations, start dates, or curriculum records are changed.
-- Re-running matches trimmed, case-insensitive email; it does not duplicate rows.
-- Any ambiguous target or conflicting identity aborts the entire transaction.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE curriculum.programmes, curriculum.cohorts, curriculum.groups,
           enrolment."Staff_users" IN SHARE MODE;
LOCK TABLE enrolment."Created_users", "Learner".learners IN SHARE ROW EXCLUSIVE MODE;

DO $import$
DECLARE
  source_rows CONSTANT jsonb := $source$
[
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Ilaria Piscopo", "email": "ilaria.piscopo@prsformusic.com", "phone": "7472958619", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Melissa Bramall", "email": "m.bramall@aiglobalmedialtd.com", "phone": "7773454875", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Owen Williams", "email": "owenwilliams@choiceinsuranceagency.com", "phone": "7938196306", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Bethany Cobley", "email": "bethany.cobley@warrantyfirst.co.uk", "phone": "7312087312", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Danielle Roberts", "email": "danielleroberts@southdevon.ac.uk", "phone": "7939268618", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Elizabeth Hughes", "email": "liz.hughes@provendernurseries.co.uk", "phone": "7984184074", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Mae Brown", "email": "mae@sw-hire.co.uk", "phone": "7957985288", "programme_id": "PROG-ME-L4"},
  {"programme_code": "ME", "programme_name": "Marketing Executive Level 4", "full_name": "Stephanie Smith", "email": "stephanie.smith@avenuesgroup.org.uk", "phone": "7877684069", "programme_id": "PROG-ME-L4"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Caris Champion", "email": "caris.champion@hcmediagroup.co.uk", "phone": "7464693758", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Kellymarie Lywood", "email": "marketing@nkholidays.co.uk", "phone": "447860719966", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Katie Jenkin", "email": "katie.jenkin@outco.co.uk", "phone": "7971550581", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Lauren Alexander", "email": "la2073@bath.ac.uk", "phone": "7456839481", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Faye Baker", "email": "fayebaker@wilsonandscott.co.uk", "phone": "7791774875", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Callum Perry", "email": "callum@ssaltd.net", "phone": "7944875956", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Amber Insch", "email": "amber.insch@promega.com", "phone": "7364136087", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Jonathan Dack", "email": "jdack@eastnorfolk.ac.uk", "phone": "7506049077", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Flora Donnelly", "email": "flora.donnelly@htmltd.co.uk", "phone": "7736974293", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Harriet Lacey", "email": "admin@pklacey.co.uk", "phone": "7572340134", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Summer Thompson", "email": "summer.thompson@aimbridge.com", "phone": "7491912241", "programme_id": "PROG-MM-L6"},
  {"programme_code": "MM", "programme_name": "Marketing Manager Level 6", "full_name": "Alexandra Cayzer", "email": "alexandrac@vikingmaritime.co.uk", "phone": "7734237078", "programme_id": "PROG-MM-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Laila Rees", "email": "laila.rees@uknnl.com", "phone": "7341840427", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Jordan Garratt", "email": "jordan@stadion.io", "phone": "7487543761", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Hannah MacLellan", "email": "hannahmaclellan@b-gen.co.uk", "phone": "7827315960", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Shelley Cant", "email": "shelley.cant@neneparktrust.org.uk", "phone": "7784314912", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Kenan Tezcan", "email": "ktezcan@gmail.com", "phone": "7546336383", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Rachel Whittle", "email": "rachel.whittle@uk.bmt.org", "phone": "7450250109", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Prashanth Sivalingam", "email": "prashanth.sivalingam@taylorwoodrow.com", "phone": "7405801772", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Katie Johnson", "email": "katie.johnson@inntel.co.uk", "phone": "7511105521", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Melanie Green", "email": "melanie.green@bristolairport.com", "phone": "7946812738", "programme_id": "PROG-PCP-L6"},
  {"programme_code": "PCP", "programme_name": "Project Controls Professional Level 6", "full_name": "Melissa Barr", "email": "melissa.barr@inaphaea.com", "phone": "7597522396", "programme_id": "PROG-PCP-L6"}
]
$source$::jsonb;
  r record;
  t record;
  e enrolment."Created_users"%ROWTYPE;
  l "Learner".learners%ROWTYPE;
  matches integer;
  processed integer := 0;
  enrolments_inserted integer := 0;
  profiles_inserted integer := 0;
BEGIN
  IF jsonb_array_length(source_rows) <> 30 OR
     (SELECT count(DISTINCT lower(btrim(x->>'email')))
      FROM jsonb_array_elements(source_rows) x) <> 30 THEN
    RAISE EXCEPTION 'Expected exactly 30 distinct source emails';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(source_rows)
           AS x(programme_code text, programme_id text, programme_name text,
                full_name text, email text, phone text)
  LOOP
    -- SELECT INTO STRICT rejects both missing and ambiguous placements/coaches.
    BEGIN
      SELECT p.programme_id, p.name AS programme_name,
           c.cohort_id, c.cohort_name, g.group_id, g.group_name,
           s."Username" AS coach_name, lower(btrim(s."Email")) AS coach_email
    INTO STRICT t
    FROM curriculum.programmes p
    JOIN curriculum.cohorts c ON c.programme_id = p.programme_id
    JOIN curriculum.groups g ON g.cohort_id = c.cohort_id
                            AND g.programme_id = p.programme_id
    JOIN enrolment."Staff_users" s
      ON lower(regexp_replace(btrim(s."Username"), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(g.coach_name), '\s+', ' ', 'g'))
    WHERE p.programme_id = r.programme_id AND p.name = r.programme_name
      AND p.deleted_at IS NULL AND NOT coalesce(p.is_archived, false)
      AND lower(coalesce(p.status, '')) <> 'archived'
      AND lower(btrim(c.cohort_name)) = 'october 2026'
      AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted, false)
      AND lower(coalesce(c.status, '')) <> 'archived'
      AND lower(btrim(g.group_name)) = 'g1'
      AND g.deleted_at IS NULL AND NOT coalesce(g.is_programme_deleted, false)
      AND lower(btrim(s."Access")) = 'coach'
      AND lower(btrim(coalesce(s." Status", ''))) NOT IN ('archived','inactive','disabled')
      AND btrim(coalesce(s."Email", '')) <> '' ;
    EXCEPTION
      WHEN no_data_found OR too_many_rows THEN
        RAISE EXCEPTION 'Expected exactly one live October 2026 / G1 / coach for %',
                        r.programme_name;
    END;

    SELECT count(*) INTO matches FROM enrolment."Created_users"
    WHERE lower(btrim("Email")) = r.email;
    IF matches > 1 THEN
      RAISE EXCEPTION 'Duplicate enrolment email: %', r.email;
    END IF;

    SELECT * INTO e FROM enrolment."Created_users"
    WHERE lower(btrim("Email")) = r.email;
    IF NOT FOUND THEN
      INSERT INTO enrolment."Created_users"
        ("Learner_type", "Invite_to_platform", "Username", "Email", "Phone_number",
         " Status", "Type", "Programme_status", "Programme", "Cohort", "Group",
         "Coach_name", "Coach_email")
      VALUES
        ('commercial', false, r.full_name, r.email, r.phone,
         'FullUser', 'User', 'Fresh user', t.programme_name, t.cohort_name, t.group_name,
         t.coach_name, t.coach_email)
      RETURNING * INTO e;
      enrolments_inserted := enrolments_inserted + 1;
    ELSE
      UPDATE enrolment."Created_users"
      SET "Programme" = t.programme_name, "Cohort" = t.cohort_name,
          "Group" = t.group_name, "Coach_name" = t.coach_name,
          "Coach_email" = t.coach_email
      WHERE id = e.id RETURNING * INTO e;
    END IF;

    SELECT count(*) INTO matches FROM "Learner".learners
    WHERE lower(btrim(email)) = r.email OR enrolment_id = e.id OR uuid = e.uuid;
    IF matches > 1 THEN
      RAISE EXCEPTION 'Conflicting learner identities for %', r.email;
    END IF;

    SELECT * INTO l FROM "Learner".learners
    WHERE lower(btrim(email)) = r.email OR enrolment_id = e.id OR uuid = e.uuid;
    IF FOUND THEN
      IF lower(btrim(l.email)) IS DISTINCT FROM r.email
         OR (l.enrolment_id IS NOT NULL AND l.enrolment_id <> e.id)
         OR l.uuid IS DISTINCT FROM e.uuid THEN
        RAISE EXCEPTION 'Existing learner identity needs review for %', r.email;
      END IF;
      UPDATE "Learner".learners
      SET programme = t.programme_name, programme_id = t.programme_id,
          cohort = t.cohort_name, cohort_id = t.cohort_id,
          group_name = t.group_name, group_id = t.group_id,
          coach_name = t.coach_name, coach_email = t.coach_email,
          enrolment_id = e.id, updated_at = now()
      WHERE id = l.id;
    ELSE
      INSERT INTO "Learner".learners
        (full_name, email, phone_number, lifecycle_status, programme_status,
         learner_type, uuid, enrolment_id, programme, programme_id,
         cohort, cohort_id, group_name, group_id, coach_name, coach_email)
      VALUES
        (coalesce(nullif(btrim(e."Username"), ''), r.full_name), e."Email",
         coalesce(e."Phone_number", ''),
         coalesce(nullif(lower(btrim(e."Programme_status")), ''), 'inactive'),
         coalesce(e."Programme_status", ''), e."Learner_type", e.uuid, e.id,
         t.programme_name, t.programme_id, t.cohort_name, t.cohort_id,
         t.group_name, t.group_id, t.coach_name, t.coach_email);
      profiles_inserted := profiles_inserted + 1;
    END IF;

    IF (SELECT count(*) FROM "Learner".learners p
        JOIN enrolment."Created_users" u ON u.id = p.enrolment_id AND u.uuid = p.uuid
        WHERE lower(btrim(p.email)) = r.email AND lower(btrim(u."Email")) = r.email
          AND p.programme_id = t.programme_id AND p.programme = t.programme_name
          AND p.cohort_id = t.cohort_id AND p.cohort = t.cohort_name
          AND p.group_id = t.group_id AND p.group_name = t.group_name
          AND p.coach_name = t.coach_name AND p.coach_email = t.coach_email
          AND u."Programme" = t.programme_name AND u."Cohort" = t.cohort_name
          AND u."Group" = t.group_name AND u."Coach_name" = t.coach_name
          AND u."Coach_email" = t.coach_email) <> 1 THEN
      RAISE EXCEPTION 'Placement verification failed for %', r.email;
    END IF;
    processed := processed + 1;
  END LOOP;
  IF processed <> 30 THEN
    RAISE EXCEPTION 'Expected 30 learners; processed %', processed;
  END IF;
  RAISE NOTICE 'Verified % learners; inserted % enrolments and % profiles',
               processed, enrolments_inserted, profiles_inserted;
END;
$import$;

COMMIT;

-- Exact imported roster and assigned coach after the transaction.
SELECT l.full_name, l.email, l.programme, l.cohort, l.group_name,
       l.coach_name, l.coach_email, e.id AS enrolment_id, l.id AS learner_id
FROM "Learner".learners l JOIN enrolment."Created_users" e ON e.id = l.enrolment_id
WHERE lower(btrim(l.email)) IN (
  'ilaria.piscopo@prsformusic.com',
  'm.bramall@aiglobalmedialtd.com',
  'owenwilliams@choiceinsuranceagency.com',
  'bethany.cobley@warrantyfirst.co.uk',
  'danielleroberts@southdevon.ac.uk',
  'liz.hughes@provendernurseries.co.uk',
  'mae@sw-hire.co.uk',
  'stephanie.smith@avenuesgroup.org.uk',
  'caris.champion@hcmediagroup.co.uk',
  'marketing@nkholidays.co.uk',
  'katie.jenkin@outco.co.uk',
  'la2073@bath.ac.uk',
  'fayebaker@wilsonandscott.co.uk',
  'callum@ssaltd.net',
  'amber.insch@promega.com',
  'jdack@eastnorfolk.ac.uk',
  'flora.donnelly@htmltd.co.uk',
  'admin@pklacey.co.uk',
  'summer.thompson@aimbridge.com',
  'alexandrac@vikingmaritime.co.uk',
  'laila.rees@uknnl.com',
  'jordan@stadion.io',
  'hannahmaclellan@b-gen.co.uk',
  'shelley.cant@neneparktrust.org.uk',
  'ktezcan@gmail.com',
  'rachel.whittle@uk.bmt.org',
  'prashanth.sivalingam@taylorwoodrow.com',
  'katie.johnson@inntel.co.uk',
  'melanie.green@bristolairport.com',
  'melissa.barr@inaphaea.com'
)
ORDER BY l.programme, l.full_name;
