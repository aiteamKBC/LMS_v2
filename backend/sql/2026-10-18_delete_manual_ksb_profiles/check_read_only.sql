-- Read-only check for run_delete_manual_ksb_profiles.sql. Safe to run any time.
--
-- Lists every manual KSB profile with the records that still name it. A profile
-- with no references is deleted by the run; a referenced one is kept, because a
-- programme, module, mapping, learner pin or signed Skills Radar still reads it.

with refs as (
  select 'programmes' as holder,
         regexp_replace(lower(btrim(ksb_profile_source_id)), '^(profile|framework):', '') as ref
    from curriculum.programmes
   where coalesce(ksb_profile_source_id, '') <> ''
  union all
  select 'modules',
         regexp_replace(lower(btrim(ksb_profile_source_id)), '^(profile|framework):', '')
    from curriculum.modules
   where coalesce(ksb_profile_source_id, '') <> ''
  union all
  select 'ksb_mappings',
         regexp_replace(lower(btrim(source_id)), '^(profile|framework):', '')
    from curriculum.ksb_mappings
   where coalesce(source_id, '') <> ''
  union all
  select 'components',
         regexp_replace(lower(btrim(coalesce(x.e ->> 'source_id', x.e ->> 'sourceId'))), '^(profile|framework):', '')
    from curriculum.components c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.ksb_mappings) = 'array' then c.ksb_mappings else '[]'::jsonb end) as x(e)
   where coalesce(x.e ->> 'source_id', x.e ->> 'sourceId', '') <> ''
  union all
  select 'learner pins',
         regexp_replace(lower(btrim(source_profile_id)), '^(profile|framework):', '')
    from curriculum.ksb_profile_versions
   where coalesce(source_profile_id, '') <> ''
  union all
  select 'learner_progress_ksbs',
         regexp_replace(lower(btrim(source_id)), '^(profile|framework):', '')
    from "Learner".learner_progress_ksbs
   where coalesce(source_id, '') <> ''
  union all
  select 'Skills Radar',
         regexp_replace(lower(btrim("Standard_id")), '^(profile|framework):', '')
    from enrolment."Wizard_Skills_Radar"
   where coalesce("Standard_id", '') <> ''
  union all
  select 'Skills Radar answers',
         lower(regexp_replace(btrim("Ksb_id"), '-[0-9]+$', ''))
    from enrolment."Wizard_Ksb_Assessments"
   where coalesce("Ksb_id", '') <> ''
)
select kp.id, kp.ksb_profile_id, kp.name, kp.is_active,
       count(r.holder) as reference_count,
       string_agg(distinct r.holder, ', ') as referenced_by,
       case when count(r.holder) = 0 then 'deleted by the run' else 'kept' end as outcome
  from curriculum.ksb_profiles kp
  left join refs r
    on r.ref in (lower(kp.id::text), lower(coalesce(kp.ksb_profile_id, '')))
 group by kp.id, kp.ksb_profile_id, kp.name, kp.is_active
 order by outcome, kp.id;

-- What the run deleted. Only after the run: before it, this table does not exist.
-- select profile_id, (profile_row ->> 'name') as name, run_at, restored_at
--   from ksb_migration_archive.manual_profile_deletions order by id;
