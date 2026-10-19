-- KSB standards migration -- READ-ONLY verification: full-row fingerprints of the
-- tables the migration touches. Before 02_apply.sql and after 03_rollback.sql they must
-- match exactly (byte-for-byte rollback proof).
with t(object, n, h) as (
  select 'learner_ksb_assignments full', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_ksb_assignments x
  union all select 'programmes full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.programmes x
  union all select 'modules full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.modules x
  union all select 'components full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.components x
  union all select 'ksb_mappings full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.ksb_mappings x
  union all select 'learner_progress_ksbs full', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_progress_ksbs x
  union all select 'ksb_profile_versions full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.ksb_profile_versions x
  union all select 'ksb_definitions full', count(*), sum(hashtextextended(x::text, 7)) from curriculum.ksb_definitions x
  union all select 'exclusions', count(*), sum(hashtextextended(x::text, 7)) from "Learner".learner_progress_ksb_exclusions x
)
select object, n, h::text from t order by 1;
