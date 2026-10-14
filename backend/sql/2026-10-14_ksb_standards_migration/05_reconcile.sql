-- KSB standards migration -- reconciliation queries (READ-ONLY).
--
-- Run (a) before 02_apply.sql and keep the output; run it again after apply,
-- after a re-run (must be unchanged), and after 03_rollback.sql (must equal the
-- pre-apply output except the audit counters, which only grow).

-- (a) Checksums of everything the migration can touch.
select 'ksb_mappings (planned rows)' as object, count(*) as row_count,
       md5(string_agg(m::text, '|' order by m.id)) as checksum
from curriculum.ksb_mappings m where m.id in (select mapping_id from ksb_mig.mapping_plan)
union all
select 'components (planned)', count(*), md5(string_agg(c.id || ':' || coalesce(c.ksb_mappings::text, ''), '|' order by c.id))
from curriculum.components c where c.id in (select component_id from ksb_mig.component_json_plan)
union all
select 'learner_progress_ksbs (planned activities)', count(*),
       md5(string_agg(k::text, '|' order by k.progress_id, k.position))
from "Learner".learner_progress_ksbs k where k.progress_id in (select progress_id from ksb_mig.progress_plan)
union all
select 'learner_ksb_assignments (all)', count(*), md5(string_agg(a.learner_id || ':' || a.profile_version_id, '|' order by a.learner_id))
from "Learner".learner_ksb_assignments a
union all
select 'programmes (sources)', count(*), md5(string_agg(p.programme_id || ':' || coalesce(p.ksb_profile_source_id, ''), '|' order by p.programme_id))
from curriculum.programmes p
union all
select 'modules (sources)', count(*), md5(string_agg(m.module_catalogue_id || ':' || coalesce(m.ksb_profile_source_id, ''), '|' order by m.module_catalogue_id))
from curriculum.modules m
union all
select 'ksb_profiles (untouched)', count(*), md5(string_agg(p::text, '|' order by p.id)) from curriculum.ksb_profiles p
union all
select 'ksb_profile_versions', count(*), md5(string_agg(v.id || ':' || v.source_profile_id || ':' || v.version_hash, '|' order by v.id))
from curriculum.ksb_profile_versions v
union all
select 'ksb_definitions', count(*), null from curriculum.ksb_definitions
union all
select 'learner_activity_revisions (audit, grows)', count(*), null from "Learner".learner_activity_revisions
order by 1;
-- The exclusion registry is counted in (b); it does not exist before the first apply.

-- (b) Per-table before/after counts for the last applied run.
select 'mappings repointed' as what, count(*) as rows_
from ksb_migration_archive.mappings_before b join curriculum.ksb_mappings m on m.id = b.id
where m.source_type = 'standard' and b.source_id ilike '%KSBP-%'
union all
select 'heading mappings soft-deleted by the migration', count(*)
from curriculum.ksb_mappings where deleted_by = 'ksb-standards-migration:unresolved-group-heading'
union all
select 'components rewritten', count(*)
from ksb_migration_archive.components_before b join curriculum.components c on c.id = b.id
where c.ksb_mappings is distinct from b.ksb_mappings
union all
select 'learner KSB rows repointed', count(*)
from ksb_migration_archive.progress_ksbs_before b
join "Learner".learner_progress_ksbs k on k.progress_id = b.progress_id and k.position = b.position
where k.source_type = 'standard' and b.source_type is distinct from 'standard'
union all
select 'learner rows registered as excluded', count(*) from "Learner".learner_progress_ksb_exclusions
union all
select 'learners repinned', count(*)
from ksb_migration_archive.pins_before b join "Learner".learner_ksb_assignments a on a.learner_id = b.learner_id
where a.profile_version_id <> b.profile_version_id
union all
select 'programmes moved', count(*)
from ksb_migration_archive.programmes_before b join curriculum.programmes p on p.programme_id = b.programme_id
where p.ksb_profile_source_id is distinct from b.ksb_profile_source_id
union all
select 'modules moved', count(*)
from ksb_migration_archive.modules_before b join curriculum.modules m on m.module_catalogue_id = b.module_catalogue_id
where m.ksb_profile_source_id is distinct from b.ksb_profile_source_id
union all
select 'activity revisions written', count(*) from "Learner".learner_activity_revisions where source_system = 'ksb-standards-migration'
union all
select 'versions created', count(*) from ksb_migration_archive.versions_created;

-- (c) Learner-visible change (accepted): before/after per learner.
select learner_id, before_achieved || '/' || before_required as before_, before_pct,
       after_achieved || '/' || after_required as after_, after_pct, excluded_rows, pending_rows
from ksb_mig.learner_display order by after_pct - before_pct, learner_id;
