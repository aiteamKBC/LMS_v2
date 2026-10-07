-- Backfill Aptem IDs onto enrolment."Created_users".aptem_id and
-- "Learner".learners.aptem_id from the Aptem mirrors LMS."Aptem_users" and
-- LMS.non_active_users, matching on email (trimmed, case-insensitive).
--
-- Inspected on 2026-10-07 before applying:
--   * 707 source emails, each with exactly one Aptem ID; no email or ID
--     appears in both mirrors.
--   * Created_users: 567 email matches, 476 already correct, 91 blank,
--     0 holding a different ID. Created_users.id_aptem is empty on every row
--     (the app reads aptem_id), so it is not touched.
--   * learners: 669 email matches, 665 already correct, 4 null, 0 holding a
--     different ID.
--
-- Only BLANK targets are filled; an existing ID is never overwritten.
--
-- Held back: Aptem ID 23366 (non_active_users) matches learner 1212 /
-- Created_users 1491 by email, but learners.aptem_id is unique and learner
-- 1203 (historical-import, different name and email) already holds 23366.
-- Both rows for that email are skipped until the owner decides which learner
-- the ID belongs to. The apply block aborts unless the counts match the
-- inspection (90 Created_users, 3 learners).
--
-- Safe to re-run: once applied, nothing blank remains to fill and the guarded
-- block raises on the 0-row counts without changing anything.

-- 1. Inspect.
with src as (
  select lower(btrim("Email")) em, "ID"::bigint aid from "LMS"."Aptem_users"
  union
  select lower(btrim("Email")), "ID"::bigint from "LMS".non_active_users
)
select (select count(*) from enrolment."Created_users" u join src s on s.em = lower(btrim(u."Email"))
         where nullif(btrim(u.aptem_id), '') is null and s.aid <> 23366) as created_users_to_fill,
       (select count(*) from "Learner".learners l join src s on s.em = lower(btrim(l.email))
         where l.aptem_id is null and s.aid <> 23366)                       as learners_to_fill;

-- 2. Apply (one atomic block).
do $$
declare
  cu_updated int;
  l_updated  int;
begin
  with src as (
    select lower(btrim("Email")) em, "ID"::bigint aid from "LMS"."Aptem_users"
    union
    select lower(btrim("Email")), "ID"::bigint from "LMS".non_active_users
  )
  update enrolment."Created_users" u
     set aptem_id = s.aid::text
    from src s
   where s.em = lower(btrim(u."Email"))
     and nullif(btrim(u.aptem_id), '') is null
     and s.aid <> 23366;
  get diagnostics cu_updated = row_count;

  with src as (
    select lower(btrim("Email")) em, "ID"::bigint aid from "LMS"."Aptem_users"
    union
    select lower(btrim("Email")), "ID"::bigint from "LMS".non_active_users
  )
  update "Learner".learners l
     set aptem_id = s.aid
    from src s
   where s.em = lower(btrim(l.email))
     and l.aptem_id is null
     and s.aid <> 23366;
  get diagnostics l_updated = row_count;

  if cu_updated <> 90 or l_updated <> 3 then
    raise exception 'Unexpected row counts (Created_users %, learners %); rolled back', cu_updated, l_updated;
  end if;
  raise notice 'Filled Created_users: %, learners: %', cu_updated, l_updated;
end $$;

-- 3. Verify: every matched row (except the held-back email) carries the source ID.
with src as (
  select lower(btrim("Email")) em, "ID"::bigint aid from "LMS"."Aptem_users"
  union
  select lower(btrim("Email")), "ID"::bigint from "LMS".non_active_users
)
select (select count(*) from enrolment."Created_users" u join src s on s.em = lower(btrim(u."Email"))
         where s.aid <> 23366 and ltrim(btrim(coalesce(u.aptem_id, '')), '0') <> s.aid::text) as created_users_mismatched,
       (select count(*) from "Learner".learners l join src s on s.em = lower(btrim(l.email))
         where s.aid <> 23366 and l.aptem_id is distinct from s.aid)                        as learners_mismatched;
