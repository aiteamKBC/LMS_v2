-- Copy each learner's line-manager contact details and own phone number from
-- the Aptem mirror LMS."Aptem_users" onto enrolment."Created_users".
--
-- Mapping (agreed with the project owner)
-- ---------------------------------------
--   LMS."Aptem_users"."ManagerName"    -> Created_users."Employer"
--   LMS."Aptem_users"."ManagerEmail"   -> Created_users."Employer_email"   (new column)
--   LMS."Aptem_users"."Manager Phone"  -> Created_users.employer_phone
--   LMS."Aptem_users"."Learner Phone"  -> Created_users."Phone_number"
--
-- Rows are matched on Aptem_users."ID" = Created_users.aptem_id (text,
-- leading zeros ignored), the same bridge historical_evidence.py uses.
-- Values only fill BLANK targets: anything already on a learner row is kept,
-- so re-running never overwrites a value staff have since edited.
--
-- Stub rows
-- ---------
-- An earlier import of these fields INSERTED new rows instead of updating the
-- learners: 357 rows with Learner_type NULL that carry nothing but id_aptem,
-- Phone_number and employer_phone (no email, username, status or learner
-- profile, and nothing in any schema references their ids). Because
-- Learner_type is NULL, the apprenticeship manager lists them as blank
-- apprentices. They are deleted here once the real rows carry the data. The
-- delete aborts unless the set is exactly the one inspected (357 rows).
--
-- "Employer_email" follows this table's initial-capital convention. It is not
-- mapped on the Django model, so no query the app runs changes.
--
-- Safe to re-run: the column add is IF NOT EXISTS, the update only fills
-- blanks, and the stub delete matches nothing once the stubs are gone.

-- 1. Inspect.
select count(*)                                                   as matched_learners,
       count(*) filter (where nullif(btrim(u."Employer"), '') is not null)       as employer_already_set,
       count(*) filter (where nullif(btrim(u.employer_phone), '') is not null)   as employer_phone_already_set,
       count(*) filter (where nullif(btrim(u."Phone_number"), '') is not null)   as phone_already_set
  from enrolment."Created_users" u
  join "LMS"."Aptem_users" a on a."ID"::text = ltrim(btrim(u.aptem_id), '0');

select count(*) as stub_rows
  from enrolment."Created_users"
 where "Learner_type" is null
   and nullif(btrim(id_aptem), '') is not null
   and nullif(btrim("Email"), '') is null
   and nullif(btrim("Username"), '') is null
   and nullif(btrim(" Status"), '') is null;

-- 2. Apply (one atomic block).
do $$
declare
  stub_count int;
  deleted    int;
begin
  alter table enrolment."Created_users"
    add column if not exists "Employer_email" text;

  update enrolment."Created_users" u
     set "Employer"       = coalesce(nullif(btrim(u."Employer"), ''),       nullif(btrim(a."ManagerName"), '')),
         "Employer_email" = coalesce(nullif(btrim(u."Employer_email"), ''), nullif(btrim(a."ManagerEmail"), '')),
         employer_phone   = coalesce(nullif(btrim(u.employer_phone), ''),   nullif(btrim(a."Manager Phone"), '')),
         "Phone_number"   = coalesce(nullif(btrim(u."Phone_number"), ''),   nullif(btrim(a."Learner Phone"), ''))
    from "LMS"."Aptem_users" a
   where a."ID"::text = ltrim(btrim(u.aptem_id), '0')
     and (   (nullif(btrim(u."Employer"), '')       is null and nullif(btrim(a."ManagerName"), '')   is not null)
          or (nullif(btrim(u."Employer_email"), '') is null and nullif(btrim(a."ManagerEmail"), '')  is not null)
          or (nullif(btrim(u.employer_phone), '')   is null and nullif(btrim(a."Manager Phone"), '') is not null)
          or (nullif(btrim(u."Phone_number"), '')   is null and nullif(btrim(a."Learner Phone"), '') is not null));

  create temp table _stubs on commit drop as
  select u.id
    from enrolment."Created_users" u
   where u."Learner_type" is null
     and nullif(btrim(u.id_aptem), '') is not null
     and nullif(btrim(u."Email"), '') is null
     and nullif(btrim(u."Username"), '') is null
     and nullif(btrim(u." Status"), '') is null
     and not exists (select 1 from "Learner".learners l where l.enrolment_id = u.id)
     and not exists (select 1 from "Learner".subject_activity_attempts x where x.enrolment_id = u.id)
     and not exists (select 1 from "Learner".extra_activities x where x.learner_id = u.id);

  select count(*) into stub_count from _stubs;
  if stub_count not in (0, 357) then
    raise exception 'Expected 357 stub rows (or 0 on re-run), found %; aborting', stub_count;
  end if;

  delete from enrolment."Created_users" u using _stubs s where u.id = s.id;
  get diagnostics deleted = row_count;
  raise notice 'Deleted % stub rows', deleted;
end $$;

-- 3. Verify.
select count(*)                                                                as matched_learners,
       count(*) filter (where nullif(btrim(u."Employer"), '') is not null)       as employer_set,
       count(*) filter (where nullif(btrim(u."Employer_email"), '') is not null) as employer_email_set,
       count(*) filter (where nullif(btrim(u.employer_phone), '') is not null)   as employer_phone_set,
       count(*) filter (where nullif(btrim(u."Phone_number"), '') is not null)   as phone_set
  from enrolment."Created_users" u
  join "LMS"."Aptem_users" a on a."ID"::text = ltrim(btrim(u.aptem_id), '0');
