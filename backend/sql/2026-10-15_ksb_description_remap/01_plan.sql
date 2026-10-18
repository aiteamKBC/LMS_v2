-- KSB description remap -- step 1: build the plan and the mapping report.
--
-- Learner KSB rows of the four standard programmes that still carry a manual
-- dotted code (K1.2, S5.1 ...) are attributed to the government standard KSB
-- whose description is the same text -- NEVER by code, number or position.
-- Example (Marketing Executive, ST0596): K1.2 "The concepts of brand
-- positioning ..." is the standard's K2, so it becomes K2, not K1.
--
-- This file READS application tables and WRITES ONLY to the ksb_remap schema.
-- Deterministic and idempotent: every run rebuilds ksb_remap.* from current data.
--
-- Matching (within the standard the learner's programme applies):
--   * description normalised to lower-case alphanumerics (spacing, punctuation
--     and case are the only differences ignored);
--   * tier 1 = identical text; tier 2 = identical once the standard's leading
--     "Label:" is removed (e.g. "Impartial: Responds to ...");
--   * exactly one standard KSB must match, of the same type (K/S/B) as the
--     code. No match, two matches, a type clash or an empty description leaves
--     the row unchanged and lists it for manual review.
--
-- Scope: the learner's programme (majority programme_id of their live progress
-- rows) is one of the four, the programme applies a standard, and the learner
-- is pinned to that same standard. Soft-deleted progress rows and rows in the
-- exclusion registry are reported, never changed.

create schema if not exists ksb_remap;

-- ---------------------------------------------------------------------------
-- Standards, one row per KSB.
drop table if exists ksb_remap.std;
create table ksb_remap.std as
select distinct on (sid, std_code)
  id as std_row_id,
  lower(standard_ref) || '-v' || replace(standard_version, '.', '-') as sid,
  upper(btrim(ksb_code)) as std_code,
  upper(left(ksb_type, 1)) as ktype,
  btrim(ksb_description) as std_desc,
  regexp_replace(lower(ksb_description), '[^a-z0-9]+', '', 'g') as nd,
  regexp_replace(lower(regexp_replace(ksb_description, '^\s*[A-Za-z][A-Za-z &/-]{1,40}:\s*', '')), '[^a-z0-9]+', '', 'g') as nd_nolabel
from curriculum.standard_ksbs
order by sid, std_code, id;

-- ---------------------------------------------------------------------------
-- Learners in scope.
drop table if exists ksb_remap.scope;
create table ksb_remap.scope as
with lp as (
  select distinct on (learner_id) learner_id, programme_id
  from (select learner_id, programme_id, count(*) as n
        from "Learner".learner_progress_entries
        where coalesce(programme_id, '') <> '' and deleted_at is null
        group by learner_id, programme_id) t
  order by learner_id, n desc, programme_id
)
select lp.learner_id, lp.programme_id, p.name as programme_name,
       lower(substr(p.ksb_profile_source_id, length('standard:') + 1)) as sid,
       a.profile_version_id as pin_version_id, v.source_profile_id as pin_source,
       case when coalesce(p.ksb_profile_source_id, '') not ilike 'standard:%' then 'hold_programme_not_on_standard'
            when v.source_profile_id is distinct from p.ksb_profile_source_id then 'hold_pin_mismatch'
            else 'in_scope' end as decision
from lp
join curriculum.programmes p on p.programme_id = lp.programme_id
left join "Learner".learner_ksb_assignments a on a.learner_id = lp.learner_id
left join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
where lp.programme_id in ('PROG-20260907141619067932', 'PROG-ME-L4', 'PROG-MM-L6', 'PROG-PCP-L6');

-- ---------------------------------------------------------------------------
-- Learner progress KSB rows ("Learner".learner_progress_ksbs) with a dotted code.
drop table if exists ksb_remap.progress_plan;
create table ksb_remap.progress_plan as
with rows_ as (
  select k.progress_id, k.position, s.learner_id, s.programme_id, s.sid, s.decision as scope_decision, s.pin_version_id,
         e.deleted_at is not null as entry_deleted,
         exists (select 1 from "Learner".learner_progress_ksb_exclusions x
                  where x.progress_id = k.progress_id and x.position = k.position and x.status <> 'released') as registered_excluded,
         k.ksb_code as old_code_raw, upper(btrim(k.ksb_code)) as old_code, k.ksb_description as old_desc,
         k.ksb_definition_id as old_definition_id, k.source_type, k.source_id,
         regexp_replace(lower(coalesce(k.ksb_description, '')), '[^a-z0-9]+', '', 'g') as nd
  from "Learner".learner_progress_ksbs k
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  join ksb_remap.scope s on s.learner_id = e.learner_id
  where k.ksb_code ~ '^\s*[KSBksb][0-9]+\.[0-9]+\s*$'
), cand as (
  select r.progress_id, r.position, count(std.std_code) as n_cand,
         min(std.std_code) as std_code, min(std.std_desc) as std_desc, min(std.ktype) as std_ktype,
         min(case when std.nd = r.nd then 1 else 2 end) as tier
  from rows_ r
  left join ksb_remap.std std on std.sid = r.sid and r.nd <> '' and (std.nd = r.nd or std.nd_nolabel = r.nd)
  group by r.progress_id, r.position
)
select r.*, c.n_cand, c.tier,
       case when c.n_cand = 1 then c.std_code end as std_code,
       case when c.n_cand = 1 then c.std_desc end as std_desc,
       case when r.scope_decision <> 'in_scope' then r.scope_decision
            when r.entry_deleted then 'keep_deleted_entry'
            when r.registered_excluded then 'keep_registered_exclusion'
            when r.nd = '' then 'review_no_description'
            when c.n_cand = 0 then 'review_no_match'
            when c.n_cand > 1 then 'review_ambiguous'
            when c.std_ktype <> left(r.old_code, 1) then 'review_type_mismatch'
            else 'remap' end as action,
       -- The pinned standard version's definition for the matched code (only
       -- for rows that already carry a definition id, as the migration did).
       case when r.old_definition_id is not null and c.n_cand = 1 then
         (select d.id from curriculum.ksb_definitions d
           where d.profile_version_id = r.pin_version_id and upper(d.code) = c.std_code) end as new_definition_id
from rows_ r join cand c on c.progress_id = r.progress_id and c.position = r.position;

-- A remap whose row carries a definition id needs the pinned version to hold
-- that code; otherwise it is held for review rather than losing the link.
update ksb_remap.progress_plan set action = 'review_no_pinned_definition'
 where action = 'remap' and old_definition_id is not null and new_definition_id is null;

-- ---------------------------------------------------------------------------
-- Journal KSB lists (JSON arrays of {code, type, description}) read by the
-- learner dashboard (schema "Learner") and the coach views
-- (structured_manual_activities). One plan row per dotted array element.
drop table if exists ksb_remap.journal_plan;
create table ksb_remap.journal_plan as
with learner_aptem as (
  select s.learner_id, s.sid, s.decision, l.aptem_id::text as aptem_id
  from ksb_remap.scope s join "Learner".learners l on l.id = s.learner_id
  where l.aptem_id is not null
), owners as (
  -- An Aptem id owned by more than one learner is never guessed.
  select aptem_id, min(learner_id) as learner_id, min(sid) as sid, min(decision) as decision, count(*) as n
  from learner_aptem group by aptem_id
), src as (
  select 'Learner.learner_journal_row_ksbs'::text as tbl, row_id::text as row_key, aptem_id::text as aptem_id, ksbs from "Learner".learner_journal_row_ksbs
  union all select 'Learner.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, aptem_id::text, ksbs from "Learner".learner_activity_ksbs
  union all select 'structured_manual_activities.learner_journal_row_ksbs', row_id::text, aptem_id::text, ksbs from structured_manual_activities.learner_journal_row_ksbs
  union all select 'structured_manual_activities.learner_activity_ksbs', aptem_id::text || ':' || activity_id::text, aptem_id::text, ksbs from structured_manual_activities.learner_activity_ksbs
), el as (
  select s.tbl, s.row_key, s.aptem_id, o.learner_id, o.sid, o.n as owners, o.decision as scope_decision,
         x.ord - 1 as idx, x.e as old_item,
         upper(btrim(coalesce(x.e->>'code', x.e->>'ksbCode', x.e->>'ksb_code'))) as old_code,
         x.e->>'description' as old_desc,
         regexp_replace(lower(coalesce(x.e->>'description', '')), '[^a-z0-9]+', '', 'g') as nd
  from src s
  join owners o on o.aptem_id = s.aptem_id
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.ksbs) = 'array' then s.ksbs else '[]'::jsonb end) with ordinality as x(e, ord)
  where jsonb_typeof(x.e) = 'object'
    and coalesce(x.e->>'code', x.e->>'ksbCode', x.e->>'ksb_code', '') ~ '^\s*[KSBksb][0-9]+\.[0-9]+\s*$'
), cand as (
  select e.tbl, e.row_key, e.idx, count(std.std_code) as n_cand,
         min(std.std_code) as std_code, min(std.std_desc) as std_desc, min(std.ktype) as std_ktype,
         min(case when std.nd = e.nd then 1 else 2 end) as tier
  from el e
  left join ksb_remap.std std on std.sid = e.sid and e.nd <> '' and (std.nd = e.nd or std.nd_nolabel = e.nd)
  group by e.tbl, e.row_key, e.idx
)
select e.*, c.n_cand, c.tier,
       case when c.n_cand = 1 then c.std_code end as std_code,
       case when c.n_cand = 1 then c.std_desc end as std_desc,
       case when e.owners > 1 then 'hold_shared_aptem_id'
            when e.scope_decision <> 'in_scope' then e.scope_decision
            when e.nd = '' then 'review_no_description'
            when c.n_cand = 0 then 'review_no_match'
            when c.n_cand > 1 then 'review_ambiguous'
            when c.std_ktype <> left(e.old_code, 1) then 'review_type_mismatch'
            else 'remap' end as action
from el e join cand c on c.tbl = e.tbl and c.row_key = e.row_key and c.idx = e.idx;

-- ---------------------------------------------------------------------------
-- One manual description must land on one standard KSB everywhere. If the
-- same (programme, code, description) resolves differently anywhere, every
-- row of it is held.
with conflicting as (
  select programme_id, old_code, nd from (
    select programme_id, old_code, nd, std_code from ksb_remap.progress_plan where action = 'remap'
    union all
    select s.programme_id, j.old_code, j.nd, j.std_code from ksb_remap.journal_plan j
      join ksb_remap.scope s on s.learner_id = j.learner_id where j.action = 'remap'
  ) t group by programme_id, old_code, nd having count(distinct std_code) > 1
)
, held_progress as (
  update ksb_remap.progress_plan p set action = 'review_inconsistent'
    from conflicting c where p.action = 'remap' and c.programme_id = p.programme_id and c.old_code = p.old_code and c.nd = p.nd
  returning 1
)
update ksb_remap.journal_plan j set action = 'review_inconsistent'
  from ksb_remap.scope s, conflicting c
 where j.action = 'remap' and s.learner_id = j.learner_id
   and c.programme_id = s.programme_id and c.old_code = j.old_code and c.nd = j.nd;

-- ---------------------------------------------------------------------------
-- The mapping report: one row per programme x manual code x description.
drop table if exists ksb_remap.mapping_report;
create table ksb_remap.mapping_report as
with u as (
  select s.programme_name, p.sid, p.old_code, p.old_desc, p.nd, p.std_code, p.std_desc, p.tier, p.action,
         'progress' as kind, p.learner_id
  from ksb_remap.progress_plan p join ksb_remap.scope s on s.learner_id = p.learner_id
  union all
  select s.programme_name, j.sid, j.old_code, j.old_desc, j.nd, j.std_code, j.std_desc, j.tier, j.action,
         'journal', j.learner_id
  from ksb_remap.journal_plan j join ksb_remap.scope s on s.learner_id = j.learner_id
)
select programme_name, sid as standard, old_code as original_manual_code, min(old_desc) as manual_description,
       std_code as matched_standard_code, std_desc as standard_description,
       case when action = 'remap' then case when min(tier) = 1 then 'matched_exact' else 'matched_without_label' end
            else action end as match_status,
       count(*) filter (where kind = 'progress') as progress_rows,
       count(*) filter (where kind = 'progress' and action = 'remap') as progress_rows_changed,
       count(*) filter (where kind = 'journal') as journal_items,
       count(*) filter (where kind = 'journal' and action = 'remap') as journal_items_changed,
       count(distinct learner_id) as learners,
       std_code is not null and std_code <> regexp_replace(old_code, '\..*$', '') as parent_rule_was_wrong
from u
group by programme_name, sid, old_code, nd, std_code, std_desc, action;

-- ---------------------------------------------------------------------------
-- Per learner: achieved standard KSBs as the readers count them today (dotted
-- code -> its prefix) versus after the remap (dotted code -> the standard KSB
-- of the same description). Same achievement rule as the readers: live entry,
-- passed is not false, a quiz must have passed = true, not registered excluded.
drop table if exists ksb_remap.learner_effect;
create table ksb_remap.learner_effect as
with achieved as (
  select e.learner_id, k.progress_id, k.position, upper(btrim(k.ksb_code)) as code
  from "Learner".learner_progress_ksbs k
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  where e.learner_id in (select learner_id from ksb_remap.scope where decision = 'in_scope')
    and e.deleted_at is null and e.passed is not false
    and btrim(lower(coalesce(e.kind, ''))) <> 'activity_event'
    and (btrim(lower(coalesce(e.kind, ''))) <> 'quiz' or e.passed is true)
    and not exists (select 1 from "Learner".learner_progress_ksb_exclusions x
                     where x.progress_id = k.progress_id and x.position = k.position
                       and x.ksb_code = upper(btrim(k.ksb_code)) and x.status <> 'released')
), sides as (
  select a.learner_id, regexp_replace(a.code, '\..*$', '') as before_code,
         coalesce(case when p.action = 'remap' then p.std_code end, regexp_replace(a.code, '\..*$', '')) as after_code
  from achieved a left join ksb_remap.progress_plan p on p.progress_id = a.progress_id and p.position = a.position
), b as (
  select learner_id, array_agg(distinct before_code order by before_code) as codes from sides group by learner_id
), a as (
  select learner_id, array_agg(distinct after_code order by after_code) as codes from sides group by learner_id
)
select s.learner_id, s.programme_name,
       coalesce(cardinality(b.codes), 0) as before_distinct,
       coalesce(cardinality(a.codes), 0) as after_distinct,
       b.codes as before_codes, a.codes as after_codes,
       array(select unnest(a.codes) except select unnest(b.codes) order by 1) as gained,
       array(select unnest(b.codes) except select unnest(a.codes) order by 1) as no_longer_credited_by_prefix
from ksb_remap.scope s
left join b on b.learner_id = s.learner_id
left join a on a.learner_id = s.learner_id
where s.decision = 'in_scope'
  and (s.learner_id in (select learner_id from ksb_remap.progress_plan) or s.learner_id in (select learner_id from ksb_remap.journal_plan));

-- ---------------------------------------------------------------------------
-- Summary.
select 'progress' as plan, action, count(*) as rows_, count(distinct learner_id) as learners
  from ksb_remap.progress_plan group by action
union all
select 'journal', action, count(*), count(distinct learner_id) from ksb_remap.journal_plan group by action
order by 1, 2;
