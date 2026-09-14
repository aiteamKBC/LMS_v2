-- Read-only: expected result is 30 rows, each with one target and coach.
WITH source AS (
 SELECT * FROM jsonb_to_recordset($source$
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
$source$::jsonb)
 AS x(programme_code text, programme_id text, programme_name text,
      full_name text, email text, phone text)
)
SELECT r.programme_code, r.full_name, r.email, r.phone,
       t.*, (SELECT count(*) FROM enrolment."Created_users" e
             WHERE lower(btrim(e."Email")) = r.email) AS existing_enrolment,
       (SELECT count(*) FROM "Learner".learners l
        WHERE lower(btrim(l.email)) = r.email) AS existing_profiles
FROM source r LEFT JOIN LATERAL (
SELECT p.programme_id, p.name AS programme_name,
           c.cohort_id, c.cohort_name, g.group_id, g.group_name,
           s."Username" AS coach_name, lower(btrim(s."Email")) AS coach_email
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
      AND btrim(coalesce(s."Email", '')) <> '' 
) t ON true
ORDER BY r.programme_code, r.full_name;
