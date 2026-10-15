-- Read-only check for run_archive_manual_ksb_profiles.sql. Safe to run any time.

-- Manual profiles: after the run every row reads is_active = false.
select id, name, is_active from curriculum.ksb_profiles order by id;

-- Skills Radar: after the run each apprenticeship radar names the profile its
-- answers were given against.
select r.id, r."Learner_kind", r."Standard_id",
       (select string_agg(distinct regexp_replace(a."Ksb_id", '-[0-9]+$', ''), ',')
          from enrolment."Wizard_Ksb_Assessments" a
         where a."Learner_id" = r."Learner_id" and a."Learner_kind" is not distinct from r."Learner_kind") as answered_against
  from enrolment."Wizard_Skills_Radar" r
 order by r.id;

-- The four programmes and the standard each applies.
select programme_id, name, ksb_profile_source_id
  from curriculum.programmes
 where programme_id in ('PROG-20260907141619067932', 'PROG-ME-L4', 'PROG-MM-L6', 'PROG-PCP-L6')
 order by name;

-- What the run changed. Only after the run: before it, this table does not exist.
-- select kind, record_key, before_value, after_value, run_at, rolled_back_at
--   from ksb_migration_archive.manual_profile_archive order by id;
