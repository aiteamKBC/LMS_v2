-- KSB standards migration -- step 1: build the dry-run plan.
--
-- Retires the manual KSB profiles (curriculum.ksb_profiles) in favour of the
-- Skills England standards (curriculum.standard_ksbs) without losing any
-- learner's achieved KSBs.
--
-- This file READS application tables and WRITES ONLY to the ksb_mig schema.
-- It is deterministic and idempotent: every run drops and rebuilds ksb_mig.*
-- from the current data, so re-running it after data changes is safe.
-- Nothing here changes curriculum.*, "Learner".* or enrolment.*.
--
-- Matching rules (never by code alone):
--   * normalised description (lower-case, alphanumerics only), same K/S/B type,
--     within the standard the profile is linked to (ksb_profiles.standard_source_id);
--   * tier 1 = identical text; tier 2 = identical once the standard's leading
--     "Label:" is removed (e.g. "Impartial: Responds to ..."); tier 3 = one text
--     is a prefix of the other and both are >= 60 characters (needs review);
--   * a manual item with two candidates, or two manual items claiming one
--     standard KSB, is 'ambiguous' and is never applied;
--   * a manual code that has sub-points (K1 with K1.1, K1.2 ...) is a group
--     heading. It has no standard equivalent and is never redistributed.

create schema if not exists ksb_mig;

-- ---------------------------------------------------------------------------
-- Standards, one row per KSB.
drop table if exists ksb_mig.std;
create table ksb_mig.std as
select distinct on (sid, std_code)
  id as std_row_id,  -- standard mappings use ksb_id = '<sid>-<standard_ksbs.id>'
  lower(standard_ref) || '-v' || replace(standard_version, '.', '-') as sid,
  upper(btrim(ksb_code)) as std_code,
  upper(left(ksb_type, 1)) as ktype,
  ksb_description as std_desc,
  standard_title,
  level as std_level,
  regexp_replace(lower(ksb_description), '[^a-z0-9]+', '', 'g') as nd,
  regexp_replace(lower(regexp_replace(ksb_description, '^\s*[A-Za-z][A-Za-z &/-]{1,40}:\s*', '')), '[^a-z0-9]+', '', 'g') as nd_nolabel
from curriculum.standard_ksbs
order by sid, std_code, id;

-- ---------------------------------------------------------------------------
-- Manual item -> standard KSB.
drop table if exists ksb_mig.item_match;
create table ksb_mig.item_match as
with items as (
  select p.id as profile_id, p.name as profile_name, p.standard_source_id as std_sid, x.ord as pos,
         upper(btrim(x.i->>'code')) as manual_code, upper(left(x.i->>'type', 1)) as ktype,
         x.i->>'description' as manual_desc,
         regexp_replace(lower(coalesce(x.i->>'description', '')), '[^a-z0-9]+', '', 'g') as nd
  from curriculum.ksb_profiles p
  cross join lateral json_array_elements(p.ksb_items::json) with ordinality as x(i, ord)
), flagged as (
  select it.*, exists (
    select 1 from items c where c.profile_id = it.profile_id and c.manual_code like it.manual_code || '.%'
  ) as is_heading
  from items it
), cand as (
  select f.profile_id, f.manual_code, s.std_code, s.std_desc,
         case when s.nd = f.nd then 1
              when s.nd_nolabel = f.nd then 2
              when length(f.nd) >= 60 and length(s.nd) >= 60 and (s.nd like f.nd || '%' or f.nd like s.nd || '%') then 3
         end as tier
  from flagged f
  join ksb_mig.std s on s.sid = f.std_sid and s.ktype = f.ktype
  where not f.is_heading and f.nd <> ''
), best as (
  select c.*, min(tier) over (partition by profile_id, manual_code) as best_tier
  from cand c where tier is not null
), chosen as (
  select profile_id, manual_code, count(*) as n, min(std_code) as std_code, min(std_desc) as std_desc, min(tier) as tier
  from best where tier = best_tier group by profile_id, manual_code
)
select f.profile_id, f.profile_name, f.std_sid, f.pos, f.manual_code, f.ktype, f.is_heading, f.manual_desc,
       case when f.std_sid is null then 'no_linked_standard'
            when f.is_heading then 'group_heading'
            when c.n is null then 'unresolved'
            when c.n > 1 then 'ambiguous'
            -- A prefix match does not establish equivalence (PCP S28): it is
            -- held for manual semantic verification and never applied.
            when c.tier = 3 then 'needs_semantic_review'
            else 'matched' end as status,
       case when c.n = 1 then c.std_code end as std_code,
       case when c.n = 1 then c.std_desc end as std_desc,
       c.tier
from flagged f
left join chosen c on c.profile_id = f.profile_id and c.manual_code = f.manual_code;

-- One-to-one: a standard KSB claimed by two manual items is ambiguous for both.
update ksb_mig.item_match m set status = 'ambiguous'
where m.status = 'matched' and exists (
  select 1 from ksb_mig.item_match o
  where o.profile_id = m.profile_id and o.std_code = m.std_code and o.manual_code <> m.manual_code and o.status = 'matched'
);

-- ---------------------------------------------------------------------------
-- Programme identity. A programme may move to a standard only when its name
-- (without "Level N") equals the standard title and its level equals the
-- standard level. Anything else is blocked, never guessed.
drop table if exists ksb_mig.programme_scope;
create table ksb_mig.programme_scope as
with progs as (
  select p.programme_id, p.name, p.level, p.status, p.ksb_profile_source_id as current_source,
         substring(p.ksb_profile_source_id from 'KSBP-[0-9]+') as profile_id
  from curriculum.programmes p
  where p.ksb_profile_source_id ilike 'KSBP-%'
), titled as (
  select g.*, pr.name as profile_name, pr.standard_source_id as std_sid,
         (select min(standard_title) from ksb_mig.std s where s.sid = pr.standard_source_id) as std_title,
         (select min(std_level) from ksb_mig.std s where s.sid = pr.standard_source_id) as std_level
  from progs g left join curriculum.ksb_profiles pr on pr.id = g.profile_id
)
select t.*,
       regexp_replace(lower(regexp_replace(t.name, 'level\s*[0-9]+', '', 'gi')), '[^a-z0-9]+', '', 'g')
         = regexp_replace(lower(coalesce(t.std_title, '')), '[^a-z0-9]+', '', 'g') as name_ok,
       nullif(regexp_replace(coalesce(t.level, ''), '[^0-9]', '', 'g'), '')
         = nullif(regexp_replace(coalesce(t.std_level, ''), '[^0-9]', '', 'g'), '') as level_ok,
       case when t.std_sid is null then 'unchanged_no_standard'
            when regexp_replace(lower(regexp_replace(t.name, 'level\s*[0-9]+', '', 'gi')), '[^a-z0-9]+', '', 'g')
                   = regexp_replace(lower(coalesce(t.std_title, '')), '[^a-z0-9]+', '', 'g')
             and nullif(regexp_replace(coalesce(t.level, ''), '[^0-9]', '', 'g'), '')
                   = nullif(regexp_replace(coalesce(t.std_level, ''), '[^0-9]', '', 'g'), '')
            then 'migrate'
            else 'blocked_identity' end as decision
from titled t;

-- A profile's codes may be translated in learner data only when an active
-- programme already carries (or will carry) its standard with a verified
-- identity -- e.g. Marketing Manager Level 6 is already on standard:st0612-v1-0.
drop table if exists ksb_mig.profile_target;
create table ksb_mig.profile_target as
select pr.id as profile_id, pr.name as profile_name, pr.standard_source_id as std_sid,
       (select string_agg(p.name, ' | ' order by p.name) from curriculum.programmes p
         where coalesce(p.status, '') <> 'archived'
           and (p.ksb_profile_source_id = 'standard:' || pr.standard_source_id
                or p.programme_id in (select programme_id from ksb_mig.programme_scope s where s.profile_id = pr.id and s.decision = 'migrate'))
           and regexp_replace(lower(regexp_replace(p.name, 'level\s*[0-9]+', '', 'gi')), '[^a-z0-9]+', '', 'g')
                 = regexp_replace(lower(coalesce((select min(standard_title) from ksb_mig.std s where s.sid = pr.standard_source_id), '')), '[^a-z0-9]+', '', 'g')
       ) as verified_programmes
from curriculum.ksb_profiles pr;

alter table ksb_mig.profile_target add column decision text;
update ksb_mig.profile_target
   set decision = case when std_sid is null then 'no_standard'
                       when verified_programmes is null then 'blocked_no_verified_programme'
                       else 'translate' end;

-- ---------------------------------------------------------------------------
-- Design-time mappings (curriculum.ksb_mappings).
drop table if exists ksb_mig.mapping_plan;
create table ksb_mig.mapping_plan as
select m.id as mapping_id, m.module_catalogue_id, m.week_id, m.component_id,
       m.ksb_code as old_code, m.ksb_id as old_ksb_id, m.ksb_description as old_desc,
       m.source_type as old_source_type, m.source_id as old_source_id,
       coalesce(m.is_programme_deleted, false) as row_deleted,
       mo.programme_id, ps.decision as programme_decision,
       coalesce(substring(m.source_id from 'KSBP-[0-9]+'), substring(mo.ksb_profile_source_id from 'KSBP-[0-9]+')) as profile_id,
       im.status as match_status, im.tier, im.std_code, im.std_desc, im.std_sid,
       case when ps.decision is distinct from 'migrate' then 'hold_programme_not_migrating'
            when im.status = 'matched' then 'repoint'
            when im.status = 'group_heading' then 'review_group_heading'
            else 'review_unresolved' end as action
from curriculum.ksb_mappings m
left join curriculum.modules mo on mo.module_catalogue_id = m.module_catalogue_id
left join ksb_mig.programme_scope ps on ps.programme_id = mo.programme_id
left join ksb_mig.item_match im
       on im.profile_id = coalesce(substring(m.source_id from 'KSBP-[0-9]+'), substring(mo.ksb_profile_source_id from 'KSBP-[0-9]+'))
      and im.manual_code = upper(btrim(m.ksb_code))
where m.source_id ilike '%KSBP-%'
   or (coalesce(m.source_id, '') = '' and mo.ksb_profile_source_id ilike 'KSBP-%');

-- A repoint must not collide with the unique index
-- (component_id, upper(ksb_code), source_type, source_id).
alter table ksb_mig.mapping_plan add column conflict text;
update ksb_mig.mapping_plan p set conflict = 'existing_standard_mapping'
where p.action = 'repoint' and p.component_id is not null and exists (
  select 1 from curriculum.ksb_mappings m
  where m.component_id = p.component_id and upper(m.ksb_code) = p.std_code
    and m.source_type = 'standard' and m.source_id = p.std_sid
);
update ksb_mig.mapping_plan p set conflict = coalesce(conflict, 'duplicate_within_plan')
where p.action = 'repoint' and p.component_id is not null and exists (
  select 1 from ksb_mig.mapping_plan o
  where o.action = 'repoint' and o.component_id = p.component_id and o.std_code = p.std_code and o.mapping_id <> p.mapping_id
);

-- ---------------------------------------------------------------------------
-- Component-owned JSON copies (curriculum.components.ksb_mappings).
drop table if exists ksb_mig.component_json_plan;
create table ksb_mig.component_json_plan as
select c.id as component_id, c.module_catalogue_id, x.ord - 1 as idx, x.e->>'id' as item_id, x.e as old_item,
       coalesce(c.is_programme_deleted, false) as row_deleted,
       upper(btrim(coalesce(x.e->>'ksb_code', x.e->>'ksbCode', x.e->>'code'))) as old_code,
       mo.programme_id, ps.decision as programme_decision,
       coalesce(substring(coalesce(x.e->>'source_id', x.e->>'sourceId') from 'KSBP-[0-9]+'),
                substring(mo.ksb_profile_source_id from 'KSBP-[0-9]+')) as profile_id,
       im.status as match_status, im.tier, im.std_code, im.std_desc, im.std_sid,
       case when ps.decision is distinct from 'migrate' then 'hold_programme_not_migrating'
            when im.status = 'matched' then 'repoint'
            when im.status = 'group_heading' then 'review_group_heading'
            else 'review_unresolved' end as action
from curriculum.components c
cross join lateral jsonb_array_elements(case when jsonb_typeof(c.ksb_mappings) = 'array' then c.ksb_mappings else '[]'::jsonb end) with ordinality as x(e, ord)
left join curriculum.modules mo on mo.module_catalogue_id = c.module_catalogue_id
left join ksb_mig.programme_scope ps on ps.programme_id = mo.programme_id
left join ksb_mig.item_match im
       on im.profile_id = coalesce(substring(coalesce(x.e->>'source_id', x.e->>'sourceId') from 'KSBP-[0-9]+'),
                                   substring(mo.ksb_profile_source_id from 'KSBP-[0-9]+'))
      and im.manual_code = upper(btrim(coalesce(x.e->>'ksb_code', x.e->>'ksbCode', x.e->>'code')))
where coalesce(x.e->>'source_id', x.e->>'sourceId', '') ilike '%KSBP-%'
   or (coalesce(x.e->>'source_id', x.e->>'sourceId', '') = '' and mo.ksb_profile_source_id ilike 'KSBP-%');

-- ---------------------------------------------------------------------------
-- Learner pins. The version's `programme` label is unreliable, so the
-- learner's programme is taken from their own live progress rows.
drop table if exists ksb_mig.learner_programme;
create table ksb_mig.learner_programme as
select distinct on (learner_id) learner_id, programme_id, n
from (
  select learner_id, programme_id, count(*) as n
  from "Learner".learner_progress_entries
  where coalesce(programme_id, '') <> '' and deleted_at is null
  group by learner_id, programme_id
) t
order by learner_id, n desc, programme_id;

drop table if exists ksb_mig.pin_plan;
create table ksb_mig.pin_plan as
select a.learner_id, a.profile_version_id as old_version_id, v.source_profile_id as old_source,
       lp.programme_id as learner_programme_id, p.name as learner_programme,
       p.ksb_profile_source_id as programme_source_now,
       pt.std_sid, pt.decision as profile_decision,
       case
         when v.source_profile_id ilike 'KSBP-%' and lp.programme_id is null then 'hold_no_programme'
         when v.source_profile_id ilike 'KSBP-%' and pt.decision <> 'translate' then 'hold_profile_not_translatable'
         when v.source_profile_id ilike 'KSBP-%'
              and (p.ksb_profile_source_id = 'standard:' || pt.std_sid
                   or p.programme_id in (select programme_id from ksb_mig.programme_scope s where s.decision = 'migrate' and s.std_sid = pt.std_sid))
           then 'repin'
         when v.source_profile_id ilike 'KSBP-%' then 'hold_programme_mismatch'
         when v.source_profile_id ilike 'standard:%' and p.programme_id is not null
              and coalesce((select 'standard:' || s.std_sid from ksb_mig.programme_scope s where s.programme_id = p.programme_id and s.decision = 'migrate'),
                           p.ksb_profile_source_id, '') ilike 'standard:%'
              and coalesce((select 'standard:' || s.std_sid from ksb_mig.programme_scope s where s.programme_id = p.programme_id and s.decision = 'migrate'),
                           p.ksb_profile_source_id) <> v.source_profile_id
           then 'pre_existing_mismatch'
         else 'unchanged'
       end as action
from "Learner".learner_ksb_assignments a
join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
left join ksb_mig.learner_programme lp on lp.learner_id = a.learner_id
left join curriculum.programmes p on p.programme_id = lp.programme_id
left join ksb_mig.profile_target pt on pt.profile_id = substring(v.source_profile_id from 'KSBP-[0-9]+');

-- ---------------------------------------------------------------------------
-- Learner progress KSB copies ("Learner".learner_progress_ksbs).
-- Rows carrying a manual source, plus source-less dotted codes (K1.1) whose
-- learner is pinned to a manual profile.
drop table if exists ksb_mig.progress_plan;
create table ksb_mig.progress_plan as
with rows_ as (
  select k.progress_id, k.position, e.learner_id, e.kind, e.passed, e.component_ref,
         e.programme_id, e.deleted_at,
         upper(btrim(k.ksb_code)) as old_code, k.ksb_description as old_desc,
         k.source_type as old_source_type, k.source_id as old_source_id, k.weight, k.ksb_definition_id,
         -- Source-less dotted codes take the profile from the learner's manual
         -- pin, else from the row's own programme when that programme is a
         -- verified 'migrate' programme. Nothing else is inferred.
         coalesce(substring(k.source_id from 'KSBP-[0-9]+'),
                  case when coalesce(k.source_type, '') = '' and k.ksb_code like '%.%'
                       then coalesce(substring(v.source_profile_id from 'KSBP-[0-9]+'),
                                     (select s.profile_id from ksb_mig.programme_scope s
                                       where s.programme_id = e.programme_id and s.decision = 'migrate')) end) as profile_id
  from "Learner".learner_progress_ksbs k
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  left join "Learner".learner_ksb_assignments a on a.learner_id = e.learner_id
  left join curriculum.ksb_profile_versions v on v.id = a.profile_version_id
  where k.source_id ilike '%KSBP-%' or (coalesce(k.source_type, '') = '' and k.ksb_code like '%.%')
)
select r.*, pt.decision as profile_decision, im.status as match_status, im.tier, im.std_code, im.std_desc, pt.std_sid,
       case when r.profile_id is null then 'review_no_profile'
            when pt.decision <> 'translate' then 'hold_profile_not_translatable'
            -- Already a code of the target standard: migrated Aptem rows carry the
            -- standard in their compound source ("KSBP-...:st0612-v1-0:..."), and
            -- an undotted code there is the standard's own K1, not the manual
            -- group heading K1. Leave those rows exactly as they are.
            when r.old_code not like '%.%'
             and (im.status is null or r.old_source_id ilike '%:' || pt.std_sid || ':%')
             and exists (select 1 from ksb_mig.std s where s.sid = pt.std_sid and s.std_code = r.old_code)
              then 'keep_already_standard_code'
            when im.status = 'matched' then 'repoint'
            when im.status = 'group_heading' then 'review_group_heading'
            else 'review_unresolved' end as action
from rows_ r
left join ksb_mig.profile_target pt on pt.profile_id = r.profile_id
left join ksb_mig.item_match im on im.profile_id = r.profile_id and im.manual_code = r.old_code;

-- ---------------------------------------------------------------------------
-- Rows the migration does not translate but whose code would, after the
-- programme moves to its standard, be READ as a standard code by the
-- code-only achievement readers (e.g. imported activity rows coded K1 with
-- the manual heading "Marketing Concepts & Theories"). They are never
-- rewritten -- they are registered in "Learner".learner_progress_ksb_exclusions
-- and the readers skip them. Statuses:
--   valid_standard_text      description is the standard's own text: counts
--   valid_ssot_code          imported SSOT row, code trusted as the standard's: counts
--   excluded_group_heading   a manual group heading, by text or (no text) by code
--   excluded_other_standard  carries another standard's source (e.g. PCP rows)
--   excluded_unresolved      some other description: meaning unknown
--   pending_verification     no description, code only exists in the standard's
--                            numbering (K5+...): counts only once verified
drop table if exists ksb_mig.legacy_rows;
create table ksb_mig.legacy_rows as
with target as (
  select lp.learner_id, s.profile_id, s.std_sid
  from ksb_mig.learner_programme lp
  join ksb_mig.programme_scope s on s.programme_id = lp.programme_id and s.decision = 'migrate'
), headings as (
  select profile_id, manual_code, regexp_replace(lower(coalesce(manual_desc, '')), '[^a-z0-9]+', '', 'g') as nd
  from ksb_mig.item_match where is_heading
), rows_ as (
  select k.progress_id, k.position, t.learner_id, t.profile_id, t.std_sid, e.programme_id, e.source_system,
         upper(btrim(k.ksb_code)) as ksb_code, k.ksb_description, k.source_type, k.source_id,
         regexp_replace(lower(coalesce(k.ksb_description, '')), '[^a-z0-9]+', '', 'g') as nd
  from "Learner".learner_progress_ksbs k
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  join target t on t.learner_id = e.learner_id
  where not exists (select 1 from ksb_mig.progress_plan p where p.progress_id = k.progress_id and p.position = k.position)
    and exists (select 1 from ksb_mig.std s where s.sid = t.std_sid and s.std_code = upper(btrim(k.ksb_code)))
    and not (k.source_type = 'standard' and k.source_id = t.std_sid)
)
select r.*,
       case when r.nd <> '' and r.nd = (select s.nd from ksb_mig.std s where s.sid = r.std_sid and s.std_code = r.ksb_code)
              then 'valid_standard_text'
            -- Imported SSOT rows (journal, old LMS, Aptem, new LMS) use the
            -- standard's numbering. Their description is NOT evidence: every
            -- description on these rows is the manual profile item looked up by
            -- the same code (100% on 14 Oct 2026), and codes absent from the
            -- manual profile (K5+) carry none. Decision 14 Oct 2026: trust the
            -- code as the standard's, leave the row unchanged.
            when r.source_type = 'activity-ssot'
              then 'valid_ssot_code'
            when r.nd <> '' and exists (select 1 from headings h where h.nd = r.nd)
              then 'excluded_group_heading'
            when r.nd = '' and exists (select 1 from headings h where h.profile_id = r.profile_id and h.manual_code = r.ksb_code)
              then 'excluded_group_heading'
            when r.source_type = 'standard'
              then 'excluded_other_standard'
            when r.nd <> ''
              then 'excluded_unresolved'
            else 'pending_verification' end as status
from rows_ r;

-- ---------------------------------------------------------------------------
-- Achievement reconciliation, per learner and per standard KSB.
-- Rows registered as excluded (legacy_rows, and the plan's own review rows)
-- are left out on BOTH sides: this compares what the migration translates.
-- BEFORE: today's rows, achieved under progress_rules.progress_counts_as_achieved
--         (passed is not false; a quiz must have passed = true), max weight per
--         progress row and code, deduplicated by (learner, component, code) --
--         the learner_progress_ksb_totals rule -- then translated to the
--         standard code through item_match.
-- AFTER:  the same rows with the plan applied (repointed codes; review rows
--         registered as excluded), computed under the same rule.
drop table if exists ksb_mig.recon;
create table ksb_mig.recon as
with learners as (
  select distinct learner_id from ksb_mig.progress_plan where action in ('repoint', 'review_group_heading', 'review_unresolved')
), all_rows as (
  select k.progress_id, k.position, e.learner_id, e.kind, e.passed, e.component_ref, e.deleted_at,
         upper(btrim(k.ksb_code)) as code, coalesce(k.weight, 0) as weight
  from "Learner".learner_progress_ksbs k
  join "Learner".learner_progress_entries e on e.id = k.progress_id
  where e.learner_id in (select learner_id from learners)
    and not exists (select 1 from ksb_mig.legacy_rows l
                    where l.progress_id = k.progress_id and l.position = k.position and l.status not in ('valid_standard_text', 'valid_ssot_code'))
), before_rows as (
  select a.*, case when pp.action = 'repoint' then pp.std_code
                   when pp.action in ('review_group_heading', 'review_unresolved', 'review_no_profile') then 'REVIEW:' || a.code
                   else a.code end as std_code
  from all_rows a left join ksb_mig.progress_plan pp on pp.progress_id = a.progress_id and pp.position = a.position
), after_rows as (
  select a.progress_id, a.learner_id, a.kind, a.passed, a.component_ref, a.deleted_at,
         case when pp.action = 'repoint' then pp.std_code else a.code end as code, a.weight
  from all_rows a left join ksb_mig.progress_plan pp on pp.progress_id = a.progress_id and pp.position = a.position
  where coalesce(pp.action, '') not in ('review_group_heading', 'review_unresolved', 'review_no_profile')
), b as (
  select learner_id, std_code, sum(w) as weight, string_agg(comp, ',' order by comp) as components
  from (
    select distinct on (learner_id, coalesce(component_ref, progress_id::text), std_code)
           learner_id, std_code, coalesce(component_ref, 'p' || progress_id) as comp, w
    from (select learner_id, progress_id, component_ref, std_code, max(weight) as w, bool_or(passed is not false and (lower(coalesce(kind, '')) <> 'quiz' or passed is true)) as ok
          from before_rows group by learner_id, progress_id, component_ref, std_code) z
    where ok order by learner_id, coalesce(component_ref, progress_id::text), std_code, progress_id desc
  ) d group by learner_id, std_code
), a as (
  select learner_id, code as std_code, sum(w) as weight, string_agg(comp, ',' order by comp) as components
  from (
    select distinct on (learner_id, coalesce(component_ref, progress_id::text), code)
           learner_id, code, coalesce(component_ref, 'p' || progress_id) as comp, w
    from (select learner_id, progress_id, component_ref, code, max(weight) as w, bool_or(passed is not false and (lower(coalesce(kind, '')) <> 'quiz' or passed is true)) as ok
          from after_rows group by learner_id, progress_id, component_ref, code) z
    where ok order by learner_id, coalesce(component_ref, progress_id::text), code, progress_id desc
  ) d group by learner_id, code
)
select coalesce(b.learner_id, a.learner_id) as learner_id, coalesce(b.std_code, a.std_code) as std_code,
       b.weight as before_weight, a.weight as after_weight, b.components as before_components, a.components as after_components,
       case when b.std_code like 'REVIEW:%' then 'moved_to_review'
            when b.weight is not distinct from a.weight and b.components is not distinct from a.components then 'identical'
            else 'DIFFERENT' end as verdict
from b full join a on a.learner_id = b.learner_id and a.std_code = b.std_code;

-- ---------------------------------------------------------------------------
-- Code collisions the reconciliation above would hide: within one progress
-- row, two different old codes that land on the same standard code after the
-- plan (e.g. a repointed K1.1 -> K1 next to a kept standard K1). Weights are
-- taken as max() per row and code, so a collision could change a total.
drop table if exists ksb_mig.merge_check;
create table ksb_mig.merge_check as
select k.progress_id, e.learner_id,
       case when pp.action = 'repoint' then pp.std_code else upper(btrim(k.ksb_code)) end as new_code,
       count(*) as rows_, count(distinct upper(btrim(k.ksb_code))) as distinct_old_codes,
       string_agg(upper(btrim(k.ksb_code)) || '=' || coalesce(k.weight, 0), ',' order by k.position) as detail
from "Learner".learner_progress_ksbs k
join "Learner".learner_progress_entries e on e.id = k.progress_id
left join ksb_mig.progress_plan pp on pp.progress_id = k.progress_id and pp.position = k.position
where k.progress_id in (select progress_id from ksb_mig.progress_plan where action = 'repoint')
  and coalesce(pp.action, '') not in ('review_group_heading', 'review_unresolved', 'review_no_profile')
group by 1, 2, 3
having count(distinct upper(btrim(k.ksb_code))) > 1;

-- ---------------------------------------------------------------------------
-- What each learner will SEE: distinct required KSBs achieved, today (against
-- the manual profile's codes) and after (against the standard's codes, with
-- the plan applied and registered rows excluded). Same completion rule as
-- learner_progress_ksb_totals. The change is expected and accepted; this
-- table explains it learner by learner.
drop table if exists ksb_mig.learner_display;
create table ksb_mig.learner_display as
with target as (
  select lp.learner_id, s.profile_id, s.std_sid, s.programme_id
  from ksb_mig.learner_programme lp
  join ksb_mig.programme_scope s on s.programme_id = lp.programme_id and s.decision = 'migrate'
), rows_ as (
  select t.learner_id, t.profile_id, t.std_sid, upper(btrim(k.ksb_code)) as code,
         pp.action as plan_action, pp.std_code as plan_code, l.status as legacy_status
  from target t
  join "Learner".learner_progress_entries e on e.learner_id = t.learner_id and e.deleted_at is null
  join "Learner".learner_progress_ksbs k on k.progress_id = e.id
  left join ksb_mig.progress_plan pp on pp.progress_id = k.progress_id and pp.position = k.position
  left join ksb_mig.legacy_rows l on l.progress_id = k.progress_id and l.position = k.position
  where e.passed is not false and (lower(coalesce(e.kind, '')) <> 'quiz' or e.passed is true)
), per as (
  select learner_id, profile_id, std_sid,
         array_agg(distinct code) filter (where code in (select manual_code from ksb_mig.item_match i where i.profile_id = r.profile_id)) as before_codes,
         array_agg(distinct coalesce(case when plan_action = 'repoint' then plan_code end, code))
           filter (where coalesce(plan_action, '') not in ('review_group_heading', 'review_unresolved', 'review_no_profile')
                     and coalesce(legacy_status, 'valid_standard_text') in ('valid_standard_text', 'valid_ssot_code')
                     and coalesce(case when plan_action = 'repoint' then plan_code end, code)
                         in (select std_code from ksb_mig.std s where s.sid = r.std_sid)) as after_codes,
         count(*) filter (where legacy_status in ('excluded_group_heading', 'excluded_other_standard', 'excluded_unresolved')) as excluded_rows,
         count(*) filter (where legacy_status = 'pending_verification') as pending_rows
  from rows_ r group by learner_id, profile_id, std_sid
)
select p.learner_id, p.std_sid,
       coalesce(cardinality(p.before_codes), 0) as before_achieved,
       (select count(*) from ksb_mig.item_match i where i.profile_id = p.profile_id) as before_required,
       coalesce(cardinality(p.after_codes), 0) as after_achieved,
       (select count(*) from ksb_mig.std s where s.sid = p.std_sid) as after_required,
       round(coalesce(cardinality(p.before_codes), 0) * 100.0 / nullif((select count(*) from ksb_mig.item_match i where i.profile_id = p.profile_id), 0), 1) as before_pct,
       round(coalesce(cardinality(p.after_codes), 0) * 100.0 / nullif((select count(*) from ksb_mig.std s where s.sid = p.std_sid), 0), 1) as after_pct,
       p.excluded_rows, p.pending_rows
from per p;
